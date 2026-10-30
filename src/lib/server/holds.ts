import type { Prisma } from "@prisma/client";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, toCents } from "@/lib/format";
import {
  owedReceiptWhat, reservedAddedLine, AUTO_CHARGED_CALL, AUTO_NOTHING_CALL, AUTO_CHARGE_NO_CHOICE, MIN_CHARGE_CENTS, CHARGE_TICK_CENTS, chargeTickLine, chargeClosedLine, CLOSE_OUT_REMINDER_DAYS, testerPayable, HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL, autoPayFor, chargeAmount, CHARGED_BY_TESTER, byTesterChoice, chargedDelayedLine, countdownDue, ownDeadlineMarkDue, reviewMarkDue, reviewMarksFor, INVITE_REMIND_DAYS, failedLine, joinClosingLine, ownDeadlineLine, LET_GO_BY_TESTER, REVIEW_DAYS, chargeIsOpen, chargeOpensAt, PAUSED_RIGHT_NOW, PAY_WAITS, pauseShiftMs, STILL_SUSPENDED_LINE, PAYABLE_TESTER, PIECE_LOCKED, HOLD_RETRY_MAX, retriedLine, chargebackRefundLine, chargebackWonLine, CHARGEBACK_FEE_CENTS, chargebackOwedLine, chargebackReversedLine,
} from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify, renderFor, sendSummaries } from "./notify";
import { appUrl } from "./auth";
import { accountEvent, labelled, reportedOver3 } from "./reports";
import { sendEmail } from "./email";
import { PAYMENTS_PROBLEM, charge, chargePlatform, getStripe, stripeOn, type NeedsAction } from "./stripe";
import { serverKey } from "./pressKeys";
import { receipt } from "./payments";
import { testerTermsGate } from "./terms";
import { recordEvent } from "./tests";
import { PAUSE_CLOSE_DAYS } from "@/lib/pause";
import { callMinutesOf } from "@/lib/callMeasure";
import { callReference } from "@/lib/rules";
import { callsLeftCents } from "./callMoney";
import { closedOut, pieceCloseOut } from "./closeOut";
import { withTimersLock } from "./timers";
import { pieceWords } from "@/lib/bankTop";
import { LATE_REMINDER_TAIL, NO_CHARGE_LATE } from "@/lib/moneyLines";

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
  const failed = await db.payment.findMany({ where: { developerId: devId, OR: [{ status: "failed", owedUntil: { not: null }, settledAt: null }, { status: "owed" }, { status: PAYING }] }, orderBy: { createdAt: "asc" } });
  const reversed = await db.payment.findMany({ where: { developerId: devId, chargeback: "open" }, orderBy: { createdAt: "asc" } });
  const repaid = reversed.length ? new Set((await db.payment.findMany({ where: { repaysId: { in: reversed.map((p) => p.id) }, status: { in: ["charged", "not_set_up"] } }, select: { repaysId: true } })).map((p) => p.repaysId)) : new Set<string | null>();
  // (Owner, Oct 29, batch 11) A chargeback is owed with its fee: the reversed amount + CHARGEBACK_FEE_CENTS (`reversedCents` keeps the reversed amount).
  const charged = reversed.filter((p) => !repaid.has(p.id)).map((p) => ({ ...p, reversedCents: p.amountCents, amountCents: p.amountCents + CHARGEBACK_FEE_CENTS }));
  return [...failed.map((p) => ({ ...p, reversedCents: 0 })), ...charged].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
}

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
    await bell(devId, `Another payment was declined: ${money(cents)} for ${what} was added to what you owe`, dev.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
  }
  return started;
}

export async function startHold(devId: string, reason: string) {
  const now = new Date();
  const claimed = await db.user.updateMany({ where: { id: devId, holdStartedAt: null }, data: { holdStartedAt: now, holdReason: reason, holdAlertedAt: null, holdCount: { increment: 1 }, holdApprovedAt: null, holdApprovedById: null, holdRetries: 0, holdRetryAt: null } });
  if (claimed.count !== 1) return false;
  await accountEvent(devId, "hold", null, reason);
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
    await db.$transaction((tx) => recordEvent(tx, t.id, "paused", "Your tests are paused until you pay what you owe", false));
  }
  // (Owner, Oct 27) Calls starting within 3 days are cancelled with no fault; later ones are cancelled 3 days before they start if the hold is still on (the daily job).
  await (await import("./restrictions")).cancelCallsNearPause(devId, now);
  await (await import("./pauseClosure")).bellPausedTests(devId);
  // (Owner, Oct 27) "Your tests are paused" and the chargeback hold email ignore Off (they ride in the one end-of-day email); the lines stack with that day's other hold / payment lines.
  if (reason === "chargeback") {
    await notify(dev.email, "Your tests are paused after a chargeback", ["Your bank reversed a payment, so your tests are paused: you can't change anything on them, and testers stay in them.", "To resume: verify a card with 3D Secure, pay what you owe, and wait for the team's approval. Open Payments to see which steps remain.", `A test that stays paused for ${PAUSE_CLOSE_DAYS} days is closed.`], "/app/payments#chargeback-steps", { always: true, payment: true, group: "payhold" });
    return true;
  }
  await notify(dev.email, "Your tests are paused", ["Your tests are paused until you pay what you owe: you can't change anything on them, and testers stay in them.", "Open Payments and press Pay what you owe: your tests resume at once.", `A test that stays paused for ${PAUSE_CLOSE_DAYS} days is closed.`], "/app/payments#owed", { always: true, payment: true, group: "payhold" });
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
export async function shiftAfterPause(tx: Prisma.TransactionClient, t: { id: string; status: string; openUntil: Date | null }, start: Date, now: Date, others: (Date | null | undefined)[] = []) {
  const ms = pauseShiftMs(start, now, others);
  if (ms <= 0) return 0;
  const later = <T extends Date | null>(d: T, by = ms) => (d ? (new Date(d.getTime() + by) as T) : d);
  if (t.openUntil && t.status !== "stopped") await tx.test.update({ where: { id: t.id }, data: { openUntil: later(t.openUntil), notified3d: false, notified1d: false } });
  for (const c of await tx.contract.findMany({ where: { testId: t.id, status: "working" } })) await tx.contract.update({ where: { id: c.id }, data: { dueAt: later(c.dueAt) } });
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
export async function chargeDeferred(devId: string) {
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  for (const p of await db.payment.findMany({ where: { developerId: devId, status: "deferred" }, orderBy: { createdAt: "asc" } })) {
    const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
    const testPath = p.contractId ? `/app/tests/${(await db.contract.findUnique({ where: { id: p.contractId }, select: { testId: true } }))?.testId}` : "/app/payments";
    if (p.kind === "chargeback") {
      // (Batch 28 §8) A reversed payment owed again, added after the reservation: charged to the platform right after the lift (the tester already got their share).
      try {
        const r = await chargePlatform(dev, p.amountCents, serverKey("deferred", p.id), "Playtest: a payment reversed by your bank, charged again");
        if (r.status === "requires_action") { await (await import("./confirm")).awayAction(p.id, r as NeedsAction); continue; }
        await db.payment.update({ where: { id: p.id }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, settledAt: new Date() } });
        await receipt(dev.email, await owedItemName(p), p.amountCents, r.status, "/app/payments");
      } catch (e) {
        // Declined: the reversal is owed again (its chargeback reopens), so a chargeback hold starts for it.
        if (e instanceof HttpError && e.code === "card_failed") {
          await db.payment.delete({ where: { id: p.id } });
          if (p.repaysId) await db.payment.update({ where: { id: p.repaysId }, data: { chargeback: "open" } });
          await startHold(devId, "chargeback");
        }
      }
      continue;
    }
    try {
      const r = await charge(dev, tester, p.amountCents, serverKey("deferred", p.id), "Playtest: charged now that the account is clear");
      if (r.status === "requires_action") { await (await import("./confirm")).awayAction(p.id, r as NeedsAction); continue; }
      await db.payment.update({ where: { id: p.id }, data: { ...r } });
      await receipt(dev.email, await deferredWhat(p), p.amountCents, r.status, testPath);
      await tellArrived(p, tester.email, displayName(dev));
    } catch (e) {
      // (Batch 15 section 41, M1) Only a card error is a decline; any other problem leaves it waiting for the next time.
      // (Batch 29 §37) The decline names what it was ("Ana Silva's written answers on “Harbor Run”"), not "work you paid for during the pause" for a tester's Charge.
      if (e instanceof HttpError && e.code === "card_failed") await declinedPayment(devId, p.id, p.amountCents, await declinedWhat(p));
    }
  }
}

