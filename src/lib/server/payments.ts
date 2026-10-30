import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, money, toCents } from "@/lib/format";
import { LET_GO_BY_TESTER, payClosedLine, chargedByTester, byTesterChoice, callReference, checkDevSide, canDispute, checkDisputeDecision, disputeLimitText, testerPayable, PAYABLE_TESTER, deletedNoPayoutsLine, delayedPayLine, declinedHoldLine, checkPay, checkExtraPay, pieceCapCents, overMaxLine, paidMostLine, pieceMaxCents, NO_LISTING_CALL_RATE_CAP_CENTS, overCallsLine, PAY_WAITS, testerShare } from "@/lib/rules";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { adminUsers, bell, notify } from "./notify";
import { blockedEitherWay } from "./blocks";
import { labelled, reportedOver3 } from "./reports";
import { partAnchor } from "@/lib/links";
import { isAdmin } from "./session";
import { PAYMENTS_PROBLEM, cardRefusal, charge, type NeedsAction } from "./stripe";
import { devGate, devGateIfSeen, devOwes, recordEvent } from "./tests";
import { logEvent } from "./live";
import { testerGate } from "./testerGate";
import { PAYMENT_CHECKING, freshPayKey, pressKeyFor } from "./recovery";
import { clientPressKey, serverKey } from "./pressKeys";
import { amountFromRate, callMinutesOf, overCeilingLine, rateFromAmount } from "@/lib/callMeasure";
import { callsLeftCents } from "./callMoney";
import { payPressOf } from "./live";
import { closedOut, payMoreClosesAt, pieceCloseOut } from "./closeOut";
import { TEAM_CLOSED_NO_DISPUTE, TEAM_CLOSED_NO_PAY, updateWaiting } from "@/lib/moneyLines";

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
    // (Batch 15 section 40) Paid for its measured (or lowered) length, once that's final.
    const minutes = callMinutesOf(c);
    if (minutes == null) throw new HttpError(409, "measuring", (await import("./calls")).MEASURING_REFUSAL);
    return { contract: c.contract, review: c.review, listing: callReference(c.rateCents, minutes).cents, label: "live call", where: { callId: c.id }, kind: "call" as const, minutes };
  }
  return null;
}

/**
 * Pay or Reject one piece. Checks (in order): the piece is on the developer's test and not paid/rejected yet (final
 * refusal: "You already paid $8.00 for this."), the tester's account can be paid (final), the developers' one stop-once
 * gate (test-wide, since the page loaded), then the amount rules and the "charged now" tick (Pay) or a reason (Reject).
 * Pay reserves the piece, charges once (idempotent by payKey) and records the payment; Reject charges nothing.
 */
