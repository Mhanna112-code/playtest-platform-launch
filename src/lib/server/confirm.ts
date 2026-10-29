import { db } from "@/lib/db";
import { displayName, fmtDateTimeIn, money } from "@/lib/format";
import { CONFIRM_DAYS, PRESS_ACTION_MS, bankAnchor, bankConfirmLine, bankConfirmTestLine, bankHref, bankWaitingLine, BANK_NOT_CONFIRMED } from "@/lib/rules";
import { bankTopLead, confirmByText, pieceWords, shortDay, type BankTopRow } from "@/lib/bankTop";
import { HttpError } from "./http";
import { PAY_ACTS, seenOf } from "./live";
import { notify } from "./notify";
import { bankReturnUrl, checkUrlOf, fakeConfirm, fakeOn, getStripe, stripeOn, type NeedsAction } from "./stripe";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment": Stripe's requires_action is NOT a decline.
//
// - The developer's own press (Pay, Pay more, Pay what you owe, Subscribe): the charge is made on-session; when the bank asks, the page shows its confirmation pop-up with
//   Stripe.js. The payment waits as "needs_action" (an owed payment as "paying") with actionPi / actionBy = 15 minutes; while it waits the piece is locked (batch 12
//   section 5: a tester's Charge or Let it go on it is refused). Confirmed: it goes through as normal. Refused, closed or timed out: nothing was charged, no hold.
// - A charge made while the developer isn't there (a tester's Charge, a dispute decision, a retry during a hold, a renewal): it waits as "needs_confirmation" (an owed payment
//   keeps its status) with actionBy = 3 days. The developer is told (bell and email, sent even with email Off) and Payments shows Confirm. Not confirmed in 3 days: it counts as
//   declined (a payment hold for a charge, a lapse for a renewal). The tester reads "Payment may be delayed".
// - (Batch 17 §11) The bank's check opens INLINE, under the button that was pressed (Pay, Pay more, Pay what you owe, Subscribe, Verify a card), never as a pop-up: the
//   page shows the bank's check page (`checkUrl`, a PaymentIntent confirmed with return_url) in a frame, or, with the fake Stripe, a clearly-marked stand-in. A charge
//   made while away on a test is confirmed on that TEST PAGE, under the piece ("Confirm with your bank"); Payments and the bell line link straight there (bankHome).

const pk = () => process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
/** In the local fake (and in tests without Stripe.js) the page simulates the bank's pop-up. */
const simulated = () => fakeOn() || !pk();

/** What the page's inline bank check needs for a press (a payment, or batch 23 section 6: a chargeback hold's reservation). */
export const checkFor = (paymentId: string, clientSecret: string, checkUrl: string | null) => ({ requiresAction: true as const, paymentId, clientSecret, publishableKey: pk(), simulated: simulated(), checkUrl });

/** A press's charge needs the cardholder: lock it for up to 15 minutes and hand the page what its pop-up needs. */
export async function pressAction(paymentId: string, r: NeedsAction & { feeCents?: number; testerCents?: number; transferStatus?: string }, keepStatus = false) {
  await db.payment.update({
    where: { id: paymentId },
    data: { ...(keepStatus ? {} : { status: "needs_action" }), actionPi: r.stripePaymentIntentId, actionBy: new Date(Date.now() + PRESS_ACTION_MS), stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) },
  });
  return { requiresAction: true as const, paymentId, clientSecret: r.clientSecret, publishableKey: pk(), simulated: simulated(), checkUrl: r.checkUrl ?? null };
}

/** (Batch 17 §11) Where a charge made while the developer was away is confirmed: its test page's "Confirm with your bank" (the piece marked), or null for Payments (a renewal). */
export async function bankHome(p: { id: string; contractId: string | null }) {
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, select: { testId: true } }) : null;
  return c ? bankHref(c.testId, p.id) : null;
}

/** A charge made while the developer wasn't there needs them: it waits 3 days for their Confirm in Payments (told by bell and email, even with email Off). */
export async function awayAction(paymentId: string, r: NeedsAction & { feeCents?: number; testerCents?: number; transferStatus?: string }, keepStatus = false) {
  const by = new Date(Date.now() + CONFIRM_DAYS * 86_400_000);
  const p = await db.payment.update({
    where: { id: paymentId },
    data: { ...(keepStatus ? {} : { status: "needs_confirmation" }), actionPi: r.stripePaymentIntentId, actionBy: by, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) },
  });
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // (Batch 17 §11) On a test: "Confirm this payment by <date>.", linking straight to its button on the test page.
  const home = await bankHome(p);
  const line = home ? bankConfirmTestLine(p.amountCents, by) : bankConfirmLine(p.amountCents, by);
  // (Batch 25 section 3) A renewal's line opens its own row on Payments (marked), like the dashboard's link.
  await notify(dev.email, line, [line], home ?? `/app/payments#${bankAnchor(p.id)}`, { always: true, payment: true, group: "payhold" });
  return p;
}

