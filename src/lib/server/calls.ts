import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { T, fmtFor } from "@/lib/tz";
import { displayName, fmtDateTime, pronouns } from "@/lib/format";
import { COULD_NOT_CONNECT, callClosedKind, callClosedLineOf, callEndedLine, cancelLine, checkCancel, type TestEventLike, NOBODY_JOINED, JOIN_OPENS_MIN, payByFrom, testPaused } from "@/lib/rules";
import { CALL_NOT_AVAILABLE, CALL_OVER_LINE, END_WARN_MS, LENGTH_ENDED_LINE, MEASURE_CAP, PRESENCE_GAP_MS, capEnd, capEndedLine, capMinutesFor, closedEndedLine, endWarnLine, measureDeadline, measureIsFinal, measureOverlap, type Span } from "@/lib/callMeasure";
import { callsLeftCents } from "./callMoney";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { notify } from "./notify";
import { testerGate as sharedTesterGate } from "./testerGate";
import { devGate, devGateIfSeen, ownContract, ownTest, recordEvent, staleNote } from "./tests";
import { CALL_ACTS } from "./live";

type U = { id: string; email: string; name: string; pronoun: string };


const canSee = (slot: { allowedTesterIds: string[] }, testerId: string) => slot.allowedTesterIds.length === 0 || slot.allowedTesterIds.includes(testerId);


/** Developer cancels a booked call: 24 hours or more ahead only. The time is removed. */
export async function devCancelCall(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const callId = String(body.callId ?? "");
  const reason = readText(body.reason, LIMITS.reason, "reason"); // (batch 15 section 20) refused over 1,000, never cut
  const call = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const c = await tx.call.findUnique({ where: { id: callId }, include: { contract: { include: { tester: true } } } });
    if (!c || c.contract.testId !== testId) throw new HttpError(404, "not_found", "That call doesn't exist.");
    const name = displayName(c.contract.tester);
    // (Batch 16 section 21) Cancelled in another tab: this press stops once naming it, then it's already done.
    if (c.status === "cancelled") {
      await devGate(tx, testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: [`call:${c.id}`, `c:${c.contractId}`] });
      throw new HttpError(409, "cancelled", `The call with ${name} was already cancelled.` + (await staleNote(testId, body.seenAt)));
    }
    const ok = checkCancel(c.startsAt, new Date(), reason);
    if (!ok.ok) throw new HttpError(400, "reason", ok.message);
    // (Batch 16 section 21) Another tab's call action with this tester stops it once.
    await devGate(tx, testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: [`call:${c.id}`, `c:${c.contractId}`] });
    await tx.call.update({ where: { id: c.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date(), cancelNote: reason } });
    await tx.callSlot.update({ where: { id: c.slotId }, data: { status: "removed" } });
    await recordEvent(tx, testId, "cancelled", `You cancelled the call with ${name} on ${fmtDateTime(c.startsAt)}`, false, {}, c.contractId);
    return c;
  });
  // (Batch 15 section 20) The reason is in the email and on the page, never in the bell line.
  const line = cancelLine(displayName(dev), call.startsAt, "");
  await notify(call.contract.tester.email, line, [cancelLine(displayName(dev), call.startsAt, reason)], `/app/sessions/${call.contractId}#call-${call.id}`, { about: dev.id });
  return { cancelled: true };
}

// ---------- tester: the live-call panel (stops once for call changes they can see) ----------

/** Call changes this tester can see since their page loaded: times offered to them, taken, removed, or their call cancelled. */
export async function testerCallChanges(testerId: string, contractId: string, testId: string, seenAt: Date): Promise<TestEventLike[]> {
  const [slots, calls] = await Promise.all([
    db.callSlot.findMany({ where: { testId, updatedAt: { gt: seenAt } } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: seenAt }, cancelledBy: { not: "tester" } } }),
  ]);
  const out: TestEventLike[] = [];
  for (const s of slots.filter((s) => canSee(s, testerId))) {
    const isNew = s.createdAt > seenAt;
    if (s.status === "open") out.push({ kind: "offered", text: `${isNew ? "A new call time was offered" : "A call time opened up"}: ${fmtDateTime(s.startsAt)}`, createdAt: s.updatedAt });
    else if (!isNew) out.push({ kind: "removed", text: `The call time ${fmtDateTime(s.startsAt)} was ${s.status === "booked" ? "taken" : "removed"}`, createdAt: s.updatedAt });
  }
  for (const c of calls) out.push({ kind: "cancelled", text: `Your call on ${fmtDateTime(c.startsAt)} was cancelled`, createdAt: c.cancelledAt! });
  return out;
}

