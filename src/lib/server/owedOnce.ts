import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { money, zoneOpt } from "@/lib/format";
import { CHARGEBACK_FEE_CENTS, CHECK_ALREADY_CANCELLED, CHECK_ALREADY_PAID, CHECK_CANCELLED, NO_CHECK_WAITING, namesList, owedReceiptWhat, reversedOf } from "@/lib/rules";
import { HttpError } from "./http";
import { PAYMENTS_PROBLEM, chargePlatform, getStripe, isMissing, stripeOn, type NeedsAction } from "./stripe";
import { serverKey } from "./pressKeys";
import { receipt } from "./payments";
import { describedOnce, stripeDescription } from "./paymentRows";

// (Owner, Nov 2, batch 35 §117) One card in play; bank checks never double-charge.
// - Pay what you owe is ONE payment: a press (since §145/§148 the only way; an "away" one may remain from before) charges the TOTAL of what's owed at once, as a Payment of kind "owed" (the
//   "one payment"; testerId is the developer, like a renewal's row). Each debt it covers points to it (coveredById): while it is being charged or waits for the
//   bank, those debts are LOCKED (a press, a retry or a new card's retry never charges them again; the box shows "Waiting for your bank" and "Cancel this check");
//   once it went through, every covered debt is paid by it (settleOwedRow: the tester's share is sent from that one charge) and keeps the link.
// - Never an orphan check: whenever the app stops tracking a check it is cancelled at Stripe first (dropCheck); one that had already gone through is recorded as paid.
// - Saving a new card cancels every waiting check (debts and new charges made while away); charges made while away are made again on the new card, debts wait
//   for Pay what you owe (§148: never charged on a card save) (newCardChecks).

export const OWED_KIND = "owed";
/** The one payment is being charged ("paying"), its press check is open ("needs_action"), or its check waits for the developer ("needs_confirmation"). */
export const OWED_ACTIVE = ["paying", "needs_action", "needs_confirmation"];
/** The one payment went through: each covered debt is "charged" (or "not_set_up") itself, so this row is never counted as paid again. */
export const OWED_PAID = "bundled";
/** (Owner, Nov 3, §147) Confirm all's one payment: a one payment (kind "owed") made by the Confirm all press, covering charges that waited for the bank. */
export const ALL_NOTE = "press:all";
export const isAll = (p: { kind: string; note: string }) => p.kind === OWED_KIND && p.note === ALL_NOTE;

/**
 * (Rule 3) The debts locked by a bank check: debt id -> the check to cancel ("Cancel this check"): the one payment covering it, or (a check made before §117) the
 * debt itself.
 */
export async function owedLocks(devId: string) {
  const out = new Map<string, string>();
  // (Owner, Nov 3, §147) Confirm all's one payment covers charges waiting for the bank, never debts: it locks nothing here.
  const active = await db.payment.findMany({ where: { developerId: devId, kind: OWED_KIND, status: { in: OWED_ACTIVE }, note: { not: ALL_NOTE } }, select: { id: true } });
  if (active.length) for (const d of await db.payment.findMany({ where: { coveredById: { in: active.map((a) => a.id) } }, select: { id: true, coveredById: true } })) out.set(d.id, d.coveredById!);
  for (const d of await db.payment.findMany({ where: { developerId: devId, kind: { not: OWED_KIND }, actionPi: { not: null }, status: { in: ["failed", "owed", "paying"] } }, select: { id: true } })) out.set(d.id, d.id);
  return out;
}

/**
 * (Rule 4) Stop tracking a bank check only once Stripe cancelled it. "succeeded": it had already gone through (record it as paid; never charge the item again).
 * Throws when Stripe's answer is unclear: the check stays tracked and is tried again later.
 */
