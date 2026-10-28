import type Stripe from "stripe";
import { db } from "@/lib/db";
import { HttpError } from "./http";
import { notify } from "./notify";
import { chargePlatform, getStripe, stripeOn, type NeedsAction } from "./stripe";
import { receipt } from "./payments";
import { recordEvent } from "./tests";
import {
  DELETE_ENDS_SUBSCRIPTION, FREE_NOTICE_DAYS, MAX_OPEN_TESTS, TOO_MANY_OPEN_LINE, RETRY_DAYS, SECOND_TEST_LINE, SUBSCRIBE_WAITS, SUBSCRIPTION_CENTS, SUBSCRIPTION_ENDED, SUBSCRIPTION_PRICE,
  fmtSubDay, launchFrom, perkLine, periodEnd, subscribed, type Launch, type Perk,
} from "@/lib/subscription";

// (Owner, Oct 28, batch 8) The developer subscription, $7/month.
//
// Billing: with a real Stripe key the subscription is a Stripe Billing subscription (renewals, declines and the end arrive through the webhook: invoice.paid,
// invoice.payment_failed, customer.subscription.deleted). Without one (or with the tests' stand-in) it is "manual": the daily job renews it, charging the saved
// card like any other lean charge (or recording it as "payments not set up"), retries a declined renewal daily for RETRY_DAYS, then lets it lapse.
//
// Holds and suspensions pause billing: subscriptionPausedAt is stored when the first one starts; when the last one lifts the paid days left resume, i.e. the
// next renewal (and the monthly anchor) move later by the paused time. With Stripe Billing the same is done by `pause_collection: { behavior: "void" }` while it
// lasts, then on the lift clearing pause_collection and setting `trial_end` to the moved renewal date (proration "none"), which pushes the next billing date
// without charging for the gap.

const DAY = 86_400_000;
type Dev = { id: string; email: string; name: string };
const TOLD = (days: number) => `free-told-${days}`;

/** Stripe Billing only with a real key (the tests' stand-in and the local fake only do one-off charges). */
const billingOn = () => !!process.env.STRIPE_SECRET_KEY?.trim() && stripeOn();
const appState = async (key: string) => (await db.appState.findUnique({ where: { key } }))?.value ?? null;
const setState = (key: string, value: string) => db.appState.upsert({ where: { key }, update: { value }, create: { key, value } });

/**
 * (Owner, Oct 29, batch 11) Free during launch comes from the server configuration: FREE_UNTIL (an ISO date). Unset (as now): free with no end. There is no admin
 * setting any more; the daily job sends the 30-day and 7-day notices for the configured date (set it at least 30 days ahead).
 */
export async function launchState(now = new Date()): Promise<Launch> {
  return launchFrom(process.env.FREE_UNTIL?.trim() || null, now);
}

type SubRow = Parameters<typeof subscribed>[0] & { id: string; holdStartedAt?: Date | null; suspendedAt?: Date | null };
/** The perks: a subscription, or everything free during launch. */
export async function hasPerks(u: SubRow, now = new Date()) {
  return subscribed(u, now) || (await launchState(now)).free;
}
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

/** Refuse a NEW use of a perk on the free plan (blue notice with a Payments link). Uses on an existing test (an Approved-only test's applications) are never refused. */
export async function requirePerk(devId: string, perk: Perk) {
  if (await hasPerks(await userOf(devId))) return;
  throw new HttpError(409, "subscription", perkLine(perk), { perk });
}

/** Tests that count as open: Open, Full or Paused (status "open"). Drafts, Stopped and Closed don't. */
export const openTestCount = (devId: string, exceptId = "") => db.test.count({ where: { developerId: devId, status: "open", ...(exceptId ? { id: { not: exceptId } } : {}) } });
/**
 * (Section 2) The free plan runs one open test at a time. (Owner, Oct 29, batch 12 section 4) Subscribers (and everyone during a free launch) at most MAX_OPEN_TESTS (10).
 * Counted on the server at the press: a test stopped in another tab meanwhile simply lets the post through (a drop in the count is never a stop-once reason).
 */
