import { randomUUID } from "node:crypto";
import { Prisma, type Payment } from "@prisma/client";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { callAtFor, displayName, fmtDate, fmtDateTime, money, pronouns, toCents } from "@/lib/server/dateFormat";
import {
  owedReceiptWhat, pressAgainLine, bankChangedLine, reviewFirstLine, CHARGEBACKS_REVIEW_FROM, OWED_ALL_WAITING, OWED_BANK_WAITING, reservedAddedLine, AUTO_CHARGED_CALL, AUTO_NOTHING_CALL, AUTO_CHARGE_NO_CHOICE, MIN_CHARGE_CENTS, CHARGE_TICK_CENTS, chargeTickLine, chargeClosedLine, CLOSE_OUT_REMINDER_DAYS, testerPayable, HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL, autoPayFor, chargeAmount, paidMeanwhileLine, CHARGED_BY_TESTER, byTesterChoice, chargedDelayedLine, countdownDue, ownDeadlineMarkDue, reviewMarkDue, reviewMarksFor, INVITE_REMIND_DAYS, failedLine, joinClosingLine, ownDeadlineLine, LET_GO_BY_TESTER, REVIEW_DAYS, chargeIsOpen, chargeOpensAt, PAUSED_RIGHT_NOW, PAY_WAITS, pauseShiftMs, STILL_SUSPENDED_LINE, PAYABLE_TESTER, PIECE_LOCKED, ownChargeWaitingLine, chargedByTester, chargebackRefundLine, chargebackWonLine, CHARGEBACK_FEE_CENTS, chargebackOwedLine, chargebackReversedLine, bankLoweredLine, bankRaisedLine, raiseNote, raiseOf, raiseName, RAISE_NOTE,
} from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify, renderFor, sendSummaries } from "./notify";
import { appUrl } from "./auth";
import { accountEvent, labelled, reportedOver3 } from "./reports";
import { sendEmail } from "./email";
import { PAYMENTS_PROBLEM, charge, getStripe, stripeOn, type NeedsAction } from "./stripe";
import { serverKey } from "./pressKeys";
import { receipt } from "./payments";
import { testerTermsGate } from "./terms";
import { recordEvent } from "./tests";
import { PAUSE_CLOSE_DAYS } from "@/lib/pause";
import { callMinutesOf } from "@/lib/callMeasure";
import { callReference, disputeDecisionName, disputedCentsOf, movedDue, nearestDayEnd, partOf, pausedUntil, pieceName, reversedOf, reversedPart, reversedWords, paymentWords, OWED_OVER_TICK, PAY_TICK_CENTS } from "@/lib/rules";
import { callsLeftCents } from "./callMoney";
import { closedOut, pieceCloseOut } from "./closeOut";
import { withTimersLock } from "./timers";
import { pieceWords } from "@/lib/bankTop";
import { describedOnce, stripeDescription } from "./paymentRows";
import { partOnTest } from "./partWords";
import { LATE_REMINDER_TAIL, NO_CHARGE_LATE } from "@/lib/moneyLines";
import { teamPausedNow } from "@/lib/restricted";

// Payment hold (owner rule, Oct 27): starts AT ONCE when any payment is declined (part Pay, the tester's Charge, a call charge, extra pay), or when a chargeback opens
// (a chargeback during a payment hold turns it into a chargeback hold). There is no owed window and no daily retry. While on hold all the developer's
// tests are paused, exactly like an admin suspension (see lib/restricted.ts); paying everything owed (and the admin resolving chargebacks) lifts it, and
// every working tester's deadline, Open until and the 7-day review clock (batch 12) move on by the pause.

/** A test that is not paused (no payment hold, no suspension, no team pause): reminders tied to a test wait while it is paused and restart when it resumes. */
// (Batch 12 section 1) A deleted developer's work under review never opens Charge, and they get no reminders.
const PAUSE_FREE = { adminPausedAt: null, developer: { holdStartedAt: null, devSuspendedAt: null, deletedAt: null } } as const;
const admins = () => (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);

export async function onHold(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true } });
  return !!u?.holdStartedAt;
}

/** Refusal for developer actions that wait during a hold. */
export async function devHoldRefusal(devId: string, what: "pay" | "post" | "round" | "invite") {
  if (!(await onHold(devId))) return;
  if (what === "pay") throw new HttpError(409, "on_hold", PAY_WAITS);
  if (what === "post") throw new HttpError(409, "on_hold", `${PAY_WAITS} New tests can't be posted while payments are on hold.`);
  throw new HttpError(409, "on_hold", `${PAY_WAITS} Your tests are paused until then.`);
}

/** Refusal for tester actions on a paused test (joining, booking calls). */
export async function testerHoldRefusal(devId: string) {
  if (await onHold(devId)) throw new HttpError(409, "paused", PAUSED_RIGHT_NOW);
}

/**
 * Money the developer still owes: failed charges not yet settled, (Owner, Oct 28 afternoon) a tester's Charge or a dispute decision made during a payment or chargeback hold
 * (status "owed": never tried on the card; the tester is paid when the developer pays it), and (Owner, Oct 27) every open chargeback adds its amount: they are paid with
 * "Pay what you owe" (charged again on the card) before the team's Approve.
 */
export async function owed(devId: string) {
  // (Batch 10) "paying": claimed by a "Pay what you owe" press that is charging it right now (still owed until it goes through, so a hold can't lift under it).
  // (Batch 35 §117) Pay what you owe's one payment (kind "owed") is never itself owed: the debts it covers are.
  const failed = await db.payment.findMany({ where: { developerId: devId, kind: { not: "owed" }, OR: [{ status: "failed", owedUntil: { not: null }, settledAt: null }, { status: "owed" }, { status: PAYING }] }, orderBy: { createdAt: "asc" } });
  const reversed = await db.payment.findMany({ where: { developerId: devId, chargeback: "open" }, orderBy: { createdAt: "asc" } });
  const repaid = reversed.length ? new Set((await db.payment.findMany({ where: { repaysId: { in: reversed.map((p) => p.id) }, status: { in: ["charged", "not_set_up"] } }, select: { repaysId: true } })).map((p) => p.repaysId)) : new Set<string | null>();
  // (Owner, Oct 29, batch 11) A chargeback is owed with its fee: the reversed amount + CHARGEBACK_FEE_CENTS (`reversedCents` keeps the reversed amount).
  // (Owner, Nov 3, §133) What the bank reversed may be only PART of the payment (the dispute's amount): that part + ONE fee is owed; the rest of the payment stays paid
  // (testers' shares untouched). `paidCents`: the whole payment, for the line.
  const charged = reversed.filter((p) => !repaid.has(p.id)).map((p) => ({ ...p, reversedCents: reversedOf(p), paidCents: p.amountCents, amountCents: reversedOf(p) + CHARGEBACK_FEE_CENTS }));
  return [...failed.map((p) => ({ ...p, reversedCents: 0, paidCents: p.amountCents })), ...charged].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
}

/**
 * (Owner, Nov 2, batch 35 §125) What Pay what you owe charges during a hold: what is owed (owed) AND every charge waiting for the lift ("Charged once your tests
 * resume": testers' Charges, team decisions, automatic call charges made during the hold), together as ONE payment (Pay what you owe's press), or
 * in the chargeback steps' one reservation. Waiting charges ride along only while something is owed (on its own, a waiting charge never makes a payment during a hold);
 * they never block a lift (liftHoldIfClear still counts only owed). A reversed payment's repay row waiting after a reservation (kind "chargeback") keeps its own handling.
 */
