import { db } from "@/lib/db";
import { displayName, fmtDateTimeIn, money } from "@/lib/format";
import { CONFIRM_DAYS, PRESS_ACTION_MS, BANK_TO_CONFIRM_HREF, bankAnchor, bankHref, bankWaitingAllLine, bankWaitingLine, BANK_NOT_CONFIRMED, cardDeclinedConfirmLine } from "@/lib/rules";
import { bankTopLead, confirmByText, pieceWords, shortDay, type BankTopRow } from "@/lib/bankTop";
import { HttpError } from "./http";
import { payPressOf, seenOf } from "./live";
import { notify, renderFor } from "./notify";
import { ADD_CARD_FIRST, bankReturnUrl, checkUrlOf, fakeConfirm, fakeOn, forgetCard, getStripe, isMissing, stripeOn, type NeedsAction } from "./stripe";

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
  await tellBankWaiting(p.developerId);
  return p;
}

/**
 * (Owner, Oct 29, batch 29 §32; replaces the per-charge line) ONE bell line covering every charge waiting for the bank, across tests and renewals, opening the dashboard's
 * "Your bank wants you to confirm" box. A new waiting charge on a later day sends it again with the new totals; on the same day the day's line is updated in place (at most
 * one a day). Still in "Payments and holds", and emailed whatever the setting (the end-of-day email takes the line as it stands then).
 */
