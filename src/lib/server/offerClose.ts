import type { Prisma } from "@prisma/client";

/**
 * (Owner, Nov 2, batch 35 §118) When a part ends (rated, left, removed, stopped, ended early, blocked, the work window ended), its open new-terms offer(s) close:
 * no Switch / Keep for the tester any more, and the developer's view shows the offer closed. Called wherever a contract stops being "working", inside that
 * change's transaction when there is one.
 */
export async function closeOffersOfEnded(tx: Pick<Prisma.TransactionClient, "termsOffer">, contractIds: string[], at = new Date()) {
  if (!contractIds.length) return 0;
  return (await tx.termsOffer.updateMany({ where: { contractId: { in: contractIds }, status: "open" }, data: { status: "closed", decidedAt: at } })).count;
}
