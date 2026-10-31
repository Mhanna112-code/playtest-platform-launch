import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { subscribe, subscriptionWebhook } from "@/lib/server/subscription";
import { confirmStart, release } from "@/lib/server/confirm";
import { getStripe, sendWaitingShares, setStripeForTests } from "@/lib/server/stripe";
import { startHold } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps } from "@/lib/server/chargeback";
import { adminPage, type ChargebackVM } from "@/lib/server/adminLists";
import { reservedAddedLine } from "@/lib/rules";
import { renderTimes } from "@/lib/tz";
import { json, makeUser, req } from "./helpers";
import { joined, setup } from "./fixtures";

const DAY = 86_400_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

/**
 * (Batch 28 §10) A Stripe stand-in that speaks API 2026-09-30 like the real one (checked against Stripe test mode): it refuses the removed `payment_method_types`, an
 * invoice has no `payment_intent` / `subscription` (its PaymentIntent is in `payments`, its subscription in `parent.subscription_details`), `latest_invoice.payment_intent`
 * can't be expanded, an invoice's PaymentIntent can't be cancelled, a default_incomplete subscription's first PaymentIntent waits unconfirmed ("requires_confirmation"),
 * and (§17) a transfer made after the charge must name it (`source_transaction`), as the platform's balance is still pending.
 */
function strictStripe(opts: { card?: "ok" | "3ds" | "declined" } = {}) {
  const calls: { op: string; p: Record<string, unknown>; o?: Record<string, unknown> }[] = [];
  const pis = new Map<string, { status: string; amount: number; invoice?: string; capture?: string }>();
  const subs = new Map<string, { status: string; invoice: string; pi: string }>();
  const refuse = (msg: string, extra: Record<string, unknown> = {}) => { throw Object.assign(new Error(msg), { type: "StripeInvalidRequestError", rawType: "invalid_request_error", ...extra }); };
  const cardError = () => { throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", rawType: "card_error", code: "card_declined" }); };
  const removed = (p: object) => { if ("payment_method_types" in p) refuse("The `payment_method_types` parameter is no longer supported.", { param: "payment_method_types" }); };
  const next = (status: string) => (status === "requires_action" ? { next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL } } } : {});
  const piView = (id: string) => ({ id, status: pis.get(id)?.status ?? "canceled", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_"), ...next(pis.get(id)?.status ?? "") });
  const card = () => opts.card ?? "ok";
  const invoiceView = (subId: string) => {
    const s = subs.get(subId)!;
    return { id: s.invoice, object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: subId } }, payments: { data: [{ is_default: true, payment: { type: "payment_intent", payment_intent: s.pi } }] } };
  };
  const stripe = {
    paymentIntents: {
      create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => {
        calls.push({ op: "pi.create", p, o });
        removed(p);
        if (card() === "declined") cardError();
        const id = "pi_" + randomUUID();
        const status = card() === "3ds" && !p.off_session ? "requires_action" : p.capture_method === "manual" ? "requires_capture" : "succeeded";
        if (card() === "3ds" && p.off_session) {
          pis.set(id, { status: "requires_payment_method", amount: p.amount as number });
          throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
        }
        pis.set(id, { status, amount: p.amount as number, capture: p.capture_method as string | undefined });
        return piView(id);
      },
      retrieve: async (id: string) => piView(id),
      confirm: async (id: string, p: Record<string, unknown>, o?: Record<string, unknown>) => {
        calls.push({ op: "pi.confirm", p: { id, ...p }, o });
        removed(p);
        const x = pis.get(id);
        if (!x) refuse("No such payment_intent");
        if (card() === "declined") { x!.status = "requires_payment_method"; cardError(); }
        x!.status = card() === "3ds" ? "requires_action" : "succeeded";
        if (x!.status === "succeeded" && x!.invoice) for (const s of subs.values()) if (s.pi === id) s.status = "active";
        return piView(id);
      },
      capture: async (id: string, p: { amount_to_capture?: number }) => {
        calls.push({ op: "pi.capture", p: { id, ...p } });
        const x = pis.get(id);
        if (x?.status !== "requires_capture") refuse("This PaymentIntent could not be captured.");
        x!.status = "succeeded";
        return piView(id);
      },
      cancel: async (id: string) => {
        calls.push({ op: "pi.cancel", p: { id } });
        const x = pis.get(id);
        if (x?.invoice) refuse("You cannot cancel PaymentIntents created by invoices. Try voiding the invoice instead.");
        if (x) x.status = "canceled";
        return piView(id);
      },
    },
    subscriptions: {
      create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => {
        calls.push({ op: "sub.create", p, o });
        removed(p);
        if (((p.expand as string[]) ?? []).some((e) => /payment_intent/.test(e))) refuse("This property cannot be expanded (latest_invoice.payment_intent).");
        const id = "sub_" + randomUUID(), invoice = "in_" + randomUUID(), pi = "pi_" + randomUUID();
        if (p.trial_end) {
          subs.set(id, { status: "trialing", invoice, pi: "" });
          return { id, status: "trialing", latest_invoice: { id: invoice, parent: { subscription_details: { subscription: id } }, payments: { data: [] } } };
        }
        pis.set(pi, { status: "requires_confirmation", amount: 700, invoice });
        subs.set(id, { status: "incomplete", invoice, pi });
        return { id, status: "incomplete", latest_invoice: invoiceView(id) };
      },
      cancel: async (id: string) => { calls.push({ op: "sub.cancel", p: { id } }); const s = subs.get(id); if (s) s.status = "incomplete_expired"; return { id, status: "canceled" }; },
      update: async (id: string, p: Record<string, unknown>) => { calls.push({ op: "sub.update", p: { id, ...p } }); return { id }; },
    },
    invoicePayments: {
      list: async (p: { invoice: string }) => {
        calls.push({ op: "invoicePayments.list", p });
        const s = [...subs.values()].find((x) => x.invoice === p.invoice);
        return { data: s ? [{ is_default: true, status: "open", payment: { type: "payment_intent", payment_intent: s.pi } }] : [] };
      },
    },
    products: { create: async () => ({ id: "prod_" + randomUUID() }) },
    transfers: {
      create: async (p: Record<string, unknown>, o?: Record<string, unknown>) => {
        calls.push({ op: "transfer", p, o });
        if (!p.source_transaction) refuse("You have insufficient available funds in your Stripe account.", { code: "balance_insufficient" });
        return { id: "tr_" + randomUUID(), source_transaction: p.source_transaction };
      },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  };
  setStripeForTests(stripe as unknown as Stripe);
  return { calls, pis, subs, invoiceView, of: (op: string) => calls.filter((c) => c.op === op) };
}

