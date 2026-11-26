import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily, runSweep } from "@/lib/server/holds";
import { DAY, sentWork } from "./b15";

// (Owner, Nov 26 2026) The tester's "Charge or let go" line after a freeze lifts gets ONE fresh line, even when her last line named no closing date ("tc:0", sent
// while the test was still open), like the developer's "Pay now": a money freeze of her piece's test (the team's pause, the developer's hold or suspension) or
// her own tester-side suspension that ENDED after her last line, on a later UTC day than it. From the 5-minute sweep too; the 3-day repeats count from it.

const H = 3_600_000;
const MIN = 60_000;
/** `day` UTC days after the epoch, at `hours` (09:00 is the daily job's time). */
const on = (day: number, hours: number) => new Date(day * DAY + hours * H);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
/** Runs a job at a fake time and dates the lines it made at that time (they're stamped with the real clock; the spacing reads them). */
async function at<T>(when: Date, job: (now: Date) => Promise<T>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}

/** Sent work on a test still open (Open until far ahead: no closing date known), its Charge open, and her first line (no date named) at 22:00 UTC on day D. */
async function openCharge() {
  const w = await sentWork();
  const opens = R.chargeOpensAt(w.sub, { openUntil: null, status: "open" }, await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } }))!;
  const D = R.utcDayNo(opens) + 1;
  await db.test.update({ where: { id: w.testId }, data: { openUntil: on(D + 60, 0) } });
  const all = () => db.notification.findMany({ where: { userId: w.tester.user.id, reminderKey: "chargeday" }, orderBy: { createdAt: "asc" }, select: { text: true } });
  const lines = async () => (await all()).length;
  await at(on(D, 22), (now) => runSweep(now)); // Charge opens: her first line, from the sweep
  expect(await lines()).toBe(1);
  expect((await all())[0].text).not.toContain(", by "); // no closing date named
  expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).devMarks).toContain("tc:0");
  return { w, D, lines, all };
}

/** After a lift at `lift`: one fresh line at the sweep 5 minutes later, none at a second sweep that day, the next 3 UTC days after the fresh line. */
async function freshAfter(lift: Date, lines: () => Promise<number>) {
  const before = await lines();
  await at(plus(lift, 5 * MIN), (now) => runSweep(now)); // right after the lift: one fresh line
  expect(await lines()).toBe(before + 1);
  await at(plus(lift, 10 * MIN), (now) => runSweep(now)); // never twice
  await at(plus(lift, 6 * H), (now) => runSweep(now));
  expect(await lines()).toBe(before + 1);
  const L = R.utcDayNo(lift);
  await at(on(L + 1, 9), runDaily);
  await at(on(L + 2, 9), runDaily); // 2 calendar days after the fresh line
  expect(await lines()).toBe(before + 1);
  await at(on(L + 3, 9), runDaily); // 3 calendar days after it
  expect(await lines()).toBe(before + 2);
}

describe("(Owner, Nov 26 2026) Charge or let go after a freeze lifts, no date named", () => {
  it("the team's pause lifted on a later UTC day: one fresh line from the sweep, the next 3 days after it", async () => {
    const { w, D, lines, all } = await openCharge();
    await db.testEvent.create({ data: { testId: w.testId, kind: "paused", text: "The team paused this test", createdAt: on(D + 1, 1) } });
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: on(D + 1, 1) } });
    await at(on(D + 1, 5), (now) => runSweep(now)); // paused: no line
    expect(await lines()).toBe(1);
    await db.testEvent.create({ data: { testId: w.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: on(D + 1, 10) } });
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: null } });
    await freshAfter(on(D + 1, 10), lines);
    expect((await all())[1].text).not.toContain(", by "); // still no date known: the fresh line names none
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).devMarks.filter((x) => x.startsWith("tc:"))).toEqual(["tc:0"]);
  }, 240_000);

  it("the developer's suspension, then reinstatement on a later UTC day: one fresh line", async () => {
    const { w, D, lines } = await openCharge();
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "suspended", side: "developer", createdAt: on(D + 1, 1) } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: on(D + 1, 1) } });
    await at(on(D + 1, 5), (now) => runSweep(now)); // frozen: no line
    expect(await lines()).toBe(1);
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "reinstated", side: "developer", createdAt: on(D + 2, 3) } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: null } });
    await freshAfter(on(D + 2, 3), lines);
  }, 240_000);

  it("her own tester-side suspension, then reinstatement on a later UTC day: one fresh line", async () => {
    const { w, D, lines } = await openCharge();
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: on(D + 1, 1) } });
    await db.user.update({ where: { id: w.tester.user.id }, data: { testerSuspendedAt: on(D + 1, 1) } });
    await at(on(D + 1, 5), (now) => runSweep(now)); // her tester side suspended: no line
    expect(await lines()).toBe(1);
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: on(D + 1, 12) } });
    await db.user.update({ where: { id: w.tester.user.id }, data: { testerSuspendedAt: null } });
    await freshAfter(on(D + 1, 12), lines);
  }, 240_000);

  it("a lift on the same UTC day as her last line: none that day nor the next; the 3-day slot as usual", async () => {
    const { w, D, lines } = await openCharge();
    await db.testEvent.create({ data: { testId: w.testId, kind: "paused", text: "The team paused this test", createdAt: on(D, 22.2) } });
    await db.testEvent.create({ data: { testId: w.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: on(D, 23) } });
    await at(on(D, 23.2), (now) => runSweep(now)); // the same day: no fresh line
    await at(on(D + 1, 1), (now) => runSweep(now)); // not deferred to the next day
    await at(on(D + 1, 9), runDaily);
    await at(on(D + 2, 9), runDaily);
    expect(await lines()).toBe(1);
    await at(on(D + 3, 9), runDaily); // the 3-day slot
    expect(await lines()).toBe(2);
  }, 240_000);

  it("a test never frozen: no extra line (the sweeps send nothing; the daily job every 3 days)", async () => {
    const { D, lines } = await openCharge();
    await at(on(D + 1, 1), (now) => runSweep(now));
    await at(on(D + 1, 9), runDaily);
    await at(on(D + 2, 9), runDaily);
    await at(on(D + 2, 10), (now) => runSweep(now));
    expect(await lines()).toBe(1);
    await at(on(D + 3, 9), runDaily);
    expect(await lines()).toBe(2);
    await at(on(D + 4, 10), (now) => runSweep(now));
    expect(await lines()).toBe(2);
  }, 240_000);
});
