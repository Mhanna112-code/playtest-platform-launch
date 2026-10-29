import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { fmtFor } from "@/lib/tz";
import { JITSI_HOST_TIP, finishMeasuring, heartbeat, remindCallsSoon, roomUrl } from "@/lib/server/calls";
import { bellKey } from "@/lib/bell";
import { callStatus, joinCall } from "@/lib/server/blocks";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

// Batch 18 sections 9, 10 and 12 (owner, Oct 28): a call in progress keeps counting until the people on it leave; calls use only the app's Jitsi room.
const MIN = 60_000;
const at = (base: Date, min: number) => new Date(base.getTime() + min * MIN);
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** A booked call that started `ago` minutes ago, both on the call page (a heartbeat a minute) from its start until `until` minutes in. */
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

describe("batch 18 section 9: a call in progress is never cut", () => {
  it("Stop during a call: not cancelled; whoever is on it keeps counting; someone who left can't come back; Join refused; then \"Call ended at <time>\"", async () => {
    const x = await inProgress(25, 10);
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: x.call.id } })).status).toBe("booked"); // calls ahead are cancelled; this one had started
    // Both still on the call page: they keep counting.
    for (const m of [11, 12]) {
      expect(await heartbeat(x.dev.user, x.call.id, at(x.start, m))).toEqual({ counted: true });
      expect(await heartbeat(x.tester.user, x.call.id, at(x.start, m))).toEqual({ counted: true });
    }
    // The tester leaves at 12; the developer stays until 25 (now).
    for (let m = 13; m <= 25; m++) await heartbeat(x.dev.user, x.call.id, at(x.start, m));
    // Back after more than 5 minutes: not counted (no re-entry into the measured call).
    expect(await heartbeat(x.tester.user, x.call.id, at(x.start, 20))).toEqual({ counted: false });
    // Join and re-Join: refused with the existing line.
    await expect(joinCall(x.tester.user, x.call.id)).rejects.toMatchObject({ message: "Your Join call didn't go through: this test was stopped." });
    // The developer still on the page keeps the room; the tester who left reads why.
    expect((await callStatus(x.dev.user, x.call.id)).line).toBe("");
    expect((await callStatus(x.tester.user, x.call.id)).line).toBe("This test was stopped.");
    // Final once both have left: the minutes together (0 to 12) are kept and payable.
    await finishMeasuring(new Date(Date.now() + 6 * MIN));
    const done = await db.call.findUniqueOrThrow({ where: { id: x.call.id } });
    expect(done).toMatchObject({ status: "booked", measuredMinutes: 12 });
    const ended = `Call ended at ${fmtFor(null, at(x.start, 12), "time")}.`;
    expect((await callStatus(x.tester.user, x.call.id)).line).toBe(ended);
    expect((await callStatus(x.dev.user, x.call.id)).line).toBe(ended);
  });

  it("End early, a leave and a pause don't cancel a call already started; the person on it keeps counting", async () => {
    const a = await inProgress(10, 10);
    expect((await act(a.testId, "end-early", a.dev.cookie, { contractIds: [a.sessionId], reason: "We have enough feedback now.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: a.call.id } })).status).toBe("booked");
    expect(await heartbeat(a.tester.user, a.call.id)).toEqual({ counted: true });
    expect((await callStatus(a.tester.user, a.call.id)).line).toBe("");

    const b = await inProgress(10, 10);
    expect((await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: b.call.id } })).status).toBe("booked");
    expect(await heartbeat(b.dev.user, b.call.id)).toEqual({ counted: true });

    const c = await inProgress(10, 10);
    await db.user.update({ where: { id: c.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "payment" } });
    expect((await db.call.findUniqueOrThrow({ where: { id: c.call.id } })).status).toBe("booked");
    expect(await heartbeat(c.tester.user, c.call.id)).toEqual({ counted: true });
    await expect(joinCall(c.tester.user, c.call.id)).rejects.toMatchObject({ message: "Your Join call didn't go through: this test is paused." });
  });

  it("the lines on the test page and the tester's page", () => {
    expect(R.IN_PROGRESS_DEV).toBe("In progress: it ends when you both leave");
    expect(R.IN_PROGRESS_TESTER).toBe("In progress");
    expect(R.callEndedLine("3:42 PM")).toBe("Call ended at 3:42 PM.");
    expect(R.callClosedToJoins({ blocked: false, paused: false, testStatus: "open", contractStatus: "working", side: "tester" })).toBe("");
    expect(R.callClosedToJoins({ blocked: true, paused: true, testStatus: "open", contractStatus: "working", side: "tester" })).toBe("This call isn't available.");
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(dev).toContain("measuring: x.startsAt <= now ? (restricted ? IN_PROGRESS_DEV : MEASURING_LINE) : undefined });");
    expect(dev).toContain("{c.status !== \"working\" && c.calls.filter((x) => callInProgress(x, now)).map((x) => (");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("lengthText: x.startsAt <= now ? (paused || refusal ? IN_PROGRESS_TESTER : MEASURING_LINE) : \"\",");
  });
});