afterEach(() => {
  setStripeForTests(null);
  vi.unstubAllEnvs();
  delete process.env.FREE_UNTIL;
});

async function cardDev() {
  const dev = await makeUser({ dev: true, name: "Nora Lane" });
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_" + randomUUID() } });
  return dev;
}
const billing = () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_stand_in"); // Stripe Billing is used only with a key; the stand-in answers every call
  process.env.FREE_UNTIL = new Date(Date.now() - DAY).toISOString();
};

describe("batch 28 §10: Stripe API 2026-09-30 (subscriptions and invoice webhooks)", () => {
  it("Subscribe: the first invoice's PaymentIntent (found in invoice.payments) is confirmed with return_url; one charge recorded, never twice by invoice.paid", async () => {
    billing();
    const st = strictStripe();
    const dev = await cardDev();
    const r = await subscribe({ id: dev.user.id, email: dev.user.email, name: "Nora Lane" });
    expect(r).toMatchObject({ subscribed: true });
    const [create] = st.of("sub.create");
    expect(create.p).toMatchObject({ payment_behavior: "default_incomplete", expand: ["latest_invoice.payments"] });
    const [conf] = st.of("pi.confirm");
    expect(conf.p).toMatchObject({ return_url: "http://localhost:3400/api/payments/bank-return" });
    const u = await userOf(dev.user.id);
    expect(u).toMatchObject({ subscriptionStatus: "active" });
    const sub = st.subs.get(u.subscriptionId!)!;
    expect(await db.payment.findMany({ where: { developerId: dev.user.id, kind: "subscription" } })).toEqual([expect.objectContaining({ status: "charged", stripePaymentIntentId: sub.pi })]);
    // The webhook in this version's shape: no `subscription` or `payment_intent` on the invoice.
    const inv = { ...st.invoiceView(u.subscriptionId!), amount_paid: 700, lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] } };
    expect("payment_intent" in inv || "subscription" in inv).toBe(false);
    expect(await subscriptionWebhook("invoice.paid", inv)).toBe(true);
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(1);
    // A renewal's invoice.paid (a new PaymentIntent, from the payments list asked of Stripe) is recorded.
    const pi2 = "pi_" + randomUUID();
    st.subs.set(u.subscriptionId!, { ...sub, invoice: "in_renewal", pi: pi2 });
    expect(await subscriptionWebhook("invoice.paid", { id: "in_renewal", parent: inv.parent, amount_paid: 700 } as object)).toBe(true);
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription", stripePaymentIntentId: pi2 } })).toBe(1);
    expect(st.of("invoicePayments.list")).toHaveLength(1);
  });

  it("Subscribe with a card the bank checks: the check page comes back inline; a cancelled check cancels the subscription (its invoice's PaymentIntent can't be)", async () => {
    billing();
    const st = strictStripe({ card: "3ds" });
    const dev = await cardDev();
    const r = (await subscribe({ id: dev.user.id, email: dev.user.email, name: "Nora Lane" })) as { requiresAction?: boolean; checkUrl?: string; paymentId?: string };
    expect(r).toMatchObject({ requiresAction: true, checkUrl: CHECK_URL });
    expect((await userOf(dev.user.id)).subscriptionStatus).not.toBe("active");
    await release(r.paymentId!);
    expect(st.of("sub.cancel")).toHaveLength(1);
    expect(st.of("pi.cancel")).toHaveLength(0);
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.paymentId! } })).toMatchObject({ status: "cancelled" });
  });

  it("Subscribe declined: nothing charged, the incomplete subscription is cancelled, the plain decline line", async () => {
    billing();
    const st = strictStripe({ card: "declined" });
    const dev = await cardDev();
    await expect(subscribe({ id: dev.user.id, email: dev.user.email, name: "Nora Lane" })).rejects.toMatchObject({ code: "card_failed" });
    expect(st.of("sub.cancel")).toHaveLength(1);
    expect(await db.payment.count({ where: { developerId: dev.user.id } })).toBe(0);
  });

  it("invoice.payment_failed and invoice.payment_action_required in this version's shape; a renewal waiting for the bank isn't made past due", async () => {
    billing();
    const st = strictStripe();
    const dev = await cardDev();
    const subId = "sub_" + randomUUID(), pi = "pi_" + randomUUID();
    st.subs.set(subId, { status: "active", invoice: "in_x", pi });
    st.pis.set(pi, { status: "requires_action", amount: 700, invoice: "in_x" });
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionStatus: "active", subscriptionId: subId, subscribedAt: new Date(), subscriptionAnchorAt: new Date(), subscriptionRenewsAt: new Date() } });
    const inv = { id: "in_x", amount_due: 700, parent: { subscription_details: { subscription: subId } } } as object;
    await subscriptionWebhook("invoice.payment_failed", inv);
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("active");
    await subscriptionWebhook("invoice.payment_action_required", inv);
    await subscriptionWebhook("invoice.payment_action_required", inv); // delivered twice: one row
    expect(await db.payment.findMany({ where: { developerId: dev.user.id, kind: "subscription" } })).toEqual([expect.objectContaining({ status: "needs_confirmation", actionPi: pi })]);
    st.pis.set(pi, { status: "requires_payment_method", amount: 700, invoice: "in_x" });
    await subscriptionWebhook("invoice.payment_failed", inv);
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("past_due");
  });

  it("Confirm with your bank on a charge that waits on Stripe.js (use_stripe_sdk) asks Stripe again with return_url, so the bank's page shows inline", async () => {
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_x");
    const dev = await cardDev();
    const id = "pi_" + randomUUID();
    const confirmed: unknown[] = [];
    setStripeForTests({
      paymentIntents: {
        retrieve: async () => ({ id, status: "requires_action", client_secret: "s", next_action: { type: "use_stripe_sdk" } }),
        confirm: async (_: string, p: unknown) => { confirmed.push(p); return { id, status: "requires_action", client_secret: "s", next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL } } }; },
      },
    } as unknown as Stripe);
    const p = await db.payment.create({ data: { kind: "subscription", developerId: dev.user.id, testerId: dev.user.id, amountCents: 700, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: id, actionBy: new Date(Date.now() + DAY) } });
    const r = await confirmStart({ id: dev.user.id }, p.id);
    expect(confirmed).toHaveLength(1);
    expect(r).toMatchObject({ needs: "action", checkUrl: CHECK_URL });
  });

  it("the local fake refuses the removed parameter too; no source uses removed fields", async () => {
    vi.stubEnv("STRIPE_FAKE", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    await expect(getStripe().paymentIntents.create({ amount: 100, currency: "usd", payment_method_types: ["card"] } as unknown as Stripe.PaymentIntentCreateParams)).rejects.toMatchObject({ param: "payment_method_types" });
    const files = ["lib/server/stripe.ts", "lib/server/subscription.ts", "lib/server/chargeback.ts", "lib/server/confirm.ts", "lib/server/holds.ts", "app/api/stripe/webhook/route.ts"];
    for (const f of files) {
      const s = src(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      expect(s).not.toMatch(/(^|[^_])payment_method_types:|latest_invoice\.payment_intent/);
    }
  });
});

