import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, toCents } from "@/lib/format";
import {
  HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL, autoPayFor, chargeAmount, CHARGED_BY_TESTER, byTesterChoice, chargedDelayedLine, countdownDue, INVITE_REMIND_DAYS, choiceLine, failedLine, headsUpLine, LET_GO_BY_TESTER, REMIND_DAYS, UNLISTED_REMIND_DAYS, REVIEW_DAYS, chargeIsOpen, chargeOpensAt, PAUSED_RIGHT_NOW, PAY_WAITS, pauseShiftMs, STILL_SUSPENDED_LINE, PAYABLE_TESTER, PIECE_LOCKED, HOLD_RETRY_MAX, retriedLine, chargebackRefundLine, chargebackWonLine, CHARGEBACK_FEE_CENTS, chargebackOwedLine, chargebackReversedLine,
} from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify, sendSummaries } from "./notify";
import { appUrl } from "./auth";
import { accountEvent, labelled, reportedOver3 } from "./reports";
import { sendEmail } from "./email";
import { PAYMENTS_PROBLEM, charge, chargePlatform, getStripe, stripeOn, type NeedsAction } from "./stripe";
import { serverKey } from "./pressKeys";
import { receipt } from "./payments";
import { testerTermsGate } from "./terms";
import { recordEvent } from "./tests";
import { PAUSE_CLOSE_DAYS } from "@/lib/pause";

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
    try {
      const r = await charge(dev, tester, p.amountCents, serverKey("deferred", p.id), "Playtest: charged now that the account is clear");
      if (r.status === "requires_action") { await (await import("./confirm")).awayAction(p.id, r as NeedsAction); continue; }
      await db.payment.update({ where: { id: p.id }, data: { ...r } });
      await receipt(dev.email, p.kind === "dispute" ? "a team decision (charged after the pause)" : "work you paid for during the pause", p.amountCents, r.status, p.contractId ? `/app/tests/${(await db.contract.findUnique({ where: { id: p.contractId }, select: { testId: true } }))?.testId}` : "/app/payments");
      await tellArrived(p, tester.email, displayName(dev));
    } catch (e) {
      // (Batch 15 section 41, M1) Only a card error is a decline; any other problem leaves it waiting for the next time.
      if (e instanceof HttpError && e.code === "card_failed") await declinedPayment(devId, p.id, p.amountCents, p.kind === "dispute" ? "a team decision" : "work you paid for during the pause");
    }
  }
}

/**
 * Lift the hold when nothing is owed and no chargeback is open; move every clock on by the length of the pause.
 * (Owner, Oct 26) A CHARGEBACK hold is a hold with extra steps: paying what is owed never lifts it alone. It also needs a card re-verified with
 * 3D Secure after the chargeback and the admin's approval (which also closes the chargeback).
 */
export async function liftHoldIfClear(devId: string) {
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
  // (Batch 8) The subscription's paid days left resume (unless a suspension is still on).
  await (await import("./subscription")).resumeBilling(devId, now);
  await chargeDeferred(devId);
  // (Owner, Oct 29, batch 10) "Your tests are running again" only when nothing pauses them any more: with an admin suspension still on, the payment line instead (both ignore Off).
  if (dev.devSuspendedAt) await notify(dev.email, STILL_SUSPENDED_LINE, [STILL_SUSPENDED_LINE], "/app", { always: true, payment: true, group: "payhold" });
  else await notify(dev.email, "Your tests are running again", ["Everything you owed is paid: your tests are running again, and every deadline moved on by the pause."], "/app", { always: true, payment: true, group: "payhold" });
  const testers = await db.contract.findMany({ where: { status: "working", testId: { in: running } }, include: { tester: true } });
  for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`, { group: "paused" });
  return true;
}

/** Admins get one bell line when a hold lift is waiting for them (after the developer paid): it stacks with the day's new-dispute lines and links to the row. */
async function tellAdminsLiftWaiting(dev: { id: string; email: string; name: string; holdCount: number; holdStartedAt: Date | null }) {
  const flagged = (await reportedOver3([dev.id])).has(dev.id);
  const text = `Hold lift waiting: ${labelled(displayName(dev), flagged)} paid what they owe (${MANY_HOLDS_LABEL})`;
  for (const a of await adminUsers()) {
    if (await db.notification.count({ where: { userId: a.id, text, createdAt: { gt: dev.holdStartedAt ?? new Date(0) } } })) continue;
    await bell(a.id, text, `/admin#lift-${dev.id}`, undefined, { group: "disputes" });
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
  const list = await owed(dev.id);
  const total = list.reduce((a, p) => a + p.amountCents, 0);
  // (Owner, Oct 29, batch 10) Paid meanwhile (another tab, or a won chargeback): nothing is charged, ever twice.
  // (A hold left with nothing owed still lifts here, charging nothing.)
  if (!list.length) {
    if (await liftHoldIfClear(dev.id)) return { paid: 0, stillFailing: [] as string[], lifted: true };
    throw new HttpError(409, "nothing_owed", NOTHING_OWED);
  }
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
  const stillFailing: string[] = [];
  let paid = 0;
  // (Batch 11) Payments the bank wants the developer to confirm in the page (its pop-up, then /api/payments/confirm).
  const confirm: Awaited<ReturnType<typeof import("./confirm").pressAction>>[] = [];
  for (const p of list) {
    const r = await chargeOwedOne(u, p, "press");
    if (r.result === "paid") paid++;
    else if (r.result === "action") confirm.push(r.action);
    else if (r.result === "failed") stillFailing.push(`${lines.find((l) => l.id === p.id)?.text ?? money(p.amountCents)} (${r.why.replace(/\.$/, "")})`);
  }
  // The hold lifts only when all are paid; a chargeback hold also needs the card check and the admin's approval.
  const lifted = await liftHoldIfClear(dev.id);
  return { paid, stillFailing, lifted, confirm };
}

