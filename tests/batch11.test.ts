import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import * as R from "@/lib/rules";
import { CALLS_TOTAL_CENTS, overCeilingLine } from "@/lib/callMeasure";
import { parseFormatted, wrapSelection } from "@/lib/markdown";
import { owed, owedLines, retryOwed, runDaily, startHold } from "@/lib/server/holds";
import { expireActions } from "@/lib/server/confirm";
import { deleteAccount } from "@/lib/server/restrictions";
import { testerDeleteLines } from "@/lib/server/deletion";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 11 (owner, Oct 29, later): deleted testers' sent work, the chargeback fee, bank confirmations, retries during holds, the paused banner's deadline line, Pay and
// Pay more in one box (with batch 12 section 2's call caps), the written part's length, formatting, files and recordings, and FREE_UNTIL.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const more = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
const webhook = (type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ type, data: { object } }) }));
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in: `mode` decides what a new PaymentIntent does; retrieve answers with `after`. */
function fakeStripe(opts: { mode?: "ok" | "decline" | "action" | "away-action"; after?: "succeeded" | "canceled" } = {}) {
  const made: { amount: number; off_session?: boolean; payment_method_types?: string[] }[] = [];
  const cancelled: string[] = [];
  const refunds: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; off_session?: boolean }) => {
        made.push(p);
        const id = "pi_" + randomUUID();
        const mode = opts.mode ?? "ok";
        if (mode === "decline") throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        if (mode === "action" && !p.off_session) return { id, status: "requires_action", client_secret: `${id}_secret` };
        if ((mode === "action" || mode === "away-action") && p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: opts.after ?? "succeeded", client_secret: `${id}_secret` }),
      cancel: async (id: string) => { cancelled.push(id); return { id, status: "canceled" }; },
    },
    refunds: { create: async (p: { payment_intent: string }) => { refunds.push(p.payment_intent); return { id: "re_" + randomUUID() }; } },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { made, cancelled, refunds, set: (o: typeof opts) => Object.assign(opts, o) };
}

/** Written answers sent on a test (listed at `writtenCents`, or not listed with null). */
async function sentWork(writtenCents: string | null = "10.00", over: Record<string, unknown> = {}) {
  const s = await setup(writtenCents == null ? { writtenCents: null, questions: [], ...over } : { writtenCents, ...over });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("batch 11 item 1: a deleted tester's sent work is still reviewed", () => {
  it("with a payout account: Pay works and reaches their Stripe account; reminders go on; Charge never opens", async () => {
    const { dev, tester, testId, sub } = await sentWork();
    const acct = "acct_" + randomUUID().slice(0, 12);
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: acct, payoutsReady: true } });
    await deleteAccount(tester.user.id, "self");
    // Charge would be open: 14 days passed and the test closed.
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 15 * DAY) } });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } }); await db.contract.updateMany({ where: { testId: testId }, data: { dueAt: new Date(Date.now() - 1000) } }); // (batch 15 section 18: the tester's own deadline)
    await runDaily();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: dev.user.id, reminderKey: `unreviewed:${sub.id}`, text: { contains: "pay it." } } })).toBe(1);
    await withCard(dev.user.id);
    const s = fakeStripe();
    const made: { transfer_data?: { destination?: string } }[] = [];
    setStripeForTests({ paymentIntents: { create: async (p: { transfer_data?: { destination?: string } }) => { made.push(p); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect(made[0].transfer_data?.destination).toBe(acct);
    expect(s).toBeTruthy();
  });

  it("(DEFAULT) without a payout account: it leaves Needs you, and Pay is refused with the line", async () => {
    const { dev, tester, sub } = await sentWork();
    await deleteAccount(tester.user.id, "self");
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.error).toMatchObject({ code: "gone", message: "Ana Silva deleted their account before setting up payouts, so this can't be paid." });
    expect(R.testerPayable({ deletedAt: new Date(), stripeAccountId: null, payoutsReady: false })).toBe(false);
    expect(R.testerPayable({ deletedAt: new Date(), stripeAccountId: "acct_1", payoutsReady: true })).toBe(true);
    expect(src("app/app/tests/[id]/page.tsx")).toContain(".filter((c) => testerPayable(c.tester))");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("{deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null }))}");
  });

  it("the tester's delete warning", () => {
    const lines = testerDeleteLines({ waitingCents: 0, delayedN: 0, delayedCents: 0, unpaidN: 1, unpaidCents: 800, payoutsReady: true }).map((l) => l.text);
    expect(lines).toContain("1 part you sent isn't paid yet (up to $8.00). Work you already sent can still be paid by the developer, to your Stripe account if it's set up. After deleting, you can't charge for it or dispute it.");
  });
});

