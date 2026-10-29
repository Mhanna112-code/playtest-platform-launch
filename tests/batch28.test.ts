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
    expect(reservedAddedLine(800, 500)).toBe("Reserved $8.00: it's taken when the team approves lifting your hold. $5.00 added since will be charged right after.");
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
