import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import * as M from "@/lib/callMeasure";
import { finishMeasuring, heartbeat, sweepNobodyJoined } from "@/lib/server/calls";
import { joinCall } from "@/lib/server/blocks";
import { runDaily } from "@/lib/server/holds";
import { callsLeftCents } from "@/lib/server/callMoney";
import { rateBlocker } from "@/lib/server/ratings";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";
import { POST as testsPOST } from "@/app/api/tests/route";
import { DAY, pay, payMore, withCard } from "./b15";

// Batch 15 sections 15, 30, 31, 34 and 40: the app measures each call; the developer can only lower it; one $1,000 ceiling for a tester's calls; no Reject.
const MIN = 60_000;
const at = (base: Date, min: number) => new Date(base.getTime() + min * MIN);
const span = (base: Date, from: number, to: number) => ({ startAt: at(base, from), endAt: at(base, to) });

describe("measuring (pure)", () => {
  const s = new Date("2026-11-05T14:00:00Z");
  it("the minutes both were there at once; gaps under 5 minutes count as present; capped at 150% of the booked length", () => {
    // Developer 0–30, tester 5–40: 25 minutes together.
    expect(M.measureOverlap([span(s, 0, 30)], [span(s, 5, 40)], 30)).toMatchObject({ minutes: 25, from: at(s, 5), to: at(s, 30) });
    // A 3-minute drop (a reload) is still present; a 6-minute one isn't.
    expect(M.measureOverlap([span(s, 0, 10), span(s, 13, 30)], [span(s, 0, 30)], 30).minutes).toBe(30);
    expect(M.measureOverlap([span(s, 0, 10), span(s, 16, 30)], [span(s, 0, 30)], 30).minutes).toBe(24);
    // 150%: a 30-minute call that ran 60 minutes counts 45.
    expect(M.measureOverlap([span(s, 0, 60)], [span(s, 0, 60)], 30).minutes).toBe(45);
    // No overlap at all.
    expect(M.measureOverlap([span(s, 0, 10)], [span(s, 20, 30)], 30)).toMatchObject({ minutes: 0, ms: 0, from: null });
  });
  it("final when both have left (5 minutes since each one's last heartbeat), or 30 minutes after the latest allowed end", () => {
    const dev = [span(s, 0, 30)], tes = [span(s, 0, 31)];
    expect(M.measureIsFinal({ startsAt: s, minutes: 30 }, dev, tes, at(s, 34))).toBe(false);
    expect(M.measureIsFinal({ startsAt: s, minutes: 30 }, dev, tes, at(s, 36))).toBe(true);
    // Only one ever came: final only at the deadline (start + 45 + 30).
    expect(M.measureIsFinal({ startsAt: s, minutes: 30 }, dev, [], at(s, 74))).toBe(false);
    expect(M.measureIsFinal({ startsAt: s, minutes: 30 }, dev, [], at(s, 75))).toBe(true);
  });
  it("the length line, and the rate and amount filling each other", () => {
    const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    expect(M.callLengthLine({ actualMinutes: null, measuredMinutes: 29, measuredAt: s, measuredFrom: new Date("2026-11-05T14:21:00Z"), measuredTo: new Date("2026-11-05T14:50:00Z") }, fmt)).toBe("Length: 29 min (both in the call 2:21–2:50 PM)");
    expect(M.callLengthLine({ actualMinutes: null, measuredMinutes: null, measuredAt: null, measuredFrom: null, measuredTo: null }, fmt)).toBe("Call in progress / measuring");
    expect(M.callLengthLine({ actualMinutes: 20, measuredMinutes: 29, measuredAt: s, measuredFrom: new Date("2026-11-05T14:21:00Z"), measuredTo: new Date("2026-11-05T14:50:00Z") }, fmt)).toBe("Length: 20 min (lowered from 29 min; both in the call 2:21–2:50 PM)");
    expect(M.amountFromRate(3000, 29)).toBe(1450);
    expect(M.rateFromAmount(1450, 29)).toBe(3000);
    expect(M.rateFromAmount(1000, 29)).toBe(2069); // $20.69/h, to the cent
  });
});