export async function review(dev: U & Parameters<typeof cardRefusal>[0] & { holdStartedAt?: Date | null; devSuspendedAt?: Date | null }, body: Record<string, unknown>) {
  // (Owner, Oct 30, batch 15 section 30) No Reject anywhere: the developer pays any amount from $0 up (a reason is required at $0). Old rejections stay as they are.
  if (body.action === "reject") throw new HttpError(409, "no_reject", NO_REJECT);
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  // (Batch 15 section 41, C1) The page's press id is a UUID, wrapped as "press:<developer>:<uuid>": it can never be a server key ("choice:", "dispute:" ...).
  const payKey = clientPressKey(dev.id, body.payKey);
  if (!payKey) throw new HttpError(400, "bad_request", "This page is out of date. Refresh to see the latest.");
  const done = await db.review.findUnique({ where: { payKey } });
  if (done) return { reviewId: done.id, amountCents: done.amountCents, rejected: done.rejected, repeated: true }; // the same press again: never twice
  let amountCents = toCents(body.amount);
  const tickedCents = typeof body.tickedCents === "number" ? body.tickedCents : null;
  // (Batch 9) The optional note on every Pay (required below the listing): the same field as the reason.
  // (Batch 15 section 20) The note (required below the listing and at $0): at most 1,000 characters, refused at the box, never cut.
  const reason = readText(typeof body.reason === "string" ? body.reason : body.note, LIMITS.reason, "bad_reason");
  const over200 = body.over200 === true || body.understood === true;
  // (Batch 9) A call's Pay: the rate typed ($/h), when one was. (Batch 15 section 40) Rate and Amount fill each other; the one typed last wins and the other is recomputed here.
  let rateCents = body.rate === undefined || body.rate === null || body.rate === "" ? null : toCents(body.rate);

  // (Owner, Oct 27) Pay is unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, devSuspendedAt: true } });
  if (devNow.devSuspendedAt || devNow.holdStartedAt) throw new HttpError(403, devNow.devSuspendedAt ? "suspended" : "held", devNow.devSuspendedAt ? "Your account is suspended: Pay waits until it is lifted." : PAY_WAITS);

  const reserved = await reserving(() => db.$transaction(async (tx) => {
    const piece = await loadPiece(tx, kind, id);
    if (!piece || piece.contract.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That work doesn't exist or isn't on your test.");
    const c = piece.contract;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const name = displayName(c.tester);
    // (Owner, Oct 29, batch 11) A tester who deleted their account: their sent work is still reviewed when their payout account was connected; without one (DEFAULT)
    // nothing can reach them, so it can't be paid (final).
    if (!testerPayable(c.tester) && !(await tx.review.findFirst({ where: piece.where }))) throw new HttpError(409, "gone", deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null })));
    const already = await tx.review.findFirst({ where: piece.where });
    // (Batch 16 section 21) Another tab's Pay on this piece stops this press once, BEFORE it is refused as already done.
    const payPress = payPressOf(c.id, piece.where);
    if (already) {
      await devGate(tx, c.testId, body, {}, [], undefined, payPress);
      if (chargedByTester(already.reason)) throw new HttpError(409, "reviewed", `${name} already charged ${money(already.amountCents)} for this.`);
      if (already.reason === LET_GO_BY_TESTER) throw new HttpError(409, "reviewed", `${name} let this go: nothing was charged.`);
      if (already.teamClosedById) throw new HttpError(409, "reviewed", TEAM_CLOSED_NO_PAY); // (batch 30 §5)
      const owedNow = !already.rejected && (await tx.payment.findFirst({ where: { ...piece.where, status: "failed", owedUntil: { not: null }, settledAt: null } }));
      if (owedNow) throw new HttpError(409, "owed", `This ${money(already.amountCents)} is owed: pay it with “Pay what you owe” in Payments.`);
      throw new HttpError(409, "reviewed", already.rejected ? "You already rejected this." : `You already paid ${money(already.amountCents)} for this.`);
    }
    // (Batch 17 §19) Pay closes on the piece's own closing date (the test's close-out, or 14 days after its Charge opened if later; final: it stays unpaid).
    // Until then Pay works, also after the tester's Charge opened.
    {
      const at = await pieceCloseOut(piece.where, "developer");
      if (closedOut(at)) throw new HttpError(409, "pay_closed", payClosedLine(fmtDate(at!)));
    }
    if (await devOwes(dev.id)) throw new HttpError(409, "owed_first", PAY_WAITS);
    // Form mistakes (red at the field) come BEFORE the stop-once: a second press would only fail on them.
    {
      if (piece.kind === "call" && body.typed === "rate" && rateCents != null && rateCents >= 0) amountCents = amountFromRate(rateCents, piece.minutes);
      else if (piece.kind === "call" && amountCents != null && rateCents != null) rateCents = rateFromAmount(amountCents, piece.minutes);
      const check = checkPay(amountCents, piece.listing, reason, tickedCents, over200);
      if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
      if (piece.kind === "call" && rateCents != null) {
        if (rateCents < 0) throw new HttpError(400, "bad_rate", "Enter a rate like 30.00.");
        if (piece.listing == null && rateCents > NO_LISTING_CALL_RATE_CAP_CENTS) throw new HttpError(400, "over_cap", "A call that isn't listed can be paid at most $200 an hour.");
      }
      // (Batch 9 section 6; batch 11 section 6: one Pay box, an amount above the base counts as extra pay; batch 12 section 2: the unlisted call caps) Caps per piece.
      const room = await pieceRoom({ ...piece, contractId: c.id }, tx);
      if (amountCents! > room.roomCents) {
        await devGate(tx, c.testId, body, {}, [], undefined, payPress);
        throw new HttpError(400, "over_cap", overRoomLine(piece, room));
      }
      const card = amountCents! > 0 ? cardRefusal(dev) : "";
      if (card) throw new HttpError(409, "no_card", card);
    }
    // (Batch 16 section 21) Another tab's Pay on this piece (or a lowered call length) stops it once; other actions there don't.
    await devGate(tx, c.testId, body, { paidSoFarCents: await paidSoFar(c.id, tx), name }, [], undefined, payPress);
    const rev = await tx.review.create({ data: { ...piece.where, contractId: c.id, amountCents: amountCents!, agreedCents: piece.listing, reason, payKey, rejected: false, rateCents: piece.kind === "call" ? rateCents : null } });
    // (Batch 15 section 9) The charge's key: an interrupted press on this piece in the last 24 hours lends its key, so nothing is ever charged twice.
    // (Batch 19 section 5) An earlier attempt with this press key whose bank check was cancelled (or that failed) keeps its row: this attempt gets a key of its own.
    const stripeKey = await freshPayKey(tx, ["review", "call"], await pressKeyFor(piece.where, ["review", "call"], payKey, tx));
    // (Batch 19 section 5) The cancelled (or failed) attempt hands its press key over too ((kind, pressKey) is unique): its row stays as the record of that attempt.
    await tx.payment.updateMany({ where: { kind: { in: ["review", "call"] }, pressKey: payKey, status: { in: ["cancelled", "failed"] } }, data: { pressKey: null } });
    const payment = await tx.payment.create({
          data: { kind: kind === "call" ? "call" : "review", submissionId: piece.where.submissionId ?? null, callId: piece.where.callId ?? null, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amountCents!, feeCents: 0, testerCents: 0, status: "pending", payKey: stripeKey, pressKey: payKey },
        });
    return { rev, payment, c, piece, name };
  }));

  const { rev, payment, c, piece, name } = reserved;
  let result;
  try {
    // (Owner, Oct 29, batch 11) The developer's own press: on-session, so the bank may ask them to confirm in the page.
    const charging = (key: string) => charge(dev, c.tester, rev.amountCents, key, `Playtest: ${piece.label} on “${c.title}”`, "press");
    try {
      result = await charging(payment!.payKey ?? payKey);
    } catch (e) {
      // (Batch 15 section 9) A reused key that Stripe already saw with other details: that earlier press reached Stripe and wasn't charged, so a fresh key is safe.
      if (!(e instanceof HttpError && e.code === "idempotency")) throw e;
      const fresh = await freshPayKey(db, ["review", "call"], payKey); // (batch 19 section 5) never a cancelled attempt's key
      await db.payment.update({ where: { id: payment!.id }, data: { payKey: fresh } });
      result = await charging(fresh);
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

/** (Batch 30 §20) Prisma's "transaction timed out / already closed" (P2028). */
export const isTxTimeout = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028";
/**
 * (Batch 30 §20) A Pay / Pay more reservation that timed out under load: Prisma rolled it back (no review, no payment row) and nothing reached Stripe, so the
 * press gets the plain line instead of a 500.
 */
export async function reserving<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isTxTimeout(e)) throw new HttpError(503, "payments_problem", PAYMENTS_PROBLEM);
    throw e;
  }
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
    // (Batch 15 section 20) The note never rides in the bell line; it's in the email and on the session page.
    rev.amountCents === 0 ? `${displayName(dev)} paid $0 for your ${piece.label} on “${c.title}”` : `${displayName(dev)} paid you ${money(rev.amountCents)} for your ${piece.label} on “${c.title}”`,
    [
      rev.amountCents === 0 ? `${displayName(dev)} paid $0 for this.` : `${displayName(dev)} paid ${money(rev.amountCents)}${rev.rateCents != null ? ` (${money(rev.rateCents)}/h)` : ""} for your ${piece.label}: you get ${money(testerShare(rev.amountCents))}.`,
      ...(rev.reason ? [`Their note: “${rev.reason}”`] : []),
      ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : []),
    ],
    `/app/sessions/${c.id}#${partAnchor(piece.label)}`,
    { payment: true, group: "tpaid" },
  );
  if (rev.amountCents > 0) await receipt(dev.email, `${name}'s ${piece.label}`, rev.amountCents, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
  // (Batch 22 section 2) A suspended tester is paid like anyone (no held share).
  return { reviewId: rev.id, amountCents: rev.amountCents, status: result.status, rejected: false, paidSoFarCents: await paidSoFar(c.id) };
}

