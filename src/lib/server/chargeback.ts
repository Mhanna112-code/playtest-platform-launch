import type Stripe from "stripe";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { HttpError } from "./http";
import { logEvent } from "./live";
import { bell, notify } from "./notify";
import { PAYMENTS_PROBLEM, authorize, bankReturnUrl, checkUrlOf, fakeOn, getStripe, stripeOn, transferShare } from "./stripe";
import { BANK_NOT_CONFIRMED, CARD_NOT_VERIFIED, PRESS_ACTION_MS, RESERVE_DAYS, RESERVE_EXPIRED, splitFee } from "@/lib/rules";
import { liftHoldIfClear, owed, tellArrived } from "./holds";
import { receipt } from "./payments";

// (Owner, Oct 26) A CHARGEBACK is a payment hold with extra steps. The developer's account goes on a payment hold (as for a failed payment). To lift it:
//   (a) re-verify a card with 3D Secure (a Stripe SetupIntent with payment_method_options.card.request_three_d_secure = "any"; in fake / dev
//       mode, with no Stripe, it is simulated as a success),
//   (b) pay what they owe (owner, Oct 29, batch 23 section 6: Pay what you owe RESERVES it on the card, an authorization; the team's Approve takes it),
//   (c) get the admin's approval (the admin sees "card verified ✓/✗, owed paid ✓/✗" and an Approve button).
// Paying alone never lifts a chargeback hold; the developer's banner says which steps remain.

export type ChargebackSteps = {
  cardVerified: boolean;
  /** (Batch 23 section 6) Everything owed is covered: reserved on the card (or paid). */
  owedPaid: boolean;
  /** What is owed in all (reserved or not). */
  owedCents: number;
  /** (Batch 23 section 6) What is reserved on the card now, and what is owed beyond it (Pay what you owe's amount). */
  reservedCents: number;
  uncoveredCents: number;
  /** (Batch 28 §8) Added to what is owed after the reservation: charged on the verified card right after the team's Approve lifts the hold (no second reservation). */
  addedCents: number;
  /** The last reservation lapsed (about 7 days, no Approve): Payments asks for Pay what you owe again. */
  expired: boolean;
  approved: boolean;
  /** What is still to do, in the order they are shown ("Verify a card with 3D Secure", "Pay what you owe ($8.00)", "Wait for the team's approval"). */
  remaining: string[];
};

/** The step status of a developer on a chargeback hold; null when the account is not on one. */
export async function chargebackSteps(devId: string): Promise<ChargebackSteps | null> {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true } });
  if (!u?.holdStartedAt || u.holdReason !== "chargeback") return null;
  const owing = await owed(devId);
  const rs = await reserveState(devId);
  const owedCents = owing.reduce((a, p) => a + p.amountCents, 0);
  const uncoveredCents = owing.filter((p) => !rs.covered.has(p.id)).reduce((a, p) => a + p.amountCents, 0);
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves once: with a reservation in place the step is done; anything added since is charged after the lift.
  const cardVerified = !!u.chargebackCardVerifiedAt, owedPaid = uncoveredCents === 0 || rs.reservedCents > 0, approved = !!u.chargebackApprovedAt;
  const remaining = [
    ...(cardVerified ? [] : ["Verify a card with 3D Secure"]),
    ...(owedPaid ? [] : [`Pay what you owe (${money(uncoveredCents)})`]),
    ...(approved ? [] : ["Wait for the team's approval"]),
  ];
  return { cardVerified, owedPaid, owedCents, reservedCents: rs.reservedCents, uncoveredCents, addedCents: rs.reservedCents > 0 ? uncoveredCents : 0, expired: rs.expired && !rs.reservedCents, approved, remaining };
}

// ---------- (Owner, Oct 29, batch 23 section 6) Pay what you owe reserves; the team's Approve takes it ----------

/** The developer's reservations now: the active ones (what they cover, their total) and whether the latest one lapsed. Lapsed ones are released first. */
export async function reserveState(devId: string, now = new Date()) {
  await expireReservations(now, devId);
  const active = await db.reservation.findMany({ where: { developerId: devId, status: "reserved" }, orderBy: { createdAt: "asc" } });
  const latest = await db.reservation.findFirst({ where: { developerId: devId, status: { notIn: ["pending", "failed"] } }, orderBy: { createdAt: "desc" } });
  return { active, reservedCents: active.reduce((a, r) => a + r.amountCents, 0), covered: new Set(active.flatMap((r) => r.covers)), expired: latest?.status === "expired" };
}

