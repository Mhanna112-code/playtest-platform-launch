import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { checkPiOf, finishPayment, refundLineOf } from "@/lib/bankConfirm";
import { ALREADY_CONFIRMED, CONFIRM_CANCELLED, awayAction, finishConfirmed } from "@/lib/server/confirm";
import { chargebackOpened, chargebackWon, payOwed, startHold } from "@/lib/server/holds";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { newCardChecks } from "@/lib/server/owedOnce";
import { refundLines } from "@/lib/server/paymentRows";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §210; recording R10c) The bank approved a press's check, and something else recorded the payment a moment before the window's own finish
// (a chargeback won as the bank approved it, a new chargeback, a hold starting, a new card, …): the finish that sends the window's own PaymentIntent (`pi`) reads as
// paid ("Paid $52.00, thank you"; Pay / Pay more / Confirm's own lines), with the won part's refund said in one more line. The refusal stays for a check finished in
// another tab ("You already confirmed this payment in another tab at 3:20 PM."), a payment paid by another check, and a check cancelled before it went through.
// Nothing is ever recorded or charged twice.

const TAB_A = "tab-A-" + randomUUID();
const TAB_B = "tab-B-" + randomUUID();
const devs: string[] = [];
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; vi.unstubAllGlobals(); });
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up", "refunded"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
  await db.reservation.updateMany({ where: { developerId: { in: devs } }, data: { status: "cancelled" } });
  await db.user.updateMany({ where: { id: { in: devs } }, data: { holdStartedAt: null, holdReason: "" } });
});

type Res = { status: number; body: Record<string, unknown> & { error?: { code?: string; message?: string } } };
/** The window's finish, as the page sends it: its tab, and (§210) its own PaymentIntent. */
const finish = (cookie: string, tab: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": tab }, body })).then(json) as Promise<Res>;
const otherTab = /^You already confirmed this payment in another tab at \d{1,2}:\d{2} [AP]M\.$/;

/** A Stripe stand-in that remembers each PaymentIntent (as batch35-stop-rules-v2's): `ask` makes presses wait for the bank. */
function bank() {
  const pis = new Map<string, string>();
  const st = { pis, ask: false, made: [] as { id: string; amount: number }[], cancelled: [] as string[], refunds: [] as { payment_intent: string; amount: number }[] };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; off_session?: boolean }) => {
        const id = "pi_" + randomUUID();
        st.made.push({ id, amount: p.amount });
        if (st.ask) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } };
        }
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => {
        if (pis.get(id) === "succeeded") return { id, status: "succeeded" };
        st.cancelled.push(id);
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
      capture: async (id: string) => { pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
    },
    refunds: { create: async (p: { payment_intent: string; amount: number }) => { st.refunds.push(p); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
  } as unknown as Stripe);
  return st;
}

/** A developer with a saved card and Ana's and Ben's written answers (the chargeback cases). */
async function cbWorld() {
  const s = await setup();
  devs.push(s.dev.user.id);
  const t: (Awaited<ReturnType<typeof joined>> & { sub: { id: string } })[] = [];
  for (const name of ["Ana Silva", "Ben Okafor"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  const st = bank();
  const paid = (i: number, cents: number) => db.payment.create({ data: { kind: "review", contractId: t[i].sessionId, submissionId: t[i].sub.id, developerId: s.dev.user.id, testerId: t[i].tester.user.id, amountCents: cents, feeCents: cents / 10, testerCents: cents - cents / 10, status: "charged", stripePaymentIntentId: "pi_" + randomUUID() } });
  return { ...s, t, st, paid };
}
type CB = Awaited<ReturnType<typeof cbWorld>>;
/** A review-first account whose team allowed paying: Pay what you owe ($10.00 reversed + $15.00 fee = $25.00) open at the bank, and the window's own `pi`. */
async function owedOpen(w: CB) {
  await db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "charged", chargeback: "resolved", reversedCents: 500, stripePaymentIntentId: "pi_" + randomUUID() } });
  const reversed = await w.paid(0, 1000);
  await chargebackOpened(reversed.stripePaymentIntentId!, null);
  await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  await approveChargebackHold(w.dev.user.id);
  w.st.ask = true;
  const r = (await payOwed(w.dev.user, {})) as { confirm: { paymentId: string; clientSecret: string }[] };
  expect(r.confirm).toHaveLength(1);
  const one = await db.payment.findUniqueOrThrow({ where: { id: r.confirm[0].paymentId } });
  expect(one).toMatchObject({ kind: "owed", status: "needs_action", amountCents: 2500 });
  const pi = checkPiOf(r.confirm[0].clientSecret);
  expect(pi).toBe(one.actionPi);
  return { reversed, one, pi };
}
const repaid = (w: CB) => db.payment.count({ where: { kind: "chargeback", repaysId: { not: null }, developerId: w.dev.user.id, status: { in: ["charged", "refunded"] } } });

