import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily, runSweep } from "@/lib/server/holds";
import { ratingReminders } from "@/lib/server/ratings";
import { unpauseTest } from "@/lib/server/restrictions";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { DAY, pay, sentWork } from "./b15";

// The pause-timing cases for the money and Rate lines, each on its own fake clock. Lines go per person per UTC day; the repeats every 3 UTC calendar days and at
// least 12 hours apart, from the daily job only (runDaily; ratingReminders as the daily job's Rate step); a fresh line (a new piece, a lift) from the 5-minute
// sweep too (runSweep; ratingReminders with repeats off). Rules: holds.ts payNowLines / testerChargeLines / moneyLineDue / moneyLiftedAt /
// testerChargeLiftedAt, ratings.ts ratingReminders / liftedAfter, rules.ts repeatDue / utcDayNo.
// Cases already covered elsewhere (charge-fresh-after-lift, paynow-lift-fresh, rate-lift-fresh, pause-one-shift-389) aren't repeated here; these fill the gaps:
//   1. a lift BEFORE that day's daily run, on a day with no line yet (the run that day would have been due): the sweep's fresh line restarts the count;
//   2. a lift AFTER a daily run that skipped the frozen test;
//   3. (Charge / Pay now) a short pause between two daily runs, on a day whose line came from the daily run before it;
//   4. the UTC evening boundary seen from America/Chicago;
//   5. a pause spanning several daily runs: never catch-ups;
//   6. overlapping freezes (the team's pause and the developer's suspension, both orders);
//   7. the tester-side suspension only (the developer's Pay now runs on);
//   8. a pause reaching 7 days (the daily job's closure).

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
const sweep = (now: Date) => runSweep(now);
const rateSweep = (now: Date) => ratingReminders(now, { repeats: false });

// ---------- freezes, as the events and the stored flags record them ----------

async function teamPause(testId: string, start: Date) {
  await db.testEvent.create({ data: { testId, kind: "paused", text: "The team paused this test", createdAt: start } });
  await db.test.update({ where: { id: testId }, data: { adminPausedAt: start } });
}
async function teamLift(testId: string, end: Date) {
  await db.testEvent.create({ data: { testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: end } });
  await db.test.update({ where: { id: testId }, data: { adminPausedAt: null } });
}
async function suspend(userId: string, side: "developer" | "tester", start: Date) {
  await db.accountEvent.create({ data: { userId, kind: "suspended", side, createdAt: start } });
  await db.user.update({ where: { id: userId }, data: side === "developer" ? { devSuspendedAt: start } : { testerSuspendedAt: start } });
}
async function reinstate(userId: string, side: "developer" | "tester", end: Date) {
  await db.accountEvent.create({ data: { userId, kind: "reinstated", side, createdAt: end } });
  await db.user.update({ where: { id: userId }, data: side === "developer" ? { devSuspendedAt: null } : { testerSuspendedAt: null } });
}

// ---------- America/Chicago wall clock ----------

const ZONE = "America/Chicago";
/** Chicago's offset from UTC in hours at that moment (−6 in winter, −5 in summer). */
const chicagoOffset = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "shortOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "") || 0);
/** The moment it is `hours` o'clock in Chicago on the Chicago calendar day numbered `day` (days since Jan 1, 1970, as utcDayNo counts them). */
const chicago = (day: number, hours: number) => new Date(on(day, hours).getTime() - chicagoOffset(on(day, 12)) * H);
const chicagoClock = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(d);

// ---------- the worlds ----------

/**
 * Sent work whose Charge is open (the tester's "Charge or let go", the developer's "Pay now"), the test kept running (Open until far ahead) so no pause closes it
 * and no date is named; both first lines from the sweep at `first` (default 22:00 UTC on day D, the first day after Charge opened).
 */
async function moneyWorld(first?: (D: number) => Date) {
  const w = await sentWork();
  const opens = R.chargeOpensAt(w.sub, { openUntil: null, status: "open" }, await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } }))!;
  const D = R.utcDayNo(opens) + 1;
  await db.test.update({ where: { id: w.testId }, data: { openUntil: on(D + 60, 0) } });
  /** [the tester's Charge or let go lines, the developer's Pay now lines] */
  const count = async () => [
    await db.notification.count({ where: { userId: w.tester.user.id, reminderKey: "chargeday" } }),
    await db.notification.count({ where: { userId: w.dev.user.id, reminderKey: "paynow" } }),
  ];
  const firstAt = first ? first(D) : on(D, 22);
  await at(firstAt, sweep);
  expect(await count()).toEqual([1, 1]);
  return { w, D, count, firstAt };
}

