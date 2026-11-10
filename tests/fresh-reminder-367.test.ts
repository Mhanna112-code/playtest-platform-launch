import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { ratingReminders } from "@/lib/server/ratings";
import { pieceCloseOut, testerRatingClosesAt } from "@/lib/server/closeOut";
import { T, renderTimes } from "@/lib/tz";
import { pay, sentWork } from "./b15";

// (Owner, Nov 9, §367) When a date moves LATER after its series' last reminder already went out (a pause or its lift, an outage, Open until extended, a rejoin, the
// dispute rating extension), ONE fresh reminder names the NEW date, then the series goes on for the new date. Never two for the same date. Each kind: the last
// reminder is sent, the date moves +2 days, one fresh reminder names the new date, nothing more is sent for the old date.

const DAY = 86_400_000;
/** A date as the stored line reads it (the reader has no saved zone: UTC). */
const D = (d: Date) => renderTimes(T(d, "date"), "UTC");
/** A moment after every deadline and Open until of a fresh test (its close-out is known then). */
const LATER = () => new Date(Date.now() + 25 * DAY);
/** A recorded 2-day outage just before `at` (an outage moves every date counting through it): the dates after it move 2 days later. Removed after each test. */
const outages: string[] = [];
async function outageBefore(at: Date) {
  const o = await db.outage.create({ data: { startAt: new Date(at.getTime() - 5 * DAY), endAt: new Date(at.getTime() - 3 * DAY), ms: 2 * DAY } });
  outages.push(o.id);
}
afterEach(async () => { await db.outage.deleteMany({ where: { id: { in: outages.splice(0) } } }); });
/**
 * Runs a reminder job at a fake time and dates the notifications it made at that time (they're stamped with the real clock): the once-a-day and every-3-days
 * spacing reads them, so a fake-clock run would otherwise always find the last line days ago.
 */
async function at<T>(when: Date, job: (now: Date) => Promise<T>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}

describe("§367 datedMarkDue: a later date after the series' last mark gets one fresh reminder", () => {
  const sent = new Date("2026-11-01T12:00:00Z");
  const old = new Date("2026-11-20T12:00:00Z");
  const moved = new Date(old.getTime() + 2 * DAY);
  it("review marks: the 1-day mark sent for the old date; the first look at the later date sends its latest passed mark once", () => {
    const at = new Date(old.getTime() - 0.5 * DAY);
    const first = R.reviewMarkDue(sent, old, at, []);
    expect(first.send?.mark).toBe("1d");
    const rec = first.record;
    const fresh = R.reviewMarkDue(sent, moved, new Date(at.getTime() + 3_600_000), rec);
    expect(fresh.send?.mark).toBe("3d"); // within 3 days of the new date
    const rec2 = [...rec, ...fresh.record];
    expect(R.reviewMarkDue(sent, moved, new Date(at.getTime() + 2 * 3_600_000), rec2).send).toBeNull(); // never twice for the same date
    // Moved EARLIER, or moved before the last mark went out: as before (no fresh line for a mark already sent).
    const wk = R.reviewMarkDue(sent, old, new Date(old.getTime() - 6.5 * DAY), []);
    expect(wk.send?.mark).toBe("1w");
    expect(R.reviewMarkDue(sent, new Date(old.getTime() + 0.2 * DAY), new Date(old.getTime() - 6.4 * DAY), wk.record).send).toBeNull();
  });
});

