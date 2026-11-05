/**
 * (Owner, Nov 5, batch 35 §226) The cut-off between what the developer has paid for and what is new on a sent part: the review's last payment time.
 *
 * The rule: the latest of
 * - each Pay or Pay more on the part that went through (a Payment of kind "review" or "extra" with status "charged", "not_set_up" or "bundled"), at its
 *   `createdAt`: the press (the reservation), the same moment that decides whether an addition came "after you paid" (reviewDraft's addedWhilePaying, a Pay
 *   more's answerUpdate);
 * - the review itself (`createdAt`) when nothing was charged by it: a $0 Pay, an old rejection, the team's $0 closure, or a review whose payment has not gone
 *   through (owed, declined);
 * - a Pay more at $0 that closed an update (`paidUpdateZeroAt`).
 * Null before the part was first paid: everything sent counts as new. A dispute decided by the team is not a Pay or Pay more and doesn't move it.
 * Additions (and changed-questions sends) carry their own `at`; one at or before the cut-off is paid for, one after it is new.
 */
export const PAID_STATUSES = ["charged", "not_set_up", "bundled"];

type Sub = { id: string; review?: { amountCents: number; createdAt: Date } | null; paidUpdateZeroAt?: Date | null };
type Pay = { submissionId: string | null; kind: string; status: string; createdAt: Date };

export function lastPaidAt(sub: Sub, payments: Pay[]): Date | null {
  if (!sub.review) return null;
  const paid = payments.filter((p) => p.submissionId === sub.id && (p.kind === "review" || p.kind === "extra") && PAID_STATUSES.includes(p.status)).map((p) => p.createdAt.getTime());
  const times = [...paid];
  if (sub.review.amountCents === 0 || !payments.some((p) => p.submissionId === sub.id && p.kind === "review" && PAID_STATUSES.includes(p.status))) times.push(sub.review.createdAt.getTime());
  if (sub.paidUpdateZeroAt) times.push(sub.paidUpdateZeroAt.getTime());
  return new Date(Math.max(...times));
}