type OwedRow = Awaited<ReturnType<typeof owed>>[number];
type OneResult = { result: "paid"; cents: number } | { result: "action"; action: Awaited<ReturnType<typeof import("./confirm").pressAction>> } | { result: "waiting" } | { result: "failed"; why: string } | { result: "skipped" };
/**
 * Charge ONE owed payment on the saved card. "press": the developer's own "Pay what you owe" (on-session: the bank may ask them to confirm in the page). "away": an automatic
 * retry during the hold (batch 11 section 4; the bank's confirmation then waits 3 days for Confirm in Payments). Each payment is claimed first, so it is never charged twice.
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
      await receipt(u.email, "a payment your bank had reversed", p.amountCents, r.status, "/app/payments");
      return { result: "paid", cents: p.amountCents };
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
    await receipt(u.email, "an amount you owed", p.amountCents, r.status, "/app/payments");
    await tellArrived(p, tester.email, displayName(u));
    return { result: "paid", cents: p.amountCents };
  } catch (e) {
    await db.payment.update({ where: { id: p.id }, data: { status: was, warnedAt: null } });
    return { result: "failed", why: owedWhy(e) };
  }
}
/** (Batch 15 section 41, L4) Why one owed payment failed, in plain words (never Stripe's raw text). */
const owedWhy = (e: unknown) => (e instanceof HttpError && e.code === "card_failed" ? "Your card was declined." : e instanceof HttpError && e.code === "payments_problem" ? PAYMENTS_PROBLEM : "It didn't go through. Try again shortly.");

/**
 * (Owner, Oct 29, batch 11 section 4) While a payment hold or chargeback hold lasts, what is owed is retried on the saved card: once a day, at most HOLD_RETRY_MAX tries a
 * hold ("daily"), and at once when the developer saves a new card ("card", not counted). Success: those lines are paid (an open Payments page updates live and a press stops
 * once), the developer gets "We charged your card $X for what you owed.", and the hold lifts as if they had pressed Pay (the 4th hold on still needs Approve; a chargeback
 * hold still needs the card check and Approve; a suspension is never lifted by a payment). A failed retry sends nothing: Payments shows the last and next try.
 */
export async function retryOwed(devId: string, now = new Date(), why: "daily" | "card" = "daily") {
  const u = await db.user.findUnique({ where: { id: devId } });
  if (!u?.holdStartedAt || u.deletedAt) return null;
  if (why === "daily" && (u.holdRetries >= HOLD_RETRY_MAX || (u.holdRetryAt && now.getTime() - u.holdRetryAt.getTime() < 23 * 3_600_000))) return null;
  // No saved card (or payments not set up): nothing to retry on.
  if (!stripeOn() || !u.stripeCustomerId || !u.stripePaymentMethodId) return null;
  const list = (await owed(devId)).filter((p) => !p.actionPi);
  if (!list.length) return null;
  await db.user.update({ where: { id: devId }, data: { holdRetryAt: now, ...(why === "daily" ? { holdRetries: { increment: 1 } } : {}) } });
  let cents = 0;
  for (const p of list) {
    const r = await chargeOwedOne(u, p, "away");
    if (r.result === "paid") cents += r.cents;
  }
  if (cents > 0) await bell(devId, retriedLine(cents), "/app/payments", undefined, { payment: true, group: "payhold" });
  const lifted = cents > 0 ? await liftHoldIfClear(devId) : false;
  return { cents, lifted };
}

