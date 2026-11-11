import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { awayAction } from "@/lib/server/confirm";
import { pieceCloseOut } from "@/lib/server/closeOut";
import { startHold } from "@/lib/server/holds";
import { deleteAccount, pauseTest } from "@/lib/server/restrictions";
import { fmtDate } from "@/lib/server/dateFormat";
import * as R from "@/lib/rules";
import { TEAM_CLOSED_NO_DISPUTE, TEAM_CLOSED_NO_PAY, NO_CHARGE_LATE } from "@/lib/moneyLines";
import { ALL_BUSY, IN_CONFIRM_ALL, NOTHING_TO_CONFIRM } from "@/lib/confirmAllText";
import { ALREADY_CONFIRMED, CONFIRM_CANCELLED, CONFIRM_EXPIRED } from "@/lib/server/confirm";
import { ACCOUNT_NO_LONGER_EXISTS } from "@/lib/refusal";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §365 file 2, narrowed) THE MONEY REFUSAL MATRIX: the money buttons only (Pay, Pay more, Confirm with your bank, Confirm all, Charge, Let it go,
// Dispute), each STATE refusal its route can throw, reached and asserted with its exact text, and nothing in the database changed by the refused press: already
// paid / charged / settled (a part settled by Pay, Charge or Let it go included), the windows closed, the caps ($500 a part with Pay more; the $500 for a
// tester's calls), a duplicate waiting for the bank, already done in another tab, the block's hidden "This payment isn't available.", deleted accounts, and
// pauses and holds as §386 A has them (a team pause, a suspension and a hold all refuse them). Field validation and technical errors are out of scope.

type Res = { status: number; body: { error?: { code?: string; message?: string } } & Record<string, unknown> };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ANS = "The harbour level was clear and the boats handled well on the first try.";

beforeEach(async () => {
  await db.outage.deleteMany({}); // (outages are site-wide: an earlier file's would move the closing dates)
});

/** Ana (she) sent her written answers (listed $10, unpaid) on a test with a $10 recording and a $30/h live call. */
async function world() {
  const s = await setup({ recordingCents: "10.00" });
  const ana = await joined(s.testId, "Ana Silva");
  expect((await sact(ana.sessionId, "written", ana.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  return { ...s, ana, sub };
}
type W = Awaited<ReturnType<typeof world>>;

/** Everything a refused money press could have written. */
async function fingerprint(testId: string) {
  const cs = await db.contract.findMany({ where: { testId }, orderBy: { id: "asc" }, select: { id: true, status: true } });
  const ids = cs.map((c) => c.id);
  const [subs, reviews, pays, disputes] = await Promise.all([
    db.submission.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, choiceOfferedAt: true, paidUpdateDoneAt: true } }),
    db.review.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, amountCents: true, reason: true, rejected: true } }),
    db.payment.findMany({ where: { OR: [{ contractId: { in: ids } }, { developerId: (await db.test.findUniqueOrThrow({ where: { id: testId } })).developerId }] }, orderBy: { id: "asc" }, select: { id: true, status: true, actionPi: true, coveredById: true } }),
    db.dispute.count({ where: { contractId: { in: ids } } }),
  ]);
  return JSON.stringify({ cs, subs, reviews, pays, disputes });
}
/** The press is refused with exactly `text` and changes nothing. */
async function refused(w: { testId: string }, press: () => Promise<Res>, text: string | RegExp) {
  const before = await fingerprint(w.testId);
  const r = await press();
  expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
  if (typeof text === "string") expect(r.body.error?.message).toBe(text);
  else expect(r.body.error?.message).toMatch(text);
  expect(await fingerprint(w.testId), "nothing changed").toBe(before);
}

