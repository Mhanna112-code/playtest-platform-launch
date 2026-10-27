// (Design doc 9; owner, Oct 26) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
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
  owed: "Payment due",
};

export function bellKey(n: { id: string; testId: string | null; own: boolean; groupKey?: string | null; createdAt: Date }) {
  if (n.own) return `solo|${n.id}`;
  if (n.groupKey) return `group:${n.groupKey}|${dayKey(n.createdAt)}`;
  return n.testId ? `${n.testId}|${dayKey(n.createdAt)}` : `solo|${n.id}`;
}
