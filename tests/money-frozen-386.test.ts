import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { awayAction, confirmStart } from "@/lib/server/confirm";
import { confirmAllPress } from "@/lib/server/confirmAll";
import { autoChargeCalls, liftHoldIfClear, runSweep, startHold } from "@/lib/server/holds";
import { callChargeAt, closeOutOf, pieceCloseOut, testerRatingClosesAt } from "@/lib/server/closeOut";
import { testerRateState } from "@/lib/server/ratings";
import { deleteAccount, pauseTest, reinstateAccount } from "@/lib/server/restrictions";
import { moneyFrozen } from "@/lib/restricted";
import { CHOICE_PAUSED_NOTE, PAUSED_FOR_TESTERS, RATE_TEST_PAUSED } from "@/lib/rules";
import { makeUser } from "./helpers";
import { bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { DAY, pay, payMore } from "./b15";

// (Owner, Nov 11, §386 A; replaces §368, §113 and §358 for the money windows) No money moves while the test or the developer is paused: a team pause of the test,
// the developer's payment or chargeback hold, or their suspension, during the test AND after it closed. Refused: the developer's Pay (a call's too), Pay more,
// Confirm with your bank and Confirm all ("{cause}, so your {button} didn't go through."), the tester's Charge and Let it go (neutral: "This test is paused, so your
// Charge didn't go through."). Each piece's money window moves on by the frozen time (after close too); the test's close-out and disputes don't change.

/** A test with Ana's written answers sent (unpaid), her recording paid $5 (Pay more open), a call that took place (unpaid), a third piece open to her Charge, and two
 *  charges made while the developer was away that their bank wants confirmed. */
async function world() {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId, "Ana Silva");
  const written = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", agreedCents: 1000, answers: ["a"] } });
  const recording = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000 } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: recording.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
  const open = await db.submission.create({ data: { contractId: j.sessionId, kind: "written-2", agreedCents: 1000, answers: ["b"], payBy: new Date(Date.now() - DAY), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY) } });
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
  return { ...s, ...j, written, recording, open, call, away };
}
type W = Awaited<ReturnType<typeof world>>;

async function admin() {
  const a = await makeUser();
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a.user.id;
}
const teamPause = async (w: W) => void (await pauseTest(await admin(), w.testId, "Checking it"));
const suspend = async (w: W) => void (await db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: new Date() } }));
const hold = async (w: W) => void (await startHold(w.dev.user.id, "unpaid"));
/** The test's work ended (closed): its testers' part is over. */
async function close(w: W) {
  await db.test.update({ where: { id: w.testId }, data: { status: "closed", workEndedAt: new Date() } });
  await db.contract.update({ where: { id: w.sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date() } });
}
const CAUSES = [
  ["team pause", teamPause, "The team paused this test"],
  ["developer suspension", suspend, "Your account is suspended"],
  ["payment hold", hold, "Your tests are paused"],
] as const;

const errOf = (r: { body: { error?: { message?: string } } }) => r.body.error?.message;
const thrown = async (f: () => Promise<unknown>) => {
  try {
    await f();
  } catch (e) {
    return (e as Error).message;
  }
  return "went through";
};