/** (Batch 11) An owed payment a "Pay what you owe" press is charging right now. */
const PAYING = "paying";
/** (Batch 10) "Pay what you owe" pressed when nothing is owed any more (paid in another tab meanwhile). */
export const NOTHING_OWED = "There's nothing to pay: what you owed is already paid.";

/** (Batch 10) Claim the repay of one reversed payment: one "paying" repay row at a time, made under a row lock; null when it is paid or being paid already. */
async function claimChargebackRepay(p: { id: string; contractId: string | null; testerId: string; amountCents: number }, devId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${p.id} FOR UPDATE`;
    const busy = await tx.payment.findFirst({ where: { repaysId: p.id, status: { in: ["charged", "not_set_up", PAYING, "needs_action", "needs_confirmation"] } } });
    if (busy) return null;
    return tx.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: devId, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", status: PAYING } });
  });
}

/** (Batch 11) A payment that waited (owed, or for the bank's confirmation) went through: the developer's receipt and the tester's paid line. */
export async function settledOwed(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  await receipt(dev.email, p.kind === "dispute" ? "a team decision" : "an amount you owed", p.amountCents, p.status, "/app/payments");
  if (p.kind !== "chargeback" && p.kind !== "subscription") await tellArrived(p, tester.email, displayName(dev));
}

/** The tester's one notice when a delayed payment goes through: the normal paid line. */
async function tellArrived(p: { contractId: string | null; submissionId: string | null; callId: string | null; kind: string; amountCents: number }, email: string, devName: string) {
  const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
  const label = p.kind === "dispute" ? "dispute" : p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
  const line = `${devName} paid ${money(p.amountCents)} for your ${label}`;
  await notify(email, line, [line + "."], p.contractId ? `/app/sessions/${p.contractId}#${p.callId ? "part-live" : sub?.kind === "recording" ? "part-recording" : "part-written"}` : "/app/payments", { payment: true, group: "tarrived" });
}

/** One line per failed payment ("Ana Silva's written answers $8.00 · card declined Oct 20"), plus open chargebacks. */
export async function owedLines(devId: string) {
  const list = await owed(devId);
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
        ? { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, source: "owed" as const, text: `${what} ${money(p.amountCents)} · ${p.kind === "dispute" ? "the team's dispute decision" : "charged by the tester"} while your tests were paused` }
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
  for (const a of to) await sendEmail({ to: a, subject: `Playtest: new chargeback of ${money(p.amountCents)}`, text: [`A developer's bank reversed a ${money(p.amountCents)} payment (${p.stripePaymentIntentId ?? "no payment id"}). The developer's account is on a chargeback hold.`, `${appUrl()}/admin#chargebacks`, "", "Playtest"].join("\n") }).catch((e) => console.error("[email] chargeback:", e.message));
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
    if (r.stripePaymentIntentId) await getStripe().refunds.create({ payment_intent: r.stripePaymentIntentId }, { idempotencyKey: serverKey("cbwon", r.id) });
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
  if (dev.holdStartedAt && dev.holdReason === "chargeback" && !(await db.payment.count({ where: { developerId: dev.id, chargeback: "open" } })))
    await db.user.update({ where: { id: dev.id }, data: { holdReason: "unpaid", chargebackCardVerifiedAt: null, chargebackApprovedAt: null } });
  await liftHoldIfClear(dev.id);
  return true;
}

