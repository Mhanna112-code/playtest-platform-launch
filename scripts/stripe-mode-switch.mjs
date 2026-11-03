// (Owner, Nov 2, batch 35 §130) The Stripe mode switch, run by Vercel's build (package.json "vercel-build", after `prisma migrate deploy`).
//
// Stripe ids are per mode: live Stripe doesn't know an id made in test mode, and test Stripe doesn't know a live one ("No such customer / payment_method / account
// / payment_intent"). The owner can switch the keys between test and live at any time, so whenever the key's MODE (STRIPE_SECRET_KEY "sk_live_" / "rk_live_" = live,
// "sk_test_" / "rk_test_" = test; STRIPE_ALLOW_LIVE doesn't matter) differs from the mode the switch last ran for (AppState "stripeMode" = {"mode","switchedAt"}; none
// stored = "test", as everything before §130 was made in test mode), the other mode's ids are cleared and what was still open on them is closed, with NOTHING charged
// and nothing marked paid; then the new mode is stored. The same mode again, or no key: nothing. It logs counts only (never an id, an email or a key).
//
// What it does, all in one transaction:
// - Users: the developer's customer, saved card and its expiry are cleared (Payments shows "Add a card"); a chargeback hold's "card verified" step is open again (that
//   card is gone); the tester's payout account and payoutsReady are cleared (Payments shows "Connect a payout account"; shares wait, as before setup).
// - Stripe subscriptions (not "manual" ones): ended the way Stripe deleting one ends it (past due: lapsed; otherwise: cancelled); the id is cleared. The stored
//   subscription product id goes too (made again on the next Subscribe).
// - Open bank checks (a payment with a PaymentIntent waiting, actionPi), closed as cancelled with nothing charged (src/lib/server/confirm.ts closeStaleCheck does the same
//   at run time): a press's check is a cancelled press; Pay what you owe's one payment is cancelled and what it covered is owed again (charges it covered keep waiting);
//   a retried chargeback's row goes (the reversal stays owed); a charge made while away is cancelled and its part is unpaid again (the review the charge made goes; a
//   dispute decision's dispute is open again); a debt with a check of its own stays owed (only the check goes). A one payment left "paying" is cancelled the same way.
// - Reservations still open (being made, at the bank's check, or reserved): cancelled (nothing taken; Pay what you owe reserves again).
// - Testers' shares waiting for a payout account on the other mode's charge: closed (transferStatus "closed"; there's no live charge to send them from).
// Amounts owed stay owed; work that wasn't paid stays unpaid; nothing is ever marked paid.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

export const MARKER_KEY = "stripeMode";
export const STALE_CHECK = "Closed: this check was made in Stripe's other mode (test or live). Nothing was charged.";

/** The key's mode: "live", "test", or null (no key, or not a Stripe secret key). @param {Record<string, string | undefined>} env */
export const keyMode = (env) => {
  const k = env.STRIPE_SECRET_KEY?.trim() ?? "";
  return /^(sk|rk)_live_/.test(k) ? "live" : /^(sk|rk)_test_/.test(k) ? "test" : null;
};
/** The mode the switch last ran for (none stored: "test"). */
export async function storedMode(db) {
  const row = await db.appState.findUnique({ where: { key: MARKER_KEY } });
  if (!row) return "test";
  try {
    const v = JSON.parse(row.value);
    return v?.mode === "live" ? "live" : "test";
  } catch {
    return "test";
  }
}

/**
 * Run the switch with a Prisma client. Returns { ran: false, reason } or { ran: true, from, to, counts }. Idempotent: the new mode is stored in the same transaction
 * as the changes, so a failed run changes nothing and the next build tries again.
 * @param {{ db: import("@prisma/client").PrismaClient, env?: Record<string, string | undefined>, log?: (line: string) => void, now?: Date }} o
 */
