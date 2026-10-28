import { db } from "@/lib/db";
import { T } from "@/lib/tz";
import { displayName, fmtDateTime, pronouns } from "@/lib/format";
import { cancelLine, checkCancel, type TestEventLike, NOBODY_JOINED, JOIN_OPENS_MIN, PAY_WAITS, payByFrom } from "@/lib/rules";
import { PRESENCE_GAP_MS, callMinutesOf, checkLower, measureDeadline, measureIsFinal, measureOverlap } from "@/lib/callMeasure";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { notify } from "./notify";
import { testerGate as sharedTesterGate } from "./testerGate";
import { devGate, devGateIfSeen, devOnHold, ownContract, ownTest, recordEvent, staleNote } from "./tests";

type U = { id: string; email: string; name: string; pronoun: string };


/** The simple room: the developer's own link if they gave one, otherwise a free Jitsi room named after the call. */
export const roomUrl = (call: { id: string }, slot: { link: string }) => slot.link || `https://meet.jit.si/playtest-${call.id}`;

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
    if (c.status === "cancelled") throw new HttpError(409, "cancelled", `The call with ${name} was already cancelled.` + (await staleNote(testId, body.seenAt)));
    const ok = checkCancel(c.startsAt, new Date(), reason);
    if (!ok.ok) throw new HttpError(400, "reason", ok.message);
    await devGate(tx, testId, body);
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
  if (side === "developer") await devGateIfSeen(call.contract.testId, body);
  else await sharedTesterGate(user.id, call.contractId, call.contract.testId, body);
  await db.call.update({ where: { id: call.id }, data: { noShowBy: side, noShowNote: note, noShowAt: new Date() } });
  return { reported: true };
}

/**
 * (Owner, Oct 30, batch 15 section 40) The developer can only LOWER a call's measured length, with a reason the tester reads, in the call's Pay box ("Lower the length").
 * Never raise it. Only once the length is final, and before the call is paid. The same stop-once and hold / suspension refusals as Pay.
 */
export async function lowerCallLength(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const reason = readText(body.reason, LIMITS.reason, "reason");
  const minutes = typeof body.minutes === "number" ? body.minutes : typeof body.minutes === "string" && body.minutes.trim() ? Number(body.minutes) : null;
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", PAY_WAITS);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const call = await tx.call.findUnique({ where: { id: String(body.callId ?? "") }, include: { contract: true, review: true } });
    if (!call || call.contract.testId !== testId) throw new HttpError(404, "not_found", "That call doesn't exist.");
    if (call.status !== "booked") throw new HttpError(409, "cancelled", "This call was cancelled.");
    if (call.review) throw new HttpError(409, "paid", "This call was already paid, so its length can't change.");
    const current = callMinutesOf(call);
    if (current == null) throw new HttpError(409, "measuring", MEASURING_REFUSAL);
    const ok = checkLower(minutes, current, reason);
    if (!ok.ok) throw new HttpError(400, "bad_minutes", ok.message);
    await devGate(tx, testId, body);
    await tx.call.update({ where: { id: call.id }, data: { actualMinutes: minutes!, lengthNote: reason } });
    await recordEvent(tx, testId, "lowered", `You lowered the length of the call on ${fmtDateTime(call.startsAt)} to ${minutes} min`, false, {}, call.contractId);
    return { minutes };
  });
}
export const MEASURING_REFUSAL = "This call is still being measured: you can pay it once its length is final.";

/**
 * (Batch 15 section 40) A heartbeat from the call page (every ~10 seconds while it's open): extends this person's current stretch, or starts a new one after a gap of 5
 * minutes or more. Only from 10 minutes before the call until its length is final; never for a cancelled call.
 */
export async function heartbeat(user: { id: string }, callId: string, now = new Date()) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: true } } } });
  const side = call?.contract.testerId === user.id ? "tester" : call?.contract.test.developerId === user.id ? "developer" : null;
  if (!call || !side) throw new HttpError(404, "not_found", "That call doesn't exist.");
  if (call.status !== "booked" || call.measuredAt || call.actualMinutes != null) return { counted: false };
  if (now.getTime() < call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000 || now.getTime() > measureDeadline(call.startsAt, call.minutes).getTime()) return { counted: false };
  const last = await db.callPresence.findFirst({ where: { callId, userId: user.id }, orderBy: { endAt: "desc" } });
  if (last && now.getTime() - last.endAt.getTime() < PRESENCE_GAP_MS) await db.callPresence.update({ where: { id: last.id }, data: { endAt: now } });
  else await db.callPresence.create({ data: { callId, userId: user.id, side, startAt: now, endAt: now } });
  if (side === "developer" && !call.devJoinedAt) await db.call.update({ where: { id: call.id }, data: { devJoinedAt: now } });
  if (side === "tester" && !call.testerJoinedAt) await db.call.update({ where: { id: call.id }, data: { testerJoinedAt: now } });
  return { counted: true };
}

