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

export function stripeOn() {
  return !!override || !!process.env.STRIPE_SECRET_KEY?.trim();
}

export function getStripe(): Stripe {
  if (override) return override;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new HttpError(503, "payments_off", "Payments aren't set up yet.");
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1") throw new HttpError(503, "payments_off", "Payments are switched off right now. Try again later.");
  return new Stripe(key);
}

type Party = { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean };

/** Before charging: the developer needs a saved card (only when Stripe is on). */
export function cardRefusal(dev: Party) {
  if (!stripeOn()) return "";
  if (!dev.stripeCustomerId || !dev.stripePaymentMethodId) return "Add a card in Payments first, then press Pay again.";
  return "";
}

/**
 * Charge the developer for one Pay press. One charge per press: the idempotency key is the press's payKey.
 * Returns the fields to store on the Payment row. A declined card throws a plain sentence.
 */
export async function charge(dev: Party, tester: Party, amountCents: number, payKey: string, description: string) {
  const split = splitFee(amountCents);
  if (amountCents === 0) return { status: "charged", ...split, transferStatus: "none", stripePaymentIntentId: null };
  if (!stripeOn()) return { status: "not_set_up", ...split, transferStatus: "none", stripePaymentIntentId: null };
  const stripe = getStripe();
  const destination = tester.stripeAccountId && tester.payoutsReady ? tester.stripeAccountId : null;
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: dev.stripeCustomerId!,
        payment_method: dev.stripePaymentMethodId!,
        off_session: true,
        confirm: true,
        description,
        metadata: { developerId: dev.id, testerId: tester.id, payKey },
        ...(destination ? { application_fee_amount: split.feeCents, transfer_data: { destination } } : {}),
      },
      { idempotencyKey: `pay-${payKey}` },
    );
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", ...split, transferStatus: destination ? "sent" : "waiting", stripePaymentIntentId: pi.id };
  } catch (e) {
    const msg = (e as { message?: string }).message ?? "unknown";
    console.error("[stripe] charge failed:", msg);
    throw new HttpError(402, "card_failed", "Your card couldn't be charged. Update your card in Payments and press Pay again.", { stripe: msg });
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

export async function refreshPayoutStatus(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.stripeAccountId) return false;
  const a = await getStripe().accounts.retrieve(user.stripeAccountId);
  const ready = !!a.payouts_enabled && !!a.charges_enabled;
  await db.user.update({ where: { id: userId }, data: { payoutsReady: ready } });
  return ready;
}