// The presses (each from a page loaded just now: a refusal comes before any stop-once).
const pay = (w: W, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie: w.dev.cookie, body: { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), ...body } })).then(json) as Promise<Res>;
const payMore = (w: W, body: Record<string, unknown> = {}) => act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID(), seenAt: seen(), ...body }) as Promise<Res>;
const confirm = (cookie: string, paymentId: string, body: Record<string, unknown> = {}) => confirmPOST(req("/api/payments/confirm", { cookie, body: { paymentId, start: true, seenAt: seen(), ...body } })).then(json) as Promise<Res>;
const confirmAll = (cookie: string, body: Record<string, unknown> = {}) => allPOST(req("/api/payments/confirm-all", { cookie, body: { seenAt: seen(), ...body } })).then(json) as Promise<Res>;
const choose = (w: W, choice: "charge" | "letgo", body: Record<string, unknown> = {}) => sact(w.ana.sessionId, "choose", w.ana.tester.cookie, { submissionId: w.sub.id, choice, ...(choice === "charge" ? { tickedCents: 1000 } : {}), seenAt: seen(), ...body }) as Promise<Res>;
const dispute = (w: W, body: Record<string, unknown> = {}) => sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully and in detail.", seenAt: seen(), ...body }) as Promise<Res>;

/** Charge open on Ana's written answers (as the daily job opens it). */
const chargeOpen = (w: W) => db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(10), choiceOfferedAt: ago(2), choiceBy: new Date(Date.now() + 12 * DAY) } });
/** A charge on Ana's written answers made while the developer was away, waiting for "Confirm with your bank" (her Charge, by default). */
async function waitingCharge(w: W, reason = R.CHARGED_BY_TESTER) {
  await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason } });
  const p = await db.payment.create({ data: { kind: "review", contractId: w.ana.sessionId, submissionId: w.sub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "pending" } });
  await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: `pi_${randomUUID()}`, clientSecret: "test_only" });
  return db.payment.findUniqueOrThrow({ where: { id: p.id } });
}
/** The developer's own Pay on Ana's written answers whose bank page is open (nothing paid yet). */
const ownPayAtBank = (w: W, kind = "review", cents = 1000) =>
  db.payment.create({ data: { kind, contractId: w.ana.sessionId, submissionId: w.sub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: `pi_${randomUUID()}`, actionBy: new Date(Date.now() + 15 * 60_000), payKey: randomUUID() } });
/** Every deadline and Open until `daysAgo` days ago, the part's review date before them: its closing date has passed. */
async function closedOut(w: W, daysAgo = 15) {
  await db.test.update({ where: { id: w.testId }, data: { openUntil: ago(daysAgo) } });
  await db.contract.updateMany({ where: { testId: w.testId }, data: { dueAt: ago(daysAgo) } });
  await db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(daysAgo + 5) } });
}
async function admin() {
  const a = await makeUser({ name: "Team Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}
/** A listed call with Ana that took place (`minutes` measured), unpaid. */
async function heldCall(w: W, minutes = 30, hours = 48) {
  const call = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, hours);
  return db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - (hours + 1) * 3_600_000), actualMinutes: minutes, payBy: new Date(Date.now() + 5 * DAY) } });
}