describe("batch 11 item 2: the chargeback fee", () => {
  async function chargedBack() {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    const st = fakeStripe();
    expect((await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: s.sub.id, status: "charged" } });
    await webhook("charge.dispute.created", { payment_intent: p.stripePaymentIntentId });
    return { ...s, p, st };
  }

  it("each chargeback adds $15 to what is owed; the Payments line; Pay what you owe charges both", async () => {
    expect(R.CHARGEBACK_FEE_CENTS).toBe(1500);
    const { dev, p, st } = await chargedBack();
    expect((await owed(dev.user.id)).map((x) => x.amountCents)).toEqual([2500]);
    expect((await owedLines(dev.user.id))[0].text).toBe("Your bank reversed a $10 payment: $10 + $15 chargeback fee");
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.body.paid).toBe(1);
    expect(st.made.at(-1)!.amount).toBe(2500);
    expect(await db.payment.findFirstOrThrow({ where: { repaysId: p.id } })).toMatchObject({ amountCents: 2500, status: "charged" });
  });

  it("won after paying: the amount and the fee are refunded; a payments-kind stop-once line on the test page", async () => {
    const { dev, p, st, testId } = await chargedBack();
    await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    const loaded = seen();
    await settle();
    await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" });
    expect(st.refunds).toHaveLength(1);
    const line = "Your bank's chargeback of $10.00 was reversed: $25.00 refunded to your card.";
    expect(await db.testEvent.count({ where: { testId, kind: "payment", text: line } })).toBe(1);
    expect(R.DEV_STOP_KINDS).toContain("payment");
    const stop = await act(testId, "stop", dev.cookie, { seenAt: loaded });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toContain(line);
  });

  it("won before paying: both leave what is owed; Pay what you owe stops once for it", async () => {
    const { dev, p, testId } = await chargedBack();
    const lines = await owedLines(dev.user.id);
    await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" });
    expect(await owed(dev.user.id)).toEqual([]);
    expect(await db.testEvent.count({ where: { testId, kind: "payment", text: "Your bank's chargeback of $10.00 was reversed: $25.00 taken off what you owe." } })).toBe(1);
    // A second owed line keeps the box: the press with the old page stops once naming the reversal.
    await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: dev.user.id, amountCents: 700, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "unpaid");
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 2500, seenIds: lines.map((l) => l.id) } })));
    expect(r.body.error.code).toBe("stop_once");
  });
});

