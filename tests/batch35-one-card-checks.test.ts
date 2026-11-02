import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import * as R from "@/lib/rules";
import { owed, owedLines, payOwed, retryOwed, startHold } from "@/lib/server/holds";
import { awayAction, confirmItems, expireActions } from "@/lib/server/confirm";
import { saveCardFromCheckout, setStripeForTests } from "@/lib/server/stripe";
import { OWED_PAID } from "@/lib/server/owedOnce";
import { json, req } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 2, batch 35 §117) One card in play; bank checks never double-charge: Pay what you owe is ONE payment for the total; a debt waiting for the bank is
// locked (press, daily retry) until its check is confirmed or cancelled ("Cancel this check"); a check the app stops tracking is cancelled at Stripe first (one that
// had already gone through is recorded as paid); a new card cancels every waiting check and tries each item again on it.

const DAY = 86_400_000;
afterEach(() => setStripeForTests(null));

/**
 * A Stripe stand-in that remembers each PaymentIntent: `ask` cards make the bank ask (off-session: authentication_required), `decline` cards are declined. A cancel
 * refuses a PaymentIntent that already went through, as Stripe does. `approve` is the developer finishing the bank's page.
 */
function bank() {
  const pis = new Map<string, string>();
  const made: { amount: number; payment_method?: string; off_session?: boolean }[] = [];
  const cancelled: string[] = [];
  const transfers: { destination?: string; source_transaction?: string; amount?: number }[] = [];
  const ask = new Set<string>(), decline = new Set<string>(), attempt = new Set<string>(), broken = new Set<string>();
  const card = { customer: "", next: "" };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; payment_method?: string; off_session?: boolean; capture_method?: string }) => {
        made.push(p);
        const id = "pi_" + randomUUID();
        if (decline.has(p.payment_method ?? "")) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        // (§122) Stripe's own trouble (not the card): never a decline.
        if (broken.has(p.payment_method ?? "")) throw Object.assign(new Error("Too many requests."), { type: "StripeRateLimitError" });
        // (§122) Like test card 3184 off-session: the attempt fails and the PaymentIntent waits in requires_payment_method.
        if (attempt.has(p.payment_method ?? "") && p.off_session) {
          pis.set(id, "requires_payment_method");
          throw Object.assign(new Error("The latest payment attempt of this PaymentIntent has failed."), { type: "StripeCardError", code: "payment_intent_payment_attempt_failed", raw: { code: "payment_intent_payment_attempt_failed", payment_intent: { id, client_secret: `${id}_secret`, status: "requires_payment_method", last_payment_error: { code: "payment_intent_payment_attempt_failed" } } } });
        }
        if (ask.has(p.payment_method ?? "")) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret` };
        }
        // A chargeback hold's reservation: authorized, not taken.
        if (p.capture_method === "manual") return pis.set(id, "requires_capture"), { id, status: "requires_capture" };
        pis.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "requires_action", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => {
        if (pis.get(id) === "succeeded") throw Object.assign(new Error("This PaymentIntent already succeeded."), { type: "StripeInvalidRequestError", code: "payment_intent_unexpected_state" });
        cancelled.push(id);
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
      confirm: async (id: string, p: { payment_method?: string }) => {
        if (decline.has(p.payment_method ?? "")) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        return { id, status: "requires_action", client_secret: `${id}_secret`, payment_method: p.payment_method };
      },
    },
    transfers: { create: async (p: { destination?: string; source_transaction?: string; amount?: number }) => { transfers.push(p); return { id: "tr_" + randomUUID() }; } },
    checkout: { sessions: { retrieve: async () => ({ customer: card.customer, setup_intent: { payment_method: card.next } }) } },
    customers: { update: async () => ({}) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: id.slice(-4), exp_month: 12, exp_year: 2030 } }) },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { pis, made, cancelled, transfers, ask, decline, attempt, broken, card, approve: (id: string) => pis.set(id, "succeeded") };
}

/** A developer with written answers sent on a test, a saved card ("pm_old") and a tester ready for payouts. */
async function world() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const customer = "cus_" + randomUUID();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: customer, stripePaymentMethodId: "pm_old" } });
  await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  return { ...s, ...j, sub, customer };
}

/** Three debts on a payment hold, each named differently: the written answers (declined), the team's dispute decision (declined), and work charged while paused. */
async function threeDebts() {
  const w = await world();
  const base = { contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, feeCents: 0, testerCents: 0 };
  const a = await db.payment.create({ data: { ...base, kind: "review", submissionId: w.sub.id, amountCents: 800, status: "failed", owedUntil: new Date() } });
  const b = await db.payment.create({ data: { ...base, kind: "dispute", amountCents: 300, status: "failed", owedUntil: new Date() } });
  const c = await db.payment.create({ data: { ...base, kind: "review", amountCents: 500, status: "owed" } });
  await startHold(w.dev.user.id, "unpaid");
  return { ...w, debts: [a, b, c] };
}

const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const owedPress = (cookie: string, body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie, body })).then(json);
const oneOf = (devId: string) => db.payment.findFirstOrThrow({ where: { developerId: devId, kind: "owed" }, orderBy: { createdAt: "desc" } });
const receipts = (userId: string) => db.notification.findMany({ where: { userId, text: { startsWith: "Receipt: you paid" } } });
const hold = async (devId: string) => (await db.user.findUniqueOrThrow({ where: { id: devId } })).holdStartedAt;

describe("§117 rule 6: Pay what you owe is ONE payment", () => {
  it("three debts: one charge and one bank check for the total; the box lists all three, locked under it; approved, all three are paid by it and the hold lifts", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 1600, seenIds: w.debts.map((d) => d.id) });
    expect(r.status).toBe(200);
    // One charge for $16.00, one check.
    expect(st.made).toHaveLength(1);
    expect(st.made[0]).toMatchObject({ amount: 1600 });
    expect(r.body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ amountCents: 1600, status: "needs_action", testerId: w.dev.user.id });
    expect(r.body.confirm[0].paymentId).toBe(one.id);
    // The box still lists each payment it covers, by name and amount, every one waiting under the same check.
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => l.text)).toEqual([expect.stringMatching(/^Ana Silva's written answers \$8\.00 · card declined /), expect.stringMatching(/\$3\.00 · card declined /), expect.stringMatching(/^Ana Silva's written answers \$5\.00 · charged by the tester while your tests were paused$/)]);
    expect(lines.every((l) => l.waiting && !l.retry && l.checkId === one.id)).toBe(true);
    // Approved on the bank's page: every debt is paid by that one payment, the tester's shares go out from its charge, one receipt names all three.
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", coveredById: one.id, stripePaymentIntentId: one.actionPi, settledAt: expect.any(Date) });
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: OWED_PAID, actionPi: null });
    expect(st.transfers.map((t) => t.source_transaction)).toEqual([one.actionPi!.replace(/^pi_/, "ch_"), one.actionPi!.replace(/^pi_/, "ch_"), one.actionPi!.replace(/^pi_/, "ch_")]);
    const rc = await receipts(w.dev.user.id);
    expect(rc).toHaveLength(1);
    expect(rc[0].text).toBe("Receipt: you paid $16.00 for what you owed: Ana Silva's written answers, the team's decision on Ana Silva's dispute and Ana Silva's work");
    expect(st.made).toHaveLength(1);
    expect(await hold(w.dev.user.id)).toBeNull();
    // A second Confirm (another tab) never pays it again.
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).not.toBe(500);
    expect(await receipts(w.dev.user.id)).toHaveLength(1);
  });

  it("a daily retry the bank asks about is ONE 'Confirm with your bank' item listing every payment it covers", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    expect(await retryOwed(w.dev.user.id)).toMatchObject({ cents: 0 });
    expect(st.made).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ status: "needs_confirmation", amountCents: 1600 });
    const items = await confirmItems(w.dev.user.id);
    expect(items).toEqual([{ id: one.id, href: null, text: expect.stringMatching(/^What you owe \$16\.00 \(Ana Silva's written answers \$8\.00, the team's decision on Ana Silva's dispute \$3\.00, Ana Silva's work \$5\.00\) · confirm by /) }]);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { startsWith: "Your bank wants you to confirm a $16.00 payment by " } } })).toBe(1);
  });
});

describe("§117 rule 1: one card in play", () => {
  async function newCard(w: { dev: { user: { id: string } }; customer: string }, st: ReturnType<typeof bank>, pm: string) {
    st.card.customer = w.customer;
    st.card.next = pm;
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
  }

  /** A tester's Charge made while the developer was away, waiting for their bank on the old card. */
  async function awayCharge(w: Awaited<ReturnType<typeof world>>, st: ReturnType<typeof bank>) {
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "requires_action");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    return { p, pi };
  }

  it("a new charge waiting on the old card: cancelled at Stripe and charged again on the new card: goes through -> paid", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCharge(w, st);
    await newCard(w, st, "pm_new");
    expect(st.cancelled).toEqual([pi]);
    expect(st.made).toHaveLength(1);
    expect(st.made[0]).toMatchObject({ amount: 1000, payment_method: "pm_new", off_session: true });
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged", actionPi: null, settledAt: expect.any(Date) });
    expect(await confirmItems(w.dev.user.id)).toEqual([]);
  });

  it("... the bank asks on the new card -> a new 'Confirm with your bank' item on the new card (3 days); Confirm uses the current card", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCharge(w, st);
    st.ask.add("pm_new");
    await newCard(w, st, "pm_new");
    expect(st.cancelled).toEqual([pi]);
    // (§122) Retried (with any other waiting charges) as ONE payment on the new card: its check is the one new item; the charge waits under it.
    const now = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(now).toMatchObject({ status: "deferred", actionPi: null });
    const one = await db.payment.findUniqueOrThrow({ where: { id: now.coveredById! } });
    expect(one).toMatchObject({ kind: "owed", status: "needs_confirmation" });
    expect(one.actionPi).not.toBe(pi);
    expect(one.actionBy!.getTime()).toBeGreaterThan(Date.now() + 2.9 * DAY);
    expect(st.made[0]).toMatchObject({ payment_method: "pm_new" });
    expect((await confirmItems(w.dev.user.id)).map((i) => i.id)).toEqual([one.id]);
  });

  it("... declined on the new card -> it becomes a debt (a payment hold)", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCharge(w, st);
    st.decline.add("pm_new");
    await newCard(w, st, "pm_new");
    expect(st.cancelled).toEqual([pi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "failed", actionPi: null });
    expect(await hold(w.dev.user.id)).not.toBeNull();
    expect((await owed(w.dev.user.id)).map((x) => x.id)).toEqual([p.id]);
  });

  it("... an old check that had already gone through is recorded as paid: nothing is charged again", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCharge(w, st);
    st.approve(pi);
    await newCard(w, st, "pm_new");
    expect(st.made).toHaveLength(0);
    expect(st.cancelled).toEqual([]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: pi, actionPi: null });
  });

  it("debts waiting under a check: the check is cancelled and what's owed is charged again on the new card as one payment", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const old = await oneOf(w.dev.user.id);
    expect(old.status).toBe("needs_confirmation");
    await newCard(w, st, "pm_new");
    expect(st.cancelled).toEqual([old.actionPi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect(st.made.map((m) => [m.amount, m.payment_method])).toEqual([[1600, "pm_old"], [1600, "pm_new"]]);
    const fresh = await oneOf(w.dev.user.id);
    expect(fresh.id).not.toBe(old.id);
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", coveredById: fresh.id });
    expect(await hold(w.dev.user.id)).toBeNull();
  });

  it("Confirm with your bank on a check made on another card confirms it on the current card", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCharge(w, st);
    const confirmed: { id: string; pm?: string }[] = [];
    const s = (await import("@/lib/server/stripe")).getStripe();
    s.paymentIntents.retrieve = (async (id: string) => ({ id, status: "requires_action", client_secret: "x", payment_method: "pm_older", next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://bank.example/check" } } })) as never;
    s.paymentIntents.confirm = (async (id: string, x: { payment_method?: string }) => { confirmed.push({ id, pm: x.payment_method }); return { id, status: "requires_action", client_secret: "x", next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://bank.example/new" } } }; }) as never;
    const r = await confirm(w.dev.cookie, { paymentId: p.id, start: true });
    expect(r.status).toBe(200);
    expect(confirmed).toEqual([{ id: pi, pm: "pm_old" }]);
    expect(r.body.checkUrl).toBe("https://bank.example/new");
  });
});

describe("§117 rule 2: a declined Confirm keeps waiting until its date", () => {
  it("the card is declined on Confirm: nothing charged, still waiting (no debt, no hold); past its date the check is cancelled at Stripe and it becomes a debt", async () => {
    const w = await world();
    const st = bank();
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "requires_payment_method");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    st.decline.add("pm_old");
    const r = await confirm(w.dev.cookie, { paymentId: p.id, start: true });
    expect(r.status).toBe(402);
    expect(r.body.error.message).toMatch(/^Your card was declined, so nothing was charged\. Change your card and confirm again by /);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "needs_confirmation", actionPi: pi });
    expect(await hold(w.dev.user.id)).toBeNull();
    await db.payment.update({ where: { id: p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(st.cancelled).toEqual([pi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "failed", actionPi: null });
    expect(await hold(w.dev.user.id)).not.toBeNull();
  });
});

describe("§117 rule 3: a debt waiting for the bank is locked", () => {
  it("skipped by a press and by the daily retry (other debts are paid); Cancel this check cancels it at Stripe and it's payable at once", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    // A tester's Charge added meanwhile: the only thing a press pays.
    const extra = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 200, feeCents: 0, testerCents: 0, status: "owed" } });
    st.ask.delete("pm_old");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.filter((l) => l.retry).map((l) => l.id)).toEqual([extra.id]);
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 200, seenIds: [extra.id] });
    expect(r.status).toBe(200);
    expect(st.made.map((m) => m.amount)).toEqual([1600, 200]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: extra.id } })).toMatchObject({ status: "charged" });
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: d.status, coveredById: one.id, settledAt: null });
    // Everything left waits for the bank: a press says so and charges nothing; the daily retry leaves it alone.
    const all = await owedPress(w.dev.cookie, { seenTotalCents: 0, seenIds: [] });
    expect(all.body.error).toMatchObject({ code: "bank_waiting", message: R.OWED_ALL_WAITING });
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdRetryAt: new Date(Date.now() - 2 * DAY) } });
    expect(await retryOwed(w.dev.user.id)).toBeNull();
    expect(st.made).toHaveLength(2);
    // Cancel this check: cancelled at Stripe; the three are payable again and one press pays them as one payment.
    const c = await owedPress(w.dev.cookie, { cancelCheck: one.id });
    expect(c.body).toMatchObject({ cancelled: true, line: R.CHECK_CANCELLED });
    expect(st.cancelled).toEqual([one.actionPi]);
    expect((await owedLines(w.dev.user.id)).every((l) => l.retry && !l.waiting)).toBe(true);
    const p = await owedPress(w.dev.cookie, { seenTotalCents: 1600, seenIds: w.debts.map((d) => d.id) });
    expect(p.body).toMatchObject({ paid: 3, lifted: true });
    expect(st.made.map((m) => m.amount)).toEqual([1600, 200, 1600]);
    // A second Cancel (another tab) is refused plainly.
    expect((await owedPress(w.dev.cookie, { cancelCheck: one.id })).body.error.code).toBe("no_check");
  });

  it("Cancel this check on a check the bank had already confirmed records it as paid (nothing charged again)", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    st.approve(one.actionPi!);
    const c = await owedPress(w.dev.cookie, { cancelCheck: one.id });
    expect(c.body).toMatchObject({ paid: true, line: R.CHECK_ALREADY_PAID });
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", coveredById: one.id });
    expect(st.made).toHaveLength(1);
    expect(await hold(w.dev.user.id)).toBeNull();
  });

  it("the same during a chargeback hold: Pay what you owe's reservation leaves a waiting debt out", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    const extra = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 200, feeCents: 0, testerCents: 0, status: "owed" } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdReason: "chargeback", chargebackCardVerifiedAt: new Date() } });
    st.ask.delete("pm_old");
    const r = await payOwed(w.dev.user, {});
    expect(r).toMatchObject({ reservedCents: 200 });
    const res = await db.reservation.findFirstOrThrow({ where: { developerId: w.dev.user.id } });
    expect(res.covers).toEqual([extra.id]);
    expect(one.id).toBeTruthy();
  });
});

describe("§117 rule 4: never an orphan check", () => {
  it("an expired check is cancelled at Stripe; what it covered stays owed and payable", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    await db.payment.update({ where: { id: one.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(st.cancelled).toEqual([one.actionPi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect((await owedLines(w.dev.user.id)).map((l) => [l.id, l.retry])).toEqual(w.debts.map((d) => [d.id, true]));
  });

  it("one that had already gone through is recorded as paid, with no second charge (and no later retry charges it)", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    st.approve(one.actionPi!);
    await db.payment.update({ where: { id: one.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(st.cancelled).toEqual([]);
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: one.actionPi });
    expect(await hold(w.dev.user.id)).toBeNull();
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date() } });
    expect(await retryOwed(w.dev.user.id)).toBeNull();
    expect(st.made).toHaveLength(1);
    expect(await receipts(w.dev.user.id)).toHaveLength(1);
  });

  it("a tester's Charge waiting past its date that had already gone through is paid, not a debt", async () => {
    const w = await world();
    const st = bank();
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "succeeded");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    await db.payment.update({ where: { id: p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: pi });
    expect(await hold(w.dev.user.id)).toBeNull();
  });
});

describe("§117 rule 5: a press and a check finishing at the same moment charge once", () => {
  it("Confirm and Pay what you owe together: the debts are paid once, by the check; the press charges nothing", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    st.approve(one.actionPi!);
    st.ask.delete("pm_old");
    const [c, p] = await Promise.all([confirm(w.dev.cookie, { paymentId: one.id }), owedPress(w.dev.cookie, { seenTotalCents: 1600, seenIds: w.debts.map((d) => d.id), confirmed: true })]);
    expect(c.status).toBe(200);
    expect([200, 409]).toContain(p.status);
    expect(st.made).toHaveLength(1);
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", coveredById: one.id });
    expect(await receipts(w.dev.user.id)).toHaveLength(1);
  });

  it("the clock and Confirm together: finished once", async () => {
    const w = await threeDebts();
    const st = bank();
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    st.approve(one.actionPi!);
    await db.payment.update({ where: { id: one.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await Promise.all([expireActions(), confirm(w.dev.cookie, { paymentId: one.id }).catch(() => null)]);
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged" });
    expect(st.made).toHaveLength(1);
    expect(st.transfers).toHaveLength(3);
    expect(await receipts(w.dev.user.id)).toHaveLength(1);
  });

  it("the claim re-checks each debt: one paid or locked meanwhile is never charged", async () => {
    const w = await threeDebts();
    bank();
    const once = await import("@/lib/server/owedOnce");
    const rows = await owed(w.dev.user.id);
    await db.payment.update({ where: { id: w.debts[0].id }, data: { status: "charged", settledAt: new Date() } });
    expect(await once.chargeOwedTotal(w.dev.user as never, rows, "away")).toEqual({ result: "skipped" });
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, kind: "owed" } })).toBe(0);
  });
});

describe("§117 with §113: new charges during a hold wait for the lift", () => {
  async function awayCheck(w: Awaited<ReturnType<typeof world>>, st: ReturnType<typeof bank>) {
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "requires_action");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    return { p, pi };
  }

  it("a check made before the hold that runs out during it: cancelled at Stripe and waits for the lift (never added to Pay what you owe); the lift charges it on the card in use then", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCheck(w, st);
    const debt = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 400, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(w.dev.user.id, "unpaid");
    await db.payment.update({ where: { id: p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(st.cancelled).toEqual([pi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "deferred", actionPi: null });
    expect((await owed(w.dev.user.id)).map((x) => x.id)).toEqual([debt.id]);
    // A new card during the hold: it keeps waiting (not charged now); what's owed is one payment on the new card; the lift then charges the waiting one on that card.
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.made.map((m) => [m.amount, m.payment_method])).toEqual([[400, "pm_new"], [1000, "pm_new"]]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
    expect(await hold(w.dev.user.id)).toBeNull();
  });

  it("a new card during a hold cancels a waiting check made while away and leaves that charge waiting for the lift", async () => {
    const w = await world();
    const st = bank();
    const { p, pi } = await awayCheck(w, st);
    await startHold(w.dev.user.id, "unpaid");
    await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 400, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    st.decline.add("pm_new");
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.cancelled).toEqual([pi]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "deferred", actionPi: null });
    expect(st.made.map((m) => m.amount)).toEqual([400]); // only what's owed was tried (declined); the waiting charge waits
    expect(await hold(w.dev.user.id)).not.toBeNull();
  });
});

describe("§117: a bank dispute on Pay what you owe's one payment", () => {
  it("brings back the WHOLE disputed amount once, with one chargeback fee, on one chargeback hold; a second notice changes nothing", async () => {
    const w = await threeDebts();
    const st = bank();
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 1600, seenIds: w.debts.map((d) => d.id) });
    expect(r.body).toMatchObject({ paid: 3, lifted: true });
    const one = await oneOf(w.dev.user.id);
    expect(one.status).toBe(OWED_PAID);
    const { chargebackOpened } = await import("@/lib/server/holds");
    expect(await chargebackOpened(one.stripePaymentIntentId!)).toBe(true);
    expect(await chargebackOpened(one.stripePaymentIntentId!)).toBe(false);
    const u = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    expect(u.holdStartedAt).not.toBeNull();
    expect(u.holdReason).toBe("chargeback");
    const now = await owed(w.dev.user.id);
    expect(now.map((x) => [x.id, x.amountCents])).toEqual([[one.id, 1600 + R.CHARGEBACK_FEE_CENTS]]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, chargeback: "open" } })).toBe(1);
    // The debts it paid stay paid (the tester keeps their share); only the one payment is reversed.
    for (const d of w.debts) expect(await db.payment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "charged", chargeback: "" });
    // Pay what you owe (after the card check) reserves that amount once.
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 1600 + R.CHARGEBACK_FEE_CENTS });
    expect(st.made.map((m) => m.amount)).toEqual([1600, 1600 + R.CHARGEBACK_FEE_CENTS]);
  });
});

describe("§122: after a lift, a card that asks the bank gives a confirm, not a debt", () => {
  /** A payment hold with one debt and `n` charges waiting for the lift (a tester's Charge each, made during the hold). */
  async function waitingAfterHold(n = 1) {
    const w = await world();
    const debt = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 400, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(w.dev.user.id, "unpaid");
    const waiting = [];
    for (let i = 0; i < n; i++) waiting.push(await db.payment.create({ data: { kind: "review", ...(i === 0 ? { submissionId: w.sub.id } : {}), contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000 + 100 * i, feeCents: 0, testerCents: 0, status: "deferred" } }));
    return { ...w, debt, waiting };
  }
  const press = (w: { dev: { cookie: string } }, cents: number, ids: string[]) => owedPress(w.dev.cookie, { seenTotalCents: cents, seenIds: ids });

  it("the one classifier: authentication asks are never declines; real declines are", async () => {
    const { wantsAuth, isCardError } = await import("@/lib/server/stripe");
    expect(wantsAuth({ type: "StripeCardError", code: "authentication_required" })).toBe(true);
    expect(wantsAuth({ type: "StripeCardError", code: "payment_intent_payment_attempt_failed" })).toBe(true);
    expect(wantsAuth({ type: "StripeCardError", code: "payment_intent_authentication_failure" })).toBe(true);
    expect(wantsAuth({ type: "StripeCardError", code: "card_declined", decline_code: "authentication_required" })).toBe(true);
    expect(wantsAuth({ raw: { payment_intent: { status: "requires_payment_method", last_payment_error: { code: "payment_intent_payment_attempt_failed" } } } })).toBe(true);
    expect(wantsAuth({ type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds" })).toBe(false);
    expect(wantsAuth({ type: "StripeCardError", code: "payment_intent_payment_attempt_failed", decline_code: "do_not_honor" })).toBe(false);
    expect(isCardError({ type: "StripeCardError", code: "payment_intent_payment_attempt_failed" })).toBe(false);
    expect(isCardError({ type: "StripeCardError", code: "card_declined" })).toBe(true);
  });

  it("a card that asks the bank (like 3184): the waiting charges after the lift are ONE 'Confirm with your bank' item, never a debt; the hold stays lifted", async () => {
    const w = await waitingAfterHold(1);
    const st = bank();
    st.attempt.add("pm_old");
    const r = await press(w, 400, [w.debt.id]);
    expect(r.body).toMatchObject({ lifted: true });
    expect(st.made.map((m) => m.amount)).toEqual([400, 1000]);
    const p = await db.payment.findUniqueOrThrow({ where: { id: w.waiting[0].id } });
    expect(p).toMatchObject({ status: "deferred", owedUntil: null });
    const one = await db.payment.findUniqueOrThrow({ where: { id: p.coveredById! } });
    expect(one).toMatchObject({ kind: "owed", status: "needs_confirmation" });
    expect(one.actionBy!.getTime()).toBeGreaterThan(Date.now() + 2.9 * DAY);
    expect((await confirmItems(w.dev.user.id)).map((i) => i.id)).toEqual([one.id]);
    expect(await owed(w.dev.user.id)).toEqual([]);
    expect(await hold(w.dev.user.id)).toBeNull();
    // Confirmed with the bank: paid, the tester's share from that payment.
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged", coveredById: one.id });
  });

  it("a real decline after the lift: each waiting charge becomes a debt (a new hold)", async () => {
    const w = await waitingAfterHold(2);
    const st = bank();
    st.decline.add("pm_old");
    // Pay what you owe itself goes through on another (one-off) card, then the card declines the waiting charges.
    const pm = await db.user.update({ where: { id: w.dev.user.id }, data: { stripePaymentMethodId: "pm_ok" } });
    expect(pm).toBeTruthy();
    const pis = (await import("@/lib/server/stripe")).getStripe().paymentIntents as unknown as { create: (p: Record<string, unknown>) => Promise<unknown> };
    const create = pis.create;
    pis.create = async (p) => (p.amount === 400 ? create(p) : create({ ...p, payment_method: "pm_old" }));
    await press(w, 400, [w.debt.id]);
    expect(st.made.map((m) => m.amount)).toEqual([400, 2100]);
    for (const x of w.waiting) expect(await db.payment.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ status: "failed", owedUntil: expect.any(Date), coveredById: null });
    expect(await hold(w.dev.user.id)).not.toBeNull();
  });

  it("any other Stripe error after the lift: the waiting charges stay waiting (never a debt), and are made later", async () => {
    const w = await waitingAfterHold(2);
    const st = bank();
    const pis = (await import("@/lib/server/stripe")).getStripe().paymentIntents as unknown as { create: (p: Record<string, unknown>) => Promise<unknown> };
    const create = pis.create;
    pis.create = async (p) => (p.amount === 400 ? create(p) : create({ ...p, payment_method: "pm_broken" }));
    st.broken.add("pm_broken");
    await press(w, 400, [w.debt.id]);
    for (const x of w.waiting) expect(await db.payment.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ status: "deferred", coveredById: null, owedUntil: null });
    expect(await hold(w.dev.user.id)).toBeNull();
    expect(await owed(w.dev.user.id)).toEqual([]);
    // Stripe is fine again: the next drain makes them as one payment.
    st.broken.clear();
    pis.create = create;
    await (await import("@/lib/server/holds")).chargeDeferred(w.dev.user.id);
    for (const x of w.waiting) expect(await db.payment.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ status: "charged" });
  });

  it("a hold restarting while the after-lift run goes on: every charge not yet made keeps waiting", async () => {
    const w = await waitingAfterHold(2);
    const st = bank();
    // A reversed payment owed again waits too (made first, on its own) and is declined: a chargeback hold starts.
    const orig = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 300, feeCents: 0, testerCents: 0, status: "charged", chargeback: "resolved" } });
    await db.payment.create({ data: { kind: "chargeback", repaysId: orig.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 300, feeCents: 300, testerCents: 0, transferStatus: "none", status: "deferred", createdAt: new Date(Date.now() - DAY) } });
    const pis = (await import("@/lib/server/stripe")).getStripe().paymentIntents as unknown as { create: (p: Record<string, unknown>) => Promise<unknown> };
    const create = pis.create;
    pis.create = async (p) => (p.amount === 300 ? create({ ...p, payment_method: "pm_dead" }) : create(p));
    st.decline.add("pm_dead");
    await press(w, 400, [w.debt.id]);
    expect(await hold(w.dev.user.id)).not.toBeNull();
    expect(st.made.map((m) => m.amount)).toEqual([400, 300]);
    for (const x of w.waiting) expect(await db.payment.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ status: "deferred", coveredById: null });
  });

  it("a new card with three charges waiting: ONE Stripe payment for all three; the bank asks -> ONE confirm item listing each", async () => {
    const w = await world();
    const st = bank();
    const items = [];
    for (let i = 0; i < 3; i++) {
      const p = await db.payment.create({ data: { kind: i === 1 ? "dispute" : "review", ...(i === 0 ? { submissionId: w.sub.id } : {}), contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000 + 100 * i, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
      const pi = "pi_" + randomUUID();
      st.pis.set(pi, "requires_action");
      await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
      items.push({ p, pi });
    }
    st.attempt.add("pm_new");
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.cancelled.sort()).toEqual(items.map((x) => x.pi).sort());
    expect(st.made.map((m) => [m.amount, m.payment_method])).toEqual([[3300, "pm_new"]]);
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ status: "needs_confirmation", amountCents: 3300 });
    for (const x of items) expect(await db.payment.findUniqueOrThrow({ where: { id: x.p.id } })).toMatchObject({ status: "deferred", coveredById: one.id });
    expect(await confirmItems(w.dev.user.id)).toEqual([{ id: one.id, href: null, text: expect.stringMatching(/^Charges made while you were away \$33\.00 \(Ana Silva's written answers \$10\.00, the team's decision on Ana Silva's dispute \$11\.00, Ana Silva's work \$12\.00\) · confirm by /) }]);
    expect(await hold(w.dev.user.id)).toBeNull();
    // Approved: all three paid by it, each tester's share sent from that one payment, one receipt.
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    for (const x of items) expect(await db.payment.findUniqueOrThrow({ where: { id: x.p.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: one.actionPi });
    expect(st.transfers.map((t) => t.source_transaction)).toEqual(Array(3).fill(one.actionPi!.replace(/^pi_/, "ch_")));
    expect(await receipts(w.dev.user.id)).toHaveLength(1);
    // Disputed: the whole $33.00 owed once with ONE fee, one chargeback hold.
    const { chargebackOpened } = await import("@/lib/server/holds");
    expect(await chargebackOpened(one.actionPi!)).toBe(true);
    expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents])).toEqual([[one.id, 3300 + R.CHARGEBACK_FEE_CENTS]]);
    expect((await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } })).holdReason).toBe("chargeback");
  });

  it("a new card with three charges waiting, card goes through: one payment, all three paid", async () => {
    const w = await world();
    const st = bank();
    for (let i = 0; i < 3; i++) {
      const p = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
      const pi = "pi_" + randomUUID();
      st.pis.set(pi, "requires_action");
      await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    }
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.made.map((m) => m.amount)).toEqual([1500]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, kind: "review", status: "charged" } })).toBe(3);
  });
});

describe("§122: a hold starting pauses the charges still waiting for the bank", () => {
  it("3 confirms up; one becomes a debt (the hold starts); the other two are cancelled at Stripe and wait for the lift; an old tab's Confirm is refused; the lift makes them as one payment", async () => {
    const w = await world();
    const st = bank();
    const items = [];
    for (let i = 0; i < 3; i++) {
      const p = await db.payment.create({ data: { kind: "review", ...(i === 0 ? { submissionId: w.sub.id } : {}), contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000 + 100 * i, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
      const pi = "pi_" + randomUUID();
      st.pis.set(pi, "requires_action");
      await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
      items.push({ p, pi });
    }
    expect(await confirmItems(w.dev.user.id)).toHaveLength(3);
    // The first one's 3 days run out: it becomes a debt and the hold starts.
    await db.payment.update({ where: { id: items[0].p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions(new Date(), { submissionId: w.sub.id });
    expect(await db.payment.findUniqueOrThrow({ where: { id: items[0].p.id } })).toMatchObject({ status: "failed" });
    expect(await hold(w.dev.user.id)).not.toBeNull();
    // The other two: paused (checks cancelled at Stripe), waiting for the lift, no longer to confirm.
    expect(st.cancelled.sort()).toEqual(items.map((x) => x.pi).sort());
    for (const x of items.slice(1)) expect(await db.payment.findUniqueOrThrow({ where: { id: x.p.id } })).toMatchObject({ status: "deferred", actionPi: null, owedUntil: null });
    expect(await confirmItems(w.dev.user.id)).toEqual([]);
    const { deferredForBox } = await import("@/lib/server/holds");
    expect((await deferredForBox(w.dev.user.id)).map((d) => d.id)).toEqual(items.slice(1).map((x) => x.p.id));
    // An old tab's Confirm with your bank on one: refused, nothing charged.
    const start = await confirm(w.dev.cookie, { paymentId: items[1].p.id, start: true });
    expect(start.body.error).toMatchObject({ code: "paused", message: "This payment is paused until your tests resume." });
    const fin = await confirm(w.dev.cookie, { paymentId: items[1].p.id });
    expect(fin.body.error).toMatchObject({ code: "paused" });
    expect(st.made).toHaveLength(0);
    // Pay what you owe ($10.00) lifts the hold; the two waiting charges are then made as ONE payment.
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 1000, seenIds: [items[0].p.id] });
    expect(r.body).toMatchObject({ lifted: true });
    expect(st.made.map((m) => m.amount)).toEqual([1000, 2300]);
    for (const x of items) expect(await db.payment.findUniqueOrThrow({ where: { id: x.p.id } })).toMatchObject({ status: "charged" });
  });

  it("a paused check that had already gone through at Stripe is recorded as paid, not paused", async () => {
    const w = await world();
    const st = bank();
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "succeeded");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
    await startHold(w.dev.user.id, "unpaid");
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: pi });
    expect(st.made).toHaveLength(0);
  });
});
