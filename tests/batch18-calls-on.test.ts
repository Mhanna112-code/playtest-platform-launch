import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { fmtFor } from "@/lib/tz";
import { remindCallsSoon } from "@/lib/server/calls";
import { bellKey } from "@/lib/bell";
import { bookCall, joined, setup } from "./fixtures";

// Batch 18 section 12 (owner, Oct 28): the reminder before each call. Sections 9, 10 and 13 (the Jitsi room, its practice room, a call in progress counting until
// both leave) were replaced by batch 21: tests/batch21-call-room.test.ts.
const MIN = 60_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("batch 18 section 9 (what stays after batch 21): the in-progress lines", () => {
  it("the lines on the test page and the tester's page", () => {
    expect(R.IN_PROGRESS_DEV).toBe("In progress: it ends when you both leave");
    expect(R.IN_PROGRESS_TESTER).toBe("In progress");
    expect(R.callEndedLine("3:42 PM")).toBe("Call ended at 3:42 PM.");
    expect(R.callClosedToJoins({ blocked: false, paused: false, testStatus: "open", contractStatus: "working", side: "tester" })).toBe("");
    expect(R.callClosedToJoins({ blocked: true, paused: true, testStatus: "open", contractStatus: "working", side: "tester" })).toBe("This call isn't available.");
    // (Batch 21) A tester removed by a suspension reads that their session ended; the developer, that they left.
    expect(R.callClosedToJoins({ blocked: false, paused: false, testStatus: "open", contractStatus: "left", side: "tester", endKind: "suspended" })).toBe("Your session ended.");
    expect(R.callClosedToJoins({ blocked: false, paused: false, testStatus: "open", contractStatus: "left", side: "developer", endKind: "suspended" })).toBe("They left the test.");
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(dev).toContain("measuring: x.startsAt <= now ? (restricted ? IN_PROGRESS_DEV : MEASURING_LINE) : undefined });");
    expect(dev).toContain("{c.status !== \"working\" && c.calls.filter((x) => callInProgress(x, now)).map((x) => (");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("lengthText: x.startsAt <= now ? (paused || refusal ? IN_PROGRESS_TESTER : MEASURING_LINE) : \"\",");
  });
});

describe("batch 18 section 12: the reminder 15 minutes before each call (batch 21: no Jitsi tip)", () => {
  it("a reminder 15 minutes before, to both (the same line), once, stacked in the test's day; none for a call booked less than 15 minutes ahead", async () => {
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
    expect(dev.map((n) => n.text)).toEqual([`Your call with Ana Silva on “Harbor Run” starts at ${time(s.dev.user.timeZone)}.`]);
    expect(bellKey(dev[0])).toBe(`${s.testId}|${dev[0].createdAt.toISOString().slice(0, 10)}`); // stacks in that test's day
    // Booked 10 minutes ahead: no reminder.
    const late = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 72);
    await db.call.update({ where: { id: late.id }, data: { startsAt: new Date(Date.now() + 10 * MIN), createdAt: new Date() } });
    await remindCallsSoon();
    expect(await db.notification.count({ where: { reminderKey: `call15:${late.id}` } })).toBe(0);
  });
});