describe("§367 (fake clock) each reminder series", () => {
  it("the developer's review reminders", async () => {
    const w = await sentWork();
    const t0 = w.sub.updatedAt.getTime();
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(t0 + 20 * DAY) } });
    const lines = async () => (await db.notification.findMany({ where: { userId: w.dev.user.id, reminderKey: `unreviewed:${w.sub.id}` }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    await runDaily(new Date(t0 + 19.5 * DAY));
    const before = await lines();
    expect(before.filter((x) => x.includes(" by tomorrow "))).toHaveLength(1);
    const oldDate = D(new Date(t0 + 20 * DAY)), newDate = D(new Date(t0 + 22 * DAY));
    expect(before[before.length - 1]).toContain(`(${oldDate})`);
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(t0 + 22 * DAY) } }); // +2 days (an extension or a rejoin)
    await runDaily(new Date(t0 + 19.6 * DAY));
    const fresh = (await lines()).slice(before.length);
    expect(fresh).toEqual([expect.stringContaining(`(${newDate})`)]);
    await runDaily(new Date(t0 + 19.7 * DAY));
    await runDaily(new Date(t0 + 20.1 * DAY));
    expect((await lines()).filter((x) => x.includes(`(${oldDate})`))).toHaveLength(1);
    expect((await lines()).length).toBe(before.length + 1);
    // The series goes on for the new date.
    await runDaily(new Date(t0 + 21.5 * DAY));
    const after = (await lines()).slice(before.length + 1);
    expect(after).toEqual([expect.stringContaining(` by tomorrow (${newDate})`)]);
  }, 180_000);

  it("the developer's Closing soon reminders", async () => {
    const w = await sentWork();
    const at = (await pieceCloseOut({ submissionId: w.sub.id }, LATER()))!;
    const day = (d: number) => new Date((Math.floor(at.getTime() / DAY) + d) * DAY + 3_600_000); // 1 AM UTC on a day relative to the closing day
    const lines = async () => (await db.notification.findMany({ where: { userId: w.dev.user.id, reminderKey: { startsWith: "closesoon:" } }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    await runDaily(new Date(at.getTime() - 10 * DAY)); // Charge opens: the countdown's 1 week, 3 days and 1 day are all ahead
    await runDaily(day(-1));
    const before = await lines();
    expect(before).toHaveLength(1);
    expect(before[0]).toContain(D(at));
    await outageBefore(at);
    const at2 = (await pieceCloseOut({ submissionId: w.sub.id }, day(0)))!;
    expect(at2.getTime() - at.getTime()).toBe(2 * DAY);
    await runDaily(day(0));
    const fresh = (await lines()).slice(1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain(D(at2));
    await runDaily(new Date(day(0).getTime() + 6 * 3_600_000));
    expect((await lines()).filter((x) => x.includes(D(at)))).toHaveLength(1);
    expect(await lines()).toHaveLength(2);
    await runDaily(day(1)); // the new date's 1-day mark
    const after = (await lines()).slice(2);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain(D(at2));
  }, 180_000);

  it("the tester's Charge closing reminders (the daily Charge or let go line)", async () => {
    const w = await sentWork();
    const atC = (await pieceCloseOut({ submissionId: w.sub.id }, LATER()))!;
    const lines = async () => (await db.notification.findMany({ where: { userId: w.tester.user.id, reminderKey: "chargeday" }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    const t1 = new Date(atC.getTime() - 0.5 * DAY);
    await at(new Date(atC.getTime() - 3 * DAY), runDaily); // Charge opens
    await at(t1, runDaily);
    const before = await lines();
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(before[before.length - 1]).toContain(D(atC));
    await outageBefore(atC);
    const at2 = (await pieceCloseOut({ submissionId: w.sub.id }, t1))!;
    expect(at2.getTime() - atC.getTime()).toBe(2 * DAY);
    await at(new Date(t1.getTime() + 3_600_000), runDaily); // within the day: the daily line alone would wait
    const fresh = (await lines()).slice(before.length);
    expect(fresh).toEqual([expect.stringContaining(D(at2))]);
    await at(new Date(t1.getTime() + 2 * 3_600_000), runDaily);
    expect((await lines()).length).toBe(before.length + 1);
    expect((await lines()).filter((x) => x.includes(D(atC)))).toHaveLength(before.length);
  }, 180_000);

  it("the tester's rating reminders: the close-out moving under 3 days after the last one still gets a line naming it", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    expect(c.ratePromptedAt).not.toBeNull();
    const closes = (await testerRatingClosesAt(w.sessionId, LATER()))!;
    const lines = async () => (await db.notification.findMany({ where: { userId: w.tester.user.id, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    const t1 = new Date(closes.getTime() - 1 * DAY);
    await at(t1, ratingReminders); // the last one (the next 3-day slot falls after the close-out)
    const before = await lines();
    expect(before).toHaveLength(1);
    expect(before[0]).toContain(D(closes));
    await outageBefore(closes);
    const closes2 = (await testerRatingClosesAt(w.sessionId, t1))!;
    expect(closes2.getTime() - closes.getTime()).toBe(2 * DAY);
    await at(new Date(t1.getTime() + 3_600_000), ratingReminders);
    const fresh = (await lines()).slice(1);
    expect(fresh).toEqual([expect.stringContaining(D(closes2))]);
    await at(new Date(t1.getTime() + 2 * 3_600_000), ratingReminders);
    await at(new Date(t1.getTime() + 1.5 * DAY), ratingReminders);
    expect(await lines()).toHaveLength(2);
    expect((await lines()).filter((x) => x.includes(D(closes)))).toHaveLength(1);
  }, 180_000);
});