export async function tellBankWaiting(devId: string, now = new Date()) {
  const dev = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const waiting = await waitingConfirmation(devId, undefined, now);
  if (!waiting.length) return;
  const titles = new Map((await db.contract.findMany({ where: { id: { in: waiting.map((w) => w.contractId).filter((x): x is string => !!x) } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
  const line = bankWaitingAllLine(waiting.map((w) => ({ cents: w.amountCents, title: w.contractId ? titles.get(w.contractId) ?? null : null, by: w.actionBy! })));
  const key = `bankwait:${now.toISOString().slice(0, 10)}`;
  const today = await db.notification.findFirst({ where: { userId: devId, reminderKey: key }, select: { id: true, summarizedAt: true } });
  if (today && !today.summarizedAt) {
    await db.notification.update({ where: { id: today.id }, data: { text: await renderFor(devId, line), readAt: null, createdAt: now } });
    return;
  }
  await notify(dev.email, line, [line + "."], BANK_TO_CONFIRM_HREF, { side: "developer", always: true, payment: true, group: "payhold", reminder: key });
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
  // (Batch 35 §117 rule 6) Pay what you owe's one payment lists every payment it covers (name and amount); it's confirmed right here (no test).
  const covers = await (await import("./owedOnce")).coveredNames(waiting.filter((p) => p.kind === "owed").map((p) => p.id));
  return waiting.map((p) => {
    const c = contracts.find((x) => x.id === p.contractId);
    // (§122) One payment for charges made while away names them so.
    const what = p.kind === "owed" ? (p.note.endsWith(":charges") ? "Charges made while you were away" : "What you owe") : p.kind === "subscription" ? "Your subscription" : p.kind === "dispute" ? "A team decision" : p.kind === "chargeback" ? "A payment your bank had reversed" : "A payment";
    const list = p.kind === "owed" && covers.get(p.id)?.length ? ` (${covers.get(p.id)!.join(", ")})` : "";
    return { id: p.id, text: `${what} ${money(p.amountCents)}${list}${c ? ` on “${c.title}”` : ""} · confirm by ${fmtDateTimeIn(p.actionBy!, tz)}`, href: c ? bankHref(c.testId, p.id) : null };
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
  const covers = await (await import("./owedOnce")).coveredNames(waiting.filter((p) => p.kind === "owed").map((p) => p.id));
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
        // (Batch 35 §117 rule 6) Pay what you owe's one payment: "what you owe (Ana Silva's work $8.00, Ben Okafor's call on Oct 30 $5.00)".
        : p.kind === "owed" ? `${p.note.endsWith(":charges") ? "charges made while you were away" : pieceWords.owed}${covers.get(p.id)?.length ? ` (${covers.get(p.id)!.join(", ")})` : ""}`
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
  // (§130) A check Stripe doesn't know (made in test mode) was never charged: as good as cancelled, never paid.
  const pi = await getStripe().paymentIntents.retrieve(id).catch((e) => { if (isMissing(e)) return { status: "canceled" as const }; throw e; });
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
    await refusePaused(p);
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
  if (p && p.developerId === devId && !p.actionPi) await refusePaused(p);
  if (!p || p.developerId !== devId || !p.actionPi) throw new HttpError(404, "not_found", "There's nothing to confirm here.");
  return p;
}

/** (Owner, Nov 2, batch 35 §122) "This payment is paused until your tests resume.": its check was cancelled when a hold started; it waits for the lift. */
export const CONFIRM_PAUSED = "This payment is paused until your tests resume.";
async function refusePaused(p: { status: string; kind: string; note: string; developerId: string }) {
  const paused = p.status === "deferred" || (p.kind === "owed" && p.status === "cancelled" && p.note.endsWith(":charges") && !!(await db.user.findUnique({ where: { id: p.developerId }, select: { holdStartedAt: true } }))?.holdStartedAt);
  if (paused) throw new HttpError(409, "paused", CONFIRM_PAUSED);
}

/**
 * "Confirm with your bank" (the test page; Payments for a renewal) on a payment that waits: what the page's inline check needs. (Batch 17 §11) A charge made while away
 * waits with no next step, so it is confirmed here with return_url: the bank's check page (`checkUrl`) then shows inline; "none" when it went through without one.
 */
export async function confirmStart(dev: { id: string }, paymentId: string, body: Record<string, unknown> = {}) {
  const p = await startable(dev.id, paymentId);
  // (Owner, Oct 29, batch 23 section 9) On the test page, the developer's stop-once check first, exactly like Pay on that piece: a stop, close or End early (batch 17 §12), a
  // dispute, the tester's Charge or Let it go, a Pay or Pay more in another tab, a call change... (Alerts apply) stops it once; the second press opens the bank's check.
  // (Owner, Oct 29, batch 26 section 9) EXACTLY Pay's check on that piece: the same devGate call under the same test lock, the same press (payPressOf: a retried
  // chargeback's row checks the piece of the payment the bank reversed), so whatever stops Pay on it stops Confirm, and the same Alerts types are ignored.
  if (p.contractId && seenOf(body.seenAt)) {
    const c = await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } });
    if (c) {
      const { devGate } = await import("./tests");
      const { paidSoFar } = await import("./payments");
      const orig = p.kind === "chargeback" && p.repaysId && !p.submissionId && !p.callId ? await db.payment.findUnique({ where: { id: p.repaysId }, select: { submissionId: true, callId: true } }) : null;
      const piece = { submissionId: p.submissionId ?? orig?.submissionId ?? null, callId: p.callId ?? orig?.callId ?? null };
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
        await devGate(tx, c.testId, body, { paidSoFarCents: await paidSoFar(c.id, tx), name: displayName(c.tester) }, [], undefined, payPressOf(c.id, piece));
      });
    }
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  if (!stripeOn() || fakeOn()) return { paymentId, clientSecret: `${p.actionPi}_secret_fake`, publishableKey: pk(), simulated: true, paymentMethod: u.stripePaymentMethodId, checkUrl: null };
  const stripe = getStripe();
  let pi: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>;
  try {
    pi = await stripe.paymentIntents.retrieve(p.actionPi!);
  } catch (e) {
    if (!isMissing(e)) throw e;
    // (§130) Stripe doesn't know this check (made in test mode): nothing was charged on it. It's closed as cancelled (never paid, never a decline).
    if ((await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null, actionBy: null } })).count === 1) await closeStaleCheck(p);
    throw new HttpError(409, "cancelled", CONFIRM_CANCELLED);
  }
  // (Batch 28 §10, checked on Stripe test mode) A renewal's invoice (or an off-session try) that the bank wants confirmed waits on Stripe.js ("use_stripe_sdk"): confirmed
  // again here with return_url, Stripe hands back the bank's check page, shown inline like a press's.
  const sdkOnly = pi.status === "requires_action" && !checkUrlOf(pi);
  // (Owner, Nov 2, batch 35 §117 rule 1) ONE CARD IN PLAY: "Confirm with your bank" always approves it on the CURRENT card, never finishes a check made on another one.
  const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id ?? null;
  const otherCard = pi.status === "requires_action" && !!pm && !!u.stripePaymentMethodId && pm !== u.stripePaymentMethodId;
  if ((pi.status === "requires_payment_method" || pi.status === "requires_confirmation" || sdkOnly || otherCard) && u.stripePaymentMethodId && typeof stripe.paymentIntents.confirm === "function") {
    try {
      pi = await stripe.paymentIntents.confirm(pi.id, { payment_method: u.stripePaymentMethodId, return_url: bankReturnUrl() });
    } catch (e) {
      console.error("[stripe] confirm start:", (e as Error).message);
      // (§130) The card on file is unknown to Stripe: cleared, and the developer adds a card (not a decline; the check keeps waiting until its time).
      if (isMissing(e)) {
        await forgetCard(u.id);
        throw new HttpError(409, "no_card", ADD_CARD_FIRST);
      }
      // (Batch 35 §92) The card on file was declined: say so, and by when to confirm with another card (a charge made while away keeps waiting until then).
      const declined = (e as { type?: string }).type === "StripeCardError";
      throw new HttpError(402, "not_confirmed", declined && p.actionBy ? cardDeclinedConfirmLine(fmtDateTimeIn(p.actionBy, u.timeZone)) : BANK_NOT_CONFIRMED);
    }
  }
  const needs = pi.status === "succeeded" ? "none" : pi.status === "requires_action" ? "action" : "confirm";
  return { paymentId, clientSecret: pi.client_secret, publishableKey: pk(), simulated: simulated(), paymentMethod: u.stripePaymentMethodId, needs, checkUrl: checkUrlOf(pi) ?? null };
}

