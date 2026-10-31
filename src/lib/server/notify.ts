import { hasBoth, sideFor, sideForPath, type Side } from "@/lib/sides";
import { isAdmin } from "./session";
import { db } from "@/lib/db";
import { summaryDue } from "@/lib/rules";
import { renderTimes } from "@/lib/tz";
import { bellKey, groupTitle } from "@/lib/bell";
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
 * `side`: (Owner, Oct 30, batch 34 §5) whose line it is: the developer side's, the tester side's, or null for the whole account (sign-in, password, Terms, the
 * account's deletion or suspension, the site's own notices). Left out, the link's page decides (lineSide); a caller whose link is a shared page (the dashboard,
 * Payments, Settings) names it.
 */
export type Opts = { side?: Side | null; always?: boolean; about?: string; own?: boolean; testId?: string; group?: string; payment?: boolean; reminder?: string };

/**
 * `reminder`: (Owner, Oct 27) names a reminder ("paused:<test>"): reminders also go in the summary email, each line once; a Weekly or Monthly email shows only the newest copy of each.
 * `group`: lines with the same group stack together on one day even across tests (see lib/bell.ts). `payment`: payment-related (failures, holds, retries, paid,
 * rejected, delayed, payouts, chargebacks): it is its own line unless it has a group, and it also goes out in the end-of-day payment email.
 */
const flags = (o: { own?: boolean; group?: string; payment?: boolean }) => ({ own: o.own ?? (!!o.payment && !o.group), groupKey: o.group ?? null, payment: !!o.payment });
/** (Batch 34 §5) A line's side: the caller's, else its link's page (your own public profile is the side it shows), else the account's (null). */
export const lineSide = (userId: string, link: string, side: Side | null | undefined) => (side !== undefined ? side : sideForPath(link, userId));