/**
 * What a payment charged after a pause was for, in its receipt: a team decision, (batch 28 §8) a tester's Charge ("Ana Silva's written answers (charged by them after
 * 7 days)", like any Charge's receipt), or work the developer paid for during the pause.
 */
async function deferredWhat(p: { kind: string; submissionId: string | null; callId: string | null; contractId: string | null }) {
  if (p.kind === "dispute") return "a team decision (charged after the pause)";
  const review = p.submissionId ? await db.review.findUnique({ where: { submissionId: p.submissionId } }) : p.callId ? await db.review.findUnique({ where: { callId: p.callId } }) : null;
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  // (Batch 28 §21) A listed call charged automatically while the account was suspended.
  if (review?.reason === AUTO_CHARGED_CALL && c && p.callId) {
    const call = await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } });
    return `${displayName(c.tester)}'s call on ${call ? T(call.startsAt, "date") : "?"} (charged automatically after ${REVIEW_DAYS} days)`;
  }
  if (review?.reason === CHARGED_BY_TESTER && c) {
    const label = p.callId ? "call" : (await db.submission.findUnique({ where: { id: p.submissionId ?? "" }, select: { kind: true } }))?.kind === "recording" ? "recording" : "written answers";
    return `${displayName(c.tester)}'s ${label} (charged by them after ${REVIEW_DAYS} days)`;
  }
  return "work you paid for during the pause";
}

/** (Batch 29 §37) What a deferred payment declined after a lift was: "a team decision", or the piece ("Ana Silva's written answers on “Harbor Run”", "Ana Silva's call on Nov 5 on “Harbor Run”"). */
async function declinedWhat(p: { kind: string; submissionId: string | null; callId: string | null; contractId: string | null }) {
  if (p.kind === "dispute") return "a team decision";
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  if (!c) return "work you paid for during the pause";
  if (p.callId) {
    const call = await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } });
    return `${displayName(c.tester)}'s call${call ? ` on ${T(call.startsAt, "date")}` : ""} on “${c.title}”`;
  }
  const kind = (await db.submission.findUnique({ where: { id: p.submissionId ?? "" }, select: { kind: true } }))?.kind;
  return `${displayName(c.tester)}'s ${kind === "recording" ? "recording" : "written answers"} on “${c.title}”`;
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
  if (await db.payment.count({ where: { developerId: devId, chargeback: "open" } })) return false;
  if (dev.holdReason === "chargeback" && (!dev.chargebackCardVerifiedAt || !dev.chargebackApprovedAt)) return false;
  // (Owner, Oct 27) After the 3rd hold, every later hold needs an admin's Approve, even once everything owed is paid: the admins are told a lift is waiting.
  if (dev.holdReason !== "chargeback" && dev.holdCount > HOLD_APPROVAL_AFTER && !dev.holdApprovedAt) {
    await tellAdminsLiftWaiting(dev);
    return false;
  }
  const start = dev.holdStartedAt, now = new Date();
  let running: string[] = [];
  await db.$transaction(async (tx) => {
    running = await resumeTests(tx, devId, start, now, [dev.devSuspendedAt]);
    await tx.user.update({ where: { id: devId }, data: { holdStartedAt: null, holdReason: "", holdAlertedAt: null, chargebackCardVerifiedAt: null, chargebackApprovedAt: null, holdApprovedAt: null, holdApprovedById: null } });
  });
  await accountEvent(devId, "hold-lifted");
  // (Batch 23 section 6) Anything still reserved on the card is released (nothing taken).
  await (await import("./chargeback")).releaseReservations(devId);
  // (Batch 8) The subscription's paid days left resume (unless a suspension is still on).
  await (await import("./subscription")).resumeBilling(devId, now);
  await chargeDeferred(devId);
  // (Owner, Oct 29, batch 10) "Your tests are running again" only when nothing pauses them any more: with an admin suspension still on, the payment line instead (both ignore Off).
  if (opts.quietDev) {
    // (Batch 24, a batch 23 leftover) The team's Approve tells the developer in its own single notice.
  } else if (dev.devSuspendedAt) await notify(dev.email, STILL_SUSPENDED_LINE, [STILL_SUSPENDED_LINE], "/app", { always: true, payment: true, group: "payhold" });
  else await notify(dev.email, "Your tests are running again", ["Everything you owed is paid: your tests are running again, and every deadline moved on by the pause."], "/app", { always: true, payment: true, group: "payhold" });
  const testers = await db.contract.findMany({ where: { status: "working", testId: { in: running } }, include: { tester: true } });
  for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`, { group: "paused" });
  return true;
}

/** Admins get one bell line when a hold lift is waiting for them (after the developer paid): (batch 29 §29) its own daily entry ("Hold lifts waiting · 1"), linking to the row. */
async function tellAdminsLiftWaiting(dev: { id: string; email: string; name: string; holdCount: number; holdStartedAt: Date | null }) {
  const flagged = (await reportedOver3([dev.id])).has(dev.id);
  const text = `Hold lift waiting: ${labelled(displayName(dev), flagged)} paid what they owe (${MANY_HOLDS_LABEL})`;
  for (const a of await adminUsers()) {
    if (await db.notification.count({ where: { userId: a.id, text, createdAt: { gt: dev.holdStartedAt ?? new Date(0) } } })) continue;
    await bell(a.id, text, `/admin#lift-${dev.id}`, undefined, { group: "adminlifts" });
  }
}

/** Admin: approve lifting a payment hold (the 4th hold onward). First press wins. The hold lifts once everything owed is paid. */
export async function approveHoldLift(adminId: string, devId: string, note: string) {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev?.holdStartedAt || dev.holdReason === "chargeback" || dev.holdCount <= HOLD_APPROVAL_AFTER) throw new HttpError(409, "not_needed", "That account's hold doesn't need an approval.");
  const claimed = await db.user.updateMany({ where: { id: devId, holdApprovedAt: null, holdStartedAt: { not: null } }, data: { holdApprovedAt: new Date(), holdApprovedById: adminId } });
  if (claimed.count !== 1) {
    const by = dev.holdApprovedById ? await db.user.findUnique({ where: { id: dev.holdApprovedById } }) : null;
    throw new HttpError(409, "decided", `This lift was already approved${by ? ` by ${displayName(by)}` : ""}${dev.holdApprovedAt ? ` at ${fmtDateTime(dev.holdApprovedAt)}` : ""}.`);
  }
  await accountEvent(devId, "hold-approved", adminId, note);
  const lifted = await liftHoldIfClear(devId);
  if (!lifted) await notify(dev.email, "The team approved lifting your hold", ["The team approved lifting your hold. It lifts once you have paid what you owe." + (note ? ` Their note: “${note}”` : "")], "/app/payments", { payment: true, group: "admindecision" });
  else if (note) await notify(dev.email, "A note from the team about your hold", [note], "/app/payments", { payment: true, group: "admindecision" });
  return { ok: true, lifted };
}

