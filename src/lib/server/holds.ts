import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, toCents } from "@/lib/format";
import {
  HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL, OWED_FOR_TESTERS, autoPayFor, chargeAmount, CHARGED_BY_TESTER, countdownDue, INVITE_REMIND_DAYS, choiceLine, failedLine, headsUpLine, LET_GO_BY_TESTER, REMIND_DAYS, REVIEW_DAYS, chargeIsOpen, chargeOpensAt, PAUSED_FOR_TESTERS, PAUSED_RIGHT_NOW, PAY_WAITS, shiftForHold, testPaused,
} from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify, sendSummaries } from "./notify";
import { appUrl } from "./auth";
import { accountEvent, labelled, reportedOver3 } from "./reports";
import { sendEmail } from "./email";
import { charge, chargePlatform } from "./stripe";
import { receipt } from "./payments";
import { testerTermsGate } from "./terms";
import { devOwes, recordEvent } from "./tests";
import { PAUSE_CLOSE_DAYS } from "@/lib/pause";

// Payment hold (owner rule, Oct 27): starts AT ONCE when any payment is declined (part Pay, the tester's Charge, a call charge, extra pay), or when a chargeback opens
// (a chargeback during a payment hold turns it into a chargeback hold). There is no owed window and no daily retry. While on hold all the developer's
// tests are paused, exactly like an admin suspension (see lib/restricted.ts); paying everything owed (and the admin resolving chargebacks) lifts it, and
// every working tester's deadline, Open until and the 14-day review clock move on by the pause.

/** A test that is not paused (no payment hold, no suspension, no team pause): reminders tied to a test wait while it is paused and restart when it resumes. */
const PAUSE_FREE = { adminPausedAt: null, developer: { holdStartedAt: null, suspendedAt: null } } as const;
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

/** Refusal for tester actions on a paused test (joining, booking calls). Sending work still works. */
export async function testerHoldRefusal(devId: string) {
  if (await onHold(devId)) throw new HttpError(409, "paused", PAUSED_FOR_TESTERS);
}

/**
 * Money the developer still owes: failed charges not yet settled, and (Owner, Oct 27) every open chargeback adds its amount: they are paid with "Pay what you owe"
 * (charged again on the card) before the team's Approve.
 */
export async function owed(devId: string) {
  const failed = await db.payment.findMany({ where: { developerId: devId, status: "failed", owedUntil: { not: null }, settledAt: null }, orderBy: { createdAt: "asc" } });
  const reversed = await db.payment.findMany({ where: { developerId: devId, chargeback: "open" }, orderBy: { createdAt: "asc" } });
  const repaid = reversed.length ? new Set((await db.payment.findMany({ where: { repaysId: { in: reversed.map((p) => p.id) }, status: { in: ["charged", "not_set_up"] } }, select: { repaysId: true } })).map((p) => p.repaysId)) : new Set<string | null>();
  return [...failed, ...reversed.filter((p) => !repaid.has(p.id))].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
}

/**
 * (Owner, Oct 27) A declined payment starts a payment hold AT ONCE. The payment is marked as owed (owedUntil is just the "owed" marker now: no cut-off);
 * a decline during an existing hold adds to "Pay what you owe". Returns true when this decline started the hold.
 */
