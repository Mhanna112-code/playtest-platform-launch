import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { CHARGEBACK_FEE_CENTS, CHECK_ALREADY_PAID, CHECK_CANCELLED, NO_CHECK_WAITING, owedReceiptWhat } from "@/lib/rules";
import { HttpError } from "./http";
import { PAYMENTS_PROBLEM, charge, chargePlatform, getStripe, stripeOn, type NeedsAction } from "./stripe";
import { serverKey } from "./pressKeys";
import { receipt } from "./payments";

// (Owner, Nov 2, batch 35 §117) One card in play; bank checks never double-charge.
// - Pay what you owe is ONE payment: a press, a daily retry and a new-card retry charge the TOTAL of what's owed at once, as a Payment of kind "owed" (the
//   "one payment"; testerId is the developer, like a renewal's row). Each debt it covers points to it (coveredById): while it is being charged or waits for the
//   bank, those debts are LOCKED (a press, a retry or a new card's retry never charges them again; the box shows "Waiting for your bank" and "Cancel this check");
//   once it went through, every covered debt is paid by it (settleOwedRow: the tester's share is sent from that one charge) and keeps the link.
// - Never an orphan check: whenever the app stops tracking a check it is cancelled at Stripe first (dropCheck); one that had already gone through is recorded as paid.
// - Saving a new card cancels every waiting check (debts and new charges made while away) and tries each item again on the new card at once (newCardChecks).

export const OWED_KIND = "owed";
/** The one payment is being charged ("paying"), its press check is open ("needs_action"), or its check waits for the developer ("needs_confirmation"). */
export const OWED_ACTIVE = ["paying", "needs_action", "needs_confirmation"];
/** The one payment went through: each covered debt is "charged" (or "not_set_up") itself, so this row is never counted as paid again. */
export const OWED_PAID = "bundled";

/**
 * (Rule 3) The debts locked by a bank check: debt id -> the check to cancel ("Cancel this check"): the one payment covering it, or (a check made before §117) the
 * debt itself.
 */
export async function owedLocks(devId: string) {
  const out = new Map<string, string>();
  const active = await db.payment.findMany({ where: { developerId: devId, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, select: { id: true } });
  if (active.length) for (const d of await db.payment.findMany({ where: { coveredById: { in: active.map((a) => a.id) } }, select: { id: true, coveredById: true } })) out.set(d.id, d.coveredById!);
  for (const d of await db.payment.findMany({ where: { developerId: devId, kind: { not: OWED_KIND }, actionPi: { not: null }, status: { in: ["failed", "owed", "paying"] } }, select: { id: true } })) out.set(d.id, d.id);
  return out;
}

/**
 * (Rule 4) Stop tracking a bank check only once Stripe cancelled it. "succeeded": it had already gone through (record it as paid; never charge the item again).
 * Throws when Stripe's answer is unclear: the check stays tracked and is tried again later.
 */
export async function dropCheck(pi: string | null | undefined): Promise<"cancelled" | "succeeded"> {
  if (!pi || !stripeOn()) return "cancelled";
  const stripe = getStripe();
  try {
    const r = await stripe.paymentIntents.cancel(pi);
    return r?.status === "succeeded" ? "succeeded" : "cancelled";
  } catch (e) {
    const now = await Promise.resolve()
      .then(() => stripe.paymentIntents.retrieve(pi))
      .catch(() => null);
    if (now?.status === "succeeded") return "succeeded";
    if (now?.status === "canceled") return "cancelled";
    console.error("[stripe] cancel check:", (e as Error).message);
    throw new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
  }
}

/** Claim a check (its actionPi) so only one of Confirm, the clock, Cancel this check or a new card ends it. */
const claimCheck = async (p: { id: string; actionPi: string | null }) => (await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null, actionBy: null } })).count === 1;

const ROLLBACK = new Error("owed changed");

/**
 * (Rules 5 and 6) Make the one payment and lock what it covers, all at once under the developer's row lock: every debt must still be owed, unpaid, with no check of
 * its own and not covered by another payment (else nothing is claimed: null).
 */