export async function payable(devId: string) {
  const debts = await owed(devId);
  if (!debts.length) return debts;
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true } });
  if (!u?.holdStartedAt) return debts;
  const waits = await db.payment.findMany({ where: { developerId: devId, status: "deferred", settledAt: null, kind: { notIn: ["chargeback", "owed"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return [...debts, ...waits.map((p) => ({ ...p, reversedCents: 0, paidCents: p.amountCents }))];
}
/** (§125) Waiting charges ride along only with a debt paid at the same time: a list of waiting charges alone pays nothing. */
export const withDebt = <T extends { status: string }>(list: T[]) => (list.some((p) => p.status !== "deferred") ? list : []);

/**
 * (Owner, Oct 27) A declined payment starts a payment hold AT ONCE. The payment is marked as owed (owedUntil is just the "owed" marker now: no cut-off);
 * a decline during an existing hold adds to "Pay what you owe". Returns true when this decline started the hold.
 */
export async function declinedPayment(devId: string, paymentId: string, cents: number, what: string) {
  await db.payment.update({ where: { id: paymentId }, data: { status: "failed", owedUntil: new Date() } });
  // (Owner, Oct 29, batch 12 section 1) A deleted developer has no account left to hold: the payment stays "delayed" for the tester and is listed for the admins
  // (the platform doesn't cover it).
  if ((await db.user.findUnique({ where: { id: devId }, select: { deletedAt: true } }))?.deletedAt) return false;
  const started = await startHold(devId, "unpaid");
  if (!started) {
    const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
    await bell(devId, `Another payment was declined: ${money(cents)} for ${what} was added to what you owe`, dev.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
  }
  return started;
}

export async function startHold(devId: string, reason: string) {
  const now = new Date();
  // (Owner, Nov 4, §178) A chargeback hold starts with no card check and no team approval, in the same write that starts it (before, chargebackOpened cleared them
  // seconds later, after its emails, and so wiped an approval the team had made in between).
  const fresh = reason === "chargeback" ? { chargebackCardVerifiedAt: null, chargebackApprovedAt: null } : {};
  const claimed = await db.user.updateMany({ where: { id: devId, holdStartedAt: null }, data: { holdStartedAt: now, holdReason: reason, holdAlertedAt: null, holdCount: { increment: 1 }, holdApprovedAt: null, holdApprovedById: null, holdRetries: 0, holdRetryAt: null, ...fresh } });
  if (claimed.count !== 1) return false;
  await accountEvent(devId, "hold", null, reason);
  // (Owner, Nov 2, batch 35 §122) Charges made while away still waiting for the bank are paused: their checks are cancelled at Stripe (one that already went through is
  // recorded as paid) and they wait for the lift with the other new charges (§113), made then as the one combined payment.
  await (await import("./owedOnce")).pauseAwayChecks(devId).catch((e) => console.error("[hold] pause bank checks:", (e as Error).message));
  // (Owner, Nov 2) A Pay the developer pressed whose bank page is still open is cancelled too (at Stripe first; one the bank already approved is recorded as paid,
  // never charged again): nothing is charged on a card during a hold, and the piece is unpaid again (the tester can still Charge it later).
  // (Owner, Nov 4, §171 B5; as §159 rule 9 does at a suspension) A Pay more whose bank page is open too: cancelled at Stripe first (one that already went through is
  // recorded as paid once); its window reads "This bank check was cancelled: your tests were paused (a payment hold started). Pressing Complete won't charge anything."
  const { release } = await import("./confirm");
  for (const p of await db.payment.findMany({ where: { developerId: devId, status: "needs_action", kind: { in: ["review", "call", "extra"] } }, select: { id: true } }))
    await release(p.id).catch((e) => console.error("[hold] cancel open Pay check:", (e as Error).message));
  // (Batch 9) One closing clock per paused test: it starts now unless the test was already paused.
  await markPaused({ developerId: devId }, now);
  // (Batch 8) Subscription billing pauses while the hold lasts.
  await (await import("./subscription")).pauseBilling(devId, now);
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const tests = await db.test.findMany({ where: { developerId: devId, status: { in: ["open", "closed", "draft"] } } });
  for (const t of tests) {
    // Pending call requests close (both told).
    for (const r of await (await import("./requests")).closeRequests({ contractIds: (await db.contract.findMany({ where: { testId: t.id }, select: { id: true } })).map((x) => x.id) }, "the test is paused")) {
      void r; // (Owner) a closed call request is not a bell line
    }
    await db.$transaction((tx) => recordEvent(tx, t.id, "paused", pausedUntil(reason === "chargeback"), false) /* (batch 35 §22) */);
  }
  // (Owner, Oct 27) Calls starting within 3 days are cancelled with no fault; later ones are cancelled 3 days before they start if the hold is still on (the daily job).
  await (await import("./restrictions")).cancelCallsNearPause(devId, now);
  await (await import("./pauseClosure")).bellPausedTests(devId);
  // (Owner, Oct 27) "Your tests are paused" and the chargeback hold email ignore Off (they ride in the one end-of-day email); the lines stack with that day's other hold / payment lines.
  if (reason === "chargeback") {
    await notify(dev.email, "Your tests are paused after a chargeback", ["Your bank reversed a payment, so your tests are paused: you can't change anything on them, and testers stay in them.", "To resume: verify a card with 3D Secure, pay what you owe, and wait for the team's approval. Open Payments to see which steps remain.", `A test that stays paused for ${PAUSE_CLOSE_DAYS} days is closed.`], "/app/payments#chargeback-steps", { side: "developer", always: true, payment: true, group: "payhold" });
    return true;
  }
  await notify(dev.email, "Your tests are paused", ["Your tests are paused until you pay what you owe: you can't change anything on them, and testers stay in them.", "Open Payments and press Pay what you owe: your tests resume at once.", `A test that stays paused for ${PAUSE_CLOSE_DAYS} days is closed.`], "/app/payments#owed", { side: "developer", always: true, payment: true, group: "payhold" });
  return true;
}

/**
 * A pause ended (a payment hold paid off, or a developer's suspension lifted): every working tester's deadline, Open until and the 7-day review clocks (batch 12) move on by its length
 * (PAUSE_DEFAULTS.shiftDeadlines; a pause that overlapped another one still on counts only up to when that one started, see pauseShiftMs), and each test that is no longer
 * paused says it is running again. `others`: the starts of the developer's OTHER pauses still on (a hold left after a reinstatement, a suspension left after a hold lift).
 * Returns the ids of the tests that run again.
 */
export async function resumeTests(tx: Prisma.TransactionClient, devId: string, start: Date, now: Date, others: (Date | null | undefined)[] = []) {
  const tests = await tx.test.findMany({ where: { developerId: devId } });
  const running: string[] = [];
  for (const t of tests) {
    const still = [...others, t.adminPausedAt];
    await shiftAfterPause(tx, t, start, now, still);
    if (still.some(Boolean)) continue;
    running.push(t.id);
    if (t.pausedSince) await tx.test.update({ where: { id: t.id }, data: { pausedSince: null } }); // (batch 9) no cause left: the clock ends
    if (t.status !== "stopped") await recordEvent(tx, t.id, "resumed", "Your tests are running again", false);
  }
  return running;
}

/** (Owner, Oct 28 night, batch 9) A pause started: the tests it pauses that weren't paused yet start their one 7-day clock now. */
export async function markPaused(where: { developerId?: string; id?: string }, now = new Date()) {
  // (Owner, Oct 28, batch 16 section 32) Open invites close when the test or its developer can't take testers (any pause, hold or suspension); nothing reopens
  // by itself: the developer can invite again after.
  const closing = await (await import("./invites")).openInviteIds({ test: { ...where, status: { in: ["open", "closed"] } } });
  await db.invite.updateMany({ where: { id: { in: closing }, status: "sent" }, data: { status: "cancelled" } });
  await (await import("./invites")).tellInvitesClosed(closing); // (batch 30 §6) the neutral line, never why
  await db.test.updateMany({ where: { ...where, status: { in: ["open", "closed"] }, pausedSince: null }, data: { pausedSince: now } });
}

/**
 * (Owner, Oct 28 afternoon, DEFAULT) One test's clocks after one of its pauses lifted: working testers' deadlines and Open until (and the review clocks of sent work) move later by
 * the pause's length (pauseShiftMs: only the part not covered by another pause still on). The same for a hold lift, a reinstatement and the team's unpause.
 */
export async function shiftAfterPause(tx: Prisma.TransactionClient, t: { id: string; status: string; openUntil: Date | null; workEndedAt?: Date | null }, start: Date, now: Date, others: (Date | null | undefined)[] = []) {
  const ms = pauseShiftMs(start, now, others);
  if (ms <= 0) return 0;
  const later = <T extends Date | null>(d: T, by = ms) => (d ? (new Date(d.getTime() + by) as T) : d);
  // (Owner, Nov 2) Open until stays the END of a day in the developer's zone (the nearest one to the moved time), so joining closing and Edit's lock (by calendar
  // day) always agree: a pause of 2 days and 1 minute moves "Nov 1, 11:59 PM" to "Nov 3, 11:59 PM", never "Nov 4, 12:01 AM".
  // (Owner, Nov 2) Like deadlines: an Open until that had already passed when the pause started stays (joining never reopens).
  const tz = (await tx.test.findUnique({ where: { id: t.id }, select: { developer: { select: { timeZone: true } } } }))?.developer.timeZone;
  if (t.openUntil && t.openUntil > start && t.status !== "stopped" && !t.workEndedAt) {
    const openUntil = nearestDayEnd(later(t.openUntil), tz);
    await tx.test.update({ where: { id: t.id }, data: { openUntil, notified3d: false, notified1d: false } });
  }
  // (Owner, Nov 2) Only deadlines that hadn't passed when the pause started (like moving Open until later): one already passed keeps it.
  // (Owner, Nov 3, batch 35 §154) The moved deadline is rounded UP to the end of its day (11:59 PM in the zone it was counted in), never an odd time like 7:22 AM.
  for (const c of await tx.contract.findMany({ where: { testId: t.id, status: "working", dueAt: { gt: start } } })) await tx.contract.update({ where: { id: c.id }, data: { dueAt: movedDue(c.dueAt, ms, tz) } });
  for (const x of await tx.submission.findMany({ where: { contract: { testId: t.id }, review: null, payBy: { not: null } } })) {
    const by = pauseShiftMs(x.updatedAt > start ? x.updatedAt : start, now, others); // only the part of the pause after it was sent
    if (by > 0) await tx.submission.update({ where: { id: x.id }, data: { payBy: later(x.payBy, by), choiceBy: later(x.choiceBy, by) } });
  }
  // (Batch 15 sections 15 and 40) A call's review clock moves the same way (only the part of the pause after its length was final).
  for (const x of await tx.call.findMany({ where: { contract: { testId: t.id }, review: null, payBy: { not: null }, status: "booked" } })) {
    const from = x.measuredAt && x.measuredAt > start ? x.measuredAt : start;
    const by = pauseShiftMs(from, now, others);
    if (by > 0) await tx.call.update({ where: { id: x.id }, data: { payBy: later(x.payBy, by), choiceBy: later(x.choiceBy, by) } });
  }
  return ms;
}

/**
 * Payments that waited for the account to be clear (a Pay pressed during a hold, or from Payments during a suspension; an admin decision that
 * raised pay) are charged now. The tester is told when each goes through.
 */
/** Queue under the developer row lock, so a simultaneous lift cannot miss a newly waiting charge. */
export async function deferIfHeld(data: Omit<Prisma.PaymentUncheckedCreateInput, "status">) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${data.developerId} FOR UPDATE`;
    const dev = await tx.user.findUniqueOrThrow({ where: { id: data.developerId }, select: { holdStartedAt: true, deletedAt: true } });
    // (Owner, Nov 3) A deleted developer's hold can never lift: a tester's Charge or the team's decision is charged to their saved card at once instead of waiting.
    if (!dev.holdStartedAt || dev.deletedAt) return null;
    return tx.payment.create({ data: { ...data, status: "deferred" } });
  });
}

/** One drain per developer; the durable AppState lock follows the timers lock's stale-run protection. */
export async function chargeDeferred(devId: string) {
  const key = `deferred-charges:${devId}`, value = `${Date.now()}:${randomUUID()}`;
  try {
    await db.appState.create({ data: { key, value } });
  } catch {
    const old = await db.appState.findUnique({ where: { key } });
    if (!old || Date.now() - Number(old.value.split(":")[0]) < 4 * 60000) return;
    if (!(await db.appState.updateMany({ where: { key, value: old.value }, data: { value } })).count) return;
  }
  try { await chargeDeferredLocked(devId); }
  finally { await db.appState.deleteMany({ where: { key, value } }); }
}

async function chargeDeferredLocked(devId: string) {
  const once = await import("./owedOnce");
  await once.resumeStaleOwed(devId);
  // (Owner, Nov 3) Reversed payments owed again after a reservation (kind "chargeback", each with its own $15 fee) are no longer charged one by one: they go into the
  // ONE payment below with every other waiting charge (one PaymentIntent, one bank check if the card asks, one receipt naming each); the money for them stays with the
  // platform, the testers' shares are sent from that same payment. Declined: each reversal is owed again (its chargeback reopens, a chargeback hold).
  // (Owner, Nov 2, batch 35 §122) Every other waiting charge (testers' Charges, team decisions, auto-charged calls) is made TOGETHER as ONE payment on the card in use
  // now: goes through -> each is paid, one receipt; the bank asks (a card like 3184) -> ONE "Confirm with your bank" item listing each, never a debt; a real decline ->
  // each becomes a debt (a new hold); any other problem -> they all keep waiting. A hold or a suspension starting first keeps them all waiting (the claim re-checks it).
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  // (Owner, Nov 3) A deleted developer's waiting charges go to their saved card even on a hold or a suspension (neither can ever clear).
  if (!dev.deletedAt && (dev.holdStartedAt || dev.devSuspendedAt)) return;
  // (§151) A deleted developer's repayments of reversed payments still wait (only an account with no hold or suspension pays them).
  const repays = !dev.holdStartedAt && !dev.devSuspendedAt;
  // (Owner, Nov 4, §172) The charges of a test the team paused keep waiting until the team lifts that pause (or the test is stopped or closed), as a suspended
  // developer's do until the reinstatement; the developer's other tests' charges are made now. (A deleted developer's are made anyway.)
  const paused = dev.deletedAt ? [] : await (await import("./teamPause")).teamPausedContractIds(devId);
  const rows = await db.payment.findMany({ where: { developerId: devId, status: "deferred", coveredById: null, OR: [{ kind: { notIn: ["chargeback", "owed"] } }, ...(repays ? [{ kind: "chargeback", repaysId: { not: null } }] : [])], ...(paused.length ? { AND: [{ OR: [{ contractId: null }, { contractId: { notIn: paused } }] }] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const r = await once.chargeWaitingTotal(devId, rows);
  if (r?.result === "paid" && r.cents > 0) await receipt(dev.email, once.receiptWhat(r.names, true), r.cents, r.status !== "not_set_up" ? "charged" : "not_set_up", "/app/payments");
}

async function chargeReadyDeferred() {
  const waiting = await db.payment.findMany({ where: { status: "deferred" }, select: { developerId: true }, distinct: ["developerId"] });
  // (Owner, Nov 3) A deleted developer's waiting charges are made too, hold or not.
  const devs = await db.user.findMany({ where: { id: { in: waiting.map((p) => p.developerId) }, OR: [{ holdStartedAt: null, devSuspendedAt: null }, { deletedAt: { not: null } }] }, select: { id: true }, take: 100 });
  for (const dev of devs) await chargeDeferred(dev.id);
}

/** Developer Payments keeps waiting charges separate from the fixed owed balance. */
/**
 * (Owner, Nov 4, §178) A call's date and time as a page line writes it, in the developer's saved zone (else this request's): "Tue, Oct 27, 7:15 AM", as the owed lines
 * and the test page's lines do (bells and emails keep the time token, which names the zone).
 */
export async function pageCallDay(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId }, select: { timeZone: true } });
  return (d: Date) => callAtFor(d, u);
}

export async function deferredForBox(devId: string) {
  // (Nov 2, payments proof: bug seen on video) A charge covered by a combined payment waiting for the bank is listed in that payment's "Confirm with your bank" item,
  // not here too.
  const rows = await db.payment.findMany({ where: { developerId: devId, status: "deferred", coveredById: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  // (Owner, Nov 4, §177) An automatic call charge names its call's date as a time token: written in the developer's zone for the page.
  const day = await pageCallDay(devId); // (§178)
  return Promise.all(rows.map(async (p) => ({ id: p.id, amountCents: p.amountCents, what: await renderFor(devId, await deferredWhat(p, false, day)), full: await renderFor(devId, await deferredWhat(p, true, day)),
    // (Owner, Nov 5, §270) The row's words open the exact part on the test page (its sent work, its call, else the tester's row).
    href: p.contractId ? `/app/tests/${(await db.contract.findUniqueOrThrow({ where: { id: p.contractId }, select: { testId: true } })).testId}#${p.submissionId ? `piece-${p.submissionId}` : p.callId ? `call-${p.callId}` : `tester-${p.contractId}`}` : "/app/payments" })));
}

/**
 * (Owner, Nov 2, §131) The piece a payment is for, named by rules.ts pieceName (its tester, part and test, cut at 10 characters): "Ana Silva's written answers on
 * “Harbor Run”". A call names its day (`day`: a time token in the reader's zone by default) unless `day` is false. Null when the payment has no test. `full`: the
 * names uncut (a page line's hover).
 */
// (Owner, Nov 4, §178) A call is named by its date AND time (§177: "live call on “Harbor Run” (Tue, Oct 27, 7:15 AM)"): the default is a date-and-time token.
export async function paymentPiece(p: { contractId: string | null; submissionId: string | null; callId: string | null }, day: ((d: Date) => string) | false = (d) => T(d), full = false) {
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  if (!c) return null;
  const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId }, select: { kind: true } }) : null;
  const call = !p.submissionId && p.callId && day ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
  const part = partOf(p.submissionId ? null : p.callId, sub ? sub.kind || "written" : p.submissionId ? "written" : null);
  return pieceName({ tester: displayName(c.tester), part, test: c.title, when: call && day ? day(call.startsAt) : null, full });
}

/**
 * (Owner, Nov 4, §177) Which payment a reversal's line is about: " for Ana Silva's written answers on “Harbor Run”", " for the team's dispute decision on …" (the
 * chargeback's opening line already named it), or "" when it paid for no one part.
 */
export async function reversalFor(p: { kind: string; contractId: string | null; submissionId: string | null; callId: string | null }) {
  const piece = await paymentPiece(p);
  return piece ? ` for ${p.kind === "dispute" ? disputeDecisionName(piece) : piece}` : "";
}

/**
 * (Owner, Nov 4, §193b) A one payment (Pay what you owe's, Confirm all's, a reservation's: kind "owed") named by its kind, when it was made and every item it paid
 * (§191's item names): "Pay what you owe payment on Wed, Nov 4, 12:30 PM (Ana Silva's written answers on “Harbor Run”, Ben Okafor's live call on “Harbor Run” (Tue,
 * Oct 27, 3:25 PM))". Null for any other payment. `full`: the names uncut (bells, emails, the team's lines); `day`: how a date and time is written (a time token, in
 * the reader's zone, by default).
 */
export async function onePaymentName(p: { id: string; kind: string; note?: string | null; createdAt: Date }, full = false, day: (d: Date) => string = (d) => T(d)): Promise<string | null> {
  if (p.kind !== "owed") return null;
  const kind = p.note === "press:all" ? "Confirm all payment" : p.note === "reserve" ? "payment reserved on your card" : "Pay what you owe payment";
  const items = await db.payment.findMany({ where: { coveredById: p.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const names: string[] = await Promise.all(items.map((x): Promise<string> => owedItemName(x, full, day)));
  return `${kind} on ${day(p.createdAt)}${names.length ? ` (${names.join(", ")})` : ""}`;
}

/** (§193b) Which payment a reversal or bank-change line is about: its part (a team decision named as one), or a one payment with its items (`one`). */
export async function reversedNaming(p: { id: string; kind: string; note?: string | null; createdAt: Date; contractId: string | null; submissionId: string | null; callId: string | null }, full = false, day: (d: Date) => string = (d) => T(d)): Promise<{ piece: string | null; one: string | null }> {
  const one = await onePaymentName(p, full, day);
  if (one) return { piece: null, one };
  const found = p.contractId ? await paymentPiece(p, day, full) : null;
  return { piece: found && p.kind === "dispute" ? disputeDecisionName(found) : found, one: null };
}

/**
 * What a payment charged after a pause was for, in its receipt: a team decision, (batch 28 §8) a tester's Charge ("Ana Silva's written answers (charged by them after
 * 7 days)", like any Charge's receipt), or work the developer paid for during the pause. (§131) Each names its piece: "the team's dispute decision on Ana Silva's
 * recording on “Harbor Run” (charged after the pause)", "Ana Silva's live call on “Harbor Run” (Oct 30, charged automatically after 7 days)".
 */
export async function deferredWhat(p: { kind: string; submissionId: string | null; callId: string | null; contractId: string | null; note?: string | null; repaysId?: string | null }, full = false, /** (§178) how a call's date and time is written */ day: (d: Date) => string = (d) => T(d)) {
  const raised = await raiseWhat(p, full, day); // (§192)
  if (raised) return raised;
  const piece = await paymentPiece(p, false, full);
  if (p.kind === "dispute") return piece ? `${disputeDecisionName(piece)} (charged after the pause)` : "a team decision (charged after the pause)";
  const review = p.submissionId ? await db.review.findUnique({ where: { submissionId: p.submissionId } }) : p.callId ? await db.review.findUnique({ where: { callId: p.callId } }) : null;
  // (Batch 28 §21) A listed call charged automatically while the account was suspended.
  if (review?.reason === AUTO_CHARGED_CALL && piece && p.callId) {
    const call = await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } });
    return `${piece} (${call ? `${day(call.startsAt)}, ` : ""}charged automatically after ${REVIEW_DAYS} days)`; // (§178) the call's date and time
  }
  if (review?.reason === CHARGED_BY_TESTER && piece) {
    // (Batch 35 §162) "charged by her": the tester's recorded pronoun.
    const tester = p.contractId ? (await db.contract.findUnique({ where: { id: p.contractId }, select: { tester: { select: { pronoun: true } } } }))?.tester : null;
    return `${piece} (charged by ${pronouns(tester?.pronoun).obj} after ${REVIEW_DAYS} days)`;
  }
  return piece ? `${piece} (paid during the pause)` : "work you paid for during the pause";
}

/**
 * (Batch 29 §37) What a deferred payment declined after a lift was: the team's decision, or the piece. (§131) Named by pieceName: "Ana Silva's written answers on
 * “Harbor Run”", "Ana Silva's live call on “Harbor Run” (Nov 5)", "the team's dispute decision on Ana Silva's recording on “Harbor Run”".
 */
export async function declinedWhat(p: { kind: string; submissionId: string | null; callId: string | null; contractId: string | null; note?: string | null; repaysId?: string | null }) {
  const raised = await raiseWhat(p); // (§192)
  if (raised) return raised;
  const piece = await paymentPiece(p);
  if (p.kind === "dispute") return piece ? disputeDecisionName(piece) : "a team decision";
  return piece ?? "work you paid for during the pause";
}

/**
 * Lift the hold when nothing is owed and no chargeback is open; move every clock on by the length of the pause.
 * (Owner, Oct 26) A CHARGEBACK hold is a hold with extra steps: paying what is owed never lifts it alone. It also needs a card re-verified with
 * 3D Secure after the chargeback and the admin's approval (which also closes the chargeback).
 */
export async function liftHoldIfClear(devId: string, opts: { /** (batch 24) the caller sends the developer's one notice itself (the team's Approve) */ quietDev?: boolean } = {}) {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev?.holdStartedAt) return false;
  if ((await owed(devId)).length) return false;
  // (Owner, Nov 3) From the 2nd chargeback, once the team allowed paying: the reversed payments now repaid are resolved, so paying lifts the hold.
  if (dev.holdReason === "chargeback" && dev.chargebackApprovedAt && (await (await import("./chargeback")).chargebackCount(devId)) >= CHARGEBACKS_REVIEW_FROM) await (await import("./chargeback")).resolveRepaidAfterReview(devId);
  if (await db.payment.count({ where: { developerId: devId, chargeback: "open" } })) return false;
  if (dev.holdReason === "chargeback" && (!dev.chargebackCardVerifiedAt || !dev.chargebackApprovedAt)) return false;
  // (Owner, Oct 27) After the 3rd hold, every later hold needs an admin's Approve, even once everything owed is paid: the admins are told a lift is waiting.
  if (dev.holdReason !== "chargeback" && dev.holdCount > HOLD_APPROVAL_AFTER && !dev.holdApprovedAt) {
    await tellAdminsLiftWaiting(dev);
    return false;
  }
  const start = dev.holdStartedAt, now = new Date();
  let running: string[] = [];
  // (Owner, Nov 4, §178) Checked again under the developer's row lock, which chargebackOpened's claim takes too: a chargeback that opens at any moment (even one on
  // the very Pay what you owe payment that is lifting this hold) either lands first (the lift stops here: the account stays on its chargeback hold) or after the
  // lift (it starts a new chargeback hold). Before, a chargeback claimed between the checks above and this write found the hold still on (so it started none) and
  // the lift then cleared the hold: an open chargeback with no hold.
  const clear = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: devId } });
    if (!u?.holdStartedAt || u.holdStartedAt.getTime() !== start.getTime()) return false;
    if (await tx.payment.count({ where: { developerId: devId, chargeback: "open" } })) return false;
    if (await tx.payment.count({ where: { developerId: devId, kind: { not: "owed" }, OR: [{ status: "failed", owedUntil: { not: null }, settledAt: null }, { status: "owed" }, { status: PAYING }] } })) return false;
    if (u.holdReason === "chargeback" && (!u.chargebackCardVerifiedAt || !u.chargebackApprovedAt)) return false;
    if (u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER && !u.holdApprovedAt) return false;
    running = await resumeTests(tx, devId, start, now, [u.devSuspendedAt]);
    await tx.user.update({ where: { id: devId }, data: { holdStartedAt: null, holdReason: "", holdAlertedAt: null, chargebackCardVerifiedAt: null, chargebackApprovedAt: null, holdApprovedAt: null, holdApprovedById: null } });
    return true;
  });
  if (!clear) return false;
  await accountEvent(devId, "hold-lifted");
  // (Batch 23 section 6) Anything still reserved on the card is released (nothing taken).
  await (await import("./chargeback")).releaseReservations(devId);
  // (Batch 8) The subscription's paid days left resume (unless a suspension is still on).
  await (await import("./subscription")).resumeBilling(devId, now);
  await chargeDeferred(devId);
  // A waiting charge may have declined and started a NEW hold: do not announce running tests then.
  if ((await db.user.findUniqueOrThrow({ where: { id: devId }, select: { holdStartedAt: true } })).holdStartedAt) return true;
  // (Owner, Oct 29, batch 10) "Your tests are running again" only when nothing pauses them any more: with an admin suspension still on, the payment line instead (both ignore Off).
  if (opts.quietDev) {
    // (Batch 24, a batch 23 leftover) The team's Approve tells the developer in its own single notice.
  } else if (dev.devSuspendedAt) await notify(dev.email, STILL_SUSPENDED_LINE, [STILL_SUSPENDED_LINE], "/app", { side: "developer", always: true, payment: true, group: "payhold" });
  else await notify(dev.email, "Your tests are running again", ["Everything you owed is paid: your tests are running again, and every deadline moved on by the pause."], "/app", { side: "developer", always: true, payment: true, group: "payhold" });
  const testers = await db.contract.findMany({ where: { status: "working", testId: { in: running } }, include: { tester: true } });
  for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`, { group: "paused" });
  return true;
}

/** Admins get one bell line when a hold lift is waiting for them (after the developer paid): (batch 29 §29) its own daily entry ("Hold lifts waiting · 1"), linking to the row. */
async function tellAdminsLiftWaiting(dev: { id: string; email: string; name: string; pronoun: string; holdCount: number; holdStartedAt: Date | null }) {
  const flagged = (await reportedOver3([dev.id])).has(dev.id);
  const p = pronouns(dev.pronoun);
  const text = `Hold lift waiting: ${labelled(displayName(dev), flagged)} paid what ${p.subj} ${p.v("owes", "owe")} (${MANY_HOLDS_LABEL})`;
  for (const a of await adminUsers()) {
    if (await db.notification.count({ where: { userId: a.id, text, createdAt: { gt: dev.holdStartedAt ?? new Date(0) } } })) continue;
    await bell(a.id, text, `/admin#lift-${dev.id}`, undefined, { group: "adminlifts" });
  }
}

/** (§201) The team's Approve before the developer has paid: "The team approved lifting your hold: it lifts once you have paid what you owe". */
export const approvedWaitingLine = () => "The team approved lifting your hold: it lifts once you have paid what you owe";
/** (Owner, Nov 5, §201) The team's note on its own decision, IN the bell line: " Their note: “Thanks for paying quickly.”" (nothing without a note). */
export const theirNote = (note: string) => (note ? ` Their note: “${note}”` : "");
/** Admin: approve lifting a payment hold (the 4th hold onward). First press wins. The hold lifts once everything owed is paid. */
export async function approveHoldLift(adminId: string, devId: string, note: string, seen: import("./adminRace").AdminSeen | null = null) {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev?.holdStartedAt || dev.holdReason === "chargeback" || dev.holdCount <= HOLD_APPROVAL_AFTER) {
    // (Batch 34 §1) Approved by another admin and lifted since (the hold no longer says so): the approval on record names them.
    const ok = dev && !dev.holdStartedAt ? await db.accountEvent.findFirst({ where: { userId: devId, kind: "hold-approved" }, orderBy: { createdAt: "desc" } }) : null;
    const hold = ok ? await db.accountEvent.findFirst({ where: { userId: devId, kind: "hold" }, orderBy: { createdAt: "desc" } }) : null;
    if (ok && (!hold || hold.createdAt <= ok.createdAt)) {
      // (Batch 35 §45) This admin's own Approve (another tab): "You already approved this lift in another tab at 3:20 AM."
      const race = await import("./adminRace");
      const own = await race.ownChange(race.presserOf(adminId, seen), ok.byId, ok.createdAt);
      if (own) throw new HttpError(409, "decided", race.youAlready("approved this lift", own, ok.createdAt));
      const by = ok.byId ? await db.user.findUnique({ where: { id: ok.byId } }) : null;
      throw new HttpError(409, "decided", `This lift was already approved${by ? ` by ${displayName(by)}` : ""} at ${fmtDateTime(ok.createdAt)}.`);
    }
    throw new HttpError(409, "not_needed", "That account's hold doesn't need an approval.");
  }
  const race = await import("./adminRace");
  const already = async () => {
    const now = await db.user.findUniqueOrThrow({ where: { id: devId } }); // (batch 34) read again: the first admin's approval names them
    // (Nov 2, §119) The approval may have lifted the hold at once (which clears it from the account): then its record, committed with the claim, names them.
    const ev = now.holdApprovedAt ? null : await db.accountEvent.findFirst({ where: { userId: devId, kind: "hold-approved", createdAt: { gte: dev.holdStartedAt ?? new Date(0) } }, orderBy: { createdAt: "desc" } });
    const byId = now.holdApprovedAt ? now.holdApprovedById : ev?.byId ?? null, at = now.holdApprovedAt ?? ev?.createdAt ?? null;
    const own = at ? await race.ownChange(race.presserOf(adminId, seen), byId, at) : null; // (batch 35 §45)
    if (own && at) return new HttpError(409, "decided", race.youAlready("approved this lift", own, at));
    const by = byId ? await db.user.findUnique({ where: { id: byId } }) : null;
    return new HttpError(409, "decided", `This lift was already approved${by ? ` by ${displayName(by)}` : ""}${at ? ` at ${fmtDateTime(at)}` : ""}.`);
  };
  if (dev.holdApprovedAt) throw await already();
  // (Owner, Oct 30, batch 34 §1) Another admin suspended (or reinstated) this developer since the page loaded: the Approve stops once; the second press goes ahead.
  const from = race.checkFrom(seen);
  if (from) race.stopIfChanged("Approve", await race.accountChangesSince(devId, adminId, from, ["suspended", "reinstated"], seen?.tab));
  // (Nov 2, §119) The claim and its account-history record (who, when) commit together.
  const claimed = await db.$transaction(async (tx) => {
    const at = new Date();
    const r = await tx.user.updateMany({ where: { id: devId, holdApprovedAt: null, holdStartedAt: { not: null } }, data: { holdApprovedAt: at, holdApprovedById: adminId } });
    if (r.count === 1) await tx.accountEvent.create({ data: { userId: devId, kind: "hold-approved", byId: adminId, note, side: "", createdAt: at } });
    return r;
  });
  if (claimed.count !== 1) throw await already();
  // (Owner, Nov 5, §201) ONE line that says what the team did (it was "A note from the team about your hold" beside "Your tests are running again", or only the latter
  // with no note, which never said it was the team): the lift says so itself, like the chargeback hold's Approve (batch 24). The owner (Nov 5) wants the team's note IN
  // the bell line: "… Their note: “…”" (an exception to batch 15's "no notes in bell lines", for the team's notes on its own decisions; the email has it too).
  const lifted = await liftHoldIfClear(devId, { quietDev: true });
  const noted = theirNote(note);
  if (!lifted) {
    const line = `${approvedWaitingLine()}.${noted}`;
    await notify(dev.email, note ? line : approvedWaitingLine(), [line], "/app/payments", { side: "developer", payment: true, group: "admindecision" });
  } else {
    const after = await db.user.findUniqueOrThrow({ where: { id: devId }, select: { devSuspendedAt: true, holdStartedAt: true } });
    const cb = await import("./chargeback");
    // A payment charged right after the lift was declined (a new hold), or a suspension still keeps the tests paused: the same one line says so.
    const line = (after.holdStartedAt ? `${cb.APPROVED_LINE}. A waiting payment was declined, so your tests are paused again.` : after.devSuspendedAt ? cb.approvedStillSuspendedLine(0) : cb.approvedLiftedLine(0)) + noted;
    await notify(dev.email, line, [line, ...(after.holdStartedAt || after.devSuspendedAt ? [] : ["Everything you owed is paid, and every deadline moved on by the pause."])], after.holdStartedAt ? "/app/payments#owed" : "/app", { side: "developer", always: true, payment: true, group: "admindecision" });
  }
  return { ok: true, lifted };
}

/**
 * "Pay what you owe": stops once if the owed total changed since the page loaded (seenTotalCents); the second press pays at once. (Owner, Nov 2, batch 35 §117) What is
 * owed is charged as ONE payment for the total (one charge, one bank check if the card asks); a debt already waiting for the bank is locked and left out (its box line
 * says "Waiting for your bank", with "Cancel this check").
 */
