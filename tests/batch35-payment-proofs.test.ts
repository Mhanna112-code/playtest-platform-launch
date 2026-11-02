import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import * as R from "@/lib/rules";
import { chargeDeferred, chargebackOpened, deferredForBox, declinedPayment, liftHoldIfClear, owed, owedLines, payOwed, retryOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { awayAction, confirmItems, expireActions } from "@/lib/server/confirm";
import { saveCardFromCheckout, setStripeForTests } from "@/lib/server/stripe";
import { OWED_PAID } from "@/lib/server/owedOnce";
import { json, req } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Nov 2, payments proof) One test per recorded scenario (docs/media/payments-proof/README.md): A pause on hold, B approve vs cancel race, C chargebacks on Pay what
// you owe and on the after-lift combined payment, D (owner, §125) one payment for the debt AND the waiting charges, then a chargeback, E the five double-charge cases,
// plus (§125) the whole box locked while the one payment's check is open, and a decline and a chargeback landing at the same moment. Every case ends with ONE
// successful charge at the fake Stripe for each thing paid.

const DAY = 86_400_000;
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in that remembers each PaymentIntent (as batch35-one-card-checks): `ask` cards make the bank ask; a cancel refuses one that already went through. */
function bank() {
  const pis = new Map<string, string>();
  const amounts = new Map<string, number>();
  const made: { id: string; amount: number; payment_method?: string; off_session?: boolean; capture_method?: string }[] = [];
  const cancelled: string[] = [];
  const captured: number[] = [];
  const ask = new Set<string>(), decline = new Set<string>();
  const card = { customer: "", next: "", user: "" };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; payment_method?: string; off_session?: boolean; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        made.push({ id, ...p });
        amounts.set(id, p.amount);
        if (decline.has(p.payment_method ?? "")) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        if (ask.has(p.payment_method ?? "")) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret` };
        }
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
      capture: async (id: string, p: { amount_to_capture: number }) => { captured.push(p.amount_to_capture); pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
      confirm: async (id: string, p: { payment_method?: string }) => ({ id, status: "requires_action", client_secret: `${id}_secret`, payment_method: p.payment_method }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    checkout: { sessions: { retrieve: async () => ({ customer: card.customer, setup_intent: { payment_method: card.next } }) } },
    customers: { update: async () => ({}) },
    setupIntents: { retrieve: async (id: string) => ({ id, status: "succeeded", created: Math.floor(Date.now() / 1000), customer: card.customer, metadata: { userId: card.user, purpose: "chargeback-verify" }, payment_method: card.next, latest_attempt: null }) },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: id.slice(-4), exp_month: 12, exp_year: 2030 } }) },
  } as unknown as Stripe);
  /** Every PaymentIntent that took money (succeeded), with its amount. */
  const succeeded = () => [...pis.entries()].filter(([, s]) => s === "succeeded").map(([id]) => amounts.get(id) ?? 0);
  return { pis, amounts, made, cancelled, captured, ask, decline, card, succeeded, approve: (id: string) => pis.set(id, "succeeded") };
}

/** A developer with three testers' written answers sent, a saved card ("pm_old"), testers ready for payouts. */
async function world() {
  const s = await setup();
  const subs = [];
  for (const name of ["Ana Silva", "Ben Okafor", "Cid Moreau"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
    subs.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  const customer = "cus_" + randomUUID();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: customer, stripePaymentMethodId: "pm_old" } });
  return { ...s, t: subs, customer };
}
type W = Awaited<ReturnType<typeof world>>;
const base = (w: W, i: number) => ({ contractId: w.t[i].sessionId, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, feeCents: 0, testerCents: 0 });
/** A tester's Charge made while the developer was away that the bank wants confirmed (3 days). */
async function awayCheck(w: W, st: ReturnType<typeof bank>, i: number, cents = 1000) {
  const p = await db.payment.create({ data: { ...base(w, i), kind: "review", submissionId: w.t[i].sub.id, amountCents: cents, status: "needs_confirmation" } });
  const pi = "pi_" + randomUUID();
  st.pis.set(pi, "requires_action");
  st.amounts.set(pi, cents);
  await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" });
  return { p, pi };
}
const debt = (w: W, i: number, cents: number) => db.payment.create({ data: { ...base(w, i), kind: "review", amountCents: cents, status: "failed", owedUntil: new Date() } });
const waiting = (w: W, i: number, cents: number) => db.payment.create({ data: { ...base(w, i), kind: "review", amountCents: cents, status: "deferred" } });
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const press = (cookie: string, body: Record<string, unknown> = {}) => owedPOST(req("/api/payments/owed", { cookie, body })).then(json);
const devOf = (w: W) => db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
const oneOf = (devId: string) => db.payment.findFirstOrThrow({ where: { developerId: devId, kind: "owed" }, orderBy: { createdAt: "desc" } });
const statusOf = (id: string) => db.payment.findUniqueOrThrow({ where: { id } }).then((p) => p.status);

describe("A. pause on hold (3184-like card)", () => {
  it("three confirms up; one runs out -> a debt and a hold; the other two are cancelled at Stripe and wait; an old tab's Confirm is refused and charges nothing", async () => {
    const w = await world();
    const st = bank();
    const c = [await awayCheck(w, st, 0), await awayCheck(w, st, 1), await awayCheck(w, st, 2)];
    expect(await confirmItems(w.dev.user.id)).toHaveLength(3);
    await db.payment.update({ where: { id: c[0].p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(await statusOf(c[0].p.id)).toBe("failed");
    const dev = await devOf(w);
    expect(dev.holdStartedAt).not.toBeNull();
    expect(dev.holdReason).toBe("unpaid");
    expect(st.cancelled.sort()).toEqual(c.map((x) => x.pi).sort());
    for (const x of c.slice(1)) expect(await db.payment.findUniqueOrThrow({ where: { id: x.p.id } })).toMatchObject({ status: "deferred", actionPi: null });
    expect(await confirmItems(w.dev.user.id)).toEqual([]);
    const made = st.made.length;
    for (const body of [{ paymentId: c[1].p.id, start: true }, { paymentId: c[1].p.id }]) {
      const r = await confirm(w.dev.cookie, body);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: "paused", message: "This payment is paused until your tests resume." });
    }
    expect(st.made.length).toBe(made);
    expect(st.succeeded()).toEqual([]);
  });
});

describe("B. approve vs cancel race", () => {
  it("a waiting combined payment approved at the moment a hold starts: exactly one outcome, recorded paid once; one successful charge at Stripe", async () => {
    const w = await world();
    const st = bank();
    await waiting(w, 0, 1000);
    await waiting(w, 1, 1100);
    st.ask.add("pm_old");
    await chargeDeferred(w.dev.user.id); // the combined payment: one "Confirm with your bank" item
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ status: "needs_confirmation", amountCents: 2100 });
    // (Bug seen on video, fixed) the two charges show once, in the combined payment's confirm item, not also under "Charged once your tests resume".
    expect(await deferredForBox(w.dev.user.id)).toEqual([]);
    expect(await confirmItems(w.dev.user.id)).toHaveLength(1);
    st.approve(one.actionPi!); // the bank says yes …
    const other = await debt(w, 2, 500);
    // … while a decline elsewhere starts a hold (which pauses waiting checks).
    const [fin] = await Promise.all([confirm(w.dev.cookie, { paymentId: one.id }), declinedPayment(w.dev.user.id, other.id, 500, "Cid's work")]);
    expect([200, 404, 409]).toContain(fin.status);
    expect(await statusOf(one.id)).toBe(OWED_PAID);
    expect(await db.payment.count({ where: { coveredById: one.id, status: "charged" } })).toBe(2);
    expect(st.succeeded()).toEqual([2100]);
    expect(st.cancelled).toEqual([]);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { startsWith: "Receipt: you paid" } } })).toBe(1);
  });

  it("not yet approved when the hold starts: cancelled at Stripe and waits; never charged twice", async () => {
    const w = await world();
    const st = bank();
    await waiting(w, 0, 1000);
    st.ask.add("pm_old");
    await chargeDeferred(w.dev.user.id);
    const one = await oneOf(w.dev.user.id);
    await Promise.all([startHold(w.dev.user.id, "unpaid"), confirm(w.dev.cookie, { paymentId: one.id })]);
    expect(await statusOf(one.id)).toBe("cancelled");
    expect(st.cancelled).toEqual([one.stripePaymentIntentId]);
    expect(st.succeeded()).toEqual([]);
  });
});

describe("C. chargebacks on Pay what you owe and on the after-lift combined payment", () => {
  it("one payment approved, a chargeback the same second -> amount + ONE fee; cleared (verify, reservation, Approve); charges added after it -> one combined payment; a second chargeback on it", async () => {
    const w = await world();
    const st = bank();
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    st.ask.add("pm_old");
    const r = await press(w.dev.cookie, {});
    expect(r.body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    st.approve(one.actionPi!);
    const pi = one.actionPi!;
    const [fin, cb] = await Promise.all([confirm(w.dev.cookie, { paymentId: one.id }), chargebackOpened(pi)]);
    expect(fin.status).toBe(200);
    expect([true, false]).toContain(cb);
    if (!cb) expect(await chargebackOpened(pi)).toBe(true); // delivered before the payment was recorded: Stripe retries the webhook
    expect(await chargebackOpened(pi)).toBe(false);
    expect(await statusOf(d.id)).toBe("charged");
    let dev = await devOf(w);
    expect(dev.holdReason).toBe("chargeback");
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([800 + R.CHARGEBACK_FEE_CENTS]);
    // Clear it: card verified, Pay what you owe reserves, the team approves.
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    st.ask.clear();
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 800 + R.CHARGEBACK_FEE_CENTS });
    // Two testers charge after the reservation (they wait; the reservation isn't topped up).
    const a = await waiting(w, 1, 1000), b = await waiting(w, 2, 1100);
    st.ask.add("pm_old");
    expect((await approveChargebackHold(w.dev.user.id)).lifted).toBe(true);
    expect(st.captured).toEqual([800 + R.CHARGEBACK_FEE_CENTS]);
    // After the lift: ONE combined payment for both, one confirm listing each.
    const comb = await oneOf(w.dev.user.id);
    expect(comb).toMatchObject({ status: "needs_confirmation", amountCents: 2100 });
    expect((await confirmItems(w.dev.user.id))[0].text).toMatch(/^Charges made while you were away \$21\.00 \(.*\$10\.00, .*\$11\.00\)/);
    st.approve(comb.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: comb.id })).status).toBe(200);
    expect([await statusOf(a.id), await statusOf(b.id)]).toEqual(["charged", "charged"]);
    expect(await chargebackOpened(comb.actionPi ?? comb.stripePaymentIntentId!)).toBe(true);
    dev = await devOf(w);
    expect(dev.holdReason).toBe("chargeback");
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([2100 + R.CHARGEBACK_FEE_CENTS]);
    // The testers' pieces stay paid; both chargebacks are on record (the first resolved, the second open).
    expect([await statusOf(a.id), await statusOf(b.id), await statusOf(d.id)]).toEqual(["charged", "charged", "charged"]);
    expect((await db.payment.findMany({ where: { developerId: w.dev.user.id, chargeback: { not: "" } }, orderBy: { createdAt: "asc" } })).map((p) => p.chargeback)).toEqual(["resolved", "open"]);
    expect(st.succeeded().sort((x, y) => x - y)).toEqual([800, 800 + R.CHARGEBACK_FEE_CENTS, 2100].sort((x, y) => x - y));
  });
});

describe("D. (§125) one payment for the debt AND the waiting charges, then a chargeback", () => {
  it("Pay what you owe covers the debt and every waiting charge; approved, the hold lifts with nothing left to charge; one chargeback -> one hold, amount + ONE fee; no second payment to dispute", async () => {
    const w = await world();
    const st = bank();
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    const a = await waiting(w, 1, 1000), b = await waiting(w, 2, 1100);
    // The box lists all three, and its total is all three.
    expect((await owedLines(w.dev.user.id)).map((l) => [l.id, l.amountCents, l.retry])).toEqual([[d.id, 800, true], [a.id, 1000, true], [b.id, 1100, true]]);
    st.ask.add("pm_old");
    const r = await press(w.dev.cookie, { seenTotalCents: 2900, seenIds: [d.id, a.id, b.id] });
    expect(r.body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ amountCents: 2900, status: "needs_action" });
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).body).toMatchObject({ done: true, lifted: true });
    for (const id of [d.id, a.id, b.id]) expect(await statusOf(id)).toBe("charged");
    expect((await devOf(w)).holdStartedAt).toBeNull();
    const before = st.made.length;
    await chargeDeferred(w.dev.user.id);
    expect(st.made.length).toBe(before); // nothing left to charge after the lift
    expect(st.succeeded()).toEqual([2900]);
    expect(await chargebackOpened(one.actionPi ?? one.stripePaymentIntentId!)).toBe(true);
    const dev = await devOf(w);
    expect(dev.holdReason).toBe("chargeback");
    expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents])).toEqual([[one.id, 2900 + R.CHARGEBACK_FEE_CENTS]]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, chargeback: "open" } })).toBe(1);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, status: "deferred" } })).toBe(0);
  });

  it("during a CHARGEBACK hold the reservation covers what's owed AND the waiting charges; the team's Approve settles everything in one", async () => {
    const w = await world();
    const st = bank();
    const paid = await db.payment.create({ data: { ...base(w, 0), kind: "review", amountCents: 500, status: "charged", stripePaymentIntentId: "pi_orig_" + randomUUID(), settledAt: new Date() } });
    expect(await chargebackOpened(paid.stripePaymentIntentId!)).toBe(true);
    const a = await waiting(w, 1, 1000);
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 500 + R.CHARGEBACK_FEE_CENTS + 1000 });
    expect((await approveChargebackHold(w.dev.user.id)).lifted).toBe(true);
    expect(st.captured).toEqual([500 + R.CHARGEBACK_FEE_CENTS + 1000]);
    expect(await statusOf(a.id)).toBe("charged");
    expect(st.made.filter((m) => m.capture_method !== "manual")).toEqual([]); // nothing charged after the lift
  });

  it("declined: the debt stays owed and the waiting charges keep waiting (never debts, no second hold)", async () => {
    const w = await world();
    const st = bank();
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    const a = await waiting(w, 1, 1000);
    const count = (await devOf(w)).holdCount;
    st.decline.add("pm_old");
    await payOwed(w.dev.user, {});
    expect(st.made.map((m) => m.amount)).toEqual([1800]);
    expect(await statusOf(d.id)).toBe("failed");
    expect(await db.payment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "deferred", coveredById: null });
    expect((await devOf(w)).holdCount).toBe(count);
  });
});

describe("E. the five double-charge cases: one charge at Stripe each", () => {
  it("1. Pay what you owe pressed in two tabs at once", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await debt(w, 1, 300);
    await startHold(w.dev.user.id, "unpaid");
    const [x, y] = await Promise.all([press(w.dev.cookie, {}), press(w.dev.cookie, {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(st.made.map((m) => m.amount)).toEqual([1100]);
    expect(st.succeeded()).toEqual([1100]);
  });

  it("2. Confirm in one tab while saving a new card in another", async () => {
    const w = await world();
    const st = bank();
    const c = await awayCheck(w, st, 0);
    st.approve(c.pi); // the bank page in tab 1 was completed
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await Promise.all([confirm(w.dev.cookie, { paymentId: c.p.id }), saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID())]);
    expect(await statusOf(c.p.id)).toBe("charged");
    expect(st.made).toEqual([]); // never charged again on the new card
    expect(st.succeeded()).toEqual([1000]);
  });

  it("3. approving a check at the moment its 3 days run out", async () => {
    const w = await world();
    const st = bank();
    const c = await awayCheck(w, st, 0);
    st.approve(c.pi);
    await db.payment.update({ where: { id: c.p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await Promise.all([confirm(w.dev.cookie, { paymentId: c.p.id }), expireActions()]);
    expect(await statusOf(c.p.id)).toBe("charged");
    expect((await devOf(w)).holdStartedAt).toBeNull(); // not a debt
    expect(st.made).toEqual([]);
    expect(st.succeeded()).toEqual([1000]);
  });

  it("4. a daily retry while a check is open (the retry's 3-day item, and the press's 15-minute check)", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id, new Date(), "card"); // a retry the bank asks about: one 3-day item
    const one = await oneOf(w.dev.user.id);
    expect(one.status).toBe("needs_confirmation");
    const n = st.made.length;
    // The daily job's retry step (holds.runDaily calls retryOwed for every held developer; here for this one, so other tests' rows stay out).
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdRetryAt: new Date(Date.now() - 2 * DAY) } });
    expect(await retryOwed(w.dev.user.id, new Date(), "daily")).toBeNull();
    expect(await retryOwed(w.dev.user.id, new Date(Date.now() + 2 * DAY), "daily")).toBeNull();
    expect((await press(w.dev.cookie, {})).body.error).toMatchObject({ code: "bank_waiting" });
    expect(st.made.length).toBe(n);
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    expect(st.succeeded()).toEqual([800]);
  });

  it("5. a chargeback on the one total payment covering several debts: the amount once + one fee", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await debt(w, 1, 300);
    await debt(w, 2, 500);
    await startHold(w.dev.user.id, "unpaid");
    expect((await press(w.dev.cookie, {})).body).toMatchObject({ paid: 3, lifted: true });
    const one = await oneOf(w.dev.user.id);
    expect(await Promise.all([chargebackOpened(one.stripePaymentIntentId!), chargebackOpened(one.stripePaymentIntentId!)])).toEqual(expect.arrayContaining([true, false]));
    expect((await owed(w.dev.user.id)).map((x) => x.amountCents)).toEqual([1600 + R.CHARGEBACK_FEE_CENTS]);
    expect(st.succeeded()).toEqual([1600]);
  });
});

describe("§125: the whole box is locked while the one payment's check is open", () => {
  it("a press's check open: every line waits for the bank; another tab's press and the daily retry charge nothing; Cancel this check unlocks it at once", async () => {
    const w = await world();
    const st = bank();
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    const a = await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    expect((await press(w.dev.cookie, {})).body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(one.status).toBe("needs_action");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => [l.id, l.waiting, l.checkId])).toEqual([[d.id, true, one.id], [a.id, true, one.id]]);
    const n = st.made.length;
    expect((await press(w.dev.cookie, {})).body.error).toMatchObject({ code: "bank_waiting" });
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdRetryAt: null } });
    expect(await retryOwed(w.dev.user.id, new Date(), "daily")).toBeNull();
    expect(st.made.length).toBe(n);
    expect(st.cancelled).toEqual([]);
    // Cancel this check: cancelled at Stripe, the box is payable at once.
    expect((await press(w.dev.cookie, { cancelCheck: one.id })).body).toMatchObject({ cancelled: true });
    expect(st.cancelled).toEqual([one.actionPi]);
    expect((await owedLines(w.dev.user.id)).every((l) => l.retry && !l.waiting)).toBe(true);
    st.ask.clear();
    expect((await press(w.dev.cookie, {})).body).toMatchObject({ lifted: true });
    expect(st.succeeded()).toEqual([1800]);
  });

  it("a press's 15-minute check open: a new card cancels it at Stripe first and pays it once on the new card", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    expect((await press(w.dev.cookie, {})).body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.cancelled).toEqual([one.actionPi]);
    expect(st.made.at(-1)).toMatchObject({ amount: 1800, payment_method: "pm_new" });
    expect(st.succeeded()).toEqual([1800]);
    expect((await devOf(w)).holdStartedAt).toBeNull();
  });

  it("a retry's 3-day check open: a new card cancels it at Stripe first and pays it once on the new card", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id, new Date(), "card");
    const one = await oneOf(w.dev.user.id);
    expect(one).toMatchObject({ status: "needs_confirmation", amountCents: 1800 });
    expect((await press(w.dev.cookie, {})).body.error).toMatchObject({ code: "bank_waiting" });
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID());
    expect(st.cancelled).toEqual([one.actionPi]);
    expect(st.made.at(-1)).toMatchObject({ amount: 1800, payment_method: "pm_new" });
    expect(st.succeeded()).toEqual([1800]);
    expect((await devOf(w)).holdStartedAt).toBeNull();
  });
});

describe("§125: a decline and a chargeback landing at the same moment", () => {
  it("one hold; the declined charge and the chargeback are each owed once; Pay what you owe reserves each once (no double charge)", async () => {
    const w = await world();
    const st = bank();
    const paid = await db.payment.create({ data: { ...base(w, 0), kind: "review", amountCents: 500, status: "charged", stripePaymentIntentId: "pi_orig_" + randomUUID(), settledAt: new Date() } });
    const failing = await db.payment.create({ data: { ...base(w, 1), kind: "review", amountCents: 1000, status: "needs_confirmation" } });
    const count = (await devOf(w)).holdCount;
    await Promise.all([declinedPayment(w.dev.user.id, failing.id, 1000, "Ben's work"), chargebackOpened(paid.stripePaymentIntentId!), chargebackOpened(paid.stripePaymentIntentId!)]);
    const dev = await devOf(w);
    expect(dev.holdCount).toBe(count + 1);
    expect(dev.holdReason).toBe("chargeback");
    expect((await owed(w.dev.user.id)).map((x) => [x.id, x.amountCents]).sort()).toEqual([[failing.id, 1000], [paid.id, 500 + R.CHARGEBACK_FEE_CENTS]].sort());
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    const [r1, r2] = await Promise.all([payOwed(w.dev.user, {}).catch((e) => e), payOwed(w.dev.user, {}).catch((e) => e)]);
    const reserved = [r1, r2].filter((r) => r && typeof r === "object" && "reservedCents" in r);
    expect(reserved.length).toBeGreaterThanOrEqual(1);
    expect(st.made.filter((m) => m.capture_method === "manual").map((m) => m.amount)).toEqual([1500 + R.CHARGEBACK_FEE_CENTS]);
    expect(st.made.filter((m) => m.capture_method !== "manual")).toEqual([]);
  });
});

describe("§125: Pay what you owe's check against a new card, running out, and a charge arriving mid-payment", () => {
  it("approving the one payment's 3-day check at the same moment as saving a new card: one charge at Stripe either way", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id, new Date(), "card");
    const one = await oneOf(w.dev.user.id);
    expect(one.status).toBe("needs_confirmation");
    st.approve(one.actionPi!);
    st.card.customer = w.customer;
    st.card.next = "pm_new";
    await Promise.all([confirm(w.dev.cookie, { paymentId: one.id }), saveCardFromCheckout(w.dev.user.id, "cs_" + randomUUID())]);
    expect(st.succeeded()).toEqual([1800]);
    expect(st.made.filter((m) => m.payment_method === "pm_new")).toEqual([]); // the approval won: nothing on the new card
    expect(await statusOf(one.id)).toBe(OWED_PAID);
    expect((await devOf(w)).holdStartedAt).toBeNull();
  });

  it("the one payment's 3-day check runs out: cancelled at Stripe, nothing charged, debts stay owed, waiting charges keep waiting, the box unlocks and says so plainly", async () => {
    const w = await world();
    const st = bank();
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    const a = await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    await retryOwed(w.dev.user.id, new Date(), "card");
    const one = await oneOf(w.dev.user.id);
    expect((await owedLines(w.dev.user.id)).every((l) => l.waiting)).toBe(true);
    await db.payment.update({ where: { id: one.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(st.cancelled).toEqual([one.actionPi]);
    expect(st.succeeded()).toEqual([]);
    expect(await statusOf(one.id)).toBe("cancelled");
    expect(await statusOf(d.id)).toBe("failed");
    expect(await db.payment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "deferred", coveredById: null });
    expect((await owedLines(w.dev.user.id)).map((l) => [l.retry, l.waiting])).toEqual([[true, false], [true, false]]);
    const { ranOutLine } = await import("@/lib/server/owedOnce");
    expect(await ranOutLine(w.dev.user.id)).toMatch(/^Your bank check ran out on [A-Z][a-z]{2} \d{1,2}: nothing was charged\. Pay again or change your card\.$/);
    // Paid again: the line goes.
    st.ask.clear();
    expect((await press(w.dev.cookie, {})).body).toMatchObject({ lifted: true });
    expect(await ranOutLine(w.dev.user.id)).toBeNull();
    expect(st.succeeded()).toEqual([1800]);
  });

  it("a charge arriving while the one payment is in flight is NOT added to it; it waits, and is charged right after it as one combined payment (nothing lost, no amount change)", async () => {
    const w = await world();
    const st = bank();
    await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    await waiting(w, 1, 1000);
    st.ask.add("pm_old");
    expect((await press(w.dev.cookie, {})).body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(one.amountCents).toBe(1800);
    // A tester charges now (the hold is still on): it waits, outside the one payment.
    const late = await waiting(w, 2, 1100);
    const lines = await owedLines(w.dev.user.id);
    expect(lines.find((l) => l.id === late.id)).toMatchObject({ retry: false, waiting: true, after: "Charged right after the payment above goes through" });
    expect((await press(w.dev.cookie, {})).body.error).toMatchObject({ code: "bank_waiting" });
    expect((await oneOf(w.dev.user.id)).amountCents).toBe(1800);
    st.ask.clear();
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).body).toMatchObject({ lifted: true });
    // Right after the lift: the late charge as its own combined payment (the only way a second payment follows Pay what you owe).
    expect(await statusOf(late.id)).toBe("charged");
    const comb = await oneOf(w.dev.user.id);
    expect(comb).toMatchObject({ amountCents: 1100, status: OWED_PAID });
    expect(comb.note.endsWith(":charges")).toBe(true);
    expect(st.succeeded().sort((x, y) => x - y)).toEqual([1100, 1800]);
  });
});

describe("a hold starting cancels every waiting check; Verify a card then finds nothing left (its cancel is a safety net)", () => {
  it("the hold's start cancels the waiting checks at Stripe at once; Verify a card with no open check changes nothing at Stripe", async () => {
    const w = await world();
    const st = bank();
    const c = [await awayCheck(w, st, 0), await awayCheck(w, st, 1)];
    const paid = await db.payment.create({ data: { ...base(w, 2), kind: "review", amountCents: 500, status: "charged", stripePaymentIntentId: "pi_orig_" + randomUUID(), settledAt: new Date() } });
    expect(await chargebackOpened(paid.stripePaymentIntentId!)).toBe(true);
    expect(st.cancelled.sort()).toEqual(c.map((x) => x.pi).sort()); // at the moment the hold started
    for (const x of c) expect(st.pis.get(x.pi)).toBe("canceled");
    const n = st.cancelled.length, made = st.made.length;
    st.card.customer = w.customer; st.card.next = "pm_verified"; st.card.user = w.dev.user.id;
    const { finishCardVerification } = await import("@/lib/server/chargeback");
    expect(await finishCardVerification(w.dev.user.id, "seti_" + randomUUID())).toEqual({ verified: true });
    expect(st.cancelled.length).toBe(n); // nothing left to cancel
    expect(st.made.length).toBe(made);
  });

  it("Verify a card while Pay what you owe's reservation check is open: that check is cancelled at Stripe (one card in play)", async () => {
    const w = await world();
    const st = bank();
    const paid = await db.payment.create({ data: { ...base(w, 0), kind: "review", amountCents: 500, status: "charged", stripePaymentIntentId: "pi_orig_" + randomUUID(), settledAt: new Date() } });
    await chargebackOpened(paid.stripePaymentIntentId!);
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    st.ask.add("pm_old");
    const r = await payOwed(w.dev.user, {});
    expect(r.confirm).toHaveLength(1);
    const res = await db.reservation.findFirstOrThrow({ where: { developerId: w.dev.user.id } });
    expect(res.status).toBe("needs_action");
    st.card.customer = w.customer; st.card.next = "pm_verified"; st.card.user = w.dev.user.id;
    const { finishCardVerification } = await import("@/lib/server/chargeback");
    await finishCardVerification(w.dev.user.id, "seti_" + randomUUID());
    expect(st.cancelled).toEqual([res.stripePaymentIntentId]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("cancelled");
    // Pay what you owe reserves again, on the verified card, once.
    st.ask.clear();
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 500 + R.CHARGEBACK_FEE_CENTS });
    expect(st.made.filter((m) => m.capture_method === "manual").map((m) => m.payment_method)).toEqual(["pm_old", "pm_verified"]);
  });
});

describe("a chargeback on an OLDER payment while Pay what you owe's press check is open (payment hold -> chargeback hold)", () => {
  async function setupCase() {
    const w = await world();
    const st = bank();
    const old = await db.payment.create({ data: { ...base(w, 2), kind: "review", amountCents: 700, status: "charged", stripePaymentIntentId: "pi_old_" + randomUUID(), settledAt: new Date() } });
    const d = await debt(w, 0, 800);
    await startHold(w.dev.user.id, "unpaid");
    st.ask.add("pm_old");
    const lines = await owedLines(w.dev.user.id);
    const seen = { seenTotalCents: 800, seenIds: lines.map((l) => l.id) };
    expect((await press(w.dev.cookie, seen)).body.confirm).toHaveLength(1);
    const one = await oneOf(w.dev.user.id);
    expect(await chargebackOpened(old.stripePaymentIntentId!)).toBe(true);
    expect((await devOf(w)).holdReason).toBe("chargeback");
    return { w, st, old, d, one, seen };
  }

  it("approving the open check pays exactly what it covered ($8.00); the box then shows the reversed amount + fee under the chargeback steps; no lift", async () => {
    const { w, st, d, one } = await setupCase();
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    expect(await statusOf(d.id)).toBe("charged");
    expect((await db.payment.findUniqueOrThrow({ where: { id: one.id } })).amountCents).toBe(800);
    expect(st.succeeded()).toEqual([800]);
    expect((await owedLines(w.dev.user.id)).map((l) => [l.amountCents, l.retry])).toEqual([[700 + R.CHARGEBACK_FEE_CENTS, true]]);
    const { chargebackSteps } = await import("@/lib/server/chargeback");
    expect(await chargebackSteps(w.dev.user.id)).toMatchObject({ owedCents: 700 + R.CHARGEBACK_FEE_CENTS, cardVerified: false });
    expect((await devOf(w)).holdStartedAt).not.toBeNull();
  });

  it("Verify a card while that check is still open cancels it at Stripe first (nothing charged on either card)", async () => {
    const { w, st, d, one } = await setupCase();
    st.card.customer = w.customer; st.card.next = "pm_verified"; st.card.user = w.dev.user.id;
    const { finishCardVerification } = await import("@/lib/server/chargeback");
    await finishCardVerification(w.dev.user.id, "seti_" + randomUUID());
    expect(st.cancelled).toEqual([one.actionPi]);
    expect(await statusOf(one.id)).toBe("cancelled");
    expect(await statusOf(d.id)).toBe("failed");
    expect(st.succeeded()).toEqual([]);
    expect(st.made.filter((m) => m.payment_method === "pm_verified")).toEqual([]); // the chargeback hold: paid only through Pay what you owe's reservation
  });

  it("a press from a page that hadn't shown the chargeback stops once naming it, never charging a changed amount", async () => {
    const { w, st, one } = await setupCase();
    // The bank declines the open check (cancelled): the old page still shows $8.00.
    expect((await press(w.dev.cookie, { cancelCheck: one.id })).body).toMatchObject({ cancelled: true });
    const n = st.made.length;
    const r = await press(w.dev.cookie, { seenTotalCents: 800, seenIds: [(await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, status: "failed" } })).id] });
    expect(r.body.error.code).toBe("stop_once");
    expect(JSON.stringify(r.body.error)).toContain("Your bank reversed a $7 payment: $7 + $15 chargeback fee");
    expect(st.made.length).toBe(n);
  });
});

describe("an open bank check is never cut off by a hold change", () => {
  it("SessionWatch leaves the page as it is while a bank check is open (a chargeback turning a payment hold into a chargeback hold mid-check)", async () => {
    const { readFileSync } = await import("node:fs");
    const watch = readFileSync("src/components/SessionWatch.tsx", "utf8");
    expect(watch).toMatch(/if \(now !== restrictionRef\.current && bankCheckOpen\(\)\) return;\n\s*if \(now !== restrictionRef\.current\) \{/);
  });
});
