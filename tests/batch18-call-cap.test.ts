import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as M from "@/lib/callMeasure";
import { callJoinable } from "@/lib/rules";
import { fmtFor } from "@/lib/tz";
import { callCapState, finishMeasuring, heartbeat } from "@/lib/server/calls";
import { callStatus, joinCall } from "@/lib/server/blocks";
import { callsLeftCents } from "@/lib/server/callMoney";
import { bookCall, joined, setup } from "./fixtures";

// Batch 18 section 3 (owner, Oct 28 evening): a call ends when its pay would pass the $1,000 for that tester's calls on the test.
const MIN = 60_000;
const at = (base: Date, min: number) => new Date(base.getTime() + min * MIN);
const span = (base: Date, from: number, to: number) => ({ startAt: at(base, from), endAt: at(base, to) });

/** Another booked call on the same contract that reserves `cents` of the $1,000 (at $200/h when `rateCents` is null). */
async function reserve(contractId: string, slotId: string, rateCents: number | null, cents: number) {
  const minutes = Math.round((cents * 60) / (rateCents ?? M.UNLISTED_CALL_RATE_CENTS));
  await db.call.create({ data: { slotId, contractId, startsAt: new Date(Date.now() + 9 * 86_400_000), minutes, rateCents } });
}

describe("batch 18 section 3: the call's own cap at the $1,000 (pure)", () => {
  it("the most minutes whose pay fits what's left: the contract rate, or $200/h unlisted; a free call never reaches it", () => {
    expect(M.capMinutesFor(3000, 1000)).toBe(20); // $30/h: $10 is 20 minutes
    expect(M.capMinutesFor(3000, 1049)).toBe(20);
    expect(M.capMinutesFor(3000, 1050)).toBe(21);
    expect(M.capMinutesFor(null, 5000)).toBe(15); // unlisted $200/h: $50 is 15 minutes
    expect(M.capMinutesFor(0, 5000)).toBeNull();
    expect(M.capMinutesFor(3000, 0)).toBe(0);
  });
  it("when the time together reaches it: projected while both are here, reached once measured", () => {
    const s = new Date("2026-11-05T15:00:00Z");
    // Both here for 15 minutes (heartbeats up to now): ends 5 minutes from the latest moment together.
    expect(M.capEnd([span(s, 0, 15)], [span(s, 0, 15)], 20, at(s, 15))).toEqual({ reached: false, endsAt: at(s, 20), together: true });
    // The tester left at 10: the end moves on with now (5 minutes of their 20 still to come when they're back together).
    expect(M.capEnd([span(s, 0, 20)], [span(s, 0, 10)], 15, at(s, 20))).toEqual({ reached: false, endsAt: at(s, 25), together: false });
    // Measured past it: reached at the moment the time together came to 20 minutes.
    expect(M.capEnd([span(s, 0, 22)], [span(s, 0, 22)], 20, at(s, 22))).toEqual({ reached: true, endsAt: at(s, 20), together: true });
    // Both still here when the projected moment comes (heartbeats lag a few seconds): reached.
    expect(M.capEnd([span(s, 0, 19.9)], [span(s, 0, 19.9)], 20, at(s, 20)).reached).toBe(true);
    // (Batch 21 section 2) The 2-minute warning, and the room's end line (the room hangs up, so nothing is said about minutes after).
    expect(M.endWarnLine("3:42 PM")).toBe("This call ends at 3:42 PM.");
    expect(M.capEndedLine("Ana")).toBe("Call ended: the $1,000 for calls with Ana on this test is reached.");
    expect(M.CALL_OVER_LINE).toBe("This call is over.");
  });
});