export async function canOpenAnother(devId: string, exceptId = "") {
  const open = await openTestCount(devId, exceptId);
  if (await hasPerks(await userOf(devId))) {
    if (open >= MAX_OPEN_TESTS) throw new HttpError(409, "too_many_open", TOO_MANY_OPEN_LINE);
    return;
  }
  if (open >= 1) throw new HttpError(409, "subscription", SECOND_TEST_LINE, { perk: "several" });
}

async function tell(dev: Dev, line: string, always = false) {
  await notify(dev.email, line, [line], "/app/payments#subscription", { always, payment: true, group: "payhold" });
}

/** Record one subscription charge as a payment row (the receipts list; a chargeback on it starts a chargeback hold like any other). */
async function recordCharge(dev: Dev, r: { status: string; stripePaymentIntentId: string | null }, cents = SUBSCRIPTION_CENTS) {
  await db.payment.create({ data: { kind: "subscription", developerId: dev.id, testerId: dev.id, amountCents: cents, feeCents: cents, testerCents: 0, transferStatus: "none", settledAt: new Date(), ...r } });
  await receipt(dev.email, `your subscription (${SUBSCRIPTION_PRICE})`, cents, r.status, "/app/payments#subscription");
}

let productId: string | null = null;
async function stripeProduct(stripe: Stripe) {
  productId = productId ?? (await appState("stripe-sub-product"));
  if (!productId) {
    productId = (await stripe.products.create({ name: "Playtest developer subscription" })).id;
    await setState("stripe-sub-product", productId);
  }
  return productId;
}

/** Subscribe for $7/month (needs a saved card). During a free launch with an end date it starts now and is first charged on that date. */
export async function subscribe(dev: Dev, now = new Date()) {
  const u = await userOf(dev.id);
  if (!u.isDeveloper) throw new HttpError(403, "not_developer", "Only developers subscribe.");
  // (Section 8 item 3) Refused during a hold or a suspension.
  if (u.holdStartedAt || u.suspendedAt) throw new HttpError(409, "restricted", SUBSCRIBE_WAITS);
  if (subscribed(u, now)) throw new HttpError(409, "already", u.subscriptionCanceling ? "Press Keep my subscription to keep it." : "You're already subscribed.");
  const launch = await launchState(now);
  if (launch.free && !launch.until) throw new HttpError(409, "free", "Everything is free during launch: there's nothing to subscribe to yet.");
  if (stripeOn() && (!u.stripeCustomerId || !u.stripePaymentMethodId)) throw new HttpError(409, "no_card", "Add a card first, then subscribe.");
  const startsCharging = launch.free && launch.until ? launch.until : now;
  let id = "manual";
  if (billingOn()) {
    const stripe = getStripe();
    try {
      // (Batch 11) On-session: when the bank wants the developer to confirm the first payment, the page shows its pop-up (default_incomplete keeps it waiting).
      const s = await stripe.subscriptions.create({
        customer: u.stripeCustomerId!, default_payment_method: u.stripePaymentMethodId!, payment_behavior: "default_incomplete", metadata: { userId: u.id },
        items: [{ price_data: { currency: "usd", product: await stripeProduct(stripe), unit_amount: SUBSCRIPTION_CENTS, recurring: { interval: "month" } } }],
        expand: ["latest_invoice.payment_intent"],
        ...(startsCharging > now ? { trial_end: Math.floor(startsCharging.getTime() / 1000) } : {}),
      }, { idempotencyKey: `sub-${u.id}-${now.toISOString().slice(0, 10)}` });
      id = s.id;
      const pi = (s.latest_invoice as unknown as { payment_intent?: { id: string; status: string; client_secret: string } } | null)?.payment_intent;
      if (s.status === "incomplete" && pi?.status === "requires_action") {
        const row = await db.payment.create({ data: { kind: "subscription", developerId: u.id, testerId: u.id, amountCents: SUBSCRIPTION_CENTS, feeCents: SUBSCRIPTION_CENTS, testerCents: 0, transferStatus: "none", status: "needs_action", note: `sub:${s.id}` } });
        return (await import("./confirm")).pressAction(row.id, { status: "requires_action", stripePaymentIntentId: pi.id, clientSecret: pi.client_secret });
      }
      if (s.status === "incomplete") {
        await stripe.subscriptions.cancel(s.id).catch(() => null);
        throw new Error("incomplete");
      }
    } catch (e) {
      throw new HttpError(402, "card_failed", "Your card was declined, so you're not subscribed. Update your card and try again.", { stripe: (e as Error).message });
    }
  } else if (startsCharging <= now) {
    // (Section 4) A declined subscription payment never starts a hold. (Batch 11) The developer's own press: on-session, so the bank may ask them to confirm.
    const r = await chargePlatform(u, SUBSCRIPTION_CENTS, `sub-${u.id}-${now.toISOString().slice(0, 10)}`, `Playtest subscription (${SUBSCRIPTION_PRICE})`, "press").catch(() => null);
    if (!r) throw new HttpError(402, "card_failed", "Your card was declined, so you're not subscribed. Update your card and try again.");
    if (r.status === "requires_action") {
      const row = await db.payment.create({ data: { kind: "subscription", developerId: u.id, testerId: u.id, amountCents: SUBSCRIPTION_CENTS, feeCents: SUBSCRIPTION_CENTS, testerCents: 0, transferStatus: "none", status: "needs_action", note: "sub:manual" } });
      return (await import("./confirm")).pressAction(row.id, r as NeedsAction);
    }
    await recordCharge(u, r);
  }
  return activate(u, now, id, startsCharging);
}

