import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, toCents } from "@/lib/format";
import {
  ADMIN_DIGEST_DAYS, autoPayFor, chargeAmount, callCancelledLine, CHARGED_BY_TESTER, countdownDue, INVITE_REMIND_DAYS, choiceLine, failedLine, headsUpLine, LET_GO_BY_TESTER, REMIND_DAYS, REVIEW_DAYS, HOLD_ALERT_DAYS, owedUntilFrom, PAUSED_FOR_TESTERS, PAY_WAITS, shiftForHold,
} from "@/lib/rules";
import { HttpError } from "./http";
import { bell, notify, sendSummaries } from "./notify";
import { appUrl } from "./auth";
import { sendEmail } from "./email";
import { charge } from "./stripe";
import { receipt } from "./payments";
import { testerTermsGate } from "./terms";
import { recordEvent } from "./tests";
import { logEvent } from "./live";

// Payment hold (owner rule): starts when a failed charge isn't paid within 3 days, or when a chargeback opens.
// While on hold all the developer's tests are paused; paying everything owed (and the admin resolving chargebacks)
// lifts it, and every working tester's deadline, Open until and the 14-day review clock move on by the pause.

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

/** Money the developer still owes: failed charges not yet settled. */
export async function owed(devId: string) {
  return db.payment.findMany({ where: { developerId: devId, status: "failed", owedUntil: { not: null }, settledAt: null }, orderBy: { createdAt: "asc" } });
}

export async function startHold(devId: string, reason: string) {
  const now = new Date();
  const claimed = await db.user.updateMany({ where: { id: devId, holdStartedAt: null }, data: { holdStartedAt: now, holdReason: reason, holdAlertedAt: null } });
  if (claimed.count !== 1) return false;
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const tests = await db.test.findMany({ where: { developerId: devId, status: { in: ["open", "closed", "draft"] } } });
  for (const t of tests) {
    // Calls are not cancelled now: only a booked call whose time comes while still on hold (sweepHeldCalls).
    // Pending call requests close (both told).
    for (const r of await (await import("./requests")).closeRequests({ contractIds: (await db.contract.findMany({ where: { testId: t.id }, select: { id: true } })).map((x) => x.id) }, "the test is paused")) {
      const k = await db.contract.findUniqueOrThrow({ where: { id: r.contractId }, include: { tester: true } });
      await notify(k.tester.email, `Your call request for ${fmtDateTime(r.startsAt)} closed`, ["It closed because the test is paused."], `/app/sessions/${k.id}`);
      await bell(devId, `The call request for ${fmtDateTime(r.startsAt)} closed: the test is paused.`, `/app/tests/${t.id}#calls`);
    }
    await db.$transaction((tx) => recordEvent(tx, t.id, "paused", "Your tests are paused until you pay what you owe", false));
  }
  await notify(dev.email, "Your tests are paused", ["Your tests are paused until you pay what you owe: no new testers, invites or calls, and Pay waits.", "Testers can still send work. Pay what you owe in Payments to resume at once."], "/app/payments");
  return true;
}