async function cancelPi(id: string | null) {
  if (id && stripeOn()) await getStripe().paymentIntents.cancel(id).catch((e) => console.error("[reserve] cancel:", (e as Error).message));
}

/**
 * Pay what you owe during a chargeback hold (after the card check): one authorization for everything owed. (Owner, Oct 29, batch 28 §8) It reserves ONCE: while a
 * reservation is in place nothing more is reserved (what is added later is charged right after the lift); after it expired or was released, the full amount owed then.
 * Without Stripe it is recorded as reserved. Returns the reserved amount, the bank's inline check, or why it failed.
 */
export async function reserveOwed(u: { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean }, rows: { id: string; amountCents: number }[]) {
  const total = rows.reduce((a, p) => a + p.amountCents, 0);
  const now = new Date();
  const r = await db.reservation.create({ data: { developerId: u.id, amountCents: total, covers: rows.map((p) => p.id), status: "pending", actionBy: new Date(now.getTime() + PRESS_ACTION_MS) } });
  const reserved = (pi: string | null) => db.reservation.update({ where: { id: r.id }, data: { status: "reserved", stripePaymentIntentId: pi, actionBy: null, expiresAt: new Date(Date.now() + RESERVE_DAYS * 86_400_000) } });
  if (!stripeOn()) {
    await reserved(null);
    return { reservedCents: total };
  }
  try {
    const a = await authorize(u, total, r.id);
    if (a.status === "requires_capture") {
      await reserved(a.stripePaymentIntentId);
      return { reservedCents: total };
    }
    await db.reservation.update({ where: { id: r.id }, data: { status: "needs_action", stripePaymentIntentId: a.stripePaymentIntentId } });
    return { action: (await import("./confirm")).checkFor(r.id, a.clientSecret ?? "", a.checkUrl ?? null) };
  } catch (e) {
    await db.reservation.update({ where: { id: r.id }, data: { status: "failed", endedAt: new Date() } });
    if (e instanceof HttpError && e.code === "card_failed") return { failed: "Your card was declined." };
    if (e instanceof HttpError && e.code === "payments_problem") return { failed: PAYMENTS_PROBLEM };
    return { failed: "It didn't go through. Try again shortly." };
  }
}

/** The bank's check on a reservation ended: reserved, or nothing reserved (BANK_NOT_CONFIRMED). */
export async function reservationChecked(devId: string, id: string, ok: boolean) {
  const r = await db.reservation.findUnique({ where: { id } });
  if (!r || r.developerId !== devId) throw new HttpError(404, "not_found", "There's nothing to confirm here.");
  if (r.status === "reserved") return { done: true, reservedCents: r.amountCents, repeated: true };
  if (r.status !== "needs_action") throw new HttpError(402, "not_confirmed", BANK_NOT_CONFIRMED);
  if (!ok) {
    if ((await db.reservation.updateMany({ where: { id, status: "needs_action" }, data: { status: "cancelled", endedAt: new Date() } })).count === 1) await cancelPi(r.stripePaymentIntentId);
    throw new HttpError(402, "not_confirmed", BANK_NOT_CONFIRMED);
  }
  await db.reservation.updateMany({ where: { id, status: "needs_action" }, data: { status: "reserved", actionBy: null, expiresAt: new Date(Date.now() + RESERVE_DAYS * 86_400_000) } });
  return { done: true, reservedCents: r.amountCents };
}

/**
 * The clocks (the 5-minute sweep, the daily job, and every look at a hold's steps): a bank check left open over 15 minutes lets go; a reservation past its days is released
 * (the authorization cancelled) and the developer is told to press Pay what you owe again (the admin's row says "Reservation expired").
 */
