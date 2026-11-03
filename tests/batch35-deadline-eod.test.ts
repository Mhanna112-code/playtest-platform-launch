import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { shiftAfterPause } from "@/lib/server/holds";
import { recordOutage } from "@/lib/server/outages";
import { rejoinDue } from "@/lib/server/tests";
import { rejoinAskLine } from "@/lib/server/joining";
import { workEndOf } from "@/lib/server/workWindow";
import { beforeEndLine, repeatChoices } from "@/lib/callWindow";
import { countLabel } from "@/components/RequestRows";
import { fmtDateTimeIn } from "@/lib/format";
import { act, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §154) A tester's deadline is the end of a day (11:59 PM in the developer's zone, where dueFromJoin counts it). Whenever it moves later (a
// pause lifted, an approved outage, a rejoin, Edit moving Open until later) it lands on the END of the day it moves to: rounded up, never down. The call window's end
// (workDeadlineOf) then reads 11:59 PM too.

const HOUR = 3_600_000, DAY = 24 * HOUR, MIN = 60_000;
const P = 7 * HOUR + 23 * MIN; // the owner's pause: 7 h 23 min
const CHI = "America/Chicago";
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const eod = (n: number, tz: string | null = CHI) => R.endOfDayIn(plus(R.dayIn(new Date(), tz), n), tz);

/** A test whose developer counts in `tz`, with one tester whose deadline is the end of the day `days` from today there. */
async function testWithTester(tz: string | null = CHI, days = 3) {
  const s = await setup({ timeZone: tz ?? undefined });
  await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: tz ?? "" } });
  const j = await joined(s.testId);
  await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: eod(days, tz) } });
  return { ...s, ...j };
}
const dueOf = async (id: string) => (await db.contract.findUniqueOrThrow({ where: { id } })).dueAt;

