import Stripe from "stripe";
import { db } from "@/lib/db";
import { splitFee } from "@/lib/rules";
import { money } from "@/lib/format";
import { HttpError } from "./http";
import { cardLabel, logAccountChange } from "./accountChanges";
import { appUrl } from "./auth";

// Stripe in test mode: developers save a card (Checkout in setup mode) and are charged off-session when they press Pay;
// testers connect an Express account and get their share with the charge (destination charge, platform fee kept).
// Without STRIPE_SECRET_KEY nothing is charged: presses are recorded as "payments not set up" so the flow still works.

let override: Stripe | null = null;
export const setStripeForTests = (s: Stripe | null) => {
  override = s;
};

/** STRIPE_FAKE=1: a local stand-in for evidence runs. Only without a real key, only on a localhost APP_URL, and (batch 15 section 41, M3) never in production. */
export const fakeOn = () => process.env.NODE_ENV !== "production" && process.env.STRIPE_FAKE === "1" && !process.env.STRIPE_SECRET_KEY?.trim() && /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.APP_URL ?? "");
let fakeN = 0;
/** (Batch 11) The fake's PaymentIntents that wait for the cardholder: "requires_action" until the page's simulated pop-up says yes or no. */
// (Kept on globalThis: the dev server may load this module once per route, and the confirm route must see what the Pay route created.)
const fakePis: Map<string, string> = ((globalThis as { __fakePis?: Map<string, string> }).__fakePis ??= new Map<string, string>());
export const fakeConfirm = (id: string, ok: boolean) => { if (fakePis.has(id)) fakePis.set(id, ok ? (fakeManual.has(id) ? "requires_capture" : "succeeded") : "canceled"); };
/** (Batch 23 section 6) The fake's authorizations (capture_method manual): "requires_capture" until captured, cancelled or expired. */
const fakeManual: Set<string> = ((globalThis as { __fakeManual?: Set<string> }).__fakeManual ??= new Set<string>());
/** (Batch 23 section 6) The bank let the fake's authorization lapse (about 7 days): it can't be captured any more. */
export const fakeExpire = (id: string) => { if (fakePis.has(id)) fakePis.set(id, "canceled"); };
/** (Batch 15 section 9) The fake's PaymentIntents by their metadata payKey, for its search. */
const fakeByKey: Map<string, string> = ((globalThis as { __fakeByKey?: Map<string, string> }).__fakeByKey ??= new Map<string, string>());
/** (Batch 28 §10) The fake refuses what API 2026-09-30 refuses, as Stripe does, so a removed parameter can't come back unnoticed. */
const refuseRemoved = (p: object, names: string[]) => {
  const used = names.find((n) => n in p);
  if (used) throw Object.assign(new Error(`The \`${used}\` parameter is no longer supported.`), { type: "StripeInvalidRequestError", rawType: "invalid_request_error", param: used });
};
/** (Batch 28 §17) The fake's charge behind each PaymentIntent (Stripe's latest_charge), for transfers made later from it. */
const chargeOfPi = (id: string) => id.replace(/^pi_/, "ch_");
const fakeStripe = {
  paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }) },
  paymentIntents: {
    create: async (p: { payment_method?: string; amount: number; off_session?: boolean; capture_method?: string; metadata?: { payKey?: string } }) => {
      refuseRemoved(p, ["payment_method_types"]);
      if (p.payment_method === "pm_card_declined" || (p.payment_method === "pm_card_partial" && p.amount === 1500)) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", rawType: "card_error", code: "card_declined" });
      const id = `pi_fake_${Date.now()}_${++fakeN}`;
      if (p.metadata?.payKey) fakeByKey.set(p.metadata.payKey, id);
      if (p.capture_method === "manual") fakeManual.add(id);
      if (!fakePis.has(id)) fakePis.set(id, "succeeded");
      // (Batch 35 §122) Like test card 3184 off-session: the attempt fails with payment_intent_payment_attempt_failed and the PaymentIntent waits in requires_payment_method.
      if (p.payment_method === "pm_card_authenticationAttemptFailed") {
        fakePis.set(id, "requires_action");
        if (p.off_session) throw Object.assign(new Error("The latest payment attempt of this PaymentIntent has failed."), { type: "StripeCardError", rawType: "card_error", code: "payment_intent_payment_attempt_failed", raw: { code: "payment_intent_payment_attempt_failed", payment_intent: { id, client_secret: `${id}_secret_fake`, status: "requires_payment_method", last_payment_error: { code: "payment_intent_payment_attempt_failed" } } } });
        return { id, status: "requires_action", client_secret: `${id}_secret_fake`, amount: p.amount };
      }
      // (Batch 11) pm_card_authenticationRequired: the bank wants the cardholder to confirm (off-session, Stripe refuses with authentication_required).
      if (p.payment_method === "pm_card_authenticationRequired") {
        fakePis.set(id, "requires_action");
        if (p.off_session) throw Object.assign(new Error("Your bank wants you to confirm this payment."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret_fake`, status: "requires_payment_method" } } });
        return { id, status: "requires_action", client_secret: `${id}_secret_fake`, amount: p.amount };
      }
      if (p.capture_method === "manual") {
        fakePis.set(id, "requires_capture");
        return { id, status: "requires_capture", amount: p.amount };
      }
      return { id, status: "succeeded", amount: p.amount };
    },
    // (Batch 23 section 6) Capture an authorization (the team's Approve); a cancelled or lapsed one can't be.
    capture: async (id: string, p: { amount_to_capture?: number } = {}) => {
      if (fakePis.get(id) !== "requires_capture") throw Object.assign(new Error(`This PaymentIntent could not be captured because it has a status of ${fakePis.get(id) ?? "unknown"}.`), { type: "StripeInvalidRequestError", code: "payment_intent_unexpected_state" });
      fakePis.set(id, "succeeded");
      return { id, status: "succeeded", amount_received: p.amount_to_capture };
    },
    retrieve: async (id: string) => ({ id, status: fakePis.get(id) ?? "succeeded", client_secret: `${id}_secret_fake`, latest_charge: chargeOfPi(id) }),
    search: async (q: { query: string }) => {
      const key = /metadata\['payKey'\]:'([^']+)'/.exec(q.query)?.[1] ?? "";
      const id = fakeByKey.get(key);
      return { data: id ? [{ id, status: fakePis.get(id) ?? "succeeded" }] : [] };
    },
    // (Batch 35 §117) As on Stripe: a PaymentIntent that already went through can't be cancelled.
    cancel: async (id: string) => {
      if (fakePis.get(id) === "succeeded") throw Object.assign(new Error("You cannot cancel this PaymentIntent because it has a status of succeeded."), { type: "StripeInvalidRequestError", code: "payment_intent_unexpected_state" });
      fakePis.set(id, "canceled");
      return { id, status: "canceled" };
    },
  },
  refunds: { create: async () => ({ id: `re_fake_${++fakeN}` }) },
  // (Batch 28 §17) A transfer made after the charge names that charge (source_transaction), as on Stripe: no platform balance is needed.
  transfers: {
    create: async (p: { source_transaction?: string }) => {
      if (!p.source_transaction) throw Object.assign(new Error("You have insufficient available funds in your Stripe account."), { type: "StripeInvalidRequestError", code: "balance_insufficient" });
      return { id: `tr_fake_${++fakeN}`, source_transaction: p.source_transaction };
    },
  },
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
  if (paymentsOff()) throw new HttpError(503, "payments_off", PAYMENTS_OFF);
  return new Stripe(key);
}
/** (§130 addition) A live key without STRIPE_ALLOW_LIVE=1: every Stripe call is refused (payments_off). Routes check it before counting a card attempt. */
export const paymentsOff = () => !override && !fakeOn() && !!process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1";

type Party = { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean; testerSuspendedAt?: Date | null };

/** (Batch 32 §15) A charge on a developer with no saved card: the failure recorded with it (the developer's Payments asks for a card and Pay what you owe). */
export const NO_CARD_SAVED = "No card is saved on this account.";
/** The press's line when there's no card to charge (none saved, or the saved one is gone at Stripe: §130). */
export const ADD_CARD_FIRST = "Add a card in Payments first, then press Pay again.";
/** Before charging: the developer needs a saved card (only when Stripe is on). */
export function cardRefusal(dev: Party) {
  if (!stripeOn()) return "";
  if (!dev.stripeCustomerId || !dev.stripePaymentMethodId) return ADD_CARD_FIRST;
  return "";
}

// ---------- (Owner, Nov 2, batch 35 §130) Ids Stripe doesn't know ----------
// Every Stripe id stored before the live switch was made in TEST mode; in live mode Stripe answers "No such customer / payment_method / account / payment_intent"
// (resource_missing). A stale id is never a decline: no hold, no debt, no retry counted, nothing charged twice, no record lost.

type StripeMissing = { code?: string; param?: string; message?: string; raw?: { code?: string; param?: string; message?: string } };
/** Stripe doesn't know the id it was given (resource_missing). */
export const isMissing = (e: unknown) => {
  const x = (e ?? {}) as StripeMissing;
  return x.code === "resource_missing" || x.raw?.code === "resource_missing";
};
const missingText = (e: unknown) => {
  const x = (e ?? {}) as StripeMissing;
  return `${x.param ?? x.raw?.param ?? ""} ${x.message ?? x.raw?.message ?? ""}`.toLowerCase();
};
/** The missing id is a Connect account (a charge's destination, a transfer's, an onboarding link's account). */
export const missingAccount = (e: unknown) => isMissing(e) && /destination|account|acct_/.test(missingText(e));
/** The developer's saved card is gone at Stripe: the customer and card fields are cleared, so Payments shows "Add a card" (§130). */
export async function forgetCard(userId: string) {
  await db.user.updateMany({ where: { id: userId }, data: { stripeCustomerId: null, stripePaymentMethodId: null, cardExpMonth: null, cardExpYear: null } });
  console.error("[stripe] saved card unknown to Stripe: cleared for", userId);
}
/** The tester's Connect account is gone at Stripe: cleared, so payouts wait for "Connect a payout account" (§130). */
export async function forgetPayout(userId: string) {
  await db.user.updateMany({ where: { id: userId }, data: { stripeAccountId: null, payoutsReady: false } });
  console.error("[stripe] payout account unknown to Stripe: cleared for", userId);
}
/** (§130) A charge on a card Stripe doesn't know: NOT a decline (its own code, "no_card", like a press with no card saved). */
export const cardGone = () => new HttpError(409, "no_card", ADD_CARD_FIRST);
/** (§130 addition) Live keys without STRIPE_ALLOW_LIVE: getStripe's refusal. Never a decline, a hold, a debt or a counted card attempt. */
export const PAYMENTS_OFF = "Payments are switched off right now. Try again later.";
export const isPaymentsOff = (e: unknown) => e instanceof HttpError && e.code === "payments_off";

/**
 * (Owner, Oct 29, batch 11) How a charge is made: "press" = the developer's own press, on-session (no off_session), so the bank may ask them to confirm in the page;
 * "away" = made while the developer isn't there (a tester's Charge, a dispute decision, a retry during a hold, a renewal), off-session.
 */
export type ChargeMode = "press" | "away";
/** (Batch 11) The bank wants the cardholder to confirm (Stripe's requires_action, or authentication_required off-session): NOT a decline. */
export type NeedsAction = { status: "requires_action"; stripePaymentIntentId: string; clientSecret: string; /** (Batch 17 §11) the bank's check page, shown inline */ checkUrl?: string };
/** (Batch 17 §11) Where the bank's check returns inside the page's inline frame (a tiny page that tells the page it finished). */
export const bankReturnUrl = () => `${appUrl()}/api/payments/bank-return`;
/** (Batch 17 §11) The bank's own check page, to show inline (a PaymentIntent or SetupIntent confirmed with return_url waits on "redirect_to_url"). */
export const checkUrlOf = (x: { next_action?: { type?: string; redirect_to_url?: { url?: string | null } | null } | null }) =>
  x.next_action?.type === "redirect_to_url" ? x.next_action.redirect_to_url?.url ?? undefined : undefined;
/** (Batch 35 §122) Stripe's codes for "the bank wants the cardholder to authenticate" (3D Secure) on a charge: never a decline. */
const AUTH_CODES = new Set(["authentication_required", "payment_intent_authentication_failure", "payment_intent_payment_attempt_failed"]);
type PiLike = { id?: string; client_secret?: string | null; status?: string; last_payment_error?: { code?: string; decline_code?: string } | null };
type StripeAnswer = { code?: string; decline_code?: string; raw?: { code?: string; decline_code?: string; payment_intent?: PiLike }; payment_intent?: PiLike };
/**
 * (Owner, Nov 2, batch 35 §122) THE one classifier of a charge's answer, used by every charge (press and away: a tester's Charge, a team decision, a retry, Pay what you
 * owe's one payment, a charge after a lift, a new card's retry): does the bank want the cardholder to authenticate? An off-session charge on a card that asks the bank
 * comes back as authentication_required, or (Stripe test mode, card 3184) as payment_intent_payment_attempt_failed with the PaymentIntent left in
 * requires_payment_method. A real decline (a decline code other than authentication_required: insufficient funds, card declined…) is not.
 */
export function wantsAuth(e: unknown) {
  const x = (e ?? {}) as StripeAnswer;
  const pi = x.raw?.payment_intent ?? x.payment_intent;
  const lpe = pi?.last_payment_error ?? null;
  const decline = x.decline_code ?? x.raw?.decline_code ?? lpe?.decline_code;
  if (decline && decline !== "authentication_required") return false;
  return AUTH_CODES.has(x.code ?? "") || AUTH_CODES.has(x.raw?.code ?? "") || AUTH_CODES.has(lpe?.code ?? "") || decline === "authentication_required";
}
function needsActionOf(e: unknown): NeedsAction | null {
  const x = e as StripeAnswer;
  const pi = x?.raw?.payment_intent ?? x?.payment_intent;
  if (wantsAuth(e) && pi?.id) return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "" };
  return null;
}
/** (§122) A PaymentIntent Stripe returned (no error) that waits for the cardholder: requires_action, or requires_payment_method after an authentication attempt. */
export const piWaits = (pi: PiLike) => pi.status === "requires_action" || (pi.status === "requires_payment_method" && wantsAuth({ payment_intent: pi }));
// (Batch 17 §11) A press is confirmed with return_url, so the bank's check (if it asks) is a page the developer's page can show inline, under the button.
// (API 2026-09-30) PaymentIntents take `allowed_payment_method_types`; the old `payment_method_types` is refused by Stripe, so every press failed.
// Stripe's page can save a card or Link (which may use a card or an eligible bank account); both methods remain allowed.
export const CARD_TYPES: ("card" | "link")[] = ["card", "link"];
const pressParams = (mode: ChargeMode) => (mode === "away" ? { off_session: true } : { allowed_payment_method_types: CARD_TYPES, return_url: bankReturnUrl() });
/**
 * (Owner, Nov 3) A PaymentIntent's description as sent: paymentRows.stripeDescription builds it (the payment's "What you've paid" line, names in full, after
 * "Playtest: "); a safety cut at Stripe's 1,000 characters.
 */
const stripeText = (description: string) => (description.length > 1000 ? `${description.slice(0, 999)}…` : description);

/**
 * Charge the developer for one Pay press. One charge per press: the idempotency key is the press's payKey.
 * Returns the fields to store on the Payment row. A declined card throws a plain sentence. (Batch 11) When the bank wants the cardholder to confirm, the result's status is
 * "requires_action" with the PaymentIntent and its client secret (nothing is charged yet).
 */
export async function charge(dev: Party, tester: Party, amountCents: number, payKey: string, description: string, mode: ChargeMode = "away") {
  const split = splitFee(amountCents);
  if (amountCents === 0) return { status: "charged", ...split, transferStatus: "none", stripePaymentIntentId: null };
  // (Owner, Oct 29, batch 22 section 2) A suspended tester is paid like anyone: their share goes to their payout account (or waits for it to be set up).
  if (!stripeOn()) return { status: "not_set_up", ...split, transferStatus: "none", stripePaymentIntentId: null };
  // (Owner's finding, Oct 30, batch 32 §15) No saved card (a tester's Charge, or an automatic charge, on a developer who never added one): handled as a declined
  // card (the payment hold and Pay what you owe; the tester reads only "delayed"), never sent to Stripe with an empty card ("Payments are having a problem").
  if (!dev.stripeCustomerId || !dev.stripePaymentMethodId) throw new HttpError(402, "card_failed", NO_CARD_SAVED);
  const stripe = getStripe();
  type Charged = ReturnType<typeof splitFee> & { status: string; transferStatus: string; stripePaymentIntentId: string | null; clientSecret?: string; checkUrl?: string };
  const attempt = async (destination: string | null, key: string): Promise<Charged> => {
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          customer: dev.stripeCustomerId!,
          payment_method: dev.stripePaymentMethodId!,
          ...pressParams(mode),
          confirm: true,
          description: stripeText(description),
          metadata: { developerId: dev.id, testerId: tester.id, payKey },
          ...(destination ? { application_fee_amount: split.feeCents, transfer_data: { destination } } : {}),
        },
        { idempotencyKey: key },
      );
      if (piWaits(pi)) return { ...split, transferStatus: destination ? "sent" : "waiting", status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
      if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
      return { status: "charged", ...split, transferStatus: destination ? "sent" : "waiting", stripePaymentIntentId: pi.id };
    } catch (e) {
      const na = needsActionOf(e);
      if (na) return { ...split, transferStatus: destination ? "sent" : "waiting", ...na };
      throw e;
    }
  };
  const destination = tester.stripeAccountId && tester.payoutsReady ? tester.stripeAccountId : null;
  try {
    try {
      return await attempt(destination, `pay-${payKey}`);
    } catch (e) {
      // (§130) The tester's payout account is unknown to Stripe: it's cleared and the charge is made without it (the share waits for a new payout setup). Its own
      // key, the same every time, so a repeat of this press meets this same charge, never a second one.
      if (!missingAccount(e)) throw e;
      if (tester.stripeAccountId) await forgetPayout(tester.id);
      return await attempt(null, `pay-${payKey}-nodest`);
    }
  } catch (e) {
    // (§130) The developer's customer or card is unknown to Stripe: cleared, and it's "no card saved", never a decline.
    if (isMissing(e)) {
      await forgetCard(dev.id);
      throw cardGone();
    }
    throw chargeError(e, "Your card couldn't be charged. Update your card in Payments and press Pay again.");
  }
}

/** (Batch 15 section 41, M1) Shown when Stripe fails for any reason that isn't the card itself: nothing was charged, no hold, nothing owed. */
export const PAYMENTS_PROBLEM = "Payments are having a problem right now. Nothing was charged; try again shortly.";
/** Only Stripe's card errors are declines (a hold, an owed payment). */
export const isCardError = (e: unknown) => {
  const x = e as { type?: string; rawType?: string };
  // (Batch 35 §122) The bank asking to authenticate is a card_error at Stripe, but never a decline.
  return (x?.type === "StripeCardError" || x?.type === "card_error" || x?.rawType === "card_error") && !wantsAuth(e);
};
/**
 * The error a failed charge becomes: a lost answer (connection or Stripe's own error) is "payment_unknown" (it stays pending and is checked later, section 9); a key reused
 * with other details is "idempotency"; a card error is "card_failed" (the decline: holds and owed payments follow); anything else (rate limits, keys, a restricted
 * account...) is "payments_problem" with no hold. The raw Stripe text is only logged, never shown (L4).
 */
function chargeError(e: unknown, declined: string): HttpError {
  if (e instanceof HttpError) return e;
  const msg = (e as { message?: string }).message ?? "unknown";
  console.error("[stripe] charge failed:", (e as { type?: string }).type ?? "", msg);
  try {
    unknownOutcome(e);
  } catch (x) {
    return x as HttpError;
  }
  // (Batch 35 §122) The bank asking to authenticate is never a decline (a debt): with no PaymentIntent to confirm, it waits and is tried again.
  if (wantsAuth(e)) return new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
  if (isCardError(e)) return new HttpError(402, "card_failed", declined);
  // (§130) An id Stripe doesn't know is never a decline (the callers clear the stale card first).
  if (isMissing(e)) return cardGone();
  return new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
}

/**
 * (Batch 15 section 9) Stripe's answer was lost (a dropped connection, Stripe's own error): the charge may or may not have happened, so it is NOT a decline. The press's
 * payment stays pending and is checked after 15 minutes (recovery.ts). A key reused with other details (a new amount after an interrupted press) is its own code.
 */
function unknownOutcome(e: unknown) {
  const t = (e as { type?: string }).type ?? "";
  if (t === "StripeIdempotencyError" || t === "idempotency_error") throw new HttpError(409, "idempotency", "The payment key was used with other details.");
  if (t === "StripeConnectionError" || t === "StripeAPIError" || t === "api_error") throw new HttpError(502, "payment_unknown", "We didn't hear back from the payment service.");
}

/**
 * (Owner, Oct 27) Charge the developer's card for a payment their bank reversed (a chargeback adds its amount to what they owe). The money stays with the platform:
 * the tester already got their share with the first charge. A declined card throws a plain sentence, like charge().
 */
export async function chargePlatform(dev: Party, amountCents: number, payKey: string, description: string, mode: ChargeMode = "away"): Promise<{ status: string; stripePaymentIntentId: string | null; clientSecret?: string; checkUrl?: string }> {
  if (amountCents === 0) return { status: "charged", stripePaymentIntentId: null as string | null };
  if (!stripeOn()) return { status: "not_set_up", stripePaymentIntentId: null as string | null };
  try {
    const pi = await getStripe().paymentIntents.create(
      { amount: amountCents, currency: "usd", customer: dev.stripeCustomerId!, payment_method: dev.stripePaymentMethodId!, ...pressParams(mode), confirm: true, description: stripeText(description), metadata: { developerId: dev.id, payKey } },
      { idempotencyKey: `pay-${payKey}` },
    );
    if (piWaits(pi)) return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", stripePaymentIntentId: pi.id as string | null };
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return na;
    if (isMissing(e)) { await forgetCard(dev.id); throw cardGone(); } // (§130) never a decline
    throw chargeError(e, "Your card couldn't be charged. Update your card in Payments and try again.");
  }
}

/**
 * (Owner, Oct 29, batch 23 section 6) Reserve (authorize) an amount on the developer's card without taking it: a PaymentIntent with capture_method "manual", made on-session
 * (the bank may ask for its check, shown inline). Stripe shows it "Uncaptured" until it is captured (the team's Approve) or cancelled. A declined card throws a plain
 * sentence, like charge(). (Owner, Nov 3) `description`: paymentRows.stripeDescription's "Playtest: Reserved for the team's review: …".
 */
export async function authorize(dev: Party, amountCents: number, reservationId: string, description: string): Promise<{ status: "requires_capture" | "requires_action"; stripePaymentIntentId: string; clientSecret?: string; checkUrl?: string }> {
  try {
    const pi = await getStripe().paymentIntents.create(
      { amount: amountCents, currency: "usd", customer: dev.stripeCustomerId!, payment_method: dev.stripePaymentMethodId!, capture_method: "manual", ...pressParams("press"), confirm: true, description: stripeText(description), metadata: { developerId: dev.id, reservationId, purpose: "chargeback-reserve" } },
      { idempotencyKey: `reserve-${reservationId}` },
    );
    if (pi.status === "requires_capture") return { status: "requires_capture", stripePaymentIntentId: pi.id };
    if (piWaits(pi)) return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
    throw new Error(`status ${pi.status}`);
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return na;
    if (isMissing(e)) { await forgetCard(dev.id); throw cardGone(); } // (§130) never a decline
    throw chargeError(e, "Your card couldn't be charged. Update your card in Payments and try again.");
  }
}

/**
 * (Owner, Oct 29, batch 22 section 3) A tester's shares that waited for their payout setup go out on their own once it is done (the account.updated webhook, or the
 * return from Stripe's setup): each charged one is claimed first ("waiting" -> "sending", so two webhooks at once send it once), transferred with an idempotency key,
 * and the tester gets "Your payout setup is done: $X on its way." Nothing waiting: nothing sent, nothing said.
 */
export async function sendWaitingShares(testerId: string) {
  const tester = await db.user.findUnique({ where: { id: testerId } });
  if (!tester?.stripeAccountId || !tester.payoutsReady || !stripeOn()) return 0;
  const waiting = await db.payment.findMany({ where: { testerId, transferStatus: "waiting", status: "charged", testerCents: { gt: 0 } }, orderBy: { createdAt: "asc" } });
  let cents = 0;
  for (const p of waiting) {
    if ((await db.payment.updateMany({ where: { id: p.id, transferStatus: "waiting" }, data: { transferStatus: "sending" } })).count !== 1) continue;
    try {
      const t = await transferShare(p, p.testerCents, tester.stripeAccountId);
      await db.payment.update({ where: { id: p.id }, data: { transferStatus: "sent", stripeTransferId: t.id } });
      cents += p.testerCents;
    } catch (e) {
      console.error("[payouts] waiting share:", (e as Error).message);
      await db.payment.update({ where: { id: p.id }, data: { transferStatus: "waiting" } });
      // (§130) The payout account is unknown to Stripe: cleared, so the shares wait for "Connect a payout account" (the not-ready path).
      if (missingAccount(e)) {
        await forgetPayout(testerId);
        break;
      }
    }
  }
  if (cents > 0) {
    const line = payoutDoneLine(cents);
    await (await import("./notify")).notify(tester.email, line, [line], "/app/payments", { side: "tester", payment: true });
  }
  return cents;
}
/**
 * (Batch 28 §17) A tester's share sent after the charge (a share that waited for payout setup, a payment taken from a chargeback hold's reservation): the transfer names
 * the original charge (`source_transaction`), so Stripe sends it as soon as that charge's money is available, with no platform balance needed (money from a charge is
 * "pending" for days, and a plain transfer would fail with "insufficient available funds"). Created = on its way for the tester. One transfer per share (its key).
 */
export async function transferShare(p: { id: string; stripePaymentIntentId: string | null }, cents: number, destination: string) {
  const stripe = getStripe();
  // (§130) A charge Stripe doesn't know (made in test mode): there's nothing to send from (it stays waiting), and it's not the payout account's fault.
  const pi = p.stripePaymentIntentId ? await stripe.paymentIntents.retrieve(p.stripePaymentIntentId).catch((e) => { if (isMissing(e)) return null; throw e; }) : null;
  const source = typeof pi?.latest_charge === "string" ? pi.latest_charge : pi?.latest_charge?.id;
  if (!source) throw new Error(`no charge to send payment ${p.id}'s share from`);
  return stripe.transfers.create({ amount: cents, currency: "usd", destination, source_transaction: source, metadata: { paymentId: p.id } }, { idempotencyKey: `share-${p.id}` });
}

/** (Batch 28 §17) The daily job: shares still waiting for a tester whose payout setup is done (a transfer that failed earlier) are sent again. */
export async function resendWaitingShares() {
  if (!stripeOn()) return 0;
  const waiting = await db.payment.findMany({ where: { transferStatus: "waiting", status: "charged", testerCents: { gt: 0 } }, select: { testerId: true }, distinct: ["testerId"] });
  const ready = await db.user.findMany({ where: { id: { in: waiting.map((p) => p.testerId) }, payoutsReady: true, stripeAccountId: { not: null } }, select: { id: true } });
  let cents = 0;
  for (const { id } of ready) cents += await sendWaitingShares(id).catch(() => 0);
  return cents;
}

/** "Your payout setup is done: $8.00 on its way." */
export const payoutDoneLine = (cents: number) => `Your payout setup is done: ${money(cents)} on its way.`;

/** Developer: Stripe Checkout in setup mode to save a card. */
export async function cardSetupUrl(user: Party, base: string) {
  const stripe = getStripe();
  const newCustomer = async () => {
    const id = (await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: id } });
    return id;
  };
  const session = (customer: string) => stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    allowed_payment_method_types: CARD_TYPES,
    success_url: `${base}/api/payments/card-saved?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/app/payments`,
  });
  const customer = user.stripeCustomerId ?? (await newCustomer());
  try {
    return (await session(customer)).url!;
  } catch (e) {
    // (§130) The saved customer is unknown to Stripe: the stale card is cleared and the card is saved on a new customer.
    if (!isMissing(e) || !user.stripeCustomerId) throw e;
    await forgetCard(user.id);
    return (await session(await newCustomer())).url!;
  }
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
  const paymentMethod = await stripe.paymentMethods.retrieve(pm);
  await db.user.update({ where: { id: userId }, data: { stripePaymentMethodId: pm, cardExpMonth: paymentMethod.card?.exp_month ?? null, cardExpYear: paymentMethod.card?.exp_year ?? null } });
  // (Owner, Oct 28, batch 16 section 27) "Card: Visa ending 1111 → Visa ending 4242" for a Payments page open in another tab or device.
  if (user.stripePaymentMethodId !== pm) {
    const label = async (id: string | null) => (id ? cardLabel(await stripe.paymentMethods.retrieve(id).then((x) => x.card ?? {}, () => ({}))) : "no card");
    await logAccountChange(userId, "", { scopes: ["payments"], field: "card", label: "Card", before: await label(user.stripePaymentMethodId), after: await label(pm) });
  }
  // (Owner, Nov 2, batch 35 §117 rule 1) ONE CARD IN PLAY: every bank check still waiting (made on the old card) is cancelled at Stripe and each charge made while
  // away is tried again on the new card at once.
  if (user.stripePaymentMethodId !== pm) await (await import("./owedOnce")).newCardChecks(userId).catch((e) => console.error("[card] new card checks:", (e as Error).message));
  // (Owner, Oct 29, batch 11 section 4) A new card during a hold: what is owed is charged on it at once (one payment for the total, batch 35 §117). (Owner, Nov 3,
  // §145) This is the only automatic charge of what's owed: there are no daily retries.
  return (await import("./holds")).retryOwed(userId).catch((e) => { console.error("[retry] card saved:", (e as Error).message); return null; });
}