/** "Pay what you owe": retry every failed charge still owed; lifts the hold when all are paid. */
/**
 * "Pay what you owe": stops once if the owed total changed since the page loaded (seenTotalCents); the second press
 * pays at once. Every failed charge is retried; any still failing is named with the card's reason and the hold stays.
 */
export async function payOwed(dev: { id: string }, body: Record<string, unknown> = {}) {
  await (await import("./confirm")).expireActions();
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  // (Owner, Oct 29, batch 23 section 6) A chargeback hold: what is already reserved on the card is not asked for again (only what was added since).
  const cbHold = !!u.holdStartedAt && u.holdReason === "chargeback";
  const rs = cbHold ? await (await import("./chargeback")).reserveState(dev.id) : null;
  const covered = rs?.covered ?? null;
  const list = (await owed(dev.id)).filter((p) => !covered?.has(p.id));
  const total = list.reduce((a, p) => a + p.amountCents, 0);
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves ONCE: with a reservation in place, what was added since is charged right after the lift (no second one).
  if (rs && rs.reservedCents > 0 && list.length) throw new HttpError(409, "nothing_owed", reservedAddedLine(rs.reservedCents, total));
  // (Owner, Oct 29, batch 10) Paid meanwhile (another tab, or a won chargeback): nothing is charged, ever twice.
  // (A hold left with nothing owed still lifts here, charging nothing.)
  if (!list.length) {
    if (await liftHoldIfClear(dev.id)) return { paid: 0, stillFailing: [] as string[], lifted: true };
    if (covered?.size) throw new HttpError(409, "nothing_owed", ALREADY_RESERVED);
    throw new HttpError(409, "nothing_owed", NOTHING_OWED);
  }
  // (Owner, Oct 28, batch 16 section 41) A chargeback hold's steps go in order: a card verified with 3D Secure first, then paying (which never lifts it: the team's Approve does).
  if (u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackCardVerifiedAt) throw new HttpError(409, "verify_first", VERIFY_FIRST);
  const seen = typeof body.seenTotalCents === "number" ? body.seenTotalCents : null;
  const lines = await owedLines(dev.id);
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
  // (Owner, NEXT-UI 12b) Every press checks what the box showed (total and which payments), the second one too: if
  // anything is new it stops again with just the new line(s).
  const nowIds = lines.filter((l) => l.retry).map((l) => l.id);
  if (seen != null && (seen !== total || (Array.isArray(body.seenIds) && (seenIds.length !== nowIds.length || nowIds.some((i) => !seenIds.includes(i)))))) {
    const freshLines = lines.filter((l) => l.retry && !seenIds.includes(l.id));
    const fresh = freshLines.map((l) => l.text.replace(/ · card declined .*$/, ""));
    // (Batch 10) A tester's Charge or a chargeback added meanwhile isn't a failed payment: it reads "Added to what you owe meanwhile".
    // (Batch 11) A chargeback the platform won meanwhile (it left the list) says so.
    const goneIds = seenIds.filter((i) => !nowIds.includes(i));
    const won = goneIds.length ? await db.payment.findMany({ where: { id: { in: goneIds }, chargeback: "won" } }) : [];
    const text = fresh.length
      ? `${freshLines.every((l) => l.source === "failed") ? "Another payment failed meanwhile" : "Added to what you owe meanwhile"}: ${fresh.join(", ")}. New total ${money(total)}. Press again to pay ${money(total)}.`
      : won.length
        ? `${won.map((w) => `Your bank's chargeback of ${money(w.amountCents)} was reversed`).join("; ")}. Now ${money(total)}. Press again to pay ${money(total)}.`
        : `What you owe changed: now ${money(total)}. Press again to pay ${money(total)}.`;
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text, at: new Date() }], totalCents: total, ids: nowIds });
  }
  // (Owner, Oct 29, batch 23 section 6) A chargeback hold: one authorization for the total (the bank's check inline if it asks); nothing is taken until the team approves.
  if (cbHold) {
    const r = await (await import("./chargeback")).reserveOwed(u, list);
    if ("failed" in r) return { paid: 0, stillFailing: [`${money(total)} (${r.failed!.replace(/.$/, "")})`], lifted: false, confirm: [] };
    return { paid: 0, stillFailing: [] as string[], lifted: false, reservedCents: total, confirm: "action" in r && r.action ? [r.action] : [] };
  }
  const stillFailing: string[] = [];
  let paid = 0;
  // (Batch 11) Payments the bank wants the developer to confirm in the page (its pop-up, then /api/payments/confirm).
  const confirm: Awaited<ReturnType<typeof import("./confirm").pressAction>>[] = [];
  // (Owner, Oct 29, batch 25 section 5) The press gets ONE receipt for what went through, naming the items.
  const names: string[] = [];
  let paidCents = 0, setUp = false;
  for (const p of list) {
    const r = await chargeOwedOne(u, p, "press");
    if (r.result === "paid") {
      paid++;
      paidCents += r.cents;
      names.push(r.name);
      setUp ||= r.status !== "not_set_up";
    } else if (r.result === "action") confirm.push(r.action);
    else if (r.result === "failed") stillFailing.push(`${lines.find((l) => l.id === p.id)?.text ?? money(p.amountCents)} (${r.why.replace(/\.$/, "")})`);
  }
  if (paidCents > 0) await receipt(u.email, owedReceiptWhat(names), paidCents, setUp ? "charged" : "not_set_up", "/app/payments");
  // The hold lifts only when all are paid; a chargeback hold also needs the card check and the admin's approval.
  const lifted = await liftHoldIfClear(dev.id);
  return { paid, stillFailing, lifted, confirm };
}

type OwedRow = Awaited<ReturnType<typeof owed>>[number];
type OneResult = { result: "paid"; cents: number; status: string; name: string } | { result: "action"; action: Awaited<ReturnType<typeof import("./confirm").pressAction>> } | { result: "waiting" } | { result: "failed"; why: string } | { result: "skipped" };
/**
 * Charge ONE owed payment on the saved card. "press": the developer's own "Pay what you owe" (on-session: the bank may ask them to confirm in the page). "away": an automatic
 * retry during the hold (batch 11 section 4; the bank's confirmation then waits 3 days for Confirm in Payments). Each payment is claimed first, so it is never charged twice.
 * (Batch 25 section 5) It sends the developer no line itself: the caller sends one for all that went through (the press's receipt, the retry's line), naming `name`.
 */