describe("batch 11 item 3: the bank wants to confirm a payment", () => {
  it("a developer's own Pay is on-session; the bank's pop-up confirms it and it goes through; while it is open the piece is locked (batch 12 section 5)", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    const st = fakeStripe({ mode: "action", after: "succeeded" });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ requiresAction: true, simulated: true });
    expect(st.made[0].off_session).toBeUndefined();
    expect(st.made[0].payment_method_types).toEqual(["card"]);
    const ch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen(), confirmed: true });
    expect(ch.body.error.message).toBe("A payment for this is being confirmed right now.");
    const done = await confirm(dev.cookie, { paymentId: r.body.paymentId });
    expect(done.status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toMatchObject({ status: "charged", actionPi: null });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane paid you $10.00 for your written answers" } } })).toBe(1);
  });

  it("refused (or left open 15 minutes): nothing was charged, no hold, the piece is free again", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    fakeStripe({ mode: "action", after: "canceled" });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const no = await confirm(dev.cookie, { paymentId: r.body.paymentId });
    expect(no.body.error).toMatchObject({ code: "not_confirmed", message: "Your bank didn't confirm the payment, so nothing was charged." });
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    // Timed out: the same.
    const r2 = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await db.payment.update({ where: { id: r2.body.paymentId }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(await db.payment.findUniqueOrThrow({ where: { id: r2.body.paymentId } })).toMatchObject({ status: "cancelled" });
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
  });

  it("a tester's Charge while the developer is away waits for their Confirm (bell and email even with Off); the tester reads 'delayed'; 3 days unconfirmed is a decline", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    const st = fakeStripe({ mode: "away-action" });
    const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(200);
    expect(st.made[0].off_session).toBe(true);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "review" } });
    expect(p.status).toBe("needs_confirmation");
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Your bank wants you to confirm a $10.00 payment. Confirm it in Payments by" } } });
    expect(n.mustEmail).toBe(true);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Payment for your work on “Harbor Run” may be delayed" } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    await db.payment.update({ where: { id: p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "failed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("Confirm on Payments puts it through", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    fakeStripe({ mode: "away-action", after: "succeeded" });
    await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "review" } });
    expect((await confirm(dev.cookie, { paymentId: p.id, start: true })).body).toMatchObject({ paymentId: p.id, simulated: true });
    expect((await confirm(dev.cookie, { paymentId: p.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
    expect(src("app/app/payments/page.tsx")).toContain("<ConfirmList items=");
  });
});

describe("batch 11 item 4: automatic retries during a hold", () => {
  async function held(amounts = [800]) {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    for (const amountCents of amounts) await db.payment.create({ data: { kind: "review", contractId: s.sessionId, developerId: s.dev.user.id, testerId: s.tester.user.id, amountCents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(s.dev.user.id, "unpaid");
    return s;
  }

  it("a successful retry pays, tells the developer and lifts the hold", async () => {
    const { dev } = await held();
    fakeStripe();
    expect(await retryOwed(dev.user.id)).toMatchObject({ cents: 800, lifted: true });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "We charged your card $8.00 for what you owed." } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });

  it("a failed retry sends nothing; once a day, at most 7 a hold; a new card retries at once; Payments shows the tries", async () => {
    const { dev } = await held();
    fakeStripe({ mode: "decline" });
    const now = new Date();
    expect(await retryOwed(dev.user.id, now)).toMatchObject({ cents: 0 });
    expect(await retryOwed(dev.user.id, new Date(now.getTime() + 3_600_000))).toBeNull(); // not twice a day
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "We charged your card" } } })).toBe(0);
    let u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(u.holdRetries).toBe(1);
    expect(R.retryStatusLine(u, (d) => d.toISOString())).toMatch(/^Last try: .+ · next try: .+$/);
    await db.user.update({ where: { id: dev.user.id }, data: { holdRetries: 7, holdRetryAt: new Date(Date.now() - 2 * DAY) } });
    expect(await retryOwed(dev.user.id)).toBeNull();
    u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(R.retryStatusLine(u, (d) => d.toISOString())).toBe("No more automatic tries: press Pay what you owe.");
    fakeStripe();
    expect(await retryOwed(dev.user.id, new Date(), "card")).toMatchObject({ cents: 800, lifted: true });
    expect(src("lib/server/stripe.ts")).toContain('retryOwed(userId, new Date(), "card")');
  });

  it("a suspension is never lifted by a payment; a retry the bank wants confirmed waits for Confirm", async () => {
    const { dev } = await held();
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    fakeStripe({ mode: "away-action" });
    expect(await retryOwed(dev.user.id)).toMatchObject({ cents: 0 });
    const p = (await owed(dev.user.id))[0];
    expect(p.actionPi).not.toBeNull();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Your bank wants you to confirm a $8.00 payment" } } })).toBe(1);
    fakeStripe({ after: "succeeded" });
    expect((await confirm(dev.cookie, { paymentId: p.id })).status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(u.holdStartedAt).toBeNull();
    expect(u.devSuspendedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: R.STILL_SUSPENDED_LINE } })).toBe(1);
  });
});