export async function declinedPayment(devId: string, paymentId: string, cents: number, what: string) {
  await db.payment.update({ where: { id: paymentId }, data: { status: "failed", owedUntil: new Date() } });
  const started = await startHold(devId, "unpaid");
  if (!started) {
    const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
    await bell(devId, `Another payment was declined: ${money(cents)} for ${what} was added to what you owe`, dev.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
  }
  return started;
}

export async function startHold(devId: string, reason: string) {
  const now = new Date();
  const claimed = await db.user.updateMany({ where: { id: devId, holdStartedAt: null }, data: { holdStartedAt: now, holdReason: reason, holdAlertedAt: null, holdCount: { increment: 1 }, holdApprovedAt: null, holdApprovedById: null } });
  if (claimed.count !== 1) return false;
  await accountEvent(devId, "hold", null, reason);
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
 * A pause ended (a payment hold paid off, or a developer's suspension lifted): every working tester's deadline, Open until and the
 * 14-day review clocks move on by its length, and each test says it is running again.
 */
export async function resumeTests(tx: Prisma.TransactionClient, devId: string, start: Date, now: Date) {
  const tests = await tx.test.findMany({ where: { developerId: devId } });
  for (const t of tests) {
    if (t.openUntil && t.status !== "stopped") await tx.test.update({ where: { id: t.id }, data: { openUntil: shiftForHold(t.openUntil, start, now), notified3d: false, notified1d: false } });
    const cs = await tx.contract.findMany({ where: { testId: t.id, status: "working" } });
    for (const c of cs) await tx.contract.update({ where: { id: c.id }, data: { dueAt: shiftForHold(c.dueAt, start, now) } });
    const subs = await tx.submission.findMany({ where: { contract: { testId: t.id }, review: null, payBy: { not: null } } });
    for (const s of subs) {
      const from = s.updatedAt > start ? s.updatedAt : start; // only the part of the pause after it was sent
      await tx.submission.update({ where: { id: s.id }, data: { payBy: shiftForHold(s.payBy, from, now), choiceBy: shiftForHold(s.choiceBy, from, now) } });
    }
    if (t.status !== "stopped") await recordEvent(tx, t.id, "resumed", "Your tests are running again", false);
  }
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
      const r = await charge(dev, tester, p.amountCents, `deferred-${p.id}`, "Playtest: charged now that the account is clear");
      await db.payment.update({ where: { id: p.id }, data: { ...r } });
      await receipt(dev.email, p.kind === "dispute" ? "a team decision (charged after the pause)" : "work you paid for during the pause", p.amountCents, r.status, p.contractId ? `/app/tests/${(await db.contract.findUnique({ where: { id: p.contractId }, select: { testId: true } }))?.testId}` : "/app/payments");
      await tellArrived(p, tester.email, displayName(dev));
    } catch {
      await declinedPayment(devId, p.id, p.amountCents, p.kind === "dispute" ? "a team decision" : "work you paid for during the pause");
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
  await db.$transaction(async (tx) => {
    await resumeTests(tx, devId, start, now);
    await tx.user.update({ where: { id: devId }, data: { holdStartedAt: null, holdReason: "", holdAlertedAt: null, chargebackCardVerifiedAt: null, chargebackApprovedAt: null, holdApprovedAt: null, holdApprovedById: null } });
  });
  await accountEvent(devId, "hold-lifted");
  await chargeDeferred(devId);
  await notify(dev.email, "Your tests are running again", ["Everything you owed is paid: your tests are running again, and every deadline moved on by the pause."], "/app", { always: true, payment: true, group: "payhold" });
  const testers = await db.contract.findMany({ where: { status: "working", test: { developerId: devId } }, include: { tester: true } });
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
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  const list = await owed(dev.id);
  const total = list.reduce((a, p) => a + p.amountCents, 0);
  const seen = typeof body.seenTotalCents === "number" ? body.seenTotalCents : null;
  const lines = await owedLines(dev.id);
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
  // (Owner, NEXT-UI 12b) Every press checks what the box showed (total and which payments), the second one too: if
  // anything is new it stops again with just the new line(s).
  const nowIds = lines.filter((l) => l.retry).map((l) => l.id);
  if (seen != null && (seen !== total || (Array.isArray(body.seenIds) && (seenIds.length !== nowIds.length || nowIds.some((i) => !seenIds.includes(i)))))) {
    const fresh = lines.filter((l) => l.retry && !seenIds.includes(l.id)).map((l) => l.text.replace(/ · card declined .*$/, ""));
    const text = fresh.length
      ? `Another payment failed meanwhile: ${fresh.join(", ")}. New total ${money(total)}. Press again to pay ${money(total)}.`
      : `What you owe changed: now ${money(total)}. Press again to pay ${money(total)}.`;
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text, at: new Date() }], totalCents: total, ids: nowIds });
  }
  const stillFailing: string[] = [];
  for (const p of list) {
    const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
    try {
      if (p.chargeback === "open") {
        // (Owner, Oct 27) A reversed payment is owed again: the same amount is charged on the card (to the platform: the tester already got their share). The team's Approve closes the chargeback.
        const r = await chargePlatform(u, p.amountCents, `cbowed-${p.id}`, "Playtest: a payment reversed by your bank, charged again");
        await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: u.id, testerId: p.testerId, amountCents: p.amountCents, feeCents: p.amountCents, testerCents: 0, transferStatus: "none", ...r, settledAt: new Date() } });
        await receipt(u.email, "a payment your bank had reversed", p.amountCents, r.status, "/app/payments");
        continue;
      }
      const r = await charge(u, tester, p.amountCents, `owed-${p.id}-${Date.now()}`, "Playtest: amount owed");
      await db.payment.update({ where: { id: p.id }, data: { ...r, settledAt: new Date(), failure: "" } });
      await receipt(u.email, "an amount you owed", p.amountCents, r.status, "/app/payments");
      await tellArrived(p, tester.email, displayName(u));
    } catch (e) {
      const why = (e as HttpError).data?.stripe ?? (e as Error).message;
      stillFailing.push(`${lines.find((l) => l.id === p.id)?.text ?? money(p.amountCents)} (${String(why).replace(/\.$/, "")})`);
    }
  }
  // The hold lifts only when all are paid; a chargeback hold also needs the card check and the admin's approval.
  const lifted = await liftHoldIfClear(dev.id);
  return { paid: list.length - stillFailing.length, stillFailing, lifted };
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
    out.push(p.chargeback === "open"
      ? { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, text: `${what} ${money(p.amountCents)} · reversed by your bank` }
      : { id: p.id, retry: true, amountCents: p.amountCents, until: null as string | null, text: failedLine(what, p.amountCents, p.createdAt) });
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

