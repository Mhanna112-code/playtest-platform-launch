import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { chargeOpensAt, pieceDueAt } from "@/lib/rules";
import { closeOutOf, pieceCloseOut } from "@/lib/server/closeOut";
import { liftHoldIfClear, runDaily, shiftAfterPause, startHold } from "@/lib/server/holds";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { adminStopTest, pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { closeJoiningAfterOpenUntil } from "@/lib/server/tests";
import { makeUser } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §366; audit-nov9/reminders-pause-trace.md) Bugs from the reminders / pause trace.
// A) A team-paused test that is then stopped (the developer's Stop, the team's Stop, the 7-day pause closure) keeps adminPausedAt: its pause counted as still on
//    for good (the close-out was "today + 14" every day) and PAUSE_FREE left it out of Charge opening and the reminders. Now a pause ends counting at the stop,
//    and a stopped test is never "paused" for Charge opening and the reminders. The rule: close-out = max(the stop, the last tester deadline) + 14 days, plus
//    any part of a pause between that base and the stop (none here: the stop is the end).
// B) A hold or suspension that STARTS after a Stop moves none of the test's dates (§358 for stopped tests: workEndOf counts the stop).
// C) Review dates of pieces still in review move with a pause (and an outage) when they are set by a deadline that doesn't move: a tester who ended before the
//    pause (left, rated, ended early), or work from before a rejoin (stintDueAt). The ended tester's working deadline itself doesn't move.

const H = 3_600_000, D = 24 * H;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

async function admin() {
  const a = await makeUser({ name: "Team" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a.user.id;
}
/** A test with written answers sent (not reviewed), the team's pause on it since 3 days ago. */
async function pausedWithWork() {
  const s = await setup();
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Fine."], seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await pauseTest(await admin(), s.testId, "Checking it");
  const since = new Date(Date.now() - 3 * D);
  await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: since, pausedSince: since } });
  await db.testEvent.updateMany({ where: { testId: s.testId, kind: "paused" }, data: { createdAt: since } });
  return { ...s, ...j, sub, since };
}

describe("§366 A: a team-paused test that is then stopped reaches its close-out, and Charge opens", () => {
  it.each(["developer's Stop", "team's Stop", "7-day closure"])("%s: the close-out stays put day after day, and unreviewed work gets Charge", async (how) => {
    const w = await pausedWithWork();
    if (how === "developer's Stop") expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    else if (how === "team's Stop") await adminStopTest(w.testId, "Closing this one.");
    else {
      await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: new Date(Date.now() - 8 * D), pausedSince: new Date(Date.now() - 8 * D) } });
      expect((await closePausedTest(w.testId, "daily")).closed).toBe(true);
    }
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId }, include: { contracts: true } });
    expect(t.status).toBe("stopped");
    expect(t.adminPausedAt).not.toBeNull(); // kept on purpose (the admin row reads closed / stopped)
    const now = new Date();
    const base = Math.max(t.stoppedAt!.getTime(), ...t.contracts.map((c) => c.dueAt.getTime()));
    const a = await closeOutOf(w.testId, now), b = await closeOutOf(w.testId, new Date(now.getTime() + 10 * D));
    expect(a!.getTime()).toBe(base + 14 * D);
    expect(b!.getTime()).toBe(a!.getTime());
    // The review date passes: the daily job opens Charge (the stopped test isn't "paused" any more).
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - D) } });
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - D) } });
    await runDaily();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).not.toBeNull();
    // Its Charge closes at a fixed date too.
    const c1 = await pieceCloseOut({ submissionId: w.sub.id }, now), c2 = await pieceCloseOut({ submissionId: w.sub.id }, new Date(now.getTime() + 10 * D));
    expect(c2!.getTime()).toBe(c1!.getTime());
  });
});