/** The tester's Rate open (her work paid) on a test kept running; her first reminder from the daily job at `first` (default 09:00 UTC 3 calendar days after the prompt). */
async function testerRateWorld(first?: (P0: number) => Date) {
  const w = await sentWork();
  expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
  expect(c.ratePromptedAt).not.toBeNull();
  const P0 = R.utcDayNo(c.ratePromptedAt!);
  await db.test.update({ where: { id: w.testId }, data: { openUntil: on(P0 + 60, 0) } });
  const lines = () => db.notification.count({ where: { userId: w.tester.user.id, reminderKey: `rate:${w.sessionId}` } });
  const firstAt = first ? first(P0) : on(P0 + 3, 9);
  await at(firstAt, ratingReminders);
  expect(await lines()).toBe(1);
  // (Owner, Dec 10 2026) A freeze hides her Rate (and so owes her a fresh line at its lift) only while work she sent waits for review; with everything
  // reviewed her Rate stays open during it. So in these cases she sends another part as the freeze begins (its review date far ahead), reviewed at the lift.
  const waitFrom = (start: Date) => db.submission.create({ data: { contractId: w.sessionId, kind: "recording", agreedCents: 1000, sentAt: start, updatedAt: start, payBy: plus(start, 30 * DAY) } });
  const reviewedAt = (sub: { id: string }, end: Date) => db.review.create({ data: { contractId: w.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), createdAt: end } });
  return { w, P0, lines, firstAt, waitFrom, reviewedAt };
}

/** The developer's Rate, opened `openedDaysAgo` days ago (the tester rated then); their first reminder from the daily job at 09:00 UTC 3 calendar days after it. */
async function devRateWorld(openedDaysAgo: number) {
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const payNow = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await payNow(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 4 })).status).toBe(200);
  await db.rating.updateMany({ where: { contractId: j.sessionId, side: "tester" }, data: { createdAt: ago(openedDaysAgo) } });
  await db.review.updateMany({ where: { contractId: j.sessionId }, data: { createdAt: ago(openedDaysAgo + 1) } });
  await db.notification.updateMany({ where: { userId: s.dev.user.id, reminderKey: `rate-open:${j.sessionId}` }, data: { createdAt: ago(openedDaysAgo) } });
  const lines = () => db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `rate-dev:${j.sessionId}` } });
  const X = R.utcDayNo(ago(openedDaysAgo)) + 3;
  await at(on(X, 9), ratingReminders);
  expect(await lines()).toBe(1);
  return { s, j, X, lines };
}

// ---------- 1. a lift before the daily run, on a day with no line yet ----------

