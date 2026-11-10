import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { awayAction, confirmFinish, confirmStart } from "@/lib/server/confirm";
import { confirmAllPress, confirmAllState } from "@/lib/server/confirmAll";
import { autoChargeCalls, startHold } from "@/lib/server/holds";
import { pauseTest } from "@/lib/server/restrictions";
import { makeUser } from "./helpers";
import { bookCall, joined, seen, settle, setup } from "./fixtures";
import { DAY, pay, payMore } from "./b15";

// (Owner, Nov 9, §368) "Any pause or stop treated the same for developer and tester": on a test the team paused, and for a suspended developer, Pay, Pay more,
// Confirm with your bank, Confirm all and a call's Pay go through and charge at once (as the tester's Charge always did), and a listed call's automatic charge is
// made then too. Under a payment or chargeback hold nothing changes: they wait for Pay what you owe.

const PAID = ["charged", "not_set_up"];

/** A test with Ana's written answers sent (unpaid), her recording paid $5 (Pay more open), a call that took place (unpaid), and two charges made while the developer
 *  was away that their bank wants confirmed. */
async function world() {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId, "Ana Silva");
  const written = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", agreedCents: 1000, answers: ["a"] } });
  const recording = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000 } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: recording.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), actualMinutes: 30, payBy: new Date(Date.now() + 5 * DAY) } });
  const away = [];
  for (let i = 0; i < 2; i++) {
    const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: `away-${i}`, agreedCents: 1000 } });
    await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "charged by the tester" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "pending" } });
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: `pi_${randomUUID()}`, clientSecret: "test_only" });
    away.push(p.id);
  }
  return { ...s, ...j, written, recording, call, away };
}
type W = Awaited<ReturnType<typeof world>>;

async function teamPause(w: W) {
  const a = await makeUser();
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  await pauseTest(a.user.id, w.testId, "Checking it");
}
const suspend = (w: W) => db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: new Date() } });

const piecePayments = (where: { submissionId?: string; callId?: string }, kind?: string) => db.payment.findMany({ where: { ...where, ...(kind ? { kind } : {}) } });

describe.each([["team pause", teamPause], ["developer suspension", suspend]] as const)("§368 %s: every payment press charges at once, exactly once", (_name, restrict) => {
  it("Pay, Pay more, a call's Pay, Confirm with your bank and Confirm all", async () => {
    const w = await world();
    await restrict(w);
    await settle(); // the pages below load after the pause (a pause since the page loaded stops a press once: stop-once-matrix)

    // Pay: once (the same press again is never a second charge; a new press is refused as paid).
    const key = randomUUID();
    const p1 = await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000, payKey: key });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000, payKey: key })).status).toBe(200);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("You already paid $10.00 for Ana Silva's written answers.");
    const wp = await piecePayments({ submissionId: w.written.id });
    expect(wp).toHaveLength(1);
    expect(PAID).toContain(wp[0].status);

    // Pay more: once.
    const mk = randomUUID();
    const m1 = await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.recording.id, amount: "2.00", tickedCents: 200, payKey: mk });
    expect(m1.status, JSON.stringify(m1.body)).toBe(200);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.recording.id, amount: "2.00", tickedCents: 200, payKey: mk })).status).toBe(200);
    const extras = await piecePayments({ submissionId: w.recording.id }, "extra");
    expect(extras).toHaveLength(1);
    expect(PAID).toContain(extras[0].status);

    // A call's Pay: once.
    const c1 = await pay(w.dev.cookie, { kind: "call", id: w.call.id, amount: "15.00", tickedCents: 1500 });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const cp = await piecePayments({ callId: w.call.id });
    expect(cp).toHaveLength(1);
    expect(PAID).toContain(cp[0].status);

    // Confirm with your bank on the first charge made while away: charged once.
    await confirmStart(w.dev.user, w.away[0], { seenAt: seen() });
    await confirmFinish(w.dev.user, w.away[0], { simulate: "succeeded" });
    expect(PAID).toContain((await db.payment.findUniqueOrThrow({ where: { id: w.away[0] } })).status);

    // Confirm all on what's left: one payment for it, once.
    const state = await confirmAllState(w.dev.user.id);
    expect(state.ids).toEqual([w.away[1]]);
    await confirmAllPress(w.dev.user, { seenAt: seen(), seenIds: state.ids, seenTotalCents: state.totalCents });
    expect(PAID).toContain((await db.payment.findUniqueOrThrow({ where: { id: w.away[1] } })).status);
    expect((await confirmAllState(w.dev.user.id)).ids).toEqual([]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, kind: "owed", note: "press:all" } })).toBeLessThanOrEqual(1);
    expect(await db.payment.count({ where: { id: { in: w.away } } })).toBe(2);
  });

  it("a listed call's automatic charge is made at once", async () => {
    const w = await world();
    await db.call.update({ where: { id: w.call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), payBy: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: w.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    await restrict(w);
    await autoChargeCalls(new Date());
    await autoChargeCalls(new Date()); // never twice
    const cp = await piecePayments({ callId: w.call.id });
    expect(cp).toHaveLength(1);
    expect(PAID).toContain(cp[0].status);
  });
});

describe("§368 a payment or chargeback hold: nothing changes", () => {
  it("Pay, Pay more and a call's Pay are refused and nothing is charged; the automatic call charge waits", async () => {
    const w = await world();
    await startHold(w.dev.user.id, "unpaid");
    await settle();
    const before = await db.payment.count({ where: { developerId: w.dev.user.id } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Your tests are paused, so your Pay didn't go through.");
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.recording.id, amount: "2.00", tickedCents: 200 })).body.error.message).toBe("Your tests are paused, so your Pay more didn't go through.");
    expect((await pay(w.dev.cookie, { kind: "call", id: w.call.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Your tests are paused, so your Pay didn't go through.");
    expect(await db.payment.count({ where: { developerId: w.dev.user.id } })).toBe(before);
    expect(await db.review.count({ where: { submissionId: w.written.id } })).toBe(0);
    await db.call.update({ where: { id: w.call.id }, data: { payBy: new Date(Date.now() - 60_000) } });
    await autoChargeCalls(new Date());
    expect((await db.payment.findFirstOrThrow({ where: { callId: w.call.id } })).status).toBe("deferred");
  });

  it("a suspension with a hold too keeps its own line", async () => {
    const w = await world();
    await startHold(w.dev.user.id, "unpaid");
    await suspend(w);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Your account is suspended, so your Pay didn't go through.");
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.recording.id, amount: "2.00", tickedCents: 200 })).body.error.message).toBe("Your account is suspended, so your Pay more didn't go through.");
    expect(await db.review.count({ where: { submissionId: w.written.id } })).toBe(0);
  });
});