/** (Batch 34 §6) Refresh saved-card expiry from Stripe and send each threshold once. Missing cards are handled only when a charge fails. */
export async function cardExpiryReminders(now = new Date()) {
  const stripe = getStripe();
  const users = await db.user.findMany({ where: { isDeveloper: true, deletedAt: null, stripePaymentMethodId: { not: null } }, select: { id: true, email: true, stripePaymentMethodId: true, cardExpMonth: true, cardExpYear: true } });
  let sent = 0;
  for (const user of users) {
    let pm: Stripe.PaymentMethod;
    try { pm = await stripe.paymentMethods.retrieve(user.stripePaymentMethodId!); }
    catch (e) {
      console.error("[card expiry] refresh failed:", (e as Error).message);
      if (isMissing(e)) await forgetCard(user.id); // (§130) no card any more: no reminder; Payments shows "Add a card"
      continue;
    }
    const month = pm.card?.exp_month, year = pm.card?.exp_year;
    if (!month || !year) continue;
    if (month !== user.cardExpMonth || year !== user.cardExpYear) await db.user.update({ where: { id: user.id }, data: { cardExpMonth: month, cardExpYear: year } });
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const expiryDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const days = Math.round((expiryDay - today) / 86_400_000);
    if (![30, 7, 0].includes(days)) continue;
    const mark = days === 30 ? "month" : days === 7 ? "week" : "day";
    const reminder = `card-expiry:${year}-${month}:${mark}`;
    if (await db.notification.findFirst({ where: { userId: user.id, reminderKey: reminder }, select: { id: true } })) continue;
    const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    const line = `Your card ending ${pm.card?.last4 ?? "????"} expires at the end of ${monthName}: update it in Payments.`;
    const { bell } = await import("./notify");
    await bell(user.id, line, "/app/payments", undefined, { side: "developer", payment: true, reminder });
    sent++;
  }
  return sent;
}