/** Book / Cancel use the tester's one shared stop-once gate (the box shows under the pressed button). */
const testerGate = (tester: U, c: { id: string; testId: string }, body: Record<string, unknown>) => sharedTesterGate(tester.id, c.id, c.testId, body);

/** Tester cancels their booked call: 24 hours or more ahead only. The time opens up again for others. */
export async function testerCancelCall(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const callId = String(body.callId ?? "");
  const reason = readText(body.reason, LIMITS.reason, "reason"); // (batch 15 section 20) refused over 1,000, never cut
  const call = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    const call = await tx.call.findUnique({ where: { id: callId } });
    if (!call || call.contractId !== contractId) throw new HttpError(404, "not_found", "That call doesn't exist.");
    if (call.status === "cancelled") throw new HttpError(409, "cancelled", "This call was already cancelled.");
    const ok = checkCancel(call.startsAt, new Date(), reason);
    if (!ok.ok) throw new HttpError(400, "reason", ok.message);
    await testerGate(tester, c0, body);
    await tx.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "tester", cancelledAt: new Date(), cancelNote: reason } });
    await tx.callSlot.update({ where: { id: call.slotId }, data: { status: "open" } });
    await recordEvent(tx, c0.testId, "cancelled", `${displayName(tester)} cancelled ${pronouns(tester.pronoun).poss} call on ${fmtDateTime(call.startsAt)}`, false, {}, contractId);
    return call;
  });
  const line = cancelLine(displayName(tester), call.startsAt, "");
  await notify(c0.test.developer.email, line, [cancelLine(displayName(tester), call.startsAt, reason), "The time is open again for other testers."], `/app/tests/${c0.testId}#call-${call.id}`, { about: tester.id });
  return { cancelled: true };
}

/** Either side reports a no-show after the call's start. An admin reads it (no automatic marks). */
export async function reportNoShow(user: U, callId: string, body: Record<string, unknown>) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: true } } } });
  const side = call?.contract.testerId === user.id ? "tester" : call?.contract.test.developerId === user.id ? "developer" : null;
  if (!call || !side) throw new HttpError(404, "not_found", "That call doesn't exist.");
  if (call.status !== "booked") throw new HttpError(409, "cancelled", "This call was cancelled.");
  if (call.startsAt > new Date()) throw new HttpError(409, "not_yet", "You can report a problem once the call's time has started.");
  if (call.noShowBy) throw new HttpError(409, "reported", "A problem with this call was already reported.");
  // (The full app's Report a problem) No-show / Late, plus an optional note; without a kind, the note says what happened.
  const kind = body.kind === "late" ? "was late" : body.kind === "no_show" ? "didn't show up" : "";
  const typed = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!kind && typed.length < 5) throw new HttpError(400, "bad_note", "Say what happened.");
  const note = kind ? `${kind[0].toUpperCase()}${kind.slice(1)}${typed ? `: ${typed}` : "."}` : typed;
  if (side === "developer") await devGateIfSeen(call.contract.testId, body, { acts: ["no-show", "cancel-call", "cancel-set"], keys: [`call:${call.id}`] });
  else await sharedTesterGate(user.id, call.contractId, call.contract.testId, body);
  await db.call.update({ where: { id: call.id }, data: { noShowBy: side, noShowNote: note, noShowAt: new Date() } });
  return { reported: true };
}

// (Owner, Oct 28, batch 16 section 26) No "Lower the length": a call has just Pay (measured length × rate; paying less needs the usual reason).
export const MEASURING_REFUSAL = "This call is still being measured: you can pay it once its length is final.";

