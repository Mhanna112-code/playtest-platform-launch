import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { T } from "@/lib/tz";
import { displayName, fmtDateTime, pronouns } from "@/lib/format";
import { callCheckRoom, callClosedToJoins, cancelLine, checkCancel, type TestEventLike, NOBODY_JOINED, JOIN_OPENS_MIN, payByFrom, testPaused } from "@/lib/rules";
import { MEASURE_CAP, PRESENCE_GAP_MS, capEnd, capMinutesFor, measureDeadline, measureIsFinal, measureOverlap, type Span } from "@/lib/callMeasure";
import { callsLeftCents } from "./callMoney";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { notify } from "./notify";
import { testerGate as sharedTesterGate } from "./testerGate";
import { devGate, devGateIfSeen, ownContract, ownTest, recordEvent, staleNote } from "./tests";
import { CALL_ACTS } from "./live";

type U = { id: string; email: string; name: string; pronoun: string };


/** (Owner, Oct 28, batch 18 section 10) Every call uses its Jitsi room, named after the call: there is no own-link option any more (CallSlot.link is never read). */
export const roomUrl = (call: { id: string }) => `https://meet.jit.si/playtest-${call.id}`;

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

/**
 * (Batch 15 section 40) A heartbeat from the call page (every ~10 seconds while it's open): extends this person's current stretch, or starts a new one after a gap of 5
 * minutes or more. Only from 10 minutes before the call until its length is final; never for a cancelled call.
 */
export async function heartbeat(user: { id: string }, callId: string, now = new Date()) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { test: { include: { developer: true } } } } } });
  const side = call?.contract.testerId === user.id ? "tester" : call?.contract.test.developerId === user.id ? "developer" : null;
  if (!call || !side) throw new HttpError(404, "not_found", "That call doesn't exist.");
  if (call.status !== "booked" || call.measuredAt || call.actualMinutes != null) return { counted: false };
  if (now.getTime() < call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000 || now.getTime() > measureDeadline(call.startsAt, call.minutes).getTime()) return { counted: false };
  const last = await db.callPresence.findFirst({ where: { callId, userId: user.id }, orderBy: { endAt: "desc" } });
  // (Batch 18 section 9) Closed to joins meanwhile (a pause, a block, a suspension, a leave, End early, a Stop): whoever is still on the call page keeps counting
  // (a reload within the 5-minute gap is staying); someone who left can't come back into it.
  const staying = !!last && now.getTime() - last.endAt.getTime() < PRESENCE_GAP_MS;
  if (!staying && (await callClosedLine(call, side))) return { counted: false };
  if (last && now.getTime() - last.endAt.getTime() < PRESENCE_GAP_MS) await db.callPresence.update({ where: { id: last.id }, data: { endAt: now } });
  else await db.callPresence.create({ data: { callId, userId: user.id, side, startAt: now, endAt: now } });
  if (side === "developer" && !call.devJoinedAt) await db.call.update({ where: { id: call.id }, data: { devJoinedAt: now } });
  if (side === "tester" && !call.testerJoinedAt) await db.call.update({ where: { id: call.id }, data: { testerJoinedAt: now } });
  // (Batch 18 section 3) The beat that reaches the $1,000 ends the call: measuring stops there.
  const cap = await callCapState(callId, now);
  return { counted: !cap?.ended };
}

/** (Batch 18 section 9) Why this call can't be (re-)joined any more, though it may still be in progress; "" when it's open. */
export async function callClosedLine(call: { contract: { testerId: string; status: string; test: { developerId: string; status: string; adminPausedAt: Date | null; developer: { holdStartedAt: Date | null; devSuspendedAt: Date | null } } } }, side: "tester" | "developer") {
  const c = call.contract;
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) > 0;
  return callClosedToJoins({ blocked, paused: testPaused(c.test.developer, c.test), testStatus: c.test.status, contractStatus: c.status, side });
}
/** (Batch 18 section 9) Is this person on the call page right now (a heartbeat within the 5-minute gap)? */
export async function onCallNow(callId: string, userId: string, now = new Date()) {
  const last = await db.callPresence.findFirst({ where: { callId, userId }, orderBy: { endAt: "desc" } });
  return !!last && now.getTime() - last.endAt.getTime() < PRESENCE_GAP_MS;
}

// ---------- (Owner, Oct 28 evening, batch 18 section 3) A call ends when its pay would pass what's left of the $1,000 ----------
type CapCall = { id: string; contractId: string; status: string; rateCents: number | null; minutes: number; startsAt: Date; measuredAt: Date | null; actualMinutes: number | null; cappedAt: Date | null };
const spansOf = (presences: { side: string; startAt: Date; endAt: Date }[], side: string): Span[] => presences.filter((p) => p.side === side);

/**
 * The most minutes this call can be paid before its pay at the call's rate reaches what's left of the $1,000 for that tester's calls on this test (this call's own
 * booked reservation not counted); null when that never binds before the 150% cap (or the call is free).
 */
export async function callCapMinutes(call: Pick<CapCall, "id" | "contractId" | "rateCents" | "minutes">) {
  const cap = capMinutesFor(call.rateCents, await callsLeftCents(call.contractId, db, call.id));
  return cap == null || cap >= Math.floor(call.minutes * MEASURE_CAP) ? null : cap;
}

