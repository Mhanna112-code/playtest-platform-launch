import { db } from "@/lib/db";
import { byTesterChoice } from "@/lib/rules";
import { earnedLimit, type SentPiece } from "@/lib/capacity";

const DAY = 86_400_000;
const WINDOW_DAYS = 14;

/**
 * (NEWEST+9) A developer's tester capacity: their testers' ratings as each showed, and the paid work testers sent them
 * (reviewed by the developer, or missed: the tester was offered Charge / Let it go). Stored as it grows, so it never
 * shrinks.
 */
export async function testerCapacity(developerId: string) {
  const dev = await db.user.findUniqueOrThrow({ where: { id: developerId }, select: { testerLimit: true } });
  const contractIds = (await db.contract.findMany({ where: { test: { developerId } }, select: { id: true } })).map((c) => c.id);
  const [ratings, subs, calls] = await Promise.all([
    // Counted as each shows (ratings.ts): revealed, or 14 days after it was given (no import: tests.ts uses this file).
    db.rating.findMany({ where: { rateeId: developerId, side: "tester", OR: [{ revealedAt: { not: null } }, { createdAt: { lte: new Date(Date.now() - WINDOW_DAYS * DAY) } }] } }),
    db.submission.findMany({ where: { contractId: { in: contractIds } }, include: { review: true } }),
    db.call.findMany({ where: { contractId: { in: contractIds }, review: { isNot: null } }, include: { review: true } }),
  ]);
  const byTester = (reason: string, auto: boolean) => auto || byTesterChoice(reason);
  const pieces: SentPiece[] = [];
  // Paid work only (free parts aren't counted, as in the full app).
  for (const s of subs) {
    if (!s.agreedCents && !s.review?.amountCents) continue;
    if (s.review && !byTester(s.review.reason, s.review.auto)) pieces.push({ reviewedAt: s.review.createdAt, missedAt: null });
    else if (s.choiceOfferedAt || s.review) pieces.push({ reviewedAt: null, missedAt: s.choiceOfferedAt ?? s.review!.createdAt });
  }
  for (const c of calls) {
    if (!c.review || (!c.rateCents && !c.review.amountCents)) continue;
    pieces.push(byTester(c.review.reason, c.review.auto) ? { reviewedAt: null, missedAt: c.review.createdAt } : { reviewedAt: c.review.createdAt, missedAt: null });
  }
  const shown = ratings.map((r) => ({ stars: r.stars, at: r.revealedAt ?? new Date(r.createdAt.getTime() + WINDOW_DAYS * DAY) }));
  const cap = earnedLimit(shown, pieces, dev.testerLimit);
  if (cap.limit > dev.testerLimit) await db.user.updateMany({ where: { id: developerId, testerLimit: { lt: cap.limit } }, data: { testerLimit: cap.limit } });
  return cap;
}
