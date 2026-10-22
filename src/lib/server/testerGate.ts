import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { CHARGED_BY_TESTER, LET_GO_BY_TESTER, stopOnce, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";

// The tester's ONE set of stop-once reasons (owner rule), used by every tester button: Switch / Keep, Charge / Let it go,
// Dispute, Leave, Send written, Send recording, Book, Cancel. Since the page loaded: new terms offered or changed; the
// developer paid or rejected any of their work; call times offered / removed / taken, or a call with them cancelled.
// Final refusals (ended early, stopped, Open until passed, already decided, holds) are checked separately and stay final.

const canSee = (slot: { allowedTesterIds: string[] }, testerId: string) => slot.allowedTesterIds.length === 0 || slot.allowedTesterIds.includes(testerId);

export async function testerChanges(testerId: string, contractId: string, testId: string, seenAt: Date): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  const [offers, reviews, slots, calls] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: seenAt } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: seenAt }, reason: { notIn: [CHARGED_BY_TESTER, LET_GO_BY_TESTER] } }, include: { submission: true } }),
    db.callSlot.findMany({ where: { testId, updatedAt: { gt: seenAt } } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: seenAt }, cancelledBy: { not: "tester" } } }),
  ]);
  const out: TestEventLike[] = [];
  for (const o of offers) out.push({ kind: "terms", text: `${dev} offered new terms: ${o.diff}`, createdAt: o.createdAt });
  for (const r of reviews) {
    const what = r.callId ? "your live call" : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    out.push({ kind: r.rejected ? "rejected" : "paid", text: r.rejected ? `${dev} rejected ${what}` : `${dev} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt });
  }
  for (const s of slots.filter((s) => canSee(s, testerId))) {
    const isNew = s.createdAt > seenAt;
    if (s.status === "open") out.push({ kind: "offered", text: `${isNew ? "A new call time was offered" : "A call time opened up"}: ${fmtDateTime(s.startsAt)}`, createdAt: s.updatedAt });
    else if (!isNew) out.push({ kind: "removed", text: `The call time ${fmtDateTime(s.startsAt)} was ${s.status === "booked" ? "taken" : "removed"}`, createdAt: s.updatedAt });
  }
  const reqs = await db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: seenAt } } });
  for (const r of reqs) out.push({ kind: "requested", text: r.status === "pending" ? `${dev} requested a call for ${fmtDateTime(r.startsAt)}` : `${dev} ${r.status === "withdrawn" ? "withdrew" : r.status} the call request for ${fmtDateTime(r.startsAt)}`, createdAt: r.updatedAt });
  const mineDeclined = await db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: "declined", updatedAt: { gt: seenAt } } });
  for (const r of mineDeclined) out.push({ kind: "requested", text: `${dev} declined your call request for ${fmtDateTime(r.startsAt)}`, createdAt: r.updatedAt });
  for (const call of calls) out.push({ kind: "cancelled", text: `Your call on ${fmtDateTime(call.startsAt)} was cancelled`, createdAt: call.cancelledAt! });
  return out;
}

const KINDS = ["terms", "paid", "rejected", "offered", "removed", "cancelled", "booked", "requested"];

/** The one tester gate: the first press stops (the box shows under that button); the second goes ahead. */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.") {
  if (body.confirmed === true || typeof body.seenAt !== "string") return;
  const seenAt = new Date(body.seenAt);
  if (isNaN(seenAt.getTime())) return;
  const changes = await testerChanges(testerId, contractId, testId, seenAt);
  const r = stopOnce(changes, seenAt, false, KINDS);
  if (!r.go) throw new HttpError(409, "stop_once", tail, { changes: r.changes.map((e) => ({ text: e.text, at: e.createdAt })), tail, top: r.changes.some((e) => e.kind === "terms") });
}
