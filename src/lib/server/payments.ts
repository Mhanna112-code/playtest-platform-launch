import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money, toCents } from "@/lib/format";
import { LET_GO_BY_TESTER, chargedByTester, byTesterChoice, callReference, checkDevSide, canDispute, checkDisputeDecision, disputeLimitText, testerPayable, PAYABLE_TESTER, deletedNoPayoutsLine, delayedPayLine, declinedHoldLine, checkPay, checkReject, checkExtraPay, extraCapCents, overListingLine, overMaxLine, pieceMaxCents, NO_LISTING_CALL_RATE_CAP_CENTS, NO_LISTING_CALLS_TOTAL_CENTS, overCallsLine, PAY_WAITS, testerShare } from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify } from "./notify";
import { blockedEitherWay } from "./blocks";
import { labelled, reportedOver3 } from "./reports";
import { partAnchor } from "@/lib/links";
import { isAdmin } from "./session";
import { cardRefusal, charge, type NeedsAction } from "./stripe";
import { devGate, devGateIfSeen, devOwes, recordEvent } from "./tests";
import { logEvent } from "./live";
import { testerGate } from "./testerGate";
import { PAYMENT_CHECKING, pressKeyFor } from "./recovery";

type U = { id: string; email: string; name: string; pronoun: string; isAdmin?: boolean };