/** Lift the hold when nothing is owed and no chargeback is open; move every clock on by the length of the pause. */
export async function liftHoldIfClear(devId: string) {
  const dev = await db.user.findUnique({ where: { id: devId } });
  if (!dev?.holdStartedAt) return false;
  if ((await owed(devId)).length) return false;
  if (await db.payment.count({ where: { developerId: devId, chargeback: "open" } })) return false;
  const start = dev.holdStartedAt, now = new Date();
  await db.$transaction(async (tx) => {
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
    await tx.user.update({ where: { id: devId }, data: { holdStartedAt: null, holdReason: "", holdAlertedAt: null } });
  });
  // Admin decisions that charge the developer were waiting for the hold to lift: charge them now.
  for (const p of await db.payment.findMany({ where: { developerId: devId, status: "deferred" } })) {
    const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
    try {
      const r = await charge(dev, tester, p.amountCents, `deferred-${p.id}`, "Playtest: team decision charged after the hold");
      await db.payment.update({ where: { id: p.id }, data: { ...r } });
      await receipt(dev.email, "a team decision (charged after the hold lifted)", p.amountCents, r.status, "/app/payments");
    } catch {
      await db.payment.update({ where: { id: p.id }, data: { status: "failed", owedUntil: owedUntilFrom(new Date()) } });
    }
  }
  await notify(dev.email, "Your tests are running again", ["Everything you owed is paid: your tests are running again, and every deadline moved on by the pause."], "/app");
  const testers = await db.contract.findMany({ where: { status: "working", test: { developerId: devId } }, include: { tester: true } });
  for (const c of testers) await notify(c.tester.email, `“${c.title}” is running again`, [`“${c.title}” is running again. Your deadline moved on by the pause.`], `/app/sessions/${c.id}`);
  return true;
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
  if (seen != null && seen !== total && body.confirmed !== true) {
    const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
    const fresh = lines.filter((l) => l.retry && !seenIds.includes(l.id)).map((l) => l.text.replace(/ · card declined .*$/, ""));
    const text = fresh.length
      ? `Another payment failed meanwhile: ${fresh.join(", ")}. New total ${money(total)}. Press again to pay ${money(total)}.`
      : `What you owe changed: now ${money(total)}. Press again to pay ${money(total)}.`;
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text, at: new Date() }], totalCents: total });
  }
  const stillFailing: string[] = [];
  for (const p of list) {
    const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
    try {
      const r = await charge(u, tester, p.amountCents, `owed-${p.id}-${Date.now()}`, "Playtest: amount owed");
      await db.payment.update({ where: { id: p.id }, data: { ...r, settledAt: new Date(), failure: "" } });
      await receipt(u.email, "an amount you owed", p.amountCents, r.status, "/app/payments");
      await tellArrived(p, tester.email, displayName(u));
    } catch (e) {
      const why = (e as HttpError).data?.stripe ?? (e as Error).message;
      stillFailing.push(`${lines.find((l) => l.id === p.id)?.text ?? money(p.amountCents)} (${String(why).replace(/\.$/, "")})`);
    }
  }
  // Chargebacks can't be retried here: the admin resolves them (Mark resolved). The hold lifts only when all are paid.
  const lifted = await liftHoldIfClear(dev.id);
  return { paid: list.length - stillFailing.length, stillFailing, lifted };
}

/** The tester's one notice when a delayed payment goes through: the normal paid line. */
async function tellArrived(p: { contractId: string | null; submissionId: string | null; callId: string | null; kind: string; amountCents: number }, email: string, devName: string) {
  const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
  const label = p.kind === "dispute" ? "dispute" : p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
  const line = `${devName} paid ${money(p.amountCents)} for your ${label}`;
  await notify(email, line, [line + "."], p.contractId ? `/app/sessions/${p.contractId}` : "/app/payments");
}

/** One line per failed payment ("Ana Silva's written answers $8.00 · card declined Oct 20"), plus open chargebacks. */
export async function owedLines(devId: string) {
  const list = await db.payment.findMany({ where: { developerId: devId, OR: [{ status: "failed", owedUntil: { not: null }, settledAt: null }, { chargeback: "open" }] }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const p of list) {
    const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
    const sub = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId } }) : null;
    const what = `${c ? displayName(c.tester) + "'s " : ""}${p.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers"}`;
    out.push(p.chargeback === "open"
      ? { id: p.id, retry: false, amountCents: p.amountCents, until: null as string | null, text: `${what} ${money(p.amountCents)} · reversed by your bank (the team resolves it)` }
      : { id: p.id, retry: true, amountCents: p.amountCents, until: p.owedUntil!.toISOString(), text: failedLine(what, p.amountCents, p.createdAt) });
  }
  return out;
}

/** Booked calls whose time came while the developer is on hold are cancelled (tester told it's paused). */
export async function sweepHeldCalls(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId } });
  if (!u?.holdStartedAt) return 0;
  const now = new Date();
  const due = await db.call.findMany({ where: { status: "booked", startsAt: { gte: u.holdStartedAt, lte: now }, contract: { test: { developerId: devId } } }, include: { contract: { include: { tester: true } } } });
  for (const c of due) {
    const done = await db.call.updateMany({ where: { id: c.id, status: "booked" }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: now, cancelNote: "The test is paused." } });
    if (done.count) await notify(c.contract.tester.email, callCancelledLine(c.startsAt, "paused"), [callCancelledLine(c.startsAt, "paused"), PAUSED_FOR_TESTERS], `/app/sessions/${c.contractId}`);
  }
  return due.length;
}