describe("batch 11 item 5: the paused banner mentions the deadline", () => {
  it("only when the tester has one and deadlines move with the pause", () => {
    const all = { drafts: true, charge: false, dispute: false, rate: false, leave: true, cancelCalls: false, send: true, requestCalls: true, chat: true };
    expect(R.pausedForTesters({ ...all, deadline: true })).toMatch(/ Your deadline is paused too: it moves later by however long the pause lasts\.$/);
    expect(R.pausedForTesters(all)).not.toContain("deadline");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('deadline: c.status === "working"');
  });
});

describe("batch 11 item 6 (with batch 12 section 2): one Pay box, Pay more", () => {
  it("a listed piece: the first Pay can go above the listing within the cap; then Pay more until the cap; the tester's lines", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentWork("20.00");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "40.01", tickedCents: 4001 })).body.error.message).toBe("This is more than you can pay above the listing (up to $20).");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "30.00", tickedCents: 3000 })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid you $30.00 for your written answers on “Harbor Run”" } })).toBe(1);
    expect((await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "10.01", tickedCents: 1001 })).body.error.message).toBe("This is more than you can pay above the listing (up to $10).");
    expect((await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "10.00", tickedCents: 1000, note: "Great" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid you $10.00 more for your written answers on “Harbor Run”" } })).toBe(1); // (batch 15 section 20: the note is in the email, not the bell)
  });

  it("an unlisted written piece: up to $2000 in all; Pay more needs a first payment", async () => {
    const { dev, testId, sessionId, sub } = await sentWork(null);
    expect((await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "5.00", tickedCents: 500 })).body.error.message).toBe("Pay this part first: Pay more is for a part you've already paid.");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "2000.01", tickedCents: 200_001, over200: true })).body.error.message).toBe("This is more than you can pay above the max (up to $1,000).");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "1500.00", tickedCents: 150_000, over200: true })).status).toBe(200);
    expect((await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "500.01", tickedCents: 50_001, over200: true })).status).toBe(400);
    expect((await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "500.00", tickedCents: 50_000, over200: true })).status).toBe(200);
  });

  it("unlisted calls: $200/h for the measured minutes with nothing above, and (batch 15 section 34) $1,000 for all of a tester's calls", async () => {
    expect(CALLS_TOTAL_CENTS).toBe(100_000);
    const s = await setup({ liveRateCents: null });
    const j = await joined(s.testId);
    const took = async (h: number) => {
      const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, h);
      await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - h * 3_600_000), measuredMinutes: 180, measuredAt: new Date() } });
      return call;
    };
    // 3 hours at $200/h = $600; nothing above it.
    const first = await took(48);
    expect((await pay(s.dev.cookie, { kind: "call", id: first.id, amount: "600.01", tickedCents: 60_001, over200: true })).body.error.message).toBe(R.overCallsLine(60_000));
    expect((await pay(s.dev.cookie, { kind: "call", id: first.id, amount: "600.00", tickedCents: 60_000, over200: true })).status).toBe(200);
    // $400 left of the $1,000 for this tester's calls.
    const second = await took(72);
    expect((await pay(s.dev.cookie, { kind: "call", id: second.id, amount: "400.01", tickedCents: 40_001, over200: true })).body.error.message).toBe(overCeilingLine(40_000));
    expect((await pay(s.dev.cookie, { kind: "call", id: second.id, amount: "400.00", tickedCents: 40_000, over200: true })).status).toBe(200);
    // Nothing left: another call can't even be booked.
    const startsAt = new Date(Date.now() + 96 * 3_600_000); startsAt.setSeconds(0, 0);
    expect((await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [j.sessionId], startsAt: startsAt.toISOString() })).body.error.message).toBe("Calls with Ana Silva on this test can come to at most $1,000; $0.00 is left, so this call can't be booked.");
  });

  it("the tester rows keep a Pay more box on paid pieces; no separate Extra pay", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("<PayBox more={{ testId: t.id, contractId: c.id }}");
    expect(page).not.toContain("<ExtraPay");
    expect(fs.existsSync(path.resolve(__dirname, "../src/app/app/tests/[id]/ExtraPay.tsx"))).toBe(false);
  });
});

