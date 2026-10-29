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
  paymentIntents: {
    create: async (p: { payment_method?: string; amount: number; off_session?: boolean; capture_method?: string; metadata?: { payKey?: string } }) => {
      refuseRemoved(p, ["payment_method_types"]);
      if (p.payment_method === "pm_card_declined" || (p.payment_method === "pm_card_partial" && p.amount === 1500)) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", rawType: "card_error", code: "card_declined" });
      const id = `pi_fake_${Date.now()}_${++fakeN}`;
      if (p.metadata?.payKey) fakeByKey.set(p.metadata.payKey, id);
      if (p.capture_method === "manual") fakeManual.add(id);
      if (!fakePis.has(id)) fakePis.set(id, "succeeded");
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
    cancel: async (id: string) => { fakePis.set(id, "canceled"); return { id, status: "canceled" }; },
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
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1") throw new HttpError(503, "payments_off", "Payments are switched off right now. Try again later.");
  return new Stripe(key);
}

type Party = { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean; testerSuspendedAt?: Date | null };

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
export type NeedsAction = { status: "requires_action"; stripePaymentIntentId: string; clientSecret: string; /** (Batch 17 §11) the bank's check page, shown inline */ checkUrl?: string };
/** (Batch 17 §11) Where the bank's check returns inside the page's inline frame (a tiny page that tells the page it finished). */
export const bankReturnUrl = () => `${appUrl()}/api/payments/bank-return`;
/** (Batch 17 §11) The bank's own check page, to show inline (a PaymentIntent or SetupIntent confirmed with return_url waits on "redirect_to_url"). */
export const checkUrlOf = (x: { next_action?: { type?: string; redirect_to_url?: { url?: string | null } | null } | null }) =>
  x.next_action?.type === "redirect_to_url" ? x.next_action.redirect_to_url?.url ?? undefined : undefined;
function needsActionOf(e: unknown): NeedsAction | null {
  const x = e as { code?: string; raw?: { payment_intent?: { id?: string; client_secret?: string } }; payment_intent?: { id?: string; client_secret?: string } };
  const pi = x?.raw?.payment_intent ?? x?.payment_intent;
  if (x?.code === "authentication_required" && pi?.id) return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "" };
  return null;
}
// (Batch 17 §11) A press is confirmed with return_url, so the bank's check (if it asks) is a page the developer's page can show inline, under the button.
// (API 2026-09-30) PaymentIntents take `allowed_payment_method_types`; the old `payment_method_types` is refused by Stripe, so every press failed.
// A card saved through Stripe's page may be a Link payment method (card-backed, instant), so both are allowed; Add a card saves only these two kinds.
export const CARD_TYPES: ("card" | "link")[] = ["card", "link"];
const pressParams = (mode: ChargeMode) => (mode === "away" ? { off_session: true } : { allowed_payment_method_types: CARD_TYPES, return_url: bankReturnUrl() });

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
  const stripe = getStripe();
  const destination = tester.stripeAccountId && tester.payoutsReady ? tester.stripeAccountId : null;
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
    if (pi.status === "requires_action") return { ...split, transferStatus: destination ? "sent" : "waiting", status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", ...split, transferStatus: destination ? "sent" : "waiting", stripePaymentIntentId: pi.id };
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return { ...split, transferStatus: destination ? "sent" : "waiting", ...na };
    throw chargeError(e, "Your card couldn't be charged. Update your card in Payments and press Pay again.");
  }
}

/** (Batch 15 section 41, M1) Shown when Stripe fails for any reason that isn't the card itself: nothing was charged, no hold, nothing owed. */
export const PAYMENTS_PROBLEM = "Payments are having a problem right now. Nothing was charged; try again shortly.";
/** Only Stripe's card errors are declines (a hold, an owed payment). */
export const isCardError = (e: unknown) => {
  const x = e as { type?: string; rawType?: string };
  return x?.type === "StripeCardError" || x?.type === "card_error" || x?.rawType === "card_error";
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
  if (isCardError(e)) return new HttpError(402, "card_failed", declined);
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
      { amount: amountCents, currency: "usd", customer: dev.stripeCustomerId!, payment_method: dev.stripePaymentMethodId!, ...pressParams(mode), confirm: true, description, metadata: { developerId: dev.id, payKey } },
      { idempotencyKey: `pay-${payKey}` },
    );
    if (pi.status === "requires_action") return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
    if (pi.status !== "succeeded") throw new Error(`status ${pi.status}`);
    return { status: "charged", stripePaymentIntentId: pi.id as string | null };
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return na;
    throw chargeError(e, "Your card couldn't be charged. Update your card in Payments and try again.");
  }
}

/**
 * (Owner, Oct 29, batch 23 section 6) Reserve (authorize) an amount on the developer's card without taking it: a PaymentIntent with capture_method "manual", made on-session
 * (the bank may ask for its check, shown inline). Stripe shows it "Uncaptured" until it is captured (the team's Approve) or cancelled. A declined card throws a plain
 * sentence, like charge().
 */
export async function authorize(dev: Party, amountCents: number, reservationId: string): Promise<{ status: "requires_capture" | "requires_action"; stripePaymentIntentId: string; clientSecret?: string; checkUrl?: string }> {
  try {
    const pi = await getStripe().paymentIntents.create(
      { amount: amountCents, currency: "usd", customer: dev.stripeCustomerId!, payment_method: dev.stripePaymentMethodId!, capture_method: "manual", ...pressParams("press"), confirm: true, description: "Playtest: what you owe, reserved until the team approves lifting your hold", metadata: { developerId: dev.id, reservationId, purpose: "chargeback-reserve" } },
      { idempotencyKey: `reserve-${reservationId}` },
    );
    if (pi.status === "requires_capture") return { status: "requires_capture", stripePaymentIntentId: pi.id };
    if (pi.status === "requires_action") return { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret ?? "", checkUrl: checkUrlOf(pi) };
    throw new Error(`status ${pi.status}`);
  } catch (e) {
    const na = needsActionOf(e);
    if (na) return na;
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
    }
  }
  if (cents > 0) {
    const line = payoutDoneLine(cents);
    await (await import("./notify")).notify(tester.email, line, [line], "/app/payments", { payment: true });
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
  const pi = p.stripePaymentIntentId ? await stripe.paymentIntents.retrieve(p.stripePaymentIntentId) : null;
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
  let customer = user.stripeCustomerId;
  if (!customer) {
    customer = (await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
  }
  const s = await stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    allowed_payment_method_types: CARD_TYPES,
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
  // (Owner, Oct 28, batch 16 section 27) "Card: Visa ending 1111 → Visa ending 4242" for a Payments page open in another tab or device.
  if (user.stripePaymentMethodId !== pm) {
    const label = async (id: string | null) => (id ? cardLabel(await stripe.paymentMethods.retrieve(id).then((x) => x.card ?? {}, () => ({}))) : "no card");
    await logAccountChange(userId, "", { scopes: ["payments"], field: "card", label: "Card", before: await label(user.stripePaymentMethodId), after: await label(pm) });
  }
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
  // (Batch 16 section 27) For a Payments page open in another tab or device.
  if (ready !== user.payoutsReady) await logAccountChange(userId, "", { scopes: ["payments"], field: "payout", label: "Payout account", before: user.payoutsReady ? "connected" : "not connected", after: ready ? "connected" : "not connected" });
  // (Batch 22 section 3) Shares that waited for the setup go out now.
  if (ready) await sendWaitingShares(userId);
  return ready;
}