/** The subscription starts (after the first payment, or straight away during a free launch). */
async function activate(u: Dev, now: Date, id: string, startsCharging: Date) {
  const renews = startsCharging > now ? startsCharging : periodEnd(now, now);
  await db.user.update({
    where: { id: u.id },
    data: { subscriptionStatus: "active", subscriptionId: id, subscribedAt: now, subscriptionAnchorAt: startsCharging, subscriptionRenewsAt: renews, subscriptionCanceling: false, subscriptionEndedAt: null, subscriptionEndReason: "", subscriptionPastDueAt: null, subscriptionPausedAt: null },
  });
  await tell(u, startsCharging > now ? `You're subscribed (${SUBSCRIPTION_PRICE}): the first charge is on ${fmtSubDay(startsCharging)}` : `You're subscribed (${SUBSCRIPTION_PRICE}), renewing ${fmtSubDay(renews)}`);
  return { subscribed: true, renewsAt: renews };
}

/**
 * (Owner, Oct 29, batch 11) The bank confirmed a subscription payment: a Subscribe press (needs_action: the subscription starts now) or a renewal made while away
 * (needs_confirmation: it renews). Called from /api/payments/confirm.
 */
export async function subscriptionConfirmed(paymentId: string, now = new Date()) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const u = await userOf(p.developerId);
  const first = p.status === "needs_action";
  await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: now, actionPi: null, actionBy: null, stripePaymentIntentId: p.actionPi } });
  await receipt(u.email, `your subscription (${SUBSCRIPTION_PRICE})`, p.amountCents, "charged", "/app/payments#subscription");
  if (first) return activate(u, now, p.note.startsWith("sub:") && p.note !== "sub:manual" ? p.note.slice(4) : "manual", now);
  await renewed(u.id, now);
  return { subscribed: true };
}

/** Cancel any time (also during a hold or suspension: Payments stays open). It lasts until the end of the paid month; no refunds. */
export async function cancelSubscription(dev: Dev, now = new Date()) {
  const u = await userOf(dev.id);
  if (!subscribed(u, now) || u.subscriptionCanceling) throw new HttpError(409, "none", "There's no subscription to cancel.");
  if (billingOn() && u.subscriptionId && u.subscriptionId !== "manual") await getStripe().subscriptions.update(u.subscriptionId, { cancel_at_period_end: true });
  await db.user.update({ where: { id: u.id }, data: { subscriptionCanceling: true } });
  if (u.subscriptionRenewsAt) await tell(u, `Subscription cancelled: you can use the perks until ${fmtSubDay(u.subscriptionRenewsAt)}`);
  return { cancelled: true, until: u.subscriptionRenewsAt };
}