// (Batch 35 §117) The check's PaymentIntent: Confirm claims it (actionPi cleared) before finishing, so the one stored with it (pressAction / awayAction) is used then.
const split = (p: { feeCents: number; testerCents: number; transferStatus: string; actionPi: string | null; stripePaymentIntentId: string | null }) => ({ status: "charged", feeCents: p.feeCents, testerCents: p.testerCents, transferStatus: p.transferStatus, stripePaymentIntentId: p.actionPi ?? p.stripePaymentIntentId });

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

/** The bank confirmed: the payment goes through as normal, whatever started it. (Batch 35 §117) Also for a check that had already gone through when it was cancelled. */
export async function finishConfirmed(paymentId: string) {
  return finish(paymentId);
}
async function finish(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const payments = await import("./payments");
  const holds = await import("./holds");
  // (Owner, Nov 2, batch 35 §117 rule 6) Pay what you owe's ONE payment: every debt it covers is paid by it together; one receipt names them all.
  if (p.kind === "owed") {
    const s = await (await import("./owedOnce")).settleOwed(p.id, p.stripePaymentIntentId);
    if (s.again) return { done: true, repeated: true };
    const u = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
    if (s.cents > 0) await payments.receipt(u.email, (await import("./owedOnce")).receiptWhat(s.names, s.charges), s.cents, stripeOn() ? "charged" : "not_set_up", "/app/payments");
    return { done: true, lifted: await holds.liftHoldIfClear(p.developerId) };
  }
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
  // (Batch 33 §3) A failed charge paid later keeps why it failed (the Payment failures box).
  await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: new Date(), ...(p.owedUntil ? {} : { failure: "" }), actionPi: null, actionBy: null, warnedAt: null } });
  await holds.settledOwed(p.id, wasOwed);
  return { done: true, lifted: await holds.liftHoldIfClear(p.developerId) };
}

