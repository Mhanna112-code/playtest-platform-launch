import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as M from "@/lib/callMeasure";
import * as R from "@/lib/rules";
import { fmtFor } from "@/lib/tz";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { GET as roomGET, POST as roomPOST } from "@/app/api/calls/[id]/room/route";
import { finishMeasuring, heartbeat, iceServers, roomLeave, roomPoll, roomSend } from "@/lib/server/calls";
import { callStatus, joinCall } from "@/lib/server/blocks";
import { suspendAccount } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

// Batch 21 (owner, Oct 28): the built-in call room replaces Jitsi.
const MIN = 60_000;
const at = (base: Date, min: number) => new Date(base.getTime() + min * MIN);
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** A booked 30-minute call that started `ago` minutes ago, both browsers connected (a report a minute) from its start until `until` minutes in. */
async function inProgress(ago: number, until: number) {
  const s = await setup();
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
  const start = new Date(Date.now() - ago * MIN);
  await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
  for (let m = 0; m <= until; m++) {
    await heartbeat(s.dev.user, call.id, at(start, m));
    await heartbeat(j.tester.user, call.id, at(start, m));
  }
  return { ...s, ...j, call, start };
}
const refusedWith = (line: string) => ({ status: 403, message: "This call isn't available.", data: { line } });

describe("batch 21 section 1: who can be in the room", () => {
  it("only the booked tester and the test's developer, from 10 minutes before the start until the call ends; every request is checked", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const stranger = await makeUser({ tester: true, name: "Ben Okafor" });
    // More than 10 minutes ahead: not available (the page says when it opens).
    await expect(roomPoll(j.tester.user, call.id, 0, false)).rejects.toMatchObject({ status: 403, message: "This call isn't available." });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + 9 * MIN) } });
    expect(await roomPoll(j.tester.user, call.id, 0, false)).toMatchObject({ signals: [], otherHere: false, measured: 0, warn: "" });
    expect((await roomPoll(s.dev.user, call.id, 0, false)).otherHere).toBe(true);
    // Anyone else: refused on every request (poll, message, leave), through the route too.
    await expect(roomPoll(stranger.user, call.id, 0, false)).rejects.toMatchObject({ status: 403, message: "This call isn't available." });
    await expect(roomSend(stranger.user, call.id, "description", { type: "offer", sdp: "x" })).rejects.toMatchObject({ message: "This call isn't available." });
    await expect(roomLeave(stranger.user, call.id)).rejects.toMatchObject({ message: "This call isn't available." });
    const r = await json(await roomGET(req(`/api/calls/${call.id}/room?after=0`, { cookie: stranger.cookie }), { params: Promise.resolve({ id: call.id }) }));
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe("This call isn't available.");
    // The page shows the same line to anyone else.
    expect(src("app/app/calls/[id]/page.tsx")).toContain("<p className=\"info\" data-call-line=\"\">{CALL_NOT_AVAILABLE}</p>");
  });

  it("relays the connection messages between the two browsers only (never back to the sender); Google's STUN, plus TURN when set", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - MIN) } });
    const sent = await json(await roomPOST(req(`/api/calls/${call.id}/room`, { cookie: s.dev.cookie, body: { kind: "description", payload: { type: "offer", sdp: "v=0" } } }), { params: Promise.resolve({ id: call.id }) }));
    expect(sent.status).toBe(200);
    expect((await roomPoll(s.dev.user, call.id, 0, false)).signals).toEqual([]);
    const got = await roomPoll(j.tester.user, call.id, 0, false);
    expect(got.signals.map((x) => [x.kind, JSON.parse(x.payload)])).toEqual([["description", { type: "offer", sdp: "v=0" }]]);
    expect((await roomPoll(j.tester.user, call.id, got.signals[0].id, false)).signals).toEqual([]); // after the last one: nothing new
    await expect(roomSend(s.dev.user, call.id, "anything", {})).rejects.toMatchObject({ status: 400 });
    // Coming (back) into the room clears the messages meant for an older connection; the other browser reads "join" and starts afresh.
    await roomSend(j.tester.user, call.id, "description", { type: "answer", sdp: "old" });
    await roomSend(j.tester.user, call.id, "join", null);
    expect(await db.callSignal.count({ where: { callId: call.id } })).toBe(1);
    expect((await roomPoll(s.dev.user, call.id, 0, false)).signals.map((x) => x.kind)).toEqual(["join"]);
    expect(iceServers()).toEqual([{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]);
    process.env.TURN_URL = "turn:turn.example:3478,turns:turn.example:5349";
    process.env.TURN_USERNAME = "u";
    process.env.TURN_CREDENTIAL = "c";
    expect(iceServers()[1]).toEqual({ urls: ["turn:turn.example:3478", "turns:turn.example:5349"], username: "u", credential: "c" });
    delete process.env.TURN_URL;
  });

  it("no Jitsi anywhere; Check your call setup is an in-app camera and microphone check that never makes a call", async () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.resolve(__dirname, "../src"))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/jitsi|meet\.jit\.si/i);
    expect(R.CALL_CHECK_LABEL).toBe("Check your call setup");
    expect(R.CALL_CHECK_NOTE).toBe("Preview your camera and microphone before the call. Nothing is sent or recorded.");
    const check = src("components/CallCheck.tsx");
    expect(check).toContain("getUserMedia");
    expect(check).not.toMatch(/fetch\(|api\(|RTCPeerConnection/); // never talks to the server, never connects to anyone
    for (const f of ["app/app/CallsBox.tsx", "app/app/page.tsx", "app/app/tests/[id]/DevCallPanel.tsx", "app/app/sessions/[id]/TesterCallPanel.tsx", "app/app/calls/[id]/CallRoom.tsx"]) expect(src(f)).toContain("<CallCheck");
    const before = await db.call.count();
    const signals = await db.callSignal.count();
    expect(await db.call.count()).toBe(before);
    expect(await db.callSignal.count()).toBe(signals);
  });
});

