import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as M from "@/lib/callMeasure";
import { clashNotes, localFmt } from "@/lib/callClash";
import { callCapMinutes, callEndState } from "@/lib/server/calls";
import { callStatus, joinCall } from "@/lib/server/blocks";
import { callsLeftCents } from "@/lib/server/callMoney";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 6, §280) No booking check against the $500 for a tester's calls on a test: requests, offers, sets and Accept are never refused or cut for it. The
// call itself still ends when its pay (the contract rate for a listed call, $200/h for an unlisted one) reaches what's left, and both people are told why.
const MIN = 60_000;
const at = (base: Date, min: number) => new Date(base.getTime() + min * MIN);
const pending = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
/** Both connected from `start` for `minutes` (as the room's presence rows record it). */
async function together(callId: string, devId: string, testerId: string, start: Date, minutes: number) {
  await db.callPresence.createMany({ data: [
    { callId, userId: devId, side: "developer", startAt: start, endAt: at(start, minutes) },
    { callId, userId: testerId, side: "tester", startAt: start, endAt: at(start, minutes) },
  ] });
}

describe("§280: booking is never checked against the $500", () => {
  it("unlisted 180-minute calls past $500 ($200/h): a daily set and a weekly set are requested and accepted on both sides; the form shows no limit line", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    // 4 × 180 minutes at $200/h = $2,400 in one daily set, from the developer.
    const r = await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], rows: [{ startsAt: atHours(48), repeat: "daily", count: 4 }], minutes: 180 });
    expect(r.body.error?.message ?? "").toBe("");
    expect(r.status).toBe(200);
    const acc = await sact(sessionId, "answer-request", tester.cookie, { requestId: (await pending(sessionId, "developer")).id, action: "accept", seenAt: seen(), confirmed: true });
    expect(acc.body.error?.message ?? "").toBe("");
    expect(acc.body.calls).toBe(4);
    expect(await callsLeftCents(sessionId)).toBe(0); // all of it reserved, and more
    // The tester asks for 2 more weekly 180-minute calls ($1,200 more) with nothing left: it goes, and the developer's Accept books them.
    const t = await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, rows: [{ startsAt: atHours(54), repeat: "weekly", count: 2 }], minutes: 180 });
    expect(t.body.error?.message ?? "").toBe("");
    expect(t.status).toBe(200);
    const acc2 = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: (await pending(sessionId, "tester")).id, action: "accept", seenAt: seen(), confirmed: true });
    expect(acc2.body.error?.message ?? "").toBe("");
    expect(acc2.status).toBe(200);
    const calls = await db.call.findMany({ where: { contractId: sessionId, status: "booked" } });
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.rateCents == null && c.minutes === 180)).toBe(true);
    // The form's checks: only the limits of §185, never a line for the $500.
    const notes = clashNotes({ rows: [{ startsAt: atHours(300), repeat: "weekly", count: 3 }], minutes: 180, side: "developer", targets: [{ name: "Ana Silva", calls: [], requests: [], booked: 1 }], elsewhere: [], fmt: localFmt("UTC") });
    expect(notes.limits).toEqual([]);
    expect(notes.rows.flat()).toEqual([]);
  });

  it("a single request with only $5 left is booked (both sides); the call then ends itself at the $5, and both see why", async () => {
    const { dev, testId } = await setup(); // listed: $30/h
    const { tester, sessionId } = await joined(testId);
    // An earlier call took place: 990 minutes at $30/h = $495 used, not paid yet. $5 is left.
    const used = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await db.call.update({ where: { id: used.id }, data: { startsAt: new Date(Date.now() - 3 * 86_400_000), measuredMinutes: 990, measuredAt: new Date() } });
    expect(await callsLeftCents(sessionId)).toBe(500);
    // A 60-minute call ($30) from the developer, accepted by the tester: never refused (was "Calls with Ana Silva on this test can come to at most $500; ...").
    const r = await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(72), minutes: 60 });
    expect(r.body.error?.message ?? "").toBe("");
    expect(r.status).toBe(200);
    const a = await sact(sessionId, "answer-request", tester.cookie, { requestId: (await pending(sessionId, "developer")).id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body.error?.message ?? "").toBe("");
    expect(a.status).toBe(200);
    // And one from the tester (180 minutes), accepted by the developer.
    const t = await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(96), minutes: 180 });
    expect(t.body.error?.message ?? "").toBe("");
    expect(t.status).toBe(200);
    const b = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: (await pending(sessionId, "tester")).id, action: "accept", seenAt: seen(), confirmed: true });
    expect(b.body.error?.message ?? "").toBe("");
    const [first, later] = await db.call.findMany({ where: { contractId: sessionId, status: "booked", measuredAt: null }, orderBy: { startsAt: "asc" } });
    expect([first.minutes, later.minutes, first.rateCents]).toEqual([60, 180, 3000]);
    // In the call room: the 60-minute call has $5 at the contract rate, 10 minutes (the later 180-minute call booked after it doesn't count against it).
    const start = new Date(Date.now() - 15 * MIN);
    await db.call.update({ where: { id: first.id }, data: { startsAt: start } });
    expect(await callCapMinutes({ ...first, startsAt: start })).toBe(10);
    await together(first.id, dev.user.id, tester.user.id, start, 15);
    expect(await callEndState(first.id)).toMatchObject({ ended: true, reason: "calls_cap", endsAt: at(start, 10) });
    const ended = await db.call.findUniqueOrThrow({ where: { id: first.id } });
    expect(ended).toMatchObject({ endReason: "calls_cap", measuredMinutes: 10 });
    expect(M.callPayCents(ended.rateCents, ended.measuredMinutes!)).toBe(500);
    // Both see why (the existing wording), and Join is refused.
    expect((await callStatus(dev.user, first.id)).line).toBe(M.capEndedLine("Ana Silva"));
    expect((await callStatus(tester.user, first.id)).line).toBe("Call ended: the $500 for calls with Nora Lane on this test is reached.");
    await expect(joinCall(tester.user, first.id)).rejects.toMatchObject({ message: M.CALL_OVER_LINE });
    // The later call: nothing is left, so it would end as soon as it starts.
    expect(await callCapMinutes(later)).toBe(0);
  });

  it("an unlisted call ends at what's left at $200/h; calls booked after it don't count, calls before it do", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], rows: [{ startsAt: atHours(48), repeat: "daily", count: 3 }], minutes: 90 })).status).toBe(200);
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: (await pending(sessionId, "developer")).id, action: "accept", seenAt: seen(), confirmed: true })).body.calls).toBe(3);
    const [c1, c2, c3] = await db.call.findMany({ where: { contractId: sessionId }, orderBy: { startsAt: "asc" } });
    // $900 booked in all, but nothing has been used before the first call: the 150% cap (135 minutes) comes first, not the $500 (150 minutes at $200/h).
    expect(await callCapMinutes(c1)).toBeNull();
    // The first took place: 30 minutes, $100 used. The second starts now: $400 left, 120 minutes at $200/h.
    await db.call.update({ where: { id: c1.id }, data: { startsAt: new Date(Date.now() - 2 * 86_400_000), measuredMinutes: 30, measuredAt: new Date() } });
    const start = new Date(Date.now() - 130 * MIN);
    await db.call.update({ where: { id: c2.id }, data: { startsAt: start } });
    expect(await callCapMinutes({ ...c2, startsAt: start })).toBe(120);
    await together(c2.id, dev.user.id, tester.user.id, start, 130);
    expect(await callEndState(c2.id)).toMatchObject({ ended: true, reason: "calls_cap", endsAt: at(start, 120) });
    expect(await db.call.findUniqueOrThrow({ where: { id: c2.id } })).toMatchObject({ measuredMinutes: 120, endReason: "calls_cap" });
    expect((await callStatus(dev.user, c2.id)).line).toBe("Call ended: the $500 for calls with Ana Silva on this test is reached.");
    expect((await callStatus(tester.user, c2.id)).line).toBe("Call ended: the $500 for calls with Nora Lane on this test is reached.");
    // The third: $100 + $400 used before it, nothing left.
    expect(await callCapMinutes(c3)).toBe(0);
  });
});
