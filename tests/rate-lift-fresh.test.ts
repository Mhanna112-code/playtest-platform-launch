import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { ratingReminders } from "@/lib/server/ratings";
import { testerRateLiftedAt, testerRatingClosesAt } from "@/lib/server/closeOut";
import { T, renderTimes } from "@/lib/tz";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { pay, sentWork } from "./b15";

// (Owner, Dec 2026) Rate reminders come back after a pause the way the tester's "Charge or let go" line does: when a freeze lifts (the team's pause, the
// developer's hold or suspension, the tester's own suspension; for the developer, their own hold or suspension or the team's pause), ONE fresh reminder right
// away (from the 5-minute sweep too), then the every-3-days repeats count from it. A freeze that ended before the last reminder changes nothing.
// (Owner, Dec 10 2026) The tester's: a money freeze counts only when it hid her Rate (work waiting for review in it); otherwise her Rate stayed open.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const D = (d: Date) => renderTimes(T(d, "date"), "UTC");
const sweep = (now: Date) => ratingReminders(now, { repeats: false });
/** Runs a reminder job at a fake time and dates the lines it made at that time (they're stamped with the real clock), as fresh-reminder-367 does. */
async function at<R>(when: Date, job: (now: Date) => Promise<R>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}
/** The team's pause of a test from `start` (on now when `end` is left out), as the test's events and adminPausedAt record it. */
async function teamPause(testId: string, start: Date, end?: Date) {
  await db.testEvent.create({ data: { testId, kind: "paused", text: "The team paused this test", createdAt: start } });
  if (end) await db.testEvent.create({ data: { testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: end } });
  await db.test.update({ where: { id: testId }, data: { adminPausedAt: end ? null : start } });
}
async function testerRateOpen() {
  const w = await sentWork();
  expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
  expect(c.ratePromptedAt).not.toBeNull();
  const lines = async () => (await db.notification.findMany({ where: { userId: w.tester.user.id, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
  return { w, prompted: c.ratePromptedAt!, lines };
}

describe("(Owner, Dec 2026) the tester's Rate reminder after a freeze lifts", () => {
  it("before the test closes: a team pause that hid her Rate (work waiting for review) gives one fresh line once her Rate is open again, the next only 3 days after it", async () => {
    const { w, prompted: P, lines } = await testerRateOpen();
    // Keep the test running (no close-out known) through the whole run.
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() + 60 * DAY) } });
    expect(await testerRatingClosesAt(w.sessionId, new Date(P.getTime() + 10 * DAY))).toBeNull();
    const t1 = new Date(P.getTime() + 3 * DAY);
    await at(t1, ratingReminders); // the first repeat (3 days after the prompt)
    expect(await lines()).toHaveLength(1);
    // (Owner, Dec 10 2026) She sends more work right after it: its review date is a week ahead, so her Rate is disabled, and hidden once the pause begins.
    const more = await db.submission.create({ data: { contractId: w.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(t1.getTime() + HOUR), payBy: new Date(t1.getTime() + 8 * DAY) } });
    await teamPause(w.testId, new Date(t1.getTime() + 2 * HOUR));
    await at(new Date(t1.getTime() + 6 * HOUR), sweep);
    await at(new Date(t1.getTime() + DAY), ratingReminders); // paused with work waiting: her Rate is hidden
    expect(await lines()).toHaveLength(1);
    const L = new Date(t1.getTime() + DAY + HOUR);
    await db.testEvent.create({ data: { testId: w.testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: L } });
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: null } });
    await at(new Date(L.getTime() + 5 * MIN), sweep); // lifted, but her Rate is still disabled (the work waits for review): no line yet
    expect(await lines()).toHaveLength(1);
    await db.review.create({ data: { contractId: w.sessionId, submissionId: more.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), createdAt: new Date(L.getTime() + HOUR) } });
    const R = new Date(L.getTime() + 2 * HOUR);
    await at(R, sweep); // reviewed: her Rate is open again, one fresh line
    expect(await lines()).toHaveLength(2);
    expect((await lines())[1]).toBe("Reminder: rate Nora Lane on “Harbor Run”");
    await at(new Date(R.getTime() + 10 * MIN), sweep); // never twice
    await at(new Date(R.getTime() + DAY), ratingReminders);
    await at(new Date(R.getTime() + 2 * DAY), ratingReminders);
    expect(await lines()).toHaveLength(2);
    await at(new Date(R.getTime() + 3 * DAY), ratingReminders); // 3 days after the fresh line
    expect(await lines()).toHaveLength(3);
  }, 180_000);

  it("(Owner, Dec 10 2026) a team pause while everything she sent was reviewed: her Rate stayed open, so no fresh line at the lift; the repeats go on", async () => {
    const { w, prompted: P, lines } = await testerRateOpen();
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() + 60 * DAY) } });
    const t1 = new Date(P.getTime() + 3 * DAY);
    await at(t1, ratingReminders);
    expect(await lines()).toHaveLength(1);
    const L = new Date(t1.getTime() + DAY + HOUR);
    await teamPause(w.testId, new Date(t1.getTime() + 2 * HOUR), L);
    expect(await testerRateLiftedAt(w.sessionId, new Date(L.getTime() + 5 * MIN))).toBeNull();
    await at(new Date(L.getTime() + 5 * MIN), sweep);
    expect(await lines()).toHaveLength(1);
    await at(new Date(t1.getTime() + 3 * DAY), ratingReminders); // the 3-day slot from her last line
    expect(await lines()).toHaveLength(2);
  }, 180_000);

  it("after the test closed: a pause that both moved the date and lifted still gives ONE line, naming the new date", async () => {
    const { w, prompted: P, lines } = await testerRateOpen();
    const t1 = new Date(P.getTime() + 25 * DAY); // after every deadline and Open until
    const closes = (await testerRatingClosesAt(w.sessionId, t1))!;
    expect(closes.getTime()).toBeGreaterThan(t1.getTime() + 3 * DAY);
    await at(t1, ratingReminders);
    expect(await lines()).toEqual([expect.stringContaining(D(closes))]);
    const L = new Date(t1.getTime() + 2 * DAY);
    await teamPause(w.testId, new Date(t1.getTime() + HOUR), L);
    const closes2 = (await testerRatingClosesAt(w.sessionId, new Date(L.getTime() + 5 * MIN)))!;
    expect(closes2.getTime() - closes.getTime()).toBe(2 * DAY - HOUR);
    await at(new Date(L.getTime() + 5 * MIN), sweep);
    await at(new Date(L.getTime() + 10 * MIN), sweep);
    await at(new Date(L.getTime() + 2 * HOUR), ratingReminders);
    const after = (await lines()).slice(1);
    expect(after).toEqual([expect.stringContaining(D(closes2))]);
  }, 180_000);

  it("no fresh line when the freeze ended before her last reminder", async () => {
    const { w, prompted: P, lines } = await testerRateOpen();
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() + 60 * DAY) } });
    await teamPause(w.testId, new Date(P.getTime() + DAY), new Date(P.getTime() + 1.5 * DAY));
    // Her own tester-side suspension, also over before the reminder.
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(P.getTime() + 1.6 * DAY) } });
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(P.getTime() + 2 * DAY) } });
    const t1 = new Date(P.getTime() + 3 * DAY);
    await at(t1, ratingReminders);
    expect(await lines()).toHaveLength(1);
    await at(new Date(t1.getTime() + HOUR), sweep);
    await at(new Date(t1.getTime() + DAY), ratingReminders);
    await at(new Date(t1.getTime() + DAY + HOUR), sweep);
    expect(await lines()).toHaveLength(1);
  }, 180_000);
});