export async function expireReservations(now = new Date(), devId?: string) {
  const mine = devId ? { developerId: devId } : {};
  for (const r of await db.reservation.findMany({ where: { ...mine, status: { in: ["pending", "needs_action"] }, actionBy: { lte: now } } }))
    if ((await db.reservation.updateMany({ where: { id: r.id, status: r.status }, data: { status: "cancelled", endedAt: now } })).count === 1) await cancelPi(r.stripePaymentIntentId);
  for (const r of await db.reservation.findMany({ where: { ...mine, status: "reserved", expiresAt: { lte: now } } })) {
    if ((await db.reservation.updateMany({ where: { id: r.id, status: "reserved" }, data: { status: "expired", endedAt: now } })).count !== 1) continue;
    await cancelPi(r.stripePaymentIntentId);
    await bell(r.developerId, RESERVE_EXPIRED, "/app/payments#owed", undefined, { payment: true, group: "payhold" });
  }
}

/** Every reservation still open is released (the hold lifted another way, or stopped being a chargeback hold): nothing is taken. */
export async function releaseReservations(devId: string, status: "cancelled" | "expired" = "cancelled") {
  const open = await db.reservation.findMany({ where: { developerId: devId, status: { in: ["pending", "needs_action", "reserved"] } } });
  let cents = 0;
  for (const r of open) {
    if ((await db.reservation.updateMany({ where: { id: r.id, status: r.status }, data: { status, endedAt: new Date() } })).count !== 1) continue;
    await cancelPi(r.stripePaymentIntentId);
    if (r.status === "reserved") cents += r.amountCents;
  }
  return cents;
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
  // (Batch 22 section 1) No automatic charge on it: during a chargeback hold what is owed is paid only through Pay what you owe (open once the card is verified).
  return { verified: true };
}

type OwedRow = Awaited<ReturnType<typeof owed>>[number];

/**
 * (Batch 23 section 6) Which reservation pays which owed payment: each payment goes with the reservation that covers it, else with any with room left. (Batch 28 §8)
 * `after`: what no reservation covers (added after it): charged right after the hold lifts.
 */
function assign(rows: OwedRow[], active: { id: string; amountCents: number; covers: string[] }[]) {
  const room = new Map(active.map((r) => [r.id, r.amountCents]));
  const out = new Map<string, OwedRow[]>(active.map((r) => [r.id, []]));
  const put = (rid: string, p: OwedRow) => {
    room.set(rid, room.get(rid)! - p.amountCents);
    out.get(rid)!.push(p);
  };
  const later: OwedRow[] = [];
  for (const p of rows) {
    const own = active.find((r) => r.covers.includes(p.id) && room.get(r.id)! >= p.amountCents);
    if (own) put(own.id, p);
    else later.push(p);
  }
  const after: OwedRow[] = [];
  for (const p of later) {
    const any = active.find((r) => room.get(r.id)! >= p.amountCents);
    if (any) put(any.id, p);
    else after.push(p);
  }
  return { plan: out, after };
}

/**
 * (Owner, Oct 29, batch 28 §8) What was added to what is owed after the reservation is charged right after the lift, as an ordinary charge on the verified card
 * ("deferred": chargeDeferred runs when the hold lifts). Its receipt names it; the tester is paid when it goes through; the bank asking waits as "Your bank wants you to
 * confirm"; a decline starts a normal payment hold. A reversed payment owed again (a chargeback opened after the reservation) gets its repay row the same way.
 */