async function claimOwed(devId: string, rows: { id: string; amountCents: number; chargeback: string }[], mode: "press" | "away") {
  const debts = rows.filter((r) => r.chargeback !== "open").map((r) => r.id);
  const reversed = rows.filter((r) => r.chargeback === "open").map((r) => r.id);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
      // A press claim left by the code before §117 ("paying" with no check open) is owed again.
      const stale = { developerId: devId, kind: { notIn: ["chargeback", OWED_KIND] }, status: "paying", actionPi: null, settledAt: null };
      await tx.payment.updateMany({ where: { ...stale, owedUntil: { not: null } }, data: { status: "failed", warnedAt: null } });
      await tx.payment.updateMany({ where: { ...stale, owedUntil: null }, data: { status: "owed", warnedAt: null } });
      const total = rows.reduce((a, p) => a + p.amountCents, 0);
      const one = await tx.payment.create({ data: { kind: OWED_KIND, developerId: devId, testerId: devId, amountCents: total, feeCents: total, testerCents: 0, transferStatus: "none", status: "paying", note: mode, warnedAt: new Date() } });
      const n = debts.length
        ? (await tx.payment.updateMany({ where: { id: { in: debts }, developerId: devId, coveredById: null, actionPi: null, settledAt: null, OR: [{ status: "failed", owedUntil: { not: null } }, { status: "owed" }] }, data: { coveredById: one.id } })).count
        : 0;
      const m = reversed.length ? (await tx.payment.updateMany({ where: { id: { in: reversed }, developerId: devId, coveredById: null, chargeback: "open" }, data: { coveredById: one.id } })).count : 0;
      if (n !== debts.length || m !== reversed.length) throw ROLLBACK;
      return one;
    });
  } catch (e) {
    if (e === ROLLBACK) return null;
    throw e;
  }
}