async function chargeOwedOne(u: Parameters<typeof charge>[0] & { email: string; name: string }, p: OwedRow, mode: "press" | "away"): Promise<OneResult> {
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  const confirmMod = () => import("./confirm");
  if (p.chargeback === "open") {
    // (Owner, Oct 27) A reversed payment is owed again: the same amount (batch 11: with the chargeback fee) is charged on the card, to the platform (the tester already got
    // their share). The team's Approve closes the chargeback. (Batch 10) Claimed first (a "paying" repay row, made under a lock on the reversed payment).
    const claim = await claimChargebackRepay(p, u.id);
    if (!claim) return { result: "skipped" };
    try {
      const r = await chargePlatform(u, p.amountCents, serverKey("cbowed", p.id, claim.id), "Playtest: a payment reversed by your bank, charged again", mode);
      if (r.status === "requires_action") {
        if (mode === "press") return { result: "action", action: await (await confirmMod()).pressAction(claim.id, r as NeedsAction) };
        await (await confirmMod()).awayAction(claim.id, r as NeedsAction);
        return { result: "waiting" };
      }
      await db.payment.update({ where: { id: claim.id }, data: { ...r, settledAt: new Date() } });
      return { result: "paid", cents: p.amountCents, status: r.status, name: await owedItemName(p) };
    } catch (e) {
      await db.payment.delete({ where: { id: claim.id } });
      return { result: "failed", why: owedWhy(e) };
    }
  }
  // An automatic retry leaves alone a payment already waiting for the bank's confirmation; a press replaces it (never both).
  if (mode === "away" && p.actionPi) return { result: "skipped" };
  // (Batch 10) Claim the owed payment (failed or owed -> paying); a claim older than 10 minutes (a press that never finished) can be taken again. (A press whose bank
  // pop-up is still open keeps its claim until it ends or times out.)
  const before = p.status === PAYING ? (!p.actionPi && p.warnedAt && p.warnedAt.getTime() < Date.now() - 10 * 60_000 ? { status: PAYING, warnedAt: p.warnedAt } : null) : { status: p.status };
  const was = p.status === PAYING ? (p.owedUntil ? "failed" : "owed") : p.status;
  if (!before || (await db.payment.updateMany({ where: { id: p.id, settledAt: null, ...before }, data: { status: PAYING, warnedAt: new Date() } })).count !== 1) return { result: "skipped" };
  if (p.actionPi && stripeOn()) await getStripe().paymentIntents.cancel(p.actionPi).catch(() => null);
  try {
    const r = await charge(u, tester, p.amountCents, serverKey("owed", p.id, String(Date.now())), was === "owed" ? "Playtest: added to what you owe while your tests were paused" : "Playtest: amount owed", mode);
    if (r.status === "requires_action") {
      if (mode === "press") return { result: "action", action: await (await confirmMod()).pressAction(p.id, r as NeedsAction, true) };
      await db.payment.update({ where: { id: p.id }, data: { status: was, warnedAt: null } });
      await (await confirmMod()).awayAction(p.id, r as NeedsAction, true);
      return { result: "waiting" };
    }
    await db.payment.update({ where: { id: p.id }, data: { ...r, settledAt: new Date(), failure: "", warnedAt: null, actionPi: null, actionBy: null } });
    await tellArrived(p, tester.email, displayName(u));
    return { result: "paid", cents: p.amountCents, status: r.status, name: await owedItemName(p) };
  } catch (e) {
    await db.payment.update({ where: { id: p.id }, data: { status: was, warnedAt: null } });
    return { result: "failed", why: owedWhy(e) };
  }
}
/** (Batch 15 section 41, L4) Why one owed payment failed, in plain words (never Stripe's raw text). */
const owedWhy = (e: unknown) => (e instanceof HttpError && e.code === "card_failed" ? "Your card was declined." : e instanceof HttpError && e.code === "payments_problem" ? PAYMENTS_PROBLEM : "It didn't go through. Try again shortly.");

/**
 * (Owner, Oct 29, batch 11 section 4) While a payment hold lasts, what is owed is retried on the saved card: once a day, at most HOLD_RETRY_MAX tries a hold ("daily"),
 * and at once when the developer saves a new card ("card", not counted). (Owner, Oct 29, batch 22 section 1) Never during a CHARGEBACK hold (also one that started as a
 * payment hold): what is owed is then paid only through Pay what you owe, after the card check, and the hold lifts only on the team's Approve. Success: those lines are paid (an open Payments page updates live and a press stops
 * once), the developer gets ONE line (batch 25 section 5), "We charged your card $X for what you owed: <the items>." (no separate receipt line; it rides the payment email
 * as the receipt), and the hold lifts as if they had pressed Pay (the 4th hold on still needs Approve; a chargeback
 * hold still needs the card check and Approve; a suspension is never lifted by a payment). A failed retry sends nothing: Payments shows the last and next try.
 */
export async function retryOwed(devId: string, now = new Date(), why: "daily" | "card" = "daily") {
  const u = await db.user.findUnique({ where: { id: devId } });
  if (!u?.holdStartedAt || u.deletedAt) return null;
  if (u.holdReason === "chargeback") return null; // (batch 22 section 1)
  if (why === "daily" && (u.holdRetries >= HOLD_RETRY_MAX || (u.holdRetryAt && now.getTime() - u.holdRetryAt.getTime() < 23 * 3_600_000))) return null;
  // No saved card (or payments not set up): nothing to retry on.
  if (!stripeOn() || !u.stripeCustomerId || !u.stripePaymentMethodId) return null;
  const list = (await owed(devId)).filter((p) => !p.actionPi);
  if (!list.length) return null;
  await db.user.update({ where: { id: devId }, data: { holdRetryAt: now, ...(why === "daily" ? { holdRetries: { increment: 1 } } : {}) } });
  let cents = 0;
  const names: string[] = [];
  for (const p of list) {
    const r = await chargeOwedOne(u, p, "away");
    if (r.result === "paid") {
      cents += r.cents;
      names.push(r.name);
    }
  }
  if (cents > 0) await bell(devId, retriedLine(cents, names), "/app/payments", undefined, { payment: true, group: "payhold" });
  const lifted = cents > 0 ? await liftHoldIfClear(devId) : false;
  return { cents, lifted };
}

/** (Batch 11) An owed payment a "Pay what you owe" press is charging right now. */
const PAYING = "paying";
/** (Batch 10) "Pay what you owe" pressed when nothing is owed any more (paid in another tab meanwhile). */
export const NOTHING_OWED = "There's nothing to pay: what you owed is already paid.";
/** (Batch 23 section 6) Pay what you owe during a chargeback hold when everything owed is already reserved (another tab). */
export const ALREADY_RESERVED = "There's nothing more to reserve: what you owe is already reserved on your card.";

/** (Batch 10) Claim the repay of one reversed payment: one "paying" repay row at a time, made under a row lock; null when it is paid or being paid already. */
async function claimChargebackRepay(p: { id: string; contractId: string | null; testerId: string; amountCents: number }, devId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${p.id} FOR UPDATE`;
    const busy = await tx.payment.findFirst({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up", PAYING, "needs_action", "needs_confirmation"] } } });
    if (busy) return null;
    return tx.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: devId, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", status: PAYING } });
  });
}

/**
 * (Batch 11) A payment that waited (owed, or for the bank's confirmation) went through: the developer's receipt and the tester's paid line. (Batch 25 section 5) The one
 * receipt names what was paid: "what you owed: Ana Silva's call on Oct 30" for a retry of what's owed (`wasOwed`), else the piece or the team's decision.
 */
export async function settledOwed(paymentId: string, wasOwed = false) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  const name = await owedItemName(p);
  await receipt(dev.email, wasOwed ? owedReceiptWhat([name]) : name, p.amountCents, p.status, "/app/payments");
  if (p.kind !== "chargeback" && p.kind !== "subscription") await tellArrived(p, tester.email, displayName(dev));
}

/**
 * (Owner, Oct 29, batch 25 section 5) What one payment was for, named like the dashboard's rows: "Ana Silva's call on Oct 30" (a time token: the reader's own zone), "Ben
 * Okafor's written answers", "the team's decision on Ana Silva's dispute"; a reversed payment owed again (an open chargeback, or its repay row): "a payment your bank had
 * reversed (Ana Silva's written answers)".
 */
export async function owedItemName(p: { amountCents: number; kind: string; contractId: string | null; submissionId: string | null; callId: string | null; chargeback?: string | null; repaysId?: string | null }) {
  const orig = p.kind === "chargeback" && p.repaysId ? await db.payment.findUnique({ where: { id: p.repaysId } }) : null;
  const base = orig ?? p;
  const c = base.contractId ? await db.contract.findUnique({ where: { id: base.contractId }, include: { tester: true } }) : null;
  const name = c ? displayName(c.tester) : "";
  const sub = c && base.submissionId ? await db.submission.findUnique({ where: { id: base.submissionId }, select: { kind: true } }) : null;
  const call = c && !sub && base.callId ? await db.call.findUnique({ where: { id: base.callId }, select: { startsAt: true } }) : null;
  const piece = !c ? null : base.kind === "dispute" ? pieceWords.dispute(name) : sub ? pieceWords.part(name, sub.kind) : call ? pieceWords.call(name, T(call.startsAt, "date")) : pieceWords.work(name);
  if (orig || p.chargeback === "open" || p.kind === "chargeback") return pieceWords.reversed(piece);
  return piece ?? `a payment of ${money(p.amountCents)}`;
}

/** The tester's one notice when a delayed payment goes through: the normal paid line. */
export async function tellArrived(p: { contractId: string | null; submissionId: string | null; callId: string | null; kind: string; amountCents: number }, email: string, devName: string) {
  const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
  const label = p.kind === "dispute" ? "dispute" : p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
  const line = `${devName} paid ${money(p.amountCents)} for your ${label}`;
  await notify(email, line, [line + "."], p.contractId ? `/app/sessions/${p.contractId}#${p.callId ? "part-live" : sub?.kind === "recording" ? "part-recording" : "part-written"}` : "/app/payments", { payment: true, group: "tarrived" });
}