/** Everything paid to this tester on this test so far (Pay presses and dispute raises), in cents. */
export async function paidSoFar(contractId: string, tx: Prisma.TransactionClient = db) {
  const r = await tx.payment.aggregate({ where: { contractId, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  return r._sum.amountCents ?? 0;
}

/** A piece the developer can pay: a sent written answer / recording, or a held (started, not cancelled) call. */
async function loadPiece(tx: Prisma.TransactionClient, kind: string, id: string) {
  if (kind === "submission") {
    const s = await tx.submission.findUnique({ where: { id }, include: { review: true, contract: { include: { test: true, tester: true } } } });
    if (!s) return null;
    return { contract: s.contract, review: s.review, listing: s.agreedCents, label: s.kind === "written" ? "written answers" : "recording", where: { submissionId: s.id }, kind: "submission" as const, minutes: 0 };
  }
  if (kind === "call") {
    const c = await tx.call.findUnique({ where: { id }, include: { review: true, contract: { include: { test: true, tester: true } } } });
    if (!c) return null;
    if (c.status === "cancelled") throw new HttpError(409, "cancelled", "This call was cancelled, so there's nothing to pay.");
    if (c.startsAt > new Date()) throw new HttpError(409, "not_yet", "You can pay for this call once it has started.");
    return { contract: c.contract, review: c.review, listing: callReference(c.rateCents, c.actualMinutes ?? c.minutes).cents, label: "live call", where: { callId: c.id }, kind: "call" as const, minutes: c.actualMinutes ?? c.minutes };
  }
  return null;
}

/**
 * Pay or Reject one piece. Checks (in order): the piece is on the developer's test and not paid/rejected yet (final
 * refusal: "You already paid $8.00 for this."), the tester's account can be paid (final), the developers' one stop-once
 * gate (test-wide, since the page loaded), then the amount rules and the "charged now" tick (Pay) or a reason (Reject).
 * Pay reserves the piece, charges once (idempotent by payKey) and records the payment; Reject charges nothing.
 */
export async function review(dev: U & Parameters<typeof cardRefusal>[0] & { holdStartedAt?: Date | null; suspendedAt?: Date | null }, body: Record<string, unknown>) {
  const reject = body.action === "reject";
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const payKey = typeof body.payKey === "string" && /^[\w-]{8,80}$/.test(body.payKey) ? body.payKey : "";
  if (!payKey) throw new HttpError(400, "bad_request", "This page is out of date. Refresh to see the latest.");
  const done = await db.review.findUnique({ where: { payKey } });
  if (done) return { reviewId: done.id, amountCents: done.amountCents, rejected: done.rejected, repeated: true }; // the same press again: never twice
  const amountCents = reject ? 0 : toCents(body.amount);
  const tickedCents = typeof body.tickedCents === "number" ? body.tickedCents : null;
  // (Batch 9) The optional note on every Pay (required below the listing): the same field as the reason.
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const over200 = body.over200 === true || body.understood === true;
  // (Batch 9) A call's Pay: the rate typed ($/h), when one was.
  const rateCents = body.rate === undefined || body.rate === null || body.rate === "" ? null : toCents(body.rate);

  // (Owner, Oct 27) Pay and Reject are unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, suspendedAt: true } });
  if (devNow.suspendedAt || devNow.holdStartedAt) throw new HttpError(403, devNow.suspendedAt ? "suspended" : "held", devNow.suspendedAt ? "Your account is suspended: Pay and Reject wait until it is lifted." : PAY_WAITS);

  const reserved = await db.$transaction(async (tx) => {
    const piece = await loadPiece(tx, kind, id);
    if (!piece || piece.contract.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That work doesn't exist or isn't on your test.");
    const c = piece.contract;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const name = displayName(c.tester);
    // (Owner, Oct 29, batch 11) A tester who deleted their account: their sent work is still reviewed when their payout account was connected; without one (DEFAULT)
    // nothing can reach them, so it can't be paid (final).
    if (!testerPayable(c.tester) && !(await tx.review.findFirst({ where: piece.where }))) throw new HttpError(409, "gone", deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null })));
    const already = await tx.review.findFirst({ where: piece.where });
    if (already) {
      if (chargedByTester(already.reason)) throw new HttpError(409, "reviewed", `${name} already charged ${money(already.amountCents)} for this.`);
      if (already.reason === LET_GO_BY_TESTER) throw new HttpError(409, "reviewed", `${name} let this go: nothing was charged.`);
      const owedNow = !already.rejected && (await tx.payment.findFirst({ where: { ...piece.where, status: "failed", owedUntil: { not: null }, settledAt: null } }));
      if (owedNow) throw new HttpError(409, "owed", `This ${money(already.amountCents)} is owed: pay it with “Pay what you owe” in Payments.`);
      throw new HttpError(409, "reviewed", already.rejected ? "You already rejected this." : `You already paid ${money(already.amountCents)} for this.`);
    }
    if (!reject && (await devOwes(dev.id))) throw new HttpError(409, "owed_first", PAY_WAITS);
    // (Owner, Oct 28 night, batch 9) A part that isn't listed has only Pay (any amount from $0, which closes it): never Reject.
    if (reject && piece.listing == null) throw new HttpError(409, "not_listed", "A part that isn't listed can't be rejected: pay $0 to close it.");
    // Form mistakes (red at the field) come BEFORE the stop-once: a second press would only fail on them.
    if (reject) {
      const r = checkReject(reason);
      if (!r.ok) throw new HttpError(400, "bad_reason", r.message);
    } else {
      const check = checkPay(amountCents, piece.listing, reason, tickedCents, over200);
      if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
      if (piece.kind === "call" && rateCents != null) {
        if (rateCents < 0) throw new HttpError(400, "bad_rate", "Enter a rate like 30.00.");
        if (piece.listing == null && rateCents > NO_LISTING_CALL_RATE_CAP_CENTS) throw new HttpError(400, "over_cap", "A call that isn't listed can be paid at most $200 an hour.");
      }
      // (Batch 9 section 6; batch 11 section 6: one Pay box, an amount above the base counts as extra pay; batch 12 section 2: the unlisted call caps) Caps per piece.
      const room = await pieceRoom({ ...piece, contractId: c.id }, tx);
      if (amountCents! > room.roomCents) throw new HttpError(400, "over_cap", overRoomLine(piece, room));
      const card = amountCents! > 0 ? cardRefusal(dev) : "";
      if (card) throw new HttpError(409, "no_card", card);
    }
    await devGate(tx, c.testId, body, { paidSoFarCents: await paidSoFar(c.id, tx), name });
    const rev = await tx.review.create({ data: { ...piece.where, contractId: c.id, amountCents: amountCents!, agreedCents: piece.listing, reason, payKey, rejected: reject, rateCents: !reject && piece.kind === "call" ? rateCents : null } });
    // (Batch 15 section 9) The charge's key: an interrupted press on this piece in the last 24 hours lends its key, so nothing is ever charged twice.
    const stripeKey = reject ? null : await pressKeyFor(piece.where, ["review", "call"], payKey, tx);
    const payment = reject
      ? null
      : await tx.payment.create({
          data: { kind: kind === "call" ? "call" : "review", submissionId: piece.where.submissionId ?? null, callId: piece.where.callId ?? null, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amountCents!, feeCents: 0, testerCents: 0, status: "pending", payKey: stripeKey },
        });
    if (reject) await recordEvent(tx, c.testId, "rejected", `You rejected ${name}'s ${piece.label}`, false, {}, c.id);
    return { rev, payment, c, piece, name };
  });

  const { rev, payment, c, piece, name } = reserved;
  if (reject) {
    // (Batch 10) Every reviewed part can be disputed once (only listed parts can be rejected).
    await notify(c.tester.email, `Your ${piece.label} on “${c.title}” wasn't accepted`, [`${displayName(dev)} rejected your ${piece.label}: “${rev.reason}”`, "You can dispute this once from your session page."], `/app/sessions/${c.id}#${partAnchor(piece.label)}`, { payment: true, group: "trejected" });
    return { reviewId: rev.id, amountCents: 0, rejected: true, paidSoFarCents: await paidSoFar(c.id) };
  }
  let result;
  try {
    // (Owner, Oct 29, batch 11) The developer's own press: on-session, so the bank may ask them to confirm in the page.
    const charging = (key: string) => charge(dev, c.tester, rev.amountCents, key, `Playtest: ${piece.label} on “${c.title}”`, "press");
    try {
      result = await charging(payment!.payKey ?? payKey);
    } catch (e) {
      // (Batch 15 section 9) A reused key that Stripe already saw with other details: that earlier press reached Stripe and wasn't charged, so a fresh key is safe.
      if (!(e instanceof HttpError && e.code === "idempotency")) throw e;
      await db.payment.update({ where: { id: payment!.id }, data: { payKey } });
      result = await charging(payKey);
    }
  } catch (e) {
    // (Batch 15 section 9) Stripe's answer was lost: the payment stays pending (in progress) and is checked after 15 minutes. Nothing is freed, so it can't be paid twice.
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      // Not a card decline (nothing was tried): free the piece so the developer can press Pay again.
      await db.$transaction([db.payment.update({ where: { id: payment!.id }, data: { status: "failed", failure: (e as Error).message } }), db.review.delete({ where: { id: rev.id } })]);
      throw e;
    }
    // (Owner, Oct 27) Declined at the press: the payment is owed and the payment hold starts AT ONCE. The review stays; there's no second Pay on it.
    await db.payment.update({ where: { id: payment!.id }, data: { failure: (e as Error).message } });
    await (await import("./holds")).declinedPayment(dev.id, payment!.id, rev.amountCents, `${name}'s ${piece.label} on “${c.title}”`);
    // The tester is told at once (bell; their top box and stop-once read the owed payment): never "failed".
    await bell(c.testerId, delayedPayLine(displayName(dev), piece.label, rev.amountCents), `/app/sessions/${c.id}#${partAnchor(piece.label)}`, undefined, { payment: true, group: "tdelayed" });
    throw new HttpError(402, "card_failed", declinedHoldLine(name, rev.amountCents, piece.label), { held: true, failed: `Your Pay on ${c.title} was declined` });
  }
  // (Batch 11) The bank wants the developer to confirm: the piece stays locked while its pop-up is open (batch 12 section 5), nothing is charged yet.
  if (result.status === "requires_action") return (await import("./confirm")).pressAction(payment!.id, result as NeedsAction & Record<string, unknown>);
  return finishReviewPay(payment!.id, result);
}

