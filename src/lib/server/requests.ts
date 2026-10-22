import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime } from "@/lib/format";
import { HttpError } from "./http";
import { notify } from "./notify";
import { devGate, recordEvent } from "./tests";
import { testerGate } from "./testerGate";

// Call requests on both sides (owner rule): the developer requests a time with one tester; a tester requests a time
// with the developer. Pending until the other side accepts or declines; each side can withdraw its own. Auto-match:
// if the other side books, offers, accepts or requests the same time, it's booked at once and the request closes.
// Requests close when their time passes, on a block, a hold, Stop, End early or Leave.

type Side = "developer" | "tester";
type U = { id: string; email: string; name: string };

async function ctx(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const side: Side | null = c?.testerId === userId ? "tester" : c?.test.developerId === userId ? "developer" : null;
  if (!c || !side) throw new HttpError(404, "not_found", "That session doesn't exist.");
  return { c, side, other: side === "tester" ? c.test.developer : c.tester, me: side === "tester" ? c.tester : c.test.developer };
}

/** Book a call at this time between the two (a slot only this tester can see, already booked). */
async function bookAt(contractId: string, startsAt: Date, minutes: number) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true } });
  const slot = await db.callSlot.create({ data: { testId: c.testId, startsAt, minutes, allowedTesterIds: [c.testerId], status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes, rateCents: c.liveRateCents } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "booked", `Booked: a call on ${fmtDateTime(startsAt)}`, false, {}, contractId));
  return call;
}

/** Close pending requests (time passed, block, hold, Stop, End early, Leave). */
export async function closeRequests(where: { contractIds?: string[]; developerId?: string }, reason: string) {
  const rows = await db.callRequest.findMany({
    where: { status: "pending", ...(where.contractIds ? { contractId: { in: where.contractIds } } : {}), ...(where.developerId ? { testId: { in: (await db.test.findMany({ where: { developerId: where.developerId }, select: { id: true } })).map((t) => t.id) } } : {}) },
  });
  if (rows.length) await db.callRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "closed", closedReason: reason, decidedAt: new Date() } });
  return rows;
}

const refusalFor = (r: { status: string; fromSide: string; updatedAt: Date; closedReason: string }, otherName: string, mine: boolean) => {
  if (r.status === "withdrawn") return mine ? "You already withdrew this request." : `${otherName} withdrew this request at ${fmtTime(r.updatedAt)}.`;
  if (r.status === "declined") return mine ? `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` : "You already declined this request.";
  if (r.status === "booked") return `This time was booked at ${fmtTime(r.updatedAt)}.`;
  return `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.`;
};