/** One line per failed payment ("Ana Silva's written answers $8.00 · card declined Oct 20"), plus open chargebacks. */
export async function owedLines(devId: string) {
  // (Batch 23 section 6) During a chargeback hold, what is reserved on the card already isn't listed again (Payments shows "Reserved $X" instead).
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, holdReason: true } });
  const covered = u?.holdStartedAt && u.holdReason === "chargeback" ? (await (await import("./chargeback")).reserveState(devId)).covered : null;
  const list = (await owed(devId)).filter((p) => !covered?.has(p.id));
  const out = [];
  for (const p of list) {
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
    const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
    const what = `${c ? displayName(c.tester) + "'s " : ""}${p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers"}`;
    // `source` (batch 10): what put it on the list, for the stop-once wording.
    out.push(p.chargeback === "open"
      ? { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, source: "chargeback" as const, text: chargebackOwedLine(p.reversedCents) }
      : p.status === "owed" || (p.status === PAYING && !p.owedUntil)
        // (Owner, Oct 28 afternoon) Added while the tests were paused: never tried on the card yet.
        ? { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, source: "owed" as const, text: `${what} ${money(p.amountCents)} · ${p.kind === "dispute" ? "the team's dispute decision" : p.callId && (await db.review.findUnique({ where: { callId: p.callId }, select: { auto: true } }))?.auto ? "charged automatically" : "charged by the tester"} while your tests were paused` }
        : { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, source: "failed" as const, text: failedLine(what, p.amountCents, p.createdAt) });
  }
  return out;
}

/**
 * Stripe dispute (the developer's bank reversed a payment): a chargeback hold starts (3D Secure card check, pay what is owed, admin Approve). A chargeback during a
 * payment hold turns it into a chargeback hold (the hold count is unchanged); every further chargeback adds to what is owed.
 */
