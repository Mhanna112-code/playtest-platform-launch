import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sweepNobodyJoined } from "@/lib/server/calls";
import { act, bookCall, joined, setup } from "./fixtures";

// (Owner, Oct 23, NEWEST+8) Call length: logged up to 150%; the call closes 24 h after its start; nobody joined by the
// halfway point -> auto-cancelled (no charge, never a no-show, both told).
describe("call rules", () => {
  it("the logged length can be up to 150% of the booked length; over it is red; after 24 h it can't be logged", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const start = new Date(Date.now() - 60 * 60_000);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start, devJoinedAt: start, testerJoinedAt: start } });
    const over = await act(testId, "call-length", dev.cookie, { callId: call.id, minutes: 46 });
    expect(over).toMatchObject({ status: 400, body: { error: { message: "You can log up to 45 min for this 30-min call." } } });
    expect((await act(testId, "call-length", dev.cookie, { callId: call.id, minutes: 45 })).status).toBe(200);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await act(testId, "call-length", dev.cookie, { callId: call.id, minutes: 40 })).body.error.message).toBe("This call closed 24 hours after its start: the booked length is used.");
  });

  it("nobody joined by the halfway point: cancelled, no charge, never a no-show, both told; one side joined: left alone", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const a = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const b = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 52);
    const past = new Date(Date.now() - 16 * 60_000); // past the halfway point of a 30-min call
    await db.call.update({ where: { id: a.id }, data: { startsAt: past } });
    await db.call.update({ where: { id: b.id }, data: { startsAt: new Date(past.getTime() - 60 * 60_000), testerJoinedAt: past } });
    await sweepNobodyJoined();
    expect(await db.call.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "cancelled", cancelledBy: "system", cancelNote: "Nobody joined, so the call was cancelled.", noShowBy: null });
    expect((await db.call.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("booked");
    expect(await db.payment.count({ where: { callId: a.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { endsWith: "Nobody joined, so the call was cancelled." } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { endsWith: "Nobody joined, so the call was cancelled." } } })).toBe(1);
  });
});

describe("Join call shows only while the room can be joined (as in the full app)", () => {
  it("from 10 min before the start to 30 min after the end; never when cancelled", async () => {
    const { callJoinable } = await import("@/lib/rules");
    const s = new Date("2026-11-01T15:00:00Z");
    const at = (min: number) => new Date(s.getTime() + min * 60_000);
    const call = { status: "booked", startsAt: s, minutes: 60 };
    expect(callJoinable(call, at(-11))).toBe(false);
    expect(callJoinable(call, at(-10))).toBe(true);
    expect(callJoinable(call, at(90))).toBe(true);
    expect(callJoinable(call, at(91))).toBe(false);
    expect(callJoinable({ ...call, status: "cancelled" }, at(0))).toBe(false);
  });
});

describe("call presence (the full app's CallPresence, on lean data)", () => {
  it("each side reads who the other is and when they joined the room", async () => {
    const { callStatus } = await import("@/lib/server/blocks");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 1);
    const at = new Date();
    await db.call.update({ where: { id: call.id }, data: { devJoinedAt: at } });
    const t = await callStatus(tester.user, call.id);
    expect(t.other).toEqual({ name: "Nora Lane", joinedAt: at });
    expect(t.meJoinedAt).toBeNull();
    const d = await callStatus(dev.user, call.id);
    expect(d.other).toEqual({ name: "Ana Silva", joinedAt: null });
    expect(d.meJoinedAt).toEqual(at);
  });
});
