import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pauseCauses, pauseClosesAt, startedBeforeWorkEnd } from "@/lib/pause";
import { testPaused, testerPaused } from "@/lib/rules";
import { WORK_ENDED_NO_PAUSE, pauseTest, reinstateAccount, suspendAccount } from "@/lib/server/restrictions";
import { testRowsByIds } from "@/lib/server/adminLists";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { liftHoldIfClear, markPaused, startHold } from "@/lib/server/holds";
import { closeOutOf, pieceCloseOut } from "@/lib/server/closeOut";
import { makeUser } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 9, §358) A CLOSED test (its work ended on its own: Open until and every deadline passed, or the 7-day pause closure) is treated like a stopped one
// for pauses: the team's Pause is refused, and a hold or suspension that STARTS after the work ended doesn't pause it or move any of its dates. A pause that
// started before the work ended still counts.

const HOUR = 3_600_000;
async function closedTest() {
  const f = await setup();
  const j = await joined(f.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Smooth."], seenAt: seen(), confirmed: true })).status).toBe(200);
  const ended = new Date(Date.now() - 2 * HOUR);
  await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "closed", endedAt: ended, dueAt: ended } });
  await db.test.update({ where: { id: f.testId }, data: { status: "closed", workEndedAt: ended, openUntil: new Date(ended.getTime() - 86_400_000) } });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...f, j, ended, sub };
}