/** (Batch 25 section 1) The developer's saved time zone, for the times these lists show them. */
const zoneOf = async (devId: string) => (await db.user.findUnique({ where: { id: devId }, select: { timeZone: true } }))?.timeZone ?? null;

/**
 * (Batch 25 section 2) A retried chargeback's row (kind "chargeback") names the piece of the payment the bank reversed (`repaysId`): where the piece is found for any
 * waiting row.
 */
async function pieceIdsOf(waiting: { id: string; kind: string; repaysId: string | null; submissionId: string | null; callId: string | null }[]) {
  const origIds = waiting.filter((p) => p.kind === "chargeback" && p.repaysId && !p.submissionId && !p.callId).map((p) => p.repaysId!);
  const origs = origIds.length ? await db.payment.findMany({ where: { id: { in: origIds } }, select: { id: true, submissionId: true, callId: true } }) : [];
  return (p: { kind: string; repaysId: string | null; submissionId: string | null; callId: string | null }) => {
    const o = p.kind === "chargeback" && p.repaysId ? origs.find((x) => x.id === p.repaysId) : undefined;
    return { submissionId: p.submissionId ?? o?.submissionId ?? null, callId: p.callId ?? o?.callId ?? null };
  };
}

/** Payments waiting for the developer's confirmation (the Confirm list on Payments; with `contractIds`, one test's). */
export async function waitingConfirmation(devId: string, contractIds?: string[], now = new Date()) {
  return db.payment.findMany({ where: { developerId: devId, actionPi: { not: null }, actionBy: { gt: now }, status: { in: ["needs_confirmation", "failed", "owed"] }, ...(contractIds ? { contractId: { in: contractIds } } : {}) }, orderBy: { createdAt: "asc" } });
}

/**
 * (Batch 17 §11) Payments' list: each charge waiting for the bank, with the link to its test page's "Confirm with your bank" (`href`), or none (a renewal: confirmed
 * right there).
 */
export async function confirmItems(devId: string) {
  const waiting = await waitingConfirmation(devId);
  const tz = waiting.length ? await zoneOf(devId) : null;
  const ids = [...new Set(waiting.map((p) => p.contractId).filter((x): x is string => !!x))];
  const contracts = ids.length ? await db.contract.findMany({ where: { id: { in: ids } }, select: { id: true, testId: true, title: true } }) : [];
  return waiting.map((p) => {
    const c = contracts.find((x) => x.id === p.contractId);
    const what = p.kind === "subscription" ? "Your subscription" : p.kind === "dispute" ? "A team decision" : p.kind === "chargeback" ? "A payment your bank had reversed" : "A payment";
    return { id: p.id, text: `${what} ${money(p.amountCents)}${c ? ` on “${c.title}”` : ""} · confirm by ${fmtDateTimeIn(p.actionBy!, tz)}`, href: c ? bankHref(c.testId, p.id) : null };
  });
}

/**
 * (Owner, Oct 29, batch 24 section 1) The developer dashboard's "Your bank wants you to confirm" box, soonest deadline first: each row says what it is for and links to
 * where it is confirmed: a charge on a test to its piece's "Confirm with your bank" on the test page (the paused view during a hold or suspension), marked like the bell
 * line; a renewal (no test) to its row on Payments. A row leaves once it is confirmed, cancelled or past its date (then it counts as declined).
 */