describe("§365 money refusals: Pay", () => {
  it("already paid by this developer: here, and in another tab (named with its time)", async () => {
    const w = await world();
    expect((await pay(w, { tab: "B" })).status).toBe(200);
    await refused(w, () => pay(w, { tab: "B" }), "You already paid $10.00 for Ana Silva's written answers.");
    await refused(w, () => pay(w, { tab: "A" }), /^You already paid \$10\.00 for Ana Silva's written answers in another tab at \d{1,2}:\d{2} [AP]M\.$/);
  });

  it("settled by the tester: her Charge, her Let it go", async () => {
    const w = await world();
    await chargeOpen(w);
    expect((await choose(w, "charge", { confirmed: true })).status).toBe(200);
    await refused(w, () => pay(w, {}), "Ana Silva already charged $10.00 for her written answers.");
    const v = await world();
    await chargeOpen(v);
    expect((await choose(v, "letgo", { confirmed: true })).status).toBe(200);
    await refused(v, () => pay(v, {}), "Ana Silva let her written answers go: nothing was charged.");
  });

  it("settled otherwise: the team's $0 closure, an old rejection, a declined payment owed on it", async () => {
    const w = await world();
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 0, agreedCents: 1000, payKey: randomUUID(), reason: "Closed by the team.", teamClosedById: (await admin()).id } });
    await refused(w, () => pay(w, {}), TEAM_CLOSED_NO_PAY);
    const v = await world();
    await db.review.create({ data: { contractId: v.ana.sessionId, submissionId: v.sub.id, amountCents: 0, agreedCents: 1000, payKey: randomUUID(), reason: "Not usable.", rejected: true } });
    await refused(v, () => pay(v, {}), "You already rejected Ana Silva's written answers.");
    const o = await world();
    await db.review.create({ data: { contractId: o.ana.sessionId, submissionId: o.sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "" } });
    await db.payment.create({ data: { kind: "review", contractId: o.ana.sessionId, submissionId: o.sub.id, developerId: o.dev.user.id, testerId: o.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await refused(o, () => pay(o, {}), "This $10.00 is owed: pay it with “Pay what you owe” in Payments.");
  });

  it("a payment on the part waiting for the bank: the tester's Charge (Confirm it first), the developer's own Pay (being confirmed)", async () => {
    const w = await world();
    await waitingCharge(w);
    await refused(w, () => pay(w, {}), "Confirm Ana Silva's $10.00 charge with your bank first.");
    const v = await world();
    await ownPayAtBank(v);
    await refused(v, () => pay(v, {}), "A payment for this part is being confirmed. Wait for it to finish before paying again.");
  });

  it("the window closed: Pay closed on the part's closing date", async () => {
    const w = await world();
    await closedOut(w);
    const at = (await pieceCloseOut({ submissionId: w.sub.id }))!;
    await refused(w, () => pay(w, {}), R.payClosedLine(fmtDate(at)));
  });

  it("caps: $500 a part; a call over what's left of the $500 for a tester's calls", async () => {
    const w = await world();
    await refused(w, () => pay(w, { amount: "500.01", tickedCents: 50_001, over200: true }), "This is more than this piece can be paid (up to $500).");
    const long = await heldCall(w, 150, 48);
    expect((await pay(w, { kind: "call", id: long.id, amount: "450.00", tickedCents: 45_000, over200: true })).status).toBe(200);
    const next = await heldCall(w, 60, 60);
    await refused(w, () => pay(w, { kind: "call", id: next.id, amount: "60.00", tickedCents: 6000 }), "This is more than you can pay for this call (up to $50.00: what's left of the $500 for calls on this test).");
  });

  it("a call that can't be paid: cancelled, not started yet", async () => {
    const w = await world();
    const later = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, 48);
    await refused(w, () => pay(w, { kind: "call", id: later.id, amount: "15.00", tickedCents: 1500 }), "You can pay for this call once it has started.");
    await db.call.update({ where: { id: later.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date() } });
    await refused(w, () => pay(w, { kind: "call", id: later.id, amount: "15.00", tickedCents: 1500 }), "This call was cancelled, so there's nothing to pay.");
  });

  it("owing a declined payment (no hold): Pay what you owe first", async () => {
    const w = await world();
    const rec = await db.submission.create({ data: { contractId: w.ana.sessionId, kind: "recording", agreedCents: 1000 } });
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: rec.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "" } });
    await db.payment.create({ data: { kind: "review", contractId: w.ana.sessionId, submissionId: rec.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await refused(w, () => pay(w, {}), R.PAY_WAITS);
  });

  it("a deleted tester with no payout account: their session has ended", async () => {
    const w = await world();
    await deleteAccount(w.ana.tester.user.id, "self");
    await refused(w, () => pay(w, {}), "Deleted account's session has ended, so your Pay didn't go through.");
  });

  it("§386 A: a hold and a team pause both refuse it", async () => {
    const w = await world();
    await startHold(w.dev.user.id, "unpaid");
    await refused(w, () => pay(w, {}), "Your tests are paused, so your Pay didn't go through.");
    const v = await world();
    await pauseTest((await admin()).id, v.testId, "Checking");
    await settle();
    await refused(v, () => pay(v, {}), "The team paused this test, so your Pay didn't go through.");
  });
});

