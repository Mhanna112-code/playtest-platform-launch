import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime, money, toCents } from "@/lib/format";
import { PAUSED_FOR_TESTERS } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { devGate, recordEvent } from "./tests";
import { testerGate } from "./testerGate";

// Calls are ALWAYS requests (owner rule): no offered times, no instant Book. Every call starts as a request from one side
// and is booked only when the other side accepts, or when both sides request the same time (auto-match).
// - The developer requests a time with one or more working testers (one request = ONE call: the first Accept books it,
//   the other copies close). The developer never sets a price: the tester's contract call rate applies.
// - The tester requests a time, or accepts, with an optional "Ask $___/h". STRICT: an ask different from the contract
//   rate never books on the tester's side; it becomes a tester request the developer must Accept or Decline.
// Requests close when their time passes, on a block, a hold, Stop, End early or Leave.

type Side = "developer" | "tester";
type U = { id: string; email: string; name: string };

async function ctx(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const side: Side | null = c?.testerId === userId ? "tester" : c?.test.developerId === userId ? "developer" : null;
  if (!c || !side) throw new HttpError(404, "not_found", "That session doesn't exist.");
  return { c, side, other: side === "tester" ? c.test.developer : c.tester, me: side === "tester" ? c.tester : c.test.developer };
}

/** The tester's ask (cents per hour), or null when blank. */
function readAsk(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const c = toCents(v);
  if (c == null || c < 0) throw new HttpError(400, "bad_ask", "Enter the rate you ask like 50.00, or leave it empty.");
  return c;
}
/** Does this ask match the contract (blank, or equal to the contract call rate)? */
const askMatches = (ask: number | null, contractRate: number | null) => ask == null || ask === contractRate;
export const rateLabel = (rateCents: number | null, contractRate: number | null) =>
  rateCents == null ? "Not in your contract" : `${rateCents === contractRate ? "Contract" : "Agreed"} ${money(rateCents).replace(/\.00$/, "")}/h`;

/** Book a call at this time between the two, at the agreed rate (the contract rate unless a tester's ask was accepted). */
async function bookAt(contractId: string, startsAt: Date, minutes: number, rateCents: number | null) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true, tester: true } });
  const slot = await db.callSlot.create({ data: { testId: c.testId, startsAt, minutes, allowedTesterIds: [c.testerId], status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes, rateCents } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "booked", `${displayName(c.tester)} booked a call for ${fmtDateTime(startsAt)}`, false, {}, contractId));
  return call;
}

/** One request = one call: once a copy of a developer batch books, the other copies close ("Ana Silva took this time …"). */
async function closeBatch(batchId: string, exceptId: string, takerName: string) {
  if (!batchId) return;
  await db.callRequest.updateMany({ where: { batchId, id: { not: exceptId }, status: "pending" }, data: { status: "taken", closedReason: `${takerName} took this time at ${fmtTime(new Date())}`, decidedAt: new Date() } });
}

/** Close pending requests (time passed, block, hold, Stop, End early, Leave). */
export async function closeRequests(where: { contractIds?: string[] }, reason: string) {
  const rows = await db.callRequest.findMany({ where: { status: "pending", ...(where.contractIds ? { contractId: { in: where.contractIds } } : {}) } });
  if (rows.length) await db.callRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "closed", closedReason: reason, decidedAt: new Date() } });
  return rows;
}

const refusalFor = (r: { status: string; updatedAt: Date; closedReason: string }, otherName: string, mine: boolean) => {
  if (r.status === "taken") return `${r.closedReason}.`;
  if (r.status === "withdrawn") return mine ? "You already withdrew this request." : `${otherName} withdrew this request at ${fmtTime(r.updatedAt)}.`;
  if (r.status === "declined") return mine ? `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` : "You already declined this request.";
  if (r.status === "booked") return `This time was booked at ${fmtTime(r.updatedAt)}.`;
  return `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.`;
};

