import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily, runSweep } from "@/lib/server/holds";
import { ratingReminders } from "@/lib/server/ratings";
import { payoutWaitReminders } from "@/lib/server/restrictions";
import { pieceCloseOut, testerRatingClosesAt } from "@/lib/server/closeOut";
import { joined, setup } from "./fixtures";
import { DAY, pay, sentWork } from "./b15";

// (Owner, Nov 11, §383) The repeating reminders: the FIRST line still comes from the 5-minute sweep at once; the REPEATS come only from the daily job, a UTC
// calendar day (or 3) after the last one and at least 12 hours later (repeatDue).

const H = 3_600_000;
/** `day` UTC days after the epoch, at `hours` (09:00 is the daily job's time). */
const on = (day: number, hours: number) => new Date(day * DAY + hours * H);
/** Runs a job at a fake time and dates the lines it made at that time (they're stamped with the real clock; the spacing reads them). */
async function at<T>(when: Date, job: (now: Date) => Promise<T>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}

describe("§383 daily money lines: first from the sweep, repeats only from the daily job by calendar day", () => {
  it("Charge or let go and Pay now: a 22:00 first line isn't repeated at 09:00 the next morning; one a day after that, never from the sweep", async () => {
    const w = await sentWork();
    const opens = R.chargeOpensAt(w.sub, { openUntil: null, status: "open" }, await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } }))!;
    const D = R.utcDayNo(opens) + 1;
    const closes = (await pieceCloseOut({ submissionId: w.sub.id }, on(D, 22)))!;
    expect(closes.getTime()).toBeGreaterThan(on(D + 4, 0).getTime()); // the piece stays open all along
    const count = async () => [
      await db.notification.count({ where: { userId: w.tester.user.id, reminderKey: "chargeday" } }),
      await db.notification.count({ where: { userId: w.dev.user.id, reminderKey: "paynow" } }),
    ];
    await at(on(D, 22), (now) => runSweep(now)); // Charge opens: both first lines at once, from the sweep
    expect(await count()).toEqual([1, 1]);
    await at(on(D, 23), (now) => runSweep(now));
    await at(on(D + 1, 9), (now) => runSweep(now)); // the sweep never repeats
    expect(await count()).toEqual([1, 1]);
    await at(on(D + 1, 9), runDaily); // 11 hours after the first line: no repeat yet
    expect(await count()).toEqual([1, 1]);
    await at(on(D + 2, 9), (now) => runSweep(now));
    expect(await count()).toEqual([1, 1]);
    await at(on(D + 2, 9), runDaily); // the next calendar day, 35 hours later
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 2, 20), runDaily); // never twice in a day
    expect(await count()).toEqual([2, 2]);
    await at(new Date(on(D + 3, 9).getTime() - 10 * 60_000), runDaily); // a daily run a little earlier than yesterday's: still due (no drift)
    expect(await count()).toEqual([3, 3]);
  }, 180_000);
});

describe("§383 payout waiting: first at once, every 3 calendar days from the daily job", () => {
  it("the sweep tells a new wait at once but never repeats; the daily job repeats 3 calendar days later", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const share = () => db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", transferStatus: "waiting" } });
    const lines = () => db.notification.count({ where: { userId: tester.user.id, reminderKey: "payoutwait" } });
    const p1 = await share();
    const t0 = new Date();
    await payoutWaitReminders(t0, { repeats: false }); // the first line, from the sweep
    expect(await lines()).toBe(1);
    await payoutWaitReminders(new Date(t0.getTime() + 3 * DAY), { repeats: false }); // the sweep never repeats
    expect(await lines()).toBe(1);
    await payoutWaitReminders(new Date(t0.getTime() + 2 * DAY)); // the daily job: 2 days
    expect(await lines()).toBe(1);
    await payoutWaitReminders(new Date(t0.getTime() + 3 * DAY)); // 3 calendar days
    expect(await lines()).toBe(2);
    // The wait ends (the share is sent); a NEW share waiting later is told at once, from the sweep.
    await db.payment.update({ where: { id: p1.id }, data: { transferStatus: "sent" } });
    await db.notification.updateMany({ where: { userId: tester.user.id, reminderKey: "payoutwait" }, data: { createdAt: new Date(t0.getTime() - DAY) } });
    await new Promise((r) => setTimeout(r, 20));
    await share();
    await payoutWaitReminders(new Date(), { repeats: false });
    expect(await lines()).toBe(3);
  });
});

describe("§383 rating reminders: every 3 calendar days, from the daily job only", () => {
  it("the sweep sends no repeat; the daily job does, 3 calendar days after the prompt or the last reminder", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    const prompted = c.ratePromptedAt!;
    const closes = (await testerRatingClosesAt(w.sessionId, new Date(prompted.getTime() + 30 * DAY)))!;
    const P = R.utcDayNo(prompted);
    expect(closes.getTime()).toBeGreaterThan(on(P + 7, 0).getTime());
    const lines = () => db.notification.count({ where: { userId: w.tester.user.id, text: { startsWith: "Reminder: rate " } } });
    await at(on(P + 3, 9), (now) => ratingReminders(now, { repeats: false }));
    expect(await lines()).toBe(0);
    await at(on(P + 2, 23), ratingReminders); // 2 calendar days
    expect(await lines()).toBe(0);
    await at(on(P + 3, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await at(on(P + 5, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await at(on(P + 6, 8), ratingReminders); // 3 calendar days, 71 hours: due
    expect(await lines()).toBe(2);
  }, 180_000);
});