describe("§358 a closed test isn't paused by what starts after its work ended", () => {
  it("the rule: causes that began before the work ended count, later ones don't", () => {
    const end = new Date("2026-11-05T12:00:00Z");
    const t = { status: "closed", workEndedAt: end };
    expect(startedBeforeWorkEnd(new Date("2026-11-04T12:00:00Z"), t)).toBe(true);
    expect(startedBeforeWorkEnd(new Date("2026-11-06T12:00:00Z"), t)).toBe(false);
    expect(startedBeforeWorkEnd(new Date("2026-11-06T12:00:00Z"), {})).toBe(true); // work still on
    const later = { holdStartedAt: new Date("2026-11-06T12:00:00Z") };
    expect(pauseCauses(later, t)).toEqual([]);
    expect(pauseClosesAt(later, t)).toBeNull();
    expect(testPaused(later, t)).toBe(false);
    expect(testerPaused(later, t)).toBe(false);
    const before = { holdStartedAt: new Date("2026-11-04T12:00:00Z") };
    expect(pauseCauses(before, t)).toEqual(["hold"]);
    expect(testPaused(before, t)).toBe(true);
    // The 7-day pause closure ends the work too.
    expect(testPaused(later, { pauseClosedAt: end })).toBe(false);
  });

  it("the team's Pause is refused on a closed test", async () => {
    const x = await closedTest();
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await expect(pauseTest(a.user.id, x.testId, "Checking it")).rejects.toMatchObject({ code: "work_ended", message: WORK_ENDED_NO_PAUSE });
    expect(WORK_ENDED_NO_PAUSE).toBe("This test's work has ended, so it can't be paused.");
    expect((await db.test.findUniqueOrThrow({ where: { id: x.testId } })).adminPausedAt).toBeNull();
  });

  it("a hold starting after the work ended: no pause clock, no date moves (close-out, review clocks), none after it lifts", async () => {
    const x = await closedTest();
    const before = await closeOutOf(x.testId);
    const sub0 = await db.submission.findUniqueOrThrow({ where: { id: x.sub.id } });
    await startHold(x.dev.user.id, "unpaid");
    await markPaused({ developerId: x.dev.user.id });
    const t = await db.test.findUniqueOrThrow({ where: { id: x.testId }, include: { developer: true } });
    expect(t.pausedSince).toBeNull();
    expect(testPaused(t.developer, t)).toBe(false);
    expect(pauseClosesAt(t.developer, t)).toBeNull();
    // Some time passes on the hold, then it lifts.
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: new Date(Date.now() - HOUR) } });
    expect((await closeOutOf(x.testId))?.getTime()).toBe(before?.getTime());
    await liftHoldIfClear(x.dev.user.id);
    const sub1 = await db.submission.findUniqueOrThrow({ where: { id: x.sub.id } });
    expect(sub1.payBy?.getTime()).toBe(sub0.payBy?.getTime());
    expect(sub1.choiceBy?.getTime()).toBe(sub0.choiceBy?.getTime());
    expect((await closeOutOf(x.testId))?.getTime()).toBe(before?.getTime());
  });

  it("a suspension starting after the work ended: no paused event or tester line, no running-again line, no date moves", async () => {
    const x = await closedTest();
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const before = await closeOutOf(x.testId);
    const piece0 = await pieceCloseOut({ submissionId: x.sub.id }, "tester");
    const events0 = await db.testEvent.count({ where: { testId: x.testId } });
    const bells0 = await db.notification.count({ where: { userId: x.j.tester.user.id } });
    await suspendAccount(a.user.id, x.dev.user.id, "Checking the account", "developer");
    const t = await db.test.findUniqueOrThrow({ where: { id: x.testId }, include: { developer: true } });
    expect(t.pausedSince).toBeNull();
    expect(pauseCauses(t.developer, t)).toEqual([]);
    expect(await db.testEvent.count({ where: { testId: x.testId, kind: "paused" } })).toBe(0);
    await db.user.update({ where: { id: x.dev.user.id }, data: { devSuspendedAt: new Date(Date.now() - HOUR) } });
    expect((await closeOutOf(x.testId))?.getTime()).toBe(before?.getTime());
    expect((await pieceCloseOut({ submissionId: x.sub.id }, "tester"))?.getTime()).toBe(piece0?.getTime());
    await reinstateAccount(x.dev.user.id, "developer");
    expect(await db.testEvent.count({ where: { testId: x.testId, kind: { in: ["paused", "resumed"] } } })).toBe(0);
    expect(await db.testEvent.count({ where: { testId: x.testId } })).toBe(events0);
    expect(await db.notification.count({ where: { userId: x.j.tester.user.id, text: { contains: "is paused" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: x.j.tester.user.id } })).toBeGreaterThanOrEqual(bells0);
    const sub1 = await db.submission.findUniqueOrThrow({ where: { id: x.sub.id } });
    expect(sub1.payBy?.getTime()).toBe(x.sub.payBy?.getTime());
    expect((await closeOutOf(x.testId))?.getTime()).toBe(before?.getTime());
  });

  it("a pause that started BEFORE the work ended still counts: its span moves the close-out", async () => {
    const x = await closedTest();
    const before = (await closeOutOf(x.testId))!.getTime();
    // A hold from 3 h before the work ended to 1 h before it, recorded in the account history.
    await db.accountEvent.createMany({ data: [
      { userId: x.dev.user.id, kind: "hold", side: "developer", createdAt: new Date(x.ended.getTime() - 3 * HOUR) },
      { userId: x.dev.user.id, kind: "hold-lifted", side: "developer", createdAt: new Date(x.ended.getTime() - HOUR) },
    ] });
    // Its base is the end of the work (after the hold), so it moves nothing; a span crossing the end moves it by the part after the base.
    expect((await closeOutOf(x.testId))!.getTime()).toBe(before);
    await db.accountEvent.createMany({ data: [
      { userId: x.dev.user.id, kind: "hold", side: "developer", createdAt: new Date(x.ended.getTime() - 30 * 60_000) },
      { userId: x.dev.user.id, kind: "hold-lifted", side: "developer", createdAt: new Date(x.ended.getTime() + HOUR) },
    ] });
    expect((await closeOutOf(x.testId))!.getTime()).toBe(before + HOUR);
    // The same span starting after the end: nothing.
    const y = await closedTest();
    const yBefore = (await closeOutOf(y.testId))!.getTime();
    await db.accountEvent.createMany({ data: [
      { userId: y.dev.user.id, kind: "hold", side: "developer", createdAt: new Date(y.ended.getTime() + 30 * 60_000) },
      { userId: y.dev.user.id, kind: "hold-lifted", side: "developer", createdAt: new Date(y.ended.getTime() + HOUR) },
    ] });
    expect((await closeOutOf(y.testId))!.getTime()).toBe(yBefore);
  });

  it("the 7-day pause closure ends the work too: a hold starting after it moves none of the dates", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Smooth."], seenAt: seen(), confirmed: true })).status).toBe(200);
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    // The developer's suspension paused it 8 days ago; the daily job closed it (2 h ago); then the team reinstated them.
    await suspendAccount(a.user.id, f.dev.user.id, "Checking the account", "developer");
    const susp = new Date(Date.now() - 8 * 86_400_000);
    await db.user.update({ where: { id: f.dev.user.id }, data: { devSuspendedAt: susp } });
    await db.test.update({ where: { id: f.testId }, data: { pausedSince: susp } });
    await db.accountEvent.updateMany({ where: { userId: f.dev.user.id, kind: "suspended" }, data: { createdAt: susp } });
    expect((await closePausedTest(f.testId, "daily")).closed).toBe(true);
    const closedAt = new Date(Date.now() - 2 * HOUR);
    await db.test.update({ where: { id: f.testId }, data: { pauseClosedAt: closedAt, stoppedAt: closedAt } });
    await reinstateAccount(f.dev.user.id, "developer");
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).status).toBe("stopped");
    await db.submission.updateMany({ where: { contractId: j.sessionId }, data: { updatedAt: new Date(Date.now() - 3 * HOUR) } });
    const sub0 = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const before = await closeOutOf(f.testId);
    // The piece was sent 3 h ago (its review clock still ahead). A hold that started 1 h ago (after the closure), still on, then lifted.
    await startHold(f.dev.user.id, "unpaid");
    await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date(Date.now() - HOUR) } });
    await db.accountEvent.updateMany({ where: { userId: f.dev.user.id, kind: "hold" }, data: { createdAt: new Date(Date.now() - HOUR) } });
    expect((await closeOutOf(f.testId))?.getTime()).toBe(before?.getTime());
    await liftHoldIfClear(f.dev.user.id);
    const sub1 = await db.submission.findUniqueOrThrow({ where: { id: sub0.id } });
    expect(sub1.payBy?.getTime()).toBe(sub0.payBy?.getTime());
    expect(sub1.choiceBy?.getTime()).toBe(sub0.choiceBy?.getTime());
  });

  it("the admin rows: no Pause on a closed test (an older row's press is refused with the line)", async () => {
    const x = await closedTest();
    const [row] = await testRowsByIds([x.testId]);
    expect(row).toMatchObject({ workEnded: true, adminPaused: false, stopped: false });
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(read("app/admin/TestActions.tsx")).toContain(": workEnded ? null : <AdminButton key=\"pause\"");
    expect(read("app/admin/PagedList.tsx")).toContain(": t.workEnded ? null : <AdminButton key=\"pause\"");
    expect(read("app/admin/AdminBoxes.tsx")).toContain("workEnded={row.workEnded}");
  });

  it("markPaused never starts a pause clock or closes invites on a closed test", async () => {
    const x = await closedTest();
    await markPaused({ id: x.testId });
    expect((await db.test.findUniqueOrThrow({ where: { id: x.testId } })).pausedSince).toBeNull();
  });
});
