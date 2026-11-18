import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { beforeEndLine } from "@/lib/callWindow";
import { callsUntil } from "@/lib/callRows";
import { dayIn, endOfDayIn } from "@/lib/rules";
import { fmtDateTimeIn } from "@/lib/format";
import { workEndOf } from "@/lib/server/workWindow";
import { topUpForeverSets } from "@/lib/server/requests";
import { CALL_WINDOW_TERMS, TERMS_VERSION, WHAT_CHANGED } from "@/lib/termsOfUse";
import { act, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 9, §361) Calls can be booked up to TEST CLOSE (the later of Open until and the last tester's deadline), not each tester's own deadline: Request a
// time, Accept, call sets (Daily / Weekly / Forever stop at test close), the forms' offered times and every server check; still at least the lead ahead (24 h on
// the live site). A tester still working whose own deadline passed can book until test close. The owner's example: Open until Nov 20, last deadline Nov 25 →
// calls until Nov 25; moving Open until to Nov 23 moves working testers' deadlines +3 days (last → Nov 28) → calls until Nov 28.

const HOUR = 3_600_000, DAY = 24 * HOUR;
const TZ = "UTC";
/** The end of the day `n` days from today (where deadlines and Open until land). */
const eod = (n: number) => endOfDayIn(dayIn(new Date(Date.now() + n * DAY), TZ), TZ);
const dayStr = (n: number) => dayIn(new Date(Date.now() + n * DAY), TZ);
const once = (at: Date) => ({ rows: [{ startsAt: at.toISOString(), repeat: "once", count: 1 }] });
const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: "30", contractIds, ...extra });
const tReq = (sessionId: string, cookie: string, extra: Record<string, unknown>) => sact(sessionId, "request-time", cookie, { minutes: "30", seenAt: seen(), confirmed: true, ...extra });

/** "Nov 20 / Nov 25": Open until in 11 days, Ana's own deadline passed yesterday (still working), Ben's (the last) in 16 days. */
async function world() {
  const s = await setup();
  await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: TZ } });
  const ana = await joined(s.testId, "Ana Silva", "she");
  const ben = await joined(s.testId, "Ben Ward", "he");
  await db.test.update({ where: { id: s.testId }, data: { openUntil: eod(11) } });
  await db.contract.update({ where: { id: ana.sessionId }, data: { dueAt: eod(-1) } });
  await db.contract.update({ where: { id: ben.sessionId }, data: { dueAt: eod(16) } });
  return { ...s, ana, ben };
}