/** "Keep my subscription": undo a cancel before the paid month ends (charges nothing, so it works during a hold too). */
export async function keepSubscription(dev: Dev, now = new Date()) {
  const u = await userOf(dev.id);
  if (!u.subscriptionCanceling || !subscribed(u, now)) throw new HttpError(409, "none", "There's nothing to keep.");
  if (billingOn() && u.subscriptionId && u.subscriptionId !== "manual") await getStripe().subscriptions.update(u.subscriptionId, { cancel_at_period_end: false });
  await db.user.update({ where: { id: u.id }, data: { subscriptionCanceling: false } });
  return { kept: true };
}

/** The subscription ended (the cancel ran out, a renewal lapsed, the account was deleted): back to the free plan; running tests carry on; an open page stops once. */
export async function endSubscription(devId: string, reason: "cancelled" | "lapsed" | "deleted", now = new Date()) {
  const ended = await db.user.updateMany({ where: { id: devId, subscriptionStatus: { in: ["active", "past_due"] } }, data: { subscriptionStatus: "ended", subscriptionEndedAt: now, subscriptionEndReason: reason, subscriptionCanceling: false, subscriptionPausedAt: null, subscriptionPastDueAt: null } });
  if (!ended.count) return false;
  for (const t of await db.test.findMany({ where: { developerId: devId, status: { not: "stopped" } }, select: { id: true } })) {
    await db.$transaction((tx) => recordEvent(tx, t.id, "subscription", SUBSCRIPTION_ENDED, false));
  }
  return true;
}

/** (Section 5) Deleting the account (or the team deleting it) ends the subscription at once, with no refund. */
export async function endOnDelete(devId: string) {
  const u = await userOf(devId);
  if (!subscribed(u)) return false;
  if (billingOn() && u.subscriptionId && u.subscriptionId !== "manual") await getStripe().subscriptions.cancel(u.subscriptionId).catch(() => null);
  return endSubscription(devId, "deleted");
}
export { DELETE_ENDS_SUBSCRIPTION };

/** (Section 5) A hold or a suspension started: billing pauses (no renewal is charged while it lasts). */
export async function pauseBilling(devId: string, now = new Date()) {
  const u = await userOf(devId);
  if (!subscribed(u, now) || u.subscriptionPausedAt) return false;
  if (billingOn() && u.subscriptionId && u.subscriptionId !== "manual") await getStripe().subscriptions.update(u.subscriptionId, { pause_collection: { behavior: "void" } }).catch((e) => console.error("[stripe] pause:", e.message));
  await db.user.update({ where: { id: devId }, data: { subscriptionPausedAt: now } });
  return true;
}

/** (Section 5) The last hold or suspension lifted: the paid days left resume (the next renewal moves later by the paused time). */
export async function resumeBilling(devId: string, now = new Date()) {
  const u = await userOf(devId);
  if (!u.subscriptionPausedAt || u.holdStartedAt || u.suspendedAt) return false;
  const gap = Math.max(0, now.getTime() - u.subscriptionPausedAt.getTime());
  const later = (d: Date | null) => (d ? new Date(d.getTime() + gap) : d);
  const renews = later(u.subscriptionRenewsAt);
  if (billingOn() && u.subscriptionId && u.subscriptionId !== "manual") {
    await getStripe().subscriptions.update(u.subscriptionId, { pause_collection: null, ...(renews ? { trial_end: Math.floor(renews.getTime() / 1000) } : {}), proration_behavior: "none" }).catch((e) => console.error("[stripe] resume:", e.message));
  }
  await db.user.update({ where: { id: devId }, data: { subscriptionPausedAt: null, subscriptionRenewsAt: renews, subscriptionAnchorAt: later(u.subscriptionAnchorAt), subscriptionPastDueAt: later(u.subscriptionPastDueAt) } });
  return true;
}