describe("§365 money refusals: Pay more", () => {
  /** Ana's written answers paid $10.00. */
  async function paid() {
    const w = await world();
    expect((await pay(w, { confirmed: true })).status).toBe(200);
    await settle();
    return w;
  }

  it("nothing paid yet (Pay comes first); a call that hasn't taken place", async () => {
    const w = await world();
    await refused(w, () => payMore(w), "Pay this part first: Pay more is for a part you've already paid.");
    const later = await bookCall(w.testId, w.dev.cookie, w.ana.sessionId, w.ana.tester.cookie, 48);
    await refused(w, () => payMore(w, { submissionId: undefined, callId: later.id }), "Extra pay goes on a call that took place.");
  });

  it("settled for good: the team's $0 closure", async () => {
    const w = await world();
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 0, agreedCents: 1000, payKey: randomUUID(), reason: "Closed by the team.", teamClosedById: (await admin()).id } });
    await refused(w, () => payMore(w), TEAM_CLOSED_NO_PAY);
  });

  it("the window closed: (Owner, Nov 11, §378) Pay more closed on the piece's own date", async () => {
    const w = await paid();
    await closedOut(w);
    const at = (await pieceCloseOut({ submissionId: w.sub.id }))!;
    await refused(w, () => payMore(w), R.payClosedLine(fmtDate(at), true));
  });

  it("the cap: $500 a part, Pay more included", async () => {
    const w = await paid();
    await refused(w, () => payMore(w, { amount: "490.01", tickedCents: 49_001, over200: true }), "This is more than this piece can be paid (up to $490 more, $500 in all).");
  });

  it("a payment on the part waiting for the bank: the tester's Charge, the developer's own earlier Pay more", async () => {
    const w = await world();
    await waitingCharge(w);
    await refused(w, () => payMore(w), "Confirm Ana Silva's $10.00 charge with your bank first.");
    const v = await paid();
    await ownPayAtBank(v, "extra", 500);
    await refused(v, () => payMore(v), "Your $5.00 payment for this part is waiting for your bank: finish or cancel it first.");
  });

  it("the block's hidden line, either way; a deleted tester with no payout account", async () => {
    for (const by of ["developer", "tester"] as const) {
      const w = await paid();
      await db.block.create({ data: by === "developer" ? { blockerId: w.dev.user.id, blockedId: w.ana.tester.user.id } : { blockerId: w.ana.tester.user.id, blockedId: w.dev.user.id } });
      await refused(w, () => payMore(w), by === "developer" ? "You blocked Ana Silva, so your Pay more didn't go through." : "This payment isn't available."); // (§380 H)
    }
    const v = await paid();
    await deleteAccount(v.ana.tester.user.id, "self");
    await refused(v, () => payMore(v), "This payment isn't available.");
  });

  it("§368: a hold refuses it", async () => {
    const w = await paid();
    await startHold(w.dev.user.id, "unpaid");
    await refused(w, () => payMore(w), "Your tests are paused, so your Pay more didn't go through.");
  });
});

describe("§365 money refusals: Confirm with your bank", () => {
  it("nothing to confirm: no such payment, another developer's", async () => {
    const w = await world();
    await refused(w, () => confirm(w.dev.cookie, randomUUID()), "There's nothing to confirm here.");
    const p = await waitingCharge(w);
    const other = await makeUser({ dev: true });
    await refused(w, () => confirm(other.cookie, p.id), "There's nothing to confirm here.");
  });

  it("already confirmed (here, and in another tab), cancelled, expired", async () => {
    const w = await world();
    const p = await waitingCharge(w);
    expect((await confirm(w.dev.cookie, p.id, { tab: "B", confirmed: true })).status).toBe(200);
    const done = await confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, body: { paymentId: p.id, simulate: "succeeded", tab: "B" } })).then(json);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    await refused(w, () => confirm(w.dev.cookie, p.id, { tab: "B" }), ALREADY_CONFIRMED);
    await refused(w, () => confirm(w.dev.cookie, p.id, { tab: "A" }), /^You already confirmed this payment in another tab at \d{1,2}:\d{2} [AP]M\.$/);
    const v = await world();
    const q = await waitingCharge(v);
    await db.payment.update({ where: { id: q.id }, data: { status: "cancelled", actionPi: null } });
    await refused(v, () => confirm(v.dev.cookie, q.id), CONFIRM_CANCELLED);
    const x = await world();
    const e = await waitingCharge(x);
    await db.payment.update({ where: { id: e.id }, data: { status: "failed", actionPi: null } });
    await refused(x, () => confirm(x.dev.cookie, e.id), CONFIRM_EXPIRED);
  });

  it("in an open Confirm all", async () => {
    const w = await world();
    const p = await waitingCharge(w);
    const all = await db.payment.create({ data: { kind: "owed", note: "press:all", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: `pi_${randomUUID()}`, actionBy: new Date(Date.now() + 15 * 60_000) } });
    await db.payment.update({ where: { id: p.id }, data: { coveredById: all.id, actionPi: null } });
    await refused(w, () => confirm(w.dev.cookie, p.id), IN_CONFIRM_ALL);
  });

  it("§368: a charge waiting for a hold's lift is refused with the held line; own deleted account", async () => {
    const w = await world();
    const p = await waitingCharge(w);
    await startHold(w.dev.user.id, "unpaid");
    await db.payment.update({ where: { id: p.id }, data: { status: "deferred", actionPi: null, actionBy: null } });
    await refused(w, () => confirm(w.dev.cookie, p.id), "Your tests are paused, so your Confirm with your bank didn't go through.");
    const v = await world();
    const q = await waitingCharge(v);
    await db.user.update({ where: { id: v.dev.user.id }, data: { deletedAt: new Date() } });
    await refused(v, () => confirm(v.dev.cookie, q.id), ACCOUNT_NO_LONGER_EXISTS);
  });
});