/** Stripe dispute (the developer's bank reversed a payment): a developer stop-once reason, and a hold starts. */
export async function chargebackOpened(paymentIntentId: string) {
  const p = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!p || p.chargeback === "open") return false;
  await db.payment.update({ where: { id: p.id }, data: { chargeback: "open", chargebackAt: new Date() } });
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
  if (c) {
    const what = p.kind === "call" ? `${displayName(c.tester)}'s live call` : p.submissionId ? `${displayName(c.tester)}'s ${(await db.submission.findUnique({ where: { id: p.submissionId } }))?.kind === "recording" ? "recording" : "written answers"}` : displayName(c.tester);
    await db.$transaction((tx) => recordEvent(tx, c.testId, "chargeback", `Your bank reversed your ${money(p.amountCents)} payment for ${what}`, false, {}, c.id));
  }
  await startHold(p.developerId, "chargeback");
  return true;
}

export async function resolveChargeback(paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.chargeback !== "open") throw new HttpError(409, "not_open", "That chargeback isn't open.");
  await db.payment.update({ where: { id: p.id }, data: { chargeback: "resolved" } });
  const pc = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId } }) : null;
  if (pc) await logEvent(pc.testId, "chargeback", `The team resolved the bank reversal of your ${money(p.amountCents)} payment`, pc.id);
  await liftHoldIfClear(p.developerId);
  return { ok: true };
}

