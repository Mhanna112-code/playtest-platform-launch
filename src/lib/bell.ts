// (Design doc 9; owner, Oct 26-27) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
// (`own`: admin decisions, a test stopped, payment lines, a hold or pause lifted, a chargeback) and lines about no test. Lines with a `groupKey` stack
// together on one day even across tests (pending invites, Charge or Let it go, unreviewed work, tests paused or resumed, payout problems, and the kinds below).
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

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
};

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
};
/** A stacked entry's title: `n` = the tests it covers, `lines` = its lines. */
export const groupTitle = (key: string, n: number, lines = n) => GROUP_COUNT_TITLES[key]?.(n, lines) ?? GROUP_TITLES[key];

export function bellKey(n: { id: string; testId: string | null; own: boolean; groupKey?: string | null; createdAt: Date }) {
  if (n.own) return `solo|${n.id}`;
  if (n.groupKey) return `group:${n.groupKey}|${dayKey(n.createdAt)}`;
  return n.testId ? `${n.testId}|${dayKey(n.createdAt)}` : `solo|${n.id}`;
}