/** The daily job: auto-pay after the review window, closing tests paused for 7 days, the paused reminders, Open until heads-ups. (No retries and no owed window any more: a declined payment is a hold at once.) */
export async function runDaily(now = new Date()) {
  const out = { autoPaid: 0, holds: 0, alerts: 0, headsUps: 0, choices: 0, retried: 0, closed: 0 };
  await (await import("./calls")).sweepNobodyJoined(now);
  // (Batch 11) Bank confirmations that timed out, then the automatic retries of what is owed during a hold.
  await (await import("./confirm")).expireActions(now);
  if (stripeOn()) for (const u of await db.user.findMany({ where: { holdStartedAt: { not: null }, deletedAt: null, stripePaymentMethodId: { not: null } }, select: { id: true } })) await retryOwed(u.id, now).catch((e) => console.error("[retry]", (e as Error).message));
  // 1. Sent work not paid or rejected within the review window (REVIEW_DAYS, 7): the listing amount is paid automatically (clock paused in holds).
  const due = await db.submission.findMany({
    // (Owner, Oct 29, batch 11) A deleted tester's sent work is still reviewed (and reminded) when their payout account was connected; Charge never opens for it.
    where: { review: null, payBy: { lt: now }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
    orderBy: { payBy: "asc" },
    take: 1000,
  });
  for (const s of due) {
    const c = s.contract, dev = c.test.developer;
    const auto = autoPayFor(s.agreedCents);
    if (auto == null) continue; // outside the contract: its own reminder every 3 days (below)
    // (Owner, Oct 26) Charge / Let it go opens only when REVIEW_DAYS (7) have passed AND the test's Open until has passed (or, with none, the test or the tester's work ended).
    if (!chargeIsOpen(s, c.test, c, now)) continue;
    // Once it opens: the developer is reminded daily until it's paid, rejected, charged or let go.
    const gone = !!c.tester.deletedAt;
    if (!s.devRemindedAt || now.getTime() - s.devRemindedAt.getTime() >= 23 * 3_600_000) {
      await bell(dev.id, `“${c.title}”: ${displayName(c.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} waited over ${REVIEW_DAYS} days: pay or reject it${gone ? "" : ` (${displayName(c.tester)} can now charge or let it go)`}.`, `/app/tests/${c.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
      await db.submission.update({ where: { id: s.id }, data: { devRemindedAt: now } });
    }
    if (gone) continue; // the tester can't sign in: Charge and Let it go never open
    // Contract price already paid in full for this part: no Charge / Let it go, no day-14 notice, no reminders.
    const paidPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    if (chargeAmount(s.agreedCents, paidPart) === 0) continue;
    if (!s.choiceOfferedAt) {
      const by = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
      await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: now, choiceBy: by, remindedAt: now } });
      const line = choiceLine(displayName(dev), s.kind, auto);
      await notify(c.tester.email, line, [line], `/app/sessions/${c.id}#part-${s.kind}`, { group: "charge" });
      await db.$transaction((tx) => recordEvent(tx, c.testId, "choice", `${displayName(c.tester)} can now charge or let go of their ${s.kind === "recording" ? "recording" : "written answers"}`, false, {}, c.id));
      await (await import("./ratings")).maybePromptRating(c.id);
      out.choices++;
      continue;
    }
    {
      if (!s.remindedAt || now.getTime() - s.remindedAt.getTime() >= REMIND_DAYS * 86_400_000 - 3_600_000) {
        const line = choiceLine(displayName(dev), s.kind, auto);
        await notify(c.tester.email, `Reminder: ${line}`, [line], `/app/sessions/${c.id}#part-${s.kind}`, { group: "charge", reminder: `charge:${s.id}` });
        await db.submission.update({ where: { id: s.id }, data: { remindedAt: now } });
      }
      continue;
    }
  }
  // 3a. (Owner, Oct 27) ONE daily email per admin that can't be turned off, sent only when it has something in it (see adminDaily.ts).
  out.alerts = await (await import("./adminDaily")).adminDailyEmails(now);
  // 3c. (Owner, Oct 26) Paused tests close after 7 days, whatever the cause (the admin can extend a test's date or close it sooner).
  const pc = await import("./pauseClosure");
  await pc.pausedReminders(now); // (Owner, Oct 27) the developer's daily "<test> is paused and closes on <date> unless ..." (replaces the paused / day-before lines)
  out.closed = await pc.closePausedTests(now);
  // 4. Open until heads-ups, 3 days and 1 day before (developer and working testers).
  const closing = await db.test.findMany({ where: { status: { in: ["open", "closed"] }, openUntil: { gt: now }, ...PAUSE_FREE }, include: { developer: true, contracts: { where: { status: "working" }, include: { tester: true } } } });
  for (const t of closing) {
    const m = countdownDue(t.openUntil, now, t.notifiedMarks, t.createdAt);
    if (!m) continue;
    // Bell notifications only, never emailed.
    const line = headsUpLine(t.title, t.openUntil!, fmtDate);
    await bell(t.developerId, line, `/app/tests/${t.id}`, undefined, { reminder: `headsup:${t.id}` });
    for (const c of t.contracts) await bell(c.testerId, line, `/app/sessions/${c.id}`, undefined, { reminder: `headsup:${t.id}` });
    await db.test.update({ where: { id: t.id }, data: { notifiedMarks: { push: m.mark }, ...(m.mark === "1d" ? { notified1d: true, notified3d: true } : m.mark === "3d" ? { notified3d: true } : {}) } });
    out.headsUps++;
  }
  // 5. (Owner, Oct 27) The developer's unreviewed contract work: reminders before Charge would open (the daily ones once it has opened are in 1 above).
  const upcoming = await db.submission.findMany({ where: { review: null, choiceOfferedAt: null, agreedCents: { not: null }, payBy: { not: null }, contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true, test: true } } }, orderBy: { payBy: "asc" }, take: 2000 });
  for (const s of upcoming) {
    // (Batch 12 section 6) 1 week, 3 days and 1 day before Charge opens (skipping any already past); the daily ones after it opens are in 1 above.
    const opens = chargeOpensAt(s, s.contract.test, s.contract, now);
    const m = opens && opens.getTime() > now.getTime() ? countdownDue(opens, now, s.devMarks, s.updatedAt, true) : null;
    if (!m) continue;
    const name = displayName(s.contract.tester);
    await bell(s.contract.test.developerId, `“${s.contract.title}”: review ${name}'s ${s.kind === "recording" ? "recording" : "written answers"} ${m.label === "tomorrow" ? "by tomorrow" : m.label.replace("in ", "within ")}${s.contract.tester.deletedAt ? "" : ` (after that ${name} can charge or let it go)`}.`, `/app/tests/${s.contract.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
    await db.submission.update({ where: { id: s.id }, data: { devMarks: { push: m.mark } } });
  }
  // 6. Work outside the contract: no deadline, a bell to the developer every 3 days; (batch 9, DEFAULT UNLISTED_REMIND_DAYS) only for UNLISTED_REMIND_DAYS (7, batch 12) after it was sent (the row stays).
  const outside = await db.submission.findMany({ where: { review: null, agreedCents: null, updatedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000), gt: new Date(now.getTime() - UNLISTED_REMIND_DAYS * 86_400_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000) } }], contract: { test: PAUSE_FREE, tester: PAYABLE_TESTER } }, include: { contract: { include: { tester: true } } }, take: 500 });
  for (const s of outside) {
    await bell((await db.test.findUniqueOrThrow({ where: { id: s.contract.testId } })).developerId, `“${s.contract.title}”: ${displayName(s.contract.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} still waits for you to pay or reject.`, `/app/tests/${s.contract.testId}#piece-${s.id}`, undefined, { reminder: `outside:${s.id}` });
    await db.submission.update({ where: { id: s.id }, data: { remindedAt: now } });
  }
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

/** The tester's choice on a contract part unreviewed for the review window: "charge" (the listing minus what is paid) or "letgo". */
export async function chooseOutcome(tester: { id: string; email: string; name: string }, contractId: string, body: Record<string, unknown>) {
  const s = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!s || s.contractId !== contractId || s.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That work doesn't exist.");
  const c = s.contract, dev = c.test.developer, label = s.kind === "recording" ? "recording" : "written answers";
  // (Owner, Oct 29, batch 12 section 5) While the developer's bank confirms a payment for this piece, Charge and Let it go wait.
  if (await (await import("./confirm")).pieceLocked({ submissionId: s.id })) throw new HttpError(409, "locked", PIECE_LOCKED);
  if (s.review) {
    if (byTesterChoice(s.review.reason)) throw new HttpError(409, "done", "You already chose for this.");
    throw new HttpError(409, "done", s.review.rejected ? `${displayName(dev)} rejected this meanwhile.` : `${displayName(dev)} paid ${money(s.review.amountCents)} for this meanwhile.`);
  }
  if (!s.choiceOfferedAt) throw new HttpError(409, "not_yet", `You can choose once ${REVIEW_DAYS} days have passed since you sent it and the test's Open until has passed (with no Open until: once the test or your work has ended).`);
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
  if (choice === "charge" && body.tickedCents !== amount) throw new HttpError(400, "tick", `Tick “charge ${displayName(dev)} ${money(amount)} now” to charge.`);
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

/** (Batch 15 section 9) A tester's Charge went through (at once, or found later by the stuck-payment check): recorded, the receipt sent. */
export async function finishChoicePay(paymentId: string, r: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.update({ where: { id: paymentId }, data: { status: r.status, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const label = (await db.submission.findUnique({ where: { id: p.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers";
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
  await db.notification.createMany({
    data: tests.filter((t) => !told.has(t.id)).map((t) => {
      const n = count.get(t.id)!;
      return { userId: t.developerId, testId: t.id, reminderKey: `applications:${t.id}`, text: `“${t.title}”: ${n} ${n === 1 ? "application or rejoin ask waits" : "applications and rejoin asks wait"} for your answer`, link: `/app/tests/${t.id}#needs-you` };
    }),
  });
}