/** Tester: Stripe Connect Express onboarding link. */
export async function payoutSetupUrl(user: Party, base: string) {
  const stripe = getStripe();
  const newAccount = async () => {
    const id = (await stripe.accounts.create({ type: "express", email: user.email, capabilities: { transfers: { requested: true } }, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: id, payoutsReady: false } });
    return id;
  };
  const link = (account: string) => stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url: `${base}/app/payments`, return_url: `${base}/api/payments/payout-return` });
  const account = user.stripeAccountId ?? (await newAccount());
  try {
    return (await link(account)).url;
  } catch (e) {
    // (§130) The saved account is unknown to Stripe: cleared, and onboarding starts on a new account.
    if (!isMissing(e) || !user.stripeAccountId) throw e;
    await forgetPayout(user.id);
    return (await link(await newAccount())).url;
  }
}

/**
 * (Owner, Oct 30, batch 15 section 4) A tester's Express account is ready for payouts when Stripe has payouts on and the transfers capability is active. These accounts only
 * RECEIVE money, so charges_enabled doesn't matter. The account.updated webhook uses the same rule.
 */
export const payoutReadyOf = (a: { payouts_enabled?: boolean | null; capabilities?: { transfers?: string | null } | null }) => !!a.payouts_enabled && a.capabilities?.transfers === "active";

export async function refreshPayoutStatus(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.stripeAccountId) return false;
  let a: Stripe.Account;
  try {
    a = await getStripe().accounts.retrieve(user.stripeAccountId);
  } catch (e) {
    // (§130) The account is unknown to Stripe: cleared (not ready), so the tester sees "Connect a payout account" again.
    if (!isMissing(e)) throw e;
    await forgetPayout(userId);
    if (user.payoutsReady) await logAccountChange(userId, "", { scopes: ["payments"], field: "payout", label: "Payout account", before: "connected", after: "not connected" });
    return false;
  }
  const ready = payoutReadyOf(a);
  await db.user.update({ where: { id: userId }, data: { payoutsReady: ready } });
  // (Batch 16 section 27) For a Payments page open in another tab or device.
  if (ready !== user.payoutsReady) await logAccountChange(userId, "", { scopes: ["payments"], field: "payout", label: "Payout account", before: user.payoutsReady ? "connected" : "not connected", after: ready ? "connected" : "not connected" });
  // (Batch 22 section 3) Shares that waited for the setup go out now.
  if (ready) await sendWaitingShares(userId);
  return ready;
}

