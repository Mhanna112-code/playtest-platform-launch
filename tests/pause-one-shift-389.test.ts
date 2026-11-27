import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { pauseShiftMs } from "@/lib/rules";
import { pauseTest, reinstateAccount, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { TEAM_STILL_PAUSES_LINE } from "@/lib/server/holds";
import { makeUser } from "./helpers";
import { bookCall, joined, setup } from "./fixtures";

// (Owner, Nov 11, §389) While a test is paused in ANY way (the team's pause, the developer's hold, the developer's suspension, any combination) nothing moves;
// dates move only when it is completely unpaused, ONCE, by the whole continuous paused stretch (overlaps counted once), each date rounded once. The owner's live
// example: suspension Nov 18 7:38 PM → team pause Nov 19 7:41:01 PM → reinstated Nov 19 7:41:06 PM (nothing moves) → the team lifts Nov 20 7:43:30 PM: one shift
// by 48 h 5.5 min. Deadline Nov 24 11:59 PM → Nov 27 11:59 PM (+3, rounded up once; not +4); Open until Nov 25 → Nov 27 (+2: the nearest day end); the call's
// pay date and the review clock + exactly 48 h 5.5 min. The test runs on its own clock (fake Date), never the machine's.

const MIN = 60_000, HOUR = 60 * MIN;
const ZONE = "America/Chicago";
/** A wall-clock time in US Central (CST, UTC−6, in late November). */
const cst = (iso: string) => new Date(`${iso}-06:00`);
const at = (d: Date) => vi.setSystemTime(d);
const SHIFT = 48 * HOUR + 5.5 * MIN;

afterEach(() => vi.useRealTimers());

async function world() {
  const s = await setup({ liveRateCents: "30.00" });
  const j = await joined(s.testId);
  // (Booked on the machine's clock, before the dates below are set to the example's: then moved into the example.)
  const booked = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  const admin = await makeUser({ email: `admin-389-${Date.now()}-${Math.random().toString(36).slice(2)}@playtest.test` });
  await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: ZONE } });
  const dueAt = cst("2026-11-24T23:59:59"), openUntil = cst("2026-11-25T23:59:59");
  await db.test.update({ where: { id: s.testId }, data: { openUntil, status: "open", workEndedAt: null, pausedSince: null } });
  await db.contract.update({ where: { id: j.sessionId }, data: { dueAt } });
  // A call that took place before the pause and waits for its pay date (its review clock).
  const callPayBy = cst("2026-11-21T10:00:00");
  const call = await db.call.update({ where: { id: booked.id }, data: { startsAt: cst("2026-11-17T10:00:00"), actualMinutes: 30, measuredMinutes: 30, measuredAt: cst("2026-11-17T11:00:00"), payBy: callPayBy } });
  // Written answers sent before the pause, in review (Charge opens at payBy).
  const subPayBy = cst("2026-11-22T12:00:00");
  const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", answers: ["a", "b"], payBy: subPayBy } });
  await db.$executeRaw`UPDATE "Submission" SET "updatedAt" = ${cst("2026-11-16T12:00:00")} WHERE id = ${sub.id}`;
  return { ...s, ...j, admin, dueAt, openUntil, call, callPayBy, sub, subPayBy };
}
const dates = async (w: Awaited<ReturnType<typeof world>>) => ({
  dueAt: (await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).dueAt.getTime(),
  openUntil: (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).openUntil!.getTime(),
  callPayBy: (await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).payBy!.getTime(),
  subPayBy: (await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).payBy!.getTime(),
});

describe("§389: dates move only when the test is completely unpaused, once, by the whole stretch", () => {
  it("the rule: another pause still on moves nothing; the last lift counts the whole stretch", () => {
    expect(pauseShiftMs(new Date(0), new Date(5 * HOUR))).toBe(5 * HOUR);
    expect(pauseShiftMs(new Date(0), new Date(5 * HOUR), [new Date(2 * HOUR)])).toBe(0);
  });

  it("the owner's example: suspension → team pause → reinstated (nothing moves) → the team lifts: one shift by 48 h 5.5 min", async () => {
    const w = await world();
    const before = await dates(w);
    vi.useFakeTimers({ toFake: ["Date"] });
    at(cst("2026-11-18T19:38:00"));
    await suspendAccount(w.admin.user.id, w.dev.user.id, "Checking a report about this account.", "developer");
    at(cst("2026-11-19T19:41:01"));
    await pauseTest(w.admin.user.id, w.testId, "Checking a report about this test.");
    at(cst("2026-11-19T19:41:06"));
    await reinstateAccount(w.dev.user.id, "developer", w.admin.user.id);
    expect(await dates(w), "reinstated while the team's pause is on: nothing moves").toEqual(before);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).pausedSince!.getTime()).toBe(cst("2026-11-18T19:38:00").getTime()); // the stretch's start stays
    at(cst("2026-11-20T19:43:30"));
    await unpauseTest(w.testId, w.admin.user.id);
    const after = await dates(w);
    expect(new Date(after.dueAt)).toEqual(cst("2026-11-27T23:59:59")); // Nov 24 → Nov 27 (+3), rounded up once
    expect(new Date(after.openUntil)).toEqual(cst("2026-11-27T23:59:59")); // Nov 25 → Nov 27 (+2), the nearest day end
    expect(after.callPayBy - before.callPayBy).toBe(SHIFT);
    expect(after.subPayBy - before.subPayBy).toBe(SHIFT);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).pausedSince).toBeNull();
  });

  it("the other order: team pause → suspension → the team lifts (nothing moves) → reinstated: one shift by the whole stretch", async () => {
    const w = await world();
    const before = await dates(w);
    vi.useFakeTimers({ toFake: ["Date"] });
    at(cst("2026-11-18T19:38:00"));
    await pauseTest(w.admin.user.id, w.testId, "Checking a report about this test.");
    at(cst("2026-11-19T08:00:00"));
    await suspendAccount(w.admin.user.id, w.dev.user.id, "Checking a report about this account.", "developer");
    at(cst("2026-11-19T20:00:00"));
    await unpauseTest(w.testId, w.admin.user.id);
    expect(await dates(w), "the team lifted while the suspension is on: nothing moves").toEqual(before);
    at(cst("2026-11-20T19:43:30"));
    await reinstateAccount(w.dev.user.id, "developer", w.admin.user.id);
    const after = await dates(w);
    expect(after.callPayBy - before.callPayBy).toBe(SHIFT);
    expect(new Date(after.dueAt)).toEqual(cst("2026-11-27T23:59:59"));
    expect(new Date(after.openUntil)).toEqual(cst("2026-11-27T23:59:59"));
  });

  it("the developer's 'every deadline moved' after a hold lift names a test the team still pauses", () => {
    expect(TEAM_STILL_PAUSES_LINE).toBe("A test the team paused stays paused: its deadlines move on when the team lifts the pause.");
  });
});
