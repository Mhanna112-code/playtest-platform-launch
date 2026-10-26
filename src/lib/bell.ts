// (Design doc 9; owner, Oct 26) The bell stacks same-day lines about the same test into one entry, EXCEPT lines that always arrive on their own
// (`own`: admin decisions, a test stopped, payment failures and holds starting, a hold or pause lifted, a chargeback) and lines about no test.
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function bellKey(n: { id: string; testId: string | null; own: boolean; createdAt: Date }) {
  return n.testId && !n.own ? `${n.testId}|${dayKey(n.createdAt)}` : `solo|${n.id}`;
}