/** (Batch 11) A Pay went through (at once, or once the bank confirmed it): the payment is recorded, the tester told, the receipt sent. */
export async function finishReviewPay(paymentId: string, result: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const rev = await db.review.findFirstOrThrow({ where: p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId! } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const dev = c.test.developer;
  const name = displayName(c.tester);
  const piece = { label: p.callId ? "live call" : (await db.submission.findUnique({ where: { id: p.submissionId! } }))?.kind === "recording" ? "recording" : "written answers" };
  const data = { status: result.status, stripePaymentIntentId: result.stripePaymentIntentId, ...(result.feeCents != null ? { feeCents: result.feeCents, testerCents: result.testerCents, transferStatus: result.transferStatus } : {}), actionPi: null, actionBy: null };
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: p.id }, data });
    await recordEvent(tx, c.testId, "paid", `You paid ${name} ${money(rev.amountCents)} for the ${piece.label}`, false, {}, c.id);
  });
  // (Batch 9) The note rides in the bell line too; $0 reads "<dev> paid $0 for this".
  await notify(
    c.tester.email,
    // (Batch 11 section 6) "<dev> paid you $X" for the first payment ("<dev> paid you $X more" for a Pay more).
    `${rev.amountCents === 0 ? `${displayName(dev)} paid $0 for your ${piece.label} on “${c.title}”` : `${displayName(dev)} paid you ${money(rev.amountCents)} for your ${piece.label} on “${c.title}”`}${rev.reason ? `: “${rev.reason}”` : ""}`,
    [
      rev.amountCents === 0 ? `${displayName(dev)} paid $0 for this.` : `${displayName(dev)} paid ${money(rev.amountCents)}${rev.rateCents != null ? ` (${money(rev.rateCents)}/h)` : ""} for your ${piece.label}: you get ${money(testerShare(rev.amountCents))}.`,
      ...(rev.reason ? [`Their note: “${rev.reason}”`] : []),
      ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : []),
    ],
    `/app/sessions/${c.id}#${partAnchor(piece.label)}`,
    { payment: true, group: "tpaid" },
  );
  if (rev.amountCents > 0) await receipt(dev.email, `${name}'s ${piece.label}`, rev.amountCents, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
  // A suspended tester is paid later (their share is held): said neutrally, never why.
  return { reviewId: rev.id, amountCents: rev.amountCents, status: result.status, rejected: false, paidSoFarCents: await paidSoFar(c.id), ...(c.tester.suspendedAt && rev.amountCents > 0 ? { later: `${name} will receive it later` } : {}) };
}

