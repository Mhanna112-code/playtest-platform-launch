import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily, runSweep } from "@/lib/server/holds";
import { pieceCloseOut } from "@/lib/server/closeOut";
import { DAY, sentWork } from "./b15";

// (Owner, Dec 2026) The developer's "Pay now" line after a freeze of that money (the team's pause of the test, the developer's hold or suspension), like the Rate
// reminders: a freeze that ENDED after their last "Pay now" line gives ONE fresh line at once (from the 5-minute sweep too), then every 3 days from it. One that
// ended before the last line changes nothing.

const H = 3_600_000;
const MIN = 60_000;
/** `day` UTC days after the epoch, at `hours` (09:00 is the daily job's time). */
const on = (day: number, hours: number) => new Date(day * DAY + hours * H);
/** Runs a job at a fake time and dates the lines it made at that time (they're stamped with the real clock; the spacing reads them). */
async function at<T>(when: Date, job: (now: Date) => Promise<T>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}

describe("(Owner, Dec 2026) Pay now after a freeze lifts", () => {
  it("a freeze that ended before the last line: nothing; the team's pause lifted after it: one fresh line from the sweep, the next 3 days after it", async () => {
    const w = await sentWork();
    const opens = R.chargeOpensAt(w.sub, { openUntil: null, status: "open" }, await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } }))!;
    const D = R.utcDayNo(opens) + 1;
    const closes = (await pieceCloseOut({ submissionId: w.sub.id }, on(D, 22)))!;
    expect(closes.getTime()).toBeGreaterThan(on(D + 6, 0).getTime()); // the piece stays open all along
    const lines = () => db.notification.count({ where: { userId: w.dev.user.id, reminderKey: "paynow" } });
    await at(on(D, 22), (now) => runSweep(now)); // Charge opens: the first line, from the sweep
    expect(await lines()).toBe(1);
    // The developer's own suspension, over before that line: nothing new.
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "suspended", side: "developer", createdAt: on(D, 1) } });
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "reinstated", side: "developer", createdAt: on(D, 2) } });
    await at(on(D, 23), (now) => runSweep(now));
    expect(await lines()).toBe(1);
    // The team pauses the test, then lifts the pause.
    await db.testEvent.create({ data: { testId: w.testId, kind: "paused", text: "The team paused this test", createdAt: on(D + 1, 1) } });
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: on(D + 1, 1) } });
    await at(on(D + 1, 5), (now) => runSweep(now)); // paused: no line
    expect(await lines()).toBe(1);
    await db.testEvent.create({ data: { testId: w.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: on(D + 1, 10) } });
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: null } });
    await at(new Date(on(D + 1, 10).getTime() + 5 * MIN), (now) => runSweep(now)); // right after the lift: one fresh line
    expect(await lines()).toBe(2);
    await at(new Date(on(D + 1, 10).getTime() + 10 * MIN), (now) => runSweep(now)); // never twice
    await at(on(D + 2, 9), runDaily);
    await at(on(D + 3, 9), runDaily); // 2 calendar days after the fresh line
    expect(await lines()).toBe(2);
    await at(on(D + 4, 9), runDaily); // 3 calendar days after it
    expect(await lines()).toBe(3);
  }, 240_000);
});

describe("(Owner, Dec 2026) one Pay now line a day, a lift included", () => {
  it("a team pause lifted the same UTC day as the line: nothing that day or the next; the 3-day slot as usual", async () => {
    const w = await sentWork();
    const opens = R.chargeOpensAt(w.sub, { openUntil: null, status: "open" }, await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } }))!;
    const D = R.utcDayNo(opens) + 1;
    const lines = () => db.notification.count({ where: { userId: w.dev.user.id, reminderKey: "paynow" } });
    await at(on(D, 1), (now) => runSweep(now));
    expect(await lines()).toBe(1);
    await db.testEvent.create({ data: { testId: w.testId, kind: "paused", text: "The team paused this test", createdAt: on(D, 2) } });
    await db.testEvent.create({ data: { testId: w.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: on(D, 4) } });
    await at(on(D, 5), (now) => runSweep(now)); // the same day: no fresh line
    await at(on(D + 1, 1), (now) => runSweep(now)); // not deferred to the next day
    await at(on(D + 1, 9), runDaily);
    await at(on(D + 2, 9), runDaily);
    expect(await lines()).toBe(1);
    await at(on(D + 3, 9), runDaily); // the 3-day slot
    expect(await lines()).toBe(2);
  }, 240_000);
});