export async function payOwed(dev: { id: string }, body: Record<string, unknown> = {}) {
  await (await import("./confirm")).expireActions();
  const once = await import("./owedOnce");
  await once.resumeStaleOwed(dev.id);
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  // (Owner, Oct 29, batch 23 section 6) A chargeback hold: what is already reserved on the card is not asked for again (only what was added since).
  const cbHold = !!u.holdStartedAt && u.holdReason === "chargeback";
  // (Owner, Nov 3) From the account's 2nd chargeback the team reviews it before the developer can pay (an old page's press too); once allowed, the press CHARGES
  // everything as one payment (no reservation) and paying lifts the hold.
  const cbCount = cbHold ? await (await import("./chargeback")).chargebackCount(dev.id) : 0;
  const reviewFirst = cbHold && cbCount >= CHARGEBACKS_REVIEW_FROM;
  if (reviewFirst && !u.chargebackApprovedAt) throw new HttpError(409, "review_first", reviewFirstLine(cbCount));
  const reserving = cbHold && !reviewFirst;
  const rs = reserving ? await (await import("./chargeback")).reserveState(dev.id) : null;
  // (Owner, Nov 3, §160) Its check is being made or waits for the bank (another tab, an older page): refused with that line, never a stop-once.
  await refuseOwedInFlight(dev.id);
  const covered = rs?.covered ?? null;
  const locks = await once.owedLocks(dev.id);
  // (§125) What is owed and the charges waiting for the lift, as one payment.
  const all = (await payable(dev.id)).filter((p) => !covered?.has(p.id));
  // (§117 rule 3) A debt waiting for the bank is never charged by a press (the same during a chargeback hold's reservation).
  let list = withDebt(all.filter((p) => !locks.has(p.id)));
  let total = list.reduce((a, p) => a + p.amountCents, 0);
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves ONCE: with a reservation in place, what was added since is charged right after the lift (no second one).
  if (rs && rs.reservedCents > 0 && list.length) throw new HttpError(409, "nothing_owed", reservedAddedLine(rs.reservedCents, total));
  // (Owner, Oct 29, batch 10) Paid meanwhile (another tab, or a won chargeback): nothing is charged, ever twice.
  // (A hold left with nothing owed still lifts here, charging nothing.)
  if (!list.length) {
    if (await liftHoldIfClear(dev.id)) return { paid: 0, stillFailing: [] as string[], lifted: true };
    if (all.length) throw new HttpError(409, "bank_waiting", OWED_ALL_WAITING);
    if (covered?.size) throw new HttpError(409, "nothing_owed", (await reservedBefore(dev.id)) ?? ALREADY_RESERVED);
    throw new HttpError(409, "nothing_owed", (await paidBefore(dev.id, body)) ?? NOTHING_OWED);
  }
  const seen = typeof body.seenTotalCents === "number" ? body.seenTotalCents : null;
  const lines = await owedLines(dev.id);
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
  // (Owner, NEXT-UI 12b) Every press checks what the box showed (total and which payments), the second one too: if
  // anything is new it stops again with just the new line(s). (§117) Only what the press would pay counts (a line waiting for the bank isn't).
  let nowIds = lines.filter((l) => l.retry).map((l) => l.id);
  // (Owner, Nov 2) A tester's Charge that came in after the page drew its total never stops the press: it's left out of this payment (which is what the page
  // showed) and waits, charged right after it goes through (§125's after-lift payment). New debts (a chargeback, a failed payment) still stop once.
  if (seen != null && seenIds.length && seenIds.every((i) => nowIds.includes(i))) {
    const fresh = nowIds.filter((i) => !seenIds.includes(i));
    const waiting = new Set(fresh.length ? (await db.payment.findMany({ where: { id: { in: fresh }, status: "deferred" }, select: { id: true } })).map((p) => p.id) : []);
    if (fresh.length && fresh.every((i) => waiting.has(i))) {
      list = list.filter((p) => !waiting.has(p.id));
      total = list.reduce((a, p) => a + p.amountCents, 0);
      nowIds = nowIds.filter((i) => !waiting.has(i));
    }
  }
  // (Owner, Nov 3, §150) Over $200 the press needs the tick "I confirm this payment is over $200.", like Pay: judged on what this press would pay or reserve (a
  // tester's Charge left out above never counts).
  const tickMissing = total > PAY_TICK_CENTS && body.over200 !== true;
  if (seen != null && (seen !== total || (Array.isArray(body.seenIds) && (seenIds.length !== nowIds.length || nowIds.some((i) => !seenIds.includes(i)))))) {
    const freshLines = lines.filter((l) => l.retry && !seenIds.includes(l.id));
    const fresh = freshLines.map((l) => l.text.replace(/ · card declined .*$/, ""));
    // (Batch 10) A tester's Charge or a chargeback added meanwhile isn't a failed payment: it reads "Added to what you owe meanwhile".
    // (Batch 11) A chargeback the platform won meanwhile (it left the list) says so.
    const goneIds = seenIds.filter((i) => !nowIds.includes(i));
    const won = goneIds.length ? await db.payment.findMany({ where: { id: { in: goneIds }, chargeback: "won" } }) : [];
    // (§129) During a chargeback hold the second press reserves (after verifying the card if it isn't yet): the line says so, never "pay".
    const again = pressAgainLine(total, reserving ? { cardVerified: !!u.chargebackCardVerifiedAt } : null, tickMissing);
    // (Owner, Nov 3) The bank changed how much it took back (charge.dispute.updated) since the page drew: the stop names that change. The page sends what each line
    // showed (`seenAmounts`); an older page that didn't: the one chargeback line it showed explains the whole difference.
    const seenAmounts = body.seenAmounts && typeof body.seenAmounts === "object" && !Array.isArray(body.seenAmounts) ? (body.seenAmounts as Record<string, unknown>) : null;
    const cbLines = lines.filter((l) => l.retry && l.source === "chargeback" && seenIds.includes(l.id));
    let moved = cbLines.flatMap((l) => { const was = seenAmounts?.[l.id]; return typeof was === "number" && was !== l.amountCents ? [{ l, was }] : []; });
    if (!seenAmounts && !goneIds.length && !fresh.length && cbLines.length === 1 && total !== seen && cbLines[0].amountCents - (total - seen) > CHARGEBACK_FEE_CENTS) moved = [{ l: cbLines[0], was: cbLines[0].amountCents - (total - seen) }];
    const movedTexts = moved.map(({ l, was }) => ("cb" in l && l.cb ? bankChangedLine(l.cb.paidCents, l.cb.piece, was - CHARGEBACK_FEE_CENTS, l.cb.reversedCents, l.cb.one) : "")).filter(Boolean);
    // (Owner, Nov 4, §171 B6c) EVERY change since the page drew, each with its amount, in one stop (they no longer replace each other): what was added, a chargeback
    // won (taken off), an amount the bank raised or lowered; then the new total and the press-again line with it.
    // (Owner, Nov 5, §206) Each change is its own bullet (one per item added, failed, won or changed), as in every other stop box; the new total and the press-again
    // line are the last bullet, keyed so a later stop replaces it (mergeChanges) instead of adding a second total (the one-line "What you owe changed" too).
    // (Owner, Nov 5, §247) A chargeback won names which payment it was on, as everywhere else: "… of $10.00 on your $10.00 payment for Ana Silva's written answers
    // on “Harbor Run” was reversed in your favour …" (the page's own zone for a call's date and time).
    const day = await pageCallDay(dev.id);
    const wonTexts = await Promise.all(won.map(async (w) => { const n = await reversedNaming(w, false, day); return { w, on: ` on ${paymentWords(w.amountCents, n.piece, n.one)}` }; }));
    const parts = [
      ...freshLines.map((l, i) => `${l.source === "failed" ? "Another payment failed meanwhile" : "Added to what you owe meanwhile"}: ${fresh[i]}`),
      // (§133) what it reversed; what leaves the total: what the page showed for it, else what the bank reversed + the fee.
      ...wonTexts.map(({ w, on }) => { const was = seenAmounts?.[w.id]; return `Your bank's chargeback of ${money(reversedOf(w))}${on} was reversed in your favour: ${money(typeof was === "number" ? was : reversedOf(w) + CHARGEBACK_FEE_CENTS)} taken off`; }),
      ...movedTexts,
    ];
    const at = new Date();
    const changes = parts.length ? [...parts.map((text) => ({ text, at })), { text: `${fresh.length || won.length || movedTexts.length ? `New total ${money(total)}. ` : ""}${again}`, at, key: "owed-total" }] : [{ text: `What you owe changed: now ${money(total)}. ${again}`, at, key: "owed-total" }];
    // (Owner, Nov 3) The lines come with the stop, so the box redraws them with the new total (a bullet never disagrees with the button).
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes, totalCents: total, ids: nowIds, lines });
  }
  // (§150) Unchanged but over $200 without the tick (a page that never showed it, or a press without it): refused, stopping once with the tick's line; the box shows it.
  if (tickMissing) throw new HttpError(409, "stop_once", OWED_OVER_TICK, { changes: [{ text: pressAgainLine(total, reserving ? { cardVerified: !!u.chargebackCardVerifiedAt } : null, true), at: new Date() }], totalCents: total, ids: nowIds, lines });
  // (Owner, Oct 28, batch 16 section 41) A chargeback hold's steps go in order: a card verified with 3D Secure first, then paying (which never lifts it: the team's Approve does).
  // (Nov 2, payments proof) After the stop-once check: a page that hadn't shown a chargeback stops once naming it first ("Your bank reversed a $10 payment…").
  if (u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackCardVerifiedAt) throw new HttpError(409, "verify_first", VERIFY_FIRST);
  // (Owner, Oct 29, batch 23 section 6) A chargeback hold: one authorization for the total (the bank's check inline if it asks); nothing is taken until the team approves.
  if (reserving) {
    const r = await (await import("./chargeback")).reserveOwed(u, list);
    if ("failed" in r) return { paid: 0, stillFailing: [`${money(total)} (${r.failed!.replace(/.$/, "")})`], lifted: false, confirm: [] };
    return { paid: 0, stillFailing: [] as string[], lifted: false, reservedCents: total, confirm: "action" in r && r.action ? [r.action] : [] };
  }
  // (§117 rule 6) ONE payment for the total: one charge, one bank check if the card asks (inline under the button), one receipt naming every item.
  // (Owner, Nov 3) Allowed to pay after the team's review: checked again inside the claim (a new chargeback meanwhile un-approves it).
  const r = await once.chargeOwedTotal(u, list, "press", reviewFirst ? { reviewFirst: reviewFirstLine(cbCount + 1) } : {});
  if (r.result === "skipped") throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text: "What you owe changed meanwhile. Press again to pay what's left.", at: new Date(), key: "owed-total" }] });
  if (r.result === "action") return { paid: 0, stillFailing: [] as string[], lifted: false, confirm: [r.action] };
  if (r.result === "failed") {
    const what = list.length === 1 ? lines.find((l) => l.id === list[0].id)?.text ?? money(total) : money(total);
    return { paid: 0, stillFailing: [`${what} (${r.why.replace(/\.$/, "")})`], lifted: false, confirm: [] };
  }
  if (r.result === "paid" && r.cents > 0) await receipt(u.email, owedReceiptWhat(r.names), r.cents, r.status !== "not_set_up" ? "charged" : "not_set_up", "/app/payments");
  // The hold lifts only when all are paid; a chargeback hold also needs the card check and the admin's approval.
  const lifted = await liftHoldIfClear(dev.id);
  return { paid: r.result === "paid" ? r.names.length : 0, stillFailing: [] as string[], lifted, confirm: [] };
}

/** (Batch 15 section 41, L4) Why one owed payment failed, in plain words (never Stripe's raw text). */
// (§130) A card Stripe doesn't know ("no_card": cleared, add a card) and payments switched off ("payments_off") say so in their own words; neither is a decline.
export const owedWhy = (e: unknown) => (e instanceof HttpError && e.code === "card_failed" ? "Your card was declined." : e instanceof HttpError && (e.code === "payments_problem" || e.code === "no_card" || e.code === "payments_off") ? e.code === "payments_problem" ? PAYMENTS_PROBLEM : e.message : "It didn't go through. Try again shortly.");

// (Owner, Nov 3, batch 35 §148) No automatic charge of what's owed at all: not daily (§145) and not when a new card is saved (that charge is gone). What is owed
// during a payment hold is charged only when the developer presses Pay what you owe (payOwed, above).

/**
 * (Owner, Nov 3, §159) Pay what you owe pressed on a page from before it was paid (another tab, or the same page not redrawn): the line names what happened, with its
 * amount and time: "You already paid what you owe ($27.00) in another tab at 3:20 PM." Read from the one payment that covered what the page showed.
 */
async function paidBefore(devId: string, body: Record<string, unknown>) {
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
  const cover = seenIds.length ? await db.payment.findFirst({ where: { id: { in: seenIds }, developerId: devId, coveredById: { not: null } }, select: { coveredById: true } }) : null;
  const one = cover?.coveredById ? await db.payment.findUnique({ where: { id: cover.coveredById } }) : await db.payment.findFirst({ where: { developerId: devId, kind: "owed", status: { in: ["charged", "not_set_up", "bundled"] }, settledAt: { gt: new Date(Date.now() - 86_400_000) } }, orderBy: { settledAt: "desc" } });
  if (!one || one.developerId !== devId || !["charged", "not_set_up", "bundled"].includes(one.status)) return null;
  const { fmtTime } = await import("./dateFormat");
  return `You already paid what you owe (${money(one.amountCents)}) in another tab at ${fmtTime(one.settledAt ?? one.createdAt)}.`;
}
/** (Owner, Nov 3, §159) The same during a chargeback hold: "You already reserved what you owe ($46.00) on your card in another tab at 3:20 PM." */
async function reservedBefore(devId: string) {
  const r = await db.reservation.findFirst({ where: { developerId: devId, status: { in: ["authorized", "reserved", "requires_capture", "held"] } }, orderBy: { createdAt: "desc" } });
  if (!r) return null;
  const { fmtTime } = await import("./dateFormat");
  return `You already reserved what you owe (${money(r.amountCents)}) on your card in another tab at ${fmtTime(r.createdAt)}.`;
}

/** (Batch 11) An owed payment a "Pay what you owe" press is charging right now. */
const PAYING = "paying";
/** (Batch 10) "Pay what you owe" pressed when nothing is owed any more (paid in another tab meanwhile). */
export const NOTHING_OWED = "There's nothing to pay: what you owed is already paid.";
/** (Batch 23 section 6) Pay what you owe during a chargeback hold when everything owed is already reserved (another tab). */
export const ALREADY_RESERVED = "There's nothing more to reserve: what you owe is already reserved on your card.";

/**
 * (Batch 11) A payment that waited (owed, or for the bank's confirmation) went through: the developer's receipt and the tester's paid line. (Batch 25 section 5) The one
 * receipt names what was paid: "what you owed: Ana Silva's live call on “Harbor Run” (Oct 30)" for a retry of what's owed (`wasOwed`), else the piece or the team's decision.
 */
export async function settledOwed(paymentId: string, wasOwed = false) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  // (Owner, Nov 3) Full names in receipts (an email has no hover).
  const name = await owedItemName(p, true);
  await receipt(dev.email, wasOwed ? owedReceiptWhat([name]) : name, p.amountCents, p.status, "/app/payments");
  if (p.kind !== "chargeback" && p.kind !== "subscription") await tellArrived(p, tester.email, displayName(dev));
}

/**
 * (Owner, Nov 4, §192) A charge of what the bank raised after the repayment, named in a receipt, a bank check's items, a decline or a waiting line: "the rise in what
 * your bank took back from your $20.00 payment for Ana Silva's written answers on “Harbor Run” ($12.00 → $20.00)". Null for any other payment.
 */
export async function raiseWhat(p: { kind: string; note?: string | null; repaysId?: string | null }, full = false, day?: (d: Date) => string): Promise<string | null> {
  const r = raiseOf(p);
  if (!r) return null;
  const orig = p.repaysId ? await db.payment.findUnique({ where: { id: p.repaysId } }) : null;
  // (Owner, Nov 4, §193b) A one payment names itself and its items.
  const named = orig ? await reversedNaming(orig, full, day) : { piece: null, one: null };
  return raiseName(orig?.amountCents ?? 0, named.piece, r.from, r.to, named.one);
}

/**
 * (Owner, Oct 29, batch 25 section 5) What one payment was for, named like the dashboard's rows (§131: paymentPiece): "Ana Silva's live call on “Harbor Run” (Oct 30)"
 * (a time token: the reader's own zone), "Ben Okafor's written answers on “Harbor Run”", "the team's dispute decision on Ana Silva's recording on “Harbor Run”"; a
 * reversed payment owed again (an open chargeback, or its repay row): "a payment your bank had reversed (Ana Silva's written answers on “Harbor Run”)".
 */
export async function owedItemName(p: { amountCents: number; kind: string; contractId: string | null; submissionId: string | null; callId: string | null; chargeback?: string | null; repaysId?: string | null; note?: string | null }, full = false, /** (§178) a page's call date and time (pageCallDay); a token by default */ day?: (d: Date) => string) {
  const raised = await raiseWhat(p, full, day);
  if (raised) return raised;
  const orig = p.kind === "chargeback" && p.repaysId ? await db.payment.findUnique({ where: { id: p.repaysId } }) : null;
  const base = orig ?? p;
  const found = await paymentPiece(base, day, full);
  const piece = found && base.kind === "dispute" ? pieceWords.dispute(found) : found;
  if (orig || p.chargeback === "open" || p.kind === "chargeback") return pieceWords.reversed(piece);
  return piece ?? `a payment of ${money(p.amountCents)}`;
}

/** The tester's one notice when a delayed payment goes through: the normal paid line. */
export async function tellArrived(p: { contractId: string | null; submissionId: string | null; callId: string | null; kind: string; amountCents: number }, email: string, devName: string) {
  const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
  // (Owner, Nov 4, §177) A bell names WHICH part and WHICH test: "Nora Lane paid $15.00 for your live call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST)", "… for your
  // dispute about your recording on “Harbor Run”".
  const title = p.contractId ? (await db.contract.findUnique({ where: { id: p.contractId }, select: { title: true } }))?.title : null;
  const part = title && (p.submissionId || p.callId) ? await partOnTest(p, "your", title) : null;
  const label = p.kind === "dispute" ? "dispute" : p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
  const line = part ? `${devName} paid ${money(p.amountCents)} for ${p.kind === "dispute" ? `your dispute about ${part}` : part}` : `${devName} paid ${money(p.amountCents)} for your ${label}`;
  await notify(email, line, [line + "."], p.contractId ? `/app/sessions/${p.contractId}#${p.callId ? `call-${p.callId}` : sub?.kind === "recording" ? "part-recording" : "part-written"}` : "/app/payments", { side: "tester", payment: true, group: "tarrived" });
}

/** (Owner, Nov 5, §240) Pay what you owe's line for a charge made before the hold whose bank check is still open. */
/**
 * (Owner, Nov 5, batch 35 §246) A Pay what you owe line split for the page: `what` (the payment named, cut at 30 with its arrow) and `rest` (its amount, the chargeback
 * fee, its status and date), always shown outside the cut. A chargeback line "Your bank reversed $10 you paid for …: $10 + $15 chargeback fee" splits at its last ": ".
 */
export function owedSplit(line: string): { what: string; rest: string } {
  const at = line.lastIndexOf(": ");
  return at > 0 ? { what: line.slice(0, at), rest: line.slice(at) } : { what: line, rest: "" };
}
export const OWED_BANK_WAIT_TAIL = "waiting for your bank (Confirm with your bank)";

/**
 * (Owner, Nov 5, §240) Whether a waiting charge's bank check is really open: its own check (`actionPi`), the one payment covering it waiting for the bank
 * (needs_action / needs_confirmation with a check), or the chargeback hold's reservation covering it waiting for the bank. Pay what you owe's box and a part's
 * payments both read the bank wording only then.
 */
export async function bankCheckOpen(p: { id: string; actionPi?: string | null; coveredById?: string | null }) {
  if (p.actionPi) return true;
  if (p.coveredById && (await db.payment.count({ where: { id: p.coveredById, actionPi: { not: null }, status: { in: ["needs_action", "needs_confirmation"] } } }))) return true;
  return (await db.reservation.count({ where: { covers: { has: p.id }, status: "needs_action" } })) > 0;
}

/** (§125) A charge that came in while the one payment is in flight. */
export const OWED_AFTER_CHECK = "Charged right after the payment above goes through";

/** (§133) What Pay what you owe's one payment covered, each with its amount ("Ana Silva's written answers on “Harbor Run” $8.00"), as the confirm items list them. */
async function coveredItems(id: string) {
  const once = await import("./owedOnce");
  const [cut, whole] = await Promise.all([once.coveredNames([id]), once.coveredNames([id], true)]);
  const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const names = cut.get(id) ?? [], full = whole.get(id) ?? [];
  return names.map((text, i) => ({ text: up(text), full: up(full[i] ?? text) }));
}

