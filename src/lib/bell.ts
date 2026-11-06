import { dayIn } from "./rules";
// (Design doc 9; owner, Oct 26-27) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
// (`own`: admin decisions, a test stopped, payment lines, a hold or pause lifted, a chargeback) and lines about no test. Lines with a `groupKey` stack
// together on one day even across tests (pending invites, Charge or Let it go, unreviewed work, tests paused or resumed, payout problems, and the kinds below).
export const dayKey = (d: Date, timeZone?: string | null) => dayIn(d, timeZone);

export const GROUP_TITLES: Record<string, string> = {
  invites: "Invitations waiting",
  charge: "Charge or Let it go",
  unreviewed: "Work waiting for your review",
  // (Owner, Nov 6, §295) The tester's "“X” is paused" and "“X” is running again", one entry a day across tests: "Pauses · 2".
  paused: "Pauses",
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
  // (Batch 15 section 35) A tester asked for a call. (Owner, Nov 6, §286) Every call-request line on either side (a request received, one withdrawn, declined, taken or
  // closed), one entry a day across tests: "Call requests · 3 today".
  callrequests: "Call requests",
  // (§286) Every booked-call line on either side ("Booked: …"), one entry a day across tests: "Booked calls · 2 today".
  booked: "Booked calls",
  // (§286) The developer added their side to the tester's dispute, one entry a day across tests.
  disputeside: "Sides added to your disputes",
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
  // tester withdrawing her application. (§286) New call-request lines go in "callrequests" instead; "reqclosed" stays for the lines already written.
  // (Owner, Nov 6, §308) New withdrawals go in plain "appwithdrawn", one entry a day ACROSS tests ("Applications withdrawn · 2"); "appwithdrawn:<testId>" stays
  // only for the lines already written.
  reqclosed: "Call requests closed",
  appwithdrawn: "Applications withdrawn",
  // (§308) The developer's "<tester> applied to join" and "<tester> asks to rejoin", one entry a day across tests: "Applications · 3". (The tester's own
  // application and invite lines stay in "apps".)
  applications: "Applications",
  // (Owner, Nov 5, §201) The developer's payments that went through (every receipt line), one entry a day across tests.
  devpaid: "Paid",
  // (Owner, Nov 5, §215) Direct messages (not about a test), one entry a day: "Direct messages · 3 today".
  dms: "Direct messages",
};
/** (§215) The group of every direct-message bell line. */
export const DMS_GROUP = "dms";
/** (§201) The group of every developer receipt line ("You paid $X for …"): "Paid · 3 payments today". */
export const PAID_GROUP = "devpaid";
/** (Owner, Nov 6, §286) Every call-request bell line, both sides, one entry a day across tests (it replaces §185's per-test "reqclosed:<test>" stacks). */
export const CALL_REQUESTS_GROUP = "callrequests";
/** (§286) Every booked-call bell line ("Booked: …"), both sides, one entry a day across tests. */
export const BOOKED_GROUP = "booked";
/**
 * (Owner, Nov 6, §308) The developer's application lines ("<tester> applied to join", "<tester> asks to rejoin"), one entry a day across tests: "Applications · N".
 * The rest of their join-related lines (joined, joined again, left, said no thanks to your invite) are plain per-test lines, in the test's own stack.
 */
export const APPLICATIONS_GROUP = "applications";
/** (§308) The developer's "<tester> withdrew her application" lines, one entry a day across tests: "Applications withdrawn · N". */
export const APP_WITHDRAWN_GROUP = "appwithdrawn";
/** (Owner, Nov 6, §295) The tester's pause lines ("“X” is paused", "“X” is running again"), one entry a day across tests, in the bell and the email alike. */
export const PAUSES_GROUP = "paused";