describe("batch 28 §17: shares sent after the charge name it (source_transaction)", () => {
  it("a waiting share goes out from its own charge, once, keyed per share; without a charge it keeps waiting", async () => {
    const st = strictStripe();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    const pi = "pi_" + randomUUID();
    const p = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", transferStatus: "waiting", stripePaymentIntentId: pi } });
    const orphan = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: "charged", transferStatus: "waiting", stripePaymentIntentId: null } });
    expect(await sendWaitingShares(tester.user.id)).toBe(800);
    expect(await sendWaitingShares(tester.user.id)).toBe(0);
    const ts = st.of("transfer");
    expect(ts).toHaveLength(1);
    expect(ts[0].p).toMatchObject({ amount: 800, source_transaction: pi.replace(/^pi_/, "ch_"), metadata: { paymentId: p.id } });
    expect(ts[0].o).toMatchObject({ idempotencyKey: `share-${p.id}` });
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ transferStatus: "sent" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ transferStatus: "waiting" });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Your payout setup is done: $8.00 on its way." } })).toBe(1);
  });
});

// ---------- §8: a Charge after the reservation never blocks Approve ----------

async function chargebackHeld() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  const sub = await db.submission.create({ data: { contractId: sessionId, kind: "written", answers: [], sentAt: new Date(), agreedCents: 500 } });
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(dev.user.id, "chargeback");
  await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const press = (seenTotalCents: number, seenIds: string[]) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents, seenIds } })).then(json);
  // The tester's Charge after the reservation: added to what is owed during the hold.
  const addCharge = async () => {
    await db.review.create({ data: { submissionId: sub.id, contractId: sessionId, amountCents: 500, agreedCents: 500, reason: (await import("@/lib/rules")).CHARGED_BY_TESTER, payKey: randomUUID() } });
    return db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
  };
  return { dev, tester, sessionId, row, press, addCharge };
}