export async function chargebackOpened(paymentIntentId: string) {
  const p = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!p || p.chargeback === "open") return false;
  await db.payment.update({ where: { id: p.id }, data: { chargeback: "open", chargebackAt: new Date() } });
  const before = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // A chargeback is a hold with extra steps: a hold that is already on becomes a chargeback hold, and any earlier card check or approval no longer counts.
  await db.user.updateMany({ where: { id: p.developerId, holdStartedAt: { not: null } }, data: { holdReason: "chargeback", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  if (c) {
    const what = p.kind === "call" ? `${displayName(c.tester)}'s live call` : p.submissionId ? `${displayName(c.tester)}'s ${(await db.submission.findUnique({ where: { id: p.submissionId } }))?.kind === "recording" ? "recording" : "written answers"}` : displayName(c.tester);
    await db.$transaction((tx) => recordEvent(tx, c.testId, "chargeback", `Your bank reversed your ${money(p.amountCents)} payment for ${what}`, false, {}, c.id));
  }
  const started = await startHold(p.developerId, "chargeback");
  // (Owner, Oct 26) A chargeback email goes to every admin at once, whatever their email setting.
  const to = new Set([...admins(), ...(await adminUsers()).map((a) => a.email)]);
  for (const a of to) await sendEmail({ to: a, subject: `Playtest: new chargeback of ${money(p.amountCents)}`, text: [`A developer's bank reversed a ${money(p.amountCents)} payment (${p.stripePaymentIntentId ?? "no payment id"}). The developer's account is on a chargeback hold.`, `${appUrl()}/admin#chargebacks`, "", "Playtest"].join("\n"), button: { label: "Open the admin console", url: `${appUrl()}/admin#chargebacks` } }).catch((e) => console.error("[email] chargeback:", e.message));
  if (!started) {
    const line = `Your bank reversed a ${money(p.amountCents)} payment${c ? ` for ${displayName(c.tester)}` : ""}: ${before.holdStartedAt && before.holdReason !== "chargeback" ? "your payment hold is now a chargeback hold" : "it was added to what you owe"}`;
    // A payment hold that becomes a chargeback hold is a chargeback hold starting (its email ignores Off); a further chargeback just adds to what is owed.
    if (before.holdStartedAt && before.holdReason !== "chargeback") await notify(before.email, line, [line + ".", "To resume: verify a card with 3D Secure, pay what you owe, and wait for the team's approval."], "/app/payments#chargeback-steps", { always: true, payment: true, group: "payhold" });
    else await bell(p.developerId, line, "/app/payments#chargeback-steps", undefined, { payment: true, group: "payhold" });
  }
  await db.user.update({ where: { id: p.developerId }, data: { chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
  return true;
}

/**
 * (Owner, Oct 29, batch 10) Stripe's `charge.dispute.closed` with status `won`: the platform won the chargeback, and Stripe returns the money and the fee. That chargeback's
 * amount leaves what the developer owes. If they already paid it (the repay charge), that amount is refunded to their card, with a receipt line. When no chargeback is left
 * open, a chargeback hold becomes a plain payment hold: it lifts as usual once nothing is owed (from the 4th hold on, an admin's Approve is still needed). The developer gets a
 * bell and an email. Returns false when the payment is unknown or the win was already handled.
 */
export async function chargebackWon(paymentIntentId: string) {
  const p = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!p || (p.chargeback !== "open" && p.chargeback !== "resolved")) return false;
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // Already paid back with "Pay what you owe": refund that charge (the amount and, since batch 11, the fee) to their card. Refunds come first (idempotent at Stripe), so
  // a webhook retried after a failed refund still refunds.
  let refunded = 0;
  for (const r of await db.payment.findMany({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up"] } } })) {
    // (Batch 23 section 6) The amount too: a repay taken from a reservation shares its PaymentIntent with the other payments it covered.
    if (r.stripePaymentIntentId) await getStripe().refunds.create({ payment_intent: r.stripePaymentIntentId, amount: r.amountCents }, { idempotencyKey: serverKey("cbwon", r.id) });
    if ((await db.payment.updateMany({ where: { id: r.id, status: r.status }, data: { status: "refunded" } })).count !== 1) continue;
    refunded += r.amountCents;
    const line = chargebackRefundLine(p.amountCents);
    await notify(dev.email, line, [`${line}: ${money(r.amountCents)} refunded.`, r.stripePaymentIntentId ? "Refunded to your saved card." : "Payments aren't set up yet, so this was recorded and nothing was refunded."], "/app/payments", { payment: true });
  }
  const claimed = await db.payment.updateMany({ where: { id: p.id, chargeback: p.chargeback }, data: { chargeback: "won" } });
  if (claimed.count !== 1) return false;
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
  // (Batch 11) A payments-kind stop-once line on the developer's test page and Edit (Alerts can ignore it).
  if (c) await (await import("./live")).logEvent(c.testId, "payment", chargebackReversedLine(p.amountCents, refunded || p.amountCents + CHARGEBACK_FEE_CENTS, refunded > 0), c.id);
  await notify(dev.email, chargebackWonLine(p.amountCents), [chargebackWonLine(p.amountCents)], "/app/payments", { payment: true, group: "payhold" });
  // No chargeback left open: the hold is a payment hold again (it lifts once nothing is owed; the 4th hold on still needs the admin's Approve).
  if (dev.holdStartedAt && dev.holdReason === "chargeback" && !(await db.payment.count({ where: { developerId: dev.id, chargeback: "open" } }))) {
    await db.user.update({ where: { id: dev.id }, data: { holdReason: "unpaid", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
    // (Batch 23 section 6) A payment hold charges at once again: what was reserved for the team's approval is released (nothing taken).
    await (await import("./chargeback")).releaseReservations(dev.id);
  }
  await liftHoldIfClear(dev.id);
  return true;
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
  // (Batch 23 section 1) Emails that failed are tried again when due (first: a later step's error never holds them up). (Batch 23 section 6) Reservations past their
  // days are released.
  // (Batch 26 section 1) The app's own heartbeat first (wall-clock time, never a test's `now`): a gap of 15 minutes or more since the last sweep is an outage.
  await (await import("./outages")).sweepGap().catch((e) => console.error("[outage] heartbeat:", (e as Error).message));
  await (await import("./email")).retryEmails(now).catch((e) => console.error("[email] retry:", (e as Error).message));
  await (await import("./chargeback")).expireReservations(now).catch((e) => console.error("[reserve] expire:", (e as Error).message));
  await (await import("./calls")).sweepNobodyJoined(now);
  const choices = (await openCharges(now, co)) + (await autoChargeCalls(now));
  // (Batch 29 §22, §31) The one-a-day money lines across tests: the tester's "Charge or let go", the developer's "Pay now".
  await testerChargeLines(now, co);
  await payNowLines(now, co);
  await closeOutReminders(now, co);
  await reviewReminders(now, co);
  await (await import("./ratings")).ratingReminders(now);
  return { choices };
}

/** The daily job: auto-pay after the review window, closing tests paused for 7 days, the paused reminders, Open until heads-ups and each tester's own deadline reminders. (No retries and no owed window any more: a declined payment is a hold at once.) */
export async function runDaily(now = new Date()) {
  // (Batch 19 section 4) Under the timers lock, so a 5-minute sweep never runs at the same moment (it waits for one that is running).
  return (await withTimersLock(() => runDailyLocked(now), { waitMs: 60_000 })) ?? runDailyLocked(now);
}

async function runDailyLocked(now: Date) {
  const out = { autoPaid: 0, holds: 0, alerts: 0, headsUps: 0, choices: 0, retried: 0, closed: 0 };
  // (Batch 17 §19) Each piece's closing dates (the developer's Pay, the tester's Charge), looked up once per run.
  const co = closeOutMemo(now);
  await (await import("./email")).retryEmails(now).catch((e) => console.error("[email] retry:", (e as Error).message)); // (batch 23 section 1)
  await (await import("./chargeback")).expireReservations(now).catch((e) => console.error("[reserve] expire:", (e as Error).message)); // (batch 23 section 6)
  await (await import("./calls")).sweepNobodyJoined(now);
  // (Batch 11) Bank confirmations that timed out, then the automatic retries of what is owed during a hold.
  await (await import("./confirm")).expireActions(now);
  if (stripeOn()) for (const u of await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: { not: "chargeback" }, deletedAt: null, stripePaymentMethodId: { not: null } }, select: { id: true } })) await retryOwed(u.id, now).catch((e) => console.error("[retry]", (e as Error).message));
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
  await rs.payoutWaitReminders(now); // (batch 32 §1) money waiting for payout setup
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
    ...chargebacks.map((p) => ({ kind: "chargeback", text: `Open chargeback: ${money(p.amountCents)}`, link: "/admin#chargebacks" })),
    ...holds.map((u) => ({ kind: "hold", text: `${u.email} on a ${u.holdReason === "chargeback" ? "chargeback" : "payment"} hold since ${fmtDate(u.holdStartedAt!)}`, link: "/admin#holds" })),
    ...payouts.map((p) => ({ kind: "payout", text: p.transferStatus === "waiting" ? `Payout waiting for a payout account: ${money(p.testerCents)}` : `Failed charge still owed: ${money(p.amountCents)}`, link: "/admin#payouts" })),
  ];
}

/** For the "Pay what you owe" box: failed charges and reversed payments. */
export async function owedForBox(devId: string) {
  return owedLines(devId);
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
      const line = unreviewedLine(c.title, displayName(c.tester), s.kind === "recording" ? "recording" : "written answers", chargeOpensAt(s, c.test, c, now)!, null);
      await bell(c.test.developerId, line, `/app/tests/${c.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
      await db.submission.update({ where: { id: s.id }, data: { devRemindedAt: now } });
    }
    if (gone || chargeShut) continue; // the tester can't sign in: Charge and Let it go never open (or, batch 17 §19, they closed)
    // Contract price already paid in full for this part: no Charge / Let it go, no day-14 notice, no reminders.
    const paidPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    if (chargeAmount(s.agreedCents, paidPart) === 0) continue;
    if (!s.choiceOfferedAt) {
      const by = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
      await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: now, choiceBy: by, remindedAt: now } });
      // (Owner, Oct 29, batch 29 §22) No line of its own: the tester's ONE daily "Charge or let go" line (testerChargeLines) starts today.
      await db.$transaction((tx) => recordEvent(tx, c.testId, "choice", `${displayName(c.tester)} can now charge or let go of their ${s.kind === "recording" ? "recording" : "written answers"}`, false, {}, c.id));
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
    else await notify(e.email, line, [line + "."], "/app#needs-review", { always: true, payment: true, group: "closeout", reminder: key }); // (batch 30 §6) where the pieces are: Needs review, marked
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
    await notify(emails.get(devId)!, line, [line + "."], "/app#needs-review", { always: true, payment: true, group: "unreviewed", reminder: "paynow" }); // (batch 30 §6) Needs review, marked
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
    await notify(emails.get(testerId)!, line, [line + "."], "/app#charge-or-cancel", { always: true, payment: true, group: "charge", reminder: "chargeday" });
  }
}

/**
 * (Owner, Oct 29, batch 28) The developer's daily line once a sent part's review date passed: "“Harbor Run”: Ana Silva's written answers wasn't reviewed by Oct 30:
 * Ana Silva can now charge or let it go. You can still pay until they do (at the latest Nov 13)." With no Charge for the tester (a deleted tester, or their Charge
 * closed): "… wasn't reviewed by Oct 30: pay it." The dates are time tokens (the reader's zone), also in the email.
 */
export const unreviewedLine = (title: string, name: string, part: string, reviewDate: Date, closesAt: Date | null | undefined) =>
  `“${title}”: ${name}'s ${part} ${part.endsWith("s") ? "weren't" : "wasn't"} reviewed by ${T(reviewDate, "date")}: ${closesAt === null ? "pay it." : `${name} can now charge or let it go. You can still pay until they do${closesAt ? ` (at the latest ${T(closesAt, "date")})` : ""}.`}`;

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
export const autoPaidTesterLine = (dev: string, cents: number, at: Date) => `${dev} paid you ${money(cents)} for your call on ${T(at, "date")}`;
/**
 * (Owner, Oct 29, batch 28 §21; replaces Charge / Let it go for listed calls) A LISTED call not paid 7 days after it (its payBy, moved by pauses and outages) is charged
 * automatically: rate × measured minutes, less what's paid, within the $1,000 for that tester's calls; off-session, as a payment made while the developer is away. Each
 * call once: its review row is claimed first (unique per call), and the charge's key is the call's. Bank asks: "Your bank wants you to confirm" (3 days, then declined).
 * Declined: a payment hold. During a hold: added to what's owed. A team pause waits. Nothing to charge (no measured time, or the $1,000 used): closed with $0.
 * Listed calls whose Charge had already opened switch to this. Returns how many were charged.
 */
export async function autoChargeCalls(now: Date) {
  let n = 0;
  // (Batch 29 §37) A developer who deleted their account is charged too, on the card they saved (as a tester's Charge was before batch 28 §21); with no saved card
  // the call stays unpaid ("<dev> deleted their account, so this can't be paid.").
  const due = await db.call.findMany({ where: { review: null, status: "booked", rateCents: { not: null }, payBy: { lt: now }, contract: { test: { adminPausedAt: null }, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } }, take: 1000 });
  for (const x of due) {
    const minutes = callMinutesOf(x);
    if (minutes == null || x.rateCents == null) continue;
    const c = x.contract, dev = c.test.developer, name = displayName(c.tester);
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
      await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${name}'s call on ${fmtDateTime(x.startsAt)} closed with nothing to pay`, false, {}, c.id));
      continue;
    }
    const what = `${name}'s call on ${T(x.startsAt, "date")} (charged automatically after ${REVIEW_DAYS} days)`;
    // (Batch 29 §37) The tester's call reads "may be delayed" (never "failed" or "hold") while the money waits: the same line as for a declined charge.
    const tellDelayed = () => notify(c.tester.email, `Payment for your call on “${c.title}” may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { payment: true, group: "tdelayed" });
    // (Batch 29 §37) The developer's event says what really happened (charged, waiting for the bank, declined, owed, waiting for the account).
    const logged = (text: string) => db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${text}`, false, {}, c.id));
    if (!gone && dev.devSuspendedAt && !dev.holdStartedAt) {
      // During a suspension: it waits and is charged when the account is clear (chargeDeferred on the reinstatement); the tester is paid then.
      await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "deferred" } });
      await tellDelayed();
      await logged(`${name}'s call was charged automatically: ${money(amount)}, charged when your account is clear`);
      n++;
      continue;
    }
    if (!gone && dev.holdStartedAt) {
      // During a hold: added to what's owed (as a tester's Charge is); the tester is paid when the developer pays it.
      await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "owed" } });
      await bell(dev.id, `${name}'s call on “${c.title}” was charged automatically (${money(amount)}): it was added to what you owe`, dev.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
      await tellDelayed();
      await logged(`${name}'s call was charged automatically: ${money(amount)}, added to what you owe`);
      n++;
      continue;
    }
    const row = await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
    let outcome = `${name}'s call was charged automatically: ${money(amount)}`;
    try {
      const r = await charge(dev, c.tester, amount, payKey, `Playtest: live call on “${c.title}” (charged automatically after ${REVIEW_DAYS} days)`);
      if (r.status === "requires_action") {
        await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
        await tellDelayed();
        outcome = `${name}'s call was charged automatically: ${money(amount)}, waiting for your bank to confirm it`;
      } else {
        await db.payment.update({ where: { id: row.id }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) } });
        await receipt(dev.email, what, amount, r.status, `/app/tests/${c.testId}#call-${x.id}`);
        const line = autoPaidTesterLine(displayName(dev), amount, x.startsAt);
        // (Batch 30 §20) In the day's "You were paid" stack with the other payments (it arrived on time: not "Delayed payments arrived").
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}#call-${x.id}`, { payment: true, group: "tpaid" });
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
      await declinedPayment(dev.id, failed.id, amount, `${name}'s call on “${c.title}”`);
      outcome = gone ? `The automatic charge for ${name}'s call (${money(amount)}) was declined` : `The automatic charge for ${name}'s call (${money(amount)}) was declined: it was added to what you owe`;
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
    await bell(devId, line, tests.length === 1 ? `/app/tests/${tests[0]}#needs-you` : "/app#needs-review", undefined, { reminder: key });
  }
}

