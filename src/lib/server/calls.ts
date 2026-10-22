import { db } from "@/lib/db";
import { displayName, fmtDateTime, pronouns, toCents } from "@/lib/format";
import { cancelLine, LENGTH_WAITS, checkActualMinutes, checkAsk, checkCancel, PAUSED_FOR_TESTERS, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { testerGate as sharedTesterGate } from "./testerGate";
import { devGate, devOnHold, ownContract, ownTest, recordEvent, sessionRefusal, staleNote } from "./tests";

type U = { id: string; email: string; name: string; pronoun: string };

export const MAX_TIMES_PER_PRESS = 5;
export const MAX_TIMES_PER_TEST = 50;

/** The simple room: the developer's own link if they gave one, otherwise a free Jitsi room named after the call. */
export const roomUrl = (call: { id: string }, slot: { link: string }) => slot.link || `https://meet.jit.si/playtest-${call.id}`;

const canSee = (slot: { allowedTesterIds: string[] }, testerId: string) => slot.allowedTesterIds.length === 0 || slot.allowedTesterIds.includes(testerId);

// ---------- developer: the live-call panel (same stop-once gate as every developer button) ----------

export async function offerTimes(dev: U, testId: string, body: Record<string, unknown>) {
  const t0 = await ownTest(dev.id, testId);
  const raw = Array.isArray(body.times) ? body.times.filter((x): x is string => typeof x === "string" && !!x) : [];
  if (raw.length === 0) throw new HttpError(400, "no_times", "Pick at least one time.");
  if (raw.length > MAX_TIMES_PER_PRESS) throw new HttpError(400, "too_many", `Up to ${MAX_TIMES_PER_PRESS} times at once.`);
  const times = raw.map((s) => new Date(s));
  if (times.some((d) => isNaN(d.getTime()))) throw new HttpError(400, "bad_time", "Pick each time from the date and time box.");
  if (times.some((d) => d.getTime() < Date.now() + 5 * 60_000)) throw new HttpError(400, "past", "Pick times in the future.");
  const minutes = Number(body.minutes) || t0.liveMinutes || 30;
  if (minutes < 10 || minutes > 180) throw new HttpError(400, "bad_minutes", "A call lasts from 10 to 180 minutes.");
  const link = typeof body.link === "string" ? body.link.trim().slice(0, 500) : "";
  if (link && !/^https:\/\//i.test(link)) throw new HttpError(400, "bad_link", "The call link must start with https://");
  const want = Array.isArray(body.allowedTesterIds) ? body.allowedTesterIds.filter((x): x is string => typeof x === "string") : [];

  const slots = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const t = await tx.test.findUniqueOrThrow({ where: { id: testId } });
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    if (t.status === "closed") throw new HttpError(409, "closed", "This test was closed, so no call times can be offered.");
    if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", "Your tests are paused, so no call times can be offered. Pay what you owe first.");
    await devGate(tx, testId, body.seenAt, body.confirmed === true);
    const inTest = await tx.contract.findMany({ where: { testId, status: "working" }, select: { testerId: true } });
    const allowed = want.filter((id) => inTest.some((c) => c.testerId === id));
    if (want.length && !allowed.length) throw new HttpError(409, "none_can_book", "None of the testers you ticked can book a call now." + (await staleNote(testId, body.seenAt)));
    const existing = await tx.callSlot.findMany({ where: { testId, status: { in: ["open", "booked"] } } });
    if (existing.length + times.length > MAX_TIMES_PER_TEST) throw new HttpError(409, "full", `A test can hold at most ${MAX_TIMES_PER_TEST} call times.`);
    for (const d of times) {
      const end = d.getTime() + minutes * 60_000;
      const clash = existing.find((s) => s.startsAt.getTime() < end && s.startsAt.getTime() + s.minutes * 60_000 > d.getTime());
      if (clash) throw new HttpError(409, "clash", `You already have a call time then: ${fmtDateTime(clash.startsAt)}. Pick another time.`);
    }
    const made = [];
    for (const d of times) made.push(await tx.callSlot.create({ data: { testId, startsAt: d, minutes, allowedTesterIds: allowed, link } }));
    await recordEvent(tx, testId, "offered", `You offered ${times.length} call time${times.length === 1 ? "" : "s"}`, false);
    return made;
  });
  await (await import("./requests")).matchOffered(testId);
  return { offered: slots.length };
}

export async function removeTime(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const slotId = String(body.slotId ?? "");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const s = await tx.callSlot.findUnique({ where: { id: slotId } });
    if (!s || s.testId !== testId) throw new HttpError(404, "not_found", "That call time doesn't exist.");
    const stale = await staleNote(testId, body.seenAt);
    if (s.status === "booked") throw new HttpError(409, "booked", "A tester already booked this time. Cancel the call instead." + stale);
    if (s.status !== "open") throw new HttpError(409, "removed", "This time was already removed." + stale);
    await devGate(tx, testId, body.seenAt, body.confirmed === true);
    await tx.callSlot.update({ where: { id: s.id }, data: { status: "removed" } });
    await recordEvent(tx, testId, "removed", `You removed the call time ${fmtDateTime(s.startsAt)}`, false);
  });
  return { removed: true };
}