describe("batch 28 §8: Pay what you owe reserves once; what's added after is charged right after the lift", () => {
  beforeEach(() => vi.stubEnv("STRIPE_PUBLISHABLE_KEY", ""));

  it("reserve, a Charge added, Approve: the reservation taken, the hold lifted, the added amount charged once (receipt names it), the tester paid", async () => {
    const st = strictStripe();
    const x = await chargebackHeld();
    expect((await x.press(800, [x.row.id])).body.reservedCents).toBe(800);
    const added = await x.addCharge();
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: true, reservedCents: 800, addedCents: 500, remaining: ["Wait for the team's approval"] });
    // Pay what you owe doesn't reserve again: refused with the box's line.
    const again = await x.press(500, [added.id]);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe(reservedAddedLine(800, 500));
    expect(reservedAddedLine(800, 500)).toBe("Reserved $8.00: it's taken when the team approves lifting your hold.");
    const rows = (await adminPage("chargebacks", x.dev.user.id, null)).rows as ChargebackVM[];
    expect(rows.find((c) => c.id === x.dev.user.id)?.owedLine).toBe(" ($8.00 reserved · $5.00 added since (charged after the hold lifts))");
    expect(src("components/OwedBox.tsx")).toContain("disabled={busy || verifyFirst || reservedOnce}");
    // Approve goes through.
    expect((await approveChargebackHold(x.dev.user.id)).takenCents).toBe(800);
    expect((await userOf(x.dev.user.id)).holdStartedAt).toBeNull();
    expect(st.of("pi.capture").map((c) => c.p.amount_to_capture)).toEqual([800]);
    const later = st.of("pi.create").filter((c) => c.p.amount === 500);
    expect(later).toHaveLength(1);
    expect(later[0].p).toMatchObject({ off_session: true });
    expect(await db.payment.findUniqueOrThrow({ where: { id: added.id } })).toMatchObject({ status: "charged", transferStatus: "sent" });
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: "Receipt: you paid $5.00 for Ana Silva's written answers (charged by them after 7 days)" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: x.tester.user.id, text: { contains: "paid $5.00 for your written answers" } } })).toBe(1);
    // Nothing is charged twice (the lift's charging runs again with nothing deferred).
    await (await import("@/lib/server/holds")).chargeDeferred(x.dev.user.id);
    expect(st.of("pi.create").filter((c) => c.p.amount === 500)).toHaveLength(1);
  });

  it("declined after the lift: a normal payment hold (not a chargeback hold)", async () => {
    const st = strictStripe();
    const x = await chargebackHeld();
    await x.press(800, [x.row.id]);
    const added = await x.addCharge();
    // The card is declined for the charge after the lift (the capture still works).
    const create = (getStripe().paymentIntents.create as unknown as (p: Record<string, unknown>) => Promise<unknown>).bind(null);
    (getStripe().paymentIntents as unknown as { create: (p: Record<string, unknown>) => Promise<unknown> }).create = async (p) => {
      if (p.amount === 500) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined" });
      return create(p);
    };
    await approveChargebackHold(x.dev.user.id);
    expect(await userOf(x.dev.user.id)).toMatchObject({ holdReason: "unpaid" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: added.id } })).toMatchObject({ status: "failed" });
    void st;
  });

  it("the bank asks after the lift: it waits as Your bank wants you to confirm (3 days)", async () => {
    strictStripe({ card: "ok" });
    const x = await chargebackHeld();
    await x.press(800, [x.row.id]);
    const added = await x.addCharge();
    const pis = getStripe().paymentIntents as unknown as { create: (p: Record<string, unknown>) => Promise<unknown> };
    const create = pis.create;
    pis.create = async (p) => {
      if (p.amount === 500) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id: "pi_wait_" + randomUUID(), client_secret: "s" } } });
      return create(p);
    };
    await approveChargebackHold(x.dev.user.id);
    expect((await userOf(x.dev.user.id)).holdStartedAt).toBeNull();
    const p = await db.payment.findUniqueOrThrow({ where: { id: added.id } });
    expect(p.status).toBe("needs_confirmation");
    expect(p.actionBy!.getTime()).toBeGreaterThan(Date.now() + 2.9 * DAY);
    const { bankToConfirm } = await import("@/lib/server/confirm");
    expect((await bankToConfirm(x.dev.user.id)).map((b) => b.id)).toContain(added.id);
  });
});

describe("batch 28 §19: Verify a card mounts Stripe's card form", () => {
  it("the form is mounted once its box is on the page, and Verify this card waits until it is ready", () => {
    const s = src("components/ChargebackSteps.tsx");
    expect(s).toContain('el.on("ready", () => setReady(true));');
    expect(s).toContain("el.mount(mount.current);");
    expect(s).not.toContain("setTimeout(() => mount.current");
    expect(s).toContain("disabled={busy || !ready || bank.open || !!done}");
  });
});

// ---------- §20, §15, §14: a piece's cap, disputes up to it, and saying when it's reached ----------