/** One line per failed payment ("Ana Silva's written answers $8.00 · card declined Oct 20"), plus open chargebacks. */
export async function owedLines(devId: string) {
  // (Batch 23 section 6) During a chargeback hold, what is reserved on the card already isn't listed again (Payments shows "Reserved $X" instead).
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, holdReason: true, timeZone: true } });
  const covered = u?.holdStartedAt && u.holdReason === "chargeback" ? (await (await import("./chargeback")).reserveState(devId)).covered : null;
  const list = (await payable(devId)).filter((p) => !covered?.has(p.id));
  // (Owner, Nov 2, batch 35 §117 rule 3) A debt waiting for the bank is locked: "Waiting for your bank" (not paid by the button), with the check to cancel.
  const locks = list.length ? await (await import("./owedOnce")).owedLocks(devId) : new Map<string, string>();
  const out = [];
  // (Owner, Nov 2, §125) A charge that came in while Pay what you owe's one payment is in flight (being charged, or its bank check open) isn't added to it (its
  // amount is fixed at the claim): it waits, and is charged right after that payment goes through and the hold lifts (the after-lift combined payment, §122).
  let inFlight = new Set(locks.values()).size > 0 && (await db.payment.count({ where: { id: { in: [...new Set(locks.values())] }, kind: "owed", status: { in: ["paying", "needs_action", "needs_confirmation"] } } })) > 0;
  // (Owner, Nov 2) A chargeback hold's reservation being made or waiting for the bank counts the same: what it covers reads "Waiting for your bank" (not paid by the
  // button), and a charge that came in after it reads "Charged right after the payment above goes through" (it's charged after the lift, never added to it).
  const opening = u?.holdStartedAt && u.holdReason === "chargeback" ? await db.reservation.findMany({ where: { developerId: devId, status: { in: ["pending", "needs_action"] } }, select: { id: true, status: true, covers: true } }) : [];
  // (Owner, Nov 3, §160) Its rows carry the reservation's Cancel this check too (any tab), once its bank check is open; one still being made has none.
  const reserving = new Map(opening.flatMap((r) => r.covers.map((c) => [c, r.status === "needs_action" ? r.id : ""] as const)));
  if (opening.length) inFlight = true;
  for (const p of list) {
    if (reserving.has(p.id)) locks.set(p.id, reserving.get(p.id)!);
    const checkId = locks.get(p.id) || null;
    const late = !locks.has(p.id) && inFlight && p.status === "deferred";
    const held = locks.has(p.id);
    const lock = late ? { retry: false, waiting: true, checkId: null, tag: OWED_AFTER_CHECK, after: OWED_AFTER_CHECK } : { retry: !held, waiting: held, checkId, tag: held ? OWED_BANK_WAITING : "" };
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true, test: { select: { title: true } } } }) : null;
    const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
    // (Owner, Nov 2, §131) Named by its tester, part and test (pieceName); a dispute decision by the piece it decided.
    const part = partOf(p.submissionId ? null : p.callId, sub?.kind || "written"); // (as before: a row naming no part reads "written answers")
    // (Owner, Nov 4, §177) A call is named with its date, as pieceName names a call everywhere else. (Owner, Nov 4, §178) With its date AND time, in the
    // developer's saved zone (else this request's), never a raw time marker: "Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:15 AM)". A tester can have
    // several calls on a test (two of bb's $15.50 calls a few minutes apart read as the same line with the day alone).
    const call = !p.submissionId && p.callId ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
    const when = call ? callAtFor(call.startsAt, u) : null;
    const name = (full: boolean) => {
      const piece = c ? pieceName({ tester: displayName(c.tester), part, test: c.test.title, when, full }) : part;
      return p.kind === "dispute" ? disputeDecisionName(piece).replace(/^the/, "The") : piece;
    };
    // (Owner, Nov 4, §192) A charge of what the bank raised after the repayment names that: "The rise in what your bank took back from your $20.00 payment for …".
    const raised = raiseOf(p) ? [await raiseWhat(p, false, (d) => callAtFor(d, u)), await raiseWhat(p, true, (d) => callAtFor(d, u))] : null;
    const up1 = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    const what = raised ? up1(raised[0]!) : name(false), whole = raised ? up1(raised[1]!) : name(true);
    // (§131) `full`: the same line with the names uncut, the line's hover on the page.
    // (Owner, Nov 4, §178) A reversed call payment names the call (its date and time), not the day it was paid: "Your bank reversed $15.50 you paid for bb's live
    // call on “excerptexcer…” (Tue, Oct 27, 7:15 AM)" (it read "(Nov 4)", the payment's day, for two different calls).
    const paidFor = c ? { name: displayName(c.tester), part, test: c.test.title, date: when ?? fmtDate(p.createdAt).replace(/, \d{4}$/, "") } : undefined;
    // (Owner, Nov 5, §240) A charge made before the hold whose bank check is open (its own, the one payment's covering it, or the hold's reservation's) is waiting for
    // the bank, never for the lift: "… · waiting for your bank (Confirm with your bank)".
    const before = p.status === "deferred" && !!u?.holdStartedAt && p.createdAt < u.holdStartedAt;
    const bankWait = before && (!!reserving.get(p.id) || (await bankCheckOpen(p)));
    const tail = p.status === "owed" || p.status === "deferred" || (p.status === PAYING && !p.owedUntil)
      // (Owner, Nov 2) One made before this hold started (its bank check paused when the hold began) reads "waiting until your tests resume", not "… while paused".
      ? ` ${money(p.amountCents)} · ${bankWait ? OWED_BANK_WAIT_TAIL : before ? "waiting until your tests resume" : `${p.kind === "dispute" ? "decided" : p.callId && (await db.review.findUnique({ where: { callId: p.callId }, select: { auto: true } }))?.auto ? "charged automatically" : "charged by the tester"} while your tests were paused`}`
      : null;
    // (Owner, Nov 3, §133) The bank reversed only PART of the payment: "Your bank reversed $96 of your $444.67 payment: $96 + $15 chargeback fee" (a payment for one
    // piece names it: "… of the $444.67 you paid for …"). Pay what you owe's one payment paid for several items and the bank gives only an amount: what it covered
    // is listed under the line (`covers`), none named as the disputed one.
    // (§147) Confirm all's one payment lists what it covered whether the bank reversed part of it or all of it. (Owner, Nov 3) So does every one payment now:
    // a full chargeback on Pay what you owe's (or a new card's combined) payment lists the charges it covered too.
    const covers = p.chargeback === "open" && p.kind === "owed" ? await coveredItems(p.id) : undefined;
    // (Owner, Nov 4, §193b) The line itself names the one payment and its items too: "Your bank reversed your $35 Pay what you owe payment on … (…)".
    const one = p.chargeback === "open" && p.kind === "owed" ? [await onePaymentName(p, false, (d) => callAtFor(d, u)), await onePaymentName(p, true, (d) => callAtFor(d, u))] : [null, null];
    // `source` (batch 10): what put it on the list, for the stop-once wording.
    // (Owner, Nov 3) `cb`: what a press's stop needs to name a change of the reversed amount (the payment, the piece, what the bank took back now).
    const cb = { paidCents: p.paidCents, reversedCents: p.reversedCents, piece: paidFor ? pieceName({ tester: paidFor.name, part: paidFor.part, test: paidFor.test, when }) : null, one: one[0] }; // (§178) a call with its date and time
    out.push(p.chargeback === "open"
      ? { id: p.id, ...lock, amountCents: p.amountCents, until: null as string | null, source: "chargeback" as const, text: chargebackOwedLine(p.reversedCents, paidFor, false, p.paidCents, one[0]), full: chargebackOwedLine(p.reversedCents, paidFor, true, p.paidCents, one[1]), ...owedSplit(chargebackOwedLine(p.reversedCents, paidFor, true, p.paidCents, one[1])), cb, ...(covers ? { covers } : {}) }
      : tail !== null
        // (Owner, Oct 28 afternoon) Added while the tests were paused: never tried on the card yet. (§125) A charge waiting for the lift ("deferred") is paid with
        // what you owe, as one payment, and reads the same.
        ? { id: p.id, ...lock, amountCents: p.amountCents, until: null as string | null, source: "owed" as const, text: `${what}${tail}`, full: `${whole}${tail}`, what: whole, rest: tail }
        : { id: p.id, ...lock, amountCents: p.amountCents, until: null as string | null, source: "failed" as const, text: failedLine(what, p.amountCents, p.createdAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")), full: failedLine(whole, p.amountCents, p.createdAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")), what: whole, rest: failedLine(whole, p.amountCents, p.createdAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")).slice(whole.length) });
  }
  return out;
}

/**
 * Stripe dispute (the developer's bank reversed a payment): a chargeback hold starts (3D Secure card check, pay what is owed, admin Approve). A chargeback during a
 * payment hold turns it into a chargeback hold (the hold count is unchanged); every further chargeback adds to what is owed.
 * (Owner, Nov 3, batch 35 §133) `disputedCents`: the dispute's `amount` (Stripe takes back only that, plus its fee). A bank can dispute PART of a payment: what it
 * reversed is stored on the payment carrying the chargeback (`reversedCents`, at most the payment) and only that part + ONE fee is owed; the rest stays paid. None
 * given (or not a usable amount): the whole payment, as before.
 */
export async function chargebackOpened(paymentIntentId: string, disputedCents: unknown = null) {
  // (Batch 35 §117) Pay what you owe's ONE payment covered several debts with one PaymentIntent: the dispute is on that payment as a whole, so its WHOLE amount is
  // owed again once, with one chargeback fee (the one payment itself carries the chargeback; its debts stay paid). Otherwise the payment the PaymentIntent belongs to.
  // When it paid a single debt, that debt carries it (the same amount, and its test page names the piece).
  let one = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, kind: "owed", status: "bundled" } });
  // (Owner, Nov 2) A chargeback hold's reservation, captured on the team's Approve, also paid several items with ONE PaymentIntent (each row carries its id). The
  // dispute is on that one payment, so it's grouped the same way: one bundle row for its whole amount (the amount once + one fee), the items covered by it.
  if (!one) {
    const rows = await db.payment.findMany({ where: { stripePaymentIntentId: paymentIntentId, kind: { not: "owed" }, chargeback: { not: "open" } } });
    if (rows.length > 1) {
      one = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${rows[0].developerId} FOR UPDATE`;
        const again = await tx.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, kind: "owed", status: "bundled" } });
        if (again) return again;
        const total = rows.reduce((a, r) => a + r.amountCents, 0);
        const b = await tx.payment.create({ data: { kind: "owed", developerId: rows[0].developerId, testerId: rows[0].developerId, amountCents: total, feeCents: total, testerCents: 0, transferStatus: "none", status: "bundled", note: "reserve", stripePaymentIntentId: paymentIntentId } });
        await tx.payment.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { coveredById: b.id } });
        return b;
      });
    }
  }
  // Every row it covered counts (a reversed payment it repaid too): only a payment that covered exactly one item lets that item carry the chargeback.
  // (Owner, Nov 4, §178) And only an ordinary item: never a reversed payment it was repaying (its own chargeback is open until the repayment is recorded, so a
  // dispute arriving in that moment was taken for the old one and dropped) nor that repayment's row (which may not exist yet). The one payment carries it then,
  // whenever the dispute arrives.
  const paid = one ? await db.payment.findMany({ where: { coveredById: one.id } }) : [];
  const single = paid.length === 1 && paid[0].kind !== "chargeback" && paid[0].chargeback === "" ? paid[0] : null;
  const p = (one ? single ?? one : null)
    ?? (await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, kind: { not: "owed" } }, orderBy: { createdAt: "asc" } }));
  if (!p) return false;
  // (§133) What the bank reversed: the dispute's amount, at most the payment (Stripe's amount for a whole dispute equals it).
  const rev = reversedOf({ amountCents: p.amountCents, reversedCents: disputedCentsOf(disputedCents) });
  // (Owner, Nov 4, §178) Claimed under the developer's row lock, the lock liftHoldIfClear takes for its last check: the chargeback is recorded either before a lift
  // (which then stops) or after it (then no hold is on, and a new one starts below). And a hold already on becomes a chargeback hold with no card check and no
  // approval in this same write, never later: the team can approve as soon as the hold shows, and nothing here undoes it afterwards.
  // A payment's chargeback opens once, ever (Stripe allows one dispute per charge): a notice about a dispute already recorded (a retried or late webhook) changes
  // nothing, whatever became of it (open, resolved by the team, won), and never clears an approval.
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${p.developerId} FOR UPDATE`;
    const before = await tx.user.findUniqueOrThrow({ where: { id: p.developerId } });
    // The dispute is known when any payment of this PaymentIntent carries a chargeback (the one payment or the item that took it, whichever an earlier delivery
    // picked: a delivery during the payment's recording can find the item before the one payment is complete).
    const seen = await tx.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, chargeback: { not: "" } }, select: { chargeback: true } });
    if (seen || (await tx.payment.updateMany({ where: { id: p.id, chargeback: "" }, data: { chargeback: "open", chargebackAt: new Date(), reversedCents: rev } })).count !== 1) {
      const now = seen ?? (await tx.payment.findUniqueOrThrow({ where: { id: p.id }, select: { chargeback: true } }));
      return { before, fresh: false, repair: now.chargeback === "open" && !before.holdStartedAt && !before.deletedAt };
    }
    // A chargeback is a hold with extra steps: a hold that is already on becomes a chargeback hold, and any earlier card check or approval no longer counts.
    if (before.holdStartedAt) await tx.user.update({ where: { id: p.developerId }, data: { holdReason: "chargeback", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
    return { before, fresh: true, repair: false };
  });
  // (§178) An open chargeback with no hold (left by the old race, or a run that stopped before its hold started, and Stripe's retry brings the dispute back): the
  // chargeback hold it should have started starts now (its card check and approval empty, as any new hold's).
  if (!claim.fresh) {
    if (claim.repair) await startHold(p.developerId, "chargeback");
    return false;
  }
  const before = claim.before;
  const cb = { amountCents: p.amountCents, reversedCents: rev };
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  if (c) {
    // (§131) Which tester, part and test: "Your bank reversed your $10.00 payment for Ana Silva's written answers on “Harbor Run”". (§133) Part of it: "Your bank
    // reversed $96.00 of your $444.67 payment for …".
    const what = (await paymentPiece(p)) ?? displayName(c.tester);
    await db.$transaction((tx) => recordEvent(tx, c.testId, "chargeback", `Your bank reversed ${reversedWords(cb)} for ${p.kind === "dispute" ? disputeDecisionName(what) : what}`, false, {}, c.id));
  }
  const started = await startHold(p.developerId, "chargeback");
  // (§178) A payment hold that started between the claim and here (a decline at that moment) is a chargeback hold now: this chargeback is on it.
  if (!started && !before.holdStartedAt) await db.user.updateMany({ where: { id: p.developerId, holdStartedAt: { not: null }, holdReason: { not: "chargeback" } }, data: { holdReason: "chargeback", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
  // (Owner, Oct 26) A chargeback email goes to every admin at once, whatever their email setting. (§133) It says what the bank reversed: "Playtest: new chargeback of
  // $96.00", "A developer's bank reversed $96.00 of a $444.67 payment (pi_…)".
  const to = new Set([...admins(), ...(await adminUsers()).map((a) => a.email)]);
  // (Owner, Nov 4, §193b) Which payment, by its part or (a one payment) its kind, time and items, full names: "… reversed $20.00 of a $35.00 Pay what you owe payment
  // on Wed, Nov 4, 12:30 PM (Ana Silva's written answers on “Harbor Run”, …) (pi_…)".
  const named = await reversedNaming(p, true, (d) => fmtDateTime(d));
  for (const a of to) await sendEmail({ to: a, subject: `Playtest: new chargeback of ${money(rev)}`, text: [`A developer's bank reversed ${reversedWords(cb, "a", named.one)}${named.piece ? ` for ${named.piece}` : ""} (${p.stripePaymentIntentId ?? "no payment id"}). The developer's account is on a chargeback hold.`, `${appUrl()}/admin#chargebacks`, "", "Playtest"].join("\n"), button: { label: "Open the admin console", url: `${appUrl()}/admin#chargebacks` } }).catch((e) => console.error("[email] chargeback:", e.message));
  if (!started) {
    const piece = c ? await paymentPiece(p) : null;
    // (Owner, Nov 4, §193b) A one payment names itself and every item it paid (full names: the email has no hover).
    const one = await onePaymentName(p, true);
    // (§133) Part of a payment: "Your bank reversed $96.00 of your $444.67 payment for …: it was added to what you owe".
    const line = `Your bank reversed ${one ? reversedWords(cb, "your", one) : reversedPart(cb) ? reversedWords(cb) : `a ${money(p.amountCents)} payment`}${piece ? ` for ${p.kind === "dispute" ? disputeDecisionName(piece) : piece}` : ""}: ${before.holdStartedAt && before.holdReason !== "chargeback" ? "your payment hold is now a chargeback hold" : "it was added to what you owe"}`;
    // A payment hold that becomes a chargeback hold is a chargeback hold starting (its email ignores Off); a further chargeback just adds to what is owed.
    if (before.holdStartedAt && before.holdReason !== "chargeback") await notify(before.email, line, [line + ".", "To resume: verify a card with 3D Secure, pay what you owe, and wait for the team's approval."], "/app/payments#chargeback-steps", { side: "developer", always: true, payment: true, group: "payhold" });
    else await bell(p.developerId, line, "/app/payments#chargeback-steps", undefined, { side: "developer", payment: true, group: "payhold" });
  }
  // (Owner, Nov 4, §178) The card check and approval are no longer cleared here, after the emails: they were cleared in the claim (a hold already on) or when
  // startHold started this one, so an approval the team made since (the same second the hold appeared) stands.
  // (Owner, Nov 4, §171 B6a) A review-first account (§161: the team had approved paying) whose Pay what you owe check is open in the bank's window: the approval is
  // gone, so its Complete must not charge. The check is cancelled at Stripe first (one that had already gone through is recorded as paid, once); the window reads
  // "This bank check was cancelled: a new chargeback arrived, so the team reviews your account again before you can pay. Pressing Complete won't charge anything."
  if (before.holdStartedAt && before.holdReason === "chargeback" && before.chargebackApprovedAt) {
    const once = await import("./owedOnce");
    await once.cancelOpenOwed(p.developerId, once.OWED_REVIEW_AGAIN);
  }
  return true;
}

/**
 * (Owner, Oct 29, batch 10) Stripe's `charge.dispute.closed` with status `won`: the platform won the chargeback, and Stripe returns the money and the fee. That chargeback's
 * amount leaves what the developer owes. If they already paid it (the repay charge), that amount is refunded to their card, with a receipt line. When no chargeback is left
 * open, a chargeback hold becomes a plain payment hold: it lifts as usual once nothing is owed (from the 4th hold on, an admin's Approve is still needed). The developer gets a
 * bell and an email. Returns false when the payment is unknown or the win was already handled.
 */
export async function chargebackWon(paymentIntentId: string) {
  // (Batch 35 §117) The payment carrying the chargeback: Pay what you owe's one payment when the dispute was on it.
  let p = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, chargeback: { in: ["open", "resolved"] } }, orderBy: { createdAt: "asc" } });
  if (!p || (p.chargeback !== "open" && p.chargeback !== "resolved")) return false;
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // (§133) What the bank had reversed (part of the payment, or all of it): the lines name it, and what was repaid for it is what's refunded.
  const rev = reversedOf(p);
  // (Owner, Nov 4, §171 B6b) Won while Pay what you owe's check covering it is open in the bank's window: its Complete must not charge for it. The open check is
  // cancelled at Stripe FIRST (nothing charged; the developer pays the new total); one the bank had already approved is recorded as paid once, and the part it paid
  // for this chargeback is refunded just below with any other repayment (the Terms' refund rule: a chargeback the platform wins after the developer paid it goes back
  // to their card). A chargeback hold's reservation whose bank check is open is cancelled the same way (nothing is reserved; Pay what you owe reserves the new total).
  if (p.chargeback === "open") {
    const once = await import("./owedOnce");
    const cover = p.coveredById ? await db.payment.findUnique({ where: { id: p.coveredById }, select: { id: true, kind: true } }) : null;
    if (cover?.kind === once.OWED_KIND) await once.cancelOpenOwed(p.developerId, once.OWED_WON_MEANWHILE, [cover.id]);
    for (const r of await db.reservation.findMany({ where: { developerId: p.developerId, status: "needs_action", covers: { has: p.id } } })) {
      if ((await db.reservation.updateMany({ where: { id: r.id, status: "needs_action" }, data: { status: "cancelled", endedAt: new Date() } })).count !== 1) continue;
      if (r.stripePaymentIntentId && stripeOn()) await getStripe().paymentIntents.cancel(r.stripePaymentIntentId).catch((e) => console.error("[won] cancel reservation check:", (e as Error).message));
    }
    // A check that had gone through repaid it (and may have resolved it, §161): the win goes on from what it is now.
    p = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  }
  // Already paid back with "Pay what you owe": refund that charge (the amount and, since batch 11, the fee) to their card. Refunds come first (idempotent at Stripe), so
  // a webhook retried after a failed refund still refunds.
  // (Owner, Nov 4, §192) What is STILL repaid for this reversal at this point: the repayment less what was refunded of it when the bank lowered its amount, and each
  // charge of what the bank raised (less what was refunded of it), each refunded on its own PaymentIntent and recorded as its own negative line ("won").
  let refunded = 0, noStripe = false;
  const paid = await repaidFor(db, p.id);
  for (const r of paid.sources) {
    const key = `won:${r.id}`;
    // A retry finds its refund (one per payment, ever) with the amount it had.
    const rec = (await db.paymentRefund.findUnique({ where: { key } }))
      ?? (paid.left(r.id) > 0 ? await db.paymentRefund.create({ data: { paymentId: r.id, reversalId: p.id, developerId: p.developerId, amountCents: paid.left(r.id), reason: "won", key } }).catch(() => db.paymentRefund.findUnique({ where: { key } })) : null);
    // (Batch 23 section 6) The amount too: a repay taken from a reservation shares its PaymentIntent with the other payments it covered.
    if (rec && rec.status === "pending") {
      if (r.stripePaymentIntentId) {
        const re = await getStripe().refunds.create({ payment_intent: r.stripePaymentIntentId, amount: rec.amountCents }, { idempotencyKey: serverKey("cbwon", r.id) });
        await db.paymentRefund.updateMany({ where: { id: rec.id, status: "pending" }, data: { status: "refunded", stripeRefundId: re.id } });
      } else await db.paymentRefund.updateMany({ where: { id: rec.id, status: "pending" }, data: { status: "recorded" } });
    }
    if ((await db.payment.updateMany({ where: { id: r.id, status: r.status }, data: { status: "refunded" } })).count !== 1) continue;
    refunded += rec?.amountCents ?? 0;
    if (rec && !r.stripePaymentIntentId) noStripe = true;
  }
  // (Owner, Nov 4, §193b) Which payment the chargeback was on: " on your $10.00 payment for …", " on your $35.00 Pay what you owe payment on … (…)" (full names).
  const wonNamed = await reversedNaming(p, true);
  const on = ` on ${paymentWords(p.amountCents, wonNamed.piece, wonNamed.one)}`;
  if (refunded > 0) {
    const line = chargebackRefundLine(rev, on);
    await notify(dev.email, line, [`${line}: ${money(refunded)} refunded.`, noStripe ? "Payments aren't set up yet, so this was recorded and nothing was refunded." : "Refunded to your saved card."], "/app/payments", { side: "developer", payment: true });
  }
  const claimed = await db.payment.updateMany({ where: { id: p.id, chargeback: p.chargeback }, data: { chargeback: "won" } });
  if (claimed.count !== 1) return false;
  // (§133, a gap found while building it) A repayment still waiting for the lift (made after a reservation, kind "chargeback", "deferred": e.g. a suspension still
  // on) is no longer owed: it goes, so nothing is charged for it after the lift.
  await db.payment.deleteMany({ where: { repaysId: p.id, kind: "chargeback", status: "deferred" } });
  // (§192) A charge of what the bank raised that was declined (owed) is no longer owed either; a change still waiting for a repayment is dropped.
  await db.payment.updateMany({ where: { repaysId: p.id, kind: "chargeback", note: { startsWith: RAISE_NOTE }, settledAt: null, coveredById: null, status: { in: ["failed", "owed"] } }, data: { status: "cancelled", owedUntil: null } });
  await db.appState.deleteMany({ where: { key: PENDING_AMOUNT + p.id } });
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
  // (Batch 11) A payments-kind stop-once line on the developer's test page and Edit (Alerts can ignore it).
  if (c) await (await import("./live")).logEvent(c.testId, "payment", chargebackReversedLine(rev, refunded || rev + CHARGEBACK_FEE_CENTS, refunded > 0, await reversalFor(p)), c.id);
  await notify(dev.email, chargebackWonLine(rev, on), [chargebackWonLine(rev, on)], "/app/payments", { side: "developer", payment: true, group: "payhold" });
  // No chargeback left open: the hold is a payment hold again (it lifts once nothing is owed; the 4th hold on still needs the admin's Approve).
  if (dev.holdStartedAt && dev.holdReason === "chargeback" && !(await db.payment.count({ where: { developerId: dev.id, chargeback: "open" } }))) {
    await db.user.update({ where: { id: dev.id }, data: { holdReason: "unpaid", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
    // (Batch 23 section 6) A payment hold charges at once again: what was reserved for the team's approval is released (nothing taken).
    await (await import("./chargeback")).releaseReservations(dev.id);
  }
  await liftHoldIfClear(dev.id);
  return true;
}

/** (§133) A dispute Stripe has decided (its status): its amount can't change any more. */
const DECIDED = ["won", "lost", "warning_closed", "charge_refunded", "prevented"];

/**
 * (Owner, Nov 3, batch 35 §133) Stripe's `charge.dispute.updated`: a bank can change the disputed amount before the dispute is decided. Before the reversed payment is
 * repaid it is FOLLOWED in what is owed (the owed box redraws, a press from an older page stops once on the new total, the chargeback steps and the admin's row show it).
 * (Owner, Nov 4, §192) AFTER it was repaid it is followed too, settled at once relative to the last followed amount: lowered, the difference is refunded to the
 * developer's card (a partial refund of the PaymentIntent that paid the repayment, never more than is still repaid for that reversal: the fee stays); raised, the
 * difference is charged like a charge made while away (waiting for the lift during a hold). While the repayment is in progress (being charged, waiting for the bank,
 * reserved on the card) the change waits and is settled right after it ends. Not followed (logged for the admins, with an email): the dispute already decided, the
 * chargeback won, or resolved with nothing repaid. Every change is listed in the developer's Chargebacks box (admin console). Returns "same" (nothing to change),
 * "followed", "logged" (not followed, or waiting for the repayment in progress), or "unknown" (no chargeback on that payment yet: the webhook leaves it for Stripe's
 * retry). `eventId`: the Stripe event's id, so a retried webhook never refunds twice (with the developer's row lock, as Pay what you owe's claim takes it).
 */
export async function disputeAmountChanged(paymentIntentId: string, amount: unknown, status: unknown = "", eventId: string | null = null) {
  const cents = disputedCentsOf(amount);
  if (cents == null) return "same" as const;
  const p = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId, chargeback: { in: ["open", "resolved", "won"] } }, orderBy: { createdAt: "asc" } });
  if (!p) return "unknown" as const;
  return followAmount(p.id, cents, typeof status === "string" ? status : "", eventId);
}