/** A booked 30-minute call that took place: both had the call page open for `minutes` together, then left. */
async function tookPlace(callId: string, minutes: number) {
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { contract: { include: { test: true } } } });
  const start = new Date(Date.now() - 3 * 3_600_000);
  await db.call.update({ where: { id: callId }, data: { startsAt: start } });
  await db.callPresence.createMany({ data: [
    { callId, userId: call.contract.test.developerId, side: "developer", startAt: start, endAt: at(start, minutes) },
    { callId, userId: call.contract.testerId, side: "tester", startAt: start, endAt: at(start, minutes) },
  ] });
  await finishMeasuring(new Date());
  return db.call.findUniqueOrThrow({ where: { id: callId } });
}

describe("heartbeats and the final length (section 40)", () => {
  it("each heartbeat extends the stretch; a gap of 5 minutes starts a new one; the length is final once both left; no overlap cancels as nobody joined", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    const start = new Date(Date.now() - 60 * MIN);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start } });
    for (const m of [0, 1, 2, 10, 11]) await heartbeat(dev.user, call.id, at(start, m));
    for (const m of [1, 2, 3]) await heartbeat(tester.user, call.id, at(start, m));
    const p = await db.callPresence.findMany({ where: { callId: call.id }, orderBy: [{ side: "asc" }, { startAt: "asc" }] });
    expect(p.map((x) => `${x.side} ${(x.startAt.getTime() - start.getTime()) / MIN}-${(x.endAt.getTime() - start.getTime()) / MIN}`)).toEqual(["developer 0-2", "developer 10-11", "tester 1-3"]);
    await finishMeasuring(new Date());
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(c.measuredMinutes).toBe(1); // together 1–2
    expect(c.measuredAt).not.toBeNull();
    expect(c.payBy!.getTime()).toBe(at(start, 2).getTime() + 7 * DAY);
    // A second call nobody shared: cancelled as "nobody joined" once final.
    const call2 = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    await db.call.update({ where: { id: call2.id }, data: { startsAt: new Date(Date.now() - 120 * MIN) } });
    await heartbeat(dev.user, call2.id, new Date(Date.now() - 119 * MIN));
    await sweepNobodyJoined(new Date());
    expect((await db.call.findUniqueOrThrow({ where: { id: call2.id } })).cancelNote).toBe(R.NOBODY_JOINED);
  });
});

describe("paying a measured call (sections 30, 31, 40)", () => {
  it("can't be paid while measuring; pays measured × rate; lowering needs a reason and can't raise; the rate typed last wins", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await withCard(dev.user.id);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 10 * MIN) } });
    const early = await pay(dev.cookie, { kind: "call", id: call.id, amount: "5.00", tickedCents: 500 });
    expect(early.body.error.message).toMatch(/still being measured/);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + DAY) } });
    const done = await tookPlace(call.id, 29);
    expect(done.measuredMinutes).toBe(29);
    // (Batch 16 section 26) No Lower the length: the call is paid for its measured length.
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 20, reason: "We stopped early to fix the build.", seenAt: seen(), confirmed: true })).status).toBe(404);
    // The rate typed last wins: $30/h × 29 min = $14.50, whatever the amount box said.
    const r = await pay(dev.cookie, { kind: "call", id: call.id, rate: "30.00", typed: "rate", amount: "99.00", tickedCents: 1450 });
    expect(r.status).toBe(200);
    expect(r.body.amountCents).toBe(1450);
    // The amount typed last: the rate is recomputed from it.
    const rev = await db.review.findFirstOrThrow({ where: { callId: call.id } });
    expect(rev.rateCents).toBe(3000);
  });

  it("no Reject: refused; $0 needs a reason, listed or not; less than the listing needs one too (REASON_WHEN_UNDER_LISTING)", async () => {
    expect(R.REASON_WHEN_UNDER_LISTING).toBe(true);
    expect(R.checkPay(0, null, "", null)).toEqual({ ok: false, message: R.ZERO_PAY_REASON });
    expect(R.checkPay(0, 1000, "", null)).toEqual({ ok: false, message: R.ZERO_PAY_REASON });
    expect(R.checkPay(500, 1000, "", 500).ok).toBe(false);
    expect(R.checkPay(0, null, "Nothing usable came through", null).ok).toBe(true);
    expect(R.payUnderLine("Ana Silva", true)).toBe("Ana Silva can dispute the amount once.");
    expect(R.payUnderLine("Ana Silva", false)).toBe("This part isn't listed: pay any amount, $0 included. Ana Silva can dispute the amount once.");
    expect(R.paidZeroLine("Nothing usable")).toBe("Paid $0: “Nothing usable”");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const rej = await pay(dev.cookie, { action: "reject", kind: "submission", id: sub.id, reason: "Not what we asked" });
    expect(rej.status).toBe(409);
    expect(rej.body.error.code).toBe("no_reject");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0" })).body.error.message).toBe(R.ZERO_PAY_REASON);
    const ok = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Answers were blank" });
    expect(ok.status).toBe(200);
    // A $0 payment can be disputed once.
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    void testId;
  });
});