describe("batch 28 §20, §15, §14: a listed piece's cap is its listing plus the part's max; a dispute reaches it; the lines at the cap", () => {
  const pay = async (cookie: string, body: Record<string, unknown>) => (await import("@/app/api/review/route")).POST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: new Date().toISOString(), confirmed: true, ...body } })).then(json);
  const more = async (testId: string, cookie: string, body: Record<string, unknown>) => (await import("./fixtures")).act(testId, "pay-extra", cookie, { seenAt: new Date().toISOString(), confirmed: true, payKey: randomUUID(), ...body });
  const dispute = async (sessionId: string, cookie: string, id: string) => (await import("./fixtures")).sact(sessionId, "dispute", cookie, { kind: "submission", id, reason: "We agreed more in the chat for the extra levels.", seenAt: new Date().toISOString(), confirmed: true });
  async function sent() {
    const s = await setup({ writtenCents: "10.00" });
    const j = await joined(s.testId);
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    await (await import("./fixtures")).sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
    await (await import("./fixtures")).settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    return { ...s, ...j, sub };
  }

  it("§20 (batch 29 §38: the max in all): a $10 listing paid $20 can be paid up to $1,000 in all (Pay + Pay more); above it is refused", async () => {
    const R = await import("@/lib/rules");
    const { pieceOf, pieceRoom } = await import("@/lib/server/payments");
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "20.00", tickedCents: 2000 })).status).toBe(200);
    const room = await pieceRoom((await pieceOf({ submissionId: w.sub.id }))!);
    expect(room).toMatchObject({ paidCents: 2000, totalCapCents: 100_000, roomCents: 98_000, aboveRoomCents: 98_000 });
    expect((await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "980.01", tickedCents: 98_001, over200: true })).body.error.message).toBe(R.overMaxLine(98_000, 100_000));
    expect(R.overMaxLine(98_000, 100_000)).toBe("This is more than this piece can be paid (up to $980 more, $1,000 in all).");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/termsOfUse.ts"), "utf8")).toContain("the part's maximum in all, listed or not");
  });

  it("§15: a listed part paid above its listing can be disputed and raised to its cap; the server refuses above it; at the cap Dispute is closed with the new line; the admin reads their chat", async () => {
    const R = await import("@/lib/rules");
    const { decideDispute, disputeBounds } = await import("@/lib/server/payments");
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "20.00", tickedCents: 2000 })).status).toBe(200);
    await db.message.create({ data: { testId: w.testId, testerId: w.tester.user.id, contractId: w.sessionId, senderId: w.tester.user.id, body: "Can you pay $30 for the extra levels?" } });
    await db.message.create({ data: { testId: w.testId, testerId: w.tester.user.id, contractId: w.sessionId, senderId: w.dev.user.id, body: "Yes, $30 in all." } });
    expect((await dispute(w.sessionId, w.tester.cookie, w.sub.id)).status).toBe(200);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: "Ana Silva disputed a payment on “Harbor Run”" } })).toBe(1);
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    expect(await disputeBounds(row)).toMatchObject({ min: 2000, max: 100_000 });
    const rows = (await adminPage("disputes", w.dev.user.id, null)).rows as import("@/lib/server/adminLists").DisputeVM[];
    const mine = rows.find((r) => r.id === row.id)!;
    expect(mine.range).toBe("$20.00 paid · can raise up to $980.00 more");
    expect(mine.money).toBe("Listing $10.00 · Paid for this piece $20.00");
    expect(mine.chat?.map((m) => `${m.who}: ${m.text}`)).toEqual(["Ana Silva: Can you pay $30 for the extra levels?", "Nora Lane: Yes, $30 in all."]);
    expect(src("app/admin/PagedList.tsx")).toContain("Their chat on this test");
    const a = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    await expect(decideDispute(a, row.id, { total: "1000.01" })).rejects.toThrow("At most $1,000.00: the most this piece can be paid.");
    expect(await decideDispute(a, row.id, { total: "1000.00", tickCents: 98_000 })).toEqual({ extraCents: 98_000 });
    // At the cap: nothing is left for Pay more or a dispute.
    expect(await disputeBounds(row)).toMatchObject({ min: 100_000, max: 100_000 });
    expect(R.canDispute(0, 1000, false, false, 0)).toEqual({ ok: false, message: "Already paid the most this piece can be paid, so there's nothing to dispute." });
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/termsOfUse.ts"), "utf8")).toContain("To decide a dispute, our team can read the chat between the tester and the developer.");
  });

  it("§14: the developer's line at the cap, the tester's lines below it, at it and after Pay more closed", async () => {
    const R = await import("@/lib/rules");
    const { paidAndCap } = await import("@/lib/server/payments");
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await paidAndCap([{ submissionId: w.sub.id }])).get(w.sub.id)).toEqual({ paidCents: 1000, allCents: 100_000 });
    expect(R.testerPayMoreLine("Nora Lane", 1000, 100_000)).toBe("Nora Lane has paid $10.00 for this. It can be paid more, up to $1,000.00 in all.");
    expect((await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "990.00", tickedCents: 99_000, over200: true })).status).toBe(200);
    expect((await paidAndCap([{ submissionId: w.sub.id }])).get(w.sub.id)).toEqual({ paidCents: 100_000, allCents: 100_000 });
    expect(R.paidMostLine(100_000)).toBe("Paid the most this piece can be paid ($1,000.00).");
    expect(R.testerPaidMostLine(100_000)).toBe("This part is already paid the most it can be ($1,000.00).");
    expect(R.payClosedLine("Nov 2", true)).toBe("Pay more closed on Nov 2.");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("paidMostLine(rooms.get(r.sub.id)!.paid)");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("more.allCents <= more.paidCents ? testerPaidMostLine(more.paidCents) : more.closedOn ? payClosedLine(more.closedOn, true) : testerPayMoreLine(dev, more.paidCents, more.allCents)");
  });

  it("the daily reminder after the review date names it and when Pay closes", async () => {
    const { unreviewedLine } = await import("@/lib/server/holds");
    const { renderTimes } = await import("@/lib/tz");
    const line = renderTimes(unreviewedLine("Harbor Run", "Ana Silva", "written answers", new Date("2026-10-30T15:00:00Z"), new Date("2026-11-13T15:00:00Z")), "UTC");
    expect(line).toBe("“Harbor Run”: Ana Silva's written answers weren't reviewed by Oct 30: Ana Silva can now charge or let it go. You can still pay until they do (at the latest Nov 13).");
    expect(renderTimes(unreviewedLine("Harbor Run", "Ana Silva", "recording", new Date("2026-10-30T15:00:00Z"), null), "UTC")).toBe("“Harbor Run”: Ana Silva's recording wasn't reviewed by Oct 30: pay it.");
  });
});