export async function bankToConfirm(devId: string, now = new Date()): Promise<BankTopRow[]> {
  const waiting = await waitingConfirmation(devId, undefined, now);
  if (!waiting.length) return [];
  const tz = await zoneOf(devId);
  const ids = [...new Set(waiting.map((p) => p.contractId).filter((x): x is string => !!x))];
  const contracts = ids.length ? await db.contract.findMany({ where: { id: { in: ids } }, select: { id: true, testId: true, title: true, tester: true } }) : [];
  const pieceOf = await pieceIdsOf(waiting);
  const subIds = waiting.map((p) => pieceOf(p).submissionId).filter((x): x is string => !!x);
  const callIds = waiting.map((p) => pieceOf(p).callId).filter((x): x is string => !!x);
  const [subs, calls] = await Promise.all([
    subIds.length ? db.submission.findMany({ where: { id: { in: subIds } }, select: { id: true, kind: true } }) : [],
    callIds.length ? db.call.findMany({ where: { id: { in: callIds } }, select: { id: true, startsAt: true } }) : [],
  ]);
  return waiting
    .map((p) => {
      const c = contracts.find((x) => x.id === p.contractId);
      const name = c ? displayName(c.tester) : "";
      const at = pieceOf(p);
      const sub = at.submissionId ? subs.find((x) => x.id === at.submissionId) : undefined;
      const call = at.callId ? calls.find((x) => x.id === at.callId) : undefined;
      const piece = sub ? pieceWords.part(name, sub.kind) : call ? pieceWords.call(name, shortDay(call.startsAt, tz)) : pieceWords.work(name);
      // An owed payment keeps its status while its automatic retry waits for the bank: "what you owe". (Batch 25 section 2) A retried chargeback (a "chargeback" row)
      // reads as on the test page: "a payment your bank had reversed (Ana Silva's written answers)".
      const what =
        p.kind === "subscription" ? null
        : p.kind === "chargeback" ? pieceWords.reversed(c ? piece : null)
        : !c || p.status !== "needs_confirmation" ? pieceWords.owed
        : p.kind === "dispute" ? pieceWords.dispute(name)
        : piece;
      const by = confirmByText(p.actionBy!, now, tz);
      return { id: p.id, lead: bankTopLead(p.amountCents, c?.title ?? null, what), by: by.text, soon: by.soon, href: c ? bankHref(c.testId, p.id) : `/app/payments#${bankAnchor(p.id)}`, at: p.actionBy!.getTime() };
    })
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/**
 * (Batch 17 §11) The test page's "Confirm with your bank" rows: each charge made while the developer was away on this test that waits for their bank, with the piece it
 * sits under (`pieceId`: the sent part or the call; null sits under the tester's row) and its line.
 */
export async function bankWaitingOnTest(devId: string, testId: string) {
  const contracts = await db.contract.findMany({ where: { testId }, include: { tester: true, submissions: { select: { id: true, kind: true } }, calls: { select: { id: true, startsAt: true } } } });
  const waiting = await waitingConfirmation(devId, contracts.map((c) => c.id));
  if (!waiting.length) return [];
  // (Batch 25 section 1) "Confirm it by" (and a call's time) in the developer's own time zone, like the dashboard's row.
  const tz = await zoneOf(devId);
  const pieceOf = await pieceIdsOf(waiting);
  return waiting.map((p) => {
    const c = contracts.find((x) => x.id === p.contractId)!;
    const name = displayName(c.tester);
    const at = pieceOf(p);
    const sub = at.submissionId ? c.submissions.find((x) => x.id === at.submissionId) : undefined;
    const call = at.callId ? c.calls.find((x) => x.id === at.callId) : undefined;
    const piece = sub ? `${name}'s ${sub.kind === "recording" ? "recording" : "written answers"}` : call ? `${name}'s call on ${fmtDateTimeIn(call.startsAt, tz)}` : `${name}'s work`;
    const what = p.kind === "dispute" ? `the team's decision on ${name}'s dispute` : p.kind === "chargeback" ? `a payment your bank had reversed (${piece})` : piece;
    return { id: p.id, contractId: c.id, pieceId: sub?.id ?? call?.id ?? null, line: bankWaitingLine(p.amountCents, what, fmtDateTimeIn(p.actionBy!, tz)) };
  });
}

async function piStatus(id: string, simulate?: unknown) {
  if (fakeOn() && (simulate === "succeeded" || simulate === "failed")) fakeConfirm(id, simulate === "succeeded");
  if (!stripeOn()) return simulate === "succeeded" ? "succeeded" : "canceled";
  const pi = await getStripe().paymentIntents.retrieve(id);
  return pi.status;
}

/** (Batch 23 section 9) Plain refusals for "Confirm with your bank": confirmed in another tab, expired, cancelled. */
export const ALREADY_CONFIRMED = "You already confirmed this payment.";
export const CONFIRM_EXPIRED = "This confirmation expired: nothing was charged.";
export const CONFIRM_CANCELLED = "This payment was cancelled: nothing was charged.";

/** (Batch 23 section 9) A payment "Confirm with your bank" can still start on, or a plain refusal saying why not. */
async function startable(devId: string, paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.developerId !== devId) throw new HttpError(404, "not_found", "There's nothing to confirm here.");
  if (!p.actionPi) {
    if (p.status === "charged" || p.status === "not_set_up") throw new HttpError(409, "confirmed", ALREADY_CONFIRMED);
    if (p.status === "cancelled") throw new HttpError(409, "cancelled", CONFIRM_CANCELLED);
    throw new HttpError(409, "expired", CONFIRM_EXPIRED);
  }
  if (p.actionBy && p.actionBy <= new Date()) {
    await expireActions();
    throw new HttpError(409, "expired", CONFIRM_EXPIRED);
  }
  return p;
}