/** (Batch 14) A stacked entry's title that says it all with its count ("3 tests you applied to changed: your applications were closed"); else GROUP_TITLES. */
// (Owner, Nov 6, §290) No "today" in these titles: the bell page adds the day itself ("today" / "on Nov 5"); it read "· 2 today today".
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
  reqclosed: (_n, lines) => `Call requests · ${lines} closed`,
  // (Owner, Nov 6, §308) "Applications withdrawn · 2" and "Applications · 3" (counting lines, across tests).
  appwithdrawn: (_n, lines) => `Applications withdrawn · ${lines}`,
  applications: (_n, lines) => `Applications · ${lines}`,
  dms: (_n, lines) => `Direct messages · ${lines}`,
  // (Owner, Nov 6, §295) "Pauses · 2" (counting lines: each is a pause or a test running again).
  paused: (_n, lines) => `Pauses · ${lines}`,
  // (Owner, Nov 6, §286) "Call requests · 3 today", "Booked calls · 2 today" (counting lines, across tests).
  callrequests: (_n, lines) => `Call requests · ${lines}`,
  booked: (_n, lines) => `Booked calls · ${lines}`,
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

/**
 * (Owner, Nov 6, §298) The bell's stacks: ONE grouping for the Notifications page and the summary / end-of-day emails, so they can't drift apart. Lines with the
 * same bellKeyIn (in the reader's zone) form one stack, in the order their first line comes. Its title: the group's (groupTitle) for a `groupKey`, the test's
 * name for a per-test stack, none for a line on its own (`own`, or about no test). `counted`: the title already counts (no "· N updates"); `test`: the title is
 * a test's name. A stack of one line shows as that single line, in the bell and the email alike.
 */
export type BellStack<N> = { key: string; lines: N[]; title?: string; counted: boolean; test: boolean };
export function bellStacks<N extends Parameters<typeof bellKeyIn>[0]>(items: N[], timeZone: string | null | undefined, testTitle: (testId: string) => string | undefined): BellStack<N>[] {
  const groups = new Map<string, N[]>();
  for (const n of items) {
    const k = bellKeyIn(n, timeZone);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return [...groups.entries()].map(([key, g]) => {
    const gk = g[0].groupKey;
    return {
      key,
      lines: g,
      title: gk ? groupTitle(gk, new Set(g.map((n) => n.testId ?? n.id)).size, g.length) : g[0].testId ? testTitle(g[0].testId) : undefined,
      counted: !!(gk && GROUP_COUNT_TITLES[groupBase(gk)]), // (§185) "reqclosed:<test>" counts as "reqclosed"
      test: !gk && !!g[0].testId,
    };
  });
}
/** (§298) What follows a stack's title: nothing when the title already counts ("Disputes · 3 new"), else " · N updates" ("Harbor Run · 4 updates"). */
export const stackCount = (s: { counted?: boolean; lines: unknown[] }) => (s.counted ? "" : ` · ${s.lines.length} updates`);
/** (§298) A stack's heading without its day, as the bell shows it (the page adds "today" / "on Nov 5") and the email writes it. */
export const stackHeading = (s: { title?: string; counted?: boolean; lines: unknown[] }) => `${s.title ?? "Updates"}${stackCount(s)}`;

/** Legacy callers group in UTC; page callers supply their viewer zone. */
export const bellKey = (n: Parameters<typeof bellKeyIn>[0]) => bellKeyIn(n);

/**
 * (Owner, Nov 5, §202) A bell line shows its first BELL_LINE_SHOWN (50; §251, was 30) characters, then "…", when it is longer; the whole line opens under it. The cut never
 * splits a word or an amount ("$1,000.00" has no space): inside one, it falls back to the last space before it (a single word longer than that is cut as is).
 * Counted by character, so an emoji is never split. null: the line is short enough to show whole.
 */
export const BELL_LINE_SHOWN = 50; // (Owner, Nov 5, §251; was 30) every bell, payment, confirm and owed line shows its first 50 characters
/**
 * (Owner, Nov 5, batch 35 §246) An opened line (a bell line, a payment row's or a confirm row's "what") shows whole IN PLACE, wrapped, with no box; only a line
 * longer than this (typed notes: the team's hold note, dispute or pause reasons) opens in the draggable box (ResizeBox in OwnPanel). The one place it is set.
 */
export const LINE_BOX_OVER = 200;
/** (§246) Whether an opened line goes in the draggable box: longer than LINE_BOX_OVER characters (counted by character). */
export const opensInBox = (text: string) => Array.from(text).length > LINE_BOX_OVER;
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