describe("batch 21 section 3: measured from the real connection", () => {
  it("only the time both browsers were connected counts; a gap under 5 minutes still counts, a longer one doesn't; being in the room unconnected counts nothing", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const start = new Date(Date.now() - 40 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    // In the room, never connected: nothing is measured.
    for (const m of [0, 1, 2]) {
      await roomPoll(s.dev.user, call.id, 0, false, at(start, m));
      await roomPoll(j.tester.user, call.id, 0, false, at(start, m));
    }
    expect(await db.callPresence.count({ where: { callId: call.id } })).toBe(0);
    // Connected from 3 to 13; the tester's browser drops 13–16 (under 5 minutes: still counts), then connected to 20; then a 7-minute drop (doesn't count), 27–30.
    const both = async (m: number) => {
      await roomPoll(s.dev.user, call.id, 0, true, at(start, m));
      await roomPoll(j.tester.user, call.id, 0, true, at(start, m));
    };
    for (let m = 3; m <= 13; m++) await both(m);
    for (let m = 14; m <= 15; m++) await roomPoll(s.dev.user, call.id, 0, true, at(start, m));
    for (let m = 16; m <= 20; m++) await both(m);
    for (let m = 27; m <= 30; m++) await both(m);
    expect((await roomPoll(j.tester.user, call.id, 0, true, at(start, 30))).measured).toBe(20); // 3–20 (17) + 27–30 (3)
    // The connection state messages count as connected at once.
    expect(await roomSend(j.tester.user, call.id, "state", { connected: true }, at(start, 31))).toEqual({ sent: true });
    // Final once both have left the room (5 minutes after each one's last sign).
    await finishMeasuring(at(start, 37));
    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ measuredMinutes: 20, endedAt: null });
  });
});