// ---------- §21: listed calls are charged automatically after 7 days ----------

describe("batch 28 §21: a listed call not paid 7 days after it is charged automatically", () => {
  async function heldCall(over: Record<string, unknown> = {}, minutes = 30) {
    const { bookCall } = await import("./fixtures");
    const s = await setup(over);
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), actualMinutes: minutes, payBy: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    return { ...s, ...j, call };
  }
  const run = async () => (await import("@/lib/server/holds")).autoChargeCalls(new Date());

  it("charged once at day 7 (the sweep running twice): rate × measured minutes, off-session; the receipt and the tester's line", async () => {
    const R = await import("@/lib/rules");
    const st = strictStripe();
    const x = await heldCall();
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    const made = st.of("pi.create");
    expect(made).toHaveLength(1);
    expect(made[0].p).toMatchObject({ amount: 1500, off_session: true });
    expect(await db.review.findUniqueOrThrow({ where: { callId: x.call.id } })).toMatchObject({ amountCents: 1500, reason: R.AUTO_CHARGED_CALL, auto: true });
    expect(await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).toMatchObject({ status: "charged", amountCents: 1500, transferStatus: "sent" });
    const receipt = await db.notification.findFirstOrThrow({ where: { userId: x.dev.user.id, text: { startsWith: "Receipt: you paid $15.00 for Ana Silva's call on" } } });
    expect(receipt.text).toContain("(charged automatically after 7 days)");
    expect(await db.notification.count({ where: { userId: x.tester.user.id, text: { startsWith: "Nora Lane paid you $15.00 for your call on" } } })).toBe(1);
  });

  it("paid before: nothing is charged", async () => {
    const st = strictStripe();
    const x = await heldCall();
    await db.review.create({ data: { callId: x.call.id, contractId: x.sessionId, amountCents: 1500, agreedCents: 1500, reason: "", payKey: randomUUID() } });
    expect(await run()).toBe(0);
    expect(st.of("pi.create")).toHaveLength(0);
  });

  it("the bank asks: it waits as Your bank wants you to confirm; declined: a payment hold; during a hold: added to what's owed", async () => {
    strictStripe({ card: "3ds" });
    const a = await heldCall();
    expect(await run()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: a.call.id } })).toMatchObject({ status: "needs_confirmation" });

    strictStripe({ card: "declined" });
    const b = await heldCall();
    await run();
    expect(await db.payment.findFirstOrThrow({ where: { callId: b.call.id } })).toMatchObject({ status: "failed" });
    expect(await userOf(b.dev.user.id)).toMatchObject({ holdReason: "unpaid" });
    expect(await db.notification.count({ where: { userId: b.tester.user.id, text: { contains: "may be delayed" } } })).toBe(1);

    const st = strictStripe();
    const c = await heldCall();
    await startHold(c.dev.user.id, "unpaid");
    await run();
    expect(st.of("pi.create")).toHaveLength(0);
    expect(await db.payment.findFirstOrThrow({ where: { callId: c.call.id } })).toMatchObject({ status: "owed", amountCents: 1500 });
  });

  it("0 measured minutes: closed with nothing to pay; an unlisted call is untouched", async () => {
    const R = await import("@/lib/rules");
    const st = strictStripe();
    const z = await heldCall({}, 0);
    await run();
    expect(await db.review.findUniqueOrThrow({ where: { callId: z.call.id } })).toMatchObject({ amountCents: 0, reason: R.AUTO_NOTHING_CALL });
    const u = await heldCall({ liveRateCents: null });
    await run();
    expect(await db.review.count({ where: { callId: u.call.id } })).toBe(0);
    expect(st.of("pi.create")).toHaveLength(0);
  });

  it("no Charge or Let it go for listed calls: an older page's press is refused; the pages say it's charged automatically", async () => {
    const R = await import("@/lib/rules");
    const x = await heldCall();
    await db.call.update({ where: { id: x.call.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    const r = await (await import("./fixtures")).sact(x.sessionId, "choose", x.tester.cookie, { callId: x.call.id, choice: "charge", seenAt: new Date().toISOString(), confirmed: true });
    expect(r.body.error).toMatchObject({ code: "auto_charge", message: R.AUTO_CHARGE_NO_CHOICE });
    expect(R.testerAutoChargeLine("Nora Lane", "Nov 5")).toBe("If Nora Lane doesn't pay by Nov 5, it's charged automatically.");
    expect(R.autoChargeLine("Nov 5", 1500, 30, 3000)).toBe("If you don't pay by Nov 5, it's charged automatically: $15.00 (30 min × $30.00/h).");
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).not.toContain("callId={x.id} devName={dev}");
    expect(session).toContain("testerAutoChargeLine(dev,");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("autoChargeLine(pieceDay(x.x!.payBy, u.timeZone)"); // (batch 30 §20) one shared date helper
    expect(R.PAY_RULES_TICK).toContain("and listed calls 7 days after they take place.");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/termsOfUse.ts"), "utf8")).toContain("their card is charged automatically for its measured length at the call's rate");
  });
});