describe("batch 18 section 10: calls use only the app's Jitsi room", () => {
  it("every call's room is its Jitsi room (a stored link is never used); the call page's Join and its line", async () => {
    expect(roomUrl({ id: "abc" })).toBe("https://meet.jit.si/playtest-abc");
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.callSlot.update({ where: { id: call.slotId }, data: { link: "https://zoom.example/123" } }); // an old own link
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 5 * MIN) } });
    expect((await joinCall(j.tester.user, call.id)).room).toBe(`https://meet.jit.si/playtest-${call.id}`);
    expect(R.CALL_JOIN_LINE).toBe("The call opens in Jitsi in a new tab. Keep this page open: it measures the call.");
    const room = src("app/app/calls/[id]/CallRoom.tsx");
    expect(room).toContain("<a className=\"btn no-underline hover:no-underline\" href={room} target=\"_blank\" rel=\"noreferrer\" data-call-join=\"\">Join</a>");
    expect(room).toContain("{CALL_JOIN_LINE}");
    expect(room).not.toContain("<iframe");
    expect(src("lib/server/calls.ts")).not.toMatch(/slot\.link/);
  });
});

describe("batch 18 section 12: get the Jitsi sign-in out of the way early", () => {
  it("a reminder 15 minutes before, to both (the developer's with the tip), once, stacked in the test's day; none for a call booked less than 15 minutes ahead", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const startsAt = new Date(Date.now() + 14 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt, createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await remindCallsSoon();
    await remindCallsSoon(); // once
    const time = (tz: string | null) => fmtFor({ timeZone: tz }, startsAt, "time");
    const tes = await db.notification.findMany({ where: { userId: j.tester.user.id, reminderKey: `call15:${call.id}` } });
    expect(tes.map((n) => n.text)).toEqual([`Your call with Nora Lane on “Harbor Run” starts at ${time(j.tester.user.timeZone)}.`]);
    expect(tes[0].link).toBe(`/app/sessions/${j.sessionId}#call-${call.id}`);
    const dev = await db.notification.findMany({ where: { userId: s.dev.user.id, reminderKey: `call15:${call.id}` } });
    expect(dev.map((n) => n.text)).toEqual([`Your call with Ana Silva on “Harbor Run” starts at ${time(s.dev.user.timeZone)}. Open it a few minutes early: Jitsi asks the first person to sign in with Google, GitHub or Facebook.`]);
    expect(JITSI_HOST_TIP).toBe("Open it a few minutes early: Jitsi asks the first person to sign in with Google, GitHub or Facebook.");
    expect(bellKey(dev[0])).toBe(`${s.testId}|${dev[0].createdAt.toISOString().slice(0, 10)}`); // stacks in that test's day
    // Booked 10 minutes ahead: no reminder.
    const late = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 72);
    await db.call.update({ where: { id: late.id }, data: { startsAt: new Date(Date.now() + 10 * MIN), createdAt: new Date() } });
    await remindCallsSoon();
    expect(await db.notification.count({ where: { reminderKey: `call15:${late.id}` } })).toBe(0);
  });

  it("the call page's line under Join, per side", () => {
    expect(R.JITSI_HOST_DEV_LINE).toBe("Join a few minutes early: Jitsi asks the host to sign in with Google, GitHub or Facebook.");
    expect(R.jitsiWaitingLine("Nora Lane")).toBe("If Jitsi says it's waiting for the host, Nora Lane is on the way: keep this page open.");
    expect(src("app/app/calls/[id]/page.tsx")).toContain("hostLine={amTester ? jitsiWaitingLine(other ? displayName(other) : \"the developer\") : JITSI_HOST_DEV_LINE}");
    expect(src("app/app/calls/[id]/CallRoom.tsx")).toContain("{hostLine && <p className=\"note\" data-call-host-line=\"\">{hostLine}</p>}");
  });
});