describe("§210 (a) Pay what you owe: recorded by something else before the window's finish", () => {
  it("recorded first (as every recorder does it: the check claimed, then finished): the window's finish with its own pi answers paid; nothing twice", async () => {
    const w = await cbWorld();
    const { one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded"); // Complete at the bank
    const made = w.st.made.length;
    expect((await db.payment.updateMany({ where: { id: one.id, actionPi: pi }, data: { actionPi: null } })).count).toBe(1);
    await finishConfirmed(one.id);
    const logs = await db.actionLog.count({ where: { userId: w.dev.user.id } });
    const r = await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ done: true, paid: true, ownCheck: true, status: "charged", amountCents: 2500 });
    expect(refundLineOf(r.body)).toBe("");
    // Nothing recorded or charged again: one repayment, no new charge, no other-tab line written by this answer.
    expect(await repaid(w)).toBe(1);
    expect(w.st.made.length).toBe(made);
    expect(await db.actionLog.count({ where: { userId: w.dev.user.id } })).toBe(logs);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "bundled", stripePaymentIntentId: pi });
    // The same window's finish again (a double end): the same answer, still once.
    expect((await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi })).body).toMatchObject({ done: true, paid: true });
    expect(await repaid(w)).toBe(1);
  });

  it("a new chargeback records it (the bank had approved it, §171 B6 a): the window's finish answers paid", async () => {
    const w = await cbWorld();
    const { one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    const p2 = await w.paid(1, 800);
    await chargebackOpened(p2.stripePaymentIntentId!, null);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "bundled" });
    const r = await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi });
    expect(r.body).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 2500 });
    expect(await repaid(w)).toBe(1);
  });

  it("the finish lands while the recorder is half way (let go of, not recorded yet): it waits for it and answers paid", async () => {
    const w = await cbWorld();
    const { one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    expect((await db.payment.updateMany({ where: { id: one.id, actionPi: pi }, data: { actionPi: null } })).count).toBe(1);
    const late = new Promise((r) => setTimeout(r, 300)).then(() => finishConfirmed(one.id));
    const [r] = await Promise.all([finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi }), late]);
    expect(r.body, JSON.stringify(r.body)).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 2500 });
    expect(await repaid(w)).toBe(1);
  });
});

describe("§210 (b) R10c: a chargeback in it won just after the bank approved it", () => {
  it("recorded paid once by the win's handler and the won part refunded: the window's finish answers paid, with the refund line", async () => {
    const w = await cbWorld();
    const { reversed, one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    expect(await chargebackWon(reversed.stripePaymentIntentId!)).toBe(true);
    expect(w.st.refunds).toEqual([{ payment_intent: pi, amount: 2500 }]);
    const r = await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 2500 });
    const line = "Your bank's chargeback on your $10.00 Pay for Ana Silva's written answers on “Harbor Run” was reversed: $25.00 refunded.";
    expect(refundLineOf(r.body)).toBe(line);
    // The part is named exactly as What you've paid's refund line names it (§192).
    const rep = await db.payment.findFirstOrThrow({ where: { repaysId: reversed.id } });
    const [rl] = (await refundLines([rep])).get(rep.id)!;
    expect(rl.full).toBe("Refunded: your bank's chargeback on your $10.00 Pay for Ana Silva's written answers on “Harbor Run” was reversed in your favour");
    // Charged once, refunded once.
    expect(w.st.made.filter((m) => m.id === pi)).toHaveLength(1);
    expect(w.st.refunds).toHaveLength(1);
    expect(await db.paymentRefund.count({ where: { developerId: w.dev.user.id } })).toBe(1);
  });

  it("won BEFORE the bank approved it (the check cancelled): still CONFIRM_CANCELLED, nothing charged", async () => {
    const w = await cbWorld();
    const { reversed, one, pi } = await owedOpen(w);
    expect(await chargebackWon(reversed.stripePaymentIntentId!)).toBe(true);
    const r = await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi });
    expect([r.status, r.body.error?.message]).toEqual([409, CONFIRM_CANCELLED]);
    expect(w.st.refunds).toEqual([]);
  });
});