/** Admin: after 30 days on hold, close the developer's tests; testers are told the test ended. */
export async function closeHeldTests(devId: string) {
  const tests = await db.test.findMany({ where: { developerId: devId, status: { not: "stopped" } } });
  for (const t of tests) {
    const cs = await db.contract.findMany({ where: { testId: t.id, status: "working" }, include: { tester: true } });
    await db.$transaction(async (tx) => {
      await tx.contract.updateMany({ where: { testId: t.id, status: "working" }, data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The test was closed." } });
      await tx.invite.updateMany({ where: { testId: t.id, status: "sent" }, data: { status: "cancelled" } });
      await recordEvent(tx, t.id, "admin", "The test was closed by the team", true, { status: "stopped", stoppedAt: new Date() });
    });
    for (const c of cs) await notify(c.tester.email, `“${c.title}” ended`, [`“${c.title}” ended. Work you already sent stays on record.`], `/app/sessions/${c.id}`);
  }
  return { closed: tests.length };
}

/** The daily job: auto-pay after 14 days, owed charges → hold, 30-day hold alerts, Open until heads-ups. */
export async function runDaily(now = new Date()) {
  const out = { autoPaid: 0, holds: 0, alerts: 0, headsUps: 0, choices: 0, retried: 0 };
  // (NEWEST+6) The daily job also checks for an outage first (timers move before anything due runs).
  if (!process.env.VITEST) await (await import("./outages")).heartbeat(now);
  // 0. Retry every owed payment once a day (before the cut-off and during holds). Chargebacks are never retried.
  const retry = await db.payment.findMany({ where: { status: "failed", owedUntil: { not: null }, settledAt: null, OR: [{ retriedAt: null }, { retriedAt: { lt: new Date(now.getTime() - 23 * 3_600_000) } }] } });
  for (const p of retry) {
    const [d, t] = await Promise.all([db.user.findUnique({ where: { id: p.developerId } }), db.user.findUnique({ where: { id: p.testerId } })]);
    if (!d || !t) continue; // a row with no people (never retried; one bad row never stops the daily job)
    try {
      const r = await charge(d, t, p.amountCents, `retry-${p.id}-${now.toISOString().slice(0, 10)}`, "Playtest: daily retry of an amount owed");
      await db.payment.update({ where: { id: p.id }, data: { ...r, settledAt: now, retriedAt: now, failure: "" } });
      await receipt(d.email, "an amount you owed (retried today)", p.amountCents, r.status, "/app/payments");
      await tellArrived(p, t.email, displayName(d));
      await liftHoldIfClear(d.id);
      out.retried++;
    } catch {
      await db.payment.update({ where: { id: p.id }, data: { retriedAt: now } });
      await bell(d.id, `Today's retry of ${money(p.amountCents)} you owe was declined. Pay what you owe in Payments.`, "/app/payments");
    }
  }
  // 1. Sent work not paid or rejected within 14 days: the listing amount is paid automatically (clock paused in holds).
  const due = await db.submission.findMany({
    where: { review: null, payBy: { lt: now }, contract: { test: { developer: { holdStartedAt: null } } } },
    include: { contract: { include: { tester: true, test: { include: { developer: true } } } } },
    orderBy: { payBy: "asc" },
    take: 1000,
  });
  for (const s of due) {
    const c = s.contract, dev = c.test.developer;
    const auto = autoPayFor(s.agreedCents, s.askedCents);
    if (auto == null) continue; // outside the contract: its own reminder every 3 days (below)
    // After day 14: the developer is reminded daily until it's paid, rejected, charged or let go.
    if (!s.devRemindedAt || now.getTime() - s.devRemindedAt.getTime() >= 23 * 3_600_000) {
      await bell(dev.id, `“${c.title}”: ${displayName(c.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} waited over 14 days: pay or reject it (${displayName(c.tester)} can now charge or let it go).`, `/app/tests/${c.testId}`);
      await db.submission.update({ where: { id: s.id }, data: { devRemindedAt: now } });
    }
    // Contract price already paid in full for this part: no Charge / Let it go, no day-14 notice, no reminders.
    const paidPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    if (chargeAmount(s.agreedCents, s.askedCents, paidPart) === 0) continue;
    if (!s.choiceOfferedAt) {
      const by = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
      await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: now, choiceBy: by, remindedAt: now } });
      const line = choiceLine(displayName(dev), s.kind, auto);
      await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
      await db.$transaction((tx) => recordEvent(tx, c.testId, "choice", `${displayName(c.tester)} can now charge or let go of their ${s.kind === "recording" ? "recording" : "written answers"}`, false, {}, c.id));
      await (await import("./ratings")).maybePromptRating(c.id);
      out.choices++;
      continue;
    }
    {
      if (!s.remindedAt || now.getTime() - s.remindedAt.getTime() >= REMIND_DAYS * 86_400_000 - 3_600_000) {
        const line = choiceLine(displayName(dev), s.kind, auto);
        await notify(c.tester.email, `Reminder: ${line}`, [line], `/app/sessions/${c.id}`);
        await db.submission.update({ where: { id: s.id }, data: { remindedAt: now } });
      }
      continue;
    }
  }
  // 1b. One day before the cut-off: bell + email to the developer, once.
  const soon = await db.payment.findMany({ where: { status: "failed", settledAt: null, warnedAt: null, owedUntil: { gt: now, lt: new Date(now.getTime() + 86_400_000) } } });
  for (const p of soon) {
    const d = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
    await notify(d.email, `Pay ${money(p.amountCents)} by ${fmtDateTime(p.owedUntil!)} or your tests are paused`, ["A payment you owe is still unpaid. Pay what you owe in Payments to keep your tests running."], "/app/payments");
    await db.payment.update({ where: { id: p.id }, data: { warnedAt: now } });
  }
  // 2. Failed charges not paid within 3 days start a hold.
  const late = await db.payment.findMany({ where: { status: "failed", settledAt: null, owedUntil: { lt: now } }, distinct: ["developerId"] });
  for (const p of late) if (await startHold(p.developerId, "unpaid")) out.holds++;
  // 3a. Admin: a daily email only when there are NEW disputes or NEW chargebacks since the last one.
  const lastDaily = await db.appState.findUnique({ where: { key: "adminDailyAt" } });
  const since = lastDaily ? new Date(lastDaily.value) : new Date(0);
  const [newDisputes, newChargebacks] = await Promise.all([
    db.dispute.findMany({ where: { createdAt: { gt: since } } }),
    db.payment.findMany({ where: { chargeback: "open", chargebackAt: { gt: since } } }),
  ]);
  if (newDisputes.length + newChargebacks.length) {
    const lines = [...newDisputes.map((d) => `• New dispute: “${d.reason}” ${appUrl()}/admin#disputes`), ...newChargebacks.map((p) => `• New chargeback: ${money(p.amountCents)} ${appUrl()}/admin#holds`)];
    for (const a of admins()) await sendEmail({ to: a, subject: `Playtest: ${lines.length} new dispute${lines.length === 1 ? "" : "s"} or chargeback${lines.length === 1 ? "" : "s"}`, text: [...lines, "", "Playtest"].join("\n") }).catch((e) => console.error("[email] admin daily:", e.message));
  }
  await db.appState.upsert({ where: { key: "adminDailyAt" }, update: { value: now.toISOString() }, create: { key: "adminDailyAt", value: now.toISOString() } });
  // 3b. The admin digest: ONE email every 3 days with everything else (failed payments, holds, 30-day holds, no-shows once, payouts).
  const last = await db.appState.findUnique({ where: { key: "adminDigestAt" } });
  const digestDue = !last || now.getTime() - new Date(last.value).getTime() >= ADMIN_DIGEST_DAYS * 86_400_000 - 3_600_000;
  const cases = digestDue ? (await adminCases(now, true)).filter((c) => c.kind !== "dispute" && c.kind !== "chargeback") : [];
  if (digestDue) await db.appState.upsert({ where: { key: "adminDigestAt" }, update: { value: now.toISOString() }, create: { key: "adminDigestAt", value: now.toISOString() } });
  if (cases.length) {
    await db.call.updateMany({ where: { noShowBy: { not: null }, noShowDigestedAt: null }, data: { noShowDigestedAt: now } });
    const text = [`${cases.length} case${cases.length === 1 ? "" : "s"} need the team:`, "", ...cases.map((c) => `• ${c.text} ${appUrl()}${c.link}`), "", "Playtest"].join("\n");
    for (const a of admins()) await sendEmail({ to: a, subject: `Playtest admin digest: ${cases.length} case${cases.length === 1 ? "" : "s"}`, text }).catch((e) => console.error("[email] digest:", e.message));
    out.alerts = cases.length;
  }
  await sendSummaries(now);
  // Calls whose time came during a hold.
  for (const u of await db.user.findMany({ where: { holdStartedAt: { not: null } }, select: { id: true } })) await sweepHeldCalls(u.id);
  // 4. Open until heads-ups, 3 days and 1 day before (developer and working testers).
  const closing = await db.test.findMany({ where: { status: { in: ["open", "closed"] }, openUntil: { gt: now } }, include: { developer: true, contracts: { where: { status: "working" }, include: { tester: true } } } });
  for (const t of closing) {
    const m = countdownDue(t.openUntil, now, t.notifiedMarks, t.createdAt);
    if (!m) continue;
    // Bell notifications only, never emailed.
    const line = headsUpLine(t.title, t.openUntil!, fmtDate);
    await bell(t.developerId, line, `/app/tests/${t.id}`);
    for (const c of t.contracts) await bell(c.testerId, line, `/app/sessions/${c.id}`);
    await db.test.update({ where: { id: t.id }, data: { notifiedMarks: { push: m.mark }, ...(m.mark === "1d" ? { notified1d: true, notified3d: true } : m.mark === "3d" ? { notified3d: true } : {}) } });
    out.headsUps++;
  }
  // 5. The developer's unreviewed contract work: 1 week / 3 days / 1 day before day 14 (bell).
  const upcoming = await db.submission.findMany({ where: { review: null, agreedCents: { not: null }, payBy: { gt: now }, contract: { test: { developer: { holdStartedAt: null } } } }, include: { contract: { include: { tester: true, test: true } } }, orderBy: { payBy: "asc" }, take: 2000 });
  for (const s of upcoming) {
    const m = countdownDue(s.payBy, now, s.devMarks, s.updatedAt);
    if (!m) continue;
    const name = displayName(s.contract.tester);
    await bell(s.contract.test.developerId, `“${s.contract.title}”: review ${name}'s ${s.kind === "recording" ? "recording" : "written answers"} ${m.label === "tomorrow" ? "by tomorrow" : m.label.replace("in ", "within ")} (after that ${name} can charge or let it go).`, `/app/tests/${s.contract.testId}`);
    await db.submission.update({ where: { id: s.id }, data: { devMarks: { push: m.mark } } });
  }
  // 6. Work outside the contract: no deadline, a bell to the developer every 3 days.
  const outside = await db.submission.findMany({ where: { review: null, agreedCents: null, updatedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - REMIND_DAYS * 86_400_000 + 3_600_000) } }], contract: { test: { developer: { holdStartedAt: null } } } }, include: { contract: { include: { tester: true } } }, take: 500 });
  for (const s of outside) {
    await bell((await db.test.findUniqueOrThrow({ where: { id: s.contract.testId } })).developerId, `“${s.contract.title}”: ${displayName(s.contract.tester)}'s ${s.kind === "recording" ? "recording" : "written answers"} still waits for you to pay or reject.`, `/app/tests/${s.contract.testId}`);
    await db.submission.update({ where: { id: s.id }, data: { remindedAt: now } });
  }
  // 7. Invites: a bell reminder every 3 days until the tester joins, says "No thanks", or the invite expires.
  const invites = await db.invite.findMany({ where: { status: "sent", createdAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - INVITE_REMIND_DAYS * 86_400_000 + 3_600_000) } }] }, include: { test: { include: { developer: true } } }, take: 500 });
  for (const i of invites) {
    const testersIn = await db.contract.count({ where: { testId: i.testId, status: "working" } });
    if (i.test.status !== "open" || testersIn >= i.test.spots || (i.test.openUntil && i.test.openUntil < now)) continue; // expired
    await bell(i.testerId, `Reminder: ${displayName(i.test.developer)} invited you to “${i.test.title}”.`, `/app/find/${i.testId}`);
    await db.invite.update({ where: { id: i.id }, data: { remindedAt: now } });
  }
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
    ...chargebacks.map((p) => ({ kind: "chargeback", text: `Open chargeback: ${money(p.amountCents)}`, link: "/admin#holds" })),
    ...holds.map((u) => ({ kind: "hold", text: u.holdStartedAt! < new Date(now.getTime() - HOLD_ALERT_DAYS * 86_400_000) ? `${u.email} on a payment hold since ${fmtDate(u.holdStartedAt!)} (30 days): close their tests` : `${u.email} on a payment hold since ${fmtDate(u.holdStartedAt!)}`, link: "/admin#holds" })),
    ...payouts.map((p) => ({ kind: "payout", text: p.transferStatus === "waiting" ? `Payout waiting for a payout account: ${money(p.testerCents)}` : `Failed charge still owed: ${money(p.amountCents)}`, link: "/admin#payouts" })),
  ];
}