describe.each(CAUSES)("§386 A %s: every money press is refused, during the test and after it closed", (_name, freeze, cause) => {
  for (const after of [false, true]) {
    it(after ? "after the test closed" : "during the test", async () => {
      const w = await world();
      // The team can't start a pause on a closed test: one already running when it closed counts. A hold or a suspension can start after.
      if (after && freeze !== teamPause) await close(w);
      await freeze(w);
      if (after && freeze === teamPause) await close(w);
      await settle();
      const moved = () => db.payment.count({ where: { developerId: w.dev.user.id, status: { in: ["charged", "not_set_up", "pending", "deferred"] } } });
      const before = await moved();

      expect(errOf(await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 }))).toBe(`${cause}, so your Pay didn't go through.`);
      expect(errOf(await pay(w.dev.cookie, { kind: "call", id: w.call.id, amount: "10.00", tickedCents: 1000 }))).toBe(`${cause}, so your Pay didn't go through.`);
      expect(errOf(await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.recording.id, amount: "2.00", tickedCents: 200 }))).toBe(`${cause}, so your Pay more didn't go through.`);
      expect(await thrown(() => confirmStart(w.dev.user, w.away[0], { seenAt: seen() }))).toBe(`${cause}, so your Confirm with your bank didn't go through.`);
      expect(await thrown(() => confirmAllPress(w.dev.user, { seenAt: seen(), seenIds: w.away, seenTotalCents: 2000 }))).toBe(`${cause}, so your Confirm all didn't go through.`);
      // The tester never reads why.
      for (const [choice, press] of [["charge", "Charge"], ["letgo", "Let it go"]] as const) {
        const r = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.open.id, choice, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
        expect(errOf(r), JSON.stringify(r.body)).toBe(`This test is paused, so your ${press} didn't go through.`);
      }

      expect(await db.review.count({ where: { submissionId: { in: [w.written.id, w.open.id] } } })).toBe(0);
      expect(await db.review.count({ where: { callId: w.call.id } })).toBe(0);
      expect(await moved()).toBe(before);
    });
  }

  it("the automatic charge of a listed call waits while frozen", async () => {
    const w = await world();
    await db.call.update({ where: { id: w.call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), payBy: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: w.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    await freeze(w);
    await autoChargeCalls(new Date());
    expect(await db.payment.count({ where: { callId: w.call.id } })).toBe(0);
    expect(await db.review.count({ where: { callId: w.call.id } })).toBe(0);
  });

  it("a dispute stays open (the tester's Dispute goes through)", async () => {
    const w = await world();
    await freeze(w);
    await settle();
    const d = await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.recording.id, reason: "I recorded every step of it" });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  });
});

