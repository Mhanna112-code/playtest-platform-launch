import Stripe from "stripe";
import { db } from "@/lib/db";
import { splitFee } from "@/lib/rules";
import { HttpError } from "./http";

// Stripe in test mode: developers save a card (Checkout in setup mode) and are charged off-session when they press Pay;
// testers connect an Express account and get their share with the charge (destination charge, platform fee kept).
// Without STRIPE_SECRET_KEY nothing is charged: presses are recorded as "payments not set up" so the flow still works.

let override: Stripe | null = null;
export const setStripeForTests = (s: Stripe | null) => {
  override = s;
};

/** STRIPE_FAKE=1: a local stand-in for evidence runs. Only without a real key and only on a localhost APP_URL. */
export const fakeOn = () => process.env.STRIPE_FAKE === "1" && !process.env.STRIPE_SECRET_KEY?.trim() && /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.APP_URL ?? "");
let fakeN = 0;
/** (Batch 11) The fake's PaymentIntents that wait for the cardholder: "requires_action" until the page's simulated pop-up says yes or no. */
// (Kept on globalThis: the dev server may load this module once per route, and the confirm route must see what the Pay route created.)
const fakePis: Map<string, string> = ((globalThis as { __fakePis?: Map<string, string> }).__fakePis ??= new Map<string, string>());
export const fakeConfirm = (id: string, ok: boolean) => { if (fakePis.has(id)) fakePis.set(id, ok ? "succeeded" : "canceled"); };
const fakeStripe = {
  paymentIntents: {
    create: async (p: { payment_method?: string; amount: number; off_session?: boolean }) => {
      if (p.payment_method === "pm_card_declined" || (p.payment_method === "pm_card_partial" && p.amount === 1500)) throw new Error("Your card was declined.");
      const id = `pi_fake_${Date.now()}_${++fakeN}`;
      // (Batch 11) pm_card_authenticationRequired: the bank wants the cardholder to confirm (off-session, Stripe refuses with authentication_required).
      if (p.payment_method === "pm_card_authenticationRequired") {
        fakePis.set(id, "requires_action");
        if (p.off_session) throw Object.assign(new Error("Your bank wants you to confirm this payment."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret_fake`, status: "requires_payment_method" } } });
        return { id, status: "requires_action", client_secret: `${id}_secret_fake`, amount: p.amount };
      }
      return { id, status: "succeeded", amount: p.amount };
    },
    retrieve: async (id: string) => ({ id, status: fakePis.get(id) ?? "succeeded", client_secret: `${id}_secret_fake` }),
    cancel: async (id: string) => { fakePis.set(id, "canceled"); return { id, status: "canceled" }; },
  },
  refunds: { create: async () => ({ id: `re_fake_${++fakeN}` }) },
  webhooks: { constructEvent: (raw: string, sig: string) => { if (sig !== "fake") throw new Error("bad signature"); return JSON.parse(raw); } },
} as unknown as Stripe;

/**
 * (Batch 15 section 5) The webhook route's signature check: the platform endpoint's secret (STRIPE_WEBHOOK_SECRET), then the Connect endpoint's
 * ("events on connected accounts", same URL: STRIPE_CONNECT_WEBHOOK_SECRET). Either one is accepted; null when neither matches. It never needs the API key.
 */
export function verifyWebhook(raw: string, signature: string): Record<string, unknown> | null {
  const verifier = override?.webhooks ?? (fakeOn() ? fakeStripe.webhooks : Stripe.webhooks);
  const secrets = fakeOn() && !override ? ["fake"] : [process.env.STRIPE_WEBHOOK_SECRET?.trim(), process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim()].filter((x): x is string => !!x);
  for (const secret of secrets) {
    try {
      return verifier.constructEvent(raw, signature, secret) as unknown as Record<string, unknown>;
    } catch {
      // try the next secret
    }
  }
  return null;
}
/** Is any webhook secret set (or the fake on)? */
export const webhookSecretsSet = () => fakeOn() || !!process.env.STRIPE_WEBHOOK_SECRET?.trim() || !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();

export function stripeOn() {
  return !!override || !!process.env.STRIPE_SECRET_KEY?.trim() || fakeOn();
}

export function getStripe(): Stripe {
  if (override) return override;
  if (fakeOn()) return fakeStripe;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new HttpError(503, "payments_off", "Payments aren't set up yet.");
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1") throw new HttpError(503, "payments_off", "Payments are switched off right now. Try again later.");
  return new Stripe(key);
}

type Party = { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean; suspendedAt?: Date | null };

/** Before charging: the developer needs a saved card (only when Stripe is on). */
export function cardRefusal(dev: Party) {
  if (!stripeOn()) return "";
  if (!dev.stripeCustomerId || !dev.stripePaymentMethodId) return "Add a card in Payments first, then press Pay again.";
  return "";
}

/**
 * (Owner, Oct 29, batch 11) How a charge is made: "press" = the developer's own press, on-session (no off_session), so the bank may ask them to confirm in the page;
 * "away" = made while the developer isn't there (a tester's Charge, a dispute decision, a retry during a hold, a renewal), off-session.
 */
export type ChargeMode = "press" | "away";
/** (Batch 11) The bank wants the cardholder to confirm (Stripe's requires_action, or authentication_required off-session): NOT a decline. */
export type NeedsAction = { status: "requires_action"; stripePaymentIntentId: string; clientSecret: string };
function needsActionOf(e: unknown): NeedsAction | null {
  const x = e as { code?: string; raw?: { payment_intent?: { id?: string; client_secret?: string } }; payment_intent?: { id?: string; client_secret?: string } };
  const pi = x?.raw?.payment_intent ?? x?.payment_intent;
  if (x?.code === "authentication_required" && pi?.id) return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "" };
  return null;
}
const pressParams = (mode: ChargeMode) => (mode === "away" ? { off_session: true } : { payment_method_types: ["card"] });

/**
 * Charge the developer for one Pay press. One charge per press: the idempotency key is the press's payKey.
 * Returns the fields to store on the Payment row. A declined card throws a plain sentence. (Batch 11) When the bank wants the cardholder to confirm, the result's status is
 * "requires_action" with the PaymentIntent and its client secret (nothing is charged yet).
 */
export async function charge(dev: Party, tester: Party, amountCents: number, payKey: string, description: string, mode: ChargeMode = "away") {
  const split = splitFee(amountCents);
  if (amountCents === 0) return { status: "charged", ...split, transferStatus: "none", stripePaymentIntentId: null };
  // (Design doc 11.2) A suspended tester's pay is charged, but their share is HELD until reinstatement (the admin refunds or releases it if it is never lifted).
  const held = !!tester.suspendedAt;
  if (!stripeOn()) return { status: "not_set_up", ...split, transferStatus: held ? "held" : "none", stripePaymentIntentId: null };
  const stripe = getStripe();
  const destination = !held && tester.stripeAccountId && tester.payoutsReady ? tester.stripeAccountId : null;
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: dev.stripeCustomerId!,
        payment_method: dev.stripePaymentMethodId!,
        ...pressParams(mode),
        confirm: true,
        description,
        metadata: { developerId: dev.id, testerId: tester.id, payKey },
        ...(destination ? { application_fee_amount: split.feeCents, transfer_data: { destination } } : {}),
      },
      { idempotencyKey: `pay-${payKey}` },
    );
    if (pi.status === "requires_action") return { ...split, transferStatus: destination ? "sent" : held ? "held" : "waiting", status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "" };
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", ...split, transferStatus: destination ? "sent" : held ? "held" : "waiting", stripePaymentIntentId: pi.id };
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return { ...split, transferStatus: destination ? "sent" : held ? "held" : "waiting", ...na };
    const msg = (e as { message?: string }).message ?? "unknown";
    console.error("[stripe] charge failed:", msg);
    throw new HttpError(402, "card_failed", "Your card couldn't be charged. Update your card in Payments and press Pay again.", { stripe: msg });
  }
}

/**
 * (Owner, Oct 27) Charge the developer's card for a payment their bank reversed (a chargeback adds its amount to what they owe). The money stays with the platform:
 * the tester already got their share with the first charge. A declined card throws a plain sentence, like charge().
 */
export async function chargePlatform(dev: Party, amountCents: number, payKey: string, description: string, mode: ChargeMode = "away"): Promise<{ status: string; stripePaymentIntentId: string | null; clientSecret?: string }> {
  if (amountCents === 0) return { status: "charged", stripePaymentIntentId: null as string | null };
  if (!stripeOn()) return { status: "not_set_up", stripePaymentIntentId: null as string | null };
  try {
    const pi = await getStripe().paymentIntents.create(
      { amount: amountCents, currency: "usd", customer: dev.stripeCustomerId!, payment_method: dev.stripePaymentMethodId!, ...pressParams(mode), confirm: true, description, metadata: { developerId: dev.id, payKey } },
      { idempotencyKey: `pay-${payKey}` },
    );
    if (pi.status === "requires_action") return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "" };
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", stripePaymentIntentId: pi.id as string | null };
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return na;
    const msg = (e as { message?: string }).message ?? "unknown";
    console.error("[stripe] platform charge failed:", msg);
    throw new HttpError(402, "card_failed", "Your card couldn't be charged. Update your card in Payments and try again.", { stripe: msg });
  }
}

/** Send a waiting tester share once they've connected a payout account (admin → payouts). */
export async function sendWaitingTransfer(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.transferStatus !== "waiting") throw new HttpError(409, "not_waiting", "This payout isn't waiting.");
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  if (!tester.stripeAccountId || !tester.payoutsReady) throw new HttpError(409, "no_account", "The tester hasn't finished connecting a payout account yet.");
  const t = await getStripe().transfers.create({ amount: p.testerCents, currency: "usd", destination: tester.stripeAccountId, metadata: { paymentId } }, { idempotencyKey: `transfer-${p.id}` });
  return db.payment.update({ where: { id: p.id }, data: { transferStatus: "sent", stripeTransferId: t.id } });
}

/** Developer: Stripe Checkout in setup mode to save a card. */
export async function cardSetupUrl(user: Party, base: string) {
  const stripe = getStripe();
  let customer = user.stripeCustomerId;
  if (!customer) {
    customer = (await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
  }
  const s = await stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    success_url: `${base}/api/payments/card-saved?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/app/payments`,
  });
  return s.url!;
}

export async function saveCardFromCheckout(userId: string, sessionId: string) {
  const stripe = getStripe();
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (s.customer !== user.stripeCustomerId) throw new HttpError(403, "bad_session", "That card setup belongs to another account.");
  const si = s.setup_intent as Stripe.SetupIntent | null;
  const pm = typeof si?.payment_method === "string" ? si.payment_method : si?.payment_method?.id;
  if (!pm) throw new HttpError(400, "no_card", "The card wasn't saved. Try again.");
  await stripe.customers.update(user.stripeCustomerId!, { invoice_settings: { default_payment_method: pm } });
  await db.user.update({ where: { id: userId }, data: { stripePaymentMethodId: pm } });
  // (Owner, Oct 29, batch 11 section 4) A new card during a hold: what is owed is retried on it at once.
  await (await import("./holds")).retryOwed(userId, new Date(), "card").catch((e) => console.error("[retry] card saved:", (e as Error).message));
}

/** Tester: Stripe Connect Express onboarding link. */
export async function payoutSetupUrl(user: Party, base: string) {
  const stripe = getStripe();
  let account = user.stripeAccountId;
  if (!account) {
    account = (await stripe.accounts.create({ type: "express", email: user.email, capabilities: { transfers: { requested: true } }, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: account } });
  }
  const link = await stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url: `${base}/app/payments`, return_url: `${base}/api/payments/payout-return` });
  return link.url;
}

/**
 * (Owner, Oct 30, batch 15 section 4) A tester's Express account is ready for payouts when Stripe has payouts on and the transfers capability is active. These accounts only
 * RECEIVE money, so charges_enabled doesn't matter. The account.updated webhook uses the same rule.
 */
export const payoutReadyOf = (a: { payouts_enabled?: boolean | null; capabilities?: { transfers?: string | null } | null }) => !!a.payouts_enabled && a.capabilities?.transfers === "active";

export async function refreshPayoutStatus(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.stripeAccountId) return false;
  const a = await getStripe().accounts.retrieve(user.stripeAccountId);
  const ready = payoutReadyOf(a);
  await db.user.update({ where: { id: userId }, data: { payoutsReady: ready } });
  return ready;
}

/** Admin: a held share that will never be released goes back to the developer (the charge is refunded). */
export async function refundPayment(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.transferStatus !== "held" && p.transferStatus !== "waiting") throw new HttpError(409, "not_held", "Only a share that hasn't been sent can be refunded.");
  if (p.stripePaymentIntentId) await getStripe().refunds.create({ payment_intent: p.stripePaymentIntentId }, { idempotencyKey: `refund-${p.id}` });
  return db.payment.update({ where: { id: p.id }, data: { status: "refunded", transferStatus: "refunded" } });
}