// ---------- the developer ----------

const ago = (days: number) => new Date(Date.now() - days * DAY);
const payNow = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
/** A tester who sent work, was paid and rated `ratedDaysAgo` days ago: the developer's Rate opened then (its opening line dated then too). */
async function devRateOpen(ratedDaysAgo: number) {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await payNow(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 4 })).status).toBe(200);
  await db.rating.updateMany({ where: { contractId: j.sessionId, side: "tester" }, data: { createdAt: ago(ratedDaysAgo) } });
  await db.review.updateMany({ where: { contractId: j.sessionId }, data: { createdAt: ago(ratedDaysAgo + 1) } });
  await db.notification.updateMany({ where: { userId: s.dev.user.id, reminderKey: `rate-open:${j.sessionId}` }, data: { createdAt: ago(ratedDaysAgo) } });
  const lines = () => db.notification.count({ where: { userId: s.dev.user.id, text: { startsWith: "Reminder: rate Ana Silva for “Harbor Run”" } } });
  return { s, j, lines };
}

describe("(Owner, Dec 2026) the developer's Rate reminder after a freeze lifts", () => {
  it("their own suspension lifted after their last reminder: one fresh line from the sweep at once, then nothing until the 3 days", async () => {
    const { s, lines } = await devRateOpen(8);
    await at(ago(4), ratingReminders);
    expect(await lines()).toBe(1);
    await db.accountEvent.create({ data: { userId: s.dev.user.id, kind: "suspended", side: "developer", createdAt: ago(3) } });
    await db.accountEvent.create({ data: { userId: s.dev.user.id, kind: "reinstated", side: "developer", createdAt: ago(1) } });
    const now = new Date();
    await at(now, sweep);
    expect(await lines()).toBe(2);
    await at(new Date(now.getTime() + 5 * MIN), sweep);
    await at(new Date(now.getTime() + HOUR), ratingReminders);
    expect(await lines()).toBe(2);
  }, 180_000);

  it("the team's pause lifted before their last reminder: no fresh line", async () => {
    const { s, lines } = await devRateOpen(8);
    await teamPause(s.testId, ago(7.5), ago(6));
    await at(ago(2), ratingReminders); // (2 days ago: the daily job below isn't due for its own repeat yet)
    expect(await lines()).toBe(1);
    await at(new Date(), sweep);
    await at(new Date(Date.now() + HOUR), ratingReminders);
    expect(await lines()).toBe(1);
  }, 180_000);
});

