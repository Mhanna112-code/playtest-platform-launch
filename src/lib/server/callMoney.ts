// (Owner, Oct 30, batch 15 section 34) One $500 ceiling for ALL of a tester's calls on a test, listed and unlisted together, extra pay counted. It replaces batch 12
// section 2's pool for unlisted calls only. Used = everything paid for that tester's calls on the test (Pay, Pay more, dispute decisions, Charge) plus each booked call
// not paid yet at its reference (rate × length; unlisted: $200/h × length; the booked length until it has been measured).
// (Owner, Nov 6, §280) Booking is no longer checked against it (ceilingRefusal / checkCeiling are gone): requests, offers, sets and Accept never refuse or cut a call
// for the $500. What's left still ends a call in the call room (calls.ts, callCapMinutes), caps Pay and Pay more, and shows the small warning line.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { callCharge } from "@/lib/rules";
import { CALLS_TOTAL_CENTS, UNLISTED_CALL_RATE_CENTS, callMinutesOf, callsLeftWarning } from "@/lib/callMeasure";

type Tx = Prisma.TransactionClient;
/** The payment statuses that count as paid or on its way (as pieceRoom counts them). */
const COUNTED = ["charged", "not_set_up", "deferred", "pending", "owed", "needs_action", "needs_confirmation"];

/** One booked call's reference: the listed rate (or $200/h when it isn't listed) × its length (measured or lowered once known, the booked length before). */
export function callRefCents(x: { rateCents: number | null; minutes: number; actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) {
  const m = callMinutesOf(x) ?? x.minutes;
  return x.rateCents == null ? Math.round((UNLISTED_CALL_RATE_CENTS * m) / 60) : callCharge(x.rateCents, m);
}

/**
 * What one tester's calls on this contract use of the $500 (`except`: a call whose own unpaid reference isn't counted, the one being paid). `before` (Owner, Nov 6,
 * §280): only booked calls that start before it reserve their reference (the call room's end: calls booked later haven't used anything yet, and booking no longer
 * keeps them within the $500, so they must not cut short the call in progress).
 */
export async function callsUsedCents(contractId: string, tx: Tx = db, except?: string, before?: Date) {
  const calls = await tx.call.findMany({ where: { contractId }, select: { id: true, status: true, startsAt: true, rateCents: true, minutes: true, actualMinutes: true, measuredMinutes: true, measuredAt: true, review: { select: { id: true } } } });
  if (!calls.length) return 0;
  const paid = (await tx.payment.aggregate({ where: { callId: { in: calls.map((c) => c.id) }, kind: { not: "chargeback" }, status: { in: COUNTED } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const reserved = calls.filter((c) => c.status === "booked" && !c.review && c.id !== except && (!before || c.startsAt.getTime() < before.getTime())).reduce((a, c) => a + callRefCents(c), 0);
  return paid + reserved;
}
export async function callsLeftCents(contractId: string, tx: Tx = db, except?: string, before?: Date) {
  return Math.max(0, CALLS_TOTAL_CENTS - (await callsUsedCents(contractId, tx, except, before)));
}

/** The small warning line (no stop) wherever calls are requested, offered, accepted or paid: "" when an hour still fits. */
export async function callsWarningFor(c: { id: string; liveRateCents: number | null; test: { liveRateCents: number | null } }, side: "developer" | "tester", testerName: string) {
  const rate = c.test.liveRateCents != null && c.liveRateCents != null ? c.liveRateCents : null;
  return callsLeftWarning(await callsLeftCents(c.id), rate, side, testerName);
}