// ---------- §18: payment emails go out even with email Off ----------

describe("batch 28 §18: payment lines are emailed the same evening whatever the setting", () => {
  it("email Off still gets the evening payment email, with only the payment lines", async () => {
    const { notify, sendSummaries } = await import("@/lib/server/notify");
    const u = await makeUser({ dev: true, name: "Nora Lane" });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "off" } });
    await notify(u.user.email, "Receipt: you paid $8.00 for Ana Silva's written answers", ["x"], "/app/payments", { payment: true });
    await notify(u.user.email, "Ana Silva sent written answers for “Harbor Run”", ["x"], "/app/tests/x");
    await sendSummaries(new Date(), [u.user.id]);
    const mail = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Your Playtest payment updates: 1");
    expect(mail[0].text).toContain("Receipt: you paid $8.00 for Ana Silva's written answers");
    expect(mail[0].text).not.toContain("sent written answers");
    expect(await db.notification.count({ where: { userId: u.user.id, summarizedAt: null } })).toBe(1); // the other line stays in the bell only
    await sendSummaries(new Date(), [u.user.id]);
    expect(await db.outboxEmail.count({ where: { to: u.user.email } })).toBe(1); // once
    expect(src("app/app/notifications/AlertSettings.tsx")).toContain("Payment updates are always emailed the same evening, even with email Off, Weekly or Monthly"); // (batch 34 §5) then the side's kinds
  });
});

// ---------- §1 and §2: the heartbeat never records an outage on its own; merging never widens one ----------