export async function notify(to: string, subject0: string, lines0: string[], path: string, opts: Opts = {}) {
  const user = await db.user.findUnique({ where: { email: to }, select: { id: true, timeZone: true } });
  if (user && opts.about && !(await inReach(user.id, opts.about))) return;
  // (Batch 15 section 11) Times in the line are written in the recipient's own time zone (unknown: UTC).
  const subject = renderTimes(subject0, user?.timeZone), lines = lines0.map((l) => renderTimes(l, user?.timeZone));
  if (!user) {
    // Not an account (nowhere for a bell or a summary to go): the one email goes at once.
    try {
      // (Batch 30 §19) Not an account: no notification settings to link to.
      await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`, "", "Playtest"].join("\n"), button: { label: "Open Playtest", url: `${appUrl()}${path}` }, settings: false });
    } catch (e) {
      console.error("[email] failed:", subject, (e as Error).message);
    }
    return;
  }
  // (Owner, Oct 27) Nothing is emailed right away: the notification waits for the person's email (the summary, or the end-of-day payment email). `always` marks the few
  // that ignore Off (account paused / active again, the team pausing / stopping / closing a test, the owed reminder): they ride in ONE end-of-day email, once.
  await db.notification.create({ data: { side: lineSide(user.id, path, opts.side), userId: user.id, text: subject, link: path, testId: opts.testId ?? (await testIdOfLink(path)), mustEmail: !!opts.always, reminderKey: opts.reminder ?? null, ...flags(opts) } });
}

/** A bell notification only (no email unless the person's summary takes it, or `always`), e.g. the Open until heads-ups. */
export async function bell(userId: string, text0: string, link: string, about?: string, opts: Pick<Opts, "own" | "testId" | "group" | "payment" | "reminder" | "always" | "side"> = {}) {
  if (about && !(await inReach(userId, about))) return;
  const text = await renderFor(userId, text0);
  await db.notification.create({ data: { side: lineSide(userId, link, opts.side), userId, text, link, testId: opts.testId ?? (await testIdOfLink(link)), mustEmail: !!opts.always, reminderKey: opts.reminder ?? null, ...flags(opts) } });
}

/** (Batch 15 section 11) A line's time tokens, in this person's time zone. */
export async function renderFor(userId: string, text: string) {
  if (!text.includes("⟦t:")) return text;
  const u = await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return renderTimes(text, u?.timeZone);
}
/** (Batch 15 section 11) The same line for many people: each in their own time zone. */
export async function linesFor(userIds: string[], text: string) {
  if (!text.includes("⟦t:")) return new Map(userIds.map((id) => [id, text]));
  const zones = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, timeZone: true } })).map((u) => [u.id, u.timeZone]));
  return new Map(userIds.map((id) => [id, renderTimes(text, zones.get(id))]));
}

/** Everyone who is an admin (flagged, or listed in ADMIN_EMAILS). */
export async function adminUsers() {
  const listed = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // (Batch 15 sections 35 and 41) Listed emails count only once confirmed; a suspended admin gets nothing.
  return db.user.findMany({ where: { deletedAt: null, devSuspendedAt: null, testerSuspendedAt: null, OR: [{ isAdmin: true }, ...(listed.length ? [{ email: { in: listed }, emailVerifiedAt: { not: null } }] : [])] }, select: { id: true, email: true } });
}

/**
 * (Owner, Oct 26-27) Email is Off, or On with Daily / Weekly / Monthly. EVERY email is ONE email listing all the notifications since the last one, and each
 * notification is emailed at most once (it is marked summarized when it goes). People on Weekly or Monthly also get an end-of-day email holding only their payment
 * lines (and the must-send ones); the rest wait for their normal email. (Owner, Oct 29, batch 28 §18) On Off, the payment lines and the few must-send lines (mustEmail)
 * go in ONE end-of-day email ("Your Playtest payment updates", or "account updates" when it holds a must-send line that isn't about a payment); nothing else.
 * The daily job runs this once a day, after every notification of the day exists.
 */
/** (Owner, Oct 29, batch 29 §34) The email's lines; the testers' deadline reminders stack under one "Deadlines · 2 tests" heading, as in the bell (§27). */
function emailLines<N extends { text: string; link: string; groupKey: string | null; testId: string | null; id: string }>(items: N[], line: (n: N) => string) {
  const stacked = items.filter((n) => n.groupKey === "deadlines");
  if (stacked.length < 2) return items.map(line);
  const out: string[] = [];
  for (const n of items) {
    if (n.groupKey !== "deadlines") out.push(line(n));
    else if (n === stacked[0]) out.push(`• ${groupTitle("deadlines", new Set(stacked.map((x) => x.testId ?? x.id)).size, stacked.length)}`, ...stacked.map((x) => `  ${line(x)}`));
  }
  return out;
}

/**
 * (Owner, Oct 30, batch 34 §5) Still one email per account; with both sides, its lines sit under "Your account" (the account's own lines), "As a developer"
 * and "As a tester" headings (a heading only when it has lines). An account with one side keeps the plain list.
 */
export const SIDE_HEADINGS = { account: "Your account", developer: "As a developer", tester: "As a tester" } as const;
function sidedEmailLines<N extends { side: string | null; text: string; link: string; groupKey: string | null; testId: string | null; id: string }>(items: N[], line: (n: N) => string, both: boolean) {
  if (!both) return emailLines(items, line);
  const out: string[] = [];
  for (const [side, heading] of [[null, SIDE_HEADINGS.account], ["developer", SIDE_HEADINGS.developer], ["tester", SIDE_HEADINGS.tester]] as const) {
    const part = items.filter((n) => (n.side === "developer" || n.side === "tester" ? n.side : null) === side);
    if (part.length) out.push(...(out.length ? [""] : []), heading, ...emailLines(part, line));
  }
  return out;
}

/**
 * (Owner, Oct 30, batch 34 §5) Which lines the bell, its number and the Notifications page show: with both sides, the side in use's plus the account's.
 * An account with one side, and an admin account (no side), sees all its lines (nothing of theirs is ever hidden).
 */
export function notificationScope(side: Side | null) {
  return side ? { OR: [{ side }, { side: null }] } : {};
}
export async function notificationScopeFor(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  return notificationScope(u && !isAdmin(u) && hasBoth(u) ? sideFor(u) : null);
}

export async function sendSummaries(now = new Date(), only?: string[]) {
  const users = await db.user.findMany({
    where: { ...(only ? { id: { in: only } } : {}), notifications: { some: { summarizedAt: null, ...({ OR: [{ mustEmail: true }, { payment: true }, { user: { emailPref: { in: ["daily", "weekly", "monthly"] } } }] } as object) } } },
    select: { id: true, email: true, emailPref: true, lastSummaryAt: true, isDeveloper: true, isTester: true },
  });
  const line = (n: { text: string; link: string }) => `• ${n.text}${n.link ? ` ${appUrl()}${n.link}` : ""}`;
  for (const u of users) {
    const off = !["daily", "weekly", "monthly"].includes(u.emailPref);
    const due = !off && summaryDue(u.emailPref, u.lastSummaryAt, now);
    const only = due ? {} : { OR: [{ payment: true }, { mustEmail: true }] };
    if (!off && !due && u.emailPref === "daily") continue; // (a daily person is not due again yet)
    const all = await db.notification.findMany({ where: { userId: u.id, summarizedAt: null, ...only }, orderBy: { createdAt: "asc" }, take: 200 });
    if (!all.length) continue;
    // (Owner, Oct 27) Reminders go in the summary email too, each line once. A Weekly or Monthly email shows only the newest copy of each reminder (the older copies are marked done).
    const newest = new Map<string, string>();
    if (due && (u.emailPref === "weekly" || u.emailPref === "monthly")) for (const n of all) if (n.reminderKey) newest.set(`${n.side}:${n.reminderKey}`, n.id);
    const items = all.filter((n) => !n.reminderKey || !newest.has(`${n.side}:${n.reminderKey}`) || newest.get(`${n.side}:${n.reminderKey}`) === n.id);
    const dropped = all.filter((n) => !items.includes(n)).map((n) => n.id);
    try {
      const subject = due ? `Your Playtest summary: ${items.length} update${items.length === 1 ? "" : "s"}` : off && items.some((n) => !n.payment) ? `Your Playtest account updates: ${items.length}` : `Your Playtest payment updates: ${items.length}`;
      await sendEmail({ to: u.email, subject, text: [...sidedEmailLines(items, line, hasBoth(u)), "", "Playtest"].join("\n"), button: { label: "Open Playtest", url: `${appUrl()}/app/notifications` } });
      await db.notification.updateMany({ where: { id: { in: [...items.map((n) => n.id), ...dropped] } }, data: { summarizedAt: now } });
      if (due) await db.user.update({ where: { id: u.id }, data: { lastSummaryAt: now } });
    } catch (e) {
      console.error("[email] summary failed:", (e as Error).message);
    }
  }
  return users.length;
}

/**
 * (Owner, Oct 29, batch 29 §28) The bell's red number: how many ENTRIES of the bell list have anything unread (a stack with 3 unread lines counts 1), the same
 * grouping as the Notifications page (bellKey). Read only when opened: a single line when clicked, a stack when expanded or one of its lines clicked.
 */
export async function unreadEntryCount(userId: string) {
  const unread = await db.notification.findMany({ where: { userId, readAt: null, ...await notificationScopeFor(userId) }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, testId: true, own: true, groupKey: true, createdAt: true } });
  return new Set(unread.map(bellKey)).size;
}
