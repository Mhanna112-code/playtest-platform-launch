import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { shiftAfterPause } from "@/lib/server/holds";
import { pieceCloseOut } from "@/lib/server/closeOut";
import { recordGap, recordOutage } from "@/lib/server/outages";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { dayIn, endOfDayIn, movedDue } from "@/lib/rules";
import { makeUser } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 9, §346) The three date bugs from the pauses/outages audit (audit-nov9/p1-pauses).
const H = 3_600_000, D = 24 * H, M = 60_000;
// Far in the future (each test its own window): an outage there moves only this file's own dates, never every row in the test schema.
const farFuture = () => new Date(Date.UTC(2091, 0, 1) + Math.floor(Math.random() * 20000) * D + Math.floor(Math.random() * 20) * H);

async function sent() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId, "Gus Hale", "he");
  expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  return { dev, testId, tester, sessionId, sub };
}

describe("§346 (1) a 48 h pause on a piece whose Charge is open moves its close-out by exactly 48 h", () => {
  it("the review date (already passed) stays; the close-out counts the pause once", async () => {
    const f = await sent();
    const now = new Date(), S = new Date(now.getTime() - 48 * H);
    // Work over: deadlines and Open until passed; Charge opened 12 h before the pause began.
    await db.contract.update({ where: { id: f.sessionId }, data: { dueAt: new Date(now.getTime() - 4 * D) } });
    await db.test.update({ where: { id: f.testId }, data: { openUntil: new Date(now.getTime() - 4 * D) } });
    const payBy0 = new Date(S.getTime() - 12 * H);
    await db.submission.update({ where: { id: f.sub.id }, data: { payBy: payBy0, choiceOfferedAt: payBy0, choiceBy: new Date(payBy0.getTime() + 7 * D), updatedAt: new Date(payBy0.getTime() - 7 * D) } });
    const before = (await pieceCloseOut({ submissionId: f.sub.id }, "tester", now))!.getTime();
    // The team's 48 h pause, as its events record it, then the lift's shift.
    await db.testEvent.createMany({ data: [{ testId: f.testId, kind: "paused", text: "The team paused this test", createdAt: S }, { testId: f.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: now }] });
    const t = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    await db.$transaction((tx) => shiftAfterPause(tx, t, S, now));
    expect((await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } })).payBy!.getTime()).toBe(payBy0.getTime());
    for (const side of ["tester", "developer"] as const) expect((await pieceCloseOut({ submissionId: f.sub.id }, side, now))!.getTime() - before).toBe(48 * H);
  });
});

describe("§346 (2) an outage recorded in two parts (17 min, then 2 more) rounds a deadline up once", () => {
  it("the merged recovery doesn't add another end-of-day", async () => {
    const f = await sent();
    const start = farFuture();
    const tz = (await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } })).timeZone;
    const due0 = endOfDayIn(dayIn(new Date(start.getTime() + 3 * D), tz), tz); // a deadline (an end of day) a few days after the outage
    await db.contract.update({ where: { id: f.sessionId }, data: { dueAt: due0 } });
    expect(await recordOutage(start, new Date(start.getTime() + 17 * M))).toBeTruthy();
    const afterFirst = (await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt;
    expect(afterFirst.getTime()).toBe(movedDue(due0, 17 * M, tz).getTime());
    // The repeat covers one minute before and one after: 19 minutes in all, two small parts.
    await recordGap(new Date(start.getTime() - M), new Date(start.getTime() + 18 * M));
    const afterRepeat = (await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt;
    expect(afterRepeat.getTime()).toBe(movedDue(due0, 19 * M, tz).getTime());
    expect(afterRepeat.getTime()).toBe(afterFirst.getTime());
  });
});

describe("§346 (3) an outage inside a 2-day team pause moves nothing twice", () => {
  it("the recovery moves nothing on the paused test; the lift moves every date by the pause, once", async () => {
    const f = await sent();
    const admin = await makeUser({ name: "Team" });
    const tz = (await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } })).timeZone;
    await pauseTest(admin.user.id, f.testId, "Checking a report");
    const S = new Date(Date.now() - 48 * H);
    await db.test.update({ where: { id: f.testId }, data: { adminPausedAt: S, pausedSince: S } });
    // Sent before the pause began (its review date still ahead).
    await db.submission.update({ where: { id: f.sub.id }, data: { updatedAt: new Date(S.getTime() - H), payBy: new Date(S.getTime() - H + 7 * D) } });
    const c0 = await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } });
    const s0 = await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } });
    // A 17-minute outage an hour into the pause.
    const o = new Date(S.getTime() + H);
    expect(await recordOutage(o, new Date(o.getTime() + 17 * M))).toBeTruthy();
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt.getTime()).toBe(c0.dueAt.getTime());
    expect((await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } })).payBy!.getTime()).toBe(s0.payBy!.getTime());
    await unpauseTest(f.testId);
    await settle();
    const s1 = await db.submission.findUniqueOrThrow({ where: { id: f.sub.id } });
    const shift = s1.payBy!.getTime() - s0.payBy!.getTime();
    expect(shift).toBeGreaterThanOrEqual(48 * H);
    expect(shift).toBeLessThan(48 * H + 5 * M); // the pause (plus the seconds the test took), never + the 17 minutes again
    const c1 = await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(c1.dueAt.getTime()).toBe(movedDue(c0.dueAt, shift, tz).getTime());
  });
});