describe("§210 (c) another tab, another check: the refusal stays", () => {
  it("after the window answered paid, a second tab's finish (no pi, the same pi, another pi) reads “… in another tab at 3:20 PM.”", async () => {
    const w = await cbWorld();
    const { reversed, one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    await chargebackWon(reversed.stripePaymentIntentId!);
    expect((await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi })).status).toBe(200);
    for (const body of [{ paymentId: one.id }, { paymentId: one.id, pi }, { paymentId: one.id, pi: "pi_" + randomUUID() }]) {
      const r = await finish(w.dev.cookie, TAB_B, body);
      expect([r.status, r.body.error?.code]).toEqual([409, "confirmed"]);
      expect(r.body.error?.message).toMatch(otherTab);
    }
    // Tab A again: still its own.
    expect((await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi })).status).toBe(200);
    expect(await repaid(w)).toBe(1);
  });

  it("recorded by something else and NO window finished it: a finish without this check's pi (or with another PaymentIntent) is the plain refusal", async () => {
    const w = await cbWorld();
    const { reversed, one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    await chargebackWon(reversed.stripePaymentIntentId!);
    for (const body of [{ paymentId: one.id }, { paymentId: one.id, pi: "pi_" + randomUUID() }]) {
      const r = await finish(w.dev.cookie, TAB_B, body);
      expect([r.status, r.body.error?.message]).toEqual([409, ALREADY_CONFIRMED]);
    }
  });

  it("the window's own finish recorded it (the normal path); a second tab's finish with the same check reads “… in another tab …”, never paid", async () => {
    const w = await cbWorld();
    const { one, pi } = await owedOpen(w);
    w.st.pis.set(pi, "succeeded");
    const a = await finish(w.dev.cookie, TAB_A, { paymentId: one.id, pi });
    expect(a.body, JSON.stringify(a.body)).toMatchObject({ done: true });
    const b = await finish(w.dev.cookie, TAB_B, { paymentId: one.id, pi });
    expect([b.status, b.body.error?.message]).toEqual([409, expect.stringMatching(otherTab)]);
    expect(await repaid(w)).toBe(1);
  });
});

/** Ana's written answers sent; the developer's card saved; Stripe's stand-in asks the bank on every press. */
async function payWorld() {
  const s = await setup();
  devs.push(s.dev.user.id);
  const ana = await joined(s.testId, "Ana Silva");
  await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  const st = bank();
  return { ...s, ana, sub, st };
}