describe("§361 calls are booked up to test close, not each tester's own deadline", () => {
  it("test close is the later of Open until and the last tester's deadline (Nov 25, not Open until's Nov 20)", async () => {
    const w = await world();
    expect((await workEndOf(db, w.testId))!.getTime()).toBe(eod(16).getTime());
  });

  it("a tester whose own deadline passed, still working, can request and be requested until test close, and Accept books it; after test close is refused", async () => {
    const w = await world();
    const close = eod(16);
    // The developer asks Ana (deadline passed) for a time a day before test close: taken.
    const d = await devReq(w.testId, w.dev.cookie, [w.ana.sessionId], once(new Date(close.getTime() - DAY)));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    // Ana asks for one the day after Open until (past her own deadline, before test close): taken, and the developer's Accept books it.
    const at = new Date(eod(12).getTime() - 12 * HOUR);
    const t = await tReq(w.ana.sessionId, w.ana.tester.cookie, once(at));
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: w.ana.sessionId, fromSide: "tester", status: "pending" } });
    const a = await act(w.testId, "answer-request", w.dev.cookie, { contractId: w.ana.sessionId, requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(await db.call.count({ where: { contractId: w.ana.sessionId, status: "booked", startsAt: at } })).toBe(1);
    // After test close: refused on both sides, naming test close.
    const late = new Date(close.getTime() + HOUR);
    expect((await devReq(w.testId, w.dev.cookie, [w.ana.sessionId], once(late))).body.error).toMatchObject({ code: "bad_time", message: beforeEndLine(fmtDateTimeIn(close, TZ)) });
    expect((await tReq(w.ana.sessionId, w.ana.tester.cookie, once(late))).body.error.code).toBe("bad_time");
  });

  it("call sets stop at test close: a Weekly set is cut there, and Forever books nothing after it", async () => {
    const w = await world();
    const close = eod(16);
    // (§387 5) A fixed time of day: 11:00 on day 2 (UTC), so the set's calls (and Ben's an hour later) never cross into the next day whatever the time now
    // (from 23:00 the old "now + 2 days, to the hour" put Ben's third call at 00:00 on day 17, after test close: 2 calls, not 3).
    const start = new Date(eod(2).getTime() - 13 * HOUR + 1000);
    const fit = callsUntil(start, "weekly", close);
    expect(fit).toBe(3); // days 2, 9 and 16 (before the end of day 16); Open until (day 11) would have allowed only 2
    expect(callsUntil(start, "weekly", eod(11))).toBe(2);
    expect((await devReq(w.testId, w.dev.cookie, [w.ana.sessionId], { rows: [{ startsAt: start.toISOString(), repeat: "weekly", count: 8 }] })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: w.ana.sessionId, fromSide: "developer", status: "pending" } });
    const a = await sact(w.ana.sessionId, "answer-request", w.ana.tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body.calls, JSON.stringify(a.body)).toBe(fit);
    // Forever with Ben: the calls before test close, none after it.
    const f = await devReq(w.testId, w.dev.cookie, [w.ben.sessionId], { rows: [{ startsAt: new Date(start.getTime() + HOUR).toISOString(), repeat: "weekly", count: "forever" }] });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    const fq = await db.callRequest.findFirstOrThrow({ where: { contractId: w.ben.sessionId, fromSide: "developer", status: "pending" } });
    expect((await sact(w.ben.sessionId, "answer-request", w.ben.tester.cookie, { requestId: fq.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    await topUpForeverSets();
    const set = await db.callSet.findFirstOrThrow({ where: { contractId: w.ben.sessionId } });
    expect(await db.call.count({ where: { setId: set.id, status: "booked" } })).toBe(3);
    expect(await db.call.count({ where: { setId: set.id, startsAt: { gt: close } } })).toBe(0);
  });

  it("the owner's example: moving Open until from Nov 20 to Nov 23 moves working testers' deadlines +3 days (last → Nov 28): calls until Nov 28", async () => {
    const w = await world();
    const v = (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).version;
    const e = await act(w.testId, "edit", w.dev.cookie, { version: v, fields: { openUntil: dayStr(14) }, seenAt: seen(), confirmed: true });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.ben.sessionId } })).dueAt.getTime()).toBe(eod(19).getTime()); // Nov 25 → Nov 28
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.ana.sessionId } })).dueAt.getTime()).toBe(eod(-1).getTime()); // passed: stays
    const close = (await workEndOf(db, w.testId))!;
    expect(close.getTime()).toBe(eod(19).getTime());
    // Ana (deadline passed) books on "Nov 27", after the old test close and her own deadline.
    const at = new Date(eod(18).getTime() - 12 * HOUR);
    expect((await tReq(w.ana.sessionId, w.ana.tester.cookie, once(at))).status).toBe(200);
    expect((await devReq(w.testId, w.dev.cookie, [w.ben.sessionId], once(new Date(close.getTime() + HOUR)))).body.error.message).toBe(beforeEndLine(fmtDateTimeIn(close, TZ)));
  });

  it("the Terms say it, in place (no version bump)", () => {
    expect(TERMS_VERSION).toBe(2);
    expect(CALL_WINDOW_TERMS).toBe("A call can be booked at least 24 hours ahead, and up to when the test closes: the later of Open until and the last tester's deadline, not each tester's own deadline (a tester still working after their own deadline can book until the test closes). Daily, weekly and ongoing calls stop there.");
    expect(WHAT_CHANGED.find((x) => x.version === 2)!.points).toContain(`${CALL_WINDOW_TERMS.replace(/\.$/, "")} (section 7).`);
  });
});