/** Tester: dispute once, on any part the developer reviewed (batch 10: listed or not, any amount, $0 included, or a Reject). */
export async function openDispute(tester: U, contractId: string, body: Record<string, unknown>) {
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const reason = readText(body.reason, LIMITS.disputeText, "bad_reason");
  if (reason.length < 10) throw new HttpError(400, "bad_reason", "Say why you think the pay should be higher (at least a sentence).");
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  // (Owner, Oct 29, batch 32 §7) An open new-terms offer blocks Dispute until the tester answers it (Switch or Keep).
  await (await import("./terms")).answerTermsFirst(contractId);
  const where = kind === "call" ? { callId: id } : { submissionId: id };
  // (Owner, Oct 28 afternoon) Disputes work while the test is paused (and while the developer owes a declined payment): a decision for the tester during a hold is added to what is owed.
  const review = await db.review.findFirst({ where: { ...where, contractId } });
  // (Batch 30 §5, owner Oct 29) The team's $0 closure is final: no dispute.
  if (review?.teamClosedById) throw new HttpError(409, "no_dispute", TEAM_CLOSED_NO_DISPUTE);
  if (review && !(await db.dispute.findFirst({ where }))) await testerGate(tester.id, contractId, c.testId, body);
  if (!review) throw new HttpError(409, "not_paid", "This hasn't been paid yet.");
  const existing = await db.dispute.findFirst({ where });
  // (Batch 20 section 15) Nothing a decision could add (the admin form's max, from disputeBounds): refused with the page's line (an older page).
  const bounds = existing || byTesterChoice(review.reason) ? null : await disputeBounds({ submissionId: kind === "call" ? null : id, callId: kind === "call" ? id : null });
  const roomCents = bounds ? bounds.max - bounds.min : 0;
  const ok = canDispute(review.amountCents, review.agreedCents, !!existing, byTesterChoice(review.reason), bounds ? bounds.max - bounds.min : null);
  if (!ok.ok) throw new HttpError(409, "no_dispute", ok.message);
  const d = await db.dispute.create({ data: { ...where, contractId, testerId: tester.id, reason } });
  // (Batch 15 section 35) The live line opens its Needs you row, like the bell line.
  await logEvent(c.testId, "dispute", `${displayName(tester)} disputed the pay for their ${kind === "call" ? "live call" : (await db.submission.findUnique({ where: { id } }))?.kind === "recording" ? "recording" : "written answers"}`, contractId, `item-dispute-${d.id}`);
  await notify(c.test.developer.email, `${displayName(tester)} disputed a payment on “${c.title}”`, [`${displayName(tester)} thinks the pay should be higher: “${reason}”`, `Our team decides. A decision can only raise the pay, ${disputeLimitText(roomCents)}.`], `/app/tests/${c.testId}#item-dispute-${d.id}`, { group: "disputefiled" });
  // (Owner, Oct 26) Admins are told too. (Batch 29 §29) Disputes have their own daily entry across tests ("Disputes · 3 new"); each line opens its own row (marked).
  const flagged = await reportedOver3([tester.id, c.test.developerId]);
  for (const a of await adminUsers()) await bell(a.id, `Dispute on “${c.title}”: ${labelled(displayName(tester), flagged.has(tester.id))} says the pay should be higher (${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))})`, `/admin#dispute-${d.id}`, undefined, { group: "admindisputes" });
  return d;
}

