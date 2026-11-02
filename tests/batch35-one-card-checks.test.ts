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
  const ask = new Set<string>(), decline = new Set<string>();
  const card = { customer: "", next: "" };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; payment_method?: string; off_session?: boolean; capture_method?: string }) => {
        made.push(p);
        const id = "pi_" + randomUUID();
        if (decline.has(p.payment_method ?? "")) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
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
  return { pis, made, cancelled, transfers, ask, decline, card, approve: (id: string) => pis.set(id, "succeeded") };
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
    const now = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(now.status).toBe("needs_confirmation");
    expect(now.actionPi).not.toBe(pi);
    expect(now.actionPi).not.toBeNull();
    expect(now.actionBy!.getTime()).toBeGreaterThan(Date.now() + 2.9 * DAY);
    expect(st.made[0]).toMatchObject({ payment_method: "pm_new" });
    expect((await confirmItems(w.dev.user.id)).map((i) => i.id)).toEqual([p.id]);
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