/** The tester's choice on a contract part (or, batch 15 section 15, a listed call) unreviewed for the review window: "charge" (the listing minus what is paid) or "letgo". */
export async function chooseOutcome(tester: { id: string; email: string; name: string }, contractId: string, body: Record<string, unknown>) {
  if (body.callId) return chooseCallOutcome(tester, contractId, body);
  const s = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!s || s.contractId !== contractId || s.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That work doesn't exist.");
  const c = s.contract, dev = c.test.developer, label = s.kind === "recording" ? "recording" : "written answers";
  // (Owner, Oct 29, batch 12 section 5) While the developer's bank confirms a payment for this piece, Charge and Let it go wait.
  if (await (await import("./confirm")).pieceLocked({ submissionId: s.id })) throw new HttpError(409, "locked", PIECE_LOCKED);
  if (s.review) {
    if (byTesterChoice(s.review.reason)) throw new HttpError(409, "done", "You already chose for this.");
    throw new HttpError(409, "done", s.review.rejected ? `${displayName(dev)} rejected this meanwhile.` : `${displayName(dev)} paid ${money(s.review.amountCents)} for this meanwhile.`);
  }
  // (Batch 17 §19) After the piece closed nothing is offered any more (even a piece whose Charge never opened).
  await chargeCloseOutGate({ submissionId: s.id });
  // (Batch 30 §3) Work sent after the tester's own deadline never opens Charge or Let it go.
  if (s.late) throw new HttpError(409, "late", NO_CHARGE_LATE);
  if (!s.choiceOfferedAt) throw new HttpError(409, "not_yet", `You can choose once ${REVIEW_DAYS} days have passed since you sent it and your deadline has passed.`);
  await testerTermsGate(contractId, displayName(dev), body);
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
  const review = await db.review.create({ data: { submissionId: s.id, contractId: c.id, amountCents: amount, agreedCents: s.agreedCents, reason: choice === "charge" ? CHARGED_BY_TESTER : LET_GO_BY_TESTER, payKey } }).catch(() => null);
  if (!review) throw new HttpError(409, "done", "This was already settled.");
  if (choice === "letgo") {
    await db.$transaction((tx) => recordEvent(tx, c.testId, "rejected", `${displayName(tester)} let their ${label} go: nothing charged`, false, {}, c.id));
    return { choice, amountCents: 0 };
  }
  // (Owner, Oct 28 afternoon) During a payment or chargeback hold the Charge goes through as the tester's choice but isn't charged yet: it is added to the developer's
  // "Pay what you owe", and the tester is paid when the developer pays it. (During an admin suspension with no hold, or the team's pause, it is charged at once below.)
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, holdReason: true } });
  if (devNow.holdStartedAt) {
    await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "owed" } });
    await bell(dev.id, `${displayName(tester)} charged ${money(amount)} for their ${label} on “${c.title}”: it was added to what you owe`, devNow.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
    await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their ${label}`, false, {}, c.id));
    return { choice, amountCents: amount, status: "owed", message: chargedDelayedLine(amount) };
  }
  // (Batch 15 section 9) The payment row is reserved (pending) before the charge, so a lost answer from Stripe can be found and finished or cleared later.
  const row = await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
  let status = "charged";
  try {
    const r = await charge(dev, c.tester, amount, payKey, `Playtest: ${label} on “${c.title}” (charged by the tester)`);
    status = r.status;
    if (r.status === "requires_action") {
      // (Batch 11) The developer's bank wants them to confirm: it waits 3 days for their Confirm in Payments; the tester reads "Payment may be delayed".
      await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
      await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}#part-${s.kind}`, { payment: true, group: "tdelayed" });
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
      throw e instanceof HttpError ? e : new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
    }
    status = "failed";
    // (Owner, Oct 27) A declined Charge starts the payment hold at once (the tester reads only "delayed").
    const failed = await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}#part-${s.kind}`, { payment: true, group: "tdelayed" });
    await declinedPayment(dev.id, failed.id, amount, `${displayName(tester)}'s ${label} on “${c.title}”`);
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their ${label}`, false, {}, c.id));
  return { choice, amountCents: amount, status, ...(status === "needs_confirmation" ? { message: `Charged ${money(amount)}. Payment may be delayed.` } : {}) };
}

/** (Batch 17 §19) Charge and Let it go close on the piece's own closing date for the tester (final: the piece stays unpaid). */
async function chargeCloseOutGate(where: { submissionId: string } | { callId: string }) {
  const at = await pieceCloseOut(where, "tester");
  if (closedOut(at)) throw new HttpError(409, "charge_closed", chargeClosedLine(fmtDate(at!)));
}

/** (Batch 15 sections 15, 34 and 40) The tester's Charge / Let it go on a listed call left unpaid past its review date. */
async function chooseCallOutcome(tester: { id: string; email: string; name: string }, contractId: string, body: Record<string, unknown>) {
  const x = await db.call.findUnique({ where: { id: String(body.callId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!x || x.contractId !== contractId || x.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That call doesn't exist.");
  const c = x.contract, dev = c.test.developer, label = "live call";
  if (await (await import("./confirm")).pieceLocked({ callId: x.id })) throw new HttpError(409, "locked", PIECE_LOCKED);
  if (x.review) {
    if (byTesterChoice(x.review.reason)) throw new HttpError(409, "done", "You already chose for this.");
    throw new HttpError(409, "done", `${displayName(dev)} paid ${money(x.review.amountCents)} for this meanwhile.`);
  }
  // (Owner, Oct 29, batch 28 §21) A listed call is charged automatically: no Charge or Let it go (an older page's press).
  if (x.rateCents != null) throw new HttpError(409, "auto_charge", AUTO_CHARGE_NO_CHOICE);
  // (Batch 17 §19) After the piece closed nothing is offered any more (even a piece whose Charge never opened).
  await chargeCloseOutGate({ callId: x.id });
  if (!x.choiceOfferedAt) throw new HttpError(409, "not_yet", `You can choose once ${REVIEW_DAYS} days have passed since the call and your deadline has passed.`);
  await testerTermsGate(contractId, displayName(dev), body);
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
  const review = await db.review.create({ data: { callId: x.id, contractId: c.id, amountCents: amount, agreedCents: x.rateCents != null && minutes != null ? callReference(x.rateCents, minutes).cents : null, reason: choice === "charge" ? CHARGED_BY_TESTER : LET_GO_BY_TESTER, payKey } }).catch(() => null);
  if (!review) throw new HttpError(409, "done", "This was already settled.");
  if (choice === "letgo") {
    await db.$transaction((tx) => recordEvent(tx, c.testId, "rejected", `${displayName(tester)} let their call on ${fmtDateTime(x.startsAt)} go: nothing charged`, false, {}, c.id));
    return { choice, amountCents: 0 };
  }
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, holdReason: true } });
  if (devNow.holdStartedAt) {
    await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "owed" } });
    await bell(dev.id, `${displayName(tester)} charged ${money(amount)} for their call on “${c.title}”: it was added to what you owe`, devNow.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
    await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their call`, false, {}, c.id));
    return { choice, amountCents: amount, status: "owed", message: chargedDelayedLine(amount) };
  }
  const row = await db.payment.create({ data: { kind: "call", callId: x.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "pending", payKey } });
  let status = "charged";
  try {
    const r = await charge(dev, c.tester, amount, payKey, `Playtest: ${label} on “${c.title}” (charged by the tester)`);
    status = r.status;
    if (r.status === "requires_action") {
      await (await import("./confirm")).awayAction(row.id, r as NeedsAction);
      await notify(c.tester.email, `Payment for your call on “${c.title}” may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { payment: true, group: "tdelayed" });
      status = "needs_confirmation";
    } else {
      return finishChoicePay(row.id, r);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", (await import("./recovery")).PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      await db.payment.delete({ where: { id: row.id } });
      await db.review.delete({ where: { id: review.id } });
      throw e instanceof HttpError ? e : new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
    }
    status = "failed";
    const failed = await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await notify(c.tester.email, `Payment for your call on “${c.title}” may be delayed`, ["Payment for your call may be delayed."], `/app/sessions/${c.id}#call-${x.id}`, { payment: true, group: "tdelayed" });
    await declinedPayment(dev.id, failed.id, amount, `${displayName(tester)}'s call on “${c.title}”`);
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their call`, false, {}, c.id));
  return { choice, amountCents: amount, status, ...(status === "needs_confirmation" ? { message: `Charged ${money(amount)}. Payment may be delayed.` } : {}) };
}

/** (Batch 15 section 9) A tester's Charge went through (at once, or found later by the stuck-payment check): recorded, the receipt sent. */
export async function finishChoicePay(paymentId: string, r: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.update({ where: { id: paymentId }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const label = p.callId ? "call" : (await db.submission.findUnique({ where: { id: p.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers";
  await receipt(c.test.developer.email, `${displayName(c.tester)}'s ${label} (charged by them after ${REVIEW_DAYS} days)`, p.amountCents, r.status, `/app/tests/${c.testId}`);
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(c.tester)} charged ${money(p.amountCents)} for their ${label}`, false, {}, c.id));
  return { choice: "charge" as const, amountCents: p.amountCents, status: r.status };
}

/**
 * (Owner, Oct 26-27) Daily bell reminders: a developer with applications / rejoin asks waiting for an answer gets a line a day per test (stacks with that test's other
 * same-day lines; waits while the test is paused). (The paused-tests reminder is in pauseClosure.ts.)
 */
async function dailyReminders(now: Date) {
  const since = new Date(now.getTime() - 20 * 3_600_000);
  const waiting = await db.application.groupBy({ by: ["testId"], where: { status: "pending" }, _count: { _all: true } });
  const tests = await db.test.findMany({ where: { id: { in: waiting.map((w) => w.testId) }, status: "open", ...PAUSE_FREE }, select: { id: true, title: true, developerId: true } });
  const told = new Set((await db.notification.findMany({ where: { userId: { in: tests.map((t) => t.developerId) }, testId: { in: tests.map((t) => t.id) }, text: { endsWith: "for your answer" }, createdAt: { gt: since } }, select: { testId: true }, distinct: ["testId"] })).map((n) => n.testId));
  const count = new Map(waiting.map((w) => [w.testId, w._count._all]));
  // (Batch 15 section 35: "N applications wait"; no times in this line.)
  await db.notification.createMany({
    data: tests.filter((t) => !told.has(t.id)).map((t) => {
      const n = count.get(t.id)!;
      return { userId: t.developerId, testId: t.id, reminderKey: `applications:${t.id}`, text: `“${t.title}”: ${n} ${n === 1 ? "application or rejoin ask waits" : "applications and rejoin asks wait"} for your answer`, link: `/app/tests/${t.id}#needs-you` };
    }),
  });
}
