import type Stripe from "stripe";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { HttpError } from "./http";
import { logEvent } from "./live";
import { notify } from "./notify";
import { bankReturnUrl, checkUrlOf, fakeOn, getStripe, stripeOn } from "./stripe";
import { CARD_NOT_VERIFIED } from "@/lib/rules";
import { liftHoldIfClear, owed } from "./holds";

// (Owner, Oct 26) A CHARGEBACK is a payment hold with extra steps. The developer's account goes on a payment hold (as for a failed payment). To lift it:
//   (a) re-verify a card with 3D Secure (a Stripe SetupIntent with payment_method_options.card.request_three_d_secure = "any"; in fake / dev
//       mode, with no Stripe, it is simulated as a success),
//   (b) pay what they owe,
//   (c) get the admin's approval (the admin sees "card verified ✓/✗, owed paid ✓/✗" and an Approve button).
// Paying alone never lifts a chargeback hold; the developer's banner says which steps remain.

export type ChargebackSteps = {
  cardVerified: boolean;
  owedPaid: boolean;
  owedCents: number;
  approved: boolean;
  /** What is still to do, in the order they are shown ("Verify a card with 3D Secure", "Pay what you owe ($8.00)", "Wait for the team's approval"). */
  remaining: string[];
};

/** The step status of a developer on a chargeback hold; null when the account is not on one. */
export async function chargebackSteps(devId: string): Promise<ChargebackSteps | null> {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true } });
  if (!u?.holdStartedAt || u.holdReason !== "chargeback") return null;
  const owing = await owed(devId);
  const owedCents = owing.reduce((a, p) => a + p.amountCents, 0);
  const cardVerified = !!u.chargebackCardVerifiedAt, owedPaid = owing.length === 0, approved = !!u.chargebackApprovedAt;
  const remaining = [
    ...(cardVerified ? [] : ["Verify a card with 3D Secure"]),
    ...(owedPaid ? [] : [`Pay what you owe (${money(owedCents)})`]),
    ...(approved ? [] : ["Wait for the team's approval"]),
  ];
  return { cardVerified, owedPaid, owedCents, approved, remaining };
}

const simulated = () => !stripeOn() || fakeOn();

async function markVerified(userId: string, now = new Date()) {
  await db.user.update({ where: { id: userId }, data: { chargebackCardVerifiedAt: now } });
}

/**
 * Step (a), start: a SetupIntent that asks for 3D Secure on any card. Returns the client secret for Stripe's card form (the card details never reach
 * this site). Without Stripe (dev) or with the local fake, the verification is simulated and succeeds at once.
 */
export async function startCardVerification(user: { id: string; email: string; stripeCustomerId: string | null }, opts: { standIn?: boolean } = {}) {
  const steps = await chargebackSteps(user.id);
  if (!steps) throw new HttpError(409, "no_chargeback_hold", "Your account isn't on a chargeback hold, so there's nothing to verify.");
  if (simulated()) {
    // (Batch 17 §11) The page's "Verify a card" draws the stand-in for the bank's check under the button: verified only on its Confirm (finishCardCheck).
    if (opts.standIn) return { simulated: true as const, verified: false, standIn: true };
    await markVerified(user.id);
    return { simulated: true as const, verified: true };
  }
  const stripe = getStripe();
  let customer = user.stripeCustomerId;
  if (!customer) {
    customer = (await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })).id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
  }
  const si = await stripe.setupIntents.create({
    customer,
    usage: "off_session",
    allowed_payment_method_types: ["card"],
    payment_method_options: { card: { request_three_d_secure: "any" } },
    metadata: { userId: user.id, purpose: "chargeback-verify" },
  });
  return { simulated: false as const, clientSecret: si.client_secret!, setupIntentId: si.id, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "" };
}

/**
 * (Batch 17 §11) Step (a), the inline check: the card typed in the page's card form is confirmed on the SetupIntent here with return_url, so the bank's check (3D Secure)
 * is a page the developer's page shows inline, under "Verify a card" (`checkUrl`); null when the card was verified without one.
 */
export async function confirmCardCheck(userId: string, setupIntentId: string, paymentMethodId: string) {
  if (simulated()) throw new HttpError(409, "simulated", "There's no card form to confirm here.");
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  if (si.metadata?.userId !== userId || si.metadata?.purpose !== "chargeback-verify") throw new HttpError(403, "bad_setup", "That card check belongs to another account.");
  try {
    const done = await stripe.setupIntents.confirm(setupIntentId, { payment_method: paymentMethodId, return_url: bankReturnUrl() });
    return { setupIntentId, checkUrl: checkUrlOf(done) ?? null };
  } catch (e) {
    console.error("[stripe] card check:", (e as Error).message);
    throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED);
  }
}

