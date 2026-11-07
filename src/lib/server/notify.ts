import { hasBoth, sideFor, sideForPath, type Side } from "@/lib/sides";
import { isAdmin } from "./session";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { summaryDue } from "@/lib/rules";
import { renderTimes, safeZone } from "@/lib/tz";
import { bellKeyIn, bellStacks, stackHeading } from "@/lib/bell";
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
 * (Owner, Nov 6, §299) A PAYMENT line (`payment: true`) is never dropped by reach: money paid to a tester reaches her (bell and email) whatever the state of the
 * test it was paid on (open, closed, stopped). notify() and bell() skip this check for payment lines.
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
export type Opts = { recipientId?: string; side?: Side | null; always?: boolean; about?: string; own?: boolean; testId?: string; group?: string; payment?: boolean; reminder?: string; now?: boolean };

/**
 * `reminder`: (Owner, Oct 27) names a reminder ("invite:<id>"): reminders also go in the summary email, each line once; a Weekly or Monthly email shows only the newest copy of each.
 * `group`: lines with the same group stack together on one day even across tests (see lib/bell.ts). `payment`: payment-related (failures, holds, retries, paid,
 * rejected, delayed, payouts, chargebacks): it is its own line unless it has a group, and it also goes out in the end-of-day payment email.
 */
const flags = (o: { own?: boolean; group?: string; payment?: boolean }) => ({ own: o.own ?? (!!o.payment && !o.group), groupKey: o.group ?? null, payment: !!o.payment });
/** (Batch 34 §5) A line's side: the caller's, else its link's page (your own public profile is the side it shows), else the account's (null). */
export const lineSide = (userId: string, link: string, side: Side | null | undefined) => (side !== undefined ? side : sideForPath(link, userId));

/** The email settings that send summaries (anything else is Off). */
const EMAIL_ON = ["daily", "weekly", "monthly"];

export async function notify(to: string, subject0: string, lines0: string[], path: string, opts: Opts = {}, client: Prisma.TransactionClient | typeof db = db) {
  const user = await client.user.findUnique({ where: opts.recipientId ? { id: opts.recipientId } : { email: to }, select: { id: true, timeZone: true, emailPref: true } });
  if (user && opts.about && !opts.payment && !(await inReach(user.id, opts.about))) return; // (Owner, Nov 6, §299) payment lines always reach
  // (Batch 15 section 11) Times in the line are written in the recipient's own time zone (unknown: UTC).
  const subject = renderTimes(subject0, user?.timeZone), lines = lines0.map((l) => renderTimes(l, user?.timeZone));
  if (!user && opts.recipientId) return; // A known account never falls back to a non-account email.
  if (!user) {
    // Not an account (nowhere for a bell or a summary to go): the one email goes at once.
    try {
      // (Batch 30 §19) Not an account: no notification settings to link to.
      await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`].join("\n") /* (Owner, Nov 6, §325) no closing "Playtest" signature */, button: { label: "Open Playtest", url: `${appUrl()}${path}` }, settings: false });
    } catch (e) {
      console.error("[email] failed:", subject, (e as Error).message);
    }
    return;
  }
  // (Owner, Nov 6, §294) `now` (with `always`): the email is sent immediately through sendEmail, the path the admins' chargeback emails take, never queued for
  // the summary or the end-of-day email; the bell line is written as already emailed (summarizedAt), so no later email repeats it. Used for the developer's
  // chargeback emails. (Owner, Nov 6, §299) Also the 15-minute call reminder: it goes at once, before the call, never in a later summary; (§324) with `always`
  // now, so an account with email Off gets it too.
  if (opts.now) {
    await client.notification.create({ data: { side: lineSide(user.id, path, opts.side), userId: user.id, text: subject, link: path, testId: opts.testId ?? (await testIdOfLink(path)), mustEmail: !!opts.always, summarizedAt: new Date(), reminderKey: opts.reminder ?? null, ...flags(opts) } });
    if (!opts.always && !opts.payment && !EMAIL_ON.includes(user.emailPref)) return;
    try {
      await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`].join("\n") /* (Owner, Nov 6, §325) no closing "Playtest" signature */, button: { label: "Open Playtest", url: `${appUrl()}${path}` } });
    } catch (e) {
      console.error("[email] failed:", subject, (e as Error).message);
    }
    return;
  }
  // (Owner, Oct 27) Nothing is emailed right away: the notification waits for the person's email (the summary, or the end-of-day payment email). `always` marks the few
  // that ignore Off (account paused / active again, the team pausing / stopping / closing a test, the owed reminder): they ride in ONE end-of-day email, once.
  await client.notification.create({ data: { side: lineSide(user.id, path, opts.side), userId: user.id, text: subject, link: path, testId: opts.testId ?? (await testIdOfLink(path)), mustEmail: !!opts.always, reminderKey: opts.reminder ?? null, ...flags(opts) } });
}