describe("§386 A the freeze lifts", () => {
  it("after a reinstatement every press goes through again", async () => {
    const w = await world();
    await suspend(w);
    expect(errOf(await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 }))).toBe("Your account is suspended, so your Pay didn't go through.");
    await reinstateAccount(w.dev.user.id, "developer");
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const r = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.open.id, choice: "charge", amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("the money reminders wait while frozen (Charge or let go, Pay now), then go out", async () => {
    const w = await world();
    await suspend(w);
    await runSweep(new Date());
    const lines = async () => [await db.notification.count({ where: { userId: w.tester.user.id, reminderKey: "chargeday" } }), await db.notification.count({ where: { userId: w.dev.user.id, reminderKey: "paynow" } })];
    expect(await lines()).toEqual([0, 0]);
    await reinstateAccount(w.dev.user.id, "developer");
    await runSweep(new Date());
    expect(await lines()).toEqual([1, 1]);
  });

  it("a Charge recorded as waiting under §113 is still charged when the hold lifts", async () => {
    const w = await world();
    await startHold(w.dev.user.id, "unpaid");
    // Saved before §386 by a Charge pressed during the hold.
    await db.review.create({ data: { contractId: w.sessionId, submissionId: w.open.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "Charged by the tester after 7 days without a review." } });
    const legacy = await db.payment.create({ data: { kind: "review", submissionId: w.open.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "deferred" } });
    expect(await liftHoldIfClear(w.dev.user.id)).toBe(true);
    expect(["charged", "not_set_up"]).toContain((await db.payment.findUniqueOrThrow({ where: { id: legacy.id } })).status);
  });

  it("waiting charges stay waiting during a suspension (no money moves), and are made at the reinstatement", async () => {
    const w = await world();
    await db.review.create({ data: { contractId: w.sessionId, submissionId: w.open.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "Charged by the tester after 7 days without a review." } });
    const row = await db.payment.create({ data: { kind: "review", submissionId: w.open.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "deferred" } });
    await suspend(w);
    await runSweep(new Date());
    expect((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("deferred");
    await reinstateAccount(w.dev.user.id, "developer");
    expect(["charged", "not_set_up"]).toContain((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).status);
  });
});

describe("§386 A pages: the buttons stay, the banners don't offer paying", () => {
  it("the tester's paused banner and the Charge box's note", () => {
    expect(PAUSED_FOR_TESTERS).not.toContain("charge or let go of work");
    expect(PAUSED_FOR_TESTERS).toContain("Sending work, charging or letting go and requesting calls come back when it resumes.");
    expect(CHOICE_PAUSED_NOTE).not.toMatch(/hold|suspend/i);
  });
  it("moneyFrozen: a closed test's running team pause counts, a stopped test's kept one doesn't; a deleted developer's hold freezes nothing", () => {
    expect(moneyFrozen({}, { adminPausedAt: new Date(), status: "closed" })).toBe("team");
    expect(moneyFrozen({}, { adminPausedAt: new Date(), status: "stopped" })).toBeNull();
    expect(moneyFrozen({ holdStartedAt: new Date(), devSuspendedAt: new Date() }, { adminPausedAt: new Date(), status: "open" })).toBe("suspension");
    expect(moneyFrozen({ holdStartedAt: new Date() }, { status: "stopped" })).toBe("hold");
    expect(moneyFrozen({ holdStartedAt: new Date(), deletedAt: new Date() }, null)).toBeNull();
    expect(moneyFrozen({ devSuspendedAt: new Date(), deletedAt: new Date() }, { adminPausedAt: new Date(), status: "open" })).toBeNull(); // (§386 F)
  });
});

// The owner's worked cases (Nov 11): test close Nov 1, close-out Nov 15.
describe("§386 A windows: a freeze after the test closed moves each piece's own window, not the close-out", () => {
  const at = (d: string) => new Date(`2020-${d}T12:00:00Z`);
  const NOW = at("12-31");
  async function closed() {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: at("10-20"), status: "ended", endKind: "closed", endedAt: at("11-01") } });
    await db.test.update({ where: { id: s.testId }, data: { status: "closed", openUntil: at("10-20"), workEndedAt: at("11-01") } });
    const early = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", agreedCents: 1000, answers: ["a"], payBy: at("10-25") } });
    const late = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000, payBy: at("11-08") } });
    return { ...s, ...j, early, late };
  }
  const suspended = async (devId: string, from: string, to: string) => {
    await db.accountEvent.create({ data: { userId: devId, kind: "suspended", side: "developer", createdAt: at(from) } });
    await db.accountEvent.create({ data: { userId: devId, kind: "reinstated", side: "developer", createdAt: at(to) } });
  };

  it("without a freeze: Nov 15 and Nov 22", async () => {
    const w = await closed();
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
    expect(await pieceCloseOut({ submissionId: w.early.id }, NOW)).toEqual(at("11-15"));
    expect(await pieceCloseOut({ submissionId: w.late.id }, NOW)).toEqual(at("11-22"));
  });

  it("suspended 1 day after the test close: the piece whose Charge opened Oct 25 closes Nov 16; the close-out and its disputes don't move", async () => {
    const w = await closed();
    await suspended(w.dev.user.id, "11-02", "11-03");
    expect(await pieceCloseOut({ submissionId: w.early.id }, NOW)).toEqual(at("11-16"));
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
    expect(await pieceCloseOut({ submissionId: w.early.id }, NOW, { dispute: true })).toEqual(at("11-15"));
  });

  it("a 1-day suspension on Nov 10 moves the piece whose Charge opened Nov 8 to Nov 23", async () => {
    const w = await closed();
    await suspended(w.dev.user.id, "11-10", "11-11");
    expect(await pieceCloseOut({ submissionId: w.late.id }, NOW)).toEqual(at("11-23"));
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
  });

  it("a 1-day suspension on Nov 4 leaves the Nov 8 piece at Nov 22 (before its Charge opened: never counted twice)", async () => {
    const w = await closed();
    await suspended(w.dev.user.id, "11-04", "11-05");
    expect(await pieceCloseOut({ submissionId: w.late.id }, NOW)).toEqual(at("11-22"));
    expect(await pieceCloseOut({ submissionId: w.early.id }, NOW)).toEqual(at("11-16"));
  });

  it("a 3-day hold after close moves the piece's closing by 3 days; a suspension still on moves it day by day", async () => {
    const w = await closed();
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "hold", createdAt: at("11-02") } });
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "hold-lifted", createdAt: at("11-05") } });
    expect(await pieceCloseOut({ submissionId: w.early.id }, NOW)).toEqual(at("11-18"));
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
    const v = await closed();
    await db.user.update({ where: { id: v.dev.user.id }, data: { devSuspendedAt: at("11-10") } });
    expect(await pieceCloseOut({ submissionId: v.early.id }, at("11-20"))).toEqual(at("11-25")); // 5 days were left on Nov 10: counted from "now"
  });
});

