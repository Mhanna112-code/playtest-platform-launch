import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { CONFIRM_DAYS, PRESS_ACTION_MS, bankConfirmLine, BANK_NOT_CONFIRMED } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { fakeConfirm, fakeOn, getStripe, stripeOn, type NeedsAction } from "./stripe";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment": Stripe's requires_action is NOT a decline.
//
// - The developer's own press (Pay, Pay more, Pay what you owe, Subscribe): the charge is made on-session; when the bank asks, the page shows its confirmation pop-up with
//   Stripe.js. The payment waits as "needs_action" (an owed payment as "paying") with actionPi / actionBy = 15 minutes; while it waits the piece is locked (batch 12
//   section 5: a tester's Charge or Let it go on it is refused). Confirmed: it goes through as normal. Refused, closed or timed out: nothing was charged, no hold.
// - A charge made while the developer isn't there (a tester's Charge, a dispute decision, a retry during a hold, a renewal): it waits as "needs_confirmation" (an owed payment
//   keeps its status) with actionBy = 3 days. The developer is told (bell and email, sent even with email Off) and Payments shows Confirm. Not confirmed in 3 days: it counts as
//   declined (a payment hold for a charge, a lapse for a renewal). The tester reads "Payment may be delayed".

const pk = () => process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
/** In the local fake (and in tests without Stripe.js) the page simulates the bank's pop-up. */
const simulated = () => fakeOn() || !pk();

/** A press's charge needs the cardholder: lock it for up to 15 minutes and hand the page what its pop-up needs. */
export async function pressAction(paymentId: string, r: NeedsAction & { feeCents?: number; testerCents?: number; transferStatus?: string }, keepStatus = false) {
  await db.payment.update({
    where: { id: paymentId },
    data: { ...(keepStatus ? {} : { status: "needs_action" }), actionPi: r.stripePaymentIntentId, actionBy: new Date(Date.now() + PRESS_ACTION_MS), stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) },
  });
  return { requiresAction: true as const, paymentId, clientSecret: r.clientSecret, publishableKey: pk(), simulated: simulated() };
}

/** A charge made while the developer wasn't there needs them: it waits 3 days for their Confirm in Payments (told by bell and email, even with email Off). */
export async function awayAction(paymentId: string, r: NeedsAction & { feeCents?: number; testerCents?: number; transferStatus?: string }, keepStatus = false) {
  const by = new Date(Date.now() + CONFIRM_DAYS * 86_400_000);
  const p = await db.payment.update({
    where: { id: paymentId },
    data: { ...(keepStatus ? {} : { status: "needs_confirmation" }), actionPi: r.stripePaymentIntentId, actionBy: by, stripePaymentIntentId: r.stripePaymentIntentId, ...(r.feeCents != null ? { feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus } : {}) },
  });
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  const line = bankConfirmLine(p.amountCents, by);
  await notify(dev.email, line, [line], "/app/payments#confirm", { always: true, payment: true, group: "payhold" });
  return p;
}

/** Payments waiting for the developer's confirmation (the Confirm list on Payments). */
export async function waitingConfirmation(devId: string) {
  return db.payment.findMany({ where: { developerId: devId, actionPi: { not: null }, actionBy: { gt: new Date() }, status: { in: ["needs_confirmation", "failed", "owed"] } }, orderBy: { createdAt: "asc" } });
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

/** Confirm (Payments) on a payment that waits: what the page's Stripe pop-up needs. */
export async function confirmStart(dev: { id: string }, paymentId: string) {
  const p = await own(dev.id, paymentId);
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  if (!stripeOn() || fakeOn()) return { paymentId, clientSecret: `${p.actionPi}_secret_fake`, publishableKey: pk(), simulated: true, paymentMethod: u.stripePaymentMethodId };
  const pi = await getStripe().paymentIntents.retrieve(p.actionPi!);
  return { paymentId, clientSecret: pi.client_secret, publishableKey: pk(), simulated: simulated(), paymentMethod: u.stripePaymentMethodId, needs: pi.status === "requires_action" ? "action" : "confirm" };
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