/** (§192) A change waiting for the repayment in progress: the newest one per reversed payment (AppState), settled once that repayment ends. */
const PENDING_AMOUNT = "cb-amount-pending:";
type Pending = { cents: number; status: string; event: string | null };

/**
 * (Owner, Nov 4, §192) What paid for a reversal: its repayment and each charge of what the bank raised after it (kind "chargeback", repaysId: the reversed payment)
 * that went through, and what of each is still repaid (its amount less what was refunded of it). `repayment`: the repayment itself (null: not repaid yet).
 */
export async function repaidFor(tx: Prisma.TransactionClient | typeof db, reversalId: string) {
  const sources = await tx.payment.findMany({ where: { repaysId: reversalId, kind: "chargeback", status: { in: ["charged", "not_set_up"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const refunds = sources.length ? await tx.paymentRefund.findMany({ where: { paymentId: { in: sources.map((x) => x.id) }, status: { not: "failed" } } }) : [];
  const left = (id: string) => (sources.find((x) => x.id === id)?.amountCents ?? 0) - refunds.filter((r) => r.paymentId === id).reduce((a, r) => a + r.amountCents, 0);
  return { sources, refunds, left, net: sources.reduce((a, x) => a + left(x.id), 0), repayment: sources.find((x) => !raiseOf(x)) ?? null };
}

type Followed =
  | { out: "same" }
  | { out: "why"; why: string; was: number; next: number }
  | { out: "pending"; why: string; was: number; next: number }
  | { out: "followed"; was: number; next: number }
  | { out: "refund"; was: number; next: number; cents: number; refunds: { id: string }[] }
  | { out: "charge"; was: number; next: number; cents: number; raiseId: string };

/** (§192) Follow (or log) the bank's new amount for one reversed payment, under the developer's row lock. */
async function followAmount(reversalId: string, cents: number, status: string, eventId: string | null) {
  const decided = DECIDED.includes(status);
  const key = PENDING_AMOUNT + reversalId;
  const r = await db.$transaction(async (tx): Promise<Followed & { p: Payment }> => {
    const p0 = await tx.payment.findUniqueOrThrow({ where: { id: reversalId }, select: { developerId: true } });
    // Under the developer's row lock (as Pay what you owe's claim and the reservation take it), so a press starting now can't pay the old amount, and two
    // deliveries of the same change settle it once.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${p0.developerId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: reversalId } });
    // (§192) The last FOLLOWED amount: every change settles relative to it.
    const was = reversedOf(p), next = Math.min(cents, p.amountCents);
    const done = () => tx.appState.deleteMany({ where: { key } });
    if (next === was) { await done(); return { out: "same", p }; }
    if (p.chargeback === "won") { await done(); return { out: "why", why: "the chargeback was already won", was, next, p }; }
    if (decided) { await done(); return { out: "why", why: `the dispute is already decided (${status})`, was, next, p }; }
    const paid = await repaidFor(tx, p.id);
    if (paid.repayment) {
      await done();
      // (§192) Lowered after the repayment: the difference goes back to the card, at most what is still repaid for this reversal less the fee (the fee stays unless
      // the chargeback is won). Refunded from the repayment first, then from each later charge of a raise (oldest first), each refund its own line.
      if (next < was) {
        const back = Math.min(was - next, Math.max(0, paid.net - CHARGEBACK_FEE_CENTS));
        const refunds: { id: string }[] = [];
        const tag = eventId ?? randomUUID();
        let rest = back;
        for (const x of paid.sources) {
          if (rest <= 0) break;
          const take = Math.min(rest, paid.left(x.id));
          if (take <= 0) continue;
          refunds.push(await tx.paymentRefund.create({ data: { paymentId: x.id, reversalId: p.id, developerId: p.developerId, amountCents: take, reason: "lowered", fromCents: was, toCents: next, key: `lowered:${tag}:${x.id}` }, select: { id: true } }));
          rest -= take;
        }
        await tx.payment.update({ where: { id: p.id }, data: { reversedCents: next } });
        return { out: "refund", was, next, cents: back, refunds, p };
      }
      // (§192) Raised after the repayment: the difference is charged like a charge made while away (its own payment, waiting for the lift during a hold).
      const raise = await tx.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: p.developerId, testerId: p.testerId, amountCents: next - was, feeCents: next - was, testerCents: 0, transferStatus: "none", status: "deferred", note: raiseNote(was, next) }, select: { id: true } });
      await tx.payment.update({ where: { id: p.id }, data: { reversedCents: next } });
      return { out: "charge", was, next, cents: next - was, raiseId: raise.id, p };
    }
    // (§192) Being repaid right now (a repayment being charged or waiting for the bank, Pay what you owe's payment holding it, a reservation covering it): the
    // change waits (the newest one) and is settled once that ends: after the repayment when it goes through, in what is owed when it doesn't.
    const repaying = (await tx.payment.count({ where: { repaysId: p.id, kind: "chargeback", NOT: { note: { startsWith: RAISE_NOTE } }, status: { in: ["paying", "needs_action", "needs_confirmation", "deferred"] } } }))
      || (p.coveredById && (await tx.payment.count({ where: { id: p.coveredById, status: { in: ["paying", "needs_action", "needs_confirmation"] } } })));
    const inFlight = repaying ? "it's being repaid right now"
      : (await tx.reservation.count({ where: { developerId: p.developerId, status: { in: ["pending", "needs_action", "reserved"] }, covers: { has: p.id } } })) ? "it's reserved on the developer's card" : "";
    if (inFlight) {
      const value = JSON.stringify({ cents, status, event: eventId } satisfies Pending);
      await tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
      return { out: "pending", why: inFlight, was, next, p };
    }
    await done();
    if (p.chargeback !== "open") return { out: "why", why: "the team already resolved it", was, next, p };
    await tx.payment.update({ where: { id: p.id }, data: { reversedCents: next } });
    return { out: "followed", was, next, p };
  });
  if (r.out === "same") return "same" as const;
  const p = r.p;
  // (Owner, Nov 4, §193b) The team's lines name the part (or a one payment's kind, time and items) as well as the PaymentIntent: "… of the $20.00 payment for Ana
  // Silva's written answers on “Harbor Run” (pi_…) …", "… of the $35.00 Pay what you owe payment on … (…) (pi_…) …".
  const adminNamed = await reversedNaming(p, true, (d) => fmtDateTime(d));
  const of = `of ${paymentWords(p.amountCents, adminNamed.piece, adminNamed.one, "the")} (${p.stripePaymentIntentId ?? "no payment id"})`;
  const head = `Stripe changed the disputed amount ${of} from ${money(r.was)} to ${money(r.next)}`;
  const note = (line: string) => {
    console.info(`[stripe] ${line}`);
    return db.accountEvent.create({ data: { userId: p.developerId, kind: "chargeback-amount", note: line, side: "developer", createdAt: new Date() } }).catch(() => null);
  };
  if (r.out === "why") {
    const line = `${head}: not followed, because ${r.why}. Check it in Stripe.`;
    await note(line);
    await tellAdmins(`Playtest: a chargeback's amount changed (${money(r.was)} to ${money(r.next)})`, line);
    return "logged" as const;
  }
  if (r.out === "pending") {
    // (§192) No email: it settles by itself once the repayment in progress ends.
    await note(`${head}: waiting, because ${r.why}; followed once that ends.`);
    return "logged" as const;
  }
  if (r.out === "followed") {
    await note(`${head}: followed (the developer now owes ${money(r.next)} + ${money(CHARGEBACK_FEE_CENTS)} chargeback fee).`);
    return "followed" as const;
  }
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // (§193b) The developer's bell and email: the part, or a one payment with its items (full names).
  const { piece, one } = await reversedNaming(p, true);
  if (r.out === "refund") {
    const sent = await sendRefunds(r.refunds.map((x) => x.id));
    const ok = sent.filter((x) => x.status !== "failed").reduce((a, x) => a + x.amountCents, 0);
    const failed = sent.filter((x) => x.status === "failed");
    const failedCents = failed.reduce((a, x) => a + x.amountCents, 0);
    await note(`${head}: followed after repayment: ${r.cents === 0 ? "nothing left to refund (only the chargeback fee is still repaid)" : `refunded ${money(r.cents)}`}${failedCents ? ` (refunding ${money(failedCents)} failed: check it in Stripe)` : ""}.`);
    if (failedCents) await tellAdmins(`Playtest: a chargeback refund failed (${money(failedCents)})`, `Refunding ${money(failedCents)} to the developer failed (${failed.map((x) => x.why).filter(Boolean).join("; ") || "no answer from Stripe"}): Stripe changed the disputed amount ${of} from ${money(r.was)} to ${money(r.next)} after it was repaid. Refund it in Stripe.`);
    if (ok > 0) {
      const line = bankLoweredLine(p.amountCents, piece, ok, one);
      const recorded = sent.every((x) => x.status !== "refunded");
      await notify(dev.email, line, [line, ...(recorded ? ["Payments aren't set up yet, so this was recorded and nothing was refunded."] : [])], "/app/payments", { side: "developer", payment: true });
    }
    return "followed" as const;
  }
  await note(`${head}: followed after repayment: charged ${money(r.cents)} more.`);
  const line = bankRaisedLine(p.amountCents, piece, r.cents, one);
  await notify(dev.email, line, [line], "/app/payments", { side: "developer", payment: true });
  // Charged now like any charge made while away (during a hold, a suspension or the team's pause of its test it waits, as they do).
  await chargeDeferred(p.developerId);
  return "followed" as const;
}

/** (§192) An email to every admin, whatever their email setting (as the chargeback's own). */
export async function tellAdmins(subject: string, line: string) {
  const to = new Set([...admins(), ...(await adminUsers()).map((a) => a.email)]);
  for (const a of to) await sendEmail({ to: a, subject, text: [line, `${appUrl()}/admin#chargebacks`, "", "Playtest"].join("\n"), button: { label: "Open the admin console", url: `${appUrl()}/admin#chargebacks` } }).catch((e) => console.error("[email] chargeback amount:", e.message));
}

/**
 * (§192) Make the refunds recorded as "pending" at Stripe: a partial refund of the PaymentIntent that paid each one's payment, for exactly its amount (one key per
 * refund: asked again, Stripe answers with the first one). No PaymentIntent (payments not set up): "recorded". Stripe refusing: "failed" (the caller emails the admins).
 */
export async function sendRefunds(ids: string[]) {
  const out: { id: string; amountCents: number; status: string; why: string }[] = [];
  for (const id of ids) {
    const r = await db.paymentRefund.findUnique({ where: { id } });
    if (!r) continue;
    if (r.status !== "pending") { out.push({ id, amountCents: r.amountCents, status: r.status, why: "" }); continue; }
    const src = await db.payment.findUnique({ where: { id: r.paymentId }, select: { stripePaymentIntentId: true } });
    let status = "recorded", why = "", refundId: string | null = null;
    if (src?.stripePaymentIntentId) {
      try {
        if (!stripeOn()) throw new Error("Payments aren't set up.");
        refundId = (await getStripe().refunds.create({ payment_intent: src.stripePaymentIntentId, amount: r.amountCents, metadata: { purpose: `chargeback-${r.reason}`, refundId: r.id } }, { idempotencyKey: serverKey("cbamt", r.id) })).id;
        status = "refunded";
      } catch (e) {
        status = "failed";
        why = (e as Error).message;
        console.error("[stripe] chargeback refund:", why);
      }
    }
    await db.paymentRefund.updateMany({ where: { id, status: "pending" }, data: { status, stripeRefundId: refundId } });
    out.push({ id, amountCents: r.amountCents, status, why });
  }
  return out;
}

/**
 * (Owner, Nov 4, §192) A change that waited for a repayment in progress is settled now that it ended (called when a repayment is recorded, when Pay what you owe's
 * payment holding the reversed payment ends, and by the daily job): after the repayment when it went through, in what is owed when it didn't.
 */
export async function followPendingAmount(reversalId: string) {
  const row = await db.appState.findUnique({ where: { key: PENDING_AMOUNT + reversalId } });
  if (!row) return null;
  let v: Pending | null = null;
  try { v = JSON.parse(row.value) as Pending; } catch { v = null; }
  if (!v || typeof v.cents !== "number") {
    await db.appState.deleteMany({ where: { key: row.key, value: row.value } });
    return null;
  }
  return followAmount(reversalId, v.cents, v.status ?? "", v.event ?? null);
}
/** (§192) The same, never failing its caller (a repayment being recorded): a problem is logged and the daily job tries it again. */
export const followPendingSafely = (reversalId: string | null | undefined) =>
  reversalId ? followPendingAmount(reversalId).catch((e) => { console.error("[stripe] pending dispute amount:", (e as Error).message); return null; }) : Promise.resolve(null);

/** (§192) The daily job: changes still waiting (a reservation that lapsed, a check cancelled), and refunds left "pending" by a run that stopped before Stripe answered. */
async function settleDisputeAmounts(now: Date) {
  for (const s of await db.appState.findMany({ where: { key: { startsWith: PENDING_AMOUNT } }, take: 200 })) await followPendingSafely(s.key.slice(PENDING_AMOUNT.length));
  const stale = await db.paymentRefund.findMany({ where: { status: "pending", reason: "lowered", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true }, take: 200 });
  for (const r of await sendRefunds(stale.map((x) => x.id))) if (r.status === "failed") await tellAdmins(`Playtest: a chargeback refund failed (${money(r.amountCents)})`, `Refunding ${money(r.amountCents)} to the developer failed (${r.why || "no answer from Stripe"}). Refund it in Stripe.`);
}

/** (Batch 16 section 41) Pay what you owe during a chargeback hold before the card is verified. */
export const VERIFY_FIRST = "Verify your card first.";

/**
 * (Owner, Oct 28, batch 19 section 4) The time-sensitive sweep: what page loads and polls trigger for calls and timers, run every 5 minutes by the uptime check's keyed
 * GET /api/health (UptimeRobot) and by the daily job: the 15-minute call reminders, calls ending at the $1,000, nobody-joined cancels and final call lengths, Charge
 * opening (sent parts and listed calls, with their daily "pay it" and Charge reminders), the close-out reminders, the developer's review reminders and the rating
 * reminders. Each step records what it did, so a second run sends nothing twice; the caller holds the timers lock (withTimersLock), so two never run at once.
 */
export async function runSweep(now = new Date(), co = closeOutMemo(now)) {
  await (await import("./workWindow")).closeWorkAfterDeadlines(now);
  // (Batch 23 section 1) Emails that failed are tried again when due (first: a later step's error never holds them up). (Batch 23 section 6) Reservations past their
  // days are released.
  // (Batch 26 section 1) The app's own heartbeat first (wall-clock time, never a test's `now`): a gap of 15 minutes or more since the last sweep is an outage.
  await (await import("./outages")).sweepGap().catch((e) => console.error("[outage] heartbeat:", (e as Error).message));
  await (await import("./email")).retryEmails(now).catch((e) => console.error("[email] retry:", (e as Error).message));
  await (await import("./chargeback")).expireReservations(now).catch((e) => console.error("[reserve] expire:", (e as Error).message));
  // (§160) Bank checks of the developer's own presses whose page went away (no heartbeat for 3 minutes): ended like Cancel.
  await (await import("./bankHeartbeat")).endAllStaleChecks(now).catch((e) => console.error("[bank check] sweep:", (e as Error).message));
  await (await import("./calls")).sweepNobodyJoined(now);
  if (stripeOn()) await (await import("./stripe")).cardExpiryReminders(now).catch((e) => console.error("[card expiry]", (e as Error).message));
  await chargeReadyDeferred();
  // (Owner, Nov 4, §192) A bank's amount change that waited for a repayment in progress (a reservation that lapsed, a check cancelled), and a refund left half-made.
  await settleDisputeAmounts(now).catch((e) => console.error("[stripe] dispute amounts:", (e as Error).message));
  const choices = (await openCharges(now, co)) + (await autoChargeCalls(now));
  // (Batch 29 §22, §31) The one-a-day money lines across tests: the tester's "Charge or let go", the developer's "Pay now".
  await testerChargeLines(now, co);
  await payNowLines(now, co);
  await closeOutReminders(now, co);
  await reviewReminders(now, co);
  await (await import("./ratings")).ratingReminders(now);
  // (Batch 32 §1) Money waiting for payout setup: told within 5 minutes of a share starting to wait (then every 3 days: the line's own key decides).
  await (await import("./restrictions")).payoutWaitReminders(now).catch((e) => console.error("[payouts] waiting line:", (e as Error).message));
  return { choices };
}

/** The daily job: auto-pay after the review window, closing tests paused for 7 days, the paused reminders, Open until heads-ups and each tester's own deadline reminders. (No retries and no owed window any more: a declined payment is a hold at once.) */
export async function runDaily(now = new Date()) {
  // (Batch 19 section 4) Under the timers lock, so a 5-minute sweep never runs at the same moment (it waits for one that is running).
  return (await withTimersLock(() => runDailyLocked(now), { waitMs: 60_000 })) ?? runDailyLocked(now);
}

async function runDailyLocked(now: Date) {
  await (await import("./workWindow")).closeWorkAfterDeadlines(now);
  const out = { autoPaid: 0, holds: 0, alerts: 0, headsUps: 0, choices: 0, closed: 0 };
  // (Batch 17 §19) Each piece's closing dates (the developer's Pay, the tester's Charge), looked up once per run.
  const co = closeOutMemo(now);
  await (await import("./email")).retryEmails(now).catch((e) => console.error("[email] retry:", (e as Error).message)); // (batch 23 section 1)
  await (await import("./chargeback")).expireReservations(now).catch((e) => console.error("[reserve] expire:", (e as Error).message)); // (batch 23 section 6)
  await (await import("./calls")).sweepNobodyJoined(now);
  // (Batch 11) Bank confirmations that timed out. (Owner, Nov 3, batch 35 §145, §148) No retries of what is owed during a hold: it's charged only when the
  // developer presses Pay what you owe (never daily, never on a new card).
  await (await import("./confirm")).expireActions(now);
  await chargeReadyDeferred();
  await settleDisputeAmounts(now).catch((e) => console.error("[stripe] dispute amounts:", (e as Error).message)); // (§192)
  // 1. Sent work past its review window: Charge / Let it go opens (batch 19 section 4: also every 5 minutes, runSweep).
  out.choices += await openCharges(now, co);
  // 1b. (Owner, Oct 29, batch 28 §21) A LISTED call not paid 7 days after it is charged automatically (rate × measured minutes, within the $1,000 for calls).
  out.choices += await autoChargeCalls(now);
  // 1c. (Batch 29 §22, §31) The tester's one daily "Charge or let go" line, the developer's one daily "Pay now" line, and the developer's closing-soon countdown.
  await testerChargeLines(now, co);
  await payNowLines(now, co);
  await closeOutReminders(now, co);
  // 3a. (Owner, Oct 27) ONE daily email per admin that can't be turned off, sent only when it has something in it (see adminDaily.ts).
  out.alerts = await (await import("./adminDaily")).adminDailyEmails(now);
  // 3c. (Owner, Oct 26) Paused tests close after 7 days, whatever the cause (the admin can extend a test's date or close it sooner).
  const pc = await import("./pauseClosure");
  await pc.pausedReminders(now); // (Owner, Oct 27) the developer's daily "<test> is paused and closes on <date> unless ..." (replaces the paused / day-before lines)
  out.closed = await pc.closePausedTests(now);
  // 4. Open until heads-ups for the developer: 1 month (when it was more than a month away), 1 week, 3 days and 1 day before.
  const closing = await db.test.findMany({ where: { status: { in: ["open", "closed"] }, openUntil: { gt: now }, ...PAUSE_FREE } });
  for (const t of closing) {
    const m = countdownDue(t.openUntil, now, t.notifiedMarks, t.createdAt);
    if (!m) continue;
    // Bell notifications only, never emailed. (Batch 15 sections 11 and 18) The reader's own zone; Open until is the last day to join.
    await bell(t.developerId, joinClosingLine(t.title, t.openUntil!, (d) => T(d, "date")), `/app/tests/${t.id}`, undefined, { reminder: `headsup:${t.id}` });
    await db.test.update({ where: { id: t.id }, data: { notifiedMarks: { push: m.mark }, ...(m.mark === "1d" ? { notified1d: true, notified3d: true } : m.mark === "3d" ? { notified3d: true } : {}) } });
    out.headsUps++;
  }
  // 4b. (Owner, Oct 28, batch 16 section 1) Each working tester's own reminders, counted to THEIR deadline: 1 month, 1 week, 3 days and 1 day before (only the marks
  // still ahead when they joined). Sent marks are kept per tester and per deadline; they wait while the test is paused or the tester is suspended. (Owner, Oct 29,
  // batch 29 §27, §34) They stack in one "Deadlines" entry a day across tests, and all of them go in the end-of-day email whatever the email setting.
  const working = await db.contract.findMany({
    where: { status: "working", dueAt: { gt: now }, tester: { deletedAt: null, testerSuspendedAt: null }, test: { status: { in: ["open", "closed"] }, ...PAUSE_FREE } },
    select: { id: true, testerId: true, joinedAt: true, dueAt: true, test: { select: { id: true, title: true, notifiedMarks: true } } },
    take: 5000,
  });
  for (const c of working) {
    const due = ownDeadlineMarkDue(c, c.test.notifiedMarks, now);
    if (due.send) {
      await bell(c.testerId, ownDeadlineLine(c.test.title, c.dueAt, (d) => T(d, "date")), `/app/sessions/${c.id}`, undefined, { reminder: `headsup:${c.test.id}`, group: "deadlines", always: true, testId: c.test.id });
      out.headsUps++;
    }
    if (due.record.length) await db.test.update({ where: { id: c.test.id }, data: { notifiedMarks: { push: due.record } } });
  }
  // 5, 5b. The developer's review reminders (batch 19 section 4: also every 5 minutes, runSweep).
  await reviewReminders(now, co);
  // 5c. (Batch 15 sections 15 and 40) Calls that aren't listed: never charged; ONE weekly "Pay your calls" line per developer, stacked across tests, until each is paid ($0 counts).
  await payYourCalls(now, co);
  // (Batch 15 section 18) Open until passed: pending applications and open invites close.
  await (await import("./tests")).closeJoiningAfterOpenUntil(now);
  // 7. (Owner, Oct 26) Invites: a bell reminder DAILY until the tester joins, says "No thanks", or the invite expires (all of a day's stack into one line across tests).
  const invites = await db.invite.findMany({ where: { status: "sent", createdAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) } }] }, include: { test: { include: { developer: true } } }, take: 500 });
  for (const i of invites) {
    const testersIn = await db.contract.count({ where: { testId: i.testId, status: "working" } });
    if (i.test.status !== "open" || testersIn >= i.test.spots || (i.test.openUntil && i.test.openUntil < now)) continue; // expired
    if (i.test.adminPausedAt || i.test.developer.holdStartedAt || i.test.developer.devSuspendedAt) continue; // paused: the reminders wait
    await bell(i.testerId, `Reminder: ${displayName(i.test.developer)} invited you to “${i.test.title}”.`, `/app/find/${i.testId}`, undefined, { group: "invites", reminder: `invite:${i.id}` });
    await db.invite.update({ where: { id: i.id }, data: { remindedAt: now } });
  }
  // 8. (NEXT-UI 7) Forever sets of calls: the next ones are booked as each passes (4 ahead); ended sets are marked.
  await (await import("./requests")).topUpForeverSets(now);
  // 9. (Design doc 11.4, 9, 10; owner, Oct 27) A suspended or held developer's later calls (cancelled 3 days before they start while it lasts); the payout-problem reminder every 3 days; the daily reminder to review suspended accounts.
  const rs = await import("./restrictions");
  await rs.cancelLatePauseCalls(now);
  await rs.payoutReminders(now);
  await rs.suspendedAccountsReminder(now);
  // (Batch 28 §17) Shares still waiting for a tester whose payout setup is done (a transfer that failed earlier) are sent again, from their own charge.
  await (await import("./stripe")).resendWaitingShares().catch((e) => console.error("[payouts] resend:", (e as Error).message));
  // (Batch 8) Subscription renewals (manual billing) and the free-during-launch notices.
  const subs = await import("./subscription");
  await subs.renewSubscriptions(now);
  await subs.freeLaunchNotices(now);
  // 10. (Owner, Oct 26) The reminders that need their own rules, then the emails last (one email lists everything new; payment lines also go out end of day).
  await dailyReminders(now);
  await (await import("./ratings")).ratingReminders(now);
  // (Batch 15 section 9) Payments stuck "in progress" for over 15 minutes are finished or cleared.
  await (await import("./recovery")).checkStuck({}, now);
  // (Batch 15 section 41, M6) Uploads that never finished, and stored files with no row, are deleted.
  await (await import("./recordings")).purgeUploads(now).catch((e) => console.error("[purge]", (e as Error).message));
  // (Batch 15 section 7) Sign-in attempts older than a day are deleted.
  await (await import("./passwords")).cleanLoginAttempts(now);
  // (Batch 30 §35) Storage running out: the database's and the uploads' sizes against their limits (a failure never stops the rest of the job).
  await (await import("./storageAlerts")).checkStorage(now).catch((e) => console.error("[storage]", (e as Error).message));
  await sendSummaries(now);
  return out;
}