/** For the "Pay what you owe" box: failed charges (with their cut-off) and reversed payments. */
export async function owedForBox(devId: string) {
  return owedLines(devId);
}

/** The tester's choice on a contract part unreviewed 14 days: "charge" (lower of listing and asked) or "letgo". */
export async function chooseOutcome(tester: { id: string; email: string; name: string }, contractId: string, body: Record<string, unknown>) {
  const s = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  if (!s || s.contractId !== contractId || s.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That work doesn't exist.");
  const c = s.contract, dev = c.test.developer, label = s.kind === "recording" ? "recording" : "written answers";
  if (s.review) {
    if (s.review.reason === CHARGED_BY_TESTER || s.review.reason === LET_GO_BY_TESTER) throw new HttpError(409, "done", "You already chose for this.");
    throw new HttpError(409, "done", s.review.rejected ? `${displayName(dev)} rejected this meanwhile.` : `${displayName(dev)} paid ${money(s.review.amountCents)} for this meanwhile.`);
  }
  if (!s.choiceOfferedAt) throw new HttpError(409, "not_yet", "You can choose once it has waited 14 days without a review.");
  if (dev.holdStartedAt) throw new HttpError(409, "paused", "This test is paused: you can choose once it resumes.");
  await testerTermsGate(contractId, displayName(dev), body);
  const choice = body.choice === "letgo" ? "letgo" : body.choice === "charge" ? "charge" : null;
  if (!choice) throw new HttpError(400, "bad_choice", "Choose Charge or Let it go.");
  const paidForPart = (await db.payment.aggregate({ where: { submissionId: s.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const cap = chargeAmount(s.agreedCents, s.askedCents, paidForPart);
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
    const now = new Date();
    await db.payment.create({ data: { kind: "review", submissionId: s.id, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amount, feeCents: 0, testerCents: 0, status: "failed", failure: (e as Error).message, owedUntil: owedUntilFrom(now) } });
    await notify(c.tester.email, `Payment for your work on “${c.title}” may be delayed`, ["Payment for your work may be delayed."], `/app/sessions/${c.id}`);
    // A second failed payment while one is still owed starts the hold at once.
    const stillOwed = await db.payment.count({ where: { developerId: dev.id, status: "failed", settledAt: null, owedUntil: { not: null } } });
    if (stillOwed >= 2) await startHold(dev.id, "unpaid");
    await notify(dev.email, "A payment failed: pay within 3 days", [`${displayName(tester)} charged ${money(amount)} for their ${label} on “${c.title}”, and your card was declined.`, `Pay it by ${fmtDateTime(owedUntilFrom(now))} or your tests are paused.`], "/app/payments");
  }
  await db.$transaction((tx) => recordEvent(tx, c.testId, "paid", `${displayName(tester)} charged ${money(amount)} for their ${label}`, false, {}, c.id));
  return { choice, amountCents: amount, status };
}
