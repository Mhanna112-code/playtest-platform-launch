// (NEWEST+9) How many testers a developer's test can take (its spots), ported from the full app (src/lib/tester-limit.ts
// there) and adapted to lean data. Every developer starts at 10. Each batch of 10 new ratings from testers (counted as
// each rating shows) raises it by 10% (rounded up, at least 1: 10 -> 11 -> 13 -> 15 ...) up to 50, when either at least
// half of that batch is 3 stars or more, or the developer reviewed at least 90% of the work testers sent them themselves
// (as that batch completed): Pay, partial pay and Reject count; a tester's Charge or Let it go after the review window
// doesn't. A batch that meets neither doesn't raise it. It never shrinks; tests already above it keep their spots.
export const BASE_LIMIT = 10;
export const MAX_LIMIT = 50;
export const RATINGS_PER_STEP = 10;
export const GOOD_RATINGS = 5;
export const GOOD_STARS = 3;
export const GOOD_REVIEW_RATE = 0.9;

/** One step up: 10% of the limit, rounded up, at least 1. */
export const step = (limit: number) => Math.max(1, Math.ceil(limit * 0.1));

/** A piece of paid work a tester sent: reviewed by the developer (at), or missed (the tester had to Charge / Let it go). */
export type SentPiece = { reviewedAt: Date | null; missedAt: Date | null };

/** The developer's review rate as of `asOf`: reviewed / (reviewed + missed); null with neither. */
export function reviewRate(pieces: SentPiece[], asOf: Date | null = null) {
  let reviewed = 0, missed = 0;
  for (const p of pieces) {
    if (p.missedAt && (!asOf || p.missedAt <= asOf)) missed++;
    else if (p.reviewedAt && (!asOf || p.reviewedAt <= asOf)) reviewed++;
  }
  return reviewed + missed ? reviewed / (reviewed + missed) : null;
}

export type Capacity = { limit: number; ratings: number; nextIn: number | null };

/** The limit from the ratings as they showed and the pieces (review rate as each batch completed); `floor`: the most earned before. */
export function earnedLimit(ratings: { stars: number; at: Date }[], pieces: SentPiece[], floor = BASE_LIMIT): Capacity {
  const shown = [...ratings].sort((a, b) => a.at.getTime() - b.at.getTime());
  let limit = BASE_LIMIT;
  for (let i = RATINGS_PER_STEP; i <= shown.length; i += RATINGS_PER_STEP) {
    const batch = shown.slice(i - RATINGS_PER_STEP, i);
    const good = batch.filter((r) => r.stars >= GOOD_STARS).length >= GOOD_RATINGS;
    const rate = reviewRate(pieces, batch[batch.length - 1].at);
    if (good || (rate ?? 0) >= GOOD_REVIEW_RATE) limit = Math.min(MAX_LIMIT, limit + step(limit));
  }
  limit = Math.min(MAX_LIMIT, Math.max(limit, floor)); // never shrinks
  return { limit, ratings: shown.length, nextIn: limit >= MAX_LIMIT ? null : RATINGS_PER_STEP - (shown.length % RATINGS_PER_STEP) };
}

/** The card's lines (the full app's "Can take up to N testers per test" block, as the developer sees it). */
export function capacityCard(c: Capacity) {
  return {
    limit: `Can take up to ${c.limit} testers per test`,
    next: c.nextIn == null ? "The most that can be earned" : `Next: +10% after ${c.nextIn} more rating${c.nextIn === 1 ? "" : "s"}`,
    rule: `It grows by 10% (at least 1 more) after every ${RATINGS_PER_STEP} new ratings, when at least half of them are ${GOOD_STARS} stars or more, or you've reviewed at least 90% of the work testers sent you yourself (partial pay and $0 count as reviews; a tester's Charge or Let it go doesn't); up to ${MAX_LIMIT}. Tests already above it keep their spots.`,
  };
}

/** Next to the spots field (the full app's hint). */
export const limitHint = (limit: number) => `Limit: ${limit} testers per test (it grows as testers rate you and you review their work).`;
/** Spots above the limit: red at the field, and the server's refusal. */
export const overLimitText = (limit: number) => `You can take up to ${limit} testers per test right now.`;
