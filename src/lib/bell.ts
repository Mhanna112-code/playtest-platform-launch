import { dayIn } from "./rules";
// (Design doc 9; owner, Oct 26-27) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
// (`own`: admin decisions, a test stopped, payment lines, a hold or pause lifted, a chargeback) and lines about no test. Lines with a `groupKey` stack
// together on one day even across tests (pending invites, Charge or Let it go, unreviewed work, tests paused or resumed, payout problems, and the kinds below).
export const dayKey = (d: Date, timeZone?: string | null) => dayIn(d, timeZone);

export const GROUP_TITLES: Record<string, string> = {
  invites: "Invitations waiting",
  charge: "Charge or Let it go",
  unreviewed: "Work waiting for your review",
  paused: "Tests paused or running again",
  payout: "Payout",
  // (Owner, Oct 27) Lines of the SAME KIND stack across tests, one entry per kind per day.
  payhold: "Payments and holds",
  admindecision: "The team decided",
  disputefiled: "Disputes filed",
  disputedecided: "Disputes decided",
  pausedreminder: "Paused tests",
  tpaid: "You were paid",
  tdelayed: "Payments delayed",
  tarrived: "Delayed payments arrived",
  tstopped: "Tests stopped or ended",
  suspendedreview: "Suspended accounts",
  // (Batch 15 section 35) A tester asked for a call.
  callrequests: "Call requests",
  // (Batch 19 section 1) The close-out reminders (3 days and 1 day before a piece closes) stack under a heading too.
  closeout: "Closing soon",
  // (Owner, Oct 29, batch 29 §21-29, §33) More lines of one kind stack across tests, one entry per kind per day.
  ratings: "Ratings to give",
  apps: "Applications and invites",
  joined: "Joined",
  newterms: "New terms to answer",
  excerpts: "Excerpts",
  deadlines: "Deadlines",
  admindisputes: "Disputes",
  adminreports: "Reports",
  adminlifts: "Hold lifts waiting",
  // (Owner, Nov 4, §185) Per test and day ("reqclosed:<testId>", "appwithdrawn:<testId>"): call requests the other side withdrew or that a booking closed; a
  // tester withdrawing her application.
  reqclosed: "Call requests closed",
  appwithdrawn: "Applications withdrawn",
  // (Owner, Nov 5, §201) The developer's payments that went through (every receipt line), one entry a day across tests.
  devpaid: "Paid",
  // (Owner, Nov 5, §215) Direct messages (not about a test), one entry a day: "Direct messages · 3 today".
  dms: "Direct messages",
};
/** (§215) The group of every direct-message bell line. */
export const DMS_GROUP = "dms";
/** (§201) The group of every developer receipt line ("You paid $X for …"): "Paid · 3 payments today". */
export const PAID_GROUP = "devpaid";

/** (Batch 14) A stacked entry's title that says it all with its count ("3 tests you applied to changed: your applications were closed"); else GROUP_TITLES. */
export const GROUP_COUNT_TITLES: Record<string, (n: number, lines: number) => string> = {
  closeout: (n) => `Closing soon: ${n} test${n === 1 ? "" : "s"}`,
  // (Batch 29 §25, §27) "New terms to answer · 2 tests", "Deadlines · 2 tests".
  newterms: (n) => `New terms to answer · ${n} test${n === 1 ? "" : "s"}`,
  deadlines: (n) => `Deadlines · ${n} test${n === 1 ? "" : "s"}`,
  // (Batch 29 §29) The admin's: "Disputes · 3 new", "Reports · 2 new", "Hold lifts waiting · 1" (counting lines).
  admindisputes: (_n, lines) => `Disputes · ${lines} new`,
  adminreports: (_n, lines) => `Reports · ${lines} new`,
  adminlifts: (_n, lines) => `Hold lifts waiting · ${lines}`,
  // (Owner, Nov 4, §185) "Call requests · 3 closed today", "Applications · 2 withdrawn today" (one stack per test and day).
  reqclosed: (_n, lines) => `Call requests · ${lines} closed today`,
  appwithdrawn: (_n, lines) => `Applications · ${lines} withdrawn today`,
  dms: (_n, lines) => `Direct messages · ${lines} today`,
  // (Owner, Nov 5, §201) "Paid · 3 payments" (counting lines: each receipt line is one payment; a Confirm all line is one payment on the card).
  devpaid: (_n, lines) => `Paid · ${lines} payment${lines === 1 ? "" : "s"}`,
};
/** (§185) A group key may name its test after a colon ("reqclosed:<testId>": one stack per test and day); its titles are the part before it. */
export const groupBase = (key: string) => key.split(":")[0];
/** A stacked entry's title: `n` = the tests it covers, `lines` = its lines. */
export const groupTitle = (key: string, n: number, lines = n) => GROUP_COUNT_TITLES[groupBase(key)]?.(n, lines) ?? GROUP_TITLES[groupBase(key)];

export function bellKeyIn(n: { id: string; testId: string | null; own: boolean; groupKey?: string | null; createdAt: Date }, timeZone?: string | null) {
  if (n.own) return `solo|${n.id}`;
  if (n.groupKey) return `group:${n.groupKey}|${dayKey(n.createdAt, timeZone)}`;
  return n.testId ? `${n.testId}|${dayKey(n.createdAt, timeZone)}` : `solo|${n.id}`;
}

/** Legacy callers group in UTC; page callers supply their viewer zone. */
export const bellKey = (n: Parameters<typeof bellKeyIn>[0]) => bellKeyIn(n);

/**
 * (Owner, Nov 5, §202) A bell line shows its first BELL_LINE_SHOWN (30) characters, then "…", when it is longer; the whole line opens under it. The cut never
 * splits a word or an amount ("$1,000.00" has no space): inside one, it falls back to the last space before it (a single word longer than that is cut as is).
 * Counted by character, so an emoji is never split. null: the line is short enough to show whole.
 */
export const BELL_LINE_SHOWN = 30;
export function bellShort(text: string, n = BELL_LINE_SHOWN): string | null {
  const chars = Array.from(text);
  if (chars.length <= n) return null;
  let head = chars.slice(0, n);
  if (!/\s/.test(chars[n]) && !/\s/.test(head[n - 1])) {
    let i = head.length - 1;
    while (i > 0 && !/\s/.test(head[i])) i--;
    if (i > 0) head = head.slice(0, i);
  }
  return `${head.join("").trimEnd().replace(/[,:;(“"]+$/, "").trimEnd()}…`;
}