// (Owner, Nov 11, §386 E) The tester's Rate is hidden and refused while frozen, like during their own suspension, never saying why; its window moves on by a
// developer-side freeze after the test closed (one clock from the test close); the close-out doesn't move.
describe.each(CAUSES)("§386 E %s: the tester's Rate is hidden and refused, during the test and after it closed", (_name, freeze) => {
  for (const after of [false, true]) {
    it(after ? "after the test closed" : "during the test", async () => {
      const w = await world();
      // Everything she sent settled, so her Rate is open.
      await db.submission.deleteMany({ where: { id: { in: [w.written.id, w.open.id] } } });
      await db.call.update({ where: { id: w.call.id }, data: { status: "cancelled" } });
      if (after && freeze !== teamPause) await close(w);
      expect((await testerRateState(w.sessionId)).kind).toBe("open");
      await freeze(w);
      if (after && freeze === teamPause) await close(w);
      await settle();
      expect(await testerRateState(w.sessionId)).toMatchObject({ kind: "hidden", line: RATE_TEST_PAUSED });
      const r = await sact(w.sessionId, "rate", w.tester.cookie, { stars: 4, seenAt: seen() });
      expect(r.body.error?.message, JSON.stringify(r.body)).toBe("This test is paused, so your Rate didn't go through.");
      expect(await db.rating.count({ where: { contractId: w.sessionId } })).toBe(0);
    });
  }
});

describe("§386 E the tester's Rate window: a developer freeze after the test closed moves it; one before doesn't; the close-out doesn't move", () => {
  const at = (d: string) => new Date(`2020-${d}T12:00:00Z`);
  const NOW = at("12-31");
  async function closed() {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: at("10-20"), status: "ended", endKind: "closed", endedAt: at("11-01") } });
    await db.test.update({ where: { id: s.testId }, data: { status: "closed", openUntil: at("10-20"), workEndedAt: at("11-01") } });
    return { ...s, ...j };
  }
  const suspended = async (devId: string, from: string, to: string) => {
    await db.accountEvent.create({ data: { userId: devId, kind: "suspended", side: "developer", createdAt: at(from) } });
    await db.accountEvent.create({ data: { userId: devId, kind: "reinstated", side: "developer", createdAt: at(to) } });
  };

  it("a 2-day suspension after the test close moves the tester's Rate close by 2 days", async () => {
    const w = await closed();
    expect(await testerRatingClosesAt(w.sessionId, NOW)).toEqual(at("11-15"));
    await suspended(w.dev.user.id, "11-03", "11-05");
    expect(await testerRatingClosesAt(w.sessionId, NOW)).toEqual(at("11-17"));
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
  });

  it("a suspension before the test close doesn't move it", async () => {
    const w = await closed();
    await suspended(w.dev.user.id, "10-25", "10-27");
    expect(await testerRatingClosesAt(w.sessionId, NOW)).toEqual(at("11-15"));
    expect(await closeOutOf(w.testId, NOW)).toEqual(at("11-15"));
  });
});