// ---------- (Owner, Oct 28, batch 21) The built-in call room (browser to browser), adapted from the full app's call room ----------
// Video and sound go straight between the two browsers (WebRTC); the app only relays their short connection messages (CallSignal) by polling, and keeps the stretches
// both browsers were actually connected (CallPresence), which is the measured length. Only the booked tester and the test's developer can be in the room, from 10
// minutes before the start until the call ends; every poll and message is checked on the server. The server ends the call for real (both pages hang up, no rejoin) at
// 150% of the booked length, at the $1,000 for that tester's calls, and when a block, a pause, a suspension, a leave, End early or a Stop closes it.

const roomInclude = { presences: true, contract: { include: { test: { include: { developer: true } } } } } as const;
type RoomCall = Prisma.CallGetPayload<{ include: typeof roomInclude }>;
const loadRoomCall = (id: string) => db.call.findUnique({ where: { id }, include: roomInclude });
const sideIn = (call: { contract: { testerId: string; test: { developerId: string } } }, userId: string) =>
  call.contract.testerId === userId ? ("tester" as const) : call.contract.test.developerId === userId ? ("developer" as const) : null;

/** Google's free STUN servers, plus a TURN relay when TURN_URL is set (needed on some strict networks: some offices, some mobile carriers). */
export function iceServers() {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL) servers.push({ urls: process.env.TURN_URL.split(",").map((x) => x.trim()).filter(Boolean), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  return servers;
}

type CapCall = { id: string; contractId: string; status: string; rateCents: number | null; minutes: number; startsAt: Date; measuredAt: Date | null; actualMinutes: number | null; cappedAt: Date | null; endedAt: Date | null; endReason: string };
type Presence = { side: string; startAt: Date; endAt: Date };
const spansOf = (presences: Presence[], side: string): Span[] => presences.filter((p) => p.side === side);
/** The time both browsers were connected at once (gaps under 5 minutes count), uncapped. */
const together = (presences: Presence[]) => measureOverlap(spansOf(presences, "developer"), spansOf(presences, "tester"), Number.POSITIVE_INFINITY);

/** What closed this call (it can't be joined, and a call in progress ends): a block either way, a pause (any cause), a stop, a leave or the session's end; "" when open. */
export async function callClosedKindOf(call: { contract: { testerId: string; status: string; test: { developerId: string; status: string; adminPausedAt: Date | null; developer: { holdStartedAt: Date | null; devSuspendedAt: Date | null } } } }) {
  const c = call.contract;
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) > 0;
  return callClosedKind({ blocked, paused: testPaused(c.test.developer, c.test), testStatus: c.test.status, contractStatus: c.status });
}
/** The neutral line for that, per side ("This test is paused.", "Their session ended.", …); "" when open. */
export async function callClosedLine(call: Parameters<typeof callClosedKindOf>[0] & { contract: { endKind?: string } }, side: "tester" | "developer") {
  return callClosedLineOf(await callClosedKindOf(call), side, call.contract.endKind ?? "");
}

/**
 * Ends the call on the server at `at`: the measured length is final there (the connected time up to that moment, at most `limit` minutes), both pages hang up on their
 * next poll and the room can't be rejoined. Its relayed messages are deleted. False when it had already ended (or been cancelled) meanwhile.
 */
async function endCall(call: CapCall & { presences: Presence[] }, reason: string, at: Date, now: Date, limit = Number.POSITIVE_INFINITY) {
  const clip = (s: Span[]) => s.filter((p) => p.startAt.getTime() <= at.getTime()).map((p) => ({ startAt: p.startAt, endAt: new Date(Math.min(p.endAt.getTime(), at.getTime())) }));
  const m = measureOverlap(clip(spansOf(call.presences, "developer")), clip(spansOf(call.presences, "tester")), call.minutes);
  const minutes = m.ms > 0 ? Math.min(Math.max(1, m.minutes), limit) : 0;
  const done = await db.call.updateMany({
    where: { id: call.id, status: "booked", measuredAt: null, actualMinutes: null, endedAt: null, cappedAt: null },
    data: { endedAt: at, endReason: reason, ...(reason === "calls_cap" ? { cappedAt: at } : {}), measuredMinutes: minutes, measuredFrom: m.from, measuredTo: m.to, measuredAt: now, payBy: payByFrom(m.to ?? at) },
  });
  await db.callSignal.deleteMany({ where: { callId: call.id } });
  return done.count === 1;
}