async function refusals(c: Awaited<ReturnType<typeof ctx>>["c"], side: Side) {
  if (c.status !== "working") throw new HttpError(409, "closed", side === "tester" ? "Your session has ended." : `${displayName(c.tester)}'s session has ended.`);
  if (c.test.developer.holdStartedAt) throw new HttpError(409, "paused", side === "tester" ? PAUSED_FOR_TESTERS : "Pay what you owe first.");
  if (c.test.status !== "open") throw new HttpError(409, "closed", "This test isn't open.");
  if (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) throw new HttpError(409, "gone", "This time isn't available.");
}

/** Developer: Request a time with one or more ticked working testers (one grouped bell each). */
export async function devRequestTime(dev: U, testId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.contractIds) ? body.contractIds.map(String) : body.contractId ? [String(body.contractId)] : [];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  const startsAt = new Date(String(body.startsAt ?? ""));
  if (isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 5 * 60_000) throw new HttpError(400, "bad_time", "Pick a time in the future.");
  const all = [];
  for (const id of ids) {
    const x = await ctx(dev.id, id);
    if (x.side !== "developer" || x.c.testId !== testId) throw new HttpError(404, "not_found", "That tester isn't in this test.");
    await refusals(x.c, "developer");
    all.push(x);
  }
  await db.$transaction((tx) => devGate(tx, testId, body.seenAt, body.confirmed === true));
  const batchId = randomBytes(8).toString("hex");
  // Auto-match: a tester already requested this exact time with no ask (or the contract rate) → book with them.
  for (const { c } of all) {
    const match = await db.callRequest.findFirst({ where: { contractId: c.id, status: "pending", fromSide: "tester", startsAt } });
    if (match && askMatches(match.askRateCents, c.liveRateCents)) {
      const call = await bookAt(c.id, startsAt, match.minutes, c.liveRateCents);
      await db.callRequest.update({ where: { id: match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
      const line = `Booked: you both picked ${fmtDateTime(startsAt)}`;
      await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
      return { booked: true, callId: call.id, message: line };
    }
  }
  const made = [];
  for (const { c } of all) {
    const minutes = c.liveMinutes ?? c.test.liveMinutes ?? 30;
    made.push(await db.callRequest.create({ data: { testId, contractId: c.id, fromSide: "developer", startsAt, minutes, batchId } }));
    const line = `${displayName(dev)} asked for a call: ${fmtDateTime(startsAt)}`;
    await notify(c.tester.email, line, [line, `Rate: ${rateLabel(c.liveRateCents, c.liveRateCents)}. Accept or decline it on your session page.`], `/app/sessions/${c.id}`);
  }
  await db.$transaction((tx) => recordEvent(tx, testId, "requested", `You requested a call for ${fmtDateTime(startsAt)} with ${made.length} tester${made.length === 1 ? "" : "s"}`, false));
  return { requested: made.length, batchId };
}

/** Tester: Request a time with an optional "Ask $___/h". A different ask never books on the tester's side. */
export async function testerRequestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side } = await ctx(user.id, contractId);
  if (side !== "tester") throw new HttpError(404, "not_found", "That session doesn't exist.");
  await refusals(c, "tester");
  const startsAt = new Date(String(body.startsAt ?? ""));
  if (isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 5 * 60_000) throw new HttpError(400, "bad_time", "Pick a time in the future.");
  const ask = readAsk(body.ask);
  await testerGate(c.testerId, contractId, c.testId, body);
  const minutes = c.liveMinutes ?? c.test.liveMinutes ?? 30;
  // Auto-match only when the ask is blank or the contract rate.
  if (askMatches(ask, c.liveRateCents)) {
    const match = await db.callRequest.findFirst({ where: { contractId, status: "pending", fromSide: "developer", startsAt } });
    if (match) {
      const call = await bookAt(contractId, startsAt, match.minutes, c.liveRateCents);
      await db.callRequest.update({ where: { id: match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
      await closeBatch(match.batchId, match.id, displayName(c.tester));
      const line = `Booked: you both picked ${fmtDateTime(startsAt)}`;
      await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#calls`);
      return { booked: true, callId: call.id, message: line };
    }
  }
  // A different ask for a time the developer requested closes this tester's copy of that request; this one waits.
  if (!askMatches(ask, c.liveRateCents)) {
    await db.callRequest.updateMany({ where: { contractId, status: "pending", fromSide: "developer", startsAt }, data: { status: "closed", closedReason: "you asked a different rate", decidedAt: new Date() } });
  }
  const r = await db.callRequest.create({ data: { testId: c.testId, contractId, fromSide: "tester", startsAt, minutes, askRateCents: ask == null || ask === c.liveRateCents ? null : ask } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(c.tester)} requested a call for ${fmtDateTime(startsAt)}${r.askRateCents != null ? ` and asks ${money(r.askRateCents)}/h` : ""}`, false, {}, contractId));
  await notify(c.test.developer.email, `${displayName(c.tester)} requested a call for ${fmtDateTime(startsAt)}`, [r.askRateCents != null ? `They ask ${money(r.askRateCents)}/h.` : `At their contract rate (${rateLabel(c.liveRateCents, c.liveRateCents)}).`, "Accept or decline it on the test page."], `/app/tests/${c.testId}#calls`);
  return { requested: true, id: r.id };
}

/** Kept for one route: either side's Request a time. */
export async function requestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side } = await ctx(user.id, contractId);
  return side === "developer" ? devRequestTime(user, c.testId, { ...body, contractIds: [contractId] }) : testerRequestTime(user, contractId, body);
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
    await refusals(c, side);
    if (side === "tester") {
      const ask = readAsk(body.ask);
      if (!askMatches(ask, c.liveRateCents)) {
        // STRICT: a different rate never books on the tester's side. This copy becomes a tester request at that rate;
        // the developer's request stays open for the other testers.
        await db.callRequest.update({ where: { id: r.id }, data: { status: "closed", closedReason: "you asked a different rate", decidedAt: new Date() } });
        const tr = await db.callRequest.create({ data: { testId: c.testId, contractId, fromSide: "tester", startsAt: r.startsAt, minutes: r.minutes, askRateCents: ask } });
        await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(c.tester)} asks ${money(ask!)}/h for the call on ${fmtDateTime(r.startsAt)}`, false, {}, contractId));
        await notify(c.test.developer.email, `${displayName(c.tester)} asks ${money(ask!)}/h for ${fmtDateTime(r.startsAt)}`, ["Accept or decline it on the test page."], `/app/tests/${c.testId}#calls`);
        return { requested: true, id: tr.id, message: `Sent: you ask ${money(ask!)}/h. ${displayName(other)} will accept or decline.` };
      }
    }
    // A tester's Accept always books at the contract rate; the developer accepting a tester's priced request books at
    // the asked rate ("Agreed").
    const rate = side === "developer" && r.askRateCents != null ? r.askRateCents : c.liveRateCents;
    const call = await bookAt(contractId, r.startsAt, r.minutes, rate);
    await db.callRequest.update({ where: { id: r.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
    if (side === "tester") await closeBatch(r.batchId, r.id, displayName(c.tester));
    await notify(other.email, `Booked: ${fmtDateTime(r.startsAt)}`, [`${displayName(user)} accepted the call request for ${fmtDateTime(r.startsAt)} (${rateLabel(rate, c.liveRateCents)}).`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
    return { booked: true, callId: call.id };
  }
  const status = action === "withdraw" ? "withdrawn" : "declined";
  await db.callRequest.update({ where: { id: r.id }, data: { status, decidedAt: new Date() } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, status === "withdrawn" ? "withdrew_req" : "declined_req", `${displayName(user)} ${status} a call request for ${fmtDateTime(r.startsAt)}`, false, {}, contractId));
  if (status === "declined") await notify(other.email, `${displayName(user)} declined your call request`, [`${displayName(user)} declined your request for ${fmtDateTime(r.startsAt)}.`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
  return { [status]: true };
}