/** Tester: dispute once, on any part the developer reviewed (batch 10: listed or not, any amount, $0 included, or a Reject). */
export async function openDispute(tester: U, contractId: string, body: Record<string, unknown>) {
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
  if (reason.length < 10) throw new HttpError(400, "bad_reason", "Say why you think the pay should be higher (at least a sentence).");
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  const where = kind === "call" ? { callId: id } : { submissionId: id };
  // (Owner, Oct 28 afternoon) Disputes work while the test is paused (and while the developer owes a declined payment): a decision for the tester during a hold is added to what is owed.
  const review = await db.review.findFirst({ where: { ...where, contractId } });
  if (review && !(await db.dispute.findFirst({ where }))) await testerGate(tester.id, contractId, c.testId, body);
  if (!review) throw new HttpError(409, "not_paid", "This hasn't been paid yet.");
  const existing = await db.dispute.findFirst({ where });
  const ok = canDispute(review.amountCents, review.agreedCents, !!existing, byTesterChoice(review.reason));
  if (!ok.ok) throw new HttpError(409, "no_dispute", ok.message);
  const d = await db.dispute.create({ data: { ...where, contractId, testerId: tester.id, reason } });
  await logEvent(c.testId, "dispute", `${displayName(tester)} disputed the pay for their ${kind === "call" ? "live call" : (await db.submission.findUnique({ where: { id } }))?.kind === "recording" ? "recording" : "written answers"}`, contractId);
  await notify(c.test.developer.email, `${displayName(tester)} disputed a payment on “${c.title}”`, [`${displayName(tester)} thinks the pay should be higher: “${reason}”`, `Our team decides. A decision can only raise the pay, ${disputeLimitText(review.agreedCents, kind === "call" ? "call" : "submission")}.`], `/app/tests/${c.testId}#item-dispute-${d.id}`, { group: "disputefiled" });
  // (Owner, Oct 26) Admins are told too: new-dispute lines on the same day stack into one line across tests, linking to the disputes.
  const flagged = await reportedOver3([tester.id, c.test.developerId]);
  for (const a of await adminUsers()) await bell(a.id, `Dispute on “${c.title}”: ${labelled(displayName(tester), flagged.has(tester.id))} says the pay should be higher (${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))})`, "/admin#disputes", undefined, { group: "disputes" });
  return d;
}

/**
 * (Item 28) What an admin may decide for a dispute: MIN = what this piece was paid; MAX = the part's listing minus what was
 * already paid for that part on OTHER pieces (payments on the same work that are not this review's).
 * (Owner, Oct 29, batch 10) An unlisted part: MAX = the unlisted cap ($1000 for a written or recording piece, $200/h × the logged minutes for a call) minus what was already
 * paid on it besides this Pay (its extra pays). `listing` is then that cap and `unlisted` is true.
 */