/** (Batch 20 section 15) What a team decision could still add to each reviewed piece (the decision form's max minus what the piece was paid). */
export async function disputeRoom(pieces: { submissionId?: string | null; callId?: string | null }[]) {
  const out = new Map<string, number>();
  for (const p of pieces) {
    const id = p.submissionId ?? p.callId;
    if (!id) continue;
    const b = await disputeBounds({ submissionId: p.submissionId ?? null, callId: p.callId ?? null }).catch(() => null);
    if (b) out.set(id, b.max - b.min);
  }
  return out;
}

/**
 * What an admin may decide for a dispute. (Owner, Oct 29, batch 28 §15) The total for THIS piece: MIN = what the piece was already paid (its Pay and every Pay more);
 * MAX = its cap, the same one Pay + Pay more have (pieceRoom, batch 29 §38: the part's max in all, listed or not; a call also within what's left of the $1,000 for
 * that tester's calls). A decision still only raises pay.
 */
export async function disputeBounds(d: { submissionId: string | null; callId: string | null }) {
  const key = d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! };
  const review = await db.review.findFirstOrThrow({ where: key });
  const piece = await pieceOf(key);
  if (!piece) return { review, min: review.amountCents, max: review.amountCents, poolBinds: false };
  const room = await pieceRoom(piece);
  const min = Math.max(review.amountCents, room.paidCents);
  return { review, min, max: min + room.roomCents, poolBinds: room.ceilingBinds };
}

/** (Batch 28 §14) What each paid piece has been paid and can reach in all with Pay more (the tester's line on a paid part). */
export async function paidAndCap(pieces: { submissionId?: string | null; callId?: string | null }[]) {
  const out = new Map<string, { paidCents: number; allCents: number }>();
  for (const k of pieces) {
    const piece = await pieceOf(k);
    if (!piece) continue;
    const r = await pieceRoom(piece);
    out.set(k.submissionId ?? k.callId ?? "", { paidCents: r.paidCents, allCents: r.paidCents + r.roomCents });
  }
  return out;
}

