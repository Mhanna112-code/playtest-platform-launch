import { db } from "@/lib/db";
import { emailDecision, summaryDue } from "@/lib/rules";
import { appUrl } from "./auth";
import { sendEmail } from "./email";

// Every update goes to the person's bell. Email follows their setting: each update (default), one daily summary,
// or none. Sign-in links (sent elsewhere) and payment receipts (always: true) always send.
// A failed email never undoes the action: it is logged and the action stands.

/**
 * (Owner, Oct 26) BELL REACH, the same as chat: a notice about another person (`about`) reaches the recipient only when that
 * person is in, or was in, one of the recipient's tests that is still open (the recipient's own as developer, or one they
 * are / were in as tester with that person as the developer). Notices that are not about a counterpart (an invite, an
 * application, a stopped test, the site's own notices) don't pass `about`.
 */
export async function inReach(recipientId: string, otherId: string) {
  const n = await db.contract.count({
    where: { test: { status: "open" }, OR: [{ testerId: otherId, test: { developerId: recipientId, status: "open" } }, { testerId: recipientId, test: { developerId: otherId, status: "open" } }] },
  });
  return n > 0;
}

/** The test a bell line is about, from the page it links to (so same-day lines about one test can stack). */
export async function testIdOfLink(path: string) {
  let m = /^\/app\/(?:tests|find)\/([^/#?]+)/.exec(path);
  if (m) return m[1];
  m = /^\/app\/(?:sessions|chat)\/([^/#?]+)/.exec(path);
  if (m) return (await db.contract.findUnique({ where: { id: m[1] }, select: { testId: true } }))?.testId ?? null;
  return null;
}

/**
 * `own`: the line always arrives as its own entry in the bell (admin decisions, a test stopped, payment failures and holds starting, a hold or
 * pause lifted, a chargeback); every other line about the same test on the same day stacks. `testId` names the test when the link doesn't.
 */
export type Opts = { always?: boolean; about?: string; own?: boolean; testId?: string; group?: string; payment?: boolean };

/**
 * `group`: lines with the same group stack together on one day even across tests (see lib/bell.ts). `payment`: payment-related (failures, holds, retries, paid,
 * rejected, delayed, payouts, chargebacks): it is its own line unless it has a group, and it also goes out in the end-of-day payment email.
 */
const flags = (o: { own?: boolean; group?: string; payment?: boolean }) => ({ own: o.own ?? (!!o.payment && !o.group), groupKey: o.group ?? null, payment: !!o.payment });

export async function notify(to: string, subject: string, lines: string[], path: string, opts: Opts = {}) {
  const user = await db.user.findUnique({ where: { email: to }, select: { id: true, emailPref: true } });
  if (user && opts.about && !(await inReach(user.id, opts.about))) return;
  if (user) await db.notification.create({ data: { userId: user.id, text: subject, link: path, testId: opts.testId ?? (await testIdOfLink(path)), ...flags(opts) } });
  const decision = emailDecision(user?.emailPref ?? "daily", !!opts.always);
  if (decision !== "send") return;
  try {
    await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`, "", "Playtest"].join("\n") });
  } catch (e) {
    console.error("[email] failed:", subject, (e as Error).message);
  }
}

/** A bell notification only (no email), e.g. the Open until heads-ups. */
export async function bell(userId: string, text: string, link: string, about?: string, opts: Pick<Opts, "own" | "testId" | "group" | "payment"> = {}) {
  if (about && !(await inReach(userId, about))) return;
  await db.notification.create({ data: { userId, text, link, testId: opts.testId ?? (await testIdOfLink(link)), ...flags(opts) } });
}

/** Everyone who is an admin (flagged, or listed in ADMIN_EMAILS). */
export async function adminUsers() {
  const listed = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return db.user.findMany({ where: { deletedAt: null, OR: [{ isAdmin: true }, ...(listed.length ? [{ email: { in: listed } }] : [])] }, select: { id: true, email: true } });
}

/**
 * (Owner, Oct 26) Email is Off, or On with Daily / Weekly / Monthly. EVERY email is ONE email listing all the notifications since the last one.
 * People on Weekly or Monthly also get an end-of-day email that holds only their payment-related lines (the rest wait for their normal email).
 * The daily job runs this once a day.
 */
export async function sendSummaries(now = new Date()) {
  const users = await db.user.findMany({ where: { emailPref: { in: ["daily", "weekly", "monthly"] }, notifications: { some: { summarizedAt: null } } }, select: { id: true, email: true, emailPref: true, lastSummaryAt: true } });
  const line = (n: { text: string; link: string }) => `• ${n.text}${n.link ? ` ${appUrl()}${n.link}` : ""}`;
  for (const u of users) {
    const due = summaryDue(u.emailPref, u.lastSummaryAt, now);
    const items = await db.notification.findMany({ where: { userId: u.id, summarizedAt: null, ...(due ? {} : { payment: true }) }, orderBy: { createdAt: "asc" }, take: 200 });
    if (!items.length) continue;
    if (!due && u.emailPref === "daily") continue; // (a daily person is not due again yet)
    try {
      const subject = due ? `Your Playtest summary: ${items.length} update${items.length === 1 ? "" : "s"}` : `Your Playtest payment updates: ${items.length}`;
      await sendEmail({ to: u.email, subject, text: [...items.map(line), "", "Playtest"].join("\n") });
      await db.notification.updateMany({ where: { id: { in: items.map((n) => n.id) } }, data: { summarizedAt: now } });
      if (due) await db.user.update({ where: { id: u.id }, data: { lastSummaryAt: now } });
    } catch (e) {
      console.error("[email] summary failed:", (e as Error).message);
    }
  }
  return users.length;
}
