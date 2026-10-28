// (Owner, Oct 30, batch 15 section 34) One $1,000 ceiling for ALL of a tester's calls on a test, listed and unlisted together, extra pay counted. It replaces batch 12
// section 2's pool for unlisted calls only. Used = everything paid for that tester's calls on the test (Pay, Pay more, dispute decisions, Charge) plus each booked call
// not paid yet at its reference (rate × length; unlisted: $200/h × length; the booked length until it has been measured).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { callCharge } from "@/lib/rules";
import { CALLS_TOTAL_CENTS, UNLISTED_CALL_RATE_CENTS, callMinutesOf, callsCeilingLine, callsLeftWarning } from "@/lib/callMeasure";
import { HttpError } from "./http";

type Tx = Prisma.TransactionClient;
/** The payment statuses that count as paid or on its way (as pieceRoom counts them). */
const COUNTED = ["charged", "not_set_up", "deferred", "pending", "owed", "needs_action", "needs_confirmation"];

/** One booked call's reference: the listed rate (or $200/h when it isn't listed) × its length (measured or lowered once known, the booked length before). */
export function callRefCents(x: { rateCents: number | null; minutes: number; actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) {
  const m = callMinutesOf(x) ?? x.minutes;
  return x.rateCents == null ? Math.round((UNLISTED_CALL_RATE_CENTS * m) / 60) : callCharge(x.rateCents, m);
}

/** What one tester's calls on this contract use of the $1,000 (`except`: a call whose own unpaid reference isn't counted, the one being paid). */
export async function callsUsedCents(contractId: string, tx: Tx = db, except?: string) {
  const calls = await tx.call.findMany({ where: { contractId }, select: { id: true, status: true, rateCents: true, minutes: true, actualMinutes: true, measuredMinutes: true, measuredAt: true, review: { select: { id: true } } } });
  if (!calls.length) return 0;
  const paid = (await tx.payment.aggregate({ where: { callId: { in: calls.map((c) => c.id) }, kind: { not: "chargeback" }, status: { in: COUNTED } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const reserved = calls.filter((c) => c.status === "booked" && !c.review && c.id !== except).reduce((a, c) => a + callRefCents(c), 0);
  return paid + reserved;
}
export async function callsLeftCents(contractId: string, tx: Tx = db, except?: string) {
  return Math.max(0, CALLS_TOTAL_CENTS - (await callsUsedCents(contractId, tx, except)));
}

/** Booking `count` calls of `minutes` at `rateCents` (null: not listed) would go over the $1,000: refused on both sides with what's left. */
export async function ceilingRefusal(contractId: string, rateCents: number | null, minutes: number, count: number, who: string, tx: Tx = db) {
  const one = rateCents == null ? Math.round((UNLISTED_CALL_RATE_CENTS * minutes) / 60) : callCharge(rateCents, minutes);
  const left = await callsLeftCents(contractId, tx);
  return one * count > left ? callsCeilingLine(who, left) : "";
}
export async function checkCeiling(...a: Parameters<typeof ceilingRefusal>) {
  const line = await ceilingRefusal(...a);
  if (line) throw new HttpError(409, "calls_ceiling", line);
}

/** The small warning line (no stop) wherever calls are requested, offered, accepted or paid: "" when an hour still fits. */
export async function callsWarningFor(c: { id: string; liveRateCents: number | null; test: { liveRateCents: number | null } }, side: "developer" | "tester", testerName: string) {
  const rate = c.test.liveRateCents != null && c.liveRateCents != null ? c.liveRateCents : null;
  return callsLeftWarning(await callsLeftCents(c.id), rate, side, testerName);
}