describe("§365 money refusals: Confirm all", () => {
  it("nothing waiting; already confirmed: (§380 I, D14) silent", async () => {
    const w = await world();
    expect((await confirmAll(w.dev.cookie, { seenIds: [], seenTotalCents: 0 })).body).toMatchObject({ already: true, line: "" });
    expect(NOTHING_TO_CONFIRM).toBe("There's nothing waiting for your bank to confirm.");
    const p = await waitingCharge(w);
    const r = await confirmAll(w.dev.cookie, { seenIds: [p.id], seenTotalCents: 1000, tab: "B", confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await confirmAll(w.dev.cookie, { seenIds: [p.id], seenTotalCents: 1000, tab: "A" })).body).toMatchObject({ already: true, line: "" });
  });

  it("one already waiting for the bank", async () => {
    const w = await world();
    const p = await waitingCharge(w);
    const all = await db.payment.create({ data: { kind: "owed", note: "press:all", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: `pi_${randomUUID()}`, actionBy: new Date(Date.now() + 15 * 60_000) } });
    await db.payment.update({ where: { id: p.id }, data: { coveredById: all.id, actionPi: null } });
    await refused(w, () => confirmAll(w.dev.cookie, { seenIds: [p.id], seenTotalCents: 1000 }), ALL_BUSY);
  });

  it("§386 A: during a hold Confirm all is refused (what waited for the bank waits for the lift); own deleted account", async () => {
    const w = await world();
    const p = await waitingCharge(w);
    await startHold(w.dev.user.id, "unpaid");
    await db.payment.update({ where: { id: p.id }, data: { status: "deferred", actionPi: null, actionBy: null } });
    await refused(w, () => confirmAll(w.dev.cookie, { seenIds: [p.id], seenTotalCents: 1000 }), "Your tests are paused, so your Confirm all didn't go through.");
    const v = await world();
    await db.user.update({ where: { id: v.dev.user.id }, data: { deletedAt: new Date() } });
    await refused(v, () => confirmAll(v.dev.cookie, {}), ACCOUNT_NO_LONGER_EXISTS);
  });
});