// (Owner, Dec 2026: one line a day, a lift included) A lift on a UTC day that already had that person's reminder: no fresh line that day, nor deferred to the next;
// the next comes at the 3-day slot from that day's line.
const dayStart = (d: Date) => Math.floor(d.getTime() / DAY) * DAY;

describe("(Owner, Dec 2026) one Rate line a day, a lift included", () => {
  it("tester: a team pause lifted the same UTC day as her reminder: nothing that day or the next; the 3-day slot as usual", async () => {
    const { w, prompted: P, lines } = await testerRateOpen();
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() + 60 * DAY) } });
    const t1 = new Date(dayStart(P) + 3 * DAY + HOUR); // 01:00 UTC, 3 calendar days after the prompt
    await at(t1, ratingReminders);
    expect(await lines()).toHaveLength(1);
    await teamPause(w.testId, new Date(t1.getTime() + HOUR), new Date(t1.getTime() + 3 * HOUR));
    await at(new Date(t1.getTime() + 3 * HOUR + 5 * MIN), sweep); // the same day: no fresh line
    await at(new Date(t1.getTime() + DAY), sweep); // not deferred to the next day
    await at(new Date(t1.getTime() + DAY), ratingReminders);
    await at(new Date(t1.getTime() + 2 * DAY), ratingReminders);
    expect(await lines()).toHaveLength(1);
    await at(new Date(t1.getTime() + 3 * DAY), ratingReminders); // the 3-day slot
    expect(await lines()).toHaveLength(2);
  }, 180_000);

  it("developer: their suspension lifted the same UTC day as their reminder: nothing that day or the next; the 3-day slot as usual", async () => {
    const { s, lines } = await devRateOpen(8);
    const T = new Date(dayStart(ago(3)) + HOUR);
    await at(T, ratingReminders);
    expect(await lines()).toBe(1);
    await db.accountEvent.create({ data: { userId: s.dev.user.id, kind: "suspended", side: "developer", createdAt: new Date(T.getTime() + HOUR) } });
    await db.accountEvent.create({ data: { userId: s.dev.user.id, kind: "reinstated", side: "developer", createdAt: new Date(T.getTime() + 3 * HOUR) } });
    await at(new Date(T.getTime() + 4 * HOUR), sweep);
    await at(new Date(T.getTime() + DAY), sweep);
    await at(new Date(T.getTime() + DAY), ratingReminders);
    await at(new Date(T.getTime() + 2 * DAY), ratingReminders);
    expect(await lines()).toBe(1);
    await at(new Date(T.getTime() + 3 * DAY), ratingReminders);
    expect(await lines()).toBe(2);
  }, 180_000);
});