/** Developer cancels a booked call: 24 hours or more ahead only. The time is removed. */
export async function devCancelCall(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const callId = String(body.callId ?? "");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const call = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const c = await tx.call.findUnique({ where: { id: callId }, include: { contract: { include: { tester: true } } } });
    if (!c || c.contract.testId !== testId) throw new HttpError(404, "not_found", "That call doesn't exist.");
    const name = displayName(c.contract.tester);
    if (c.status === "cancelled") throw new HttpError(409, "cancelled", `The call with ${name} was already cancelled.` + (await staleNote(testId, body.seenAt)));
    const ok = checkCancel(c.startsAt, new Date(), reason);
    if (!ok.ok) throw new HttpError(400, "reason", ok.message);
    await devGate(tx, testId, body.seenAt, body.confirmed === true);
    await tx.call.update({ where: { id: c.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date(), cancelNote: reason } });
    await tx.callSlot.update({ where: { id: c.slotId }, data: { status: "removed" } });
    await recordEvent(tx, testId, "cancelled", `You cancelled the call with ${name} on ${fmtDateTime(c.startsAt)}`, false, {}, c.contractId);
    return c;
  });
  const line = cancelLine(displayName(dev), call.startsAt, reason);
  await notify(call.contract.tester.email, line, [line], `/app/sessions/${call.contractId}`);
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

/** Any tester in the test may book an offered time (in their contract or not: extra). One upcoming call at a time. */
export async function bookTime(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const slotId = String(body.slotId ?? "");
  const dev = c0.test.developer;
  const askedCents = body.ask === undefined || body.ask === null || body.ask === "" ? null : toCents(body.ask);
  if (body.ask && askedCents == null) throw new HttpError(400, "bad_ask", "Enter the amount you ask like 7.50, or leave it empty.");
  const askOk = checkAsk(askedCents);
  if (!askOk.ok) throw new HttpError(400, "bad_ask", askOk.message);
  const { call, slot } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const t = await tx.test.findUniqueOrThrow({ where: { id: c0.testId } });
    const refusal = sessionRefusal(c, t, displayName(dev));
    if (refusal) throw new HttpError(409, "closed", refusal);
    if (await devOnHold(t.developerId)) throw new HttpError(409, "paused", PAUSED_FOR_TESTERS);
    if (t.status !== "open") throw new HttpError(409, "closed", t.status === "stopped" ? "This test was stopped, so calls can't be booked." : "This test was closed, so calls can't be booked.");
    const slot = await tx.callSlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.testId !== c.testId || !canSee(slot, tester.id)) throw new HttpError(404, "not_found", "That call time doesn't exist.");
    if ((await tx.block.count({ where: { OR: [{ blockerId: tester.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: tester.id }] } })) > 0) throw new HttpError(409, "gone", "This time isn't available.");
    if (slot.status !== "open") throw new HttpError(409, "gone", slot.status === "booked" ? "Someone already booked that time. Pick another." : "That time was removed. Pick another.");
    if (slot.startsAt <= new Date()) throw new HttpError(409, "past", "That time has passed. Pick another.");
    const upcoming = await tx.call.findFirst({ where: { contractId, status: "booked", startsAt: { gt: new Date() } } });
    if (upcoming) throw new HttpError(409, "has_call", `You already have a call booked: ${fmtDateTime(upcoming.startsAt)}.`);
    await testerGate(tester, c, body);
    await tx.callSlot.update({ where: { id: slot.id }, data: { status: "booked" } });
    const call = await tx.call.create({ data: { slotId: slot.id, contractId, startsAt: slot.startsAt, minutes: slot.minutes, rateCents: c.liveRateCents, askedCents } });
    await recordEvent(tx, c.testId, "booked", `${displayName(tester)} booked a call for ${fmtDateTime(slot.startsAt)}`, false, {}, c.id);
    return { call, slot };
  });
  await notify(dev.email, `${displayName(tester)} booked a call for “${c0.title}”`, [`${displayName(tester)} booked a live call for ${fmtDateTime(slot.startsAt)} (${slot.minutes} min).`, call.rateCents == null ? "Live calls aren't in their listing: you decide what to pay after the call." : ""], `/app/tests/${c0.testId}#calls`);
  await (await import("./requests")).closeOnBooking(contractId, slot.startsAt, call.id);
  return { callId: call.id };
}

/** Tester cancels their booked call: 24 hours or more ahead only. The time opens up again for others. */
export async function testerCancelCall(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const callId = String(body.callId ?? "");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
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
  const line = cancelLine(displayName(tester), call.startsAt, reason);
  await notify(c0.test.developer.email, line, [line, "The time is open again for other testers."], `/app/tests/${c0.testId}#calls`);
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
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (note.length < 5) throw new HttpError(400, "bad_note", "Say what happened.");
  await db.call.update({ where: { id: call.id }, data: { noShowBy: side, noShowNote: note, noShowAt: new Date() } });
  return { reported: true };
}

/** "How long was the call?": after the call, the developer enters the actual length; it sets the Pay box reference. */
export async function setCallLength(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const call = await db.call.findUnique({ where: { id: String(body.callId ?? "") }, include: { contract: true, review: true } });
  if (!call || call.contract.testId !== testId) throw new HttpError(404, "not_found", "That call doesn't exist.");
  if (call.status !== "booked") throw new HttpError(409, "cancelled", "This call was cancelled.");
  if (call.startsAt > new Date()) throw new HttpError(409, "not_yet", "You can enter the length once the call has started.");
  if (call.review) throw new HttpError(409, "paid", "This call was already paid, so its length can't change.");
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", LENGTH_WAITS);
  const minutes = Number(body.minutes);
  const ok = checkActualMinutes(Number.isFinite(minutes) ? minutes : null, call.minutes);
  if (!ok.ok) throw new HttpError(400, "bad_minutes", ok.message);
  await db.call.update({ where: { id: call.id }, data: { actualMinutes: minutes } });
  return { minutes };
}