/** A press's confirmation was refused, closed or timed out: nothing was charged and nothing is held; the piece is free again. */
export async function release(paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) return;
  // (Batch 28 §10) A Subscribe's first payment belongs to its invoice, which Stripe won't let be cancelled: the incomplete subscription is cancelled instead (its
  // invoice is voided). Every other press cancels its PaymentIntent.
  const subId = p.kind === "subscription" && p.status === "needs_action" && p.note.startsWith("sub:") && p.note !== "sub:manual" ? p.note.slice(4) : "";
  if (subId && stripeOn()) await getStripe().subscriptions.cancel(subId).catch(() => null);
  else if (p.actionPi && stripeOn() && p.kind === "subscription") await getStripe().paymentIntents.cancel(p.actionPi).catch(() => null);
  else if (p.actionPi && stripeOn()) {
    // (Batch 35 §117 rule 4) Never an orphan check: cancelled at Stripe first; one that had already gone through is recorded as paid (never charged again). When
    // Stripe's answer is unclear the check stays tracked (the clock tries again).
    let end: "cancelled" | "succeeded" | "missing";
    try {
      end = await (await import("./owedOnce")).dropCheck(p.actionPi);
    } catch {
      return;
    }
    if (end === "succeeded") {
      if ((await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null } })).count === 1) await finish(p.id);
      return;
    }
  }
  // (§117) Pay what you owe's one payment: what it covered is owed (and payable) again.
  if (p.kind === "owed") return void (await (await import("./owedOnce")).releaseOwed(p.id));
  if (p.status === "needs_action" && (p.kind === "review" || p.kind === "call")) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({ where: { id: p.id, status: "needs_action" }, data: { status: "cancelled", actionPi: null, actionBy: null } });
      // New Pays have only a draft to release; retain support for older reservations.
      if (claimed.count && !p.reviewDraft) await tx.review.deleteMany({ where: p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId! } });
    });
  } else if (p.status === "needs_action" && p.kind === "chargeback") await db.payment.delete({ where: { id: p.id } });
  else if (p.status === "needs_action") await db.payment.update({ where: { id: p.id }, data: { status: "cancelled", actionPi: null, actionBy: null } });
  else if (p.status === "paying") await db.payment.update({ where: { id: p.id }, data: { status: p.owedUntil ? "failed" : "owed", actionPi: null, actionBy: null, warnedAt: null } });
}

/**
 * The clocks: a press's pop-up left open over 15 minutes lets go (nothing charged); a charge made while away and not confirmed in 3 days counts as declined (a payment hold for
 * a charge, a lapse for a renewal); a retry of an owed payment that waited 3 days stops waiting (it stays owed). Runs from the daily job, and before any press on a piece.
 */
export async function expireActions(now = new Date(), where: { submissionId?: string; callId?: string; contractId?: string; developerId?: string } = {}) {
  for (const p of await db.payment.findMany({ where: { ...where, actionPi: { not: null }, actionBy: { lte: now } } })) {
    try {
      await expireOne(p, now);
    } catch (e) {
      console.error("[confirm] expire:", (e as Error).message); // tried again next time (the check stays tracked)
    }
  }
}

async function expireOne(p: Awaited<ReturnType<typeof db.payment.findUniqueOrThrow>>, now: Date) {
  if (p.status === "needs_action" || p.status === "paying") return release(p.id);
  // (Owner, Nov 2, batch 35 §117 rule 4) NEVER AN ORPHAN CHECK: the check is cancelled at Stripe before the app stops tracking it (else an old bank page could still
  // complete it while the item is charged again); one that had already gone through is recorded as paid instead. (A renewal's check is its invoice's: the lapse ends it.)
  const end = p.kind === "subscription" ? "cancelled" : await (await import("./owedOnce")).dropCheck(p.actionPi);
  // Claimed, so a Confirm finishing at the same moment and this clock never both act on it.
  if ((await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null, actionBy: null } })).count !== 1) return;
  if (end === "succeeded") return void (await finish(p.id));
  // (§130) A check Stripe doesn't know (made in test mode) didn't run out: it's closed with nothing charged, never counted as declined.
  if (end === "missing") return closeStaleCheck(p);
  if (p.kind === "owed") {
    // Pay what you owe's one payment: each debt stays owed. (§122) A one payment for charges made while away counts as declined: each becomes a debt (during a hold
    // they keep waiting for the lift instead, §113).
    const once = await import("./owedOnce");
    const freed = await once.releaseOwed(p.id);
    // (§125) Its box says so plainly: "Your bank check ran out on <date>: nothing was charged. Pay again or change your card." (once.ranOutLine)
    if (freed) await db.payment.update({ where: { id: p.id }, data: { failure: once.RAN_OUT, warnedAt: p.actionBy ?? now } });
    const held = !!(await db.user.findUnique({ where: { id: p.developerId }, select: { holdStartedAt: true } }))?.holdStartedAt;
    // (§125) Pay what you owe's one payment also covers charges waiting for the lift: they keep waiting (never debts).
    if (once.forCharges(p) && freed?.charges.length && !held) await once.chargesDeclined(p.developerId, freed.charges);
  }
  else if (p.status === "needs_confirmation" && p.kind === "chargeback") await db.payment.delete({ where: { id: p.id } }); // a retried chargeback: still owed
  else if (p.status === "needs_confirmation") {
    if (p.kind === "subscription") {
      await db.payment.update({ where: { id: p.id }, data: { status: "failed" } });
      await (await import("./subscription")).lapse(p.developerId, now);
    } else if (!(await (await import("./owedOnce")).deferWhileHeld(p.id))) {
      // (Batch 35 §113 with §117) During a hold it waits for the lift instead (never added to Pay what you owe); otherwise it counts as declined.
      const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, include: { tester: true } }) : null;
      await (await import("./holds")).declinedPayment(p.developerId, p.id, p.amountCents, c ? `${displayName(c.tester)}'s ${p.kind === "dispute" ? "dispute decision" : "work"} on “${c.title}” (not confirmed with your bank)` : `a payment of ${money(p.amountCents)} (not confirmed with your bank)`);
    }
  }
  // else: a debt with a check of its own (before §117): it stays owed.
}

