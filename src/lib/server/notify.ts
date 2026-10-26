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
export type Opts = { always?: boolean; about?: string; own?: boolean; testId?: string };

export async function notify(to: string, subject: string, lines: string[], path: string, opts: Opts = {}) {
  const user = await db.user.findUnique({ where: { email: to }, select: { id: true, emailPref: true } });
  if (user && opts.about && !(await inReach(user.id, opts.about))) return;
  if (user) await db.notification.create({ data: { userId: user.id, text: subject, link: path, testId: opts.testId ?? (await testIdOfLink(path)), own: !!opts.own } });
  const decision = emailDecision(user?.emailPref ?? "each", !!opts.always);
  if (decision !== "send") return;
  try {
    await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`, "", "Playtest"].join("\n") });
  } catch (e) {
    console.error("[email] failed:", subject, (e as Error).message);
  }
}

/** A bell notification only (no email), e.g. the Open until heads-ups. */
export async function bell(userId: string, text: string, link: string, about?: string, opts: { own?: boolean; testId?: string } = {}) {
  if (about && !(await inReach(userId, about))) return;
  await db.notification.create({ data: { userId, text, link, testId: opts.testId ?? (await testIdOfLink(link)), own: !!opts.own } });
}

/** Everyone who is an admin (flagged, or listed in ADMIN_EMAILS). */
export async function adminUsers() {
  const listed = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return db.user.findMany({ where: { deletedAt: null, OR: [{ isAdmin: true }, ...(listed.length ? [{ email: { in: listed } }] : [])] }, select: { id: true, email: true } });
}

/** Summary emails for people on daily / weekly / monthly: one email listing their new notifications. */
export async function sendSummaries(now = new Date()) {
  const users = await db.user.findMany({ where: { emailPref: { in: ["daily", "weekly", "monthly"] }, notifications: { some: { summarizedAt: null } } }, select: { id: true, email: true, emailPref: true, lastSummaryAt: true } });
  for (const u of users) {
    if (!summaryDue(u.emailPref, u.lastSummaryAt, now)) continue;
    const items = await db.notification.findMany({ where: { userId: u.id, summarizedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
    if (!items.length) continue;
    try {
      await sendEmail({ to: u.email, subject: `Your Playtest summary: ${items.length} update${items.length === 1 ? "" : "s"}`, text: [...items.map((n) => `• ${n.text}${n.link ? ` ${appUrl()}${n.link}` : ""}`), "", "Playtest"].join("\n") });
      await db.notification.updateMany({ where: { id: { in: items.map((n) => n.id) } }, data: { summarizedAt: now } });
      await db.user.update({ where: { id: u.id }, data: { lastSummaryAt: now } });
    } catch (e) {
      console.error("[email] summary failed:", (e as Error).message);
    }
  }
  return users.length;
}