describe("§210 (d) Pay, Pay more, Confirm with your bank and Confirm all the same way", () => {
  it("Pay: a hold starting records the approved check before the window's finish → paid (“Paid $10.00 to Ana Silva.”'s amount); another tab refused", async () => {
    const w = await payWorld();
    w.st.ask = true;
    const r = await reviewPOST(req("/api/review", { cookie: w.dev.cookie, headers: { "x-tab": TAB_A }, body: { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })).then(json);
    expect(r.body.requiresAction, JSON.stringify(r.body)).toBe(true);
    const pi = checkPiOf(r.body.clientSecret as string);
    w.st.pis.set(pi, "succeeded");
    await startHold(w.dev.user.id, "unpaid");
    const fin = await finish(w.dev.cookie, TAB_A, { paymentId: r.body.paymentId, pi });
    expect(fin.body, JSON.stringify(fin.body)).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 1000 });
    expect(await db.payment.count({ where: { submissionId: w.sub.id, status: "charged" } })).toBe(1);
    expect(w.st.made.filter((m) => m.id === pi)).toHaveLength(1);
    expect((await finish(w.dev.cookie, TAB_B, { paymentId: r.body.paymentId })).body.error?.message).toMatch(otherTab);
  });

  it("Pay more: a new card records the approved check before the window's finish → paid", async () => {
    const w = await payWorld();
    expect((await reviewPOST(req("/api/review", { cookie: w.dev.cookie, body: { kind: "submission", id: w.sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", payKey: randomUUID(), seenAt: seen() } })).then(json)).status).toBe(200);
    w.st.ask = true;
    await settle();
    const r = await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID(), seenAt: seen(), confirmed: true, boxAt: seen() });
    expect(r.body.requiresAction, JSON.stringify(r.body)).toBe(true);
    const pi = checkPiOf(r.body.clientSecret as string);
    w.st.pis.set(pi, "succeeded");
    await newCardChecks(w.dev.user.id);
    const fin = await finish(w.dev.cookie, TAB_A, { paymentId: r.body.paymentId, pi });
    expect(fin.body, JSON.stringify(fin.body)).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 100 });
    expect(await db.payment.count({ where: { submissionId: w.sub.id, kind: "extra", status: "charged" } })).toBe(1);
  });

  it("Confirm with your bank (a charge made while away): a new card records it before the window's finish → paid; the start's client secret names the check", async () => {
    const w = await payWorld();
    w.st.ask = true;
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "charged by the tester" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: w.ana.sessionId, submissionId: w.sub.id, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const own = "pi_" + randomUUID();
    w.st.pis.set(own, "requires_action");
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: own, clientSecret: `${own}_secret` });
    const start = await finish(w.dev.cookie, TAB_A, { paymentId: p.id, start: true });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const pi = checkPiOf(start.body.clientSecret as string);
    expect(pi).toBe(own);
    w.st.pis.set(pi, "succeeded");
    await newCardChecks(w.dev.user.id);
    const fin = await finish(w.dev.cookie, TAB_A, { paymentId: p.id, pi });
    expect(fin.body, JSON.stringify(fin.body)).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 1000 });
    expect(await db.payment.count({ where: { id: p.id, status: "charged" } })).toBe(1);
    expect((await finish(w.dev.cookie, TAB_B, { paymentId: p.id, pi })).body.error?.message).toMatch(otherTab);
  });

  it("Confirm all: a new card records its one check before the window's finish → paid", async () => {
    const w = await payWorld();
    w.st.ask = true;
    const ben = await joined(w.testId, "Ben Okafor", "he");
    await sact(ben.sessionId, "written", ben.tester.cookie, { answers: ["a", "b"] });
    const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
    const items = [];
    for (const [contractId, submissionId, testerId, cents] of [[w.ana.sessionId, w.sub.id, w.ana.tester.user.id, 1000], [ben.sessionId, benSub.id, ben.tester.user.id, 1200]] as const) {
      await db.review.create({ data: { contractId, submissionId, amountCents: cents, agreedCents: cents, payKey: randomUUID(), reason: "charged by the tester" } });
      const p = await db.payment.create({ data: { kind: "review", contractId, submissionId, developerId: w.dev.user.id, testerId, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
      const id = "pi_" + randomUUID();
      w.st.pis.set(id, "requires_action");
      items.push(await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: id, clientSecret: `${id}_secret` }));
    }
    await settle();
    const all = await allPOST(req("/api/payments/confirm-all", { cookie: w.dev.cookie, headers: { "x-tab": TAB_A }, body: { seenTotalCents: 2200, seenIds: items.map((p) => p.id) } })).then(json);
    const confirm = all.body.confirm as { paymentId: string; clientSecret: string };
    expect(confirm?.paymentId, JSON.stringify(all.body)).toBeTruthy();
    const pi = checkPiOf(confirm.clientSecret);
    w.st.pis.set(pi, "succeeded");
    await newCardChecks(w.dev.user.id);
    const fin = await finish(w.dev.cookie, TAB_A, { paymentId: confirm.paymentId, pi });
    expect(fin.body, JSON.stringify(fin.body)).toMatchObject({ done: true, paid: true, status: "charged", amountCents: 2200 });
    expect(await db.payment.count({ where: { id: { in: items.map((p) => p.id) }, status: "charged" } })).toBe(2);
    // An item's own old window (its own check, cancelled when Confirm all took it over): paid by ANOTHER check → the plain refusal, never paid.
    const old = await finish(w.dev.cookie, TAB_A, { paymentId: items[0].id, pi: items[0].stripePaymentIntentId });
    expect([old.status, old.body.error?.message]).toEqual([409, ALREADY_CONFIRMED]);
  });
});

describe("§210 the page sends the window's own pi with its finish", () => {
  it("finishPayment carries `pi`; the inline check passes checkPiOf(clientSecret); the boxes show the refund line", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ done: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await finishPayment("pay_1", "succeeded", "pi_123");
    await finishPayment("pay_2");
    expect(sent).toEqual([{ paymentId: "pay_1", simulate: "succeeded", pi: "pi_123" }, { paymentId: "pay_2" }]);
    const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(src("components/BankCheck.tsx")).toContain("finishPayment<T>(a.paymentId, s, checkPiOf(a.clientSecret) || undefined)");
    for (const f of ["components/OwedBox.tsx", "components/ConfirmAll.tsx", "components/BankWaiting.tsx"]) expect(src(f)).toContain("data-own-check-refund");
  });
});