describe("batch 28 §1 and §2: heartbeat gaps wait for an admin; an uptime report's span wins", () => {
  const H = 3_600_000, MIN = 60_000;
  beforeEach(async () => {
    process.env.OUTAGE_CHECKS = "1";
    await db.outage.deleteMany({});
    await db.appState.deleteMany({ where: { OR: [{ key: { in: ["outage-down", "sweep-last"] } }, { key: { startsWith: "gap:" } }] } });
  });
  afterEach(async () => {
    delete process.env.OUTAGE_CHECKS;
    await db.appState.deleteMany({ where: { OR: [{ key: { in: ["outage-down", "sweep-last"] } }, { key: { startsWith: "gap:" } }] } });
  });
  const working = async () => {
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    return sessionId;
  };
  const dueOf = async (sessionId: string) => (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime();

  it("a heartbeat gap alone: listed (\"Possible outage …\"), nothing moved; Approve moves every timer; Dismiss clears", async () => {
    const O = await import("@/lib/server/outages");
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const t0 = new Date(Date.now() - 5 * H);
    await O.sweepGap(t0);
    const g = (await O.sweepGap(new Date(t0.getTime() + 32 * MIN)))!;
    expect(g).toMatchObject({ ms: 32 * MIN });
    expect(await dueOf(sessionId)).toBe(due0);
    expect(await db.outage.count()).toBe(0);
    expect(renderTimes(O.gapLine({ startAt: new Date("2026-10-29T15:10:00Z"), endAt: new Date("2026-10-29T15:42:00Z"), ms: 32 * MIN }), "UTC")).toBe("Possible outage: no checks from 3:10 PM UTC to 3:42 PM UTC (32 min). Nothing has moved.");
    expect((await O.adminOutages()).gaps.map((x) => x.id)).toEqual([g.id]);
    const a = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    await O.approveGap(a.id, g.id);
    expect((await dueOf(sessionId)) - due0).toBe(32 * MIN);
    expect(await db.outage.count()).toBe(1);
    await expect(O.approveGap(a.id, g.id)).rejects.toMatchObject({ code: "done" }); // once
    // A second gap, dismissed: nothing moves and it leaves the list.
    await O.sweepGap(new Date(t0.getTime() + 2 * H));
    const g2 = (await O.sweepGap(new Date(t0.getTime() + 3 * H)))!;
    expect((await O.adminOutages()).gaps).toHaveLength(1);
    await O.dismissGap(g2.id);
    expect((await O.adminOutages()).gaps).toHaveLength(0);
    expect((await dueOf(sessionId)) - due0).toBe(32 * MIN);
    expect(src("app/admin/page.tsx")).toContain('<AdminButton action="dismiss-gap" id={g.id} label="Dismiss" extra={{ since: seenAt }} />'); // (batch 34 §1) with the page's time
    // Any server activity is a heartbeat (API calls and page loads).
    expect(src("lib/server/http.ts")).toContain("m.touchHeartbeat()");
    expect(src("lib/server/page-auth.ts")).toContain("m.touchHeartbeat()");
    await db.appState.update({ where: { key: "sweep-last" }, data: { value: new Date(Date.now() - 20 * MIN).toISOString() } });
    expect(await O.touchHeartbeat(Date.now(), true)).toMatchObject({ ms: expect.any(Number) });
  });

  it("an up alert overlapping a listed gap: applied once with the alert's span; the gap closed", async () => {
    const O = await import("@/lib/server/outages");
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const t0 = new Date(Date.now() - 3 * H);
    await O.sweepGap(t0);
    await O.sweepGap(new Date(t0.getTime() + 60 * MIN)); // gap [t0, t0 + 60]
    const o = await O.recordAlert("up", new Date(t0.getTime() + 40 * MIN), 20 * MIN); // the alert: [t0 + 20, t0 + 40]
    expect(o).toMatchObject({ startAt: new Date(t0.getTime() + 20 * MIN), endAt: new Date(t0.getTime() + 40 * MIN), ms: 20 * MIN });
    expect((await dueOf(sessionId)) - due0).toBe(20 * MIN);
    expect((await O.adminOutages()).gaps).toHaveLength(0);
  });

  it("an applied 20-hour outage extended to 26 by another report: the extra waits for Approve", async () => {
    const O = await import("@/lib/server/outages");
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const end = new Date(Date.now() - 2 * H);
    const first = await O.recordAlert("up", end, 20 * H);
    expect(first).toMatchObject({ needsApproval: false });
    expect((await dueOf(sessionId)) - due0).toBe(20 * H);
    // A second report: from the same start, 6 hours longer.
    const second = await O.recordAlert("up", new Date(end.getTime() + 6 * H), 26 * H);
    expect(second!.id).toBe(first!.id);
    expect((await db.outage.findUniqueOrThrow({ where: { id: first!.id } })).ms).toBe(20 * H);
    const extra = await db.outage.findFirstOrThrow({ where: { id: { not: first!.id } } });
    expect(extra).toMatchObject({ startAt: end, ms: 6 * H, needsApproval: true, approvedAt: null });
    expect((await dueOf(sessionId)) - due0).toBe(20 * H); // nothing more moved
    const a = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    await O.approveOutage(a.id, extra.id);
    expect((await dueOf(sessionId)) - due0).toBe(26 * H);
  });
});

// ---------- §3 to §7 and §9: small leftovers ----------

describe("batch 28 §3-§7 and §9", () => {
  it("§3: a team Stop always reads with its time, in the reader's zone (the date added after 12 hours)", async () => {
    const { sessionRefusal } = await import("@/lib/server/tests");
    const at = new Date(Date.now() - 60_000);
    const c = { status: "ended", endKind: "stopped", endedAt: at, tester: { timeZone: "America/Chicago" } };
    const line = sessionRefusal(c, { openUntil: null, adminStoppedAt: at } as { openUntil: null }, "Nora Lane");
    expect(line).toBe(`This test was stopped at ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}. Work you sent is still reviewed.`);
    const old = new Date(Date.now() - 20 * 3_600_000);
    expect(sessionRefusal({ ...c, endedAt: old }, { openUntil: null, adminStoppedAt: old } as { openUntil: null }, "Nora Lane", new Date(), "UTC")).toMatch(/^This test was stopped at \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M\./);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("sessionRefusal(c, c.test, dev, new Date(), u.timeZone)");
  });

  it("§4: the stop box's times use the reader's saved zone; §5: the charge-opens line under a sent, listed part waiting for the developer", () => {
    expect(src("components/ChangesBox.tsx")).toContain("const time = (iso: string) => fmtTimeIn(iso, savedZone());");
    expect(src("components/TimeZoneSync.tsx")).toContain("__savedTz = stored");
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain("chargeOpensNote(dev, pieceDay(opens, u.timeZone))"); // (batch 30 §20)
  });

  it("§6: a question the set can't find isn't required; By question has no notRequired", async () => {
    const { itemsOf } = await import("@/lib/answerSets");
    expect(itemsOf(["a", "b"], ["Only one?"])[1]).toEqual({ question: "Question 2", required: false, answer: "b" });
    expect(src("lib/byQuestion.ts")).not.toContain("notRequired");
  });

  it("§9: a refused press redraws the page at once (typed text kept)", () => {
    expect(src("lib/client.ts")).toContain("window.dispatchEvent(new Event(PRESS_REFUSED_EVENT))");
    expect(src("components/AutoRefresh.tsx")).toContain("window.addEventListener(PRESS_REFUSED_EVENT, onRefused);");
  });
});

describe("batch 28 §21: during a suspension the automatic charge waits for the reinstatement", () => {
  it("added as waiting (deferred), charged when the account is clear, with its own receipt", async () => {
    const { bookCall } = await import("./fixtures");
    const st = strictStripe();
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x", devSuspendedAt: new Date() } });
    const { autoChargeCalls, chargeDeferred } = await import("@/lib/server/holds");
    expect(await autoChargeCalls(new Date())).toBe(1);
    expect(st.of("pi.create")).toHaveLength(0);
    expect(await db.payment.findFirstOrThrow({ where: { callId: call.id } })).toMatchObject({ status: "deferred", amountCents: 1500 });
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: null } });
    await chargeDeferred(s.dev.user.id);
    expect(await db.payment.findFirstOrThrow({ where: { callId: call.id } })).toMatchObject({ status: "charged" });
    const r = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { startsWith: "Receipt: you paid $15.00 for Ana Silva's call on" } } });
    expect(r.text).toContain("(charged automatically after 7 days)");
  });
});
