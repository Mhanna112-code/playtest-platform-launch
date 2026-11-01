import type { Payment, Prisma } from "@prisma/client";

/** §107: only a settled Pay (or an owed decline) is a review. The reservation lives on Payment. */
export async function recordReviewDraft(p: Payment, tx: Prisma.TransactionClient) {
  const where = p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId! };
  const existing = await tx.review.findFirst({ where });
  if (existing) return existing; // Existing payments from before §107 keep their original review.
  const draft = p.reviewDraft as { agreedCents: number | null; reason: string; payKey: string; rateCents: number | null } | null;
  if (!draft || !p.contractId) throw new Error("Missing Pay review draft");
  return tx.review.create({ data: { ...where, contractId: p.contractId, amountCents: p.amountCents, agreedCents: draft.agreedCents, reason: draft.reason, payKey: draft.payKey, rateCents: draft.rateCents } });
}