describe("1. a lift BEFORE the daily run on a UTC day with no line yet: one fresh line from the sweep; that day's daily run sends no second; the count restarts", () => {
  it("Charge or let go and Pay now: lifted at 03:00 on the day their 3-day repeat was due: the sweep's line, nothing at 09:00, the next 3 days after", async () => {
    const { w, D, count } = await moneyWorld();
    await teamPause(w.testId, on(D + 1, 1));
    await at(on(D + 1, 9), runDaily);
    await at(on(D + 2, 9), runDaily);
    expect(await count()).toEqual([1, 1]);
    await teamLift(w.testId, on(D + 3, 3)); // day D+3: the 3-day slot from the line on day D, before its daily run
    await at(on(D + 3, 3.05), sweep); // right after the lift: one fresh line each
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 3, 9), runDaily); // that day's daily run (it would have been due without the lift): no second line
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 4, 9), runDaily);
    await at(on(D + 5, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 9), runDaily); // 3 UTC days after the fresh line
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate: lifted at 03:00 on the day her repeat was due: the sweep's line, nothing at 09:00, the next 3 days after", async () => {
    const { w, P0, lines, waitFrom, reviewedAt } = await testerRateWorld();
    await teamPause(w.testId, on(P0 + 4, 1));
    const more = await waitFrom(on(P0 + 4, 1));
    await at(on(P0 + 4, 9), ratingReminders);
    await at(on(P0 + 5, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await teamLift(w.testId, on(P0 + 6, 3));
    await reviewedAt(more, on(P0 + 6, 3));
    await at(on(P0 + 6, 3.05), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(P0 + 6, 9), ratingReminders);
    await at(on(P0 + 7, 9), ratingReminders);
    await at(on(P0 + 8, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(P0 + 9, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);

  it("the developer's Rate: their suspension lifted at 03:00 on the day their repeat was due: the sweep's line, nothing at 09:00, the next 3 days after", async () => {
    const { s, X, lines } = await devRateWorld(13);
    await suspend(s.dev.user.id, "developer", on(X + 1, 1));
    await at(on(X + 1, 9), ratingReminders);
    await at(on(X + 2, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await reinstate(s.dev.user.id, "developer", on(X + 3, 3));
    await at(on(X + 3, 3.05), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(X + 3, 9), ratingReminders);
    await at(on(X + 4, 9), ratingReminders);
    await at(on(X + 5, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(X + 6, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);
});

// ---------- 2. a lift after a daily run that skipped the frozen test ----------

describe("2. a lift AFTER the daily run (the run skipped the frozen test): one fresh line from the sweep after the lift", () => {
  it("Charge or let go and Pay now", async () => {
    const { w, D, count } = await moneyWorld();
    await teamPause(w.testId, on(D + 2, 20));
    await at(on(D + 3, 9), runDaily); // their 3-day slot, but frozen: skipped
    expect(await count()).toEqual([1, 1]);
    await teamLift(w.testId, on(D + 3, 10));
    await at(on(D + 3, 10.08), sweep);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 3, 10.25), sweep); // never twice
    await at(on(D + 4, 9), runDaily);
    await at(on(D + 5, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 9), runDaily);
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate", async () => {
    const { w, P0, lines, waitFrom, reviewedAt } = await testerRateWorld();
    await teamPause(w.testId, on(P0 + 5, 20));
    const more = await waitFrom(on(P0 + 5, 20));
    await at(on(P0 + 6, 9), ratingReminders); // her 3-day slot, but frozen: skipped
    expect(await lines()).toBe(1);
    await teamLift(w.testId, on(P0 + 6, 10));
    await reviewedAt(more, on(P0 + 6, 10));
    await at(on(P0 + 6, 10.08), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(P0 + 6, 10.25), rateSweep);
    await at(on(P0 + 7, 9), ratingReminders);
    await at(on(P0 + 8, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(P0 + 9, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);
});

// ---------- 3. a short pause between two daily runs, on a day whose line came from the run before it ----------

describe("3. a short pause between two daily runs, on a UTC day that already had a line from the run before it: nothing at the lift; the 3-day repeat as usual", () => {
  it("Charge or let go and Pay now (the line from the daily job's 3-day repeat)", async () => {
    const { w, D, count } = await moneyWorld();
    await at(on(D + 3, 9), runDaily); // the 3-day repeat
    expect(await count()).toEqual([2, 2]);
    await teamPause(w.testId, on(D + 3, 12));
    await at(on(D + 3, 13), sweep);
    await teamLift(w.testId, on(D + 3, 15));
    await at(on(D + 3, 15.08), sweep); // the same UTC day as the line: no fresh line
    await at(on(D + 4, 1), sweep); // not deferred to the next day
    await at(on(D + 4, 9), runDaily);
    await at(on(D + 5, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 9), runDaily); // 3 UTC days after the run before the pause
    expect(await count()).toEqual([3, 3]);
  }, 240_000);
});

// ---------- 4. the UTC evening boundary seen from Chicago ----------

describe("4. a line at 7:05 PM Chicago (already the next UTC day), a pause at 9 PM, its lift at 2 PM the next Chicago day (the same UTC day): no fresh line", () => {
  it("Charge or let go and Pay now", async () => {
    // Day C (Chicago): Charge opened before it; the first line at 7:05 PM Chicago that evening, from the sweep.
    let C = 0;
    const { w, count, firstAt } = await moneyWorld((D) => chicago((C = D), 19 + 5 / 60));
    expect(chicagoClock(firstAt)).toBe("7:05 PM");
    expect(R.utcDayNo(firstAt)).toBe(C + 1); // already the next UTC day
    const pauseAt = chicago(C, 21), liftAt = chicago(C + 1, 14);
    expect([chicagoClock(pauseAt), chicagoClock(liftAt)]).toEqual(["9:00 PM", "2:00 PM"]);
    expect(R.utcDayNo(liftAt)).toBe(R.utcDayNo(firstAt)); // the lift falls on the line's UTC day
    await teamPause(w.testId, pauseAt);
    await at(on(C + 1, 9), runDaily); // paused
    await teamLift(w.testId, liftAt);
    await at(plus(liftAt, 5 * MIN), sweep); // no fresh line: that UTC day had its line
    await at(chicago(C + 1, 19 + 10 / 60), sweep); // 7:10 PM Chicago, the next UTC day: not deferred either
    await at(on(C + 2, 9), runDaily);
    await at(on(C + 3, 9), runDaily);
    expect(await count()).toEqual([1, 1]);
    await at(on(C + 4, 9), runDaily); // 3 UTC days after the 7:05 PM line
    expect(await count()).toEqual([2, 2]);
  }, 240_000);

  it("the tester's Rate", async () => {
    let C = 0;
    const { w, lines, firstAt } = await testerRateWorld((P0) => chicago((C = P0 + 2), 19 + 5 / 60));
    expect(chicagoClock(firstAt)).toBe("7:05 PM");
    expect(R.utcDayNo(firstAt)).toBe(C + 1);
    const liftAt = chicago(C + 1, 14);
    expect(R.utcDayNo(liftAt)).toBe(R.utcDayNo(firstAt));
    await teamPause(w.testId, chicago(C, 21));
    await at(on(C + 1, 9), ratingReminders);
    await teamLift(w.testId, liftAt);
    await at(plus(liftAt, 5 * MIN), rateSweep);
    await at(chicago(C + 1, 19 + 10 / 60), rateSweep);
    await at(on(C + 2, 9), ratingReminders);
    await at(on(C + 3, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await at(on(C + 4, 9), ratingReminders);
    expect(await lines()).toBe(2);
  }, 240_000);
});

// ---------- 5. a pause spanning several daily runs ----------

describe("5. a pause spanning several daily runs: each run sends nothing; after the lift exactly one line, never catch-ups", () => {
  it("Charge or let go and Pay now (two 3-day slots missed: still one line)", async () => {
    const { w, D, count } = await moneyWorld();
    await teamPause(w.testId, on(D + 1, 1));
    for (let d = 1; d <= 6; d++) {
      await at(on(d + D, 9), runDaily);
      await at(on(d + D, 15), sweep);
    }
    expect(await count()).toEqual([1, 1]);
    await teamLift(w.testId, on(D + 6, 18));
    await at(on(D + 6, 18.08), sweep);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 18.25), sweep);
    await at(on(D + 7, 9), runDaily);
    await at(on(D + 8, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 9, 9), runDaily);
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate", async () => {
    const { w, P0, lines, waitFrom, reviewedAt } = await testerRateWorld();
    await teamPause(w.testId, on(P0 + 3, 12));
    const more = await waitFrom(on(P0 + 3, 12));
    for (let d = 4; d <= 8; d++) {
      await at(on(P0 + d, 9), ratingReminders);
      await at(on(P0 + d, 15), rateSweep);
    }
    expect(await lines()).toBe(1);
    await teamLift(w.testId, on(P0 + 8, 18));
    await reviewedAt(more, on(P0 + 8, 18));
    await at(on(P0 + 8, 18.08), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(P0 + 8, 18.25), rateSweep);
    await at(on(P0 + 9, 9), ratingReminders);
    await at(on(P0 + 10, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(P0 + 11, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);
});

// ---------- 6. overlapping freezes ----------

// (The dates moving once by the merged stretch, both orders, is tests/pause-one-shift-389.test.ts; here the lines.)
const ORDERS = [
  ["the team's pause, then the developer's suspension; the team lifts first", "team", "suspension"],
  ["the developer's suspension, then the team's pause; the reinstatement first", "suspension", "team"],
] as const;

describe.each(ORDERS)("6. overlapping freezes (%s): the first lift sends nothing while the other holds; one fresh line at the last lift", (_name, first, second) => {
  const freeze = (kind: "team" | "suspension", testId: string, devId: string, t: Date) => (kind === "team" ? teamPause(testId, t) : suspend(devId, "developer", t));
  const lift = (kind: "team" | "suspension", testId: string, devId: string, t: Date) => (kind === "team" ? teamLift(testId, t) : reinstate(devId, "developer", t));

  it("Charge or let go and Pay now", async () => {
    const { w, D, count } = await moneyWorld();
    await freeze(first, w.testId, w.dev.user.id, on(D + 1, 1));
    await freeze(second, w.testId, w.dev.user.id, on(D + 1, 5));
    await at(on(D + 1, 9), runDaily);
    await lift(first, w.testId, w.dev.user.id, on(D + 2, 3));
    await at(on(D + 2, 3.08), sweep); // the other freeze still holds: nothing
    await at(on(D + 2, 9), runDaily);
    expect(await count()).toEqual([1, 1]);
    await lift(second, w.testId, w.dev.user.id, on(D + 3, 2));
    await at(on(D + 3, 2.08), sweep); // the last lift: one fresh line each
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 3, 9), runDaily);
    await at(on(D + 4, 9), runDaily);
    await at(on(D + 5, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 9), runDaily);
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate", async () => {
    const { w, P0, lines, waitFrom, reviewedAt } = await testerRateWorld();
    await freeze(first, w.testId, w.dev.user.id, on(P0 + 4, 1));
    const more = await waitFrom(on(P0 + 4, 1));
    await freeze(second, w.testId, w.dev.user.id, on(P0 + 4, 5));
    await at(on(P0 + 4, 9), ratingReminders);
    await lift(first, w.testId, w.dev.user.id, on(P0 + 5, 3));
    await at(on(P0 + 5, 3.08), rateSweep);
    await at(on(P0 + 6, 9), ratingReminders); // her 3-day slot; the other freeze still holds
    expect(await lines()).toBe(1);
    await lift(second, w.testId, w.dev.user.id, on(P0 + 7, 2));
    await reviewedAt(more, on(P0 + 7, 2));
    await at(on(P0 + 7, 2.08), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(P0 + 7, 9), ratingReminders);
    await at(on(P0 + 8, 9), ratingReminders);
    await at(on(P0 + 9, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(P0 + 10, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);

  it("the developer's Rate", async () => {
    const { s, X, lines } = await devRateWorld(13);
    await freeze(first, s.testId, s.dev.user.id, on(X + 1, 1));
    await freeze(second, s.testId, s.dev.user.id, on(X + 1, 5));
    await at(on(X + 1, 9), ratingReminders);
    await lift(first, s.testId, s.dev.user.id, on(X + 2, 3));
    await at(on(X + 2, 3.08), rateSweep);
    await at(on(X + 2, 9), ratingReminders);
    expect(await lines()).toBe(1);
    await lift(second, s.testId, s.dev.user.id, on(X + 3, 2));
    await at(on(X + 3, 2.08), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(X + 3, 9), ratingReminders);
    await at(on(X + 4, 9), ratingReminders);
    await at(on(X + 5, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(X + 6, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);
});

// ---------- 7. the tester-side suspension only ----------

describe("7. her tester-side suspension only: her lines wait, one fresh line at her reinstatement; the developer's Pay now runs on", () => {
  it("Charge or let go waits and comes back once; Pay now keeps its own 3-day slots and gets no fresh line", async () => {
    const { w, D, count } = await moneyWorld();
    await suspend(w.tester.user.id, "tester", on(D + 1, 1));
    await at(on(D + 1, 5), sweep);
    await at(on(D + 2, 9), runDaily);
    expect(await count()).toEqual([1, 1]);
    await at(on(D + 3, 9), runDaily); // the 3-day slot: Pay now goes out, her Charge waits
    expect(await count()).toEqual([1, 2]);
    await reinstate(w.tester.user.id, "tester", on(D + 3, 12));
    await at(on(D + 3, 12.08), sweep); // her one fresh line; nothing more for the developer
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 3, 12.25), sweep);
    await at(on(D + 4, 9), runDaily);
    await at(on(D + 5, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 6, 9), runDaily); // both 3 UTC days after their last line
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate: waits during her suspension, one fresh line at her reinstatement", async () => {
    const { w, P0, lines } = await testerRateWorld();
    await suspend(w.tester.user.id, "tester", on(P0 + 4, 1));
    await at(on(P0 + 5, 9), ratingReminders);
    await at(on(P0 + 6, 9), ratingReminders); // her 3-day slot: suspended
    expect(await lines()).toBe(1);
    await reinstate(w.tester.user.id, "tester", on(P0 + 6, 12));
    await at(on(P0 + 6, 12.08), rateSweep);
    expect(await lines()).toBe(2);
    await at(on(P0 + 6, 12.25), rateSweep);
    await at(on(P0 + 7, 9), ratingReminders);
    await at(on(P0 + 8, 9), ratingReminders);
    expect(await lines()).toBe(2);
    await at(on(P0 + 9, 9), ratingReminders);
    expect(await lines()).toBe(3);
  }, 240_000);
});

// ---------- 8. a pause reaching 7 days ----------

// What the code does (asserted as is): the 7-day closure stops the test, and a stopped test's team pause no longer freezes its money or her Rate (MONEY_LIVE /
// MONEY_FREE take stopped tests; moneySpans / teamPauseSpans end the pause at the stop). So the CLOSURE ITSELF counts as the lift: one fresh line, naming the
// dates now known from the stop (the Charge / Pay window still runs after a closure). The team can't lift a closed test's pause any more (refused), so no
// later lift ever adds a second line; the repeats go on every 3 days from the fresh one. The money lines run before the closure step in the daily job, so theirs
// comes from the next sweep; her Rate reminder runs after it, so hers comes from the closing run itself.
describe("8. the team's pause reaching 7 days: the daily job closes the test; the closure counts as the lift (one fresh line), no lift after it", () => {
  it("Charge or let go and Pay now: nothing while paused; the closing run sends none; the sweep after it one line each (naming the close date); the team's lift is refused", async () => {
    const { w, D, count } = await moneyWorld();
    await teamPause(w.testId, on(D + 1, 1)); // closes 7 days later: D+8 01:00
    for (let d = 1; d <= 7; d++) await at(on(D + d, 9), runDaily);
    expect(await count()).toEqual([1, 1]);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).status).toBe("open");
    await at(on(D + 8, 9), runDaily); // the closure (its money lines ran before it, still frozen)
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    expect(t.status).toBe("stopped");
    expect(t.pauseClosedAt).toEqual(on(D + 8, 9));
    expect(t.adminPausedAt).not.toBeNull(); // kept on purpose; no longer in force
    expect(await count()).toEqual([1, 1]);
    await at(on(D + 8, 9.08), sweep); // the closure counts as the lift: one fresh line each
    expect(await count()).toEqual([2, 2]);
    const texts = async (userId: string, key: string) => (await db.notification.findMany({ where: { userId, reminderKey: key }, orderBy: { createdAt: "asc" }, select: { text: true } })).map((x) => x.text);
    expect((await texts(w.tester.user.id, "chargeday"))[1]).toContain(", by "); // the date known from the stop
    expect((await texts(w.dev.user.id, "paynow"))[1]).toContain("(until ");
    await expect(unpauseTest(w.testId)).rejects.toThrow(/already closed/); // no lift after the closure
    await at(on(D + 8, 12), sweep);
    await at(on(D + 9, 9), runDaily);
    await at(on(D + 10, 9), runDaily);
    expect(await count()).toEqual([2, 2]);
    await at(on(D + 11, 9), runDaily); // 3 UTC days after the fresh line
    expect(await count()).toEqual([3, 3]);
  }, 240_000);

  it("the tester's Rate: nothing while paused; the closing run itself sends her one fresh line; no second from the sweep; then every 3 days", async () => {
    const { w, P0, lines, waitFrom, reviewedAt } = await testerRateWorld();
    await teamPause(w.testId, on(P0 + 3, 12)); // closes 7 days later: P0+10 12:00
    const more = await waitFrom(on(P0 + 3, 12));
    for (let d = 4; d <= 10; d++) await at(on(P0 + d, 9), runDaily);
    expect(await lines()).toBe(1);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).status).toBe("open");
    await reviewedAt(more, on(P0 + 11, 9)); // (Dec 10 2026) reviewed as the closure lifts the pause (dated then: nothing can be reviewed while frozen)
    await at(on(P0 + 11, 9), runDaily); // the closure, then the Rate step: her fresh line
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).status).toBe("stopped");
    expect(await lines()).toBe(2);
    expect((await db.notification.findFirstOrThrow({ where: { userId: w.tester.user.id, reminderKey: `rate:${w.sessionId}` }, orderBy: { createdAt: "desc" } })).text).toContain("rating closes on");
    await at(on(P0 + 11, 9.08), sweep);
    await at(on(P0 + 12, 9), runDaily);
    await at(on(P0 + 13, 9), runDaily);
    expect(await lines()).toBe(2);
    await at(on(P0 + 14, 9), runDaily);
    expect(await lines()).toBe(3);
  }, 240_000);
});