const failedLine = (by: Date) => `Your ${SUBSCRIPTION_PRICE.replace("/month", "")} subscription payment didn't go through. Update your card by ${fmtSubDay(by)} to keep it.`;
export const LAPSED_LINE = "Your subscription ended because the payment didn't go through.";

/** A renewal was declined: past due (perks continue while it is retried), with a notice sent even with email Off. */
export async function renewalFailed(devId: string, now = new Date()) {
  const u = await userOf(devId);
  if (u.subscriptionStatus === "past_due") return false;
  await db.user.update({ where: { id: devId }, data: { subscriptionStatus: "past_due", subscriptionPastDueAt: now } });
  await tell(u, failedLine(new Date(now.getTime() + RETRY_DAYS * DAY)), true);
  return true;
}
/** The last retry failed: the subscription lapses (no hold), with a notice sent even with email Off. */
export async function lapse(devId: string, now = new Date()) {
  if (!(await endSubscription(devId, "lapsed", now))) return false;
  await tell(await userOf(devId), LAPSED_LINE, true);
  return true;
}

/** A renewal went through (manual or Stripe): the next one is a month on. */
async function renewed(devId: string, now: Date, periodEndAt?: Date | null) {
  const u = await userOf(devId);
  await db.user.update({ where: { id: devId }, data: { subscriptionStatus: "active", subscriptionPastDueAt: null, subscriptionRenewsAt: periodEndAt ?? periodEnd(u.subscriptionAnchorAt ?? u.subscribedAt ?? now, now) } });
}

/** The daily job (manual billing): cancels that ran out end; due renewals are charged; declined ones are retried daily and lapse after RETRY_DAYS. Paused billing waits. */
export async function renewSubscriptions(now = new Date()) {
  let renewedN = 0, failed = 0, ended = 0;
  const due = await db.user.findMany({ where: { subscriptionStatus: { in: ["active", "past_due"] }, subscriptionPausedAt: null, subscriptionRenewsAt: { lte: now } } });
  for (const u of due) {
    if (u.subscriptionCanceling) {
      if (u.subscriptionId === "manual" || !billingOn()) { await endSubscription(u.id, "cancelled", now); ended++; }
      continue;
    }
    if (u.subscriptionId !== "manual" && billingOn()) continue; // Stripe Billing renews it (webhook)
    if (u.subscriptionStatus === "past_due" && u.subscriptionPastDueAt && now.getTime() - u.subscriptionPastDueAt.getTime() >= RETRY_DAYS * DAY - 3_600_000) {
      await lapse(u.id, now);
      ended++;
      continue;
    }
    // (Batch 11) A renewal the bank wants confirmed waits (3 days) instead of being charged again.
    if (await db.payment.count({ where: { developerId: u.id, kind: "subscription", status: "needs_confirmation" } })) continue;
    const r = await chargePlatform(u, SUBSCRIPTION_CENTS, `subrenew-${u.id}-${now.toISOString().slice(0, 10)}`, `Playtest subscription (${SUBSCRIPTION_PRICE})`).catch(() => null);
    if (r?.status === "requires_action") {
      const row = await db.payment.create({ data: { kind: "subscription", developerId: u.id, testerId: u.id, amountCents: SUBSCRIPTION_CENTS, feeCents: SUBSCRIPTION_CENTS, testerCents: 0, transferStatus: "none", status: "needs_confirmation" } });
      await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
      continue;
    }
    if (r) {
      await recordCharge(u, r);
      await renewed(u.id, now);
      renewedN++;
    } else {
      await renewalFailed(u.id, now);
      failed++;
    }
  }
  return { renewed: renewedN, failed, ended };
}