/** Every case that needs the team: the admin page shows this list, and the daily digest emails it. */
export async function adminCases(now = new Date(), forDigest = false) {
  const [disputes, noShows, chargebacks, holds, payouts] = await Promise.all([
    db.dispute.findMany({ where: { status: "open" }, include: { submission: { include: { review: true } } } }),
    db.call.findMany({ where: forDigest ? { noShowBy: { not: null }, noShowDigestedAt: null } : { noShowBy: { not: null }, noShowAt: { gt: new Date(now.getTime() - 14 * 86_400_000) } }, include: { contract: true } }),
    db.payment.findMany({ where: { chargeback: "open" } }),
    db.user.findMany({ where: { holdStartedAt: { not: null } } }),
    db.payment.findMany({ where: { OR: [{ transferStatus: "waiting" }, { status: "failed", settledAt: null, owedUntil: { not: null } }] } }),
  ]);
  return [
    ...disputes.map((d) => ({ kind: "dispute", text: `Dispute: “${d.reason}”`, link: "/admin#disputes" })),
    ...noShows.map((c) => ({ kind: "no-show", text: `No-show report on “${c.contract.title}” (${fmtDateTime(c.startsAt)}), by the ${c.noShowBy}`, link: "/admin#no-shows" })),
    // (§133) What the bank reversed: "Open chargeback: $96.00 of a $444.67 payment" when it was part of the payment.
    ...chargebacks.map((p) => ({ kind: "chargeback", text: `Open chargeback: ${money(reversedOf(p))}${reversedPart(p) ? ` of a ${money(p.amountCents)} payment` : ""}`, link: "/admin#chargebacks" })),
    ...holds.map((u) => ({ kind: "hold", text: `${u.email} on a ${u.holdReason === "chargeback" ? "chargeback" : "payment"} hold since ${fmtDate(u.holdStartedAt!)}`, link: u.holdReason === "chargeback" ? "/admin#chargebacks" : `/app/developers/${u.id}` })),
    ...payouts.map((p) => ({ kind: "payout", text: p.transferStatus === "waiting" ? `Payout waiting for a payout account: ${money(p.testerCents)}` : `Failed charge still owed: ${money(p.amountCents)}`, link: "/admin#payouts" })),
  ];
}

/** For the "Pay what you owe" box: failed charges and reversed payments. */
export async function owedForBox(devId: string) {
  // (Owner, Nov 5, §270) Every person and test a line (or a line of what it covered) names is its own green link.
  const [lines, { linkPool, lineLinks }] = await Promise.all([owedLines(devId), import("./lineLinks")]);
  if (!lines.length) return lines;
  const pool = await linkPool(devId);
  return lines.map((o) => ({ ...o, links: lineLinks(pool, o.full ?? o.text), ...("covers" in o && o.covers ? { covers: o.covers.map((x) => ({ ...x, links: lineLinks(pool, x.full || x.text) })) } : {}) }));
}

/** 1. Sent work not paid within the review window (REVIEW_DAYS, 7): the developer's daily "pay it", Charge / Let it go opening for the tester, and its reminders. */
async function openCharges(now: Date, co: CloseOuts) {
  let n = 0;
  const due = await db.submission.findMany({
    // (Owner, Oct 29, batch 11) A deleted tester's sent work is still reviewed (and reminded) when their payout account was connected; Charge never opens for it.
    where: { review: null, payBy: { lt: now }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
    orderBy: { payBy: "asc" },
    take: 1000,
  });
  for (const s of due) {
    const c = s.contract;
    const auto = autoPayFor(s.agreedCents);
    if (auto == null) continue; // outside the contract: its own reminder every 3 days (below)
    // (Batch 30 §3) Sent after the tester's own deadline: never Charge or Let it go, no daily line (the review reminders stopped at its review date). Only the
    // developer's own Pay settles it, or it closes unpaid at its closing date.
    if (s.late) continue;
    // (Owner, Oct 26; batch 15 section 18) Charge / Let it go opens only when REVIEW_DAYS (7) have passed since it was sent AND the tester's own deadline has passed.
    if (!chargeIsOpen(s, c.test, c, now)) continue;
    // (Batch 17 §19) Once the piece's Pay closed there's no "pay it" line; once its Charge closed (the tester's side) Charge is never offered or reminded.
    const payShut = await co.payClosed({ submissionId: s.id }), chargeShut = await co.chargeClosed({ submissionId: s.id });
    if (payShut && chargeShut) continue;
    // (Owner, Oct 29, batch 29 §31) While the tester can charge or let it go, the developer's daily line is ONE "Pay now" line across all their tests (payNowLines).
    // With no Charge for the tester (a deleted tester, or their Charge closed) the piece keeps its own daily "… wasn't reviewed by <date>: pay it." (batch 28).
    const gone = !!c.tester.deletedAt;
    if (!payShut && (gone || chargeShut) && (!s.devRemindedAt || now.getTime() - s.devRemindedAt.getTime() >= 23 * 3_600_000)) {
      const line = unreviewedLine(c.title, displayName(c.tester), s.kind === "recording" ? "recording" : "written answers", chargeOpensAt(s, c.test, c, now)!, null, c.tester.pronoun);
      await bell(c.test.developerId, line, `/app/tests/${c.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
      await db.submission.update({ where: { id: s.id }, data: { devRemindedAt: now } });
    }
    if (gone || chargeShut) continue; // the tester can't sign in: Charge and Let it go never open (or, batch 17 §19, they closed)
    // Contract price already paid in full for this part: no Charge / Let it go, no day-14 notice, no reminders. (Owner, Nov 3, batch 35 §163) Likewise once the
    // developer paid anything on it (chargeAmount): the tester's way to more is Dispute.
    const paidPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    if (chargeAmount(s.agreedCents, paidPart) === 0) continue;
    if (!s.choiceOfferedAt) {
      const by = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
      await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: now, choiceBy: by, remindedAt: now } });
      // (Owner, Oct 29, batch 29 §22) No line of its own: the tester's ONE daily "Charge or let go" line (testerChargeLines) starts today.
      await db.$transaction((tx) => recordEvent(tx, c.testId, "choice", `${displayName(c.tester)} can now charge or let go of ${pronouns(c.tester.pronoun).poss} ${s.kind === "recording" ? "recording" : "written answers"}`, false, {}, c.id, "", `part-${s.id}`));
      await (await import("./ratings")).maybePromptRating(c.id);
      n++;
      continue;
    }
  }
  return n;
}

/**
 * 5. (Owner, Oct 30, batch 15 section 2) The developer's review reminders, the SAME for listed and unlisted parts, counting to the review date (the later of the
 * tester's deadline and sent + 7 days): 1 month (if it was more than a month away), 3, 2 and 1 weeks, 3 days, 1 day. After it, a listed part opens Charge (openCharges);
 * an unlisted part's reminders just stop (its Needs you row stays until it's paid, $0 included). 5b. Listed calls the same.
 */
async function reviewReminders(now: Date, co: CloseOuts) {
  const upcoming = await db.submission.findMany({ where: { review: null, choiceOfferedAt: null, payBy: { not: null }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: true } } }, orderBy: { payBy: "asc" }, take: 2000 });
  for (const s of upcoming) {
    const reviewDate = chargeOpensAt(s, s.contract.test, s.contract, now);
    const m = reviewDate ? reviewMarkDue(s.updatedAt, reviewDate, now, s.devMarks) : null;
    if (!m || (await co.payClosed({ submissionId: s.id }))) continue; // (batch 17 §19) Pay closed: no reminders
    const name = displayName(s.contract.tester);
    const part = s.kind === "recording" ? "recording" : "written answers";
    const when = m.label === "tomorrow" ? "by tomorrow" : m.label.replace("in ", "within ");
    // (Batch 30 §3) Late listed work counts down the same way, but the tester can't charge for it.
    const after = s.agreedCents == null ? " (it isn't listed: any amount, $0 included)" : s.late ? LATE_REMINDER_TAIL : s.contract.tester.deletedAt ? "" : ` (after that ${name} can charge or let it go)`;
    await bell(s.contract.test.developerId, `“${s.contract.title}”: review ${name}'s ${part} ${when}${after}.`, `/app/tests/${s.contract.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
    // The mark is recorded with every earlier one, so a missed mark is never sent late.
    const earlier = reviewMarksFor(s.updatedAt, reviewDate!).filter((x) => x.at.getTime() <= m.at.getTime()).map((x) => x.mark).filter((x) => !s.devMarks.includes(x));
    await db.submission.update({ where: { id: s.id }, data: { devMarks: { push: earlier } } });
  }
  // 5b. (Owner, Oct 29, batch 28 §21) Listed calls: "pay it within 3 days / by tomorrow" before the automatic charge (7 days after the call, moved by pauses and outages).
  const upcomingCalls = await db.call.findMany({ where: { review: null, status: "booked", rateCents: { not: null }, payBy: { not: null }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: true } } }, take: 2000 });
  for (const x of upcomingCalls) {
    const chargeAt = x.payBy!;
    const sent = x.measuredAt ?? x.startsAt;
    const m = callMinutesOf(x) ? reviewMarkDue(sent, chargeAt, now, x.devMarks) : null;
    if (!m) continue;
    const earlier = reviewMarksFor(sent, chargeAt).filter((y) => y.at.getTime() <= m.at.getTime()).map((y) => y.mark).filter((y) => !x.devMarks.includes(y));
    await db.call.update({ where: { id: x.id }, data: { devMarks: { push: earlier } } });
    if (m.label !== "tomorrow" && m.label !== "in 3 days") continue; // only the 3-day and 1-day marks
    const when = m.label === "tomorrow" ? "by tomorrow" : "within 3 days";
    await bell(x.contract.test.developerId, `“${x.contract.title}”: pay ${displayName(x.contract.tester)}'s call on ${T(x.startsAt)} ${when}.`, `/app/tests/${x.contract.testId}#call-${x.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${x.id}` });
  }
}

/** (Batch 17 §19) Each piece's closing date for the developer's Pay and for the tester's Charge (pieceCloseOut), looked up once per daily run. */
function closeOutMemo(now: Date) {
  type Piece = { submissionId?: string; callId?: string };
  const seen = new Map<string, Promise<Date | null>>();
  const at = (k: Piece, side: "tester" | "developer") => {
    const key = `${side}:${k.submissionId ?? k.callId}`;
    return seen.get(key) ?? seen.set(key, pieceCloseOut(k, side, now)).get(key)!;
  };
  return { at, payClosed: async (k: Piece) => closedOut(await at(k, "developer"), now), chargeClosed: async (k: Piece) => closedOut(await at(k, "tester"), now) };
}
type CloseOuts = ReturnType<typeof closeOutMemo>;
/** (Batch 17 §19) The reminder mark due before a closing date: 3 (days) once within 3 days, 1 once within a day; none before, or once it passed. */
export function closeOutMark(at: Date | null, now: Date) {
  if (!at || at.getTime() <= now.getTime()) return null;
  const left = at.getTime() - now.getTime();
  return [...CLOSE_OUT_REMINDER_DAYS].sort((a, b) => a - b).find((d) => left <= d * 86_400_000) ?? null;
}

/** (Owner, Oct 29, batch 29 §22) The developer's closing-soon countdown: 1 month (only when the closing date was more than a month away when the piece's Charge opened), 1 week, 3 days and 1 day before. */
export const CLOSE_SOON_MARKS = [30, 7, 3, 1] as const;
const dayNo = (d: Date) => Math.floor(d.getTime() / 86_400_000);
/**
 * (Batch 29 §22) The mark a piece reaches TODAY (by calendar day, so one daily line covers every piece reaching a mark that day), or null. Only the marks still ahead
 * when the piece's Charge opened (`from`); the month only when the closing date was more than a month away then; each mark once per piece (`sent`), so a closing
 * date moved by a pause or an outage never sends the same mark twice, and a mark that passed unsent isn't sent late.
 */
export function closeSoonMarkDue(at: Date | null, from: Date, now: Date, sent: string[]): number | null {
  if (!at || at.getTime() <= now.getTime()) return null;
  const left = dayNo(at) - dayNo(now);
  const m = CLOSE_SOON_MARKS.find((d) => d === left);
  if (!m || sent.includes(`co:${m}`)) return null;
  if (dayNo(at) - m < dayNo(from)) return null; // already behind when Charge opened
  if (m === 30 && at.getTime() - from.getTime() <= 30 * 86_400_000) return null;
  return m;
}
/**
 * (Batch 29 §22) "Closing soon: Ana's written answers on “Harbor Run” close on Nov 18" for one piece; "Closing soon: 2 pieces close by Nov 18 (Ana's written answers on
 * “Harbor Run”, Ben's recording on “Sky Lab”)" for several (the latest closing date; at most 5 named, then "and N more").
 */
export function closingSoonLine(pieces: { who: string; part: string; title: string; at: Date }[]) {
  const name = (p: { who: string; part: string; title: string }) => `${p.who}'s ${p.part} on “${p.title}”`;
  if (pieces.length === 1) return `Closing soon: ${name(pieces[0])} ${pieces[0].part.endsWith("s") ? "close" : "closes"} on ${T(pieces[0].at, "date")}`;
  const last = new Date(Math.max(...pieces.map((p) => p.at.getTime())));
  const shown = pieces.slice(0, 5).map(name);
  return `Closing soon: ${pieces.length} pieces close by ${T(last, "date")} (${shown.join(", ")}${pieces.length > 5 ? `, and ${pieces.length - 5} more` : ""})`;
}
/** A tester's first name, as the money lines name them ("Ana's written answers"). */
const firstName = (u: { name?: string | null; email: string; deletedAt?: Date | null }) => displayName(u).split(/\s+/)[0];