describe("batch 18 section 3: a call reaching the $1,000 mid-way", () => {
  it("the warning 2 minutes before, then it ends for both sides at that point; measuring stops; Join is refused", async () => {
    const { dev, testId } = await setup(); // $30/h, 30-minute calls
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await reserve(sessionId, call.slotId, 3000, 99_000); // other calls already use $990: $10 is left for this one (20 minutes at $30/h)
    expect(await callsLeftCents(sessionId, db, call.id)).toBe(1_000);
    // The call started 19 minutes ago; both have been connected since.
    const start = new Date(Date.now() - 19 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    for (let m = 0; m <= 19; m++) {
      await heartbeat(dev.user, call.id, at(start, m));
      await heartbeat(tester.user, call.id, at(start, m));
    }
    // (Batch 21 section 2) A minute before: "This call ends at 3:42 PM.", in each reader's own time zone.
    await db.user.update({ where: { id: dev.user.id }, data: { timeZone: "America/New_York" } });
    const devNow = await callStatus(dev.user, call.id);
    expect(devNow.line).toBe("");
    expect(devNow.capLine).toBe(`This call ends at ${fmtFor({ timeZone: "America/New_York" }, at(start, 20), "time")}.`);
    expect((await callStatus(tester.user, call.id)).capLine).toBe(`This call ends at ${fmtFor(null, at(start, 20), "time")}.`);
    // The beats that reach 20 minutes together end it.
    for (let m = 20; m <= 20; m++) {
      await heartbeat(dev.user, call.id, at(start, m));
      await heartbeat(tester.user, call.id, at(start, m));
    }
    const ended = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(ended.cappedAt!.getTime()).toBe(at(start, 20).getTime());
    expect(ended.measuredAt).not.toBeNull(); // final: measuring stopped
    expect(ended.measuredMinutes).toBe(20); // paid up to that point: $10, what was left
    expect(M.callPayCents(ended.rateCents, ended.measuredMinutes!)).toBe(1_000);
    expect(await callsLeftCents(sessionId)).toBe(0);
    // Minutes after don't count: more heartbeats change nothing.
    expect(await heartbeat(dev.user, call.id, at(start, 21))).toEqual({ counted: false });
    expect(await heartbeat(tester.user, call.id, at(start, 21))).toEqual({ counted: false });
    await finishMeasuring(new Date());
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).measuredMinutes).toBe(20);
    // The page says so (it replaces the room, for both sides) and Join is refused; the Join button goes.
    const after = await callStatus(dev.user, call.id);
    expect(after).toMatchObject({ line: "Call ended: the $1,000 for calls with Ana Silva on this test is reached.", capLine: "", capped: true });
    expect((await callStatus(tester.user, call.id)).line).toBe("Call ended: the $1,000 for calls with Nora Lane on this test is reached.");
    await expect(joinCall(tester.user, call.id)).rejects.toMatchObject({ message: "This call is over.", data: { cancelled: true } });
    await expect(joinCall(dev.user, call.id)).rejects.toMatchObject({ message: "This call is over." });
    expect(callJoinable({ ...ended, startsAt: new Date() })).toBe(false);
  });

  it("no line while the end is more than 2 minutes away; none when the 150% cap comes first", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await reserve(sessionId, call.slotId, 3000, 99_000); // 20 minutes left
    const start = new Date(Date.now() - 5 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    for (let m = 0; m <= 5; m++) {
      await heartbeat(dev.user, call.id, at(start, m));
      await heartbeat(tester.user, call.id, at(start, m));
    }
    const s = await callStatus(dev.user, call.id);
    expect(s.capLine).toBe(""); // ends 15 minutes from now
    expect((await callCapState(call.id))?.ended).toBe(false);
    // Plenty left ($30/h × 45 minutes fits): the $1,000 never binds before 150%.
    const other = await setup();
    const j = await joined(other.testId, "Ben Okafor");
    const c2 = await bookCall(other.testId, other.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: c2.id }, data: { startsAt: new Date(Date.now() - 40 * MIN) } });
    expect(await callCapState(c2.id)).toBeNull();
  });

  it("an unlisted call at $200/h: ends when its pay reaches what's left; the measured length is capped there", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    expect(call.rateCents).toBeNull();
    await reserve(sessionId, call.slotId, null, 95_000); // $50 left: 15 minutes at $200/h
    // Both had the call page open for the whole 30 minutes (no page polled meanwhile): the sweep ends it at 15 minutes together.
    const start = new Date(Date.now() - 3 * 3_600_000);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    await db.callPresence.createMany({ data: [
      { callId: call.id, userId: dev.user.id, side: "developer", startAt: start, endAt: at(start, 30) },
      { callId: call.id, userId: tester.user.id, side: "tester", startAt: start, endAt: at(start, 30) },
    ] });
    await finishMeasuring(new Date());
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(c.cappedAt!.getTime()).toBe(at(start, 15).getTime());
    expect(c.measuredMinutes).toBe(15);
    expect(c.measuredTo!.getTime()).toBe(at(start, 15).getTime());
    expect(M.callPayCents(null, 15)).toBe(5_000);
    expect((await callStatus(tester.user, call.id)).line).toBe("Call ended: the $1,000 for calls with Nora Lane on this test is reached.");
    await expect(joinCall(dev.user, call.id)).rejects.toMatchObject({ message: "This call is over." });
  });
});