/**
 * A notification written straight to the bell (no immediate email, and no email text of its own), e.g. the Open until heads-ups. Like every line it is in the
 * person's Daily / Weekly / Monthly summary; with `always` or `payment` it also reaches the end-of-day email with email Off.
 */
export async function bell(userId: string, text0: string, link: string, about?: string, opts: Pick<Opts, "own" | "testId" | "group" | "payment" | "reminder" | "always" | "side"> = {}) {
  if (about && !opts.payment && !(await inReach(userId, about))) return; // (Owner, Nov 6, §299) payment lines always reach
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
  return db.user.findMany({ where: { deletedAt: null, devSuspendedAt: null, testerSuspendedAt: null, OR: [{ isAdmin: true }, ...(listed.length ? [{ email: { in: listed }, emailVerifiedAt: { not: null } }] : [])] }, select: { id: true, email: true, emailVerifiedAt: true } });
}

/**
 * (Owner, Nov 6, §299) Where the team's emails go (Contact us, and the chargeback emails sent to the team at once): every admin account's email (adminUsers(): not
 * deleted, not suspended), confirmed addresses only, plus every ADMIN_EMAILS address, so nothing set on a deploy is lost; each address once (any case). Never
 * the old team@playtest.local placeholder: with no admin account and no ADMIN_EMAILS it is empty and the reason is logged (`what` names the email).
 */