/** Stripe Billing webhook events about a subscription. */
export async function subscriptionWebhook(type: string, o: Record<string, unknown>, now = new Date()) {
  const subId = typeof o.subscription === "string" ? o.subscription : type.startsWith("customer.subscription") && typeof o.id === "string" ? o.id : "";
  if (!subId) return false;
  const u = await db.user.findFirst({ where: { subscriptionId: subId } });
  if (!u) return false;
  if (type === "invoice.paid") {
    const cents = typeof o.amount_paid === "number" ? o.amount_paid : SUBSCRIPTION_CENTS;
    if (cents > 0) await recordCharge(u, { status: "charged", stripePaymentIntentId: typeof o.payment_intent === "string" ? o.payment_intent : null }, cents);
    const lines = (o.lines as { data?: { period?: { end?: number } }[] } | undefined)?.data;
    const end = lines?.[0]?.period?.end;
    await renewed(u.id, now, end ? new Date(end * 1000) : null);
  } else if (type === "invoice.payment_failed") await renewalFailed(u.id, now);
  else if (type === "invoice.payment_action_required" && typeof o.payment_intent === "string") {
    // (Batch 11) A renewal the bank wants the developer to confirm: it waits 3 days for their Confirm in Payments, then lapses.
    if (!(await db.payment.count({ where: { actionPi: o.payment_intent } }))) {
      const row = await db.payment.create({ data: { kind: "subscription", developerId: u.id, testerId: u.id, amountCents: typeof o.amount_due === "number" ? o.amount_due : SUBSCRIPTION_CENTS, feeCents: 0, testerCents: 0, transferStatus: "none", status: "needs_confirmation" } });
      await (await import("./confirm")).awayAction(row.id, { status: "requires_action", stripePaymentIntentId: o.payment_intent, clientSecret: "" });
    }
  }
  else if (type === "customer.subscription.deleted") {
    if (u.subscriptionStatus === "past_due") await lapse(u.id, now);
    else await endSubscription(u.id, "cancelled", now);
  }
  return true;
}

// ---------- free during launch (section 6) ----------

export const FREE_ENDED_LINE = "Free during launch ended: the extras need a subscription now.";
/** One notice to every developer (bell + the end-of-day email, sent even with email Off), in one write. */
async function tellAllDevs(line: string) {
  const ids = (await db.user.findMany({ where: { isDeveloper: true, deletedAt: null }, select: { id: true } })).map((u) => u.id);
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, text: line, link: "/app/payments#subscription", mustEmail: true, own: false, groupKey: "payhold", payment: true })) });
  return ids.length;
}
const freeLine = (until: Date) => `Free during launch ends soon: the extras need a ${SUBSCRIPTION_PRICE} subscription from ${fmtSubDay(until)}.`;

/** The daily job: the 30-day and 7-day notices before free-during-launch ends (sent even with email Off), and the end itself (like a lapse: a stop-once line). */
export async function freeLaunchNotices(now = new Date()) {
  const launch = await launchState(now);
  if (!launch.until) return 0;
  let sent = 0;
  if (launch.free) {
    const left = launch.until.getTime() - now.getTime();
    for (const days of FREE_NOTICE_DAYS) {
      if (left > days * DAY) continue;
      const key = TOLD(days);
      const was = await appState(key);
      if (was === launch.until.toISOString()) continue;
      await tellAllDevs(freeLine(launch.until));
      await setState(key, launch.until.toISOString());
      sent++;
      break; // one notice a day: the nearer mark next time
    }
    return sent;
  }
  // Over: developers without a subscription get the stop-once line on their open pages (once per end date).
  if ((await appState("free-ended")) === launch.until.toISOString()) return 0;
  await setState("free-ended", launch.until.toISOString());
  // (One write: the developers who aren't paying, i.e. not active / past due.)
  const tests = await db.test.findMany({ where: { status: { not: "stopped" }, developer: { deletedAt: null, subscriptionStatus: { notIn: ["active", "past_due"] } } }, select: { id: true } });
  await db.testEvent.createMany({ data: tests.map((t) => ({ testId: t.id, kind: "subscription", text: FREE_ENDED_LINE })) });
  return 0;
}