async function own(devId: string, paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.developerId !== devId || !p.actionPi) throw new HttpError(404, "not_found", "There's nothing to confirm here.");
  return p;
}

/**
 * "Confirm with your bank" (the test page; Payments for a renewal) on a payment that waits: what the page's inline check needs. (Batch 17 §11) A charge made while away
 * waits with no next step, so it is confirmed here with return_url: the bank's check page (`checkUrl`) then shows inline; "none" when it went through without one.
 */
export async function confirmStart(dev: { id: string }, paymentId: string, body: Record<string, unknown> = {}) {
  const p = await startable(dev.id, paymentId);
  // (Owner, Oct 29, batch 23 section 9) On the test page, the developer's stop-once check first, exactly like Pay on that piece: a stop, close or End early (batch 17 §12), a
  // dispute, the tester's Charge or Let it go, a Pay or Pay more in another tab, a call change... (Alerts apply) stops it once; the second press opens the bank's check.
  if (p.contractId && seenOf(body.seenAt)) {
    const c = await db.contract.findUnique({ where: { id: p.contractId }, select: { id: true, testId: true } });
    if (c) {
      const { devGate } = await import("./tests");
      const key = p.callId ? `call:${p.callId}` : p.submissionId ? `sub:${p.submissionId}` : `c:${c.id}`;
      await db.$transaction((tx) => devGate(tx, c.testId, body, {}, [], undefined, { acts: [...PAY_ACTS], keys: [key], stopCheck: c.id }));
    }
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  if (!stripeOn() || fakeOn()) return { paymentId, clientSecret: `${p.actionPi}_secret_fake`, publishableKey: pk(), simulated: true, paymentMethod: u.stripePaymentMethodId, checkUrl: null };
  const stripe = getStripe();
  let pi = await stripe.paymentIntents.retrieve(p.actionPi!);
  if ((pi.status === "requires_payment_method" || pi.status === "requires_confirmation") && u.stripePaymentMethodId && typeof stripe.paymentIntents.confirm === "function") {
    try {
      pi = await stripe.paymentIntents.confirm(pi.id, { payment_method: u.stripePaymentMethodId, return_url: bankReturnUrl() });
    } catch (e) {
      console.error("[stripe] confirm start:", (e as Error).message);
      throw new HttpError(402, "not_confirmed", BANK_NOT_CONFIRMED);
    }
  }
  const needs = pi.status === "succeeded" ? "none" : pi.status === "requires_action" ? "action" : "confirm";
  return { paymentId, clientSecret: pi.client_secret, publishableKey: pk(), simulated: simulated(), paymentMethod: u.stripePaymentMethodId, needs, checkUrl: checkUrlOf(pi) ?? null };
}

const split = (p: { feeCents: number; testerCents: number; transferStatus: string; actionPi: string | null }) => ({ status: "charged", feeCents: p.feeCents, testerCents: p.testerCents, transferStatus: p.transferStatus, stripePaymentIntentId: p.actionPi });

/** The page's pop-up finished (or Confirm on Payments): ask Stripe how it ended and finish the payment, or let it go with nothing charged. */
export async function confirmFinish(dev: { id: string; email: string }, paymentId: string, body: Record<string, unknown> = {}) {
  // (Batch 23 section 6) A chargeback hold's Pay what you owe reserved the money: its check ended (reserved when Stripe holds it, "requires_capture").
  const reservation = await db.reservation.findUnique({ where: { id: paymentId }, select: { stripePaymentIntentId: true, developerId: true } });
  if (reservation && reservation.developerId === dev.id) {
    const cb = await import("./chargeback");
    const status = reservation.stripePaymentIntentId ? await piStatus(reservation.stripePaymentIntentId, body.simulate) : body.simulate === "succeeded" ? "requires_capture" : "canceled";
    return cb.reservationChecked(dev.id, paymentId, status === "requires_capture" || status === "succeeded");
  }
  const p = await own(dev.id, paymentId);
  const status = await piStatus(p.actionPi!, body.simulate);
  const ok = status === "succeeded";
  if (!ok) {
    if (p.status === "needs_action" || p.status === "paying") await release(p.id);
    throw new HttpError(402, "not_confirmed", BANK_NOT_CONFIRMED);
  }
  // (Batch 15 section 41, L3) A doubled Confirm finishes it once: the first press claims it.
  const claimed = await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null } });
  if (claimed.count !== 1) return { done: true, repeated: true };
  return finish(p.id);
}