/**
 * (Batch 17 §19; owner, Oct 29, batch 29 §22) The developer's closing-soon reminders, counted to each unpaid piece's own closing date (pieceCloseOut) on the countdown
 * schedule (closeSoonMarkDue): ONE line a day across all their tests covering every piece reaching a mark that day, opening Needs you on the dashboard. Money lines: in
 * the bell and the end-of-day email whatever the setting (`always`), stacked in "Closing soon". A piece reaching a mark later the same day joins that day's line (it is
 * updated in place). They wait while the test is paused (the closing dates move on meanwhile). The tester's side is their one daily "Charge or let go" line
 * (testerChargeLines). Kept alongside "Pay now" (payNowLines).
 */
async function closeOutReminders(now: Date, co: CloseOuts) {
  const held = { review: null, status: "booked", startsAt: { lte: now } };
  const contracts = await db.contract.findMany({
    where: { test: { status: { not: "draft" }, ...PAUSE_FREE }, OR: [{ submissions: { some: { review: null } } }, { calls: { some: held } }] },
    include: { tester: true, test: { include: { developer: true } }, submissions: { where: { review: null } }, calls: { where: held } },
    take: 5000,
  });
  type Piece = { who: string; part: string; title: string; at: Date };
  const byDev = new Map<string, { email: string; today: Piece[]; fresh: boolean }>();
  for (const c of contracts) {
    // Anything of this tester's still unpaid (a deleted tester's only when their payout account was connected).
    if (!testerPayable(c.tester)) continue;
    const pieces = [
      ...c.submissions.map((s) => ({ k: { submissionId: s.id }, id: s.id, sub: true, part: s.kind === "recording" ? "recording" : "written answers", from: s.choiceOfferedAt ?? s.payBy ?? s.updatedAt, sent: s.devMarks })),
      ...c.calls.filter((x) => callMinutesOf(x) != null).map((x) => ({ k: { callId: x.id }, id: x.id, sub: false, part: "call", from: x.choiceOfferedAt ?? x.payBy ?? x.startsAt, sent: x.devMarks })),
    ];
    for (const p of pieces) {
      const at = await co.at(p.k, "developer");
      if (!at || at.getTime() <= now.getTime()) continue;
      const mark = closeSoonMarkDue(at, p.from, now, p.sent);
      // Already sent today (its mark is today's): it stays in today's line when that line is drawn again.
      const today = !mark && CLOSE_SOON_MARKS.some((d) => d === dayNo(at) - dayNo(now) && p.sent.includes(`co:${d}`));
      if (!mark && !today) continue;
      const entry = byDev.get(c.test.developerId) ?? { email: c.test.developer.email, today: [], fresh: false };
      entry.today.push({ who: firstName(c.tester), part: p.part, title: c.title, at });
      if (mark) {
        entry.fresh = true;
        if (p.sub) await db.submission.update({ where: { id: p.id }, data: { devMarks: { push: `co:${mark}` } } });
        else await db.call.update({ where: { id: p.id }, data: { devMarks: { push: `co:${mark}` } } });
      }
      byDev.set(c.test.developerId, entry);
    }
  }
  for (const [devId, e] of byDev) {
    if (!e.fresh) continue;
    const line = closingSoonLine(e.today.sort((a, b) => a.at.getTime() - b.at.getTime()));
    const key = `closesoon:${now.toISOString().slice(0, 10)}`;
    const had = await db.notification.findFirst({ where: { userId: devId, reminderKey: key }, select: { id: true, summarizedAt: true } });
    if (had && !had.summarizedAt) await db.notification.update({ where: { id: had.id }, data: { text: await renderFor(devId, line), readAt: null } });
    else await notify(e.email, line, [line + "."], "/app#needs-review", { side: "developer", always: true, payment: true, group: "closeout", reminder: key }); // (batch 30 §6) where the pieces are: Needs review, marked
  }
}

/** A piece as the daily money lines name it ("Ana's written answers on “Harbor Run”"). */
type OpenPiece = { id: string; who: string; part: string; title: string; testId: string; cents: number; closes: Date | null };
const firstClose = (list: OpenPiece[]) => list.map((p) => p.closes).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
/** (Owner, Oct 29, batch 29 §31) "Pay now: Ana's written answers on “Harbor Run” ($10.00): Ana can charge or let it go (until Nov 18)" / "Pay now: 3 pieces on 2 tests: their testers can charge or let them go (the first closes Nov 18)". */
export function payNowLine(list: OpenPiece[]) {
  if (list.length === 1) {
    const p = list[0];
    return `Pay now: ${p.who}'s ${p.part} on “${p.title}” (${money(p.cents)}): ${p.who} can charge or let it go${p.closes ? ` (until ${T(p.closes, "date")})` : ""}`;
  }
  const tests = new Set(list.map((p) => p.testId));
  const first = firstClose(list);
  return `Pay now: ${list.length} pieces on ${tests.size === 1 ? `“${list[0].title}”` : `${tests.size} tests`}: their testers can charge or let them go${first ? ` (the first closes ${T(first, "date")})` : ""}`;
}
/** (Owner, Oct 29, batch 29 §22) "Charge or let go: your written answers on “Harbor Run” ($10.00, by Nov 18)" / "Charge or let go: 3 pieces on 2 tests (the first closes Nov 18)". */
export function chargeDayLine(list: OpenPiece[]) {
  if (list.length === 1) {
    const p = list[0];
    return `Charge or let go: your ${p.part} on “${p.title}” (${money(p.cents)}${p.closes ? `, by ${T(p.closes, "date")}` : ""})`;
  }
  const tests = new Set(list.map((p) => p.testId));
  const first = firstClose(list);
  return `Charge or let go: ${list.length} pieces on ${tests.size === 1 ? `“${list[0].title}”` : `${tests.size} tests`}${first ? ` (the first closes ${T(first, "date")})` : ""}`;
}

/** Listed parts past their review date, still unpaid and open to the tester's Charge (Charge opened, something left to charge, the tester's Charge not closed). */
async function chargeablePieces(co: CloseOuts, where: Prisma.SubmissionWhereInput) {
  const subs = await db.submission.findMany({
    where: { review: null, choiceOfferedAt: { not: null }, agreedCents: { not: null }, late: false, ...where }, // (batch 30 §3) never late work
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
    orderBy: { choiceOfferedAt: "asc" },
    take: 5000,
  });
  const out: (OpenPiece & { devId: string; devEmail: string; testerId: string; testerEmail: string; testerSuspended: boolean })[] = [];
  for (const s of subs) {
    const c = s.contract;
    if (c.tester.deletedAt || (await co.chargeClosed({ submissionId: s.id }))) continue;
    const paid = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    const cents = chargeAmount(s.agreedCents, paid);
    if (cents <= 0) continue;
    out.push({ id: s.id, who: firstName(c.tester), part: s.kind === "recording" ? "recording" : "written answers", title: c.title, testId: c.testId, cents, closes: await co.at({ submissionId: s.id }, "tester"), devId: c.test.developerId, devEmail: c.test.developer.email, testerId: c.testerId, testerEmail: c.tester.email, testerSuspended: !!c.tester.testerSuspendedAt });
  }
  return out;
}
/** At most one such line a day per person: none with this reminder key in the last ~day. */
const lineDue = async (userId: string, key: string, now: Date) => !(await db.notification.findFirst({ where: { userId, reminderKey: key, createdAt: { gt: new Date(now.getTime() - 23 * 3_600_000) } }, select: { id: true } }));

/**
 * (Owner, Oct 29, batch 29 §31; replaces the per-piece daily "“<test>”: <tester>'s <part> wasn't reviewed by <date>: …" line) ONE bell line a day across all the
 * developer's tests, on every day at least one listed piece is past its review date and still unpaid (open to the tester's Charge), opening Needs you on the dashboard.
 * It stops when nothing is past its review date. Listed calls aren't in it (charged automatically, batch 28 §21); unlisted work isn't either. Emailed whatever the
 * setting (money). Waits while the test is paused, like the line it replaces.
 */
async function payNowLines(now: Date, co: CloseOuts) {
  const byDev = new Map<string, OpenPiece[]>();
  const emails = new Map<string, string>();
  for (const p of await chargeablePieces(co, { contract: { test: PAUSE_FREE } })) {
    if (await co.payClosed({ submissionId: p.id })) continue;
    byDev.set(p.devId, [...(byDev.get(p.devId) ?? []), p]);
    emails.set(p.devId, p.devEmail);
  }
  for (const [devId, list] of byDev) {
    if (!(await lineDue(devId, "paynow", now))) continue;
    const line = payNowLine(list);
    await notify(emails.get(devId)!, line, [line + "."], "/app#needs-review", { side: "developer", always: true, payment: true, group: "unreviewed", reminder: "paynow" }); // (batch 30 §6) Needs review, marked
  }
}

/**
 * (Owner, Oct 29, batch 29 §22; replaces "<dev> didn't review your <part> in 7 days: charge $X or let it go", its reminders every 3 days and the 3-day / 1-day "Charge or
 * let go of your work on “<test>” by <date>") ONE bell line a day across all the tester's tests, on every day they have at least one piece open to Charge or Let it go,
 * opening the dashboard's "Charge or cancel" box. The first comes the day a piece's Charge opens; it stops when nothing is open. Emailed whatever the setting (money);
 * waits while the tester side is suspended. Never names a hold, a suspension or a failure.
 */
async function testerChargeLines(now: Date, co: CloseOuts) {
  const byTester = new Map<string, OpenPiece[]>();
  const emails = new Map<string, string>();
  for (const p of await chargeablePieces(co, {})) {
    if (p.testerSuspended) continue;
    byTester.set(p.testerId, [...(byTester.get(p.testerId) ?? []), p]);
    emails.set(p.testerId, p.testerEmail);
  }
  for (const [testerId, list] of byTester) {
    if (!(await lineDue(testerId, "chargeday", now))) continue;
    const line = chargeDayLine(list);
    await notify(emails.get(testerId)!, line, [line + "."], "/app#charge-or-cancel", { side: "tester", always: true, payment: true, group: "charge", reminder: "chargeday" });
  }
}

/**
 * (Owner, Oct 29, batch 28) The developer's daily line once a sent part's review date passed: "“Harbor Run”: Ana Silva's written answers wasn't reviewed by Oct 30:
 * Ana Silva can now charge or let it go. You can still pay until they do (at the latest Nov 13)." With no Charge for the tester (a deleted tester, or their Charge
 * closed): "… wasn't reviewed by Oct 30: pay it." The dates are time tokens (the reader's zone), also in the email.
 */
export const unreviewedLine = (title: string, name: string, part: string, reviewDate: Date, closesAt: Date | null | undefined, /** (§162) the tester's */ pronoun?: string | null) =>
  `“${title}”: ${name}'s ${part} ${part.endsWith("s") ? "weren't" : "wasn't"} reviewed by ${T(reviewDate, "date")}: ${closesAt === null ? "pay it." : `${name} can now charge or let it go. You can still pay until ${pronouns(pronoun).subj} ${pronouns(pronoun).v("does", "do")}${closesAt ? ` (at the latest ${T(closesAt, "date")})` : ""}.`}`;

/** (Batch 15 section 34) What a tester can Charge for a listed call: its measured (or lowered) length × the contract rate, less what's paid, within what's left of the $1,000. */
export async function callChargeCap(x: { id: string; contractId: string; rateCents: number | null; actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) {
  const minutes = callMinutesOf(x);
  if (x.rateCents == null || minutes == null) return { cents: 0, capped: false };
  const paid = (await db.payment.aggregate({ where: { callId: x.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const full = chargeAmount(callReference(x.rateCents, minutes).cents, paid);
  const left = await callsLeftCents(x.contractId, db, x.id);
  return { cents: Math.min(full, left), capped: left < full };
}
/** (Batch 28 §21) The tester's line when a listed call was charged automatically: "Nora Lane paid you $25.00 for your call on Oct 30." (without the end period, like bell titles). */
export const autoPaidTesterLine = (dev: string, cents: number, at: Date) => `${dev} paid you ${money(cents)} for your call on ${T(at)}`; // (Owner, Nov 4, §178) the call's date and time
/**
 * (Owner, Oct 29, batch 28 §21; replaces Charge / Let it go for listed calls) A LISTED call not paid 7 days after it (its payBy, moved by pauses and outages) is charged
 * automatically: rate × measured minutes, less what's paid, within the $1,000 for that tester's calls; off-session, as a payment made while the developer is away. Each
 * call once: its review row is claimed first (unique per call), and the charge's key is the call's. Bank asks: "Your bank wants you to confirm" (3 days, then declined).
 * Declined: a payment hold. During a hold: added to what's owed. During a suspension or (owner, Nov 4, §172) the team's pause of its test: charged, waiting for the lift.
 * Nothing to charge (no measured time, or the $1,000 used): closed with $0.
 * Listed calls whose Charge had already opened switch to this. Returns how many were charged.
 */
export async function autoChargeCalls(now: Date) {
  let n = 0;
  // (Batch 29 §37) A developer who deleted their account is charged too, on the card they saved (as a tester's Charge was before batch 28 §21); with no saved card
  // the call stays unpaid ("<dev> deleted their account, so this can't be paid.").
  // (Owner, Nov 4, §172) A test the team paused no longer skips this: it runs as under a developer suspension (charged, then waiting for the lift).
  const due = await db.call.findMany({ where: { review: null, status: "booked", rateCents: { not: null }, payBy: { lt: now }, contract: { tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } }, take: 1000 });
  for (const x of due) {
    const minutes = callMinutesOf(x);
    if (minutes == null || x.rateCents == null) continue;
    const c = x.contract, dev = c.test.developer, name = displayName(c.tester);
    // (Owner, Nov 4, §177) Each line names the call it charged, with its date and time in the developer's zone: "Ana Silva's call on Tue, Oct 27, 8:00 AM was
    // charged automatically: $15.00" (a tester can have many calls on a test).
    const call = `${name}'s call on ${callAtFor(x.startsAt, dev)}`;
    const gone = !!dev.deletedAt;
    if (gone && !dev.stripePaymentMethodId) continue;
    // A charge waiting for the bank on this call (the developer's own press) is left to finish.
    if (await (await import("./confirm")).pieceLocked({ callId: x.id })) continue;

    const cap = await callChargeCap(x);
    const amount = cap.cents >= MIN_CHARGE_CENTS ? cap.cents : 0;
    const payKey = serverKey("autocall", x.id);
    const review = await db.review.create({ data: { callId: x.id, contractId: c.id, amountCents: amount, agreedCents: callReference(x.rateCents, minutes).cents, rateCents: x.rateCents, reason: amount ? AUTO_CHARGED_CALL : AUTO_NOTHING_CALL, payKey, auto: true } }).catch(() => null);
    if (!review) continue; // paid (or charged) meanwhile
    if (!amount) {
      await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${call} closed with nothing to pay`, false, {}, c.id, "", `call-${x.id}`));
      // (Owner, Nov 6, §286) The developer's top box line, in their bell too (nothing was charged, so no receipt says it).
      await bell(dev.id, `${call} closed with nothing to pay`, `/app/tests/${c.testId}#call-${x.id}`, undefined, { side: "developer", testId: c.testId });
      continue;
    }
    // (§131) The developer's payment lines name the tester, the part and the test (pieceName).
    const piece = pieceName({ tester: name, part: "live call", test: c.title });
    const what = `${piece} (${T(x.startsAt)}, charged automatically after ${REVIEW_DAYS} days)`; // (§178) the call's date and time
    // (Batch 29 §37) The tester's call reads "may be delayed" (never "failed" or "hold") while the money waits: the same line as for a declined charge.
    // (Owner, Nov 4, §177) Which call: "Payment for your call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST) may be delayed".
    const tellDelayed = () => notify(c.tester.email, `Payment for your call on “${c.title}” (${T(x.startsAt)}) may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { side: "tester", payment: true, group: "tdelayed" });
    // (Batch 29 §37) The developer's event says what really happened (charged, waiting for the bank, declined, owed, waiting for the account).
    const logged = (text: string) => db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${text}`, false, {}, c.id, "", `call-${x.id}`));
    // (Owner, Nov 4, §172) A test the team paused: the same as a suspension, for this test (it waits for the team's lift, or the test's stop or close).
    const teamPaused = teamPausedNow(c.test);
    if (!gone && (dev.devSuspendedAt || teamPaused) && !dev.holdStartedAt) {
      // During a suspension: it waits and is charged when the account is clear (chargeDeferred on the reinstatement); the tester is paid then.
      await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "deferred" } });
      await tellDelayed();
      await logged(`${call} was charged automatically: ${money(amount)}, ${dev.devSuspendedAt ? "charged when your account is clear" : "charged when the team lifts the pause on this test"}`);
      n++;
      continue;
    }
    if (!gone && await deferIfHeld({ kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0 })) {
      // (Owner, Nov 4, §177) Which call: its date, as every other payment line names a call ("Ana Silva's live call on “Harbor Run” (Oct 27)").
      await bell(dev.id, `${pieceName({ tester: name, part: "live call", test: c.title, when: T(x.startsAt), full: true })} (${money(amount)}) is added to what you owe: it's paid with it, as one payment`, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
      await tellDelayed();
      await logged(`${call} is waiting to be charged once your tests resume: ${money(amount)}`);
      n++;
      continue;
    }
    const row = await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
    let outcome = `${call} was charged automatically: ${money(amount)}`;
    try {
      // (Owner, Nov 3) "Playtest: Ana Silva's live call on “Harbor Run”, charged automatically after 7 days", as its "What you've paid" line (its review is made first).
      const r = await charge(dev, c.tester, amount, payKey, await describedOnce(row.id, () => stripeDescription({ payment: row })));
      if (r.status === "requires_action") {
        await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
        await tellDelayed();
        outcome = `${call} was charged automatically: ${money(amount)}, waiting for your bank to confirm it`;
      } else {
        await db.payment.update({ where: { id: row.id }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) } });
        // (Owner, Nov 3) Full names in the receipt email.
        await receipt(dev.email, `${pieceName({ tester: name, part: "live call", test: c.title, full: true })} (${T(x.startsAt)}, charged automatically after ${REVIEW_DAYS} days)`, amount, r.status, `/app/tests/${c.testId}#call-${x.id}`);
        const line = autoPaidTesterLine(displayName(dev), amount, x.startsAt);
        // (Batch 30 §20) In the day's "You were paid" stack with the other payments (it arrived on time: not "Delayed payments arrived").
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}#call-${x.id}`, { side: "tester", payment: true, group: "tpaid" });
      }
    } catch (e) {
      if (e instanceof HttpError && e.code === "payment_unknown") continue; // checked later by the stuck-payment check (recovery.ts)
      if (!(e instanceof HttpError && e.code === "card_failed")) {
        // Payments have a problem (not the card): nothing was charged; tried again on the next sweep.
        await db.payment.delete({ where: { id: row.id } });
        await db.review.delete({ where: { id: review.id } });
        continue;
      }
      const failed = await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
      await tellDelayed();
      // (A deleted developer: no hold to start; it stays "delayed" for the tester and is listed for the admins, as declinedPayment says.)
      await declinedPayment(dev.id, failed.id, amount, pieceName({ tester: name, part: "live call", test: c.title, when: T(x.startsAt), full: true }));
      outcome = gone ? `The automatic charge for ${call} (${money(amount)}) was declined` : `The automatic charge for ${call} (${money(amount)}) was declined: it was added to what you owe`;
    }
    await logged(outcome);
    n++;
  }
  return n;
}

/** (Batch 15 sections 15 and 40) The weekly "Pay your calls" line: one per developer, stacked across tests ("3 calls to pay on 2 tests"), until each is paid. */
async function payYourCalls(now: Date, co: CloseOuts) {
  const calls = await db.call.findMany({ where: { review: null, status: "booked", rateCents: null, payBy: { lt: now }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: true } } }, take: 5000 });
  const byDev = new Map<string, typeof calls>();
  for (const x of calls) if (callMinutesOf(x) != null && !(await co.payClosed({ callId: x.id }))) byDev.set(x.contract.test.developerId, [...(byDev.get(x.contract.test.developerId) ?? []), x]);
  for (const [devId, list] of byDev) {
    const key = `paycalls:${devId}`;
    // Weekly: the calls in the last line carry when it was sent.
    if (list.some((x) => x.remindedAt && now.getTime() - x.remindedAt.getTime() < 7 * 86_400_000 - 3_600_000)) continue;
    await db.call.updateMany({ where: { id: { in: list.map((x) => x.id) } }, data: { remindedAt: now } });
    const tests = [...new Set(list.map((x) => x.contract.testId))];
    const line = list.length === 1 ? `Pay your calls: your call with ${displayName(list[0].contract.tester)} on “${list[0].contract.title}” isn't paid yet (any amount, $0 included).` : `Pay your calls: ${list.length} calls to pay on ${tests.length === 1 ? `“${list[0].contract.title}”` : `${tests.length} tests`}.`;
    await bell(devId, line, tests.length === 1 ? `/app/tests/${tests[0]}#needs-you` : "/app#needs-review", undefined, { side: "developer", reminder: key });
  }
}