/** The daily job: auto-pay after 14 days, closing tests paused for 7 days, the paused reminders, Open until heads-ups. (No retries and no owed window any more: a declined payment is a hold at once.) */
export async function runDaily(now = new Date()) {
  const out = { autoPaid: 0, holds: 0, alerts: 0, headsUps: 0, choices: 0, retried: 0, closed: 0 };
  await (await import("./calls")).sweepNobodyJoined(now);
  // 1. Sent work not paid or rejected within 14 days: the listing amount is paid automatically (clock paused in holds).
  const due = await db.submission.findMany({
    // (Owner, Oct 28) Not a deleted tester's work: it can no longer be paid, charged or disputed, so Charge never opens and the developer isn't reminded.
    where: { review: null, payBy: { lt: now }, contract: { test: PAUSE_FREE, tester: { deletedAt: null } } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
    orderBy: { payBy: "asc" },
    take: 1000,
  });
  for (const s of due) {
    const c = s.contract, dev = c.test.developer;
    const auto = autoPayFor(s.agreedCents);
    if (auto == null) continue; // outside the contract: its own reminder every 3 days (below)
    // (Owner, Oct 26) Charge / Let it go opens only when 14 days have passed AND the test's Open until has passed (or, with none, the test or the tester's work ended).
    if (!chargeIsOpen(s, c.test, c, now)) continue;
    // Once it opens: the developer is reminded daily until it's paid, rejected, charged or let go.
    if (!s.devRemindedAt || now.getTime() - s.devRemindedAt.getTime() >= 23 * 3_600_000) {
      await bell(dev.id, `“${c.title}”: ${displayName(c.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} waited over 14 days: pay or reject it (${displayName(c.tester)} can now charge or let it go).`, `/app/tests/${c.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
      await db.submission.update({ where: { id: s.id }, data: { devRemindedAt: now } });
    }
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
  const upcoming = await db.submission.findMany({ where: { review: null, choiceOfferedAt: null, agreedCents: { not: null }, payBy: { not: null }, contract: { test: PAUSE_FREE, tester: { deletedAt: null } } }, include: { contract: { include: { tester: true, test: true } } }, orderBy: { payBy: "asc" }, take: 2000 });
  for (const s of upcoming) {
    // 1 month, 1 week, 3 days and 1 day before Charge opens (skipping any already past); the daily ones after it opens are in 1 above.
    const opens = chargeOpensAt(s, s.contract.test, s.contract, now);
    const m = opens && opens.getTime() > now.getTime() ? countdownDue(opens, now, s.devMarks, s.updatedAt) : null;
    if (!m) continue;
    const name = displayName(s.contract.tester);
    await bell(s.contract.test.developerId, `“${s.contract.title}”: review ${name}'s ${s.kind === "recording" ? "recording" : "written answers"} ${m.label === "tomorrow" ? "by tomorrow" : m.label.replace("in ", "within ")} (after that ${name} can charge or let it go).`, `/app/tests/${s.contract.testId}#piece-${s.id}`, undefined, { group: "unreviewed", reminder: `unreviewed:${s.id}` });
    await db.submission.update({ where: { id: s.id }, data: { devMarks: { push: m.mark } } });
  }
  // 6. Work outside the contract: no deadline, a bell to the developer every 3 days.
  const outside = await db.submission.findMany({ where: { review: null, agreedCents: null, updatedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000) } }], contract: { test: PAUSE_FREE, tester: { deletedAt: null } } }, include: { contract: { include: { tester: true } } }, take: 500 });
  for (const s of outside) {
    await bell((await db.test.findUniqueOrThrow({ where: { id: s.contract.testId } })).developerId, `“${s.contract.title}”: ${displayName(s.contract.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} still waits for you to pay or reject.`, `/app/tests/${s.contract.testId}#piece-${s.id}`, undefined, { reminder: `outside:${s.id}` });
    await db.submission.update({ where: { id: s.id }, data: { remindedAt: now } });
  }
  // 7. (Owner, Oct 26) Invites: a bell reminder DAILY until the tester joins, says "No thanks", or the invite expires (all of a day's stack into one line across tests).
  const invites = await db.invite.findMany({ where: { status: "sent", createdAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) } }] }, include: { test: { include: { developer: true } } }, take: 500 });
  for (const i of invites) {
    const testersIn = await db.contract.count({ where: { testId: i.testId, status: "working" } });
    if (i.test.status !== "open" || testersIn >= i.test.spots || (i.test.openUntil && i.test.openUntil < now)) continue; // expired
    if (i.test.adminPausedAt || i.test.developer.holdStartedAt || i.test.developer.suspendedAt) continue; // paused: the reminders wait
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
  // 10. (Owner, Oct 26) The reminders that need their own rules, then the emails last (one email lists everything new; payment lines also go out end of day).
  await dailyReminders(now);
  await (await import("./ratings")).ratingReminders(now);
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

/** The tester's choice on a contract part unreviewed 14 days: "charge" (the listing minus what is paid) or "letgo". */
export async function chooseOutcome(tester: { id: string; email: string; name: string }, contractId: string, body: Record<string, unknown>) {
  const s = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!s || s.contractId !== contractId || s.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That work doesn't exist.");
  const c = s.contract, dev = c.test.developer, label = s.kind === "recording" ? "recording" : "written answers";
  if (s.review) {
    if (s.review.reason === CHARGED_BY_TESTER || s.review.reason === LET_GO_BY_TESTER) throw new HttpError(409, "done", "You already chose for this.");
    throw new HttpError(409, "done", s.review.rejected ? `${displayName(dev)} rejected this meanwhile.` : `${displayName(dev)} paid ${money(s.review.amountCents)} for this meanwhile.`);
  }
  if (!s.choiceOfferedAt) throw new HttpError(409, "not_yet", "You can choose once 14 days have passed since you sent it and the test's Open until has passed (with no Open until: once the test or your work has ended).");
  await testerTermsGate(contractId, displayName(dev), body);
  const choice = body.choice === "letgo" ? "letgo" : body.choice === "charge" ? "charge" : null;
  if (!choice) throw new HttpError(400, "bad_choice", "Choose Charge or Let it go.");
  // (Design doc 8) While the test is paused Charge waits ("You can charge once it resumes"); Let it go still works.
  if (choice === "charge" && (await devOwes(dev.id))) throw new HttpError(409, "delayed", OWED_FOR_TESTERS);
  if (choice === "charge" && testPaused(dev, c.test)) throw new HttpError(409, "paused", `${PAUSED_RIGHT_NOW} You can charge once it resumes.`);
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
  const payKey = `choice-${s.id}`;
  const review = await db.review.create({ data: { submissionId: s.id, contractId: c.id, amountCents: amount, agreedCents: s.agreedCents, reason: choice === "charge" ? CHARGED_BY_TESTER : LET_GO_BY_TESTER, payKey } }).catch(() => null);
  if (!review) throw new HttpError(409, "done", "This was already settled.");
  if (choice === "letgo") {
    await db.$transaction((tx) => recordEvent(tx, c.testId, "rejected", `${displayName(tester)} let their ${label} go: nothing charged`, false, {}, c.id));
    return { choice, amountCents: 0 };
  }
  let status = "charged";
  try {
    const r = await charge(dev, c.tester, amount, payKey, `Playtest: ${label} on “${c.title}” (charged by the tester)`);
    status = r.status;
    await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, ...r } });
    await receipt(dev.email, `${displayName(tester)}'s ${label} (charged by them after 14 days)`, amount, r.status, `/app/tests/${c.testId}`);
  } catch (e) {
    status = "failed";
    // (Owner, Oct 27) A declined Charge starts the payment hold at once (the tester reads only "delayed").
    const failed = await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}#part-${s.kind}`, { payment: true, group: "tdelayed" });
    await declinedPayment(dev.id, failed.id, amount, `${displayName(tester)}'s ${label} on “${c.title}”`);
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their ${label}`, false, {}, c.id));
  return { choice, amountCents: amount, status };
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
