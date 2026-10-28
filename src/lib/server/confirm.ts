import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { CONFIRM_DAYS, PRESS_ACTION_MS, bankConfirmLine, bankConfirmTestLine, bankHref, bankWaitingLine, BANK_NOT_CONFIRMED } from "@/lib/rules";
import { HttpError } from "./http";
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
  await notify(dev.email, line, [line], home ?? "/app/payments#confirm", { always: true, payment: true, group: "payhold" });
  return p;
}

/** Payments waiting for the developer's confirmation (the Confirm list on Payments; with `contractIds`, one test's). */
export async function waitingConfirmation(devId: string, contractIds?: string[]) {
  return db.payment.findMany({ where: { developerId: devId, actionPi: { not: null }, actionBy: { gt: new Date() }, status: { in: ["needs_confirmation", "failed", "owed"] }, ...(contractIds ? { contractId: { in: contractIds } } : {}) }, orderBy: { createdAt: "asc" } });
}

/**
 * (Batch 17 §11) Payments' list: each charge waiting for the bank, with the link to its test page's "Confirm with your bank" (`href`), or none (a renewal: confirmed
 * right there).
 */
export async function confirmItems(devId: string) {
  const waiting = await waitingConfirmation(devId);
  const ids = [...new Set(waiting.map((p) => p.contractId).filter((x): x is string => !!x))];
  const contracts = ids.length ? await db.contract.findMany({ where: { id: { in: ids } }, select: { id: true, testId: true, title: true } }) : [];
  return waiting.map((p) => {
    const c = contracts.find((x) => x.id === p.contractId);
    const what = p.kind === "subscription" ? "Your subscription" : p.kind === "dispute" ? "A team decision" : p.kind === "chargeback" ? "A payment your bank had reversed" : "A payment";
    return { id: p.id, text: `${what} ${money(p.amountCents)}${c ? ` on “${c.title}”` : ""} · confirm by ${fmtDateTime(p.actionBy!)}`, href: c ? bankHref(c.testId, p.id) : null };
  });
}

/**
 * (Batch 17 §11) The test page's "Confirm with your bank" rows: each charge made while the developer was away on this test that waits for their bank, with the piece it
 * sits under (`pieceId`: the sent part or the call; null sits under the tester's row) and its line.
 */
export async function bankWaitingOnTest(devId: string, testId: string) {
  const contracts = await db.contract.findMany({ where: { testId }, include: { tester: true, submissions: { select: { id: true, kind: true } }, calls: { select: { id: true, startsAt: true } } } });
  const waiting = await waitingConfirmation(devId, contracts.map((c) => c.id));
  return waiting.map((p) => {
    const c = contracts.find((x) => x.id === p.contractId)!;
    const name = displayName(c.tester);
    const sub = p.submissionId ? c.submissions.find((x) => x.id === p.submissionId) : undefined;
    const call = p.callId ? c.calls.find((x) => x.id === p.callId) : undefined;
    const piece = sub ? `${name}'s ${sub.kind === "recording" ? "recording" : "written answers"}` : call ? `${name}'s call on ${fmtDateTime(call.startsAt)}` : `${name}'s work`;
    const what = p.kind === "dispute" ? `the team's decision on ${name}'s dispute` : p.kind === "chargeback" ? `a payment your bank had reversed (${piece})` : piece;
    return { id: p.id, contractId: c.id, pieceId: sub?.id ?? call?.id ?? null, line: bankWaitingLine(p.amountCents, what, fmtDateTime(p.actionBy!)) };
  });
}

async function piStatus(id: string, simulate?: unknown) {
  if (fakeOn() && (simulate === "succeeded" || simulate === "failed")) fakeConfirm(id, simulate === "succeeded");
  if (!stripeOn()) return simulate === "succeeded" ? "succeeded" : "canceled";
  const pi = await getStripe().paymentIntents.retrieve(id);
  return pi.status;
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
export async function confirmStart(dev: { id: string }, paymentId: string) {
  const p = await own(dev.id, paymentId);
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
    await payments.receipt(u.email, "a payment your bank had reversed", p.amountCents, "charged", "/app/payments");
    return { done: true, lifted: await holds.liftHoldIfClear(p.developerId) };
  }
  if (p.kind === "subscription") return { done: true, ...(await (await import("./subscription")).subscriptionConfirmed(p.id)) };
  // An owed payment ("paying" from a press, or failed / owed with a retry waiting), a tester's Charge or a dispute decision made while away.
  await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: new Date(), failure: "", actionPi: null, actionBy: null, warnedAt: null } });
  await holds.settledOwed(p.id);
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
