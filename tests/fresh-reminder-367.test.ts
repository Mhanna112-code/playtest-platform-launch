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
// reminder is sent, the date moves +2 days, one fresh reminder names the new date, nothing more is sent for the old date. (Owner, Dec 2026: one line a day, a lift
// included) The tester's Charge and Rate lines: no fresh line on a UTC day that already had that line; the 3-day slot names the new date.

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
/** (Owner, Dec 2026) A recorded outage from `start` to `end` (removed after each test). */
async function outage(start: Date, end: Date) {
  const o = await db.outage.create({ data: { startAt: start, endAt: end, ms: end.getTime() - start.getTime() } });
  outages.push(o.id);
}
/** The start (00:00 UTC) of the day a moment falls on, in ms. */
const dayStart = (d: Date) => Math.floor(d.getTime() / DAY) * DAY;
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
    // (Owner, Dec 2026: one line a day, a lift included; was "even within the day") A date moved later on a day that already had her line: no fresh line that day
    // nor the next; the 3-day slot names the new date. A move on a later day: the fresh line at once.
    const w = await sentWork();
    const atC = (await pieceCloseOut({ submissionId: w.sub.id }, LATER()))!;
    const lines = async () => (await db.notification.findMany({ where: { userId: w.tester.user.id, reminderKey: "chargeday" }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    const T0 = new Date(dayStart(new Date(atC.getTime() - 3 * DAY)) + 3_600_000); // 01:00 UTC
    await at(T0, runDaily); // Charge open: her first line
    const before = await lines();
    expect(before).toHaveLength(1);
    expect(before[0]).toContain(D(atC));
    await outage(new Date(T0.getTime() - 3 * DAY), new Date(T0.getTime() - DAY));
    const at2 = (await pieceCloseOut({ submissionId: w.sub.id }, T0))!;
    expect(at2.getTime() - atC.getTime()).toBe(2 * DAY);
    await at(new Date(T0.getTime() + 2 * 3_600_000), runDaily); // the same UTC day: no second line
    await at(new Date(T0.getTime() + DAY), runDaily); // nor the next day (the new date counts as named)
    expect(await lines()).toHaveLength(1);
    await at(new Date(T0.getTime() + 3 * DAY), runDaily); // the 3-day slot, naming the new date
    expect((await lines()).slice(1)).toEqual([expect.stringContaining(D(at2))]);
    await outage(new Date(T0.getTime() + 1.2 * DAY), new Date(T0.getTime() + 2.2 * DAY)); // moves it a day later again
    const at3 = (await pieceCloseOut({ submissionId: w.sub.id }, new Date(T0.getTime() + 4 * DAY)))!;
    expect(at3.getTime() - at2.getTime()).toBe(DAY);
    await at(new Date(T0.getTime() + 4 * DAY), runDaily); // a later day: the fresh line at once
    await at(new Date(T0.getTime() + 4 * DAY + 3_600_000), runDaily);
    expect((await lines()).slice(2)).toEqual([expect.stringContaining(D(at3))]);
  }, 180_000);

  it("the tester's rating reminders: a close-out moved later gets a line naming it, but (Owner, Dec 2026) never a second line the same UTC day", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    expect(c.ratePromptedAt).not.toBeNull();
    const closes = (await testerRatingClosesAt(w.sessionId, LATER()))!;
    const lines = async () => (await db.notification.findMany({ where: { userId: w.tester.user.id, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    const t1 = new Date(dayStart(closes) - DAY + 3_600_000); // 01:00 UTC the day before the close-out's day
    await at(t1, ratingReminders);
    const before = await lines();
    expect(before).toHaveLength(1);
    expect(before[0]).toContain(D(closes));
    await outage(new Date(closes.getTime() - 7 * DAY), new Date(closes.getTime() - 3 * DAY)); // 4 days
    const closes2 = (await testerRatingClosesAt(w.sessionId, t1))!;
    expect(closes2.getTime() - closes.getTime()).toBe(4 * DAY);
    await at(new Date(t1.getTime() + 2 * 3_600_000), (now) => ratingReminders(now, { repeats: false })); // the same UTC day: no second line
    await at(new Date(t1.getTime() + DAY), ratingReminders); // nor the next day (the new date counts as named)
    expect(await lines()).toHaveLength(1);
    await at(new Date(t1.getTime() + 3 * DAY), ratingReminders); // the 3-day slot names the new date
    expect((await lines()).slice(1)).toEqual([expect.stringContaining(D(closes2))]);
    // (§367) Moved later again, on a later day: one fresh line at once (from the sweep), naming it.
    await outage(new Date(t1.getTime() + 1.2 * DAY), new Date(t1.getTime() + 2.2 * DAY));
    const closes3 = (await testerRatingClosesAt(w.sessionId, new Date(t1.getTime() + 4 * DAY)))!;
    expect(closes3.getTime() - closes2.getTime()).toBe(DAY);
    await at(new Date(t1.getTime() + 4 * DAY), (now) => ratingReminders(now, { repeats: false }));
    await at(new Date(t1.getTime() + 4 * DAY + 3_600_000), (now) => ratingReminders(now, { repeats: false }));
    expect((await lines()).slice(2)).toEqual([expect.stringContaining(D(closes3))]);
  }, 180_000);
});