export async function disputeBounds(d: { submissionId: string | null; callId: string | null }) {
  const review = await db.review.findFirstOrThrow({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
  const paid = await db.payment.aggregate({ where: { ...(d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! }), kind: { not: "dispute" }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  if (review.agreedCents == null) {
    const piece = await pieceOf(d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId });
    const cap = piece ? pieceMaxCents(piece.kind, piece.minutes) : 0;
    const other = Math.max(0, (paid._sum.amountCents ?? 0) - review.amountCents);
    // (Batch 12 section 2) An unlisted call also stays within what is left of the tester's $1000 for unlisted calls.
    const pool = piece?.kind === "call" ? review.amountCents + Math.max(0, NO_LISTING_CALLS_TOTAL_CENTS - (await unlistedCallsPaid(piece.contractId))) : Infinity;
    return { review, listing: cap, unlisted: true, other, min: review.amountCents, max: Math.max(review.amountCents, Math.min(cap - other, pool)) };
  }
  const other = d.submissionId ? Math.max(0, (paid._sum.amountCents ?? 0) - review.amountCents) : 0;
  const listing = review.agreedCents;
  return { review, listing, unlisted: false, other, min: review.amountCents, max: Math.max(review.amountCents, listing - other) };
}

/** Admin: decide a dispute. The total can only go up (to at most the listing minus what the part was already paid on other pieces); blank keeps the pay; the extra is charged. */
export async function decideDispute(admin: U, disputeId: string, body: Record<string, unknown>) {
  if (!isAdmin(admin)) throw new HttpError(403, "not_admin", "Only admins can decide disputes.");
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  if (d.status !== "open") {
    const by = d.decidedById ? await db.user.findUnique({ where: { id: d.decidedById } }) : null;
    throw new HttpError(409, "decided", `This dispute was already decided${by ? ` by ${displayName(by)}` : ""}${d.decidedAt ? ` at ${fmtDateTime(d.decidedAt)}` : ""}.`);
  }
  const { review, other, listing, unlisted } = await disputeBounds(d);
  // A blank box keeps the pay as it is.
  const blank = body.total === undefined || body.total === null || String(body.total).trim() === "";
  const decided = blank ? review.amountCents : toCents(body.total);
  const check = checkDisputeDecision(decided, review.amountCents, listing, other, unlisted);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const extra = check.extraCents!;
  const c = await db.contract.findUniqueOrThrow({ where: { id: d.contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  // Claim the dispute first so two admins can't charge twice.
  const claimed = await db.dispute.updateMany({ where: { id: d.id, status: "open" }, data: { status: "decided", decidedCents: decided!, decisionNote: note, decidedById: admin.id, decidedAt: new Date() } });
  if (claimed.count !== 1) {
    // Any admin, first decision wins: the second press says who and when.
    const won = await db.dispute.findUnique({ where: { id: d.id } });
    const by = won?.decidedById ? await db.user.findUnique({ where: { id: won.decidedById } }) : null;
    throw new HttpError(409, "decided", `This dispute was already decided${by ? ` by ${displayName(by)}` : ""}${won?.decidedAt ? ` at ${fmtDateTime(won.decidedAt)}` : ""}.`);
  }
  let delayed = false;
  const owedRow = { kind: "dispute", disputeId: d.id, submissionId: d.submissionId, callId: d.callId, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, amountCents: extra, feeCents: 0, testerCents: 0 };
  if (extra > 0 && c.test.developer.holdStartedAt) {
    // (Owner, Oct 28 afternoon) During a payment or chargeback hold the raise is added to what the developer owes ("Pay what you owe"); the tester is paid when it is paid.
    await db.payment.create({ data: { ...owedRow, status: "owed" } });
    await bell(c.test.developerId, `The team's decision on ${displayName(c.tester)}'s dispute (${money(extra)} more) was added to what you owe`, c.test.developer.holdReason === "chargeback" ? "/app/payments#chargeback-steps" : "/app/payments#owed", undefined, { payment: true, group: "payhold" });
    delayed = true;
  } else if (extra > 0) {
    // Charged at once, also during an admin suspension with no hold (owner, Oct 28 afternoon): a declined card starts a payment hold and the raise is owed.
    let result;
    try {
      result = await charge(c.test.developer, c.tester, extra, `dispute-${d.id}`, `Playtest: dispute decision on “${c.title}”`);
      if (result.status === "requires_action") {
        // (Batch 11) The developer's bank wants them to confirm: it waits 3 days for their Confirm in Payments (the tester reads "Payment may be delayed").
        const row = await db.payment.create({ data: { ...owedRow, status: "needs_confirmation" } });
        await (await import("./confirm")).awayAction(row.id, result as NeedsAction);
        result = undefined;
        delayed = true;
      }
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "card_failed")) {
        await db.dispute.update({ where: { id: d.id }, data: { status: "open", decidedCents: null, decidedAt: null } });
        throw e;
      }
      const failed = await db.payment.create({ data: { ...owedRow, status: "failed", failure: e.message, owedUntil: new Date() } });
      await (await import("./holds")).declinedPayment(c.test.developerId, failed.id, extra, `the team's decision on ${displayName(c.tester)}'s dispute`);
      delayed = true;
    }
    if (result) {
      await receipt(c.test.developer.email, `the dispute decision on ${displayName(c.tester)}'s work`, extra, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
      await db.payment.create({ data: { kind: "dispute", disputeId: d.id, submissionId: d.submissionId, callId: d.callId, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, ...result } });
    }
  }
  const line = extra > 0 ? `The team raised the pay to ${money(decided!)} (${money(extra)} more).` : `The team kept the pay at ${money(review.amountCents)}${review.rejected ? " (rejected)" : ""}.`;
  await logEvent(c.testId, "admin", `The team decided ${displayName(c.tester)}'s dispute: ${line.replace(/^The team /, "").replace(/\.$/, "")}`, c.id);
  await (await import("./ratings")).maybePromptRating(c.id);
  await notify(c.tester.email, `Your dispute on “${c.title}” was decided`, [line, ...(delayed ? ["Payment may be delayed until the test resumes."] : []), ...(note ? [`Their note: “${note}”`] : [])], `/app/sessions/${c.id}#${d.callId ? "part-live" : partAnchor((await db.submission.findUnique({ where: { id: d.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers")}`, { group: "disputedecided" });
  await notify(c.test.developer.email, `A dispute on “${c.title}” was decided`, [line, ...(note ? [`The team's note: “${note}”`] : [])], `/app/tests/${c.testId}#tester-${c.id}`, { group: "disputedecided" });
  return { extraCents: extra };
}

/** A payment receipt to the developer for every payment that goes through: bell + email, always sent. */
export async function receipt(devEmail: string, what: string, cents: number, status: string, path: string) {
  const line = `Receipt: you paid ${money(cents)} for ${what}`;
  await notify(devEmail, line, [line + ".", status === "not_set_up" ? "Payments aren't set up yet, so this was recorded and nothing was charged." : "Charged to your saved card."], path, { payment: true });
}

/** The developer adds their side to a dispute once; it shows under that piece of work and the admin sees both. */
export async function addDevSide(dev: U, testId: string, body: Record<string, unknown>) {
  const d = await db.dispute.findUnique({ where: { id: String(body.disputeId ?? "") } });
  const c = d ? await db.contract.findUnique({ where: { id: d.contractId }, include: { test: true } }) : null;
  if (!d || !c || c.testId !== testId || c.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  if (d.status !== "open") throw new HttpError(409, "decided", "This dispute was already decided.");
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  const ok = checkDevSide(text, !!d.devSideAt);
  if (!ok.ok) throw new HttpError(ok.message.startsWith("You already") ? 409 : 400, "dev_side", ok.message);
  await devGateIfSeen(testId, body);
  await db.dispute.update({ where: { id: d.id }, data: { devSide: text, devSideAt: new Date() } });
  return { ok: true };
}

/** (NEXT-UI 27) A developer's tests with sent work or held calls still to be paid or rejected (the Payments page's "Waiting for your review"). */
export async function waitingForReview(devId: string) {
  const held = { review: null, status: "booked", startsAt: { lte: new Date() } };
  return db.test.findMany({
    // (Owner, Oct 28) Not a deleted tester's work: it can no longer be paid.
    where: { developerId: devId, contracts: { some: { tester: PAYABLE_TESTER, OR: [{ submissions: { some: { review: null } } }, { calls: { some: held } }] } } },
    orderBy: { createdAt: "desc" },
    include: { contracts: { where: { tester: PAYABLE_TESTER }, include: { tester: true, submissions: { where: { review: null } }, calls: { where: held } } } },
  });
}

type PieceKey = { submissionId?: string | null; callId?: string | null };
const COUNTED = ["charged", "not_set_up", "deferred", "pending", "owed", "needs_action", "needs_confirmation"];
/** (Batch 12 section 2) What one tester's UNLISTED calls on this contract were paid in all (Pay, Pay more and dispute raises). */
export async function unlistedCallsPaid(contractId: string, tx: Prisma.TransactionClient = db) {
  const ids = (await tx.call.findMany({ where: { contractId, rateCents: null }, select: { id: true } })).map((c) => c.id);
  if (!ids.length) return 0;
  return (await tx.payment.aggregate({ where: { callId: { in: ids }, kind: { not: "chargeback" }, status: { in: COUNTED } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}
/**
 * What can still be paid on ONE piece, with ONE Pay box (owner, Oct 29: batch 11 section 6 merged Extra pay into Pay; batch 12 section 2 the call caps).
 *   - Listed: the listing plus up to 100% of it above (never more than the max: $1000, or $200/h × the logged minutes for a call).
 *   - Unlisted written answers or recording: the max ($1000) plus 100% of it ($2000 in all).
 *   - Unlisted call: at most $200/h × its logged minutes, nothing above; and all of the tester's unlisted calls on the test together at most $1000.
 * `roomCents`: the most the next payment (the first Pay or a "Pay more") can be. `aboveRoomCents`: what is still left above the base (the listing, or the max), for the
 * blocked line. `callPoolRoomCents`: for an unlisted call, what is left of the tester's $1000 for unlisted calls (else null).
 */
export async function pieceRoom(piece: { where: PieceKey; listing: number | null; kind: "submission" | "call"; minutes: number; contractId?: string }, tx: Prisma.TransactionClient = db) {
  const key = piece.where.submissionId ? { submissionId: piece.where.submissionId } : { callId: piece.where.callId! };
  const maxCents = pieceMaxCents(piece.kind, piece.minutes);
  const unlistedCall = piece.listing == null && piece.kind === "call";
  const cap = unlistedCall ? 0 : extraCapCents(piece.listing, maxCents);
  const base = piece.listing ?? maxCents;
  const rev = await tx.review.findFirst({ where: { ...key, rejected: false }, select: { amountCents: true } });
  const extras = (await tx.payment.aggregate({ where: { ...key, kind: "extra", status: { in: COUNTED } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const paidCents = (rev?.amountCents ?? 0) + extras;
  const totalCapCents = base + cap;
  const aboveRoomCents = Math.max(0, cap - Math.max(0, paidCents - base));
  let roomCents = Math.max(0, totalCapCents - paidCents);
  let callPoolRoomCents: number | null = null;
  if (unlistedCall) {
    const contractId = piece.contractId ?? (await tx.call.findUnique({ where: { id: key.callId! }, select: { contractId: true } }))?.contractId ?? "";
    callPoolRoomCents = Math.max(0, NO_LISTING_CALLS_TOTAL_CENTS - (await unlistedCallsPaid(contractId, tx)));
    roomCents = Math.min(roomCents, callPoolRoomCents);
  }
  return { listed: piece.listing != null, maxCents, capCents: cap, paidCents, totalCapCents, roomCents, aboveRoomCents, callPoolRoomCents, aboveBaseCents: aboveRoomCents };
}
/** The blocked line for a payment over a piece's room (batch 9's wording; batch 12: unlisted calls name what is left of the tester's $1000). */
export function overRoomLine(piece: { listing: number | null; kind: "submission" | "call" }, room: Awaited<ReturnType<typeof pieceRoom>>) {
  if (piece.listing != null) return overListingLine(room.aboveRoomCents);
  if (piece.kind === "call") return overCallsLine(room.roomCents);
  return overMaxLine(room.aboveRoomCents);
}

/** The piece behind an Extra pay or a page's "up to $Y": a sent part or a held call. */
export async function pieceOf(where: PieceKey, tx: Prisma.TransactionClient = db) {
  if (where.submissionId) {
    const sub = await tx.submission.findUnique({ where: { id: where.submissionId } });
    return sub ? { where: { submissionId: sub.id }, listing: sub.agreedCents, kind: "submission" as const, minutes: 0, contractId: sub.contractId, label: sub.kind === "recording" ? "recording" : "written answers" } : null;
  }
  const call = await tx.call.findUnique({ where: { id: where.callId ?? "" } });
  return call ? { where: { callId: call.id }, listing: callReference(call.rateCents, call.actualMinutes ?? call.minutes).cents, kind: "call" as const, minutes: call.actualMinutes ?? call.minutes, contractId: call.contractId, label: "live call", startsAt: call.startsAt, status: call.status } : null;
}

/**
 * (Owner, Oct 27) Extra pay, next to each SENT part in the tester's list of the Testers panel: pays that tester above the listing for that part: the same 80/20 split and
 * charge path. Hidden and refused when the developer is suspended (the route); "Pay what you owe first." while a failed payment is owed or on a hold; refused when a
 * block exists either way; capped (see overListingRoom). A bell to the tester ("<dev> paid you $X extra for <test>"); a payment line that doesn't stack. Shows on the
 * developer's Payments history and the tester's payouts.
 */
export async function payExtra(dev: U & Parameters<typeof cardRefusal>[0], testId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: String(body.contractId ?? "") }, include: { test: true, tester: true } });
  if (!c || c.testId !== testId || c.test.developerId !== dev.id) throw new HttpError(404, "not_found", "Choose a tester.");
  // (Batch 9) Extra pay goes on a sent part or a held call.
  const piece = await pieceOf(body.callId ? { callId: String(body.callId) } : { submissionId: String(body.submissionId ?? "") });
  if (!piece || piece.contractId !== c.id) throw new HttpError(404, "not_found", "Choose a part they sent.");
  if (piece.kind === "call" && ("status" in piece && (piece.status === "cancelled" || (piece.startsAt && piece.startsAt > new Date())))) throw new HttpError(409, "not_held", "Extra pay goes on a call that took place.");
  // (Batch 11 section 6) "Pay more" is the same Pay box after a piece is paid: it needs that first payment (a rejected piece has none).
  const paidReview = await db.review.findFirst({ where: piece.where });
  if (!paidReview || paidReview.rejected) throw new HttpError(409, "not_paid", "Pay this part first: Pay more is for a part you've already paid.");
  // (Owner, Oct 27) Unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { suspendedAt: true } });
  if (devNow.suspendedAt) throw new HttpError(403, "suspended", "Your account is suspended: extra pay waits until it is lifted.");
  await (await import("./holds")).devHoldRefusal(dev.id, "pay");
  if ((await blockedEitherWay(dev.id, c.testerId)) || !testerPayable(c.tester)) throw new HttpError(409, "unavailable", "This payment isn't available.");
  const amount = toCents(body.amount);
  const check = checkExtraPay(amount, typeof body.tickedCents === "number" ? body.tickedCents : null, body.over200 === true || body.understood === true);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  // (Batch 9 section 6) Per piece: listed, 100% of the listing at most (never more than the max); unlisted, 100% of the max on top of the Pay.
  const room = await pieceRoom(piece);
  if (amount! > room.roomCents) throw new HttpError(400, "over_cap", overRoomLine(piece, room));
  const card = cardRefusal(dev);
  if (card) throw new HttpError(409, "no_card", card);
  await db.$transaction((tx) => devGate(tx, testId, body));
  const payKey = typeof body.payKey === "string" && /^[\w-]{8,80}$/.test(body.payKey) ? body.payKey : randomUUID();
  const name = displayName(c.tester);
  const label = piece.label;
  const at = piece.kind === "call" ? { callId: piece.where.callId! } : { submissionId: piece.where.submissionId! };
  // (Batch 15 section 13) The same press again (its answer was lost): never twice.
  const again = await db.payment.findFirst({ where: { kind: "extra", ...at, payKey: { in: [`extra-${payKey}`] } } });
  if (again && again.status !== "failed" && again.status !== "cancelled") return { paid: true, amountCents: again.amountCents, status: again.status, repeated: true };
  // (Batch 15 section 9) An interrupted Pay more on this piece in the last 24 hours lends its key.
  const stripeKey = await pressKeyFor(at, ["extra"], `extra-${payKey}`);
  // (Batch 11) The row exists before the charge (pending), so a payment the bank wants confirmed counts toward the piece's cap while it waits.
  const row = await db.payment.create({ data: { kind: "extra", contractId: c.id, ...at, note, developerId: dev.id, testerId: c.testerId, amountCents: amount!, feeCents: 0, testerCents: 0, status: "pending", payKey: stripeKey } });
  let result;
  try {
    const charging = (key: string) => charge(dev, c.tester, amount!, key, `Playtest: extra pay for ${name} on “${c.test.title}”`, "press");
    try {
      result = await charging(stripeKey);
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "idempotency")) throw e;
      await db.payment.update({ where: { id: row.id }, data: { payKey: `extra-${payKey}` } });
      result = await charging(`extra-${payKey}`);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      await db.payment.update({ where: { id: row.id }, data: { status: "cancelled", failure: (e as Error).message } });
      throw e;
    }
    // (Owner, Oct 27) A declined extra pay starts the payment hold at once, like any declined payment.
    await db.payment.update({ where: { id: row.id }, data: { failure: (e as Error).message } });
    await (await import("./holds")).declinedPayment(dev.id, row.id, amount!, `extra pay for ${name}`);
    throw new HttpError(402, "card_failed", `Your card was declined, so ${name} wasn't paid ${money(amount)} extra yet. Your tests are paused until you pay what you owe: open Payments.`, { held: true, failed: `Your extra pay on ${c.test.title} was declined` });
  }
  if (result.status === "requires_action") return (await import("./confirm")).pressAction(row.id, result as NeedsAction & Record<string, unknown>);
  return finishExtraPay(row.id, result);
}

/** (Batch 11) A Pay more went through (at once, or once the bank confirmed it). */
export async function finishExtraPay(paymentId: string, result: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const dev = c.test.developer, name = displayName(c.tester), amount = p.amountCents;
  const label = p.callId ? "live call" : (await db.submission.findUnique({ where: { id: p.submissionId! } }))?.kind === "recording" ? "recording" : "written answers";
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: p.id }, data: { status: result.status, stripePaymentIntentId: result.stripePaymentIntentId, ...(result.feeCents != null ? { feeCents: result.feeCents, testerCents: result.testerCents, transferStatus: result.transferStatus } : {}), actionPi: null, actionBy: null } });
    await recordEvent(tx, c.testId, "paid", `You paid ${name} ${money(amount)} extra for the ${label}`, false, {}, c.id);
  });
  const line = `${displayName(dev)} paid you ${money(amount)} more for your ${label} on “${c.test.title}”${p.note ? `: “${p.note}”` : ""}`;
  await notify(c.tester.email, line, [line + `. You get ${money(testerShare(amount))}.`, ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : [])], `/app/sessions/${c.id}#${p.callId ? "part-live" : `part-${label === "recording" ? "recording" : "written"}`}`, { payment: true, group: "textra", about: dev.id });
  await receipt(dev.email, `an extra payment to ${name}`, amount, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
  return { paid: true, amountCents: amount, status: result.status };
}