/** The one payment was cancelled, declined or ran out of time: what it covered is owed (and payable) again. */
export async function releaseOwed(id: string) {
  const ended = await db.payment.updateMany({ where: { id, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, data: { status: "cancelled", actionPi: null, actionBy: null } });
  if (ended.count !== 1) return false;
  await db.payment.updateMany({ where: { coveredById: id, OR: [{ settledAt: null }, { chargeback: "open" }] }, data: { coveredById: null } });
  return true;
}

/**
 * The one payment went through (at once, or its bank check was confirmed): every debt it covers is paid by it, once. Returns what was paid ({ again } when it was
 * already settled). The caller sends the developer's one line (the press's receipt, the retry's line, Confirm's receipt).
 */
export async function settleOwed(id: string, pi: string | null) {
  const one = await db.payment.findUniqueOrThrow({ where: { id } });
  const claimed = await db.payment.updateMany({ where: { id, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, data: { status: OWED_PAID, settledAt: new Date(), stripePaymentIntentId: pi, actionPi: null, actionBy: null } });
  if (claimed.count !== 1) return { again: true, cents: 0, names: [] as string[] };
  const holds = await import("./holds");
  const { settleOwedRow } = await import("./chargeback");
  const dev = await db.user.findUniqueOrThrow({ where: { id: one.developerId } });
  const rows = (await holds.owed(one.developerId)).filter((p) => p.coveredById === id);
  const names: string[] = [];
  let cents = 0;
  for (const p of rows) {
    await settleOwedRow(dev, p, pi && stripeOn() ? pi : null, id);
    names.push(await holds.owedItemName(p));
    cents += p.amountCents;
  }
  return { again: false, cents, names };
}

/**
 * (Rule 6) Charge what is owed as ONE payment on the saved card. "press": the developer's own Pay what you owe (on-session: the bank's check opens inline);
 * "away": a daily or new-card retry (the bank's check waits 3 days as one "Confirm with your bank" item).
 */
export async function chargeOwedTotal(u: Parameters<typeof chargePlatform>[0], rows: { id: string; amountCents: number; chargeback: string }[], mode: "press" | "away") {
  if (!rows.length) return { result: "skipped" as const };
  const one = await claimOwed(u.id, rows, mode);
  if (!one) return { result: "skipped" as const };
  return chargeClaimed(u, one, mode);
}

async function chargeClaimed(u: Parameters<typeof chargePlatform>[0], one: Payment, mode: "press" | "away") {
  let r: Awaited<ReturnType<typeof chargePlatform>>;
  try {
    // (Batch 32 §15) No saved card: handled as a declined card, never sent to Stripe with an empty card.
    if (stripeOn() && (!u.stripeCustomerId || !u.stripePaymentMethodId)) throw new HttpError(402, "card_failed", "No card is saved on this account.");
    // One key per payment: charged again with it (resumeStaleOwed), Stripe answers with what happened the first time.
    r = await chargePlatform(u, one.amountCents, serverKey("owedall", one.id), "Playtest: what you owe", mode);
  } catch (e) {
    const why = (await import("./holds")).owedWhy(e);
    // Stripe's answer was lost (it may have been charged): what it covers stays locked until the same charge is asked again (resumeStaleOwed), never charged twice.
    if (e instanceof HttpError && (e.code === "payment_unknown" || e.code === "idempotency")) return { result: "failed" as const, why };
    await releaseOwed(one.id);
    return { result: "failed" as const, why };
  }
  const confirm = await import("./confirm");
  if (r.status === "requires_action") {
    if (mode === "press") return { result: "action" as const, action: await confirm.pressAction(one.id, r as NeedsAction) };
    await confirm.awayAction(one.id, r as NeedsAction);
    return { result: "waiting" as const };
  }
  const s = await settleOwed(one.id, r.stripePaymentIntentId);
  return { result: "paid" as const, cents: s.cents, names: s.names, status: r.status };
}

/**
 * A one payment left "paying" for over 10 minutes (Stripe's answer was lost, or the server stopped mid-charge) is asked again with the SAME key: Stripe answers with
 * what happened the first time, so it is finished (paid, waiting for the bank, or declined and released) and never charged twice. Runs before every press and retry.
 */
export async function resumeStaleOwed(devId: string, now = new Date()) {
  const stale = await db.payment.findMany({ where: { developerId: devId, kind: OWED_KIND, status: "paying", actionPi: null, warnedAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
  if (!stale.length) return;
  const u = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const holds = await import("./holds");
  for (const one of stale) {
    if ((await db.payment.updateMany({ where: { id: one.id, status: "paying", warnedAt: one.warnedAt }, data: { warnedAt: now } })).count !== 1) continue;
    const r = await chargeClaimed(u, one, one.note === "press" ? "press" : "away");
    if (r.result !== "paid") continue;
    if (r.cents > 0) await receipt(u.email, owedReceiptWhat(r.names), r.cents, r.status !== "not_set_up" ? "charged" : "not_set_up", "/app/payments");
    await holds.liftHoldIfClear(devId);
  }
}

/** Each one payment's covered debts, named with their amounts ("Ana Silva's work $8.00"), for the confirm items. */
export async function coveredNames(ids: string[]) {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const holds = await import("./holds");
  for (const p of await db.payment.findMany({ where: { coveredById: { in: ids } }, orderBy: { createdAt: "asc" } })) {
    const cents = p.chargeback === "open" ? p.amountCents + CHARGEBACK_FEE_CENTS : p.amountCents;
    out.set(p.coveredById!, [...(out.get(p.coveredById!) ?? []), `${await holds.owedItemName(p)} ${money(cents)}`]);
  }
  return out;
}

/**
 * (Rule 3) "Cancel this check" next to a debt waiting for the bank: the check is cancelled at Stripe and what it covered is payable at once. When the bank had
 * already confirmed it, it is recorded as paid instead (nothing charged again).
 */
export async function cancelOwedCheck(devId: string, id: string) {
  const p = await db.payment.findUnique({ where: { id } });
  if (!p || p.developerId !== devId) throw new HttpError(404, "not_found", NO_CHECK_WAITING);
  if (!p.actionPi) {
    if (p.status === OWED_PAID) throw new HttpError(409, "confirmed", CHECK_ALREADY_PAID);
    if (p.kind === OWED_KIND && p.status === "paying") throw new HttpError(409, "busy", "This payment is going through right now. Try again shortly.");
    throw new HttpError(409, "no_check", NO_CHECK_WAITING);
  }
  const end = await dropCheck(p.actionPi);
  if (!(await claimCheck(p))) throw new HttpError(409, "confirmed", CHECK_ALREADY_PAID);
  const confirm = await import("./confirm");
  if (end === "succeeded") {
    await confirm.finishConfirmed(p.id);
    return { paid: true, line: CHECK_ALREADY_PAID };
  }
  if (p.kind === OWED_KIND) await releaseOwed(p.id);
  else if (p.status === "paying") await db.payment.update({ where: { id: p.id }, data: { status: p.owedUntil ? "failed" : "owed", warnedAt: null } });
  return { cancelled: true, line: CHECK_CANCELLED };
}

/**
 * (Rule 1) ONE CARD IN PLAY: a new card was saved. Every waiting bank check (debts and new charges made while away) is cancelled at Stripe and each item is tried
 * again on the new card at once: a new charge here (goes through: paid; the bank asks: a new 3-day "Confirm with your bank" item on the new card; declined: a debt);
 * debts by the new-card retry of what's owed (retryOwed "card"). A check that had already gone through is recorded as paid. (A renewal's check is its invoice's:
 * its Confirm uses the current card.)
 */
export async function newCardChecks(devId: string) {
  const waiting = await db.payment.findMany({ where: { developerId: devId, actionPi: { not: null }, kind: { not: "subscription" }, status: { in: ["needs_confirmation", "failed", "owed"] } }, orderBy: { createdAt: "asc" } });
  for (const p of waiting) {
    try {
      const end = await dropCheck(p.actionPi);
      if (!(await claimCheck(p))) continue; // confirmed meanwhile
      const confirm = await import("./confirm");
      if (end === "succeeded") await confirm.finishConfirmed(p.id);
      else if (p.kind === OWED_KIND) await releaseOwed(p.id);
      // (Batch 35 §113) During a hold a charge made while away waits for the lift (charged then, on the card in use then), never on the new card now.
      else if (p.status === "needs_confirmation" && !(await deferWhileHeld(p.id))) await chargeAgain(devId, p);
      // else: a debt with a check of its own (before §117): it stays owed and goes with the retry of what's owed.
    } catch (e) {
      console.error("[card] new card checks:", (e as Error).message);
    }
  }
}

/**
 * (Batch 35 §113 with §117) A charge made while away whose check ended (ran out, or a new card cancelled it) while the account is on a hold: it waits as "deferred" and is
 * charged when the hold lifts (chargeDeferred, on the card in use then). Under the developer's row lock, like deferIfHeld, so a lift at the same moment can't miss it.
 * A reversed payment's repay row (kind "chargeback") keeps its own handling. False when there is no hold.
 */
export async function deferWhileHeld(paymentId: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.kind === "chargeback" || p.kind === "subscription" || p.kind === OWED_KIND) return false;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${p.developerId} FOR UPDATE`;
    const dev = await tx.user.findUniqueOrThrow({ where: { id: p.developerId }, select: { holdStartedAt: true } });
    if (!dev.holdStartedAt) return false;
    return (await tx.payment.updateMany({ where: { id: p.id, status: "needs_confirmation" }, data: { status: "deferred", actionPi: null, actionBy: null } })).count === 1;
  });
}

/** A charge made while away, tried again on the new card. */
async function chargeAgain(devId: string, p: Payment) {
  const u = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const holds = await import("./holds");
  const confirm = await import("./confirm");
  const key = serverKey("newcard", p.id, u.stripePaymentMethodId ?? "");
  if (p.kind === "chargeback") {
    // A reversed payment owed again (charged after a lift): to the platform, as chargeDeferred does.
    try {
      const r = await chargePlatform(u, p.amountCents, key, "Playtest: a payment reversed by your bank, charged again", "away");
      if (r.status === "requires_action") return void (await confirm.awayAction(p.id, r as NeedsAction));
      await db.payment.update({ where: { id: p.id }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, settledAt: new Date() } });
      await receipt(u.email, await holds.owedItemName(p), p.amountCents, r.status, "/app/payments");
    } catch {
      await db.payment.delete({ where: { id: p.id } });
      if (p.repaysId) await db.payment.update({ where: { id: p.repaysId }, data: { chargeback: "open" } });
      await holds.startHold(devId, "chargeback");
    }
    return;
  }
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  try {
    const r = await charge(u, tester, p.amountCents, key, "Playtest: charged on your new card", "away");
    if (r.status === "requires_action") return void (await confirm.awayAction(p.id, r as NeedsAction));
    await db.payment.update({ where: { id: p.id }, data: { status: r.status, feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus, stripePaymentIntentId: r.stripePaymentIntentId, settledAt: new Date() } });
    await holds.settledOwed(p.id, false);
  } catch {
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
    await holds.declinedPayment(devId, p.id, p.amountCents, c ? `${displayName(c.tester)}'s ${p.kind === "dispute" ? "dispute decision" : "work"} on “${c.title}” (declined on your new card)` : `a payment of ${money(p.amountCents)} (declined on your new card)`);
  }
}
