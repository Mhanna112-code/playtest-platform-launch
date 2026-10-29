// (Design doc 9; owner, Oct 26-27) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
// (`own`: admin decisions, a test stopped, payment lines, a hold or pause lifted, a chargeback) and lines about no test. Lines with a `groupKey` stack
// together on one day even across tests (pending invites, Charge or Let it go, unreviewed work, tests paused or resumed, payout problems, new disputes).
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export const GROUP_TITLES: Record<string, string> = {
  invites: "Invitations waiting",
  charge: "Charge or Let it go",
  unreviewed: "Work waiting for your review",
  paused: "Tests paused or running again",
  payout: "Payout",
  disputes: "New disputes",
  team: "The team acted on your tests",
  // (Owner, Oct 27) Lines of the SAME KIND stack across tests, one entry per kind per day.
  payhold: "Payments and holds",
  admindecision: "The team decided",
  disputefiled: "Disputes filed",
  disputedecided: "Disputes decided",
  pausedreminder: "Paused tests",
  tpaid: "You were paid",
  trejected: "Work not accepted",
  tdelayed: "Payments delayed",
  tarrived: "Delayed payments arrived",
  textra: "Extra pay",
  tstopped: "Tests stopped or ended",
  suspendedreview: "Suspended accounts",
  // (Owner, Oct 29, batch 14 section 3) An edit closed an application / re-sent an invite: these stack across tests too (their entry title counts the tests).
  appclosed: "Applications closed",
  reinvited: "Invites sent again",
  // (Batch 15 section 35) A tester asked for a call.
  callrequests: "Call requests",
  // (Batch 19 section 1) The close-out reminders (3 days and 1 day before a piece closes) stack under a heading too.
  closeout: "Closing soon",
};

/** (Batch 14) A stacked entry's title that says it all with its count ("3 tests you applied to changed: your applications were closed"); else GROUP_TITLES. */
export const GROUP_COUNT_TITLES: Record<string, (n: number) => string> = {
  appclosed: (n) => `${n} tests you applied to changed: your applications were closed`,
  reinvited: (n) => `${n} tests you were invited to changed: your invites were sent again`,
  closeout: (n) => `Closing soon: ${n} test${n === 1 ? "" : "s"}`,
};
export const groupTitle = (key: string, n: number) => GROUP_COUNT_TITLES[key]?.(n) ?? GROUP_TITLES[key];

export function bellKey(n: { id: string; testId: string | null; own: boolean; groupKey?: string | null; createdAt: Date }) {
  if (n.own) return `solo|${n.id}`;
  if (n.groupKey) return `group:${n.groupKey}|${dayKey(n.createdAt)}`;
  return n.testId ? `${n.testId}|${dayKey(n.createdAt)}` : `solo|${n.id}`;
}