export async function teamEmails(what: string) {
  const out = new Map<string, string>();
  for (const a of await adminUsers()) if (a.emailVerifiedAt && !out.has(a.email.toLowerCase())) out.set(a.email.toLowerCase(), a.email);
  for (const e of (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!out.has(e.toLowerCase())) out.set(e.toLowerCase(), e);
  if (!out.size) console.error(`[email] ${what}: not sent: no admin account with a confirmed email and no ADMIN_EMAILS address to send it to.`);
  return [...out.values()];
}

/**
 * (Owner, Oct 26-27) Email is Off, or On with Daily / Weekly / Monthly. EVERY email is ONE email listing all the notifications since the last one, and each
 * notification is emailed at most once (it is marked summarized when it goes). People on Weekly or Monthly also get an end-of-day email holding only their payment
 * lines (and the must-send ones); the rest wait for their normal email. (Owner, Oct 29, batch 28 §18) On Off, the payment lines and the few must-send lines (mustEmail)
 * go in ONE end-of-day email ("Your Playtest payment updates", or "account updates" when it holds a must-send line that isn't about a payment); nothing else.
 * The daily job runs this once a day, after every notification of the day exists.
 */
/**
 * (Owner, Oct 29, batch 29 §34) The email's lines; the testers' deadline reminders stack under one "Deadlines · 2 tests" heading, as in the bell (§27). (Owner, Nov 5,
 * §201) So do the developer's receipts: "Paid · 3 payments" with each "You paid …" line under it (in the end-of-day payment email and the summary alike). A kind
 * with one line keeps its plain line, as in the bell.
 */
// (Owner, Nov 6, §286) Call requests and booked calls stack in the email as in the bell. (§295) So do the tester's pauses ("Pauses · 2").
// (Owner, Nov 6, §298) EVERY bell stack stacks in the email, the same way: the email groups its lines with bellStacks, the very function the Notifications page uses
// (same key: own lines alone, a `groupKey` across tests, else same test; one stack per day in the account's zone). A stack of 2+ lines is one heading line, the
// bell's title without its day ("Disputes · 3 new", "Excerpts · 2 updates", "Harbor Run · 4 updates"), with its lines under it; a line alone in the bell (own, or a
// single line) stays a single line.
export type EmailItem = { text: string; link: string; groupKey: string | null; testId: string | null; id: string; own: boolean; createdAt: Date };
export function emailLines<N extends EmailItem>(items: N[], line: (n: N) => string, timeZone?: string | null, titles: Map<string, string> = new Map()) {
  const out: string[] = [];
  for (const s of bellStacks(items, timeZone, (id) => titles.get(id))) {
    if (s.lines.length < 2) out.push(line(s.lines[0]));
    else out.push(`• ${stackHeading(s)}`, ...s.lines.map((x) => `  ${line(x)}`));
  }
  return out;
}
/** (§298) The names of the tests these lines are about, for the bell's and the email's per-test stack titles. */
export async function testTitlesOf(items: { testId: string | null }[]) {
  const ids = [...new Set(items.map((n) => n.testId).filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  return new Map((await db.test.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]));
}

/**
 * (Owner, Oct 30, batch 34 §5) Still one email per account; with both sides, its lines sit under "Your account" (the account's own lines), "As a developer"
 * and "As a tester" headings (a heading only when it has lines). An account with one side keeps the plain list.
 */
export const SIDE_HEADINGS = { account: "Your account", developer: "As a developer", tester: "As a tester" } as const;
function sidedEmailLines<N extends EmailItem & { side: string | null }>(items: N[], line: (n: N) => string, both: boolean, timeZone: string | null | undefined, titles: Map<string, string>) {
  if (!both) return emailLines(items, line, timeZone, titles);
  const out: string[] = [];
  for (const [side, heading] of [[null, SIDE_HEADINGS.account], ["developer", SIDE_HEADINGS.developer], ["tester", SIDE_HEADINGS.tester]] as const) {
    const part = items.filter((n) => (n.side === "developer" || n.side === "tester" ? n.side : null) === side);
    if (part.length) out.push(...(out.length ? [""] : []), heading, ...emailLines(part, line, timeZone, titles));
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

/**
 * (Owner, Nov 6, §295) The summary's heading, the first line of its body, in the account's time zone, following the email's period: a Daily summary and every
 * end-of-day email (email Off, or the payment lines of a Weekly / Monthly account) "Your Playtest updates for Fri, Nov 6" (the day it goes); a Weekly one the
 * days it covers, from its real start (the last summary, or its oldest line) to now, "Your Playtest updates for Nov 1 – Nov 7"; a Monthly one the month,
 * "Your Playtest updates for October", when it covers exactly one calendar month (from the 1st to that month's last day, or to the next month's 1st when the
 * daily job sends it that morning), else its days as Weekly's. Days of different years carry the year ("Dec 28, 2026 – Jan 4, 2027").
 * (Owner, Nov 6, §297) `afterLast`: `since` is when the last summary went, so the range starts the day AFTER it, in the account's zone (last sent Oct 31: "Nov 1 –
 * Nov 7", not "Oct 31 – Nov 7"; last sent Sep 30: "October" when it covers that month). With no earlier summary it starts at the oldest line's day, as before.
 */
export const SUMMARY_HEADING = "Your Playtest updates for";
export function summaryHeading(period: "daily" | "weekly" | "monthly", since: Date, now: Date, timeZone?: string | null, afterLast = false) {
  const timeZone0 = safeZone(timeZone);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { ...o, timeZone: timeZone0 });
  if (period === "daily") return `${SUMMARY_HEADING} ${fmt(now, { weekday: "short", month: "short", day: "numeric" })}`;
  const ymd = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timeZone0, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
  };
  const b = ymd(now);
  const a = ((d) => {
    if (!afterLast) return d;
    const next = new Date(Date.UTC(d.y, d.m - 1, d.d + 1)); // (§297) the calendar day after the last summary's
    return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
  })(ymd(since));
  // The first day (a calendar date, formatted in UTC so it reads as that day).
  const start = new Date(Date.UTC(a.y, a.m - 1, a.d, 12));
  if (period === "monthly" && a.d === 1) {
    const last = new Date(Date.UTC(a.y, a.m, 0)).getUTCDate(); // that month's last day
    const toLast = b.y === a.y && b.m === a.m && b.d === last;
    const toNextFirst = b.d === 1 && (a.m === 12 ? b.y === a.y + 1 && b.m === 1 : b.y === a.y && b.m === a.m + 1);
    if (toLast || toNextFirst) return `${SUMMARY_HEADING} ${start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`;
  }
  // One day (or, (§297) a window starting after today: a second summary the same day) reads as today alone.
  if (a.y * 10000 + a.m * 100 + a.d >= b.y * 10000 + b.m * 100 + b.d) return `${SUMMARY_HEADING} ${fmt(now, { month: "short", day: "numeric" })}`;
  const o: Intl.DateTimeFormatOptions = a.y !== b.y ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" };
  return `${SUMMARY_HEADING} ${start.toLocaleDateString("en-US", { ...o, timeZone: "UTC" })} – ${fmt(now, o)}`;
}

/**
 * (Owner, Nov 6, §306) ONE end-of-day email per admin. The team's daily admin email ("Playtest admin: N items for the team") is gone: what it held is the "For the
 * team" section (adminDaily.ts) at the bottom of the admin's own email, under their own updates (stacked as the bell, §298). It follows the admin's email setting
 * exactly as the admin email did: Daily / Weekly / Monthly, in the summary when it is due (everything since the admin's last section); none with Off, whose
 * end-of-day email (payment and must-send lines only) never carries it. The team's items still reach the team: every admin's bell and the console show them,
 * and every admin on Daily / Weekly / Monthly gets them by email. A dispute or hold lift listed in "For the team" is not repeated among that email's own lines
 * (its "Disputes · N new" / "Hold lifts waiting" bell line stays in the bell, and is marked as emailed); one not listed there (e.g. a dispute decided since)
 * stays in the own lines. Non-admins are unchanged.
 */
const DISPUTE_LINK = "/admin#dispute-", LIFT_LINK = "/admin#lift-";
const inTeam = (n: { groupKey: string | null; link: string }, t: { disputeIds: Set<string>; liftIds: Set<string> } | undefined) =>
  !!t && ((n.groupKey === "admindisputes" && n.link.startsWith(DISPUTE_LINK) && t.disputeIds.has(n.link.slice(DISPUTE_LINK.length))) || (n.groupKey === "adminlifts" && n.link.startsWith(LIFT_LINK) && t.liftIds.has(n.link.slice(LIFT_LINK.length))));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function sendSummaries(now = new Date(), only?: string[]) {
  const admins = new Set((await adminUsers()).map((a) => a.id).filter((id) => !only || only.includes(id)));
  const users = await db.user.findMany({
    where: {
      ...(only ? { id: { in: only } } : {}),
      OR: [{ notifications: { some: { summarizedAt: null, ...({ OR: [{ mustEmail: true }, { payment: true }, { user: { emailPref: { in: ["daily", "weekly", "monthly"] } } }] } as object) } } }, ...(admins.size ? [{ id: { in: [...admins] } }] : [])],
    },
    select: { id: true, email: true, emailPref: true, lastSummaryAt: true, isDeveloper: true, isTester: true, timeZone: true },
  });
  const line = (n: { text: string; link: string }) => `• ${n.text}${n.link ? ` ${appUrl()}${n.link}` : ""}`;
  // (§306) The "For the team" section of each admin whose summary is due (Off is never due).
  const isDue = (u: (typeof users)[number]) => EMAIL_ON.includes(u.emailPref) && summaryDue(u.emailPref, u.lastSummaryAt, now);
  const ad = await import("./adminDaily");
  const team = await ad.teamSections(users.filter((u) => admins.has(u.id) && isDue(u)).map((u) => u.id), now);
  for (const u of users) {
    const off = !["daily", "weekly", "monthly"].includes(u.emailPref);
    const due = !off && summaryDue(u.emailPref, u.lastSummaryAt, now);
    const only = due ? {} : { OR: [{ payment: true }, { mustEmail: true }] };
    if (!off && !due && u.emailPref === "daily") continue; // (a daily person is not due again yet)
    const t = due ? team.get(u.id) : undefined;
    const fetched = await db.notification.findMany({ where: { userId: u.id, summarizedAt: null, ...only }, orderBy: { createdAt: "asc" }, take: 200 });
    // (§306) The admin's own lines, without those the team section lists.
    const repeats = fetched.filter((n) => inTeam(n, t)).map((n) => n.id);
    const all = fetched.filter((n) => !repeats.includes(n.id));
    const teamN = t ? ad.teamCount(t) : 0;
    if (!all.length && !teamN) {
      if (t) await ad.teamSent([u.id], [], now); // (as the admin email: looked at, nothing to send)
      continue;
    }
    // (Owner, Oct 27) Reminders go in the summary email too, each line once. A Weekly or Monthly email shows only the newest copy of each reminder (the older copies are marked done).
    const newest = new Map<string, string>();
    if (due && (u.emailPref === "weekly" || u.emailPref === "monthly")) for (const n of all) if (n.reminderKey) newest.set(`${n.side}:${n.reminderKey}`, n.id);
    const items = all.filter((n) => !n.reminderKey || !newest.has(`${n.side}:${n.reminderKey}`) || newest.get(`${n.side}:${n.reminderKey}`) === n.id);
    const dropped = all.filter((n) => !items.includes(n)).map((n) => n.id);
    try {
      // (§306) An admin's: "Your Playtest summary: 2 updates, 3 items for the team" (either part alone when the other is empty).
      const subject = due
        ? `Your Playtest summary: ${[...(items.length ? [plural(items.length, "update")] : []), ...(teamN ? [`${plural(teamN, "item")} for the team`] : [])].join(", ")}`
        : off && items.some((n) => !n.payment) ? `Your Playtest account updates: ${items.length}` : `Your Playtest payment updates: ${items.length}`;
      // (Owner, Nov 6, §295) The body opens with its heading, above the sections or the lines: a due Weekly / Monthly summary names its period (from the last
      // summary, or its oldest line, to now), a Daily one and every end-of-day email the day. (Owner, Nov 6, §297) From the day after the last summary.
      const period = due && (u.emailPref === "weekly" || u.emailPref === "monthly") ? u.emailPref : "daily";
      const heading = summaryHeading(period, u.lastSummaryAt ?? all[0]?.createdAt ?? now, now, u.timeZone, !!u.lastSummaryAt);
      const own = sidedEmailLines(items, line, hasBoth(u), u.timeZone, await testTitlesOf(items));
      const forTeam = t && teamN ? [...(own.length ? [""] : []), ad.TEAM_HEADING, ...ad.teamLines(t, u.timeZone)] : [];
      // (§306) With the team's section, the admin email's button: Open the admin console.
      await sendEmail({ to: u.email, subject, text: [heading, "", ...own, ...forTeam].join("\n") /* (§325) no closing signature */, button: { label: forTeam.length ? "Open the admin console" : "Open Playtest", url: `${appUrl()}${forTeam.length ? "/admin" : "/app/notifications"}` }, heading });
      await db.notification.updateMany({ where: { id: { in: [...items.map((n) => n.id), ...dropped, ...repeats] } }, data: { summarizedAt: now } });
      if (due) await db.user.update({ where: { id: u.id }, data: { lastSummaryAt: now } });
      if (t) await ad.teamSent([u.id], t.noShowIds, now);
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
  const zone = (await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } }))?.timeZone;
  return new Set(unread.map((n) => bellKeyIn(n, zone))).size;
}
