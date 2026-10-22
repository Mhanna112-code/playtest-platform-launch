import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { CHARGED_BY_TESTER, LET_GO_BY_TESTER, stopOnce, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { asLines, ownChanges, seenOf, tabOf, testerPaymentChanges, withRenamed } from "./live";

// The tester's ONE set of stop-once reasons (owner rule, NEWEST+3), used by every tester button on the session page:
// Switch / Keep, Send written, Send recording, Charge / Let it go, Dispute, Leave, Block, Request a time, Accept /
// Decline / Withdraw, Cancel call. Since the page loaded (or since the live top notice last showed changes):
// (A) new terms; (B) the developer paid or rejected work; (C) the developer's call changes: their requests (new,
// withdrawn, taken by another tester, closed), accepting or auto-matching the tester's own request, declining it,
// cancelling a call; (E) anything the tester did themselves in another tab; (F) the listing's info changed.
// Final refusals (ended early, stopped, Open until passed, already decided, holds) are checked separately and stay final.

/** Closed because of the tester's own press (their own action, reason E). */
const CLOSED_BY_TESTER = new Set(["you asked a different rate", "the tester left"]);

export async function testerChanges(testerId: string, contractId: string, testId: string, seenAt: Date, tab = ""): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  const [offers, reviews, calls, devReqs, mine] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: seenAt } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: seenAt }, reason: { notIn: [CHARGED_BY_TESTER, LET_GO_BY_TESTER] } }, include: { submission: true } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: seenAt }, cancelledBy: { not: "tester" } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: seenAt } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: { in: ["booked", "declined"] }, decidedAt: { gt: seenAt } } }),
  ]);
  const out: TestEventLike[] = [];
  for (const o of offers) out.push({ kind: "terms", text: `${dev} offered new terms: ${o.diff}`, createdAt: o.createdAt });
  const owed = await db.payment.findMany({ where: { contractId, status: "failed", owedUntil: { not: null }, settledAt: null }, select: { submissionId: true, callId: true } });
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  const settledLate = await db.payment.findMany({ where: { contractId, settledAt: { not: null } }, select: { submissionId: true, callId: true } });
  const lateKeys = new Set(settledLate.map((p) => p.submissionId ?? p.callId));
  for (const r of reviews) {
    // Owed (or paid late): the "delayed" line and, when it goes through, the paid line come from the payment.
    if (!r.rejected && (owedKeys.has(r.submissionId ?? r.callId) || lateKeys.has(r.submissionId ?? r.callId))) continue;
    const what = r.callId ? "your live call" : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    out.push({ kind: r.rejected ? "rejected" : "paid", text: r.rejected ? `${dev} rejected ${what}` : `${dev} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt });
  }
  for (const r of devReqs) {
    const when = fmtDateTime(r.startsAt);
    const what = r.weeks ? `${r.repeat === "daily" ? "daily" : "weekly"} calls from ${when}` : r.times.length > 1 ? `a call (pick one of ${r.times.length} times)` : `a call for ${when}`;
    if (r.status === "pending" && r.createdAt > seenAt) out.push({ kind: "requested", text: `${dev} requested ${what}`, createdAt: r.createdAt });
    else if (r.status === "withdrawn") out.push({ kind: "requested", text: `${dev} withdrew the request for ${what}`, createdAt: r.updatedAt });
    else if (r.status === "taken") out.push({ kind: "requested", text: `The call time ${when} is no longer available: another tester took it`, createdAt: r.updatedAt });
    else if (r.status === "closed" && !CLOSED_BY_TESTER.has(r.closedReason)) out.push({ kind: "requested", text: `The call time ${when} is no longer available`, createdAt: r.updatedAt });
    // booked / declined by the tester themselves: their own action (reason E)
  }
  for (const r of mine) {
    const when = fmtDateTime(r.startsAt);
    if (r.status === "declined") out.push({ kind: "requested", text: `${dev} declined your call request for ${when}`, createdAt: r.decidedAt! });
    else if (r.closedReason === "matched") out.push({ kind: "booked", text: `Booked: ${dev} asked for the same time, ${when}`, createdAt: r.decidedAt! });
    else out.push({ kind: "booked", text: `${dev} accepted your call request: ${r.weeks ? `${r.weeks} ${r.repeat === "daily" ? "daily" : "weekly"} calls from ${when}` : when}`, createdAt: r.decidedAt! });
  }
  for (const call of calls) out.push({ kind: "cancelled", text: `Your call on ${fmtDateTime(call.startsAt)} was cancelled`, createdAt: call.cancelledAt! });
  // (F) the listing's info (title, description, devices, languages) changed.
  out.push(...(await db.testEvent.findMany({ where: { testId, kind: { in: ["info", "renamed"] }, createdAt: { gt: seenAt } } })));
  out.push(...(await testerPaymentChanges(testerId, contractId, seenAt)));
  out.push(...(await ownChanges(testerId, testId, seenAt, tab)));
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

const KINDS = ["terms", "paid", "rejected", "cancelled", "booked", "requested", "info", "payment", "admin", "own"];

/** The one tester gate: the first press stops (the box shows under that button); the second goes ahead. */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.") {
  if (body.confirmed === true) return;
  const seenAt = seenOf(body.seenAt);
  if (!seenAt) return;
  const changes = withRenamed(await testerChanges(testerId, contractId, testId, seenAt, tabOf(body)), body);
  const r = stopOnce(changes, seenAt, false, [...KINDS, "renamed"]);
  if (!r.go) throw new HttpError(409, "stop_once", tail, { changes: asLines(r.changes), tail, top: r.changes.some((e) => e.kind === "terms") });
}
