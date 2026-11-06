import type Stripe from "stripe";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { HttpError } from "./http";
import { logEvent } from "./live";
import { bell, notify } from "./notify";
import { PAYMENTS_PROBLEM, authorize, bankReturnUrl, checkUrlOf, ensureCustomer, fakeOn, forgetCard, getStripe, isMissing, stripeOn, transferShare } from "./stripe";
import { cardLabel, logAccountChange } from "./accountChanges";
import { BANK_NOT_CONFIRMED, CARD_NOT_VERIFIED, CHARGEBACKS_REVIEW_FROM, CHARGEBACK_FEE_CENTS, PRESS_ACTION_MS, REVIEWED_LINE, RESERVE_DAYS, RESERVE_EXPIRED, bankChangedLine, pressAgainLine, raiseOf, reversedOf, reversedWords, splitFee } from "@/lib/rules";
import { liftHoldIfClear, owed, payable, reversalFor, tellArrived } from "./holds";
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
  /**
   * (Owner, Nov 3) From the account's 2nd chargeback (its whole life, this one included) the team reviews it BEFORE the developer can pay: `approved` then means
   * "allowed to pay", Pay what you owe CHARGES everything as one payment (no reservation), and paying lifts the hold (no second approval). `count`: chargebacks so far.
   */
  reviewFirst: boolean;
  count: number;
  /** What is still to do, in the order they are shown ("Verify a card with 3D Secure", "Pay what you owe ($8.00)", "Wait for the team's approval"). */
  remaining: string[];
};

/** The step status of a developer on a chargeback hold; null when the account is not on one. */
export async function chargebackSteps(devId: string): Promise<ChargebackSteps | null> {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true } });
  if (!u?.holdStartedAt || u.holdReason !== "chargeback") return null;
  // (Owner, Nov 2, §125) The reservation covers what is owed AND the charges waiting for the lift: the team's Approve settles everything in one.
  const owing = await payable(devId);
  const rs = await reserveState(devId);
  const owedCents = owing.reduce((a, p) => a + p.amountCents, 0);
  const uncoveredCents = owing.filter((p) => !rs.covered.has(p.id)).reduce((a, p) => a + p.amountCents, 0);
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves once: with a reservation in place the step is done; anything added since is charged after the lift.
  const count = await chargebackCount(devId);
  const reviewFirst = count >= CHARGEBACKS_REVIEW_FROM;
  const cardVerified = !!u.chargebackCardVerifiedAt, owedPaid = uncoveredCents === 0 || (!reviewFirst && rs.reservedCents > 0), approved = !!u.chargebackApprovedAt;
  // (Owner, Nov 3) From the 2nd chargeback: the team's review comes first, then the card, then paying (which lifts the hold).
  const remaining = reviewFirst
    ? [...(approved ? [] : ["Wait for the team's review"]), ...(cardVerified ? [] : ["Verify a card with 3D Secure"]), ...(owedPaid ? [] : [`Pay what you owe (${money(uncoveredCents)})`])]
    : [
      ...(cardVerified ? [] : ["Verify a card with 3D Secure"]),
      ...(owedPaid ? [] : [`Pay what you owe (${money(uncoveredCents)})`]),
      ...(approved ? [] : ["Wait for the team's approval"]),
    ];
  return { cardVerified, owedPaid, owedCents, reservedCents: reviewFirst ? 0 : rs.reservedCents, uncoveredCents, addedCents: !reviewFirst && rs.reservedCents > 0 ? uncoveredCents : 0, expired: !reviewFirst && rs.expired && !rs.reservedCents, approved, reviewFirst, count, remaining };
}

/** (Owner, Nov 3) Chargebacks on this account over its whole life (every payment the bank ever reversed: open, resolved, won or lost). */
export async function chargebackCount(devId: string) {
  return db.payment.count({ where: { developerId: devId, chargeback: { not: "" } } });
}