export async function dropCheck(pi: string | null | undefined): Promise<"cancelled" | "succeeded" | "missing"> {
  if (!pi || !stripeOn()) return "cancelled";
  const stripe = getStripe();
  try {
    const r = await stripe.paymentIntents.cancel(pi);
    return r?.status === "succeeded" ? "succeeded" : "cancelled";
  } catch (e) {
    // (§130) A check Stripe doesn't know (made in test mode): nothing was charged on it, so it's as good as cancelled (never paid). "missing" lets a clock tell
    // it from a check that ran out (never a decline).
    if (isMissing(e)) return "missing";
    const now = await Promise.resolve()
      .then(() => stripe.paymentIntents.retrieve(pi))
      .catch((x) => (isMissing(x) ? { status: "canceled" } : null));
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
async function claimOwed(devId: string, rows: { id: string; amountCents: number; chargeback: string }[], mode: "press" | "away", what: "owed" | "charges" = "owed", opts: { reviewFirst?: string } = {}) {
  const debts = rows.filter((r) => r.chargeback !== "open").map((r) => r.id);
  // (§122) Charges made while away, made TOGETHER as one payment (a new card, the lift): each must still wait ("deferred"), unpaid and uncovered, and the account
  // must not be on a hold or suspended (under the same row lock as deferIfHeld, so a hold starting now keeps them waiting).
  if (what === "charges") {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
        const dev = await tx.user.findUniqueOrThrow({ where: { id: devId }, select: { holdStartedAt: true, devSuspendedAt: true, deletedAt: true } });
        if (!dev.deletedAt && (dev.holdStartedAt || dev.devSuspendedAt)) throw ROLLBACK; // (Owner, Nov 3) a deleted developer's charges are made anyway
        const total = rows.reduce((a, p) => a + p.amountCents, 0);
        const one = await tx.payment.create({ data: { kind: OWED_KIND, developerId: devId, testerId: devId, amountCents: total, feeCents: total, testerCents: 0, transferStatus: "none", status: "paying", note: `${mode}:charges`, warnedAt: new Date() } });
        // (Owner, Nov 3) With the reversed payments' repayments that waited for the lift (kind "chargeback"): one payment for all of it.
        const n = (await tx.payment.updateMany({ where: { id: { in: debts }, developerId: devId, coveredById: null, actionPi: null, settledAt: null, status: "deferred", OR: [{ kind: { notIn: ["chargeback", OWED_KIND] } }, { kind: "chargeback", repaysId: { not: null } }] }, data: { coveredById: one.id } })).count;
        if (n !== debts.length) throw ROLLBACK;
        return one;
      });
    } catch (e) {
      if (e === ROLLBACK) return null;
      throw e;
    }
  }
  const reversed = rows.filter((r) => r.chargeback === "open").map((r) => r.id);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
      // (Owner, Nov 3) From the 2nd chargeback: allowed to pay only after the team's review, checked here under the lock (a new chargeback un-approves it).
      if (opts.reviewFirst) {
        const u = await tx.user.findUniqueOrThrow({ where: { id: devId }, select: { chargebackApprovedAt: true, holdReason: true, holdStartedAt: true } });
        if (u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackApprovedAt) {
          const n = await tx.payment.count({ where: { developerId: devId, chargeback: { not: "" } } });
          throw new HttpError(409, "review_first", (await import("@/lib/rules")).reviewFirstLine(n));
        }
      }
      // A press claim left by the code before §117 ("paying" with no check open) is owed again.
      const stale = { developerId: devId, kind: { notIn: ["chargeback", OWED_KIND] }, status: "paying", actionPi: null, settledAt: null };
      await tx.payment.updateMany({ where: { ...stale, owedUntil: { not: null } }, data: { status: "failed", warnedAt: null } });
      await tx.payment.updateMany({ where: { ...stale, owedUntil: null }, data: { status: "owed", warnedAt: null } });
      const total = rows.reduce((a, p) => a + p.amountCents, 0);
      const one = await tx.payment.create({ data: { kind: OWED_KIND, developerId: devId, testerId: devId, amountCents: total, feeCents: total, testerCents: 0, transferStatus: "none", status: "paying", note: mode, warnedAt: new Date() } });
      // (Owner, Nov 2, §125) During a hold the charges waiting for the lift ("deferred") are paid with what is owed, in this same one payment.
      const n = debts.length
        ? (await tx.payment.updateMany({ where: { id: { in: debts }, developerId: devId, coveredById: null, actionPi: null, settledAt: null, OR: [{ status: "failed", owedUntil: { not: null } }, { status: "owed" }, { status: "deferred", kind: { notIn: ["chargeback", OWED_KIND] } }] }, data: { coveredById: one.id } })).count
        : 0;
      const m = reversed.length ? (await tx.payment.updateMany({ where: { id: { in: reversed }, developerId: devId, coveredById: null, chargeback: "open" }, data: { coveredById: one.id } })).count : 0;
      if (n !== debts.length || m !== reversed.length) throw ROLLBACK;
      // (§133) A reversed payment is charged for what the bank reversed + the fee: when that changed since the total was read (the bank changed the disputed
      // amount), nothing is claimed (the press stops once on the new total).
      if (reversed.length) {
        const now = await tx.payment.findMany({ where: { id: { in: reversed } }, select: { id: true, amountCents: true, reversedCents: true } });
        if (now.some((x) => rows.find((r) => r.id === x.id)!.amountCents !== reversedOf(x) + CHARGEBACK_FEE_CENTS)) throw ROLLBACK;
      }
      return one;
    });
  } catch (e) {
    if (e === ROLLBACK) return null;
    throw e;
  }
}