describe("§365 money refusals: Charge and Let it go", () => {
  for (const choice of ["charge", "letgo"] as const) {
    describe(choice === "charge" ? "Charge" : "Let it go", () => {
      it("not open yet; late work; the window closed", async () => {
        const w = await world();
        await refused(w, () => choose(w, choice), `You can choose once ${R.REVIEW_DAYS} days have passed since you sent it and your deadline has passed.`);
        await chargeOpen(w);
        await db.submission.update({ where: { id: w.sub.id }, data: { late: true } });
        await refused(w, () => choose(w, choice), NO_CHARGE_LATE);
        const v = await world();
        await closedOut(v, 30);
        await db.submission.update({ where: { id: v.sub.id }, data: { choiceOfferedAt: ago(20), choiceBy: ago(6) } });
        const at = (await pieceCloseOut({ submissionId: v.sub.id }))!;
        await refused(v, () => choose(v, choice), R.chargeClosedLine(fmtDate(at)));
      });

      it("settled: the developer paid meanwhile; her own choice; her Charge waiting for the developer's bank", async () => {
        const w = await world();
        await chargeOpen(w);
        expect((await pay(w, { confirmed: true })).status).toBe(200);
        await refused(w, () => choose(w, choice), R.paidMeanwhileLine("Nora Lane", 1000));
        const v = await world();
        await chargeOpen(v);
        expect((await choose(v, choice === "charge" ? "letgo" : "charge", { confirmed: true })).status).toBe(200);
        await refused(v, () => choose(v, choice), "You already chose for this.");
        const x = await world();
        await chargeOpen(x);
        await waitingCharge(x);
        await refused(x, () => choose(x, choice), R.ownChargeWaitingLine(1000, "your written answers", "Nora Lane"));
      });

      it("the developer's first Pay at the bank: being confirmed", async () => {
        const w = await world();
        await chargeOpen(w);
        await ownPayAtBank(w);
        await refused(w, () => choose(w, choice), R.PIECE_LOCKED);
      });

      it("the team's $0 closure", async () => {
        const w = await world();
        await chargeOpen(w);
        await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 0, agreedCents: 1000, payKey: randomUUID(), reason: "Closed by the team.", teamClosedById: (await admin()).id } });
        // (Fixed with §365: it read as the developer paying $0, "… you can dispute it", though Dispute is refused for it.)
        await refused(w, () => choose(w, choice), TEAM_CLOSED_NO_PAY);
      });
    });
  }
});

describe("§365 money refusals: Dispute", () => {
  it("nothing paid yet; already disputed; the team's $0 closure; her own Charge", async () => {
    const w = await world();
    await refused(w, () => dispute(w), "This hasn't been paid yet.");
    expect((await pay(w, { amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", confirmed: true })).status).toBe(200);
    expect((await dispute(w, { confirmed: true })).status).toBe(200);
    await refused(w, () => dispute(w), R.ALREADY_DISPUTED);
    const v = await world();
    await db.review.create({ data: { contractId: v.ana.sessionId, submissionId: v.sub.id, amountCents: 0, agreedCents: 1000, payKey: randomUUID(), reason: "Closed by the team.", teamClosedById: (await admin()).id } });
    await refused(v, () => dispute(v), TEAM_CLOSED_NO_DISPUTE);
    const x = await world();
    await chargeOpen(x);
    expect((await choose(x, "charge", { confirmed: true })).status).toBe(200);
    await refused(x, () => dispute(x), R.TESTER_CHOSE_LINE);
  });

  it("nothing left to dispute: paid the most, and paid to the most since her page loaded", async () => {
    const w = await world();
    expect((await pay(w, { amount: "500.00", tickedCents: 50_000, over200: true, confirmed: true })).status).toBe(200);
    await refused(w, () => dispute(w), R.NOTHING_TO_DISPUTE);
    const v = await world();
    expect((await pay(v, { amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", confirmed: true })).status).toBe(200);
    const loaded = seen();
    await settle();
    expect((await payMore(v, { amount: "496.00", tickedCents: 49_600, over200: true, confirmed: true })).status).toBe(200);
    await settle();
    await refused(v, () => dispute(v, { seenAt: loaded }), /^Nora Lane paid \$496\.00 more meanwhile \(\d{1,2}:\d{2} [AP]M\): this part is now paid the most it can be \(\$500\.00\), so there's nothing to dispute\.$/);
  });

  it("closed: she rated the test; the part's closing date passed", async () => {
    const w = await world();
    expect((await pay(w, { amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", confirmed: true })).status).toBe(200);
    expect((await sact(w.ana.sessionId, "rate", w.ana.tester.cookie, { stars: 4, seenAt: seen(), confirmed: true })).status).toBe(200);
    await refused(w, () => dispute(w), R.RATED_NO_DISPUTE);
    const v = await world();
    expect((await pay(v, { amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", confirmed: true })).status).toBe(200);
    await closedOut(v, 30);
    const at = (await pieceCloseOut({ submissionId: v.sub.id }))!;
    await refused(v, () => dispute(v), R.disputeClosedLine(fmtDate(at)));
  });
});