describe("§366 B: a hold starting after a Stop moves none of the test's dates", () => {
  it("close-out and review dates stay; the lift moves nothing", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Fine."], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const stopAt = new Date(Date.now() - 2 * H);
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.test.update({ where: { id: s.testId }, data: { stoppedAt: stopAt } });
    await db.submission.updateMany({ where: { contractId: j.sessionId }, data: { updatedAt: new Date(stopAt.getTime() - H) } });
    const sub0 = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const before = await closeOutOf(s.testId);
    await startHold(s.dev.user.id, "unpaid");
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdStartedAt: new Date(Date.now() - H) } });
    await db.accountEvent.updateMany({ where: { userId: s.dev.user.id, kind: "hold" }, data: { createdAt: new Date(Date.now() - H) } });
    expect((await closeOutOf(s.testId))?.getTime()).toBe(before?.getTime());
    await liftHoldIfClear(s.dev.user.id);
    const sub1 = await db.submission.findUniqueOrThrow({ where: { id: sub0.id } });
    expect(sub1.payBy?.getTime()).toBe(sub0.payBy?.getTime());
    expect(sub1.stintDueAt).toBeNull();
    expect((await closeOutOf(s.testId))?.getTime()).toBe(before?.getTime());
  });
});

describe("§366 C: review dates set by a deadline that doesn't move still move with a pause", () => {
  async function sent() {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Fine."], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    return { ...s, ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) };
  }
  const opensAt = async (subId: string) => {
    const x = await db.submission.findUniqueOrThrow({ where: { id: subId }, include: { contract: { include: { test: true } } } });
    return { at: chargeOpensAt(x, x.contract.test, x.contract, new Date(0))!, due: pieceDueAt(x, x.contract), contractDue: x.contract.dueAt };
  };

  it("(a) a tester ended early before the pause, whose own deadline is later than sent + 7: the piece's review date moves; their deadline doesn't", async () => {
    const w = await sent();
    // Her deadline is 20 days out (later than sent + 7); the developer ends her work early.
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() + 20 * D) } });
    expect((await act(w.testId, "end-early", w.dev.cookie, { contractIds: [w.sessionId], reason: "We have enough feedback.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const o0 = await opensAt(w.sub.id);
    const start = new Date(Date.now() - 2 * D), now = new Date();
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    await db.$transaction((tx) => shiftAfterPause(tx, t, start, now));
    const o1 = await opensAt(w.sub.id);
    expect(o1.at.getTime()).toBeGreaterThanOrEqual(o0.at.getTime() + 2 * D - 60_000);
    expect(o1.contractDue.getTime()).toBe(o0.contractDue.getTime()); // the ended tester's working deadline stays
  });

  it("(b) work from before a rejoin (stintDueAt): its review date moves with the pause", async () => {
    const w = await sent();
    const stint = new Date(Date.now() + 15 * D);
    await db.submission.update({ where: { id: w.sub.id }, data: { stintDueAt: stint } });
    const start = new Date(Date.now() - 2 * D), now = new Date();
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    await db.$transaction((tx) => shiftAfterPause(tx, t, start, now));
    const after = (await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).stintDueAt!;
    expect(after.getTime()).toBeGreaterThanOrEqual(stint.getTime() + 2 * D - 60_000);
  });
});

describe("§366 minors", () => {
  it("Open until passing on a PAUSED test closes no pending application (it waits for the lift)", async () => {
    const s = await setup({ joinMode: "apply" });
    const ann = await makeUser({ tester: true, name: "Ann Lee" });
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    expect((await act(s.testId, "apply", ann.cookie, { listingVersion: t.listingVersion, note: "Hi" })).status).toBe(200);
    await pauseTest(await admin(), s.testId, "Checking it");
    await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - H) } });
    await closeJoiningAfterOpenUntil();
    expect((await db.application.findFirstOrThrow({ where: { testId: s.testId, testerId: ann.user.id } })).status).toBe("pending");
    await unpauseTest(s.testId);
  });

  it("reinstatement lifts the suspension and moves the dates in ONE transaction", () => {
    const fn = src("lib/server/restrictions.ts");
    const body = fn.slice(fn.indexOf("export async function reinstateAccount"), fn.indexOf("// ---------- deletion"));
    expect(body).toContain("running = await resumeTests(tx, userId, start!, now, [u.holdStartedAt]);");
    expect(body).not.toContain("await db.$transaction((tx) => resumeTests(");
  });
});
