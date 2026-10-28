import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sweepNobodyJoined } from "@/lib/server/calls";
import { act, bookCall, joined, setup } from "./fixtures";

// (Owner, Oct 23, NEWEST+8) Nobody joined by the halfway point -> auto-cancelled (no charge, never a no-show, both told). (Batch 15 section 40) The length is measured
// (up to 150% of the booked length); the developer can only lower it, with a reason.
describe("call rules", () => {
  it("the measured length is capped at 150% of the booked length; it can only be lowered", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const start = new Date(Date.now() - 3 * 60 * 60_000);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start, devJoinedAt: start, testerJoinedAt: start } });
    await db.callPresence.createMany({ data: [
      { callId: call.id, userId: dev.user.id, side: "developer", startAt: start, endAt: new Date(start.getTime() + 70 * 60_000) },
      { callId: call.id, userId: tester.user.id, side: "tester", startAt: start, endAt: new Date(start.getTime() + 70 * 60_000) },
    ] });
    await sweepNobodyJoined();
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).measuredMinutes).toBe(45);
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 46, reason: "It ran long" })).body.error.message).toBe("You can only lower the length: below 45 min.");
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 40, reason: "We chatted after.", seenAt: new Date().toISOString(), confirmed: true })).status).toBe(200);
  });

  it("nobody joined by the halfway point: cancelled, no charge, never a no-show, both told; one side joined: left alone", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const a = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const b = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 52);
    const past = new Date(Date.now() - 16 * 60_000); // past the halfway point of a 30-min call
    await db.call.update({ where: { id: a.id }, data: { startsAt: past } });
    await db.call.update({ where: { id: b.id }, data: { startsAt: new Date(past.getTime() - 30 * 60_000), testerJoinedAt: past } }); // (batch 15 section 40) its length isn't final yet
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

describe("Past calls (the full app's PastRow): who joined and the outcome", () => {
  it("both / only you / only X / nobody; nothing before the start", async () => {
    const { joinedWords } = await import("@/lib/rules");
    const s = new Date("2026-11-01T15:00:00Z"), after = new Date("2026-11-01T16:00:00Z"), j = new Date("2026-11-01T15:01:00Z");
    expect(joinedWords({ startsAt: s, devJoinedAt: j, testerJoinedAt: j }, "tester", "Nora Lane", after)).toBe("both joined");
    expect(joinedWords({ startsAt: s, devJoinedAt: null, testerJoinedAt: j }, "tester", "Nora Lane", after)).toBe("only you joined");
    expect(joinedWords({ startsAt: s, devJoinedAt: j, testerJoinedAt: null }, "tester", "Nora Lane", after)).toBe("only Nora Lane joined");
    expect(joinedWords({ startsAt: s, devJoinedAt: null, testerJoinedAt: null }, "developer", "Ana Silva", after)).toBe("nobody joined");
    expect(joinedWords({ startsAt: after, devJoinedAt: null, testerJoinedAt: null }, "developer", "Ana Silva", s)).toBe("");
  });

  it("outcome badges: cancelled (by whom, or the site's reason), problem reported, paid / rejected / not paid yet", async () => {
    const { callOutcome } = await import("@/lib/rules");
    const base = { status: "booked", cancelledBy: null, cancelNote: "", noShowBy: null, review: null };
    expect(callOutcome({ ...base, status: "cancelled", cancelledBy: "developer" }, "Nora Lane", "tester")).toEqual([{ label: "cancelled by Nora Lane", tone: "grey" }]);
    expect(callOutcome({ ...base, status: "cancelled", cancelledBy: "tester" }, "Nora Lane", "tester")).toEqual([{ label: "cancelled by you", tone: "grey" }]);
    expect(callOutcome({ ...base, status: "cancelled", cancelledBy: "site", cancelNote: "Nobody joined, so the call was cancelled." }, "Nora Lane", "developer")).toEqual([{ label: "Nobody joined, so the call was cancelled", tone: "grey" }]);
    expect(callOutcome({ ...base, noShowBy: "tester", review: { amountCents: 1500, rejected: false } }, "Nora Lane", "developer")).toEqual([{ label: "problem reported", tone: "amber" }, { label: "paid $15.00", tone: "green" }]);
    expect(callOutcome({ ...base, review: { amountCents: 0, rejected: true } }, "Nora Lane", "tester")).toEqual([{ label: "not paid (rejected)", tone: "rose" }]);
    expect(callOutcome(base, "Nora Lane", "tester")).toEqual([{ label: "not paid yet", tone: "amber" }]);
  });
});

describe("Add to calendar (.ics)", () => {
  it("the call's start, end, title and link; only its two people", async () => {
    const { GET } = await import("@/app/api/calls/[id]/ics/route");
    const { req, makeUser } = await import("./helpers");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const res = await GET(req(`/api/calls/${call.id}/ics`, { method: "GET", cookie: tester.cookie }), { params: Promise.resolve({ id: call.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const body = await res.text();
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    expect(body).toContain(`DTSTART:${stamp(call.startsAt)}`);
    expect(body).toContain(`DTEND:${stamp(new Date(call.startsAt.getTime() + call.minutes * 60_000))}`);
    expect(body).toContain("SUMMARY:Live call: Harbor Run");
    expect(body).toContain(`/app/calls/${call.id}`);
    const other = await makeUser({ tester: true });
    expect((await GET(req(`/api/calls/${call.id}/ics`, { method: "GET", cookie: other.cookie }), { params: Promise.resolve({ id: call.id }) })).status).toBe(404);
  });
});

describe("the measured length, as both sides read it (batch 15 section 40)", () => {
  it("a lowered length keeps its reason (the tester reads it); the line names the time both were in the call", async () => {
    const { callLengthLine } = await import("@/lib/callMeasure");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 1);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60 * 60_000), measuredMinutes: 30, measuredAt: new Date(), measuredFrom: new Date(Date.now() - 60 * 60_000), measuredTo: new Date(Date.now() - 30 * 60_000) } });
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 20, reason: "We finished early.", seenAt: new Date().toISOString(), confirmed: true })).status).toBe(200);
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect([c.actualMinutes, c.lengthNote]).toEqual([20, "We finished early."]);
    expect(callLengthLine(c, () => "2:00 PM")).toBe("Length: 20 min (lowered from 30 min; both in the call 2:00–2:00 PM)");
  });
});