/**
 * The most minutes this call can be paid before its pay at the call's rate reaches what's left of the $1,000 for that tester's calls on this test (this call's own
 * booked reservation not counted); null when that never binds before the 150% cap (or the call is free).
 */
export async function callCapMinutes(call: Pick<CapCall, "id" | "contractId" | "rateCents" | "minutes">) {
  const cap = capMinutesFor(call.rateCents, await callsLeftCents(call.contractId, db, call.id));
  return cap == null || cap >= Math.floor(call.minutes * MEASURE_CAP) ? null : cap;
}

/**
 * (Batch 18 section 3; batch 21 section 2) Where a call stands against its planned end: the smaller of 150% of the booked length ("length") and the minutes left of the
 * $1,000 for that tester's calls ("calls_cap"), counted in time both browsers were connected. `ended` once it was reached (the call is then ended on the server, at
 * that moment); otherwise `endsAt`, the projected moment (`together`: both connected now, so it holds). Checked by every room poll, by Join and by the measuring sweep.
 */
export async function callEndState(callId: string, now = new Date(), loaded?: CapCall & { presences: Presence[] }) {
  const call = loaded ?? (await db.call.findUnique({ where: { id: callId }, include: { presences: true } }));
  if (!call) return null;
  if (call.endedAt || call.cappedAt) return { ended: true, endsAt: (call.endedAt ?? call.cappedAt)!, reason: call.endReason || "calls_cap", together: false };
  if (call.status !== "booked" || call.measuredAt || call.actualMinutes != null || call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000 > now.getTime()) return null;
  const capK = await callCapMinutes(call);
  const limit = capK ?? Math.floor(call.minutes * MEASURE_CAP);
  const reason = capK != null ? "calls_cap" : "length";
  const e = capEnd(spansOf(call.presences, "developer"), spansOf(call.presences, "tester"), limit, now);
  if (!e.reached) return { ended: false, endsAt: e.endsAt, reason, together: e.together };
  await endCall(call, reason, e.endsAt, now, limit);
  return { ended: true, endsAt: e.endsAt, reason, together: false };
}
/** (Batch 18 section 3) The same, only when the $1,000 is what ends it: null otherwise. */
export async function callCapState(callId: string, now = new Date(), loaded?: CapCall & { presences: Presence[] }) {
  const s = await callEndState(callId, now, loaded);
  return s && s.reason === "calls_cap" ? { ended: s.ended, endsAt: s.endsAt } : null;
}

/**
 * Whether the room is shut now (for everyone): cancelled, ended or measured; more than 10 minutes before the start; past the measuring deadline; or closed by a
 * block, a pause, a stop, a leave or the session's end. A call in progress (they were connected) that something closed is ended at this moment.
 */
async function roomShut(call: RoomCall, now: Date) {
  if (call.status !== "booked" || call.endedAt || call.cappedAt || call.measuredAt || call.actualMinutes != null) return true;
  if (now.getTime() < call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000 || now.getTime() > measureDeadline(call.startsAt, call.minutes).getTime()) return true;
  const kind = await callClosedKindOf(call);
  if (!kind) return false;
  if (together(call.presences).ms > 0) await endCall(call, await endReasonOf(call, kind), now, now);
  return true;
}

/** A call in progress that something closed (a block, a pause, a stop, a leave, the session's end) is ended now; checked by the status polls too. */
export async function endIfClosed(callId: string, now = new Date()) {
  const call = await loadRoomCall(callId);
  if (!call || call.status !== "booked" || call.endedAt || call.cappedAt || call.measuredAt || call.actualMinutes != null || !call.presences.length) return false;
  const kind = await callClosedKindOf(call);
  return !!kind && together(call.presences).ms > 0 && (await endCall(call, await endReasonOf(call, kind), now, now));
}

/** (Batch 26 section 2) The stored end reason: a block names the side that blocked ("blocked:developer"), so each page says its own line. */
async function endReasonOf(call: { contract: { testerId: string; test: { developerId: string } } }, kind: string) {
  if (kind !== "blocked") return kind;
  const byTester = await db.block.count({ where: { blockerId: call.contract.testerId, blockedId: call.contract.test.developerId } });
  return `blocked:${byTester ? "tester" : "developer"}`;
}