describe("batch 21 section 2: the server ends calls for real", () => {
  it("at 150% of the booked length: both hang up, the line, no rejoin; the minutes are kept", async () => {
    const x = await inProgress(46, 44); // 30 minutes booked: ends at 45 minutes connected
    expect(await heartbeat(x.dev.user, x.call.id, at(x.start, 45))).toEqual({ counted: true });
    expect(await heartbeat(x.tester.user, x.call.id, at(x.start, 45))).toEqual({ counted: false }); // the report that reaches 45 minutes together ends it
    const c = await db.call.findUniqueOrThrow({ where: { id: x.call.id } });
    expect(c).toMatchObject({ endReason: "length", measuredMinutes: 45 });
    expect(c.endedAt!.getTime()).toBe(at(x.start, 45).getTime());
    expect(M.LENGTH_ENDED_LINE).toBe("Call ended: it reached 150% of the booked time.");
    for (const u of [x.dev.user, x.tester.user]) await expect(roomPoll(u, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: it reached 150% of the booked time."));
    expect(await heartbeat(x.tester.user, x.call.id, new Date())).toEqual({ counted: false });
    await expect(joinCall(x.tester.user, x.call.id)).rejects.toMatchObject({ message: "This call is over." });
    expect((await callStatus(x.tester.user, x.call.id)).line).toBe("Call ended: it reached 150% of the booked time.");
    expect(await db.callSignal.count({ where: { callId: x.call.id } })).toBe(0);
  });

  it("a warning 2 minutes before a planned end, in each reader's own time zone", async () => {
    const x = await inProgress(44, 44); // ends at 45 minutes together: a minute from now
    await db.user.update({ where: { id: x.dev.user.id }, data: { timeZone: "America/New_York" } });
    const devUser = await db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } });
    const p = await roomPoll(devUser, x.call.id, 0, true, at(x.start, 44));
    expect(p.warn).toBe(`This call ends at ${fmtFor({ timeZone: "America/New_York" }, at(x.start, 45), "time")}.`);
    // Far from the end: no warning.
    const y = await inProgress(10, 10);
    expect((await roomPoll(y.tester.user, y.call.id, 0, true, at(y.start, 10))).warn).toBe("");
  });

  it("a block either way ends the call at that moment for both; the minutes up to it are kept", async () => {
    const x = await inProgress(12, 12);
    const r = await json(await blocksPOST(req("/api/blocks", { cookie: x.tester.cookie, body: { userId: x.dev.user.id } })));
    expect(r.status).toBe(200);
    for (const u of [x.dev.user, x.tester.user]) await expect(roomPoll(u, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: this call isn't available."));
    const c = await db.call.findUniqueOrThrow({ where: { id: x.call.id } });
    expect(c).toMatchObject({ status: "booked", endReason: "blocked", measuredMinutes: 12 });
  });

  it("a pause (a developer's hold here) ends it; the tester's line is neutral", async () => {
    const x = await inProgress(10, 10);
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "payment" } });
    await expect(roomPoll(x.tester.user, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: the test is paused."));
    await expect(roomPoll(x.dev.user, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: the test is paused."));
    expect(await db.call.findUniqueOrThrow({ where: { id: x.call.id } })).toMatchObject({ endReason: "paused", measuredMinutes: 10 });
  });

  it("a suspension of the tester ends it: they read that their session ended (never 'suspended'); the developer, that they left", async () => {
    const x = await inProgress(8, 8);
    const admin = await makeUser({ name: "Team" });
    await suspendAccount(admin.user.id, x.tester.user.id, "Checking", "tester");
    await expect(roomPoll(x.tester.user, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: your session ended."));
    await expect(roomPoll(x.dev.user, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: they left the test."));
    expect(await db.call.findUniqueOrThrow({ where: { id: x.call.id } })).toMatchObject({ status: "booked", measuredMinutes: 8 });
  });

  it("a suspension of the developer pauses the test and ends it", async () => {
    const x = await inProgress(8, 8);
    const admin = await makeUser({ name: "Team" });
    await suspendAccount(admin.user.id, x.dev.user.id, "Checking", "developer");
    await expect(roomPoll(x.tester.user, x.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: the test is paused."));
    expect(await db.call.findUniqueOrThrow({ where: { id: x.call.id } })).toMatchObject({ endReason: "paused", measuredMinutes: 8 });
  });

  it("a leave, End early and a Stop end it at that moment; calls ahead are cancelled as before", async () => {
    const a = await inProgress(10, 10);
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await expect(roomPoll(a.tester.user, a.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: you left this test."));
    await expect(roomPoll(a.dev.user, a.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: they left the test."));

    const b = await inProgress(10, 10);
    expect((await act(b.testId, "end-early", b.dev.cookie, { contractIds: [b.sessionId], reason: "We have enough feedback now.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expect(roomPoll(b.tester.user, b.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: your session ended."));
    await expect(roomPoll(b.dev.user, b.call.id, 0, true)).rejects.toMatchObject(refusedWith("Call ended: their session ended."));

    const c = await inProgress(25, 10);
    const later = await bookCall(c.testId, c.dev.cookie, c.sessionId, c.tester.cookie, 72);
    expect((await act(c.testId, "stop", c.dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true })).status).toBe(200);
    // Nobody polled since the Stop: the sweep ends it (the minutes connected before are kept).
    await finishMeasuring();
    const done = await db.call.findUniqueOrThrow({ where: { id: c.call.id } });
    expect(done).toMatchObject({ status: "booked", endReason: "stopped", measuredMinutes: 10 });
    expect((await callStatus(c.tester.user, c.call.id)).line).toBe("Call ended: the test was stopped.");
    expect((await db.call.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("cancelled");
    await expect(joinCall(c.tester.user, c.call.id)).rejects.toMatchObject({ message: "This call is over." });
    for (const x of [a, b]) expect((await db.call.findUniqueOrThrow({ where: { id: x.call.id } })).measuredMinutes).toBe(10);
  });
});

describe("batch 21 section 4: strict networks", () => {
  it("both in the room but never connected: nothing measured; once both have left, the call is cancelled with no charge", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const start = new Date(Date.now() - 20 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    for (const m of [0, 1, 2, 3]) {
      await roomPoll(s.dev.user, call.id, 0, false, at(start, m));
      await roomPoll(j.tester.user, call.id, 0, false, at(start, m));
    }
    await finishMeasuring(at(start, 9));
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(c).toMatchObject({ status: "cancelled", cancelledBy: "system", cancelNote: R.COULD_NOT_CONNECT, measuredMinutes: null });
    expect(R.COULD_NOT_CONNECT).toBe("It couldn't connect, so the call was cancelled.");
    expect(M.callOverBadge({ ...c, review: null }, { developer: "Nora", tester: "Ana" }, "tester", (d) => d.toISOString(), 0, null).label).toBe("Couldn't connect");
    expect(M.STRICT_NETWORK_LINE).toBe("Couldn't connect directly (a strict network?). Try another network, or reschedule.");
    expect(src("app/app/calls/[id]/CallRoom.tsx")).toContain('s === "failed" ? STRICT_NETWORK_LINE');
  });
});