/** Admin: decide a dispute. The total can only go up (to at most the piece's cap, batch 28 §15); blank keeps the pay; the extra is charged. */
export async function decideDispute(admin: U, disputeId: string, body: Record<string, unknown>) {
  if (!isAdmin(admin)) throw new HttpError(403, "not_admin", "Only admins can decide disputes.");
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  // (Batch 15 section 21) The two-admin refusal names the other admin by email: "ben@… already decided this dispute at 3:10 PM."
  if (d.status !== "open") throw new HttpError(409, "decided", await decidedByLine(d.decidedById, d.decidedAt));
  // (Owner, Oct 30, batch 15 section 27) The developer added their side after this admin's page loaded: Decide stops once so they can read it.
  const seen = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  if (seen && !isNaN(seen.getTime()) && body.confirmed !== true && d.devSideAt && d.devSideAt > seen) {
    const dev = (await db.contract.findUnique({ where: { id: d.contractId }, include: { test: { include: { developer: true } } } }))?.test.developer;
    throw new HttpError(409, "stop_once", "Press Decide again to go ahead.", { changes: [{ text: `${dev ? displayName(dev) : "The developer"} added their side at ${fmtTime(d.devSideAt)}: read it, then press Decide again.`, at: d.devSideAt }], devSide: d.devSide });
  }
  const { review, min, max, poolBinds } = await disputeBounds(d);
  // A blank box keeps the pay as it is.
  const blank = body.total === undefined || body.total === null || String(body.total).trim() === "";
  const decided = blank ? min : toCents(body.total);
  const check = checkDisputeDecision(decided, min, max, poolBinds);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const extra = check.extraCents!;
  const c = await db.contract.findUniqueOrThrow({ where: { id: d.contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const note = readText(body.note, LIMITS.reason, "bad_note"); // (batch 15 section 20) the admin's decision note: 1,000
  // Claim the dispute first so two admins can't charge twice.
  const claimed = await db.dispute.updateMany({ where: { id: d.id, status: "open" }, data: { status: "decided", decidedCents: decided!, decisionNote: note, decidedById: admin.id, decidedAt: new Date() } });
  if (claimed.count !== 1) {
    // Any admin, first decision wins: the second press says who and when.
    const won = await db.dispute.findUnique({ where: { id: d.id } });
    throw new HttpError(409, "decided", await decidedByLine(won?.decidedById ?? null, won?.decidedAt ?? null));
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
      result = await charge(c.test.developer, c.tester, extra, serverKey("dispute", d.id), `Playtest: dispute decision on “${c.title}”`);
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
  const line = extra > 0 ? `The team raised the pay to ${money(decided!)} (${money(extra)} more).` : `The team kept the pay at ${money(min)}${review.rejected ? " (rejected)" : ""}.`;
  await logEvent(c.testId, "admin", `The team decided ${displayName(c.tester)}'s dispute: ${line.replace(/^The team /, "").replace(/\.$/, "")}`, c.id);
  await (await import("./ratings")).maybePromptRating(c.id);
  await notify(c.tester.email, `Your dispute on “${c.title}” was decided`, [line, ...(delayed ? ["Payment may be delayed until the test resumes."] : []), ...(note ? [`Their note: “${note}”`] : [])], `/app/sessions/${c.id}#${d.callId ? "part-live" : partAnchor((await db.submission.findUnique({ where: { id: d.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers")}`, { group: "disputedecided" });
  await notify(c.test.developer.email, `A dispute on “${c.title}” was decided`, [line, ...(note ? [`The team's note: “${note}”`] : [])], `/app/tests/${c.testId}#tester-${c.id}`, { group: "disputedecided" });
  return { extraCents: extra };
}

/** "ben@playtest.test already decided this dispute at 3:10 PM." ("An admin (deleted)" once that account is gone). */
async function decidedByLine(byId: string | null, at: Date | null) {
  const by = byId ? await db.user.findUnique({ where: { id: byId }, select: { email: true, deletedAt: true } }) : null;
  const who = by && !by.deletedAt ? by.email : byId ? "An admin (deleted)" : "Another admin";
  return `${who} already decided this dispute${at ? ` at ${fmtTime(at)}` : ""}.`;
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
  // (Owner, Oct 30, batch 15 section 27) Optional, never stopped (no stop-once), up to 2,000 characters (refused beyond, never cut).
  const text = readText(body.text, LIMITS.devSide, "dev_side");
  const ok = checkDevSide(text, !!d.devSideAt);
  if (!ok.ok) throw new HttpError(ok.message.startsWith("You already") ? 409 : 400, "dev_side", ok.message);
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
/** (Batch 28 §15) What counts as paid on a piece above its Pay: every Pay more, and a team decision's raise (a dispute can now reach the cap). */
const ABOVE_PAY = ["extra", "dispute"];
/** (Owner, Oct 30, batch 15 section 30) The refusal for an old page's Reject (or an API call). */
export const NO_REJECT = "There's no Reject: pay any amount, $0 included (say why at $0).";
/**
 * What can still be paid on ONE piece, with ONE Pay box (owner, Oct 29: batch 11 section 6 merged Extra pay into Pay; batch 12 section 2 the call caps).
 *   - (Batch 29 §38, correcting batch 28 §20) Every piece, listed or not: the part's max IN ALL (Pay + every Pay more + any dispute raise): $1,000 for written answers
 *     or a recording; $200/h × the measured minutes for a call. A listed price at the max leaves no Pay more room.
 *   - (Batch 15 section 34) Any call, listed or not: all of the tester's calls on the test together at most $1,000 (extra pay counted).
 * `roomCents`: the most the next payment (the first Pay or a "Pay more") can be. `aboveRoomCents`: for a listed piece, what is still left above the listing (for the
 * blocked line). `callPoolRoomCents`: for a call, what is left of the $1,000 for the tester's calls (else null); `ceilingBinds`: that's what limits this payment.
 */
export async function pieceRoom(piece: { where: PieceKey; listing: number | null; kind: "submission" | "call"; minutes: number; contractId?: string }, tx: Prisma.TransactionClient = db) {
  const key = piece.where.submissionId ? { submissionId: piece.where.submissionId } : { callId: piece.where.callId! };
  const maxCents = pieceMaxCents(piece.kind, piece.minutes);
  const totalCapCents = pieceCapCents(piece.listing, maxCents);
  const rev = await tx.review.findFirst({ where: { ...key, rejected: false }, select: { amountCents: true } });
  const extras = (await tx.payment.aggregate({ where: { ...key, kind: { in: ABOVE_PAY }, status: { in: COUNTED } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const paidCents = (rev?.amountCents ?? 0) + extras;
  const base = piece.listing ?? 0;
  const cap = Math.max(0, totalCapCents - base);
  const aboveRoomCents = Math.max(0, totalCapCents - Math.max(paidCents, base));
  let roomCents = Math.max(0, totalCapCents - paidCents);
  let callPoolRoomCents: number | null = null;
  let ceilingBinds = false;
  if (piece.kind === "call") {
    const contractId = piece.contractId ?? (await tx.call.findUnique({ where: { id: key.callId! }, select: { contractId: true } }))?.contractId ?? "";
    callPoolRoomCents = await callsLeftCents(contractId, tx, key.callId!);
    ceilingBinds = callPoolRoomCents < roomCents;
    roomCents = Math.min(roomCents, callPoolRoomCents);
  }
  return { listed: piece.listing != null, maxCents, capCents: cap, paidCents, totalCapCents, roomCents, aboveRoomCents, callPoolRoomCents, ceilingBinds, aboveBaseCents: aboveRoomCents };
}
/** The blocked line for a payment over a piece's room (batch 9's wording; batch 15 section 34: a call over what's left of the $1,000 says so). */
export function overRoomLine(piece: { listing: number | null; kind: "submission" | "call" }, room: Awaited<ReturnType<typeof pieceRoom>>) {
  if (room.ceilingBinds) return overCeilingLine(room.roomCents);
  if (piece.listing == null && piece.kind === "call") return overCallsLine(room.roomCents);
  // (Batch 29 §38) Listed or not: the piece's max in all (at it: batch 28 §14's line).
  return room.roomCents <= 0 ? paidMostLine(room.paidCents) : overMaxLine(room.roomCents, room.totalCapCents);
}

/** The piece behind an Extra pay or a page's "up to $Y": a sent part or a held call. */
export async function pieceOf(where: PieceKey, tx: Prisma.TransactionClient = db) {
  if (where.submissionId) {
    const sub = await tx.submission.findUnique({ where: { id: where.submissionId } });
    return sub ? { where: { submissionId: sub.id }, listing: sub.agreedCents, kind: "submission" as const, minutes: 0, contractId: sub.contractId, label: sub.kind === "recording" ? "recording" : "written answers" } : null;
  }
  const call = await tx.call.findUnique({ where: { id: where.callId ?? "" } });
  const minutes = call ? callMinutesOf(call) ?? call.minutes : 0;
  return call ? { where: { callId: call.id }, listing: callReference(call.rateCents, minutes).cents, kind: "call" as const, minutes, contractId: call.contractId, label: "live call", startsAt: call.startsAt, status: call.status } : null;
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
  // (Batch 30 §5) A piece the team closed at $0 is final.
  if (paidReview.teamClosedById) throw new HttpError(409, "team_closed", TEAM_CLOSED_NO_PAY);
  // (Batch 17 §19, replacing batch 16 section 22) Pay more closes together with the last Pay / Charge on the test (payMoreClosesAt).
  {
    const at = await payMoreClosesAt(testId);
    if (closedOut(at)) throw new HttpError(409, "pay_more_closed", payClosedLine(fmtDate(at!), true));
  }
  // (Owner, Oct 27) Unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { devSuspendedAt: true } });
  if (devNow.devSuspendedAt) throw new HttpError(403, "suspended", "Your account is suspended: extra pay waits until it is lifted.");
  await (await import("./holds")).devHoldRefusal(dev.id, "pay");
  if ((await blockedEitherWay(dev.id, c.testerId)) || !testerPayable(c.tester)) throw new HttpError(409, "unavailable", "This payment isn't available.");
  const amount = toCents(body.amount);
  const note = readText(body.note, LIMITS.reason, "bad_note");
  // (Batch 30 §2) $0 answers an updated version the tester sent after it was paid: it closes that Needs you row (an optional note), charging nothing.
  if (amount === 0 && piece.kind === "submission") return closeUpdateAtZero(dev, c, piece.where.submissionId!, note, body);
  const check = checkExtraPay(amount, typeof body.tickedCents === "number" ? body.tickedCents : null, body.over200 === true || body.understood === true);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const card = cardRefusal(dev);
  if (card) throw new HttpError(409, "no_card", card);
  // (Batch 15 section 41, C1) The page's press id (a UUID) wrapped for this developer; "extra:" makes it the Pay more's own.
  const extraKey = serverKey("extra", clientPressKey(dev.id, body.payKey) ?? `press:${dev.id}:${randomUUID()}`);
  const name = displayName(c.tester);
  const at = piece.kind === "call" ? { callId: piece.where.callId! } : { submissionId: piece.where.submissionId! };
  // (Batch 15 section 41, M2) The repeat check, the room check and the reservation happen together under the test's row lock (as Pay does), and (kind, payKey) and
  // (kind, pressKey) are unique, so two presses at once can never both pass the cap or charge twice.
  const reserved = await reserving(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    // (Batch 15 section 13) The same press again (its answer was lost): never twice. A press that failed without a charge can be pressed again.
    const again = await tx.payment.findFirst({ where: { kind: "extra", pressKey: extraKey } });
    if (again && again.status !== "failed" && again.status !== "cancelled") return { again };
    if (again) await tx.payment.update({ where: { id: again.id }, data: { pressKey: null } });
    // (Batch 9 section 6; batch 29 §38) Per piece: the part's max in all, listed or not.
    const room = await pieceRoom(piece, tx);
    const morePress = payPressOf(c.id, at);
    if (amount! > room.roomCents) {
      await devGate(tx, testId, body, {}, [], undefined, morePress); // (batch 16 section 21) another tab's Pay on it first stops once
      throw new HttpError(400, "over_cap", overRoomLine(piece, room));
    }
    await devGate(tx, testId, body, {}, [], undefined, morePress);
    // (Batch 15 section 9) An interrupted Pay more on this piece in the last 24 hours lends its key.
    // (Batch 19 section 5) A cancelled or failed earlier attempt with this press key keeps its row: this attempt gets a key of its own.
    const stripeKey = await freshPayKey(tx, ["extra"], await pressKeyFor(at, ["extra"], extraKey, tx));
    // (Batch 11) The row exists before the charge (pending), so a payment the bank wants confirmed counts toward the piece's cap while it waits.
    const row = await tx.payment.create({ data: { kind: "extra", contractId: c.id, ...at, note, developerId: dev.id, testerId: c.testerId, amountCents: amount!, feeCents: 0, testerCents: 0, status: "pending", payKey: stripeKey, pressKey: extraKey } });
    return { row, stripeKey };
  }));
  if ("again" in reserved && reserved.again) return { paid: true, amountCents: reserved.again.amountCents, status: reserved.again.status, repeated: true };
  const { row, stripeKey } = reserved as { row: NonNullable<(typeof reserved)["row"]>; stripeKey: string };
  let result;
  try {
    const charging = (key: string) => charge(dev, c.tester, amount!, key, `Playtest: extra pay for ${name} on “${c.test.title}”`, "press");
    try {
      result = await charging(stripeKey);
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "idempotency")) throw e;
      const fresh = await freshPayKey(db, ["extra"], extraKey); // (batch 19 section 5) never a cancelled attempt's key
      await db.payment.update({ where: { id: row.id }, data: { payKey: fresh } });
      result = await charging(fresh);
    }
  } catch (e) {
    if (e instanceof HttpError && e.code === "payment_unknown") throw new HttpError(502, "payment_unknown", PAYMENT_CHECKING);
    if (!(e instanceof HttpError && e.code === "card_failed")) {
      await db.payment.update({ where: { id: row.id }, data: { status: "cancelled", failure: (e as Error).message } });
      throw e;
    }
    // (Owner, Oct 27) A declined extra pay starts the payment hold at once, like any declined payment.
    await db.payment.update({ where: { id: row.id }, data: { failure: (e as Error).message } });
    if (row.submissionId) await answerUpdate(db, row.submissionId, row.createdAt); // (batch 30 §2) it was pressed: the update's row goes (the amount is owed)
    await (await import("./holds")).declinedPayment(dev.id, row.id, amount!, `extra pay for ${name}`);
    throw new HttpError(402, "card_failed", `Your card was declined, so ${name} wasn't paid ${money(amount)} extra yet. Your tests are paused until you pay what you owe: open Payments.`, { held: true, failed: `Your extra pay on ${c.test.title} was declined` });
  }
  if (result.status === "requires_action") return (await import("./confirm")).pressAction(row.id, result as NeedsAction & Record<string, unknown>);
  return finishExtraPay(row.id, result);
}

/** (Batch 30 §2) A Pay more pressed at `at` answers the piece's latest update sent before that press. */
async function answerUpdate(tx: Prisma.TransactionClient, submissionId: string, at: Date) {
  await tx.submission.updateMany({ where: { id: submissionId, paidUpdateAt: { not: null, lte: at }, OR: [{ paidUpdateDoneAt: null }, { paidUpdateDoneAt: { lt: at } }] }, data: { paidUpdateDoneAt: at } });
}

/**
 * (Batch 30 §2) Pay more at $0 on an updated version the tester sent after the piece was paid: closes its Needs you row with an optional note the tester reads.
 * Nothing is charged. Only while that update waits (else "Enter an amount like 7.50.", as before). The developers' stop-once applies like any Pay more.
 */
async function closeUpdateAtZero(dev: U, c: { id: string; testId: string; testerId: string; tester: Parameters<typeof displayName>[0] & { email: string }; test: { title: string } }, submissionId: string, note: string, body: Record<string, unknown>) {
  const label = (await db.submission.findUnique({ where: { id: submissionId } }))?.kind === "recording" ? "recording" : "written answers";
  const name = displayName(c.tester);
  const done = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const s = await tx.submission.findUnique({ where: { id: submissionId }, include: { review: true } });
    if (!s || !updateWaiting(s)) {
      await devGate(tx, c.testId, body, {}, [], undefined, payPressOf(c.id, { submissionId }));
      throw new HttpError(400, "bad_amount", "Enter an amount like 7.50.");
    }
    await devGate(tx, c.testId, body, {}, [], undefined, payPressOf(c.id, { submissionId }));
    const now = new Date();
    await tx.submission.update({ where: { id: s.id }, data: { paidUpdateDoneAt: now, paidUpdateZeroAt: now, paidUpdateNote: note } });
    await recordEvent(tx, c.testId, "paid", `You paid ${name} $0 more for the updated ${label}`, false, {}, c.id);
    return true;
  });
  if (done) {
    const line = `${displayName(dev)} paid $0 more for your updated ${label} on “${c.test.title}”`;
    await notify(c.tester.email, line, [line + ".", ...(note ? [`Their note: “${note}”`] : [])], `/app/sessions/${c.id}#part-${label === "recording" ? "recording" : "written"}`, { payment: true, group: "tpaid", about: dev.id });
  }
  return { paid: true, amountCents: 0, status: "closed" };
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
    // (Batch 30 §2) A Pay more (any amount) answers an update the tester sent after it was paid: its Needs you row goes.
    if (p.submissionId) await answerUpdate(tx, p.submissionId, p.createdAt);
  });
  const line = `${displayName(dev)} paid you ${money(amount)} more for your ${label} on “${c.test.title}”`;
  await notify(c.tester.email, line, [line + `. You get ${money(testerShare(amount))}.`, ...(p.note ? [`Their note: “${p.note}”`] : []), ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : [])], `/app/sessions/${c.id}#${p.callId ? "part-live" : `part-${label === "recording" ? "recording" : "written"}`}`, { payment: true, group: "tpaid", about: dev.id }); // (batch 29 §25) in the day's "You were paid" entry, no longer "Extra pay"
  await receipt(dev.email, `an extra payment to ${name}`, amount, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
  return { paid: true, amountCents: amount, status: result.status };
}