export async function switchStripeMode({ db, env = process.env, log = console.log, now = new Date() }) {
  const mode = keyMode(env);
  if (!mode) {
    log("[stripe-mode] no Stripe key: nothing to switch.");
    return { ran: false, reason: "no_key" };
  }
  const from = await storedMode(db);
  if (from === mode) {
    log(`[stripe-mode] already in ${mode} mode: nothing to do.`);
    return { ran: false, reason: "same_mode", mode };
  }
  const ops = [];
  const counts = {};
  const add = (name, op) => { ops.push(op); counts[name] = op; };

  // ---- Open bank checks (payments with a PaymentIntent waiting) and stale one-payment claims ----
  const checks = await db.payment.findMany({ where: { actionPi: { not: null } } });
  const staleOwed = await db.payment.findMany({ where: { kind: "owed", status: "paying", actionPi: null } });
  const staleClaims = await db.payment.count({ where: { kind: { notIn: ["owed", "chargeback"] }, status: "paying", actionPi: null } });
  const cancelled = new Set();
  const deleted = new Set();
  const uncover = new Set();
  const reviewsGo = [];
  const disputesOpen = [];
  const keepOwed = new Set();
  const awayClosed = [];
  const paying = { failed: [], owed: [] };
  for (const p of checks) {
    if (p.kind === "owed") { cancelled.add(p.id); uncover.add(p.id); continue; }
    if (p.status === "needs_action") {
      if (p.kind === "chargeback") deleted.add(p.id);
      else {
        cancelled.add(p.id);
        if ((p.kind === "review" || p.kind === "call") && !p.reviewDraft && (p.submissionId || p.callId)) reviewsGo.push(p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId });
      }
      continue;
    }
    if (p.status === "paying") { (p.owedUntil ? paying.failed : paying.owed).push(p.id); continue; }
    if (p.status === "needs_confirmation") {
      if (p.kind === "chargeback") { deleted.add(p.id); continue; }
      cancelled.add(p.id);
      if (p.kind !== "subscription") awayClosed.push(p.id);
      if (p.kind === "dispute" && p.disputeId) disputesOpen.push(p.disputeId);
      else if ((p.kind === "review" || p.kind === "call") && (p.submissionId || p.callId)) reviewsGo.push(p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId });
      continue;
    }
    keepOwed.add(p.id); // a debt with a check of its own: it stays owed, only the check goes
  }
  for (const p of staleOwed) { cancelled.add(p.id); uncover.add(p.id); }

  const closeData = { actionPi: null, actionBy: null };
  if (uncover.size) ops.push(db.payment.updateMany({ where: { coveredById: { in: [...uncover] }, OR: [{ settledAt: null }, { chargeback: "open" }] }, data: { coveredById: null } }));
  for (const where of reviewsGo) ops.push(db.review.deleteMany({ where }));
  if (disputesOpen.length) ops.push(db.dispute.updateMany({ where: { id: { in: disputesOpen }, status: "decided" }, data: { status: "open", decidedCents: null, decidedAt: null, decidedById: null, decisionNote: "" } }));
  add("checksCancelled", db.payment.updateMany({ where: { id: { in: [...cancelled] } }, data: { ...closeData, status: "cancelled", failure: STALE_CHECK } }));
  // A charge made while away keeps its row as the record, with its keys freed so its part can be charged again (the piece's key is fixed: "choice:", "autocall:").
  ops.push(db.payment.updateMany({ where: { id: { in: awayClosed } }, data: { payKey: null, pressKey: null } }));
  add("checksRemoved", db.payment.deleteMany({ where: { id: { in: [...deleted] } } }));
  add("debtChecksClosed", db.payment.updateMany({ where: { id: { in: [...keepOwed, ...paying.failed, ...paying.owed] } }, data: closeData }));
  ops.push(db.payment.updateMany({ where: { id: { in: paying.failed } }, data: { status: "failed", warnedAt: null } }));
  ops.push(db.payment.updateMany({ where: { id: { in: paying.owed } }, data: { status: "owed", warnedAt: null } }));
  // A press claim left "paying" with no check (before §117): owed again, as claimOwed does.
  const stale = { kind: { notIn: ["owed", "chargeback"] }, status: "paying", actionPi: null, settledAt: null };
  ops.push(db.payment.updateMany({ where: { ...stale, owedUntil: { not: null } }, data: { status: "failed", warnedAt: null } }));
  ops.push(db.payment.updateMany({ where: { ...stale, owedUntil: null }, data: { status: "owed", warnedAt: null } }));

  // ---- Reservations (chargeback holds' Pay what you owe) ----
  add("reservationsCancelled", db.reservation.updateMany({ where: { status: { in: ["pending", "needs_action", "reserved"] } }, data: { status: "cancelled", endedAt: now, actionBy: null } }));

  // ---- Testers' shares waiting to be sent from a test-mode charge ----
  add("sharesClosed", db.payment.updateMany({ where: { transferStatus: { in: ["waiting", "sending"] } }, data: { transferStatus: "closed" } }));

  // ---- Stripe subscriptions: ended as Stripe deleting them ends them ----
  const stripeSub = { subscriptionId: { not: null }, NOT: { subscriptionId: "manual" } };
  const ending = { subscriptionEndedAt: now, subscriptionCanceling: false, subscriptionPausedAt: null, subscriptionPastDueAt: null };
  add("subscriptionsLapsed", db.user.updateMany({ where: { ...stripeSub, subscriptionStatus: "past_due" }, data: { ...ending, subscriptionStatus: "ended", subscriptionEndReason: "lapsed" } }));
  add("subscriptionsEnded", db.user.updateMany({ where: { ...stripeSub, subscriptionStatus: "active" }, data: { ...ending, subscriptionStatus: "ended", subscriptionEndReason: "cancelled" } }));
  add("subscriptionIdsCleared", db.user.updateMany({ where: stripeSub, data: { subscriptionId: null } }));
  ops.push(db.appState.deleteMany({ where: { key: "stripe-sub-product" } }));

  // ---- Users' customers, cards and payout accounts ----
  add("cardsCleared", db.user.updateMany({ where: { OR: [{ stripeCustomerId: { not: null } }, { stripePaymentMethodId: { not: null } }, { cardExpMonth: { not: null } }, { cardExpYear: { not: null } }] }, data: { stripeCustomerId: null, stripePaymentMethodId: null, cardExpMonth: null, cardExpYear: null } }));
  add("cardChecksReopened", db.user.updateMany({ where: { chargebackCardVerifiedAt: { not: null } }, data: { chargebackCardVerifiedAt: null } }));
  add("payoutsCleared", db.user.updateMany({ where: { OR: [{ stripeAccountId: { not: null } }, { payoutsReady: true }] }, data: { stripeAccountId: null, payoutsReady: false } }));

  // ---- The marker, last, in the same transaction ----
  const value = JSON.stringify({ mode, switchedAt: now.toISOString() });
  ops.push(db.appState.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value }, update: { value } }));

  const results = await db.$transaction(ops);
  const out = { staleClaimsOwedAgain: staleClaims };
  for (const [name, op] of Object.entries(counts)) out[name] = results[ops.indexOf(op)].count;
  out.reviewsFreed = reviewsGo.length;
  out.disputesReopened = disputesOpen.length;
  log(`[stripe-mode] switched from ${from} to ${mode}: ${Object.entries(out).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return { ran: true, from, to: mode, counts: out };
}

// Run directly (the build): reads DATABASE_URL as Prisma does (the environment, else .env).
const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(import.meta.url);
  try {
    require("@next/env").loadEnvConfig(root);
  } catch {
    // the environment as it is
  }
  if (!keyMode(process.env)) {
    console.log("[stripe-mode] no Stripe key: nothing to switch.");
  } else {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient();
    try {
      await switchStripeMode({ db });
    } catch (e) {
      console.error("[stripe-mode] the Stripe mode switch failed, nothing was changed:", e?.message ?? e);
      console.error("The build stopped so payments never run on the other mode's ids. Deploy again once the database is reachable.");
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  }
}