/** The bank confirmed: the payment goes through as normal, whatever started it. */
async function finish(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const payments = await import("./payments");
  const holds = await import("./holds");
  if (p.status === "needs_action" && (p.kind === "review" || p.kind === "call")) return { done: true, ...(await payments.finishReviewPay(p.id, split(p))) };
  if (p.status === "needs_action" && p.kind === "extra") return { done: true, ...(await payments.finishExtraPay(p.id, split(p))) };
  if ((p.status === "needs_action" || p.status === "needs_confirmation") && p.kind === "chargeback") {
    await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: new Date(), actionPi: null, actionBy: null } });
    const u = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
    // (Batch 25 section 5) One receipt, naming what was paid (the retry that waited for the bank sent no line of its own for this money).
    await payments.receipt(u.email, await holds.owedItemName(p), p.amountCents, "charged", "/app/payments");
    return { done: true, lifted: await holds.liftHoldIfClear(p.developerId) };
  }
  if (p.kind === "subscription") return { done: true, ...(await (await import("./subscription")).subscriptionConfirmed(p.id)) };
  // An owed payment ("paying" from a press, or failed / owed with a retry waiting), a tester's Charge or a dispute decision made while away.
  const wasOwed = p.status === "failed" || p.status === "owed" || p.status === "paying";
  await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: new Date(), failure: "", actionPi: null, actionBy: null, warnedAt: null } });
  await holds.settledOwed(p.id, wasOwed);
  return { done: true, lifted: await holds.liftHoldIfClear(p.developerId) };
}

/** A press's confirmation was refused, closed or timed out: nothing was charged and nothing is held; the piece is free again. */
export async function release(paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) return;
  if (p.actionPi && stripeOn()) await getStripe().paymentIntents.cancel(p.actionPi).catch(() => null);
  if (p.status === "needs_action" && (p.kind === "review" || p.kind === "call")) {
    await db.$transaction([db.review.deleteMany({ where: p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId! } }), db.payment.update({ where: { id: p.id }, data: { status: "cancelled", actionPi: null, actionBy: null } })]);
  } else if (p.status === "needs_action" && p.kind === "chargeback") await db.payment.delete({ where: { id: p.id } });
  else if (p.status === "needs_action") await db.payment.update({ where: { id: p.id }, data: { status: "cancelled", actionPi: null, actionBy: null } });
  else if (p.status === "paying") await db.payment.update({ where: { id: p.id }, data: { status: p.owedUntil ? "failed" : "owed", actionPi: null, actionBy: null, warnedAt: null } });
}

/**
 * The clocks: a press's pop-up left open over 15 minutes lets go (nothing charged); a charge made while away and not confirmed in 3 days counts as declined (a payment hold for
 * a charge, a lapse for a renewal); a retry of an owed payment that waited 3 days stops waiting (it stays owed). Runs from the daily job, and before any press on a piece.
 */
export async function expireActions(now = new Date(), where: { submissionId?: string; callId?: string } = {}) {
  for (const p of await db.payment.findMany({ where: { ...where, actionPi: { not: null }, actionBy: { lte: now } } })) {
    if (p.status === "needs_action" || p.status === "paying") await release(p.id);
    else if (p.status === "needs_confirmation" && p.kind === "chargeback") await db.payment.delete({ where: { id: p.id } }); // a retried chargeback: still owed
    else if (p.status === "needs_confirmation") {
      await db.payment.update({ where: { id: p.id }, data: { actionPi: null, actionBy: null } });
      if (p.kind === "subscription") {
        await db.payment.update({ where: { id: p.id }, data: { status: "failed" } });
        await (await import("./subscription")).lapse(p.developerId, now);
      } else {
        const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
        await (await import("./holds")).declinedPayment(p.developerId, p.id, p.amountCents, c ? `${displayName(c.tester)}'s ${p.kind === "dispute" ? "dispute decision" : "work"} on “${c.title}” (not confirmed with your bank)` : `a payment of ${money(p.amountCents)} (not confirmed with your bank)`);
      }
    } else await db.payment.update({ where: { id: p.id }, data: { actionPi: null, actionBy: null } });
  }
}

/** (Batch 12 section 5) Is a payment for this piece waiting for the bank's confirmation right now? */
export async function pieceLocked(where: { submissionId?: string | null; callId?: string | null }) {
  const key = where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId ?? "" };
  await expireActions(new Date(), key as { submissionId?: string; callId?: string });
  return (await db.payment.count({ where: { ...key, status: { in: ["needs_action", "needs_confirmation"] } } })) > 0;
}