/**
 * (Owner, Oct 29, batch 26 section 2) A block ends a call already in progress AT ONCE (both pages hang up on their next poll), whether or not the two were connected:
 * its measured length is final at that moment. `by`: the side that blocked. False when it had already ended.
 */
export async function endCallForBlock(callId: string, by: "tester" | "developer", now = new Date()) {
  const call = await loadRoomCall(callId);
  if (!call || call.status !== "booked" || call.endedAt || call.cappedAt || call.measuredAt || call.actualMinutes != null) return false;
  return endCall(call, `blocked:${by}`, now, now);
}
/** (Batch 26 section 2, DEFAULT) The call page's line after a block: the person who blocked reads who; the other reads only that the call was cancelled (never "blocked"). */
export const blockEndedLine = (mine: boolean, otherName: string) => (mine ? `Call ended: you blocked ${otherName}.` : "Call ended: the call was cancelled.");

/**
 * The line the call page shows instead of the room, for one of its two people ("" while the room can be used, or before it opens): "This call was cancelled.",
 * "Call ended: it reached 150% of the booked time.", "Call ended: the test is paused.", "Call ended at 3:42 PM." …
 */
export function callLineFor(call: { status: string; startsAt: Date; minutes: number; endedAt: Date | null; endReason: string; cappedAt: Date | null; measuredAt: Date | null; measuredMinutes: number | null; measuredTo: Date | null; actualMinutes: number | null; contract: { endKind: string } }, side: "tester" | "developer", otherName: string, tz: { timeZone?: string | null } | null, closed = "", now = new Date()) {
  if (call.status === "cancelled") return "This call was cancelled.";
  if (call.endedAt || call.cappedAt) {
    const r = call.endReason || "calls_cap";
    // (Batch 26 section 2) "blocked:<side that blocked>"; an older row's plain "blocked" reads as cancelled on both pages.
    if (r.startsWith("blocked")) return blockEndedLine(r === `blocked:${side}`, otherName);
    return r === "calls_cap" ? capEndedLine(otherName) : r === "length" ? LENGTH_ENDED_LINE : closedEndedLine(callClosedLineOf(r, side, call.contract.endKind));
  }
  if (call.measuredAt || call.actualMinutes != null) return (call.measuredMinutes ?? 0) > 0 ? callEndedLine(fmtFor(tz, call.measuredTo ?? call.measuredAt ?? now, "time")) : CALL_OVER_LINE;
  if (now.getTime() > measureDeadline(call.startsAt, call.minutes).getTime()) return CALL_OVER_LINE;
  return closed;
}

async function refusal(callId: string, user: { id: string; timeZone?: string | null }, side: "tester" | "developer") {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!call) return new HttpError(403, "not_available", CALL_NOT_AVAILABLE);
  const other = side === "tester" ? call.contract.test.developer : call.contract.tester;
  const closed = call.status === "booked" && !call.endedAt && !call.measuredAt ? await callClosedLine(call, side) : "";
  return new HttpError(403, "not_available", CALL_NOT_AVAILABLE, { line: callLineFor(call, side, displayName(other), user, closed) });
}

/** Each side's latest poll (its page is open in the room), and its first one (the call's "joined" time). */
async function markSeen(call: { id: string; devJoinedAt: Date | null; testerJoinedAt: Date | null }, side: "tester" | "developer", now: Date) {
  await db.call.update({
    where: { id: call.id },
    data: side === "developer" ? { devSeenAt: now, ...(call.devJoinedAt ? {} : { devJoinedAt: now }) } : { testerSeenAt: now, ...(call.testerJoinedAt ? {} : { testerJoinedAt: now }) },
  });
}
/** (Batch 21 section 3) "Connected": extends this person's current connected stretch, or starts a new one after a gap of 5 minutes or more. */
async function extendConnected(callId: string, userId: string, side: "tester" | "developer", now: Date) {
  const last = await db.callPresence.findFirst({ where: { callId, userId }, orderBy: { endAt: "desc" } });
  if (last && now.getTime() - last.endAt.getTime() < PRESENCE_GAP_MS) await db.callPresence.update({ where: { id: last.id }, data: { endAt: now } });
  else await db.callPresence.create({ data: { callId, userId, side, startAt: now, endAt: now } });
}