/** The one payment was cancelled, declined or ran out of time: what it covered is owed (and payable) again. */
export async function releaseOwed(id: string) {
  // (Owner, Nov 3, §147) Confirm all's one payment: each charge it covered goes back to its own "Confirm with your bank" with its original deadline.
  const row = await db.payment.findUnique({ where: { id }, select: { kind: true, note: true } });
  if (row && isAll(row)) return (await import("./confirmAll")).releaseAll(id, "back");
  const ended = await db.payment.updateMany({ where: { id, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, data: { status: "cancelled", actionPi: null, actionBy: null } });
  if (ended.count !== 1) return null;
  // (§122) Charges made while away that it covered wait again ("deferred"); the caller decides when they count as declined.
  const charges = await db.payment.findMany({ where: { coveredById: id, status: "deferred", settledAt: null } });
  await db.payment.updateMany({ where: { coveredById: id, OR: [{ settledAt: null }, { chargeback: "open" }] }, data: { coveredById: null } });
  return { charges };
}

/** (§122) Is this one payment for charges made while away (not for debts)? */
export const forCharges = (one: { note: string }) => one.note.endsWith(":charges");

/**
 * (Owner, Nov 2, §122) Charges made while away whose one payment was declined (or its bank check ran out): each covered charge becomes a debt (a payment hold, or
 * added to it), named like a decline after a lift.
 */
export async function chargesDeclined(devId: string, charges: Payment[]) {
  const holds = await import("./holds");
  // (Owner, Nov 3) A reversed payment's repayment in the one payment: the reversal is owed again (its chargeback reopens), a chargeback hold.
  for (const p of charges.filter((x) => x.kind === "chargeback")) {
    await db.payment.deleteMany({ where: { id: p.id, settledAt: null } });
    if (p.repaysId) await db.payment.update({ where: { id: p.repaysId }, data: { chargeback: "open" } });
    await holds.startHold(devId, "chargeback");
  }
  for (const p of charges.filter((x) => x.kind !== "chargeback")) await holds.declinedPayment(devId, p.id, p.amountCents, await holds.declinedWhat(p));
}

/**
 * (Owner, Nov 2, §122) Charges made while away, retried TOGETHER (a new card saved, the hold lifted): ONE combined payment for the total, like Pay what you owe's.
 * Goes through: each charge is paid by it (each tester's share sent from that one payment), one receipt names them; the bank asks: ONE "Confirm with your bank" item
 * listing each charge (3 days); declined: each becomes a debt; any other problem: they keep waiting. Null when nothing could be claimed (a hold or a suspension
 * started, or they changed).
 */
export async function chargeWaitingTotal(devId: string, rows: Payment[]) {
  if (!rows.length) return null;
  const u = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const one = await claimOwed(devId, rows.map((r) => ({ ...r, chargeback: "" })), "away", "charges");
  if (!one) return null;
  return chargeClaimed(u, one, "away");
}

/**
 * The one payment went through (at once, or its bank check was confirmed): every debt it covers is paid by it, once. Returns what was paid ({ again } when it was
 * already settled). The caller sends the developer's one line (the press's receipt, the retry's line, Confirm's receipt).
 */
export async function settleOwed(id: string, pi: string | null) {
  const one = await db.payment.findUniqueOrThrow({ where: { id } });
  const claimed = await db.payment.updateMany({ where: { id, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, data: { status: OWED_PAID, settledAt: new Date(), stripePaymentIntentId: pi, actionPi: null, actionBy: null } });
  if (claimed.count !== 1) return { again: true, cents: 0, names: [] as string[], parts: [] as { name: string; cents: number }[], charges: forCharges(one) };
  const holds = await import("./holds");
  const { settleOwedRow } = await import("./chargeback");
  const dev = await db.user.findUniqueOrThrow({ where: { id: one.developerId } });
  // (Owner, Nov 3, §147) Confirm all's one payment covers charges waiting for the bank ("needs_confirmation").
  const waiting = { coveredById: id, settledAt: null, status: isAll(one) ? "needs_confirmation" : "deferred" };
  const rows = [...(await holds.owed(one.developerId)).filter((p) => p.coveredById === id), ...(await db.payment.findMany({ where: waiting, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((p) => ({ ...p, reversedCents: 0, paidCents: p.amountCents }))];
  const names: string[] = [];
  const parts: { name: string; cents: number }[] = [];
  let cents = 0;
  for (const p of rows) {
    await settleOwedRow(dev, p, pi && stripeOn() ? pi : null, id);
    // (§122) Charges made while away keep the names their own receipts had ("… (charged by them after 7 days)").
    // (Owner, Nov 3) Full names: these go into the receipt email, which has no hover.
    names.push(forCharges(one) && p.kind !== "chargeback" ? await holds.deferredWhat(p, true) : await holds.owedItemName(p, true));
    parts.push({ name: names[names.length - 1], cents: p.amountCents });
    cents += p.amountCents;
  }
  return { again: false, cents, names, parts, charges: forCharges(one) };
}

/**
 * (Rule 6) Charge what is owed as ONE payment on the saved card. "press": the developer's own Pay what you owe (on-session: the bank's check opens inline);
 * "away": made while the developer isn't there (charges made while away; before §145/§148 also a daily or new-card retry of debts): the bank's check waits 3 days
 * as one "Confirm with your bank" item.
 */
export async function chargeOwedTotal(u: Parameters<typeof chargePlatform>[0], rows: { id: string; amountCents: number; chargeback: string }[], mode: "press" | "away", opts: { reviewFirst?: string } = {}) {
  if (!rows.length) return { result: "skipped" as const };
  const one = await claimOwed(u.id, rows, mode, "owed", opts);
  if (!one) return { result: "skipped" as const };
  return chargeClaimed(u, one, mode);
}

export async function chargeClaimed(u: Parameters<typeof chargePlatform>[0], one: Payment, mode: "press" | "away") {
  let r: Awaited<ReturnType<typeof chargePlatform>>;
  try {
    // (Batch 32 §15) No saved card: handled as a declined card, never sent to Stripe with an empty card.
    if (stripeOn() && (!u.stripeCustomerId || !u.stripePaymentMethodId)) throw new HttpError(402, "card_failed", "No card is saved on this account.");
    // One key per payment: charged again with it (resumeStaleOwed), Stripe answers with what happened the first time. (Owner, Nov 3) Its description lists what it
    // covers as on the page, names in full: "Playtest: What you owe (Ana Silva's written answers on “Harbor Run” $8.00, …)"; fixed at the first try, so the same
    // key always carries the same one.
    const description = await describedOnce(one.id, async () => stripeDescription({ owed: await db.payment.findMany({ where: { coveredById: one.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }), charges: forCharges(one), all: isAll(one) }));
    r = await chargePlatform(u, one.amountCents, serverKey("owedall", one.id), description, mode);
  } catch (e) {
    const why = (await import("./holds")).owedWhy(e);
    // (§130) Not a try on the card: its customer or card is unknown to Stripe (cleared: "Add a card"), or payments are switched off. No decline, no retry counted.
    const notTried = e instanceof HttpError && (e.code === "no_card" || e.code === "payments_off");
    // Stripe's answer was lost (it may have been charged): what it covers stays locked until the same charge is asked again (resumeStaleOwed), never charged twice.
    if (e instanceof HttpError && (e.code === "payment_unknown" || e.code === "idempotency")) return { result: "failed" as const, why, notTried };
    const freed = await releaseOwed(one.id);
    // (§122) Waiting charges: only a real decline makes each a debt; any other problem leaves them waiting.
    // (§125) Pay what you owe's one payment (debts and charges waiting for the lift): its waiting charges just keep waiting.
    if (forCharges(one) && freed?.charges.length && e instanceof HttpError && e.code === "card_failed") await chargesDeclined(one.developerId, freed.charges);
    return { result: "failed" as const, why, notTried };
  }
  const confirm = await import("./confirm");
  if (r.status === "requires_action") {
    if (mode === "press") {
      const action = await confirm.pressAction(one.id, r as NeedsAction);
      // (§147) Confirm all's check ends by the earliest date of what it covers, when that comes before its 15 minutes.
      if (isAll(one)) await (await import("./confirmAll")).clampToEarliest(one.id);
      return { result: "action" as const, action };
    }
    await confirm.awayAction(one.id, r as NeedsAction);
    return { result: "waiting" as const };
  }
  const s = await settleOwed(one.id, r.stripePaymentIntentId);
  return { result: "paid" as const, cents: s.cents, names: s.names, parts: s.parts, status: r.status };
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
    // (§147) Confirm all's one payment is a press too: asked again exactly as it was first made.
    const r = await chargeClaimed(u, one, one.note === "press" || isAll(one) ? "press" : "away");
    if (r.result !== "paid") continue;
    if (isAll(one)) await (await import("./confirmAll")).allReceipt(u.email, r.parts, r.status);
    else if (r.cents > 0) await receipt(u.email, receiptWhat(r.names, forCharges(one)), r.cents, r.status !== "not_set_up" ? "charged" : "not_set_up", "/app/payments");
    await holds.liftHoldIfClear(devId);
  }
}

/** One receipt's words: "what you owed: ..." for debts; the charges' own names for charges made while away. */
export const receiptWhat = (names: string[], charges: boolean) => (charges ? namesList(names) : owedReceiptWhat(names));

/** Each one payment's covered debts, named with their amounts ("Ana Silva's work $8.00"), for the confirm items. */
export async function coveredNames(ids: string[], full = false) {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const holds = await import("./holds");
  for (const p of await db.payment.findMany({ where: { coveredById: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
    const cents = p.chargeback === "open" ? reversedOf(p) + CHARGEBACK_FEE_CENTS : p.amountCents; // (§133) what the bank reversed + the fee
    out.set(p.coveredById!, [...(out.get(p.coveredById!) ?? []), `${await holds.owedItemName(p, full)} ${money(cents)}`]);
  }
  return out;
}

/** (§157) The ActionLog "test" recording a check the developer cancelled (the payment's id in `tab`): never a real test id. */
const CHECK_CANCELS = "check-cancelled";
const cancelledBefore = async (devId: string, id: string) => !!(await db.actionLog.findFirst({ where: { userId: devId, testId: CHECK_CANCELS, tab: id }, select: { id: true } }));
/** Cancel this check's claim (as claimCheck), with its record when it cancels. */
async function claimCancel(p: { id: string; developerId: string; actionPi: string | null }, cancels: boolean) {
  return db.$transaction(async (tx) => {
    const n = (await tx.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null, actionBy: null } })).count;
    if (n === 1 && cancels) await tx.actionLog.create({ data: { userId: p.developerId, testId: CHECK_CANCELS, tab: p.id, text: p.actionPi ?? "" } });
    return n === 1;
  });
}

/**
 * (Rule 3) "Cancel this check" next to a debt waiting for the bank: the check is cancelled at Stripe and what it covered is payable at once. When the bank had
 * already confirmed it, it is recorded as paid instead (nothing charged again).
 */
export async function cancelOwedCheck(devId: string, id: string) {
  // (Owner, Nov 3, §160) A chargeback hold's reservation (Pay what you owe during a chargeback hold): its Cancel this check, from any tab.
  const res = await db.reservation.findUnique({ where: { id }, select: { developerId: true } });
  if (res && res.developerId === devId) return (await import("./bankHeartbeat")).endReservationCheck(devId, id);
  const p = await db.payment.findUnique({ where: { id } });
  if (!p || p.developerId !== devId) throw new HttpError(404, "not_found", NO_CHECK_WAITING);
  if (!p.actionPi) {
    if (p.status === OWED_PAID) throw new HttpError(409, "confirmed", CHECK_ALREADY_PAID);
    if (await cancelledBefore(devId, p.id)) throw new HttpError(409, "cancelled", CHECK_ALREADY_CANCELLED); // (§157)
    if (p.kind === OWED_KIND && p.status === "paying") throw new HttpError(409, "busy", "This payment is going through right now. Try again shortly.");
    throw new HttpError(409, "no_check", NO_CHECK_WAITING);
  }
  const end = await dropCheck(p.actionPi);
  // (§157) The claim and, for a cancel, its record commit together: of two Cancels at once (two tabs) the other reads "You already cancelled this check." (it read
  // "Your bank already confirmed this payment" before).
  if (!(await claimCancel(p, end !== "succeeded"))) {
    if (await cancelledBefore(devId, p.id)) throw new HttpError(409, "cancelled", CHECK_ALREADY_CANCELLED);
    throw new HttpError(409, "confirmed", CHECK_ALREADY_PAID);
  }
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
 * debts are payable again and wait for the developer's Pay what you owe (§148: saving a card never charges what's owed). A check that had already gone through is recorded as paid. (A renewal's check is its invoice's:
 * its Confirm uses the current card.)
 */
export async function newCardChecks(devId: string) {
  // (Owner, Nov 3, batch 35 §148) The developer's OWN press checks made on the old card (Pay, Pay more, a call's Pay: the 15-minute bank check) are cancelled at
  // Stripe too and never made again: the piece is free and the developer presses again with the new card. One that had already gone through is recorded as paid
  // (confirm.release: cancel first, never charged twice).
  const own = await db.payment.findMany({ where: { developerId: devId, status: "needs_action", actionPi: { not: null }, kind: { in: ["review", "call", "extra"] } }, select: { id: true } });
  for (const p of own) await (await import("./confirm")).release(p.id).catch((e) => console.error("[card] cancel own check:", (e as Error).message));
  // (Owner, Nov 2, payments proof) Pay what you owe's own press check (15 minutes, "needs_action") too: a new card (Payments, or the chargeback steps' Verify a
  // card) cancels it at Stripe first, so only the new card is in play.
  const waiting = await db.payment.findMany({ where: { developerId: devId, actionPi: { not: null }, kind: { not: "subscription" }, OR: [{ status: { in: ["needs_confirmation", "failed", "owed"] } }, { kind: OWED_KIND, status: "needs_action" }] }, orderBy: { createdAt: "asc" } });
  for (const p of waiting) {
    try {
      const end = await dropCheck(p.actionPi);
      if (!(await claimCheck(p))) continue; // confirmed meanwhile
      const confirm = await import("./confirm");
      if (end === "succeeded") await confirm.finishConfirmed(p.id);
      // (§147) Confirm all's one payment: the charges it covered wait again, and are made together on the new card (below).
      else if (isAll(p)) await (await import("./confirmAll")).releaseAll(p.id, "defer");
      else if (p.kind === OWED_KIND) await releaseOwed(p.id); // its debts wait for Pay what you owe (§148); its charges wait again (below)
      // (§122) A charge made while away waits again ("deferred"); all of them are then made TOGETHER as one payment (below, or after the lift during a hold, §113).
      else if (p.status === "needs_confirmation") await db.payment.updateMany({ where: { id: p.id, status: "needs_confirmation" }, data: { status: "deferred" } });
      // else: a debt with a check of its own (before §117): it stays owed and waits for Pay what you owe (§148).
    } catch (e) {
      console.error("[card] new card checks:", (e as Error).message);
    }
  }
  // (Owner, Nov 2, payments proof) A chargeback hold's reservation whose bank check is still open (Pay what you owe pressed, the bank's page not finished) was made
  // on the old card: cancelled at Stripe too, so only the new card is in play (Pay what you owe reserves again on it). A reservation already authorized stays.
  for (const r of await db.reservation.findMany({ where: { developerId: devId, status: { in: ["pending", "needs_action"] } } })) {
    if ((await db.reservation.updateMany({ where: { id: r.id, status: r.status }, data: { status: "cancelled", endedAt: new Date() } })).count !== 1) continue;
    if (r.stripePaymentIntentId && stripeOn()) await getStripe().paymentIntents.cancel(r.stripePaymentIntentId).catch((e) => console.error("[card] cancel reservation check:", (e as Error).message));
  }
  // No hold or suspension: every charge waiting now is made at once on the new card, as ONE payment (chargeDeferred).
  const u = await db.user.findUniqueOrThrow({ where: { id: devId }, select: { holdStartedAt: true, devSuspendedAt: true } });
  if (!u.holdStartedAt && !u.devSuspendedAt) await (await import("./holds")).chargeDeferred(devId);
}

/**
 * (Owner, Nov 2, batch 35 §122) A hold started: every charge made while away that still waits for the bank (a "Confirm with your bank" item made before the hold, or
 * the one combined payment for charges) is paused. Its check is cancelled at Stripe first (one that had already gone through is recorded as paid) and it waits for the
 * lift ("deferred", §113), when it is made with the other waiting charges as one payment. Testers keep reading "Payment delayed".
 */
export async function pauseAwayChecks(devId: string) {
  const waiting = await db.payment.findMany({ where: { developerId: devId, status: "needs_confirmation", actionPi: { not: null }, kind: { not: "subscription" } }, orderBy: { createdAt: "asc" } });
  for (const p of waiting) {
    if (p.kind === OWED_KIND && !forCharges(p)) continue; // Pay what you owe's own one payment: its debts are what the hold is about
    try {
      const end = await dropCheck(p.actionPi);
      if (!(await claimCheck(p))) continue; // confirmed meanwhile
      if (end === "succeeded") await (await import("./confirm")).finishConfirmed(p.id);
      else if (p.kind === OWED_KIND) await releaseOwed(p.id); // its charges wait again
      else await db.payment.updateMany({ where: { id: p.id, status: "needs_confirmation" }, data: { status: "deferred" } });
    } catch (e) {
      console.error("[hold] pause bank check:", (e as Error).message);
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


/** (Owner, Nov 2, §125) Pay what you owe's one payment whose bank check ran out (3 days for a retry's): marked so its box can say so, never as a decline. */
export const RAN_OUT = "check_ran_out";
export const checkRanOutLine = (on: string) => `Your bank check ran out on ${on}: nothing was charged. Pay again or change your card.`;
/**
 * The box's plain line when the last one payment for what's owed ran out unconfirmed: "Your bank check ran out on Nov 5: nothing was charged. Pay again or change your
 * card." Only while nothing newer was tried and something is still owed during the hold that it was made in.
 */
export async function ranOutLine(devId: string, tz: string | null = null) {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, timeZone: true } });
  if (!u?.holdStartedAt) return null;
  const last = await db.payment.findFirst({ where: { developerId: devId, kind: OWED_KIND, createdAt: { gte: u.holdStartedAt } }, orderBy: { createdAt: "desc" } });
  if (!last || last.status !== "cancelled" || last.failure !== RAN_OUT || forCharges(last)) return null;
  const on = (last.warnedAt ?? last.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", ...zoneOpt(tz ?? u.timeZone) });
  return checkRanOutLine(on);
}