export async function requestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side, other, me } = await ctx(user.id, contractId);
  if (c.status !== "working") throw new HttpError(409, "closed", side === "tester" ? "Your session has ended." : "Their session has ended.");
  if (c.test.developer.holdStartedAt) throw new HttpError(409, "paused", side === "tester" ? "This test is paused." : "Pay what you owe first.");
  if (c.test.status !== "open") throw new HttpError(409, "closed", "This test isn't open.");
  if (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) throw new HttpError(409, "gone", "This time isn't available.");
  const startsAt = new Date(String(body.startsAt ?? ""));
  if (isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 5 * 60_000) throw new HttpError(400, "bad_time", "Pick a time in the future.");
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body.seenAt, body.confirmed === true));
  else await testerGate(c.testerId, contractId, c.testId, body);
  const minutes = c.liveMinutes ?? c.test.liveMinutes ?? 30;
  // Auto-match: the other side's pending request for the same time, or (tester) a time the developer offered.
  const match = await db.callRequest.findFirst({ where: { contractId, status: "pending", fromSide: side === "tester" ? "developer" : "tester", startsAt } });
  const offered = side === "tester" ? await db.callSlot.findFirst({ where: { testId: c.testId, status: "open", startsAt, OR: [{ allowedTesterIds: { isEmpty: true } }, { allowedTesterIds: { has: c.testerId } }] } }) : null;
  if (match || offered) {
    let call;
    if (offered) {
      await db.callSlot.update({ where: { id: offered.id }, data: { status: "booked" } });
      call = await db.call.create({ data: { slotId: offered.id, contractId, startsAt, minutes: offered.minutes, rateCents: c.liveRateCents } });
      await db.$transaction((tx) => recordEvent(tx, c.testId, "booked", `${displayName(c.tester)} booked a call for ${fmtDateTime(startsAt)}`, false, {}, contractId));
    } else call = await bookAt(contractId, startsAt, minutes);
    if (match) await db.callRequest.update({ where: { id: match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
    const line = `Booked: you both picked ${fmtDateTime(startsAt)}`;
    await notify(other.email, line, [line], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
    return { booked: true, callId: call.id, message: line };
  }
  const r = await db.callRequest.create({ data: { testId: c.testId, contractId, fromSide: side, startsAt, minutes } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(me)} requested a call for ${fmtDateTime(startsAt)}`, false, {}, contractId));
  await notify(other.email, `${displayName(me)} requested a call for ${fmtDateTime(startsAt)}`, ["Accept or decline it in the live-call panel."], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
  return { requested: true, id: r.id };
}

/** Accept / Decline (the other side) or Withdraw (your own). Changed meanwhile → final refusal naming what happened. */
export async function answerRequest(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side, other } = await ctx(user.id, contractId);
  const r = await db.callRequest.findUnique({ where: { id: String(body.requestId ?? "") } });
  if (!r || r.contractId !== contractId) throw new HttpError(404, "not_found", "That request doesn't exist.");
  const action = String(body.action ?? "");
  const mine = r.fromSide === side;
  if (r.status === "pending" && r.startsAt < new Date()) await db.callRequest.update({ where: { id: r.id }, data: { status: "closed", closedReason: "its time passed" } });
  const fresh = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
  if (fresh.status !== "pending") throw new HttpError(409, "gone", refusalFor(fresh, displayName(other), mine));
  if (action === "withdraw" ? !mine : mine) throw new HttpError(409, "not_yours", mine ? "You can't answer your own request: withdraw it instead." : "Only the person who asked can withdraw it.");
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body.seenAt, body.confirmed === true));
  else await testerGate(c.testerId, contractId, c.testId, body);
  if (action === "accept") {
    if (c.test.developer.holdStartedAt) throw new HttpError(409, "paused", side === "tester" ? "This test is paused." : "Pay what you owe first.");
    const call = await bookAt(contractId, r.startsAt, r.minutes);
    await db.callRequest.update({ where: { id: r.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
    await notify(other.email, `Booked: ${fmtDateTime(r.startsAt)}`, [`${displayName(user)} accepted your call request for ${fmtDateTime(r.startsAt)}.`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
    return { booked: true, callId: call.id };
  }
  const status = action === "withdraw" ? "withdrawn" : "declined";
  await db.callRequest.update({ where: { id: r.id }, data: { status, decidedAt: new Date() } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, status === "withdrawn" ? "withdrew_req" : "declined_req", `${displayName(user)} ${status} a call request for ${fmtDateTime(r.startsAt)}`, false, {}, contractId));
  if (status === "declined") await notify(other.email, `${displayName(user)} declined your call request`, [`${displayName(user)} declined your request for ${fmtDateTime(r.startsAt)}.`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
  return { [status]: true };
}

/** When the developer offers a time a tester requested (or the tester books one the developer requested): booked. */
export async function matchOffered(testId: string) {
  const reqs = await db.callRequest.findMany({ where: { testId, status: "pending", fromSide: "tester" } });
  for (const r of reqs) {
    const slot = await db.callSlot.findFirst({ where: { testId, status: "open", startsAt: r.startsAt } });
    if (!slot) continue;
    const c = await db.contract.findUniqueOrThrow({ where: { id: r.contractId }, include: { tester: true } });
    await db.callSlot.update({ where: { id: slot.id }, data: { status: "booked" } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: r.contractId, startsAt: r.startsAt, minutes: slot.minutes, rateCents: c.liveRateCents } });
    await db.callRequest.update({ where: { id: r.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
    await notify(c.tester.email, `Booked: you both picked ${fmtDateTime(r.startsAt)}`, [`Booked: you both picked ${fmtDateTime(r.startsAt)}.`], `/app/sessions/${c.id}`);
  }
}
export async function closeOnBooking(contractId: string, startsAt: Date, callId: string) {
  await db.callRequest.updateMany({ where: { contractId, status: "pending", startsAt }, data: { status: "booked", callId, decidedAt: new Date() } });
}