/**
 * (Batch 15 section 40; batch 21 section 3) One "connected" report from a person's call room (their browser is connected to the other's): extends their connected
 * stretch. Only while the room is open; never for a cancelled or ended call. The report that reaches the planned end ends the call.
 */
export async function heartbeat(user: { id: string }, callId: string, now = new Date()) {
  const call = await loadRoomCall(callId);
  const side = call && sideIn(call, user.id);
  if (!call || !side) throw new HttpError(403, "not_available", CALL_NOT_AVAILABLE);
  if (await roomShut(call, now)) return { counted: false };
  await markSeen(call, side, now);
  await extendConnected(call.id, user.id, side, now);
  const s = await callEndState(callId, now);
  return { counted: !s?.ended };
}

/**
 * The room's poll (every 1-2 seconds): refused for anyone but the booked tester and the test's developer, before 10 minutes ahead and once it ended ("This call isn't
 * available.", with the ending line for its two people). Counts as this person being in the room, and (with `connected`) as connected. Returns the other person's
 * messages after `after`, whether they're in the room, the measured minutes so far and, 2 minutes before a planned end, "This call ends at 3:42 PM."
 */
export async function roomPoll(user: { id: string; timeZone?: string | null }, callId: string, after: number, connected: boolean, now = new Date()) {
  const call = await loadRoomCall(callId);
  const side = call && sideIn(call, user.id);
  if (!call || !side) throw new HttpError(403, "not_available", CALL_NOT_AVAILABLE);
  if (await roomShut(call, now)) throw await refusal(callId, user, side);
  await markSeen(call, side, now);
  if (connected) await extendConnected(call.id, user.id, side, now);
  const state = await callEndState(callId, now);
  if (state?.ended) throw await refusal(callId, user, side);
  const otherId = side === "tester" ? call.contract.test.developerId : call.contract.testerId;
  const [signals, presences] = await Promise.all([
    db.callSignal.findMany({ where: { callId, fromId: otherId, id: { gt: after } }, orderBy: { id: "asc" }, take: 200 }),
    db.callPresence.findMany({ where: { callId } }),
  ]);
  const otherSeen = side === "tester" ? call.devSeenAt : call.testerSeenAt;
  const warn = state && !state.ended && state.together && state.endsAt.getTime() - now.getTime() <= END_WARN_MS ? endWarnLine(fmtFor(user, state.endsAt, "time")) : "";
  return {
    signals: signals.map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })),
    otherHere: !!otherSeen && now.getTime() - otherSeen.getTime() < ROOM_HERE_MS,
    measured: measureOverlap(spansOf(presences, "developer"), spansOf(presences, "tester"), call.minutes).minutes,
    warn,
  };
}
/** The other person counts as in the room while their last poll is this recent. */
const ROOM_HERE_MS = 10_000;
const ROOM_KINDS = ["description", "candidate", "media", "bye", "state", "join"];
const MAX_SIGNAL = 64_000;

/**
 * A message from the room: a connection message for the other browser (offer/answer, candidate, camera and microphone state, "left"), or (`state`) this browser's
 * connection changing: `{ connected: true }` starts or extends the connected stretch at once. `join`: this browser came (back) into the room: the older messages
 * (for a connection that's gone) are cleared and the other browser starts a fresh connection. Checked like the poll.
 */