/**
 * (NEWEST+8) AUTO-CANCEL: a call nobody joined by its halfway point is cancelled ("Nobody joined, so the call was cancelled."): no charge, never a no-show, both told.
 * (Batch 15 section 40) Then each call's measured length is made final once both have left or 30 minutes after its latest allowed end; with no overlap at all the same
 * "nobody joined" cancel applies. Checked on every page load / poll and by the daily job, so it is minute-accurate while anyone has a page open.
 */
export async function sweepNobodyJoined(now = new Date()) {
  const due = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Call" WHERE status = 'booked' AND "devJoinedAt" IS NULL AND "testerJoinedAt" IS NULL AND "noShowBy" IS NULL AND "measuredAt" IS NULL AND "actualMinutes" IS NULL AND NOT EXISTS (SELECT 1 FROM "CallPresence" p WHERE p."callId" = "Call".id) AND "startsAt" > (${new Date(now.getTime() - 7 * 86_400_000)}::timestamptz AT TIME ZONE 'UTC') AND "startsAt" + ("minutes" * interval '30 seconds') <= (${now}::timestamptz AT TIME ZONE 'UTC')`;
  for (const { id } of due) await cancelNobodyJoined(id, now);
  await finishMeasuring(now);
  return due.length;
}

async function cancelNobodyJoined(id: string, now: Date) {
  const done = await db.call.updateMany({ where: { id, status: "booked", measuredAt: null }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: NOBODY_JOINED } });
  if (done.count !== 1) return;
  const call = await db.call.findUniqueOrThrow({ where: { id }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  const line = `Your call on ${T(call.startsAt)}: ${NOBODY_JOINED}`;
  // (Batch 15 section 42) A call that's over links to the tester's Call history / the developer's tester row (#call-<id> is there once it's over).
  await notify(call.contract.tester.email, line, [line, "Nothing is charged."], `/app/sessions/${call.contractId}#call-${call.id}`);
  await notify(call.contract.test.developer.email, line.replace("Your call", `Your call with ${displayName(call.contract.tester)}`), [line, "Nothing is charged."], `/app/tests/${call.contract.testId}#call-${call.id}`);
}

/** (Batch 15 section 40) Measured lengths that are final now are stored (and the call's 7-day review clock starts at its end). */
export async function finishMeasuring(now = new Date()) {
  const open = await db.call.findMany({ where: { status: "booked", measuredAt: null, actualMinutes: null, startsAt: { lte: now, gt: new Date(now.getTime() - 30 * 86_400_000) } }, include: { presences: true }, take: 500 });
  let n = 0;
  for (const call of open) {
    const dev = call.presences.filter((p) => p.side === "developer"), tes = call.presences.filter((p) => p.side === "tester");
    if (!measureIsFinal(call, dev, tes, now)) continue;
    let m = measureOverlap(dev, tes, call.minutes);
    // A call that started before measuring existed (both joined, no heartbeats kept): the booked length, the old rule.
    if (!call.presences.length && call.devJoinedAt && call.testerJoinedAt) m = { minutes: call.minutes, ms: call.minutes * 60_000, from: null, to: null };
    if (m.ms <= 0 && !call.noShowBy) {
      await cancelNobodyJoined(call.id, now);
      continue;
    }
    const minutes = m.ms > 0 ? Math.max(1, m.minutes) : 0;
    const end = m.to ?? new Date(call.startsAt.getTime() + call.minutes * 60_000);
    await db.call.updateMany({ where: { id: call.id, measuredAt: null }, data: { measuredMinutes: minutes, measuredFrom: m.from, measuredTo: m.to, measuredAt: now, payBy: payByFrom(end) } });
    n++;
  }
  return n;
}