describe("§154 the rounding (rules)", () => {
  it("a 7 h 23 min shift turns an 11:59 PM deadline into 11:59 PM the next day, not 7:22 AM", () => {
    const due = R.endOfDayIn("2026-11-05", CHI);
    const moved = R.movedDue(due, P, CHI);
    expect(fmtDateTimeIn(new Date(due.getTime() + P), CHI)).toBe("Fri, Nov 6, 7:22 AM"); // what it used to be
    expect(moved.getTime()).toBe(R.endOfDayIn("2026-11-06", CHI).getTime());
    expect(fmtDateTimeIn(moved, CHI)).toBe("Fri, Nov 6, 11:59 PM");
  });

  it("never rounds down; a moment already at a day's end stays; whole days stay at 11:59 PM (also across the clock change)", () => {
    const end = R.endOfDayIn("2026-11-10", CHI);
    expect(R.dayEndAtOrAfter(end, CHI).getTime()).toBe(end.getTime());
    expect(R.movedDue(end, 2 * DAY, CHI).getTime()).toBe(R.endOfDayIn("2026-11-12", CHI).getTime());
    // One second past a day's end: the next day's end (later, never back).
    expect(R.dayEndAtOrAfter(new Date(end.getTime() + 1000), CHI).getTime()).toBe(R.endOfDayIn("2026-11-11", CHI).getTime());
    // Across the US clock change (Nov 1, 2026): 2 days of milliseconds from Oct 30 11:59 PM CDT read 10:59 PM CST; rounded up to 11:59 PM that day.
    const oct30 = R.endOfDayIn("2026-10-30", CHI);
    expect(fmtDateTimeIn(new Date(oct30.getTime() + 2 * DAY), CHI)).toBe("Sun, Nov 1, 10:59 PM");
    expect(fmtDateTimeIn(R.movedDue(oct30, 2 * DAY, CHI), CHI)).toBe("Sun, Nov 1, 11:59 PM");
    // Edit's whole days count calendar days in the zone.
    expect(fmtDateTimeIn(R.dueAfterDays(oct30, 2, CHI), CHI)).toBe("Sun, Nov 1, 11:59 PM");
    expect(fmtDateTimeIn(R.dueAfterDays(new Date(oct30.getTime() - 5 * HOUR), 6, CHI), CHI)).toBe("Thu, Nov 5, 11:59 PM");
  });

  it("a far time zone rounds in the developer's own zone (where the deadline was counted)", () => {
    const due = R.endOfDayIn("2026-11-05", "Asia/Tokyo"); // Nov 5, 11:59 PM in Tokyo = Nov 5, 8:59 AM in Chicago
    const moved = R.movedDue(due, P, "Asia/Tokyo");
    expect(fmtDateTimeIn(moved, "Asia/Tokyo")).toBe("Fri, Nov 6, 11:59 PM");
    expect(moved.getTime()).toBe(R.endOfDayIn("2026-11-06", "Asia/Tokyo").getTime());
    // Rounded in Chicago instead, the same moment would land elsewhere: the zone matters.
    expect(R.movedDue(due, P, CHI).getTime()).not.toBe(moved.getTime());
  });

  it("rejoin: the time left, rounded up to that day's end; a deadline that had passed stays passed", () => {
    const now = new Date("2026-11-03T15:10:00Z");
    const left = 5 * DAY + 3 * HOUR;
    const due = rejoinDue(new Date(Date.parse("2026-11-01T00:00:00Z") + left), new Date("2026-11-01T00:00:00Z"), now, CHI);
    expect(due.getTime()).toBe(R.endOfDayIn("2026-11-08", CHI).getTime());
    expect(due.getTime()).toBeGreaterThanOrEqual(now.getTime() + left);
    const passed = rejoinDue(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-01T02:00:00Z"), now, CHI);
    expect(passed.getTime()).toBe(now.getTime() - 2 * HOUR);
    // The developer's preview of a rejoin names the same end of day.
    const line = rejoinAskLine("Marc", { subj: "he", poss: "his" }, { endedAt: new Date(Date.now() - DAY), dueAt: new Date(Date.now() - DAY + left) }, CHI);
    const back = R.movedDue(new Date(), left, CHI);
    expect(fmtDateTimeIn(back, CHI)).toMatch(/, 11:59 PM$/);
    expect(line).toContain(`(deadline ${fmtDateTimeIn(back, "UTC")}).`); // (the page renders it in the reader's zone; here, with none, UTC)
  });
});

describe("§154 every move of a deadline lands on 11:59 PM", () => {
  it("a pause lift of 7 h 23 min: 11:59 PM the next day, read on both sides and in the call window's end and its refusal line", async () => {
    const s = await testWithTester();
    // Open until earlier than the deadline, so the deadline is the end of the work.
    const ou = eod(1);
    await db.test.update({ where: { id: s.testId }, data: { openUntil: ou } });
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    const now = Date.now();
    await db.$transaction((tx) => shiftAfterPause(tx, t, new Date(now - P), new Date(now)));
    const due = await dueOf(s.sessionId);
    expect(due.getTime()).toBe(eod(4).getTime());
    expect(fmtDateTimeIn(due, CHI)).toMatch(/, 11:59 PM$/);
    // Open until keeps the Nov 2 rule: the nearest day's end (7 h 23 min past 11:59 PM is nearer that one).
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).openUntil!.getTime()).toBe(ou.getTime());
    // The call window ends there, and a later time is refused naming 11:59 PM.
    const end = (await workEndOf(db, s.testId))!;
    expect(end.getTime()).toBe(due.getTime());
    const r = await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, minutes: "30", contractIds: [s.sessionId], rows: [{ startsAt: new Date(end.getTime() + HOUR).toISOString(), repeat: "once", count: 1 }] });
    expect(r.body.error).toMatchObject({ code: "bad_time", message: beforeEndLine(fmtDateTimeIn(end, CHI)) });
    expect(r.body.error.message).toMatch(/^Pick a time before \w{3}, \w{3} \d+, 11:59 PM \(when testers' work on this test ends\)\.$/);
    const tr = await sact(s.sessionId, "request-time", s.tester.cookie, { seenAt: seen(), confirmed: true, minutes: "30", rows: [{ startsAt: new Date(end.getTime() + HOUR).toISOString(), repeat: "once", count: 1 }] });
    expect(tr.body.error.message).toBe(beforeEndLine(fmtDateTimeIn(end, "UTC")));
  });

  it("the repeat-count choices follow the end-of-day end", () => {
    const end = R.endOfDayIn("2026-11-06", CHI);
    const first = new Date("2026-11-04T21:00:00Z"); // Nov 4, 3:00 PM Chicago: daily calls on Nov 4, 5 and 6 fit before Nov 6, 11:59 PM
    expect(repeatChoices(first, "daily", end).counts).toEqual([2, 3]);
    expect(repeatChoices(first, "daily", new Date(R.endOfDayIn("2026-11-05", CHI).getTime() + P)).counts).toEqual([2]); // the old odd end (Nov 6, 7:22 AM)
    expect(countLabel(3, { when: "2026-11-04T15:00", repeat: "daily", count: "3" })).toBe("3 days (to Nov 6)");
  });

  it("a pause of exactly 2 days leaves an 11:59 PM deadline at 11:59 PM, 2 days later", async () => {
    const s = await testWithTester(CHI, 5);
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    const now = Date.now();
    await db.$transaction((tx) => shiftAfterPause(tx, t, new Date(now - 2 * DAY), new Date(now)));
    expect((await dueOf(s.sessionId)).getTime()).toBe(eod(7).getTime());
  });

  it("an outage of 7 h 23 min: the same (and Open until stays the end of a day)", async () => {
    const s = await testWithTester();
    const end = new Date(), start = new Date(end.getTime() - P);
    await recordOutage(start, end);
    expect((await dueOf(s.sessionId)).getTime()).toBe(eod(4).getTime());
    const ou = (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).openUntil!;
    expect(ou.getTime()).toBe(R.endOfDayIn(R.dayIn(ou, CHI), CHI).getTime());
  });

  it("a far time zone: the pause rounds to 11:59 PM in the developer's zone", async () => {
    const s = await testWithTester("Asia/Tokyo");
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    const now = Date.now();
    await db.$transaction((tx) => shiftAfterPause(tx, t, new Date(now - P), new Date(now)));
    const due = await dueOf(s.sessionId);
    expect(due.getTime()).toBe(eod(4, "Asia/Tokyo").getTime());
    expect(fmtDateTimeIn(due, "Asia/Tokyo")).toMatch(/, 11:59 PM$/);
  });

  it("a rejoin: the time left, landing on 11:59 PM", async () => {
    const s = await testWithTester(CHI, 5);
    // Left 2 h 37 min into the day's work: 5 days and some hours left.
    const leftAt = new Date(Date.now() - 2 * HOUR);
    expect((await sact(s.sessionId, "leave", s.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.contract.update({ where: { id: s.sessionId }, data: { endedAt: leftAt } });
    const left = (await dueOf(s.sessionId)).getTime() - leftAt.getTime();
    const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    expect((await act(s.testId, "rejoin-ask", s.tester.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
    const ask = await db.application.findFirstOrThrow({ where: { testId: s.testId, testerId: s.tester.user.id, kind: "rejoin" } });
    const accepted = await act(s.testId, "application", s.dev.cookie, { applicationId: ask.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const due = await dueOf(s.sessionId);
    expect(fmtDateTimeIn(due, CHI)).toMatch(/, 11:59 PM$/);
    expect(due.getTime()).toBeGreaterThanOrEqual(Date.now() - 5000 + left);
    expect(due.getTime()).toBe(R.dayEndAtOrAfter(new Date(due.getTime() - 1000), CHI).getTime());
  });

  it("Edit moving Open until 2 days later: an 11:59 PM deadline moves 2 days, still 11:59 PM; an odd older one lands on 11:59 PM", async () => {
    const s = await setup({ timeZone: CHI, openUntil: plus(R.dayIn(new Date(), CHI), 6) });
    await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: CHI } });
    const a = await joined(s.testId);
    const b = await joined(s.testId, "Ben Ito", "he");
    await db.contract.update({ where: { id: a.sessionId }, data: { dueAt: eod(5) } });
    await db.contract.update({ where: { id: b.sessionId }, data: { dueAt: new Date(eod(3).getTime() + P) } }); // left odd by an older pause
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    const r = await act(s.testId, "edit", s.dev.cookie, { version: t.version, fields: { openUntil: plus(R.dayIn(t.openUntil!, CHI), 2) }, seenAt: seen(), confirmed: true, timeZone: CHI });
    expect(r.status).toBe(200);
    expect((await dueOf(a.sessionId)).getTime()).toBe(eod(7).getTime());
    expect((await dueOf(b.sessionId)).getTime()).toBe(eod(6).getTime());
  });
});