export async function roomSend(user: { id: string; timeZone?: string | null }, callId: string, kind: unknown, payload: unknown, now = new Date()) {
  const call = await loadRoomCall(callId);
  const side = call && sideIn(call, user.id);
  if (!call || !side) throw new HttpError(403, "not_available", CALL_NOT_AVAILABLE);
  const k = String(kind ?? "");
  if (!ROOM_KINDS.includes(k)) throw new HttpError(400, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  if (await roomShut(call, now)) throw await refusal(callId, user, side);
  if (k === "state") {
    await markSeen(call, side, now);
    if ((payload as { connected?: unknown } | null)?.connected === true) await extendConnected(call.id, user.id, side, now);
    if ((await callEndState(callId, now))?.ended) throw await refusal(callId, user, side);
    return { sent: true };
  }
  if (k === "join") {
    await markSeen(call, side, now);
    await db.callSignal.deleteMany({ where: { callId } });
    const s = await db.callSignal.create({ data: { callId, fromId: user.id, kind: "join", payload: "null" } });
    return { sent: true, id: s.id };
  }
  const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (body.length > MAX_SIGNAL) throw new HttpError(413, "too_large", "That's too much to send at once. Try sending less at once.");
  const s = await db.callSignal.create({ data: { callId, fromId: user.id, kind: k, payload: body } });
  return { sent: true, id: s.id };
}

/** Leave (hang up): the other side is told; the measured minutes so far come back. The room stays open to rejoin until the call ends. */
export async function roomLeave(user: { id: string }, callId: string, now = new Date()) {
  const call = await loadRoomCall(callId);
  const side = call && sideIn(call, user.id);
  if (!call || !side) throw new HttpError(403, "not_available", CALL_NOT_AVAILABLE);
  if (!(await roomShut(call, now))) await db.callSignal.create({ data: { callId, fromId: user.id, kind: "bye", payload: "null" } });
  const fresh = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { presences: true } });
  return { measured: fresh.measuredAt ? (fresh.measuredMinutes ?? 0) : measureOverlap(spansOf(fresh.presences, "developer"), spansOf(fresh.presences, "tester"), fresh.minutes).minutes };
}

/**
 * (NEWEST+8) AUTO-CANCEL: a call nobody joined by its halfway point is cancelled ("Nobody joined, so the call was cancelled."): no charge, never a no-show, both told.
 * (Batch 15 section 40) Then each call's measured length is made final once both have left or 30 minutes after its latest allowed end; with no overlap at all the same
 * "nobody joined" cancel applies. Checked on every page load / poll and by the daily job, so it is minute-accurate while anyone has a page open.
 */
export async function sweepNobodyJoined(now = new Date()) {
  await remindCallsSoon(now);
  const due = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Call" WHERE status = 'booked' AND "devJoinedAt" IS NULL AND "testerJoinedAt" IS NULL AND "noShowBy" IS NULL AND "measuredAt" IS NULL AND "actualMinutes" IS NULL AND NOT EXISTS (SELECT 1 FROM "CallPresence" p WHERE p."callId" = "Call".id) AND "startsAt" > (${new Date(now.getTime() - 7 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC') AND "startsAt" + ("minutes" * interval '30 seconds') <= (${now}::timestamptz AT TIME ZONE 'UTC')`;
  for (const { id } of due) await cancelNobodyJoined(id, now);
  await finishMeasuring(now);
  return due.length;
}

// ---------- (Owner, Oct 28, batch 18 section 12) The reminder 15 minutes before each booked call ----------
export const CALL_REMINDER_MIN = 15;
/** "Your call with Ana on “Harbor Run” starts at 3:00 PM." (the time token is written in each reader's zone). */
export const callReminderLine = (who: string, test: string, startsAt: Date) => `Your call with ${who} on “${test}” starts at ${T(startsAt, "time")}.`;
const reminderKey = (callId: string) => `call15:${callId}`;

/**
 * Bell and email (following each person's email setting) 15 minutes before a booked call, to both, the same line. Once per call and person; none for a call booked
 * less than 15 minutes ahead. Checked with the call sweep (every page load / poll, and the daily job). It opens the call's row, where "Check your call setup" is.
 */