async function deferAfterLift(devId: string, rows: OwedRow[]) {
  for (const p of rows) {
    if (p.chargeback === "open") {
      const busy = await db.payment.findFirst({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up", "paying", "needs_action", "needs_confirmation", "deferred"] } } });
      if (!busy) await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: devId, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", status: "deferred" } });
      continue;
    }
    if (p.actionPi) await cancelPi(p.actionPi);
    await db.payment.updateMany({ where: { id: p.id, settledAt: null, status: p.status }, data: { status: "deferred", owedUntil: null, failure: "", actionPi: null, actionBy: null, warnedAt: null } });
  }
}

/**
 * One owed payment, paid by a captured reservation: a reversed payment gets its repay row (the money stays with the platform); a failed or owed payment is charged and the
 * tester's share goes to their payout account (or waits for its setup), and the tester reads that it arrived.
 */
async function settleOwedRow(dev: { id: string; name: string; email: string }, p: OwedRow, pi: string | null) {
  const status = pi ? "charged" : "not_set_up";
  if (p.chargeback === "open") {
    const busy = await db.payment.findFirst({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up", "paying", "needs_action", "needs_confirmation"] } } });
    if (!busy) await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: dev.id, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", status, stripePaymentIntentId: pi, settledAt: new Date() } });
    return;
  }
  if (p.actionPi) await cancelPi(p.actionPi);
  const split = splitFee(p.amountCents);
  const tester = await db.user.findUnique({ where: { id: p.testerId } });
  const ready = !!(pi && tester?.stripeAccountId && tester.payoutsReady && split.testerCents > 0);
  const claimed = await db.payment.updateMany({
    where: { id: p.id, settledAt: null, status: p.status },
    data: { status, settledAt: new Date(), failure: "", actionPi: null, actionBy: null, warnedAt: null, stripePaymentIntentId: pi, ...split, transferStatus: pi ? (ready ? "sending" : "waiting") : "none" },
  });
  if (claimed.count !== 1) return;
  if (ready) {
    try {
      // (Batch 28 §17) Sent from the captured charge itself (source_transaction): no platform balance needed.
      const t = await transferShare({ id: p.id, stripePaymentIntentId: pi }, split.testerCents, tester!.stripeAccountId!);
      await db.payment.update({ where: { id: p.id }, data: { transferStatus: "sent", stripeTransferId: t.id } });
    } catch (e) {
      console.error("[reserve] transfer:", (e as Error).message);
      await db.payment.update({ where: { id: p.id }, data: { transferStatus: "waiting" } });
    }
  }
  if (tester) await tellArrived(p, tester.email, displayName(dev));
}

/**
 * Step (c): the admin approves lifting the chargeback hold. (Owner, Oct 29, batch 23 section 6) Allowed once the card is verified and what is owed is reserved on it: Approve
 * captures the reservation (once: the first press claims the approval) and lifts the hold in one step; the testers waiting on that money are paid then. (Owner, Oct 29,
 * batch 28 §8) Something added after the reservation never blocks it: the reservation is taken, the hold lifts, and what was added is charged right after (deferAfterLift).
 * A reservation that can't be captured any more (it lapsed) is released and refused.
 */
export async function approveChargebackHold(devId: string) {
  const steps = await chargebackSteps(devId);
  if (!steps) throw new HttpError(409, "no_chargeback_hold", "That account isn't on a chargeback hold.");
  if (steps.approved) throw new HttpError(409, "already", "That hold was already approved.");
  const owing = await owed(devId);
  const rs = await reserveState(devId);
  const owedCents = owing.reduce((a, p) => a + p.amountCents, 0);
  const { plan, after } = assign(owing, rs.active);
  const nothingReserved = owedCents > 0 && !rs.active.length;
  if (!steps.cardVerified && nothingReserved) throw new HttpError(409, "steps_missing", `Not yet: the card isn't verified, and nothing is reserved (${money(owedCents)} is owed).`);
  if (!steps.cardVerified) throw new HttpError(409, "steps_missing", "Not yet: the card isn't verified.");
  if (nothingReserved) throw new HttpError(409, "steps_missing", `Not yet: nothing is reserved (${money(owedCents)} is owed).`);
  const claimed = await db.user.updateMany({ where: { id: devId, chargebackApprovedAt: null, holdStartedAt: { not: null }, holdReason: "chargeback" }, data: { chargebackApprovedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, "already", "That hold was already approved.");
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  let taken = 0;
  for (const r of rs.active) {
    const rows = plan.get(r.id) ?? [];
    const cents = rows.reduce((a, p) => a + p.amountCents, 0);
    if (!cents) {
      if ((await db.reservation.updateMany({ where: { id: r.id, status: "reserved" }, data: { status: "cancelled", endedAt: new Date() } })).count === 1) await cancelPi(r.stripePaymentIntentId);
      continue;
    }
    if (r.stripePaymentIntentId && stripeOn()) {
      try {
        await getStripe().paymentIntents.capture(r.stripePaymentIntentId, { amount_to_capture: cents }, { idempotencyKey: `capture-${r.id}` });
      } catch (e) {
        console.error("[reserve] capture:", (e as Error).message);
        await db.user.update({ where: { id: devId }, data: { chargebackApprovedAt: null } });
        if ((await db.reservation.updateMany({ where: { id: r.id, status: "reserved" }, data: { status: "expired", endedAt: new Date() } })).count === 1) {
          await cancelPi(r.stripePaymentIntentId);
          await bell(devId, RESERVE_EXPIRED, "/app/payments#owed", undefined, { payment: true, group: "payhold" });
        }
        throw new HttpError(409, "reserve_expired", "The reservation can't be taken any more (it expired): the developer needs to press Pay what you owe again.");
      }
    }
    await db.reservation.update({ where: { id: r.id }, data: { status: "captured", capturedAt: new Date(), endedAt: new Date() } });
    for (const p of rows) await settleOwedRow(dev, p, r.stripePaymentIntentId && stripeOn() ? r.stripePaymentIntentId : null);
    taken += cents;
  }
  // (Batch 28 §8) What was added after the reservation waits for the lift, then is charged as an ordinary charge.
  await deferAfterLift(devId, after);

  for (const p of await db.payment.findMany({ where: { developerId: devId, chargeback: "open" } })) {
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "resolved" } });
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
    if (c) await logEvent(c.testId, "chargeback", `The team resolved the bank reversal of your ${money(p.amountCents)} payment`, c.id);
  }
  // (Batch 24, a batch 23 leftover) ONE notice for the developer: when Approve lifts the hold it says so too (the testers still get their "is running again").
  const lifted = await liftHoldIfClear(devId, { quietDev: true });
  // (Batch 25 section 5) One bell line for this money: when the Approve lifts the hold, its one notice names the amount taken ("…the $8.00 reserved on your card was
  // taken…"), so there is no separate receipt line; otherwise the receipt says it.
  if (taken && !lifted) await receipt(dev.email, "what you owed (reserved on your card, taken on the team's approval)", taken, stripeOn() ? "charged" : "not_set_up", "/app/payments");
  const still = lifted && !!(await db.user.findUnique({ where: { id: devId }, select: { devSuspendedAt: true } }))?.devSuspendedAt;
  if (lifted) {
    // Lifted while an admin suspension is still on: the same one notice says the tests stay paused (ignores Off, like "running again").
    const line = still ? approvedStillSuspendedLine(taken) : approvedLiftedLine(taken);
    await notify(dev.email, line, [line, ...(still ? [] : ["Every deadline moved on by the pause."])], "/app", { always: true, payment: true, group: "admindecision" });
  } else await notify(dev.email, APPROVED_LINE, [`${APPROVED_LINE}.`, ...(taken ? [`The ${money(taken)} reserved on your card was taken.`] : [])], "/app/payments", { payment: true, group: "admindecision" });
  return { ok: true, lifted, takenCents: taken };
}
export const APPROVED_LINE = "The team approved lifting your hold";
/** "The team approved lifting your hold: the $8.00 reserved on your card was taken, and your tests are running again." */
export const approvedLiftedLine = (cents: number) => `${APPROVED_LINE}: ${cents ? `the ${money(cents)} reserved on your card was taken, and ` : ""}your tests are running again.`;
/** Lifted while suspended: "The team approved lifting your hold: the $8.00 reserved on your card was taken. Your tests stay paused while your account is suspended." */
export const approvedStillSuspendedLine = (cents: number) => `${APPROVED_LINE}${cents ? `: the ${money(cents)} reserved on your card was taken` : ""}. Your tests stay paused while your account is suspended.`;

/** (Batch 23 section 6) The team doesn't approve (yet): every reservation is cancelled (nothing taken) and the hold stays. */
export async function declineChargebackReserve(devId: string, note = "") {
  const u = await db.user.findUnique({ where: { id: devId } });
  if (!u?.holdStartedAt || u.holdReason !== "chargeback") throw new HttpError(409, "no_chargeback_hold", "That account isn't on a chargeback hold.");
  if (u.chargebackApprovedAt) throw new HttpError(409, "already", "That hold was already approved.");
  const cents = await releaseReservations(devId);
  if (!cents) throw new HttpError(409, "nothing_reserved", "Nothing is reserved on that account.");
  const line = notApprovedLine(cents);
  await notify(u.email, line, [line, ...(note ? [`Their note: “${note}”`] : [])], "/app/payments#chargeback-steps", { payment: true, group: "admindecision" });
  return { ok: true, releasedCents: cents };
}
/** "The team didn't approve lifting your hold: the $23.00 reserved on your card was released, and nothing was taken." */
export const notApprovedLine = (cents: number) => `The team didn't approve lifting your hold: the ${money(cents)} reserved on your card was released, and nothing was taken.`;

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