/** (Batch 17 §11) The inline check ended: the stand-in's Confirm / Cancel (fake Stripe), or the bank's page finished (Stripe decides how). */
export async function finishCardCheck(userId: string, setupIntentId: string, simulate?: unknown) {
  if (simulated() && simulate !== "succeeded") throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED);
  return finishCardVerification(userId, setupIntentId);
}

/**
 * Step (a), finish: Stripe says the SetupIntent succeeded (and, when it shows how the card was checked, that 3D Secure authenticated it). The card
 * becomes the card on file. Only a check made after the hold began, for this account, counts.
 */
export async function finishCardVerification(userId: string, setupIntentId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.holdStartedAt || user.holdReason !== "chargeback") throw new HttpError(409, "no_chargeback_hold", "Your account isn't on a chargeback hold.");
  if (simulated()) {
    await markVerified(userId);
    return { verified: true };
  }
  const stripe = getStripe();
  const si = (await stripe.setupIntents.retrieve(setupIntentId, { expand: ["latest_attempt"] })) as Stripe.SetupIntent;
  if (si.metadata?.userId !== userId || si.metadata?.purpose !== "chargeback-verify" || (user.stripeCustomerId && si.customer !== user.stripeCustomerId))
    throw new HttpError(403, "bad_setup", "That card check belongs to another account.");
  if (si.created * 1000 < user.holdStartedAt.getTime() - 60_000) throw new HttpError(409, "old_setup", "That card check is from before the hold. Verify a card again.");
  if (si.status !== "succeeded") throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED);
  const attempt = typeof si.latest_attempt === "object" ? (si.latest_attempt as Stripe.SetupAttempt | null) : null;
  const tds = attempt?.payment_method_details?.card?.three_d_secure;
  if (tds && tds.result !== "authenticated" && tds.result !== "attempt_acknowledged") throw new HttpError(409, "not_verified", "The bank didn't confirm it was you. Try again or use another card.");
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!pm) throw new HttpError(400, "no_card", "The card wasn't saved. Try again.");
  if (user.stripeCustomerId) await stripe.customers.update(user.stripeCustomerId, { invoice_settings: { default_payment_method: pm } });
  await db.user.update({ where: { id: userId }, data: { stripePaymentMethodId: pm, chargebackCardVerifiedAt: new Date() } });
  // (Batch 11 section 4) The verified card is a new card: what is owed is retried on it at once.
  await (await import("./holds")).retryOwed(userId, new Date(), "card").catch((e) => console.error("[retry] card verified:", (e as Error).message));
  return { verified: true };
}

/**
 * Step (c): the admin approves lifting the chargeback hold. Allowed only when the card is verified and what is owed is paid ("card verified ✓,
 * owed paid ✓"); it closes the open chargebacks and lifts the hold (tests resume, every clock moves on by the pause).
 */
export async function approveChargebackHold(devId: string) {
  const steps = await chargebackSteps(devId);
  if (!steps) throw new HttpError(409, "no_chargeback_hold", "That account isn't on a chargeback hold.");
  if (!steps.cardVerified || !steps.owedPaid)
    throw new HttpError(409, "steps_missing", `Not yet: ${[steps.cardVerified ? "" : "the card isn't verified", steps.owedPaid ? "" : `${money(steps.owedCents)} is still owed`].filter(Boolean).join(" and ")}.`);
  if (steps.approved) throw new HttpError(409, "already", "That hold was already approved.");
  await db.user.update({ where: { id: devId }, data: { chargebackApprovedAt: new Date() } });
  for (const p of await db.payment.findMany({ where: { developerId: devId, chargeback: "open" } })) {
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "resolved" } });
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
    if (c) await logEvent(c.testId, "chargeback", `The team resolved the bank reversal of your ${money(p.amountCents)} payment`, c.id);
  }
  const lifted = await liftHoldIfClear(devId);
  if (!lifted) {
    const u = await db.user.findUniqueOrThrow({ where: { id: devId } });
    await notify(u.email, "The team approved lifting your hold", ["The team approved lifting your hold."], "/app/payments", { payment: true, group: "admindecision" });
  }
  return { ok: true, lifted };
}

/** The admin's list: every developer on a chargeback hold with the step status. */
export async function chargebackHolds() {
  const devs = await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: "chargeback" }, orderBy: { holdStartedAt: "asc" } });
  const out = [];
  for (const d of devs) {
    const steps = (await chargebackSteps(d.id))!;
    const cbs = await db.payment.findMany({ where: { developerId: d.id, chargeback: "open" } });
    out.push({ dev: d, steps, chargebacks: cbs });
  }
  return out;
}