// (Owner, Nov 11, §386 F) A developer's deletion ends the freeze (a deleted account is never reinstated nor its hold lifted): the batch 12 rule applies again (a piece
// already open to Charge stays open, charged to the saved card), with the frozen time up to the deletion given back to that piece's closing. Rate stays closed.
describe.each([["suspension", "suspended"], ["hold", "hold"]] as const)("§386 F a %s after the test closed, then the developer deleted 3 days later", (_name, kind) => {
  it("the tester's Charge works again; that piece closes 3 days later than without the freeze; Rate stays closed", async () => {
    // Outages recorded by other files' sweeps (a heartbeat gap) would move these dates too: none here (the files run one at a time).
    await db.outage.deleteMany({});
    const T0 = Date.now();
    const w = await world();
    // Closed 5 days ago; the piece's Charge opened 6 days ago (its closing: the test close + 14 days).
    await db.test.update({ where: { id: w.testId }, data: { status: "closed", workEndedAt: new Date(T0 - 5 * DAY) } });
    await db.contract.update({ where: { id: w.sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date(T0 - 5 * DAY), dueAt: new Date(T0 - 7 * DAY) } });
    await db.submission.update({ where: { id: w.open.id }, data: { payBy: new Date(T0 - 6 * DAY) } });
    const before = (await pieceCloseOut({ submissionId: w.open.id }, new Date(T0)))!;
    expect(before).toEqual(new Date(T0 + 9 * DAY));
    // The freeze began 3 days ago (after the close) and is still on the rows when the account is deleted.
    const start = new Date(T0 - 3 * DAY);
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind, side: kind === "suspended" ? "developer" : "", createdAt: start } });
    await db.user.update({ where: { id: w.dev.user.id }, data: kind === "suspended" ? { devSuspendedAt: start } : { holdStartedAt: start, holdReason: "unpaid" } });
    expect(errOf(await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.open.id, choice: "charge", amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true }))).toBe("This test is paused, so your Charge didn't go through.");
    await deleteAccount(w.dev.user.id, "admin", "Closed by the team");
    const gone = (await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } })).deletedAt!;
    const later = new Date(gone.getTime() + 30 * DAY);
    // Exactly the frozen time up to the deletion moves it: 3 days (and never more as time goes on).
    expect((await pieceCloseOut({ submissionId: w.open.id }, later))!.getTime()).toBe(before.getTime() + (gone.getTime() - start.getTime()));
    expect((await pieceCloseOut({ submissionId: w.open.id }, later))!.getTime()).toBe((await pieceCloseOut({ submissionId: w.open.id }, new Date(gone.getTime() + DAY)))!.getTime());
    expect((await testerRateState(w.sessionId)).kind).toBe("hidden"); // a deletion closes ratings
    await settle();
    const r = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.open.id, choice: "charge", amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await db.review.count({ where: { submissionId: w.open.id } })).toBe(1);
  });
});

// (Owner, Nov 11, §386 G) A listed call's automatic-charge date moves on by the frozen time after it started counting, the same one clock as the piece windows:
// a freeze after the test closed that straddles the charge date gives the developer those days back (never the first run after the lift).
describe("§386 G the automatic call charge after a freeze that began after the test closed", () => {
  it("a 2-day suspension straddling the charge date: charged 1 day after the lift (the day that was left), not at once", async () => {
    await db.outage.deleteMany({}); // another file's sweep can record one that moves these real-time dates
    const T0 = Date.now();
    const w = await world();
    await db.user.update({ where: { id: w.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    await db.test.update({ where: { id: w.testId }, data: { status: "closed", workEndedAt: new Date(T0 - 6 * DAY) } });
    await db.contract.update({ where: { id: w.sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date(T0 - 6 * DAY) } });
    await db.call.update({ where: { id: w.call.id }, data: { startsAt: new Date(T0 - 8 * DAY), measuredAt: new Date(T0 - 8 * DAY), payBy: new Date(T0 - DAY) } });
    const lifted = new Date(T0 - 60_000);
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "suspended", side: "developer", createdAt: new Date(T0 - 2 * DAY) } });
    await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "reinstated", side: "developer", createdAt: lifted } });
    expect((await callChargeAt(w.call.id, new Date(T0)))!.getTime()).toBe(lifted.getTime() + DAY);
    await autoChargeCalls(new Date(T0));
    expect(await db.payment.count({ where: { callId: w.call.id } })).toBe(0);
    await autoChargeCalls(new Date(lifted.getTime() + DAY + 60_000));
    expect(await db.payment.count({ where: { callId: w.call.id } })).toBe(1);
  });

  it("a suspension before the countdown started (or none) leaves the date as stored", async () => {
    const w = await world();
    await db.call.update({ where: { id: w.call.id }, data: { payBy: new Date(Date.now() + 5 * DAY) } });
    expect((await callChargeAt(w.call.id))!.getTime()).toBe((await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).payBy!.getTime());
  });
});