describe("the $1,000 ceiling for all of a tester's calls (section 34)", () => {
  it("booked calls count at their reference; a request over it is refused with what's left; the warning shows under an hour; pay is capped by it", async () => {
    const { dev, testId } = await setup({ liveRateCents: "150.00" });
    const { tester, sessionId } = await joined(testId);
    await withCard(dev.user.id);
    // Two 180-minute calls at $150/h = $900 booked.
    for (const h of [48, 72]) {
      const startsAt = new Date(Date.now() + h * 3_600_000); startsAt.setSeconds(0, 0);
      expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: startsAt.toISOString(), minutes: 180 })).status).toBe(200);
      const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "pending" }, orderBy: { createdAt: "desc" } });
      expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    }
    expect(await callsLeftCents(sessionId)).toBe(100_000 - 90_000);
    expect(M.callsLeftWarning(10_000, 15_000, "developer", "Ana Silva")).toBe("$100.00 left of the $1,000 for calls with Ana Silva on this test.");
    expect(M.callsLeftWarning(10_000, 15_000, "tester", "Ana Silva")).toBe("$100.00 left of the $1,000 for your calls on this test.");
    expect(M.callsLeftWarning(15_000, 15_000, "developer", "Ana Silva")).toBe("");
    expect(M.callsLeftWarning(19_000, null, "developer", "Ana Silva")).toMatch(/^\$190\.00 left/); // unlisted: under $200
    // A third call (60 min at $150/h = $150) would go over: refused on both sides.
    const startsAt = new Date(Date.now() + 96 * 3_600_000); startsAt.setSeconds(0, 0);
    const r = await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: startsAt.toISOString(), minutes: 60 });
    // (Batch 18 section 6) One call: the Length is at most what's left at the rate ($100 at $150/h is 40 minutes), red at the box.
    expect(r.body.error.message).toBe("At most 40 minutes: the $1,000 for calls with Ana Silva on this test.");
    const t = await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: startsAt.toISOString(), minutes: 60 });
    expect(t.body.error.message).toBe("At most 40 minutes: the $1,000 for calls with Nora Lane on this test.");
    // 40 minutes ($100) still fits.
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: startsAt.toISOString(), minutes: 40 })).status).toBe(200);
    // The first call took place (60 minutes measured at $150/h = $150). Another 180-minute call is booked meanwhile ($450 more reserved): only $100 is left for this one.
    const [first, second] = await db.call.findMany({ where: { contractId: sessionId }, orderBy: { startsAt: "asc" } });
    await tookPlace(first.id, 60);
    await db.call.create({ data: { slotId: second.slotId, contractId: sessionId, startsAt: new Date(Date.now() + 9 * DAY), minutes: 180, rateCents: 15_000 } });
    expect(await callsLeftCents(sessionId, db, first.id)).toBe(10_000);
    const over = await pay(dev.cookie, { kind: "call", id: first.id, amount: "150.00", tickedCents: 15_000 });
    expect(over.body.error.message).toBe(M.overCeilingLine(10_000));
    expect((await pay(dev.cookie, { kind: "call", id: first.id, amount: "100.00", reason: "The $1,000 for calls is nearly used.", tickedCents: 10_000 })).status).toBe(200);
    // Pay more: nothing is left.
    const more = await payMore(testId, dev.cookie, { contractId: sessionId, callId: first.id, amount: "1.00", tickedCents: 100 });
    expect(more.body.error.message).toBe(M.overCeilingLine(0));
  });

  it("a mix: an unlisted call ($200/h) and a listed one share the same $1,000", async () => {
    const { dev, testId } = await setup({ liveRateCents: "100.00" });
    const { tester, sessionId } = await joined(testId);
    const listed = await bookCall(testId, dev.cookie, sessionId, tester.cookie); // 30 min at $100/h = $50
    // A call booked while the contract had no live rate: not listed ($200/h × 30 = $100).
    const unl = await db.call.create({ data: { slotId: listed.slotId, contractId: sessionId, startsAt: new Date(Date.now() + 5 * DAY), minutes: 30, rateCents: null } });
    expect(await callsLeftCents(sessionId)).toBe(100_000 - 5_000 - 10_000);
    await db.call.update({ where: { id: unl.id }, data: { minutes: 180 } }); // $600 reserved
    expect(await callsLeftCents(sessionId)).toBe(100_000 - 5_000 - 60_000);
  });
});