/**
 * (Owner, Nov 3) Once the team allowed paying (from the 2nd chargeback), a reversed payment that is repaid is settled: its chargeback is resolved (as the team's
 * Approve resolves it on a 1st chargeback), so paying lifts the hold. Called by liftHoldIfClear before it checks for open chargebacks.
 */
export async function resolveRepaidAfterReview(devId: string) {
  for (const p of await db.payment.findMany({ where: { developerId: devId, chargeback: "open" } })) {
    if (!(await db.payment.count({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up"] } } }))) continue;
    if ((await db.payment.updateMany({ where: { id: p.id, chargeback: "open" }, data: { chargeback: "resolved" } })).count !== 1) continue;
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
    // (Owner, Nov 4, §177) Which payment: "You repaid the bank reversal of your $10.00 payment for Ana Silva's written answers on “Harbor Run”".
    if (c) await logEvent(c.testId, "chargeback", `You repaid the bank reversal of ${reversedWords(p)}${await reversalFor(p)}`, c.id);
  }
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
export async function reserveOwed(u: { id: string; email: string; stripeCustomerId: string | null; stripePaymentMethodId: string | null; stripeAccountId: string | null; payoutsReady: boolean }, rows: (import("./paymentRows").PayingRow & { id: string })[]) {
  const total = rows.reduce((a, p) => a + p.amountCents, 0);
  const now = new Date();
  // (Nov 2, payments proof: bug found) Two presses at the same moment (two tabs) both saw no reservation and each authorized the total. The reservation is now made
  // under the developer's row lock and only when none is open (being made, waiting for the bank, or reserved): the second press reserves nothing.
  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${u.id} FOR UPDATE`;
    // (Owner, Nov 3, §160) One being made or at the bank (another tab): refused with that line; "already reserved" only when it really is.
    const open = await tx.reservation.findFirst({ where: { developerId: u.id, status: { in: ["pending", "needs_action", "reserved"] } }, orderBy: { createdAt: "desc" }, select: { status: true, amountCents: true } });
    if (open && open.status !== "reserved") return { elsewhere: open.amountCents };
    if (open) return null;
    // (Owner, Nov 3, races) The bank changed the disputed part after the press read what is owed (it takes this same lock): what the rows come to is read again
    // here, and a total that changed reserves nothing (the press stops once on the new total, below).
    const fresh = await tx.payment.findMany({ where: { id: { in: rows.map((p) => p.id) } }, select: { id: true, amountCents: true, reversedCents: true, chargeback: true } });
    const nowTotal = rows.reduce((a, p) => {
      const x = fresh.find((f) => f.id === p.id);
      return a + (x?.chargeback === "open" ? reversedOf(x) + CHARGEBACK_FEE_CENTS : p.amountCents);
    }, 0);
    if (nowTotal !== total) {
      // (Owner, Nov 3) Which rows the bank changed, and from what to what: the stop names it.
      const moved = rows.flatMap((p) => { const x = fresh.find((f) => f.id === p.id); return x?.chargeback === "open" && reversedOf(x) + CHARGEBACK_FEE_CENTS !== p.amountCents ? [{ id: p.id, was: p.amountCents - CHARGEBACK_FEE_CENTS, now: reversedOf(x), paid: x.amountCents }] : []; });
      return { changed: nowTotal, moved };
    }
    return tx.reservation.create({ data: { developerId: u.id, amountCents: total, covers: rows.map((p) => p.id), status: "pending", actionBy: new Date(now.getTime() + PRESS_ACTION_MS) } });
  });
  if (!r) throw new HttpError(409, "nothing_owed", (await import("./holds")).ALREADY_RESERVED);
  if ("elsewhere" in r) throw new HttpError(409, "owed_in_flight", (await import("@/lib/bankNotice")).owedElsewhereLine(money(r.elsewhere)));
  if ("changed" in r) {
    // (Owner, Nov 3, races) Pay what you owe's own stop-once line, with the new total; the second press reserves it.
    const lines = await (await import("./holds")).owedLines(u.id);
    const ids = lines.filter((l) => l.retry).map((l) => l.id);
    // (Owner, Nov 3) The stop names the bank's change ("Your bank changed the amount it took back from your $40.00 payment for …: $12.00 → $20.00 (now …)"), and
    // carries the lines so the box's bullets redraw with the new total.
    const named = r.moved.map((m) => { const l = lines.find((x) => x.id === m.id); const cb = l && "cb" in l && l.cb ? l.cb : null; return bankChangedLine(m.paid, cb?.piece ?? null, m.was, m.now, cb?.one ?? null); }); // (§193b) a one payment names its items
    // (Owner, Nov 5, §206) As payOwed's stop: one bullet per change the bank made, then "New total $X. <press again>" last, keyed so a later stop replaces it.
    const at = new Date();
    const again = pressAgainLine(r.changed, { cardVerified: true });
    const changes = named.length ? [...named.map((text) => ({ text, at })), { text: `New total ${money(r.changed)}. ${again}`, at, key: "owed-total" }] : [{ text: `What you owe changed: now ${money(r.changed)}. ${again}`, at, key: "owed-total" }];
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes, totalCents: r.changed, ids, lines });
  }
  const reserved = (pi: string | null) => db.reservation.update({ where: { id: r.id }, data: { status: "reserved", stripePaymentIntentId: pi, actionBy: null, expiresAt: new Date(Date.now() + RESERVE_DAYS * 86_400_000) } });
  if (!stripeOn()) {
    await reserved(null);
    return { reservedCents: total };
  }
  try {
    // (Owner, Nov 3) "Playtest: Reserved for the team's review: <each item as on the page> $8.00, …".
    const a = await authorize(u, total, r.id, await (await import("./paymentRows")).stripeDescription({ reserve: rows }));
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
    if (e instanceof HttpError && (e.code === "no_card" || e.code === "payments_off")) return { failed: e.message }; // (§130) never a decline
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
    await bell(r.developerId, RESERVE_EXPIRED, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
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

/** (Owner, Nov 3, §157) Verify a card pressed (or a second check finished) once the card is verified: another tab, or this one, already did it. */
export const CARD_ALREADY_VERIFIED = "Your card is already verified.";
/** Verified once: claimed while not verified yet (two checks finishing at once: one counts, the other is refused and changes nothing). */
async function markVerified(userId: string, now = new Date(), data: { stripePaymentMethodId?: string; cardExpMonth?: number | null; cardExpYear?: number | null } = {}) {
  if ((await db.user.updateMany({ where: { id: userId, chargebackCardVerifiedAt: null }, data: { chargebackCardVerifiedAt: now, ...data } })).count !== 1) throw new HttpError(409, "already_verified", CARD_ALREADY_VERIFIED);
}
/** (§157) Refused before a card attempt is used: the card is already verified. */
export async function refuseVerified(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true } });
  if (u?.holdStartedAt && u.holdReason === "chargeback" && u.chargebackCardVerifiedAt) throw new HttpError(409, "already_verified", CARD_ALREADY_VERIFIED);
}

/**
 * Step (a), start: a SetupIntent that asks for 3D Secure on any card. Returns the client secret for Stripe's card form (the card details never reach
 * this site). Without Stripe (dev) or with the local fake, the verification is simulated and succeeds at once.
 */
export async function startCardVerification(user: { id: string; email: string; stripeCustomerId: string | null }, opts: { standIn?: boolean } = {}) {
  const steps = await chargebackSteps(user.id);
  if (!steps) throw new HttpError(409, "no_chargeback_hold", "Your account isn't on a chargeback hold, so there's nothing to verify.");
  if (steps.cardVerified) throw new HttpError(409, "already_verified", CARD_ALREADY_VERIFIED); // (§157)
  if (simulated()) {
    // (Batch 17 §11) The page's "Verify a card" draws the stand-in for the bank's check under the button: verified only on its Confirm (finishCardCheck).
    if (opts.standIn) return { simulated: true as const, verified: false, standIn: true };
    await markVerified(user.id);
    return { simulated: true as const, verified: true };
  }
  const stripe = getStripe();
  const setup = (customer: string) => stripe.setupIntents.create({
    customer,
    usage: "off_session",
    allowed_payment_method_types: ["card"],
    payment_method_options: { card: { request_three_d_secure: "any" } },
    metadata: { userId: user.id, purpose: "chargeback-verify" },
  });
  // (§130) The saved customer is unknown to Stripe (made in test mode): the stale card is cleared and the check runs on a new customer. (§157) One customer,
  // made under the developer's row lock (ensureCustomer).
  const customer = await ensureCustomer(user);
  const si = await setup(customer).catch(async (e) => {
    if (!isMissing(e)) throw e;
    await forgetCard(user.id);
    return setup(await ensureCustomer(user, customer));
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
  // (§130) A check Stripe doesn't know (an old page's, from test mode): not verified, start again.
  const si = await stripe.setupIntents.retrieve(setupIntentId).catch((e) => { if (isMissing(e)) throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED); throw e; });
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
  if (user.chargebackCardVerifiedAt) throw new HttpError(409, "already_verified", CARD_ALREADY_VERIFIED); // (§157) another tab's check got there first
  if (simulated()) {
    await markVerified(userId);
    return { verified: true };
  }
  const stripe = getStripe();
  const si = (await stripe.setupIntents.retrieve(setupIntentId, { expand: ["latest_attempt"] }).catch((e) => { if (isMissing(e)) throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED); throw e; })) as Stripe.SetupIntent; // (§130)
  if (si.metadata?.userId !== userId || si.metadata?.purpose !== "chargeback-verify" || (user.stripeCustomerId && si.customer !== user.stripeCustomerId))
    throw new HttpError(403, "bad_setup", "That card check belongs to another account.");
  if (si.created * 1000 < user.holdStartedAt.getTime() - 60_000) throw new HttpError(409, "old_setup", "That card check is from before the hold. Verify a card again.");
  if (si.status !== "succeeded") throw new HttpError(409, "not_verified", CARD_NOT_VERIFIED);
  const attempt = typeof si.latest_attempt === "object" ? (si.latest_attempt as Stripe.SetupAttempt | null) : null;
  const tds = attempt?.payment_method_details?.card?.three_d_secure;
  if (tds && tds.result !== "authenticated" && tds.result !== "attempt_acknowledged") throw new HttpError(409, "not_verified", "The bank didn't confirm it was you. Try again or use another card.");
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!pm) throw new HttpError(400, "no_card", "The card wasn't saved. Try again.");
  // (§157) Verified once (claimed); the card it verified becomes the card on file, recorded like Change card's ("Card: Visa ending 1111 → Visa ending 4242"), so a
  // Payments page open elsewhere (Change card's gate) stops once for it.
  const cardOf = (id: string) => Promise.resolve().then(() => stripe.paymentMethods.retrieve(id)).then((x) => x.card ?? null, () => null);
  const card = await cardOf(pm);
  await markVerified(userId, new Date(), { stripePaymentMethodId: pm, ...(card ? { cardExpMonth: card.exp_month ?? null, cardExpYear: card.exp_year ?? null } : {}) });
  if (user.stripeCustomerId) await stripe.customers.update(user.stripeCustomerId, { invoice_settings: { default_payment_method: pm } });
  if (user.stripePaymentMethodId !== pm) {
    const before = user.stripePaymentMethodId ? cardLabel((await cardOf(user.stripePaymentMethodId)) ?? {}) : "no card";
    await logAccountChange(userId, "", { scopes: ["payments"], field: "card", label: "Card", before, after: card ? cardLabel(card) : "a card" });
  }
  // (Batch 35 §117 rule 1) One card in play: checks still waiting on the old card are cancelled (what they covered is payable again; a charge made while away is
  // tried again on this card).
  if (user.stripePaymentMethodId !== pm) await (await import("./owedOnce")).newCardChecks(userId).catch((e) => console.error("[card] new card checks:", (e as Error).message));
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
export async function settleOwedRow(dev: { id: string; name: string; email: string }, p: OwedRow, pi: string | null, /** (batch 35 §117) Pay what you owe's one payment that paid it */ coveredById: string | null = null) {
  const status = pi || (coveredById && stripeOn()) ? "charged" : "not_set_up";
  if (p.chargeback === "open") {
    const busy = await db.payment.findFirst({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up", "paying", "needs_action", "needs_confirmation"] } } });
    if (!busy) await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: dev.id, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", status, stripePaymentIntentId: pi, settledAt: new Date(), coveredById } });
    // (§117) The repay row keeps the link; the reversed payment is free again (should its chargeback ever reopen).
    if (coveredById) await db.payment.updateMany({ where: { id: p.id, coveredById }, data: { coveredById: null } });
    // (Owner, Nov 4, §192) A change of the bank's amount that waited for this repayment is settled now (refunded or charged).
    await (await import("./holds")).followPendingSafely(p.id);
    return;
  }
  // (Owner, Nov 3) A reversed payment's repayment that waited for the lift, paid by the one payment: the money stays with the platform (no tester share).
  // (§192) A charge of what the bank raised after the repayment the same.
  if (p.kind === "chargeback" && p.repaysId) {
    await db.payment.updateMany({ where: { id: p.id, settledAt: null, status: p.status, coveredById }, data: { status, settledAt: new Date(), stripePaymentIntentId: pi, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", ...(p.owedUntil ? {} : { failure: "" }), actionPi: null, actionBy: null, warnedAt: null } });
    if (!raiseOf(p)) await (await import("./holds")).followPendingSafely(p.repaysId);
    return;
  }
  if (p.actionPi) await cancelPi(p.actionPi);
  const split = splitFee(p.amountCents);
  const tester = await db.user.findUnique({ where: { id: p.testerId } });
  const ready = !!(pi && tester?.stripeAccountId && tester.payoutsReady && split.testerCents > 0);
  // (Batch 35 §117 rule 5) Claimed only while still unpaid and not covered by another payment (a reservation pays only what no one payment covers).
  const claimed = await db.payment.updateMany({
    where: { id: p.id, settledAt: null, status: p.status, coveredById },
    // (Batch 33 §3) A failed charge settled from the reservation keeps why it failed (the Payment failures box: "settled by the team").
    data: { status, settledAt: new Date(), ...(p.owedUntil ? {} : { failure: "" }), actionPi: null, actionBy: null, warnedAt: null, stripePaymentIntentId: pi, ...split, transferStatus: pi ? (ready ? "sending" : "waiting") : "none" },
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
/**
 * (Owner, Oct 30, batch 34 §1) "That hold was already approved (by bo@… at 12:19 AM)." when another admin's Approve is on record for it (the approval lifts the hold,
 * so the hold itself no longer says so); otherwise the plain line.
 */
async function approvedRefusal(devId: string, fallback: HttpError, p: import("./adminRace").Presser | null = null) {
  const race = await import("./adminRace");
  const last = await race.lastAction(devId, ["approve-chargeback"]);
  const hold = await db.accountEvent.findFirst({ where: { userId: devId, kind: "hold" }, orderBy: { createdAt: "desc" } });
  if (!last || (hold && hold.createdAt > last.createdAt)) return fallback; // an approval of an earlier hold
  // (Batch 35 §45) This admin's own Approve (another tab): "You already approved lifting this hold in another tab at 3:20 AM."
  return new HttpError(409, "already", await race.alreadyLine(p, last.adminId, last.createdAt, (who) => `That hold was already approved ${race.byAt(who, last.createdAt)}.`, "approved lifting this hold"));
}
/**
 * Another admin's Don't approve since the page loaded: " (bo@… released it at 12:19 AM)" for the "nothing is reserved" lines; (batch 35 §45) this admin's own
 * in another tab: "you released it in another tab at 3:20 AM".
 */
async function releasedBy(devId: string, adminId: string | null, from: Date | null, tab = "") {
  if (!adminId || !from) return "";
  const race = await import("./adminRace");
  const rows = await db.adminAction.findMany({ where: { targetId: devId, action: "decline-chargeback", createdAt: { gt: from }, ...(tab ? {} : { adminId: { not: adminId } }) }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const last of rows) {
    const own = await race.ownChange({ adminId, tab }, last.adminId, last.createdAt);
    if (own === "here") continue;
    return own ? `you released it in another tab at ${race.whenText(last.createdAt)}` : `${await race.adminEmail(last.adminId)} released it at ${race.whenText(last.createdAt)}`;
  }
  return "";
}

export async function approveChargebackHold(devId: string, adminId: string | null = null, seen: import("./adminRace").AdminSeen | null = null) {
  const race = await import("./adminRace");
  const from = race.checkFrom(seen);
  const p = race.presserOf(adminId, seen);
  const steps = await chargebackSteps(devId);
  if (!steps) throw await approvedRefusal(devId, new HttpError(409, "no_chargeback_hold", "That account isn't on a chargeback hold."), p);
  if (steps.approved) throw await approvedRefusal(devId, new HttpError(409, "already", "That hold was already approved."), p);
  // (Owner, Nov 3) From the 2nd chargeback the team's Approve comes FIRST and only allows paying: nothing is taken or lifted here.
  if (steps.reviewFirst) return allowPaying(devId, adminId);
  // (Batch 35 §117 rule 3) A debt waiting for the bank is locked: never paid from the reservation or charged after the lift (its check pays it, or it's cancelled).
  const locks = await (await import("./owedOnce")).owedLocks(devId);
  const owing = (await payable(devId)).filter((x) => !locks.has(x.id)); // (§125) with the charges waiting for the lift
  const rs = await reserveState(devId);
  const owedCents = owing.reduce((a, p) => a + p.amountCents, 0);
  const { plan, after } = assign(owing, rs.active);
  const nothingReserved = owedCents > 0 && !rs.active.length;
  // (Batch 34 §1) Nothing reserved because another admin's Don't approve released it since the page loaded: the line says who and when.
  const released = nothingReserved ? await releasedBy(devId, adminId, seen?.since ?? null, seen?.tab) : "";
  if (!steps.cardVerified && nothingReserved) throw new HttpError(409, "steps_missing", `Not yet: the card isn't verified, and nothing is reserved (${money(owedCents)} is owed${released ? `; ${released}` : ""}).`);
  if (!steps.cardVerified) throw new HttpError(409, "steps_missing", "Not yet: the card isn't verified.");
  if (nothingReserved) throw new HttpError(409, "steps_missing", `Not yet: nothing is reserved (${money(owedCents)} is owed${released ? `; ${released}` : ""}).`);
  // (Batch 34 §1) Another admin's Don't approve since the page loaded (the developer reserved again since): the Approve stops once; the second press takes it.
  if (from && adminId) race.stopIfChanged("Approve", await race.holdChangesSince(devId, adminId, from, seen?.tab));
  // (Nov 2, §119) The claim and the admin's record (who, when) commit together, so a second admin's refusal always names the one who approved it.
  // (Owner, Nov 4, §178) Under the developer's row lock (chargebackOpened's claim takes it too): the chargebacks this Approve resolves are the ones open now. One
  // that opens after it is a new chargeback: it stays open (so the hold stays on, now reviewed first), never resolved unpaid by this press.
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
    const r = await tx.user.updateMany({ where: { id: devId, chargebackApprovedAt: null, holdStartedAt: { not: null }, holdReason: "chargeback" }, data: { chargebackApprovedAt: new Date() } });
    const open = r.count === 1 ? (await tx.payment.findMany({ where: { developerId: devId, chargeback: "open" }, select: { id: true } })).map((x) => x.id) : [];
    return { count: r.count, open, record: r.count === 1 && adminId ? await race.recordAction(tx, adminId, "approve-chargeback", devId) : null };
  });
  if (claimed.count !== 1) throw await approvedRefusal(devId, new HttpError(409, "already", "That hold was already approved."), p);
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
        if (claimed.record) await db.adminAction.deleteMany({ where: { id: claimed.record.id } }); // (Nov 2, §119) not approved after all: no record names it
        if ((await db.reservation.updateMany({ where: { id: r.id, status: "reserved" }, data: { status: "expired", endedAt: new Date() } })).count === 1) {
          await cancelPi(r.stripePaymentIntentId);
          await bell(devId, RESERVE_EXPIRED, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
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

  for (const p of await db.payment.findMany({ where: { id: { in: claimed.open }, chargeback: "open" } })) {
    if ((await db.payment.updateMany({ where: { id: p.id, chargeback: "open" }, data: { chargeback: "resolved" } })).count !== 1) continue;
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
    // (§133) "The team resolved the bank reversal of $96.00 of your $444.67 payment" when the bank reversed part of it.
    if (c) await logEvent(c.testId, "chargeback", `The team resolved the bank reversal of ${reversedWords(p)}${await reversalFor(p)}`, c.id); // (§177) which payment
  }
  // (Batch 24, a batch 23 leftover) ONE notice for the developer: when Approve lifts the hold it says so too (the testers still get their "is running again").
  const lifted = await liftHoldIfClear(devId, { quietDev: true });
  // (Batch 25 section 5) One bell line for this money: when the Approve lifts the hold, its one notice names the amount taken ("…the $8.00 reserved on your card was
  // taken…"), so there is no separate receipt line; otherwise the receipt says it.
  if (taken && !lifted) await receipt(dev.email, "what you owed (reserved on your card, taken on the team's approval)", taken, stripeOn() ? "charged" : "not_set_up", "/app/payments");
  const afterLift = await db.user.findUniqueOrThrow({ where: { id: devId }, select: { devSuspendedAt: true, holdStartedAt: true } });
  const still = lifted && !!afterLift.devSuspendedAt;
  if (lifted && afterLift.holdStartedAt) {
    const line = `The team approved lifting your hold${taken ? `: the ${money(taken)} reserved on your card was taken` : ""}. A waiting payment was declined, so your tests are paused again.`;
    await notify(dev.email, line, [line], "/app/payments#owed", { side: "developer", always: true, payment: true, group: "admindecision" });
  } else if (lifted) {
    // Lifted while an admin suspension is still on: the same one notice says the tests stay paused (ignores Off, like "running again").
    const line = still ? approvedStillSuspendedLine(taken) : approvedLiftedLine(taken);
    await notify(dev.email, line, [line, ...(still ? [] : ["Every deadline moved on by the pause."])], "/app", { side: "developer", always: true, payment: true, group: "admindecision" });
  } else await notify(dev.email, APPROVED_LINE, [`${APPROVED_LINE}.`, ...(taken ? [`The ${money(taken)} reserved on your card was taken.`] : [])], "/app/payments", { side: "developer", payment: true, group: "admindecision" });
  return { ok: true, lifted, takenCents: taken };
}
/**
 * (Owner, Nov 3) The team allows a developer with 2+ chargebacks to pay: claimed once (with the admin's record), anything still reserved from before is released
 * (nothing taken: paying charges everything as one payment), and the developer gets a bell and an email. A new chargeback before they pay un-approves it again
 * (chargebackOpened clears the approval).
 */
async function allowPaying(devId: string, adminId: string | null) {
  const race = await import("./adminRace");
  const claimed = await db.$transaction(async (tx) => {
    const r = await tx.user.updateMany({ where: { id: devId, chargebackApprovedAt: null, holdStartedAt: { not: null }, holdReason: "chargeback" }, data: { chargebackApprovedAt: new Date() } });
    if (r.count === 1 && adminId) await race.recordAction(tx, adminId, "approve-chargeback", devId);
    return r.count;
  });
  if (claimed !== 1) throw await approvedRefusal(devId, new HttpError(409, "already", "That hold was already approved."));
  const released = await releaseReservations(devId);
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  await notify(dev.email, REVIEWED_LINE, [`${REVIEWED_LINE}.`, "Pay what you owe charges everything you owe as one payment, and your tests resume as soon as it goes through.", ...(released ? [`The ${money(released)} reserved on your card earlier was released.`] : [])], "/app/payments#owed", { side: "developer", always: true, payment: true, group: "admindecision" });
  return { ok: true, lifted: false, takenCents: 0, allowedToPay: true };
}
export const APPROVED_LINE = "The team approved lifting your hold";
/** "The team approved lifting your hold: the $8.00 reserved on your card was taken, and your tests are running again." */
export const approvedLiftedLine = (cents: number) => `${APPROVED_LINE}: ${cents ? `the ${money(cents)} reserved on your card was taken, and ` : ""}your tests are running again.`;
/** Lifted while suspended: "The team approved lifting your hold: the $8.00 reserved on your card was taken. Your tests stay paused while your account is suspended." */
export const approvedStillSuspendedLine = (cents: number) => `${APPROVED_LINE}${cents ? `: the ${money(cents)} reserved on your card was taken` : ""}. Your tests stay paused while your account is suspended.`;

/** (Batch 23 section 6) The team doesn't approve (yet): every reservation is cancelled (nothing taken) and the hold stays. */
export async function declineChargebackReserve(devId: string, note = "", adminId: string | null = null, seen: import("./adminRace").AdminSeen | null = null) {
  const u = await db.user.findUnique({ where: { id: devId } });
  const race = await import("./adminRace");
  const p = race.presserOf(adminId, seen);
  // (Batch 34 §1) Approved meanwhile: refused naming who and when.
  if (!u?.holdStartedAt || u.holdReason !== "chargeback") throw await approvedRefusal(devId, new HttpError(409, "no_chargeback_hold", "That account isn't on a chargeback hold."), p);
  if (u.chargebackApprovedAt) throw await approvedRefusal(devId, new HttpError(409, "already", "That hold was already approved."), p);
  const from = race.checkFrom(seen);
  if (from && adminId && (await reserveState(devId)).active.length) race.stopIfChanged("Don't approve: release the reservation", await race.holdChangesSince(devId, adminId, from, seen?.tab));
  const cents = await releaseReservations(devId);
  if (!cents) {
    const released = await releasedBy(devId, adminId, seen?.since ?? null, seen?.tab);
    throw new HttpError(409, "nothing_reserved", released ? `Nothing is reserved on that account (${released}).` : "Nothing is reserved on that account.");
  }
  // (Owner, Nov 5, §201) The team's note is in the bell line too (it was only in the email).
  const line = notApprovedLine(cents) + (await import("./holds")).theirNote(note);
  await notify(u.email, line, [line], "/app/payments#chargeback-steps", { side: "developer", payment: true, group: "admindecision" });
  return { ok: true, releasedCents: cents };
}
/** "The team didn't approve lifting your hold: the $23.00 reserved on your card was released, and nothing was taken." */
export const notApprovedLine = (cents: number) => `The team didn't approve lifting your hold: the ${money(cents)} reserved on your card was released, and nothing was taken.`;

/**
 * The admin's list: every developer on a chargeback hold with the step status. The holds stay oldest hold first; (Owner, Nov 5, §277) each developer's open
 * chargebacks are newest first (by when the bank opened it; the payment's own time, then its id, breaks a tie).
 */
export async function chargebackHolds() {
  const devs = await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: "chargeback" }, orderBy: { holdStartedAt: "asc" } });
  const out = [];
  for (const d of devs) {
    const steps = (await chargebackSteps(d.id))!;
    const cbs = await db.payment.findMany({ where: { developerId: d.id, chargeback: "open" }, orderBy: [{ chargebackAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }] });
    out.push({ dev: d, steps, chargebacks: cbs });
  }
  return out;
}