describe("batch 11 item 7: the written part", () => {
  it("at most 50,000 characters in all (batch 14 section 5; was 10,000), counted live", async () => {
    const s = await setup({ questions: ["One?", "Two?"] });
    const j = await joined(s.testId);
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a".repeat(30_000), "b".repeat(20_000)], notes: "c" });
    expect(r.body.error).toMatchObject({ code: "too_long", message: "Your written answers can be at most 50,000 characters in all (now 50,001)." });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a".repeat(30_000), "b".repeat(20_000)] })).status).toBe(200);
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("data-written-count");
  });

  it("bold, italic and code blocks only, rendered as text (no HTML, no links)", () => {
    expect(parseFormatted("Hi **there** and *you*")).toEqual([{ kind: "text", runs: [{ text: "Hi " }, { text: "there", bold: true }, { text: " and " }, { text: "you", italic: true }] }]);
    expect(parseFormatted("Look:\n```\nlet x = 1;\n```\nend")).toEqual([{ kind: "text", runs: [{ text: "Look:\n" }] }, { kind: "code", text: "let x = 1;" }, { kind: "text", runs: [{ text: "\nend" }] }]);
    expect(parseFormatted("<script>alert(1)</script> [x](javascript:alert(1))")).toEqual([{ kind: "text", runs: [{ text: "<script>alert(1)</script> [x](javascript:alert(1))" }] }]);
    expect(wrapSelection("hello world", 6, 11, "bold")).toEqual({ value: "hello **world**", start: 8, end: 13 });
    expect(src("components/Formatted.tsx")).not.toContain("dangerouslySetInnerHTML");
    // (Batch 13) The answers are shown formatted inside each set (SetView).
    expect(src("components/AnswerSets.tsx")).toContain("<Formatted text={it.answer} />");
  });

  it("files on the written part: images, PDF, text or zip, 25 MB, 5 at most; recordings too; they go with the answers", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const start = (body: Record<string, unknown>) => sact(j.sessionId, "recording-start", j.tester.cookie, body);
    expect((await start({ part: "written", filename: "a.exe", size: 10, contentType: "application/x-msdownload" })).body.error.code).toBe("bad_type");
    expect((await start({ part: "recording", filename: "a.pdf", size: 10, contentType: "application/pdf" })).body.error.code).toBe("bad_type");
    expect((await start({ part: "written", filename: "big.pdf", size: 25 * 1024 * 1024 + 1, contentType: "application/pdf" })).body.error.message).toBe("Files can be at most 25 MB.");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await start({ part: "written", filename: `shot${i}.png`, size: 100, contentType: "image/png" });
      expect(r.status).toBe(200);
      ids.push(r.body.recordingId);
    }
    expect((await start({ part: "written", filename: "six.png", size: 100, contentType: "image/png" })).body.error.message).toBe("You can attach at most 5 files to your written answers.");
    expect((await start({ part: "written", filename: "screen.webm", size: 100, contentType: "video/webm" })).status).toBe(200);
    await db.recording.updateMany({ where: { id: { in: ids } }, data: { uploadedAt: new Date() } });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(await db.recording.count({ where: { submissionId: sub.id } })).toBe(5);
    expect(src("components/ScreenRecorder.tsx")).toContain("getDisplayMedia");
    expect(src("components/ScreenRecorder.tsx")).toContain("MediaRecorder");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<AttachmentList items={x.s!.recordings.filter((r) => r.uploadedAt)} />");
  });
});

describe("batch 11 item 8: free during launch from FREE_UNTIL", () => {
  it("no admin setting; the env date drives the notices", () => {
    expect(src("app/admin/page.tsx")).not.toContain("set-free-until");
    expect(src("lib/server/subscription.ts")).toContain("process.env.FREE_UNTIL");
  });
});