/** Ends a call at the $1,000: its length is final now, capped at that point (and at 150% of the booked length). */
async function endAtCap(call: CapCall, dev: Span[], tes: Span[], capMinutes: number, endsAt: Date, now: Date) {
  const m = measureOverlap(dev, tes, call.minutes);
  const to = m.to && m.to.getTime() > endsAt.getTime() ? endsAt : m.to;
  await db.call.updateMany({
    where: { id: call.id, status: "booked", measuredAt: null, actualMinutes: null, cappedAt: null },
    data: { cappedAt: endsAt, measuredMinutes: Math.min(m.ms > 0 ? Math.max(1, m.minutes) : 0, capMinutes), measuredFrom: m.from, measuredTo: to, measuredAt: now, payBy: payByFrom(to ?? endsAt) },
  });
}

/**
 * Where a call stands against the $1,000 (checked by both call pages every few seconds, by each heartbeat, by Join and by the measuring sweep): `ended` once its pay
 * reached what's left (the call is then ended and measured there); otherwise `endsAt`, the projected moment, while that comes before the 150% cap; null when it doesn't apply.
 */
export async function callCapState(callId: string, now = new Date(), loaded?: CapCall & { presences: { side: string; startAt: Date; endAt: Date }[] }) {
  const call = loaded ?? (await db.call.findUnique({ where: { id: callId }, include: { presences: true } }));
  if (!call) return null;
  if (call.cappedAt) return { ended: true, endsAt: call.cappedAt };
  if (call.status !== "booked" || call.measuredAt || call.actualMinutes != null || call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000 > now.getTime()) return null;
  const capMinutes = await callCapMinutes(call);
  if (capMinutes == null) return null;
  const dev = spansOf(call.presences, "developer"), tes = spansOf(call.presences, "tester");
  const e = capEnd(dev, tes, capMinutes, now);
  if (!e.reached) return { ended: false, endsAt: e.endsAt };
  await endAtCap(call, dev, tes, capMinutes, e.endsAt, now);
  return { ended: true, endsAt: e.endsAt };
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

// ---------- (Owner, Oct 28, batch 18 section 13) "Check your call setup": each account's private Jitsi practice room ----------
/** The account's practice room (an unguessable id, the same for that account, made on first use). Never a call, never measured. */
export async function callCheckUrl(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { callCheckId: true } });
  if (u?.callCheckId) return callCheckRoom(u.callCheckId);
  await db.user.updateMany({ where: { id: userId, callCheckId: null }, data: { callCheckId: randomBytes(12).toString("hex") } });
  const again = await db.user.findUnique({ where: { id: userId }, select: { callCheckId: true } });
  return again?.callCheckId ? callCheckRoom(again.callCheckId) : "";
}

// ---------- (Owner, Oct 28, batch 18 section 12) The reminder 15 minutes before each booked call ----------
export const CALL_REMINDER_MIN = 15;
/** "Your call with Ana on “Harbor Run” starts at 3:00 PM." (the time token is written in each reader's zone). */
export const callReminderLine = (who: string, test: string, startsAt: Date) => `Your call with ${who} on “${test}” starts at ${T(startsAt, "time")}.`;
export const JITSI_HOST_TIP = "Open it a few minutes early: Jitsi asks the first person to sign in with Google, GitHub or Facebook.";
const reminderKey = (callId: string) => `call15:${callId}`;

/**
 * Bell and email (following each person's email setting) 15 minutes before a booked call, to both; the developer's adds the Jitsi sign-in tip. Once per call and person;
 * none for a call booked less than 15 minutes ahead. Checked with the call sweep (every page load / poll, and the daily job). (Batch 18 section 13) It opens the call's row,
 * where "Check your call setup" is.
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
      const line = `${callReminderLine(displayName(tester), c.title, call.startsAt)} ${JITSI_HOST_TIP}`;
      await notify(dev.email, line, [line], `/app/tests/${c.testId}#call-${call.id}`, { about: tester.id, reminder: reminderKey(call.id) });
      n++;
    }
  }
  return n;
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
    // (Batch 18 section 3) A call whose pay reached what's left of the $1,000 ends there.
    if ((await callCapState(call.id, now, call))?.ended) {
      n++;
      continue;
    }
    if (!measureIsFinal(call, dev, tes, now)) continue;
    let m = measureOverlap(dev, tes, call.minutes);
    // A call that started before measuring existed (both joined, no heartbeats kept): the booked length, the old rule.
    if (!call.presences.length && call.devJoinedAt && call.testerJoinedAt) m = { minutes: call.minutes, ms: call.minutes * 60_000, from: null, to: null };
    if (m.ms <= 0 && !call.noShowBy) {
      await cancelNobodyJoined(call.id, now);
      continue;
    }
    const capMinutes = await callCapMinutes(call); // (batch 18 section 3) capped at the $1,000 as well as at 150%
    const minutes = m.ms > 0 ? Math.min(Math.max(1, m.minutes), capMinutes ?? Number.POSITIVE_INFINITY) : 0;
    const end = m.to ?? new Date(call.startsAt.getTime() + call.minutes * 60_000);
    await db.call.updateMany({ where: { id: call.id, measuredAt: null }, data: { measuredMinutes: minutes, measuredFrom: m.from, measuredTo: m.to, measuredAt: now, payBy: payByFrom(end) } });
    n++;
  }
  return n;
}