export async function remindCallsSoon(now = new Date()) {
  const soon = new Date(now.getTime() + CALL_REMINDER_MIN * 60_000);
  const calls = await db.call.findMany({
    where: { status: "booked", startsAt: { gt: now, lte: soon } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
  });
  let n = 0;
  for (const call of calls) {
    if (call.createdAt.getTime() > call.startsAt.getTime() - CALL_REMINDER_MIN * 60_000) continue; // booked less than 15 minutes ahead
    const c = call.contract, dev = c.test.developer, tester = c.tester;
    if (!(await db.notification.count({ where: { userId: tester.id, reminderKey: reminderKey(call.id) } }))) {
      const line = callReminderLine(displayName(dev), c.title, call.startsAt);
      await notify(tester.email, line, [line], `/app/sessions/${c.id}#call-${call.id}`, { about: dev.id, reminder: reminderKey(call.id) });
      n++;
    }
    if (!(await db.notification.count({ where: { userId: dev.id, reminderKey: reminderKey(call.id) } }))) {
      const line = callReminderLine(displayName(tester), c.title, call.startsAt);
      await notify(dev.email, line, [line], `/app/tests/${c.testId}#call-${call.id}`, { about: tester.id, reminder: reminderKey(call.id) });
      n++;
    }
  }
  return n;
}

/** A call cancelled by the app because nobody joined it, or (batch 21 section 4) because both opened the room but their browsers never connected. No charge. */
async function cancelNobodyJoined(id: string, now: Date, note = NOBODY_JOINED) {
  const done = await db.call.updateMany({ where: { id, status: "booked", measuredAt: null }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: note } });
  if (done.count !== 1) return;
  await db.callSignal.deleteMany({ where: { callId: id } });
  const call = await db.call.findUniqueOrThrow({ where: { id }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  const line = `Your call on ${T(call.startsAt)}: ${note}`;
  // (Batch 15 section 42) A call that's over links to the tester's Call history / the developer's tester row (#call-<id> is there once it's over).
  await notify(call.contract.tester.email, line, [line, "Nothing is charged."], `/app/sessions/${call.contractId}#call-${call.id}`);
  await notify(call.contract.test.developer.email, line.replace("Your call", `Your call with ${displayName(call.contract.tester)}`), [line, "Nothing is charged."], `/app/tests/${call.contract.testId}#call-${call.id}`);
}

/**
 * (Batch 15 section 40) Measured lengths that are final now are stored (and the call's 7-day review clock starts at its end). (Batch 21 section 2) A call in progress
 * that something closed, or that reached its planned end, is ended here too.
 */
export async function finishMeasuring(now = new Date()) {
  const open = await db.call.findMany({ where: { status: "booked", measuredAt: null, actualMinutes: null, startsAt: { lte: now, gt: new Date(now.getTime() - 30 * 86_400_000) } }, include: roomInclude, take: 500 });
  let n = 0;
  for (const call of open) {
    const dev = spansOf(call.presences, "developer"), tes = spansOf(call.presences, "tester");
    if (call.presences.length && together(call.presences).ms > 0) {
      const kind = await callClosedKindOf(call);
      if (kind) {
        if (await endCall(call, kind, now, now)) n++;
        continue;
      }
    }
    if ((await callEndState(call.id, now, call))?.ended) {
      n++;
      continue;
    }
    // Both have left: each one's last sign of being in the room (connected, or the page polling) 5 minutes or more ago.
    const seen = (at: Date | null): Span[] => (at ? [{ startAt: at, endAt: at }] : []);
    if (!measureIsFinal(call, [...dev, ...seen(call.devSeenAt)], [...tes, ...seen(call.testerSeenAt)], now)) continue;
    let m = measureOverlap(dev, tes, call.minutes);
    // A call that started before measuring existed (both joined, nothing kept from the room): the booked length, the old rule.
    if (!call.presences.length && !call.devSeenAt && !call.testerSeenAt && call.devJoinedAt && call.testerJoinedAt) m = { minutes: call.minutes, ms: call.minutes * 60_000, from: null, to: null };
    if (m.ms <= 0 && !call.noShowBy) {
      // (Batch 21 section 4) Both were in the room but their browsers never connected (a strict network): nothing measured, cancelled, no charge.
      await cancelNobodyJoined(call.id, now, call.devSeenAt && call.testerSeenAt ? COULD_NOT_CONNECT : NOBODY_JOINED);
      continue;
    }
    const capMinutes = await callCapMinutes(call); // (batch 18 section 3) capped at the $1,000 as well as at 150%
    const minutes = m.ms > 0 ? Math.min(Math.max(1, m.minutes), capMinutes ?? Number.POSITIVE_INFINITY) : 0;
    const end = m.to ?? new Date(call.startsAt.getTime() + call.minutes * 60_000);
    await db.call.updateMany({ where: { id: call.id, measuredAt: null }, data: { measuredMinutes: minutes, measuredFrom: m.from, measuredTo: m.to, measuredAt: now, payBy: payByFrom(end) } });
    await db.callSignal.deleteMany({ where: { callId: call.id } });
    n++;
  }
  return n;
}
