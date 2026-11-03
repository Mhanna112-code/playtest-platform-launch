import type { Payment, Prisma } from "@prisma/client";
import { additionsOf } from "@/lib/additions";

/** §107: only a settled Pay (or an owed decline) is a review. The reservation lives on Payment. */
export async function recordReviewDraft(p: Payment, tx: Prisma.TransactionClient) {
  const where = p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId! };
  const existing = await tx.review.findFirst({ where });
  if (existing) return existing; // Existing payments from before §107 keep their original review.
  const draft = p.reviewDraft as { agreedCents: number | null; reason: string; payKey: string; rateCents: number | null } | null;
  if (!draft || !p.contractId) throw new Error("Missing Pay review draft");
  const review = await tx.review.create({ data: { ...where, contractId: p.contractId, amountCents: p.amountCents, agreedCents: draft.agreedCents, reason: draft.reason, payKey: draft.payKey, rateCents: draft.rateCents } });
  if (p.submissionId) await addedWhilePaying(tx, p.submissionId, p.createdAt);
  return review;
}

/**
 * (Owner, Nov 3, races) A tester's addition (§136) that landed while this Pay was in flight (after its reservation, before the review existed) was saved as an
 * addition to unpaid work. Once the Pay is recorded it ends as an addition after a Pay does: the piece's "added to this after you paid" row (paidUpdateAt).
 */
async function addedWhilePaying(tx: Prisma.TransactionClient, submissionId: string, reservedAt: Date) {
  const s = await tx.submission.findUnique({ where: { id: submissionId }, select: { additions: true, paidUpdateAt: true } });
  const late = additionsOf(s?.additions).map((a) => new Date(a.at).getTime()).filter((at) => at > reservedAt.getTime());
  if (!s || !late.length) return;
  const at = new Date(Math.max(...late));
  if (!s.paidUpdateAt || s.paidUpdateAt < at) await tx.submission.update({ where: { id: submissionId }, data: { paidUpdateAt: at } });
}