/** (§130) Why a check closed by the live switch, or found unknown to Stripe, was closed (kept on the payment as its failure). */
export const STALE_CHECK = "Closed: this check was made in Stripe's other mode (test or live). Nothing was charged.";
/**
 * (Owner, Nov 2, batch 35 §130) A bank check whose PaymentIntent Stripe doesn't know (made in test mode; already unclaimed: actionPi cleared): closed with NOTHING
 * charged, never paid and never a decline. A press's check is released as a cancelled press; Pay what you owe's one payment lets what it covered be owed again (charges
 * it covered wait again, never declined); a retried chargeback's row goes (the reversal stays owed); a debt with a check of its own stays owed; a renewal's check is
 * cancelled; a charge made while away (a tester's Charge, an automatic call charge, a dispute decision) is cancelled and its part is unpaid again (the review the charge
 * made goes, a dispute is open again; the row stays as the record, its keys freed), as when Stripe failed for a reason that isn't the card. scripts/stripe-mode-switch.mjs closes them the same way.
 */
export async function closeStaleCheck(p: { id: string }) {
  const row = await db.payment.findUnique({ where: { id: p.id } });
  if (!row) return;
  if (row.status === "needs_action" || row.status === "paying") return release(row.id);
  if (row.kind === "owed") return void (await (await import("./owedOnce")).releaseOwed(row.id));
  if (row.status !== "needs_confirmation") return; // a debt with a check of its own: it stays owed
  if (row.kind === "chargeback") return void (await db.payment.delete({ where: { id: row.id } }));
  await db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({ where: { id: row.id, status: "needs_confirmation" }, data: { status: "cancelled", failure: STALE_CHECK, actionPi: null, actionBy: null, payKey: null, pressKey: null } }); // keys freed: the part can be charged again
    if (!claimed.count || row.kind === "subscription") return;
    if (row.kind === "dispute" && row.disputeId) await tx.dispute.updateMany({ where: { id: row.disputeId, status: "decided" }, data: { status: "open", decidedCents: null, decidedAt: null, decidedById: null, decisionNote: "" } });
    else if ((row.kind === "review" || row.kind === "call") && (row.submissionId || row.callId)) await tx.review.deleteMany({ where: row.submissionId ? { submissionId: row.submissionId } : { callId: row.callId! } });
  });
}

/** (Batch 12 section 5) Is a payment for this piece waiting for the bank's confirmation right now? */
export async function pieceLocked(where: { submissionId?: string | null; callId?: string | null }) {
  const key = where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId ?? "" };
  await expireActions(new Date(), key as { submissionId?: string; callId?: string });
  return (await db.payment.count({ where: { ...key, status: { in: ["pending", "needs_action", "needs_confirmation"] } } })) > 0;
}