describe("Charge for a listed call, the weekly line for unlisted ones, rating (sections 15, 40)", () => {
  it("a listed call left unpaid 7 days after it is charged automatically at the measured length × rate (batch 28 §21: no Charge)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await withCard(dev.user.id);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await tookPlace(call.id, 20); // $30/h × 20 min = $10
    expect(await rateBlocker(sessionId, "tester")).toMatch(/^Rating opens on /); // (batch 17 section 1)
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() - DAY) } });
    await runDaily(new Date(c.payBy!.getTime() + 60_000));
    const after = await db.call.findUniqueOrThrow({ where: { id: call.id }, include: { review: true } });
    expect(after.choiceOfferedAt).toBeNull();
    expect(after.review).toMatchObject({ amountCents: 1000, auto: true });
    const ch = await sact(sessionId, "choose", tester.cookie, { callId: call.id, choice: "charge", amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(ch.status).toBe(409);
    // Paid by the automatic charge: rating opens.
    expect(await rateBlocker(sessionId, "tester")).toBe("");
  });

  it("unlisted calls: one weekly 'Pay your calls' line stacked across tests, until paid", async () => {
    const a = await setup({ liveRateCents: null });
    const ja = await joined(a.testId);
    const b = { testId: (await json(await testsPOST(req("/api/tests", { cookie: a.dev.cookie, body: listingBody({ liveRateCents: null, title: "Second" }) })))).body.id as string };
    const jb = await joined(b.testId, "Ben Okafor");
    const ca = await bookCall(a.testId, a.dev.cookie, ja.sessionId, ja.tester.cookie);
    const cb = await bookCall(b.testId, a.dev.cookie, jb.sessionId, jb.tester.cookie, 60);
    await tookPlace(ca.id, 30);
    await tookPlace(cb.id, 30);
    const due = new Date(Date.now() + 8 * DAY);
    await runDaily(due);
    const lines = await db.notification.findMany({ where: { userId: a.dev.user.id, reminderKey: `paycalls:${a.dev.user.id}` } });
    expect(lines.map((l) => l.text)).toEqual(["Pay your calls: 2 calls to pay on 2 tests."]);
    await runDaily(new Date(due.getTime() + 2 * DAY)); // not again within the week
    expect(await db.notification.count({ where: { userId: a.dev.user.id, reminderKey: `paycalls:${a.dev.user.id}` } })).toBe(1);
    await runDaily(new Date(due.getTime() + 7 * DAY));
    expect(await db.notification.count({ where: { userId: a.dev.user.id, reminderKey: `paycalls:${a.dev.user.id}` } })).toBe(2);
    expect((await db.call.findUniqueOrThrow({ where: { id: ca.id } })).choiceOfferedAt).toBeNull(); // never Charge
  });
});

describe("Join (section 38)", () => {
  it("a stale Join on a cancelled call names who cancelled it and when", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date("2026-11-05T20:05:00Z") } });
    await db.user.update({ where: { id: tester.user.id }, data: { timeZone: "America/New_York" } });
    await expect(joinCall(tester.user, call.id)).rejects.toMatchObject({ message: expect.stringMatching(/^Your Join call didn't go through: Nora Lane cancelled this call at 3:05 PM/) });
    void randomUUID;
  });
});