/** The tester's choice on a contract part (or, batch 15 section 15, a listed call) unreviewed for the review window: "charge" (the listing minus what is paid) or "letgo". */
export async function chooseOutcome(tester: { id: string; email: string; name: string; pronoun?: string }, contractId: string, body: Record<string, unknown>) {
  // (Owner, Oct 29, batch 32 §7) An open new-terms offer blocks Charge and Let it go until the tester answers it (Switch or Keep).
  if ((await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true } }))?.testerId === tester.id) await (await import("./terms")).answerTermsFirst(contractId);
  if (body.callId) return chooseCallOutcome(tester, contractId, body);
  const s = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!s || s.contractId !== contractId || s.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That work doesn't exist.");
  const c = s.contract, dev = c.test.developer, label = s.kind === "recording" ? "recording" : "written answers";
  // (Owner, Nov 4, §187) In this order: the tester's own Charge waiting for the developer's bank ("You already charged $10.00 for your written answers. It's waiting
  // for Nora Lane's bank."); then (batch 35 §163) the developer paid anything on this part: ONE final refusal, before any stop-once ("Nora Lane paid $6.00 for this
  // meanwhile: you can dispute it if you think it should be more."), even while another payment of theirs on it is at the bank (paid-anything wins); only then
  // (batch 12 section 5) a developer's payment being confirmed with nothing paid yet (their first Pay at the bank): "A payment for this is being confirmed right now."
  await chargeRefusals({ submissionId: s.id }, displayName(dev), s.review, `your ${label}`);
  // (Batch 17 §19) After the piece closed nothing is offered any more (even a piece whose Charge never opened).
  await chargeCloseOutGate({ submissionId: s.id });
  // (Batch 30 §3) Work sent after the tester's own deadline never opens Charge or Let it go.
  if (s.late) throw new HttpError(409, "late", NO_CHARGE_LATE);
  if (!s.choiceOfferedAt) throw new HttpError(409, "not_yet", `You can choose once ${REVIEW_DAYS} days have passed since you sent it and your deadline has passed.`);
  await testerTermsGate(contractId, displayName(dev), body, s.id);
  const choice = body.choice === "letgo" ? "letgo" : body.choice === "charge" ? "charge" : null;
  if (!choice) throw new HttpError(400, "bad_choice", "Choose Charge or Let it go.");
  // (Owner, Oct 28 afternoon) Charge and Let it go both work while the test is paused: during a payment or chargeback hold a Charge is added to what the developer owes (below).
  const paidForPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const cap = chargeAmount(s.agreedCents, paidForPart);
  if (cap === 0) throw new HttpError(409, "paid_in_full", "This part is already paid in full.");
  // Any amount up to the cap (the box starts at the cap); the tick must name the typed amount.
  const typed = body.amount === undefined || body.amount === "" ? cap : toCents(body.amount);
  if (choice === "charge" && (typed == null || typed <= 0)) throw new HttpError(400, "bad_amount", "Enter an amount like 5.00.");
  if (choice === "charge" && typed! > cap) throw new HttpError(400, "too_much", `At most ${money(cap)}.`);
  if (choice === "charge" && typed! > 0 && typed! < 50) throw new HttpError(400, "too_small", "The smallest card charge is $0.50.");
  const amount = choice === "charge" ? typed! : 0;
  // (Batch 16 section 39) The tick only above $200, naming the typed amount.
  if (choice === "charge" && amount > CHARGE_TICK_CENTS && body.tickedCents !== amount) throw new HttpError(400, "tick", chargeTickLine(displayName(dev), amount));
  const payKey = serverKey("choice", s.id);
  const review = await claimChoice(c.testId, { submissionId: s.id }, displayName(dev), { submissionId: s.id, contractId: c.id, amountCents: amount, agreedCents: s.agreedCents, reason: choice === "charge" ? CHARGED_BY_TESTER : LET_GO_BY_TESTER, payKey });
  if (!review) throw new HttpError(409, "done", "This was already settled.");
  if (choice === "letgo") {
    const line = `${displayName(tester)} let ${pronouns(tester.pronoun).poss} ${label} go: nothing charged`;
    await db.$transaction((tx) => recordEvent(tx, c.testId, "rejected", line, false, {}, c.id, "", `part-${s.id}`));
    // (Owner, Nov 6, §286) The developer's top box line rings their bell too, in the same words, linking to the part (its Charge her Charge would have paid).
    await bell(dev.id, line, `/app/tests/${c.testId}#piece-${s.id}`, undefined, { side: "developer", testId: c.testId });
    return { choice, amountCents: 0 };
  }
  // (Batch 35 §113) During a hold the tester's choice waits separately until the hold lifts; it never grows Pay what you owe.
  // During an admin suspension with no hold, or the team's pause, it is charged at once below.
  if (await deferIfHeld({ kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0 })) {
    await bell(dev.id, `Charged by the tester: ${money(amount)} for ${pieceName({ tester: displayName(tester), part: label, test: c.title, full: true })}, added to what you owe and paid with it, as one payment`, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
    await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for ${pronouns(tester.pronoun).poss} ${label}`, false, {}, c.id, "", `part-${s.id}`));
    return { choice, amountCents: amount, status: "deferred", message: chargedDelayedLine(amount) };
  }
  // (Batch 15 section 9) The payment row is reserved (pending) before the charge, so a lost answer from Stripe can be found and finished or cleared later.
  const row = await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
  let status = "charged";
  try {
    // (Owner, Nov 3) "Playtest: Ana Silva's written answers on “Harbor Run”, charged by Ana Silva after 7 days without a review" (its review is made first).
    const r = await charge(dev, c.tester, amount, payKey, await describedOnce(row.id, () => stripeDescription({ payment: row })));
    status = r.status;
    if (r.status === "requires_action") {
      // (Batch 11) The developer's bank wants them to confirm: it waits 3 days for their Confirm in Payments; the tester reads "Payment may be delayed".
      await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
      await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}#part-${s.kind}`, { side: "tester", payment: true, group: "tdelayed" });
      status = "needs_confirmation";
    } else {
      return finishChoicePay(row.id, r);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", (await import("./recovery")).PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      // (Batch 15 section 41, M1) Not the card: nothing was charged, no hold. The Charge can be pressed again.
      await db.payment.delete({ where: { id: row.id } });
      await db.review.delete({ where: { id: review.id } });
      // (§130) The developer's card unknown to Stripe (cleared): the tester reads the plain problem line, never the developer's "Add a card".
      throw e instanceof HttpError && e.code !== "no_card" ? e : new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
    }
    status = "failed";
    // (Owner, Oct 27) A declined Charge starts the payment hold at once (the tester reads only "delayed").
    const failed = await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}#part-${s.kind}`, { side: "tester", payment: true, group: "tdelayed" });
    await declinedPayment(dev.id, failed.id, amount, pieceName({ tester: displayName(tester), part: label, test: c.title, full: true }));
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for ${pronouns(tester.pronoun).poss} ${label}`, false, {}, c.id, "", `part-${s.id}`));
  return { choice, amountCents: amount, status, ...(status === "needs_confirmation" ? { message: `Charged ${money(amount)}. Payment may be delayed.` } : {}) };
}

/**
 * (Owner, Nov 3, §159; found by the same-moment race: a Pay and a Charge on one part both charged) The tester's Charge / Let it go claims the part under the test's
 * row lock, the lock Pay takes to reserve it: a Pay whose payment is on its way, at the bank or paid wins (refused here, naming it); else the review is made, and a
 * Pay pressed after that sees it. Null when the part was already settled.
 */
async function claimChoice(testId: string, where: { submissionId: string } | { callId: string }, devName: string, data: Prisma.ReviewUncheckedCreateInput) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
      // (Owner, Nov 3, batch 35 §163) The developer's Pay landed first (the same moment): the same one final refusal, decided here under the lock. (Owner, Nov 4,
      // §187) Paid anything wins over a payment of theirs still at the bank.
      const paid = await devPaidRefusal(tx, where, devName, await tx.review.findFirst({ where }));
      if (paid) throw paid;
      // (A Pay that went through made its review in the same step. What's still on its way or at the bank holds the part.)
      if (await tx.payment.findFirst({ where: { ...where, kind: { in: ["review", "call"] }, status: { in: ["pending", "needs_action", "needs_confirmation"] } } })) throw new HttpError(409, "locked", PIECE_LOCKED);
      return tx.review.create({ data });
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Made by a finishing Pay meanwhile: named as above.
      const paid = await devPaidRefusal(db, where, devName, await db.review.findFirst({ where }));
      if (paid) throw paid;
      return null;
    }
    throw e;
  }
}

/**
 * (Owner, Nov 3, batch 35 §163; replaces §159 item 4's stop-once for a developer payment on the part being charged, and §146's "Charge stops once, the next press
 * charges what's left") Once the developer paid anything on a part (a Pay or Pay more that went through), the tester's Charge and Let it go are gone for it: a press
 * from an older page, or at the same moment, gets ONE final refusal naming what was paid ("Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think
 * it should be more."; "paid $6.00 and $2.00 more" after a Pay more). The tester's own choice: "You already chose for this."; an old rejection: "rejected this
 * meanwhile". Null when nothing of the developer's went through (a cancelled or declined payment that left nothing paid: Charge as before).
 */
async function devPaidRefusal(tx: Prisma.TransactionClient | typeof db, where: { submissionId: string } | { callId: string }, devName: string, review: { amountCents: number; rejected: boolean; reason: string } | null) {
  if (review && byTesterChoice(review.reason)) return new HttpError(409, "done", "You already chose for this.");
  if (review?.rejected) return new HttpError(409, "done", `${devName} rejected this meanwhile.`);
  const sum = async (kinds: string[]) => (await tx.payment.aggregate({ where: { ...where, kind: { in: kinds }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const more = await sum(["extra"]);
  const pay = review ? review.amountCents : await sum(["review", "call"]);
  if (!review && pay + more <= 0) return null;
  return new HttpError(409, "done", paidMeanwhileLine(devName, pay, more));
}

/**
 * (Owner, Nov 4, §187) The refusals a Charge / Let it go meets first, in order: (1) the tester's own Charge on this part waiting for the developer's bank:
 * ownChargeWaitingLine ("You already charged $10.00 for your written answers. It's waiting for Nora Lane's bank."); (2) the developer paid anything on it: §163's
 * one final refusal, even while another payment of theirs on it is being confirmed; (3) a payment being confirmed with nothing paid yet: PIECE_LOCKED.
 */
async function chargeRefusals(where: { submissionId: string } | { callId: string }, devName: string, review: { amountCents: number; rejected: boolean; reason: string } | null, what: string) {
  const locked = await (await import("./confirm")).pieceLocked(where);
  if (locked && review && chargedByTester(review.reason)) {
    const own = await db.payment.findFirst({ where: { ...where, kind: { in: ["review", "call"] }, status: { in: ["needs_action", "needs_confirmation"] } }, orderBy: { createdAt: "desc" } });
    if (own) throw new HttpError(409, "locked", ownChargeWaitingLine(own.amountCents, what, devName));
  }
  const paidRefusal = await devPaidRefusal(db, where, devName, review);
  if (paidRefusal) throw paidRefusal;
  if (locked) throw new HttpError(409, "locked", PIECE_LOCKED);
}

/** (Batch 17 §19) Charge and Let it go close on the piece's own closing date for the tester (final: the piece stays unpaid). */
async function chargeCloseOutGate(where: { submissionId: string } | { callId: string }) {
  const at = await pieceCloseOut(where, "tester");
  if (closedOut(at)) throw new HttpError(409, "charge_closed", chargeClosedLine(fmtDate(at!)));
}

/** (Batch 15 sections 15, 34 and 40) The tester's Charge / Let it go on a listed call left unpaid past its review date. */
async function chooseCallOutcome(tester: { id: string; email: string; name: string; pronoun?: string }, contractId: string, body: Record<string, unknown>) {
  const x = await db.call.findUnique({ where: { id: String(body.callId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!x || x.contractId !== contractId || x.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That call doesn't exist.");
  const c = x.contract, dev = c.test.developer, label = "live call";
  // (Owner, Nov 4, §187) As for written work: the tester's own Charge at the bank, then the developer paid anything (one final refusal), then "being confirmed".
  await chargeRefusals({ callId: x.id }, displayName(dev), x.review, `your call on ${callAtFor(x.startsAt, c.tester)}`);
  // (Owner, Oct 29, batch 28 §21) A listed call is charged automatically: no Charge or Let it go (an older page's press).
  if (x.rateCents != null) throw new HttpError(409, "auto_charge", AUTO_CHARGE_NO_CHOICE);
  // (Batch 17 §19) After the piece closed nothing is offered any more (even a piece whose Charge never opened).
  await chargeCloseOutGate({ callId: x.id });
  if (!x.choiceOfferedAt) throw new HttpError(409, "not_yet", `You can choose once ${REVIEW_DAYS} days have passed since the call and your deadline has passed.`);
  await testerTermsGate(contractId, displayName(dev), body, x.id);
  const choice = body.choice === "letgo" ? "letgo" : body.choice === "charge" ? "charge" : null;
  if (!choice) throw new HttpError(400, "bad_choice", "Choose Charge or Let it go.");
  const cap = (await callChargeCap(x)).cents;
  if (cap === 0 && choice === "charge") throw new HttpError(409, "paid_in_full", "There's nothing left to charge for this call (the $1,000 for calls on this test is used).");
  const typed = body.amount === undefined || body.amount === "" ? cap : toCents(body.amount);
  if (choice === "charge" && (typed == null || typed <= 0)) throw new HttpError(400, "bad_amount", "Enter an amount like 5.00.");
  if (choice === "charge" && typed! > cap) throw new HttpError(400, "too_much", `At most ${money(cap)}.`);
  if (choice === "charge" && typed! > 0 && typed! < 50) throw new HttpError(400, "too_small", "The smallest card charge is $0.50.");
  const amount = choice === "charge" ? typed! : 0;
  // (Batch 16 section 39) The tick only above $200, naming the typed amount.
  if (choice === "charge" && amount > CHARGE_TICK_CENTS && body.tickedCents !== amount) throw new HttpError(400, "tick", chargeTickLine(displayName(dev), amount));
  const payKey = serverKey("choice", x.id);
  const minutes = callMinutesOf(x);
  const review = await claimChoice(c.testId, { callId: x.id }, displayName(dev), { callId: x.id, contractId: c.id, amountCents: amount, agreedCents: x.rateCents != null && minutes != null ? callReference(x.rateCents, minutes).cents : null, reason: choice === "charge" ? CHARGED_BY_TESTER : LET_GO_BY_TESTER, payKey });
  if (!review) throw new HttpError(409, "done", "This was already settled.");
  if (choice === "letgo") {
    const line = `${displayName(tester)} let ${pronouns(tester.pronoun).poss} call on ${callAtFor(x.startsAt, dev)} go: nothing charged`;
    await db.$transaction((tx) => recordEvent(tx, c.testId, "rejected", line, false, {}, c.id, "", `call-${x.id}`));
    // (Owner, Nov 6, §286) The same line in the developer's bell, linking to the call.
    await bell(dev.id, line, `/app/tests/${c.testId}#call-${x.id}`, undefined, { side: "developer", testId: c.testId });
    return { choice, amountCents: 0 };
  }
  if (await deferIfHeld({ kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0 })) {
    await bell(dev.id, `Charged by the tester: ${money(amount)} for ${pieceName({ tester: displayName(tester), part: label, test: c.title, when: T(x.startsAt), full: true })}, added to what you owe and paid with it, as one payment`, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
    // (Owner, Nov 4, §177) Which call: "Ana Silva charged $15.00 for her call on Tue, Oct 27, 8:00 AM" (the developer's zone).
    await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for ${pronouns(tester.pronoun).poss} call on ${callAtFor(x.startsAt, dev)}`, false, {}, c.id, "", `call-${x.id}`));
    return { choice, amountCents: amount, status: "deferred", message: chargedDelayedLine(amount) };
  }
  const row = await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
  let status = "charged";
  try {
    // (Owner, Nov 3) "Playtest: Ana Silva's written answers on “Harbor Run”, charged by Ana Silva after 7 days without a review" (its review is made first).
    const r = await charge(dev, c.tester, amount, payKey, await describedOnce(row.id, () => stripeDescription({ payment: row })));
    status = r.status;
    if (r.status === "requires_action") {
      await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
      await notify(c.tester.email, `Payment for your call on “${c.title}” (${T(x.startsAt)}) may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { side: "tester", payment: true, group: "tdelayed" });
      status = "needs_confirmation";
    } else {
      return finishChoicePay(row.id, r);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", (await import("./recovery")).PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      await db.payment.delete({ where: { id: row.id } });
      await db.review.delete({ where: { id: review.id } });
      // (§130) The developer's card unknown to Stripe (cleared): the tester reads the plain problem line, never the developer's "Add a card".
      throw e instanceof HttpError && e.code !== "no_card" ? e : new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
    }
    status = "failed";
    const failed = await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await notify(c.tester.email, `Payment for your call on “${c.title}” (${T(x.startsAt)}) may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { side: "tester", payment: true, group: "tdelayed" });
    await declinedPayment(dev.id, failed.id, amount, pieceName({ tester: displayName(tester), part: label, test: c.title, when: T(x.startsAt), full: true }));
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for ${pronouns(tester.pronoun).poss} call on ${callAtFor(x.startsAt, dev)}`, false, {}, c.id, "", `call-${x.id}`));
  return { choice, amountCents: amount, status, ...(status === "needs_confirmation" ? { message: `Charged ${money(amount)}. Payment may be delayed.` } : {}) };
}

/** (Batch 15 section 9) A tester's Charge went through (at once, or found later by the stuck-payment check): recorded, the receipt sent. */
export async function finishChoicePay(paymentId: string, r: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.update({ where: { id: paymentId }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const label = p.callId ? "call" : (await db.submission.findUnique({ where: { id: p.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers";
  // (§131) The receipt names the tester, the part and the test (pieceName).
  await receipt(c.test.developer.email, `${pieceName({ tester: displayName(c.tester), part: p.callId ? "live call" : label, test: c.title, full: true })} (charged by ${pronouns(c.tester.pronoun).obj} after ${REVIEW_DAYS} days)`, p.amountCents, r.status, `/app/tests/${c.testId}`);
  // (Owner, Nov 4, §177) A call with its date and time: "Ana Silva charged $15.00 for her call on Tue, Oct 27, 8:00 AM".
  const call = p.callId ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(c.tester)} charged ${money(p.amountCents)} for ${pronouns(c.tester.pronoun).poss} ${label}${call ? ` on ${callAtFor(call.startsAt, c.test.developer)}` : ""}`, false, {}, c.id, "", p.callId ? `call-${p.callId}` : p.submissionId ? `part-${p.submissionId}` : ""));
  return { choice: "charge" as const, amountCents: p.amountCents, status: r.status };
}

/**
 * (Owner, Oct 26-27) Daily bell reminders: a developer with applications / rejoin asks waiting for an answer gets a line a day per test (stacks with that test's other
 * same-day lines; waits while the test is paused). (The paused-tests reminder is in pauseClosure.ts.)
 */
async function dailyReminders(now: Date) {
  const since = new Date(now.getTime() - 20 * 3_600_000);
  // (Batch 34 §16) Not an applicant who holds a sent invite (the invite stands for the answer).
  const pendingApps = await (await import("./joining")).answerable(await db.application.findMany({ where: { status: "pending" }, select: { testId: true, testerId: true } }));
  const waiting = [...pendingApps.reduce((m, a) => m.set(a.testId, (m.get(a.testId) ?? 0) + 1), new Map<string, number>())].map(([testId, n]) => ({ testId, _count: { _all: n } }));
  const tests = await db.test.findMany({ where: { id: { in: waiting.map((w) => w.testId) }, status: "open", ...PAUSE_FREE }, select: { id: true, title: true, developerId: true } });
  const told = new Set((await db.notification.findMany({ where: { userId: { in: tests.map((t) => t.developerId) }, testId: { in: tests.map((t) => t.id) }, text: { endsWith: "for your answer" }, createdAt: { gt: since } }, select: { testId: true }, distinct: ["testId"] })).map((n) => n.testId));
  const count = new Map(waiting.map((w) => [w.testId, w._count._all]));
  // (Batch 15 section 35: "N applications wait"; no times in this line.)
  await db.notification.createMany({
    data: tests.filter((t) => !told.has(t.id)).map((t) => {
      const n = count.get(t.id)!;
      return { userId: t.developerId, side: "developer", testId: t.id, reminderKey: `applications:${t.id}`, text: `“${t.title}”: ${n} ${n === 1 ? "application or rejoin ask waits" : "applications and rejoin asks wait"} for your answer`, link: `/app/tests/${t.id}#needs-you` };
    }),
  });
}

/**
 * (Owner, Nov 3, §160) Pay what you owe's own check in flight (a chargeback hold's reservation being made or at the bank, or the one payment being charged or at the
 * bank): another press is refused with "Pay what you owe ($91.00) is waiting for your bank in another tab or window: finish that check, or cancel it." Confirm all's
 * one payment isn't Pay what you owe's.
 */
export async function owedInFlight(devId: string) {
  const r = await db.reservation.findFirst({ where: { developerId: devId, status: { in: ["pending", "needs_action"] } }, orderBy: { createdAt: "desc" }, select: { amountCents: true } });
  if (r) return r.amountCents;
  const once = await import("./owedOnce");
  // A press's one payment (being charged, or its 15-minute bank check); an away one (3 days, a new card's) locks only what it covers.
  const p = await db.payment.findFirst({ where: { developerId: devId, kind: once.OWED_KIND, status: { in: ["paying", "needs_action"] }, note: { in: ["press", "press:charges"] } }, orderBy: { createdAt: "desc" }, select: { amountCents: true } });
  return p ? p.amountCents : null;
}
export async function refuseOwedInFlight(devId: string) {
  const cents = await owedInFlight(devId);
  if (cents != null) throw new HttpError(409, "owed_in_flight", (await import("@/lib/bankNotice")).owedElsewhereLine(money(cents)));
}
