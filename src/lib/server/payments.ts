import { Moved, beforeLock } from "./pressRace";
import { disputeOwnText } from "./actionText";
import { logAction } from "./live";
import { recordReviewDraft } from "./reviewDraft";
import { randomUUID } from "node:crypto";
import * as RF from "@/lib/refusal";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, money, pronouns, toCents } from "@/lib/server/dateFormat";
import { testPaused, UNLISTED_CALL_CLOSED, unlistedCallClosedLine, LET_GO_BY_TESTER, payClosedLine, chargedByTester, byTesterChoice, callReference, checkDevSide, canDispute, ALREADY_DISPUTED, DEV_SIDE_ALREADY, checkDisputeDecision, decisionWhat, decideDoneLine, disputeLimitText, testerPayable, PAYABLE_TESTER, delayedPayLine, declinedHoldLine, checkPay, checkExtraPay, pieceCapCents, overMaxLine, paidMostLine, pieceMaxCents, NO_LISTING_CALL_RATE_CAP_CENTS, overCallsLine, PAY_WAITS, testerShare, decideTickLine, pieceName, disputeDecisionName, decidePayChangedLine, disputeRangeLine } from "@/lib/rules";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { adminUsers, bell, notify } from "./notify";
import { blockedEitherWay } from "./blocks";
import { labelled, reportedOver3 } from "./reports";
import { partAnchor, pieceAnchor } from "@/lib/links";
import { isAdmin } from "./session";
import { isUniqueClash } from "./passwords";
import { ownChange, presserOf, youAlready, type Presser } from "./adminRace";
import { PAYMENTS_PROBLEM, cardRefusal, charge, type NeedsAction } from "./stripe";
import { describedOnce, stripeDescription } from "./paymentRows";
import { devGate, devOwes, recordEvent } from "./tests";
import { logEvent } from "./live";
import { callAt, partOnTest, partWords } from "./partWords";
import { T } from "@/lib/tz";
import { devSideLine, testerGate } from "./testerGate";
import { PAYMENT_CHECKING, freshPayKey, pressKeyFor } from "./recovery";
import { clientPressKey, serverKey } from "./pressKeys";
import { amountFromRate, callMinutesOf, overCeilingLine, rateFromAmount } from "@/lib/callMeasure";
import { callsLeftCents } from "./callMoney";
import { ownOtherTabAction, pageOf, payPressOf, seenOf, tabOf } from "./live";
import { closedOut, disputeClosedFor, pieceCloseOut } from "./closeOut";
import { TEAM_CLOSED_NO_DISPUTE, TEAM_CLOSED_NO_PAY, paidLine, updateWaiting } from "@/lib/moneyLines";
import { PAID_GROUP } from "@/lib/bell";
import { devPartRow } from "@/lib/lineAnchors";

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
    return { contract: s.contract, review: s.review, listing: s.agreedCents, label: s.kind === "written" ? "written answers" : "recording", reference: s.kind === "written" ? "written answers" : "recording", where: { submissionId: s.id }, kind: "submission" as const, minutes: 0 };
  }
  if (kind === "call") {
    const c = await tx.call.findUnique({ where: { id }, include: { review: true, contract: { include: { test: true, tester: true } } } });
    if (!c) return null;
    if (c.status === "cancelled") throw new HttpError(409, "cancelled", "This call was cancelled, so there's nothing to pay.");
    if (c.startsAt > new Date()) throw new HttpError(409, "not_yet", "You can pay for this call once it has started.");
    // (Batch 15 section 40) Paid for its measured (or lowered) length, once that's final.
    const minutes = callMinutesOf(c);
    if (minutes == null) throw new HttpError(409, "measuring", (await import("./calls")).MEASURING_REFUSAL);
    return { contract: c.contract, review: c.review, listing: callReference(c.rateCents, minutes).cents, label: "live call", reference: `live call on ${fmtDateTime(c.startsAt)}`, where: { callId: c.id }, kind: "call" as const, minutes };
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
  if (!payKey) throw new HttpError(400, "bad_request", "This page is out of date.");
  if (id && (kind === "submission" || kind === "call")) await (await import("./confirm")).expireActions(new Date(), kind === "call" ? { callId: id } : { submissionId: id });
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

  // (Owner, Oct 27) Pay is unavailable during a payment or chargeback hold (the route refuses first; this is the backstop). (Owner, Nov 9, §368) A suspension or the
  // team's pause no longer stops it: it charges at once, as the tester's Charge does (a suspension that is also held keeps its own line).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, devSuspendedAt: true } });
  if (devNow.holdStartedAt) throw new HttpError(403, devNow.devSuspendedAt ? "suspended" : "held", devNow.devSuspendedAt ? suspendedLine("Pay") : RF.pressRefused(RF.HELD_CAUSE, "Pay")); // (§364 items 7, 8)

  const reserved = await reserving(() => db.$transaction(async (tx) => {
    const piece = await loadPiece(tx, kind, id);
    if (!piece || piece.contract.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That work doesn't exist or isn't on your test.");
    const c = piece.contract;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const name = displayName(c.tester);
    // (Owner, Oct 29, batch 11) A tester who deleted their account: their sent work is still reviewed when their payout account was connected; without one (DEFAULT)
    // nothing can reach them, so it can't be paid (final).
    // (Owner, Nov 9, §364 item 9) The refusal is the tester-gone line; "Can't be paid" stays on the tester's row and the payment status.
    if (!testerPayable(c.tester) && !(await tx.review.findFirst({ where: piece.where }))) throw new HttpError(409, "gone", RF.pressRefused(RF.sessionEndedCause(displayName(c.tester)), "Pay"));
    const already = await tx.review.findFirst({ where: piece.where });
    const payPress = { ...payPressOf(c.id, piece.where), fromNeeds: body.from === "needs" }; // (§362) Needs you's Pay
    // (Owner, Nov 4, batch 35 §163; replaces batch 16 section 21's "another tab's Pay on this piece stops this press once, BEFORE it is refused as already done")
    // A part already settled is refused on the FIRST press, never after a stop: its second press could only be refused.
    if (already) {
      // (Owner, Nov 3, §159) The tester's Charge on this part waits for the bank (a page that hadn't redrawn yet): refused with what to do, never a stop-once.
      const waits = await bankWaitsLine(tx, piece.where, name);
      if (waits) throw new HttpError(409, "bank_waits", waits);
      // (§163) Settled by this developer's own Pay, Reject or Confirm with your bank in ANOTHER tab: named with that tab and its time. "You already paid $10.00 for
      // Ana Silva's written answers in another tab at 3:20 PM.", "You already rejected …", "You already confirmed Ana Silva's $10.00 charge for her written answers
      // with your bank in another tab at 3:20 PM."
      const mine = await ownOtherTabAction(dev.id, piece.kind === "call" ? `call:${id}` : `sub:${id}`, tabOf(body), ["pay"], tx, pageOf(body));
      if (mine) {
        const at = fmtTime(mine.at);
        if (mine.text.startsWith("rejected ")) throw new HttpError(409, "reviewed", `You already rejected ${name}'s ${piece.reference} in another tab at ${at}.`);
        if (mine.text.startsWith("confirmed ")) throw new HttpError(409, "reviewed", `You already ${mine.text} in another tab at ${at}.`);
        throw new HttpError(409, "reviewed", `You already paid ${money(already.amountCents)} for ${name}'s ${piece.reference} in another tab at ${at}.`);
      }
      // (Owner, Nov 3, batch 35 §163) The tester's Charge, the tester's Let it go and the team's close-out are refused on the FIRST press, before the gate: a stop
      // there (the developer's Alerts letting the Charge line through) could only be followed by this refusal (as §159 item 12: never a stop whose second press
      // could only be refused).
      if (chargedByTester(already.reason)) throw new HttpError(409, "reviewed", `${name} already charged ${money(already.amountCents)} for ${pronouns(c.tester.pronoun).poss} ${piece.reference}.`);
      if (already.reason === LET_GO_BY_TESTER) throw new HttpError(409, "reviewed", `${name} let ${pronouns(c.tester.pronoun).poss} ${piece.reference} go: nothing was charged.`);
      if (already.teamClosedById) throw new HttpError(409, "reviewed", TEAM_CLOSED_NO_PAY); // (batch 30 §5)
      if (already.reason === UNLISTED_CALL_CLOSED) throw new HttpError(409, "reviewed", unlistedCallClosedLine(`${name}'s call`)); // (Owner, Nov 6, §311e) final
      const owedNow = !already.rejected && (await tx.payment.findFirst({ where: { ...piece.where, status: "failed", owedUntil: { not: null }, settledAt: null } }));
      if (owedNow) throw new HttpError(409, "owed", `This ${money(already.amountCents)} is owed: pay it with “Pay what you owe” in Payments.`);
      throw new HttpError(409, "reviewed", already.rejected ? `You already rejected ${name}'s ${piece.reference}.` : `You already paid ${money(already.amountCents)} for ${name}'s ${piece.reference}.`);
    }
    if (await tx.payment.count({ where: { ...piece.where, kind: { in: ["review", "call"] }, status: { in: ["pending", "needs_action"] } } })) throw new HttpError(409, "locked", "A payment for this part is being confirmed. Wait for it to finish before paying again.");
    // (Batch 17 §19) Pay closes on the piece's own closing date (the test's close-out, or 14 days after its Charge opened if later; final: it stays unpaid).
    // Until then Pay works, also after the tester's Charge opened. (Owner, Nov 11, §378) The same date as the tester's Charge (their suspension time included).
    {
      const at = await pieceCloseOut(piece.where);
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
      // (§163) Over what's left: refused on the first press (never after a stop whose second press could only be refused).
      if (amountCents! > room.roomCents) {
        throw new HttpError(400, "over_cap", overRoomLine(piece, room));
      }
      const card = amountCents! > 0 ? cardRefusal(dev) : "";
      if (card) throw new HttpError(409, "no_card", card);
    }
    // (Batch 16 section 21) Another tab's Pay on this piece (or a lowered call length) stops it once; other actions there don't.
    await devGate(tx, c.testId, body, { paidSoFarCents: await paidSoFar(c.id, tx), name }, [], undefined, payPress);
    const rev = { amountCents: amountCents!, agreedCents: piece.listing, reason, payKey, rateCents: piece.kind === "call" ? rateCents : null };
    // (Batch 15 section 9) The charge's key: an interrupted press on this piece in the last 24 hours lends its key, so nothing is ever charged twice.
    // (Batch 19 section 5) An earlier attempt with this press key whose bank check was cancelled (or that failed) keeps its row: this attempt gets a key of its own.
    const stripeKey = await freshPayKey(tx, ["review", "call"], await pressKeyFor(piece.where, ["review", "call"], payKey, tx));
    // (Batch 19 section 5) The cancelled (or failed) attempt hands its press key over too ((kind, pressKey) is unique): its row stays as the record of that attempt.
    await tx.payment.updateMany({ where: { kind: { in: ["review", "call"] }, pressKey: payKey, status: { in: ["cancelled", "failed"] } }, data: { pressKey: null } });
    const payment = await tx.payment.create({
          data: { kind: kind === "call" ? "call" : "review", submissionId: piece.where.submissionId ?? null, callId: piece.where.callId ?? null, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amountCents!, feeCents: 0, testerCents: 0, status: "pending", payKey: stripeKey, pressKey: payKey, reviewDraft: rev },
        });
    return { rev, payment, c, piece, name };
  }));

  const { rev, payment, c, piece, name } = reserved;
  let result;
  try {
    // (Owner, Oct 29, batch 11) The developer's own press: on-session, so the bank may ask them to confirm in the page.
    // (Owner, Nov 3) Its Stripe description reads as its "What you've paid" line, names in full: "Playtest: Ana Silva's written answers on “Harbor Run”".
    const description = await describedOnce(payment!.id, () => stripeDescription({ payment: payment! }));
    const charging = (key: string) => charge(dev, c.tester, rev.amountCents, key, description, "press");
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
      await db.payment.update({ where: { id: payment!.id }, data: { status: "failed", failure: (e as Error).message } });
      throw e;
    }
    // (Owner, Oct 27) Declined at the press: the payment is owed and the payment hold starts AT ONCE. The owed review is recorded; there's no second Pay on it.
    await db.$transaction(async (tx) => {
      await recordReviewDraft(payment!, tx);
      await tx.payment.update({ where: { id: payment!.id }, data: { failure: (e as Error).message } });
    });
    // (Owner, Nov 4, §177) A call is named with its day, as every payment line names a call ("Ana Silva's live call on “Harbor Run” (Oct 27)").
    const callStart = payment!.callId ? (await db.call.findUnique({ where: { id: payment!.callId }, select: { startsAt: true } }))?.startsAt ?? null : null;
    await (await import("./holds")).declinedPayment(dev.id, payment!.id, rev.amountCents, pieceName({ tester: name, part: piece.label, test: c.test.title, when: callStart ? T(callStart) : null, full: true })); // (§178) its date and time
    // The tester is told at once (bell; their top box and stop-once read the owed payment): never "failed". (§177) The bell names the test and which call:
    // "Nora Lane's payment for your live call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST) ($15) is delayed."
    await bell(c.testerId, delayedPayLine(displayName(dev), piece.label, rev.amountCents, `“${c.test.title}”${callStart ? ` (${T(callStart)})` : ""}`), `/app/sessions/${c.id}#${pieceAnchor(piece.label, payment!.callId)}`, undefined, { payment: true, group: "tdelayed" });
    throw new HttpError(402, "card_failed", declinedHoldLine(name, rev.amountCents, piece.label), { held: true, failed: `Your Pay on ${c.test.title} was declined` });
  }
  // (Batch 11) The bank wants the developer to confirm: the piece stays locked while its pop-up is open (batch 12 section 5), nothing is charged yet.
  if (result.status === "requires_action") return (await import("./confirm")).pressAction(payment!.id, result as NeedsAction & Record<string, unknown>);
  return finishReviewPay(payment!.id, result);
}

/**
 * (Owner, Nov 3, §159) Pay more waits while a payment on that part waits for the bank: a charge made while away (the tester's Charge, an automatic call charge, the
 * team's decision) waiting for "Confirm with your bank" → "Confirm Ana Silva's $10.00 charge with your bank first."; the developer's own Pay or earlier Pay more whose
 * bank check is open → "Your $10.00 payment for this part is waiting for your bank: finish or cancel it first.". Null when nothing waits.
 */
export async function bankWaitsLine(tx: Prisma.TransactionClient | typeof db, at: { submissionId?: string | null; callId?: string | null }, testerName: string) {
  return (await bankWaitsOf(tx, at, testerName))?.line ?? null;
}
/**
 * (§159) The same line with the waiting payment it is about (`id`). (Owner bug, Nov 4, §174) The test page passes the id with the line, so a Pay more box never
 * greys itself for its OWN bank check: a redraw drawn while that check is open (or just after it ended) reads the box's own row as waiting.
 */
export async function bankWaitsOf(tx: Prisma.TransactionClient | typeof db, at: { submissionId?: string | null; callId?: string | null }, testerName: string) {
  const where = at.callId ? { callId: at.callId } : at.submissionId ? { submissionId: at.submissionId } : null;
  if (!where) return null;
  const w = await tx.payment.findFirst({ where: { ...where, OR: [{ kind: { in: ["review", "call", "extra", "dispute"] }, status: { in: ["needs_confirmation", "needs_action"] } }, { kind: { in: ["review", "call", "dispute"] }, status: "pending" }], settledAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, amountCents: true } });
  if (!w) return null;
  // A charge on this part still on its way to the bank (a Charge pressed this very moment): it can't be paid more until it lands either way.
  // (Owner, Nov 4, §188 B) `kind` tells the Pay more box what it offers next to the line: the developer's own press ("own", needs_action) has Cancel this check;
  // a charge made while away or a team decision's ("away", needs_confirmation) has Confirm with your bank (it can't be cancelled); "pending" nothing.
  if (w.status === "pending") return { id: w.id, kind: "pending" as const, cents: w.amountCents, line: "A payment for this part is being confirmed. Wait for it to finish before paying again." };
  return w.status === "needs_confirmation"
    ? { id: w.id, kind: "away" as const, cents: w.amountCents, line: `Confirm ${testerName}'s ${money(w.amountCents)} charge with your bank first.` }
    : { id: w.id, kind: "own" as const, cents: w.amountCents, line: `Your ${money(w.amountCents)} payment for this part is waiting for your bank: finish or cancel it first.` };
}

/** (Owner, Nov 3, §159) "Your account is suspended: Pay waits until it is lifted." (Pay more: "extra pay"; Confirm with your bank, Confirm all: their names). */
export const suspendedLine = (what: string) => RF.pressRefused(RF.ACCOUNT_SUSPENDED_CAUSE, RF.pressOfWhat(what)); // (Owner, Nov 9, §364 item 8)
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

/** (Owner, Nov 4, §178) A call payment's call, for a line that names it: its date and time as a time token (written in the reader's zone); null for a sent part. */
const callWhen = async (p: { callId?: string | null; submissionId?: string | null }) => {
  const call = p.callId && !p.submissionId ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
  return call ? T(call.startsAt) : null;
};

/** (Batch 11) A Pay went through (at once, or once the bank confirmed it): the payment is recorded, the tester told, the receipt sent. */
export async function finishReviewPay(paymentId: string, result: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const dev = c.test.developer;
  const name = displayName(c.tester);
  const piece = { label: p.callId ? "live call" : (await db.submission.findUnique({ where: { id: p.submissionId! } }))?.kind === "recording" ? "recording" : "written answers" };
  const part = await partWords(p, callAt(dev));
  const data = { status: result.status, stripePaymentIntentId: result.stripePaymentIntentId, ...(result.feeCents != null ? { feeCents: result.feeCents, testerCents: result.testerCents, transferStatus: result.transferStatus } : {}), actionPi: null, actionBy: null };
  const rev = await db.$transaction(async (tx) => {
    const review = await recordReviewDraft(p, tx);
    await tx.payment.update({ where: { id: p.id }, data });
    // (Owner, Nov 4, §177) A call is named with its date and time: "You paid Nina Park $15.00 for the live call on Tue, Oct 27, 8:00 AM".
    await recordEvent(tx, c.testId, "paid", `You paid ${name} ${money(review.amountCents)} for the ${part}`, false, {}, c.id);
    return review;
  });
  // (Batch 9) The note rides in the bell line too; $0 reads "<dev> paid $0 for this".
  await notify(
    c.tester.email,
    // (Batch 11 section 6) "<dev> paid you $X" for the first payment ("<dev> paid you $X more" for a Pay more).
    // (Batch 15 section 20) The note never rides in the bell line; it's on the session page. (Owner, Nov 6, §299) The longer text is emailed only to an
    // address with no account: an account's email lists the bell line.
    // (Owner, Nov 4, §177) Which call: "… for your live call on “Harbor Run” (Tue, Oct 27, 8:00 AM EST)".
    rev.amountCents === 0 ? `${displayName(dev)} paid $0 for ${await partOnTest(p, "your", c.test.title)}` : `${displayName(dev)} paid you ${money(rev.amountCents)} for ${await partOnTest(p, "your", c.test.title)}`,
    [
      rev.amountCents === 0 ? `${displayName(dev)} paid $0 for this.` : `${displayName(dev)} paid ${money(rev.amountCents)}${rev.rateCents != null ? ` (${money(rev.rateCents)}/h)` : ""} for your ${piece.label}: you get ${money(testerShare(rev.amountCents))}.`,
      ...(rev.reason ? [`${pronouns(dev.pronoun).Poss} note: “${rev.reason}”`] : []),
      ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : []),
    ],
    `/app/sessions/${c.id}#${pieceAnchor(piece.label, p.callId)}`,
    { payment: true, group: "tpaid" },
  );
  // (§131) The receipt names the tester, the part and the test (pieceName).
  // (Owner, Nov 4, §178) A call with its date and time ("Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 8:00 AM CST)").
  if (rev.amountCents > 0) await receipt(dev.email, pieceName({ tester: name, part: piece.label, test: c.test.title, full: true, when: await callWhen(p) }), rev.amountCents, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
  // (Batch 22 section 2) A suspended tester is paid like anyone (no held share).
  return { reviewId: rev.id, amountCents: rev.amountCents, status: result.status, rejected: false, paidSoFarCents: await paidSoFar(c.id) };
}

/** (§369) What the developer paid on a part (its review and payments), for a press's first look. */
async function paidOnPiece(q: Prisma.TransactionClient | typeof db, where: { submissionId: string } | { callId: string }) {
  const [r, pays] = [await q.review.findFirst({ where, select: { id: true, amountCents: true } }), await q.payment.findMany({ where, orderBy: { id: "asc" }, select: { id: true, status: true } })];
  return JSON.stringify({ r, pays });
}

/**
 * Tester: dispute once, on any part the developer reviewed (batch 10: listed or not, any amount, $0 included, or a Reject). (Owner, Nov 6, §288) Until the tester
 * rates the test or the part's closing date passes: RATED_NO_DISPUTE / disputeClosedLine after that.
 */
export async function openDispute(tester: U, contractId: string, body: Record<string, unknown>): Promise<Awaited<ReturnType<typeof openDisputeOnce>>> {
  try {
    return await openDisputeOnce(tester, contractId, body);
  } catch (e) {
    if (!(e instanceof Moved)) throw e;
    // (Owner, Nov 10, §369) A payment on the part came between the checks and the lock: nothing was written. The press ends as a later one would: nothing left
    // to dispute is its own refusal (checked again first); otherwise the §362 stop-once naming the payment.
    if (body.__moved !== true) return openDispute(tester, contractId, { ...body, __moved: true });
    throw new HttpError(409, "no_dispute", "A payment on this part came just now: nothing was disputed. Press Dispute again.");
  }
}

async function openDisputeOnce(tester: U, contractId: string, body: Record<string, unknown>) {
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const reason = readText(body.reason, LIMITS.disputeText, "bad_reason");
  if (reason.length < 10) throw new HttpError(400, "bad_reason", "Say why you think the pay should be higher (at least a sentence).");
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  const where = kind === "call" ? { callId: id } : { submissionId: id };
  // (Owner, Nov 11, §375) Dispute's refusals, in the owner's order, before any box: checked first, again when the gate would stop it, and again under the lock
  // (an NDA change or new terms saved while the press waited). Dispute works while the test is paused and after the tester's part ended (the NDA block and
  // new terms then block nothing), so neither refuses it.
  const refusals = async (q: Prisma.TransactionClient | typeof db) => {
    // (Owner, Nov 6, §288) The tester rated the test, or the part's closing date passed: closed, decided before anything else (never after a terms block or a
    // stop-once that could only end in this refusal, §159). A part already disputed keeps its own line ("You already disputed this payment").
    const shut = await disputeClosedFor(contractId, where);
    if (shut && !(await db.dispute.findFirst({ where }))) throw new HttpError(409, "no_dispute", shut);
    // (Owner, Oct 29, batch 32 §7) An open new-terms offer blocks Dispute until the tester answers it (Switch or Keep); (§267 / §302) an NDA change first.
    await (await import("./terms")).answerTermsFirst(contractId, q);
    // (Owner, Oct 28 afternoon) Disputes work while the test is paused (and while the developer owes a declined payment): a decision for the tester during a hold is added to what is owed.
    const review = await q.review.findFirst({ where: { ...where, contractId } });
    // (Batch 30 §5, owner Oct 29) The team's $0 closure is final: no dispute.
    if (review?.teamClosedById) throw new HttpError(409, "no_dispute", TEAM_CLOSED_NO_DISPUTE);
    if (!review) throw new HttpError(409, "not_paid", "This hasn't been paid yet.");
    return disputable(review);
  };
  // (Owner, Nov 3, §159) Whether anything is left to dispute is decided FIRST: a refusal is never shown as a stop-once whose second press could only be refused.
  // (Batch 20 section 15) Nothing a decision could add (the admin form's max, from disputeBounds): refused with the page's line (an older page).
  const disputable = async (review: NonNullable<Awaited<ReturnType<typeof db.review.findFirst>>>) => {
    const existing = await db.dispute.findFirst({ where });
    // (Owner, Nov 6, §288) Checked again each time (a Rate in another tab meanwhile closes it too).
    const closed = await disputeClosedFor(contractId, where);
    const bounds = existing || closed || byTesterChoice(review.reason) ? null : await disputeBounds({ submissionId: kind === "call" ? null : id, callId: kind === "call" ? id : null });
    const ok = canDispute(review.amountCents, review.agreedCents, !!existing, byTesterChoice(review.reason), bounds ? bounds.max - bounds.min : null, closed);
    if (!ok.ok) {
      // A payment on this part since the page loaded (a Pay more) left nothing to dispute: ONE refusal naming it, in the blue box.
      const since = seenOf(body.seenAt);
      const recent = since && bounds && !existing ? await db.payment.findFirst({ where: { ...where, kind: { in: ["extra", "review", "call"] }, status: { in: ["charged", "not_set_up", "pending", "needs_action"] }, createdAt: { gt: since } }, orderBy: { createdAt: "desc" } }) : null;
      if (recent && bounds) throw new HttpError(409, "no_dispute", paidMostMeanwhileLine(displayName(c.test.developer), recent.amountCents, recent.kind === "extra", fmtTime(recent.createdAt), bounds.max));
      throw new HttpError(409, "no_dispute", ok.message);
    }
    return { existing, roomCents: bounds ? bounds.max - bounds.min : 0 };
  };
  const first = await refusals(db);
  // (§369) What this press saw: what was paid on the part.
  const sawPaid = await paidOnPiece(db, where);
  // (Batch 35 §68) A payment on this piece since the page loaded stops it once even with Alerts Off.
  // A payment landing between that check and this stop: what's left is checked again, so a stop that couldn't go ahead is the refusal instead.
  // (§375) Every refusal is checked again there, not only what is left to dispute.
  if (!first.existing) await testerGate(tester.id, contractId, c.testId, body, undefined, { piece: id }).catch(async (e) => {
    if (e instanceof HttpError && e.code === "stop_once") await refusals(db);
    throw e;
  });
  // (Owner, Nov 3, §159) Dispute and Pay more on the same part are decided in one place: the dispute is made under the test's row lock (the lock Pay more reserves
  // under), after checking again what's left to dispute.
  let roomCents = first.roomCents;
  const own = await disputeOwnText(where);
  await beforeLock("dispute");
  const d = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    roomCents = (await refusals(tx)).roomCents; // (Owner, Nov 11, §375) every refusal again under the lock first (an NDA change or new terms while it waited)
    // (Owner, Nov 10, §369) A payment on the part since the first look: nothing is written (Moved rolls back; openDispute runs the press again, so it ends with
    // the payment's stop-once, or the refusal when nothing is left). Another tab's Dispute is the final "disputed once" refusal below, whatever the timing.
    if ((await paidOnPiece(tx, where)) !== sawPaid) throw new Moved("paid");
    // (Owner, Nov 3, §157) Two Disputes at the same moment (two tabs): the piece's one dispute is the unique key; the later one reads the usual line, never a 500.
    if (await tx.dispute.findFirst({ where })) throw new HttpError(409, "no_dispute", ALREADY_DISPUTED);
    const made = await tx.dispute.create({ data: { ...where, contractId, testerId: tester.id, reason } });
    await logAction(tester.id, c.testId, body, own, undefined, tx); // (§369) the own-action line commits with the dispute
    return made;
  }).catch((e) => {
    if (isUniqueClash(e)) throw new HttpError(409, "no_dispute", ALREADY_DISPUTED);
    throw e;
  });
  // (Batch 15 section 35) The live line opens its Needs you row, like the bell line.
  // (Owner, Nov 4, §177) Which part: a call with its date and time ("Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM"), in the developer's zone.
  const disputed = kind === "call" ? { callId: id } : { submissionId: id };
  await logEvent(c.testId, "dispute", `${displayName(tester)} disputed the pay for ${pronouns(tester.pronoun).poss} ${await partWords(disputed, callAt(c.test.developer))}`, contractId, `item-dispute-${d.id}`);
  await notify(c.test.developer.email, `${displayName(tester)} disputed the pay for ${await partOnTest(disputed, pronouns(tester.pronoun).poss, c.test.title)}`, [`${displayName(tester)} thinks the pay should be higher: “${reason}”`, `Our team decides. A decision can only raise the pay, ${disputeLimitText(roomCents)}.`], `/app/tests/${c.testId}#item-dispute-${d.id}`, { group: "disputefiled" });
  // (Owner, Oct 26) Admins are told too. (Batch 29 §29) Disputes have their own daily entry across tests ("Disputes · 3 new"); each line opens its own row (marked).
  const flagged = await reportedOver3([tester.id, c.test.developerId]);
  for (const a of await adminUsers()) await bell(a.id, `Dispute on “${c.test.title}”: ${labelled(displayName(tester), flagged.has(tester.id))} says the pay should be higher (${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))})`, `/admin#dispute-${d.id}`, undefined, { group: "admindisputes" });
  return d;
}

/** (Owner, Nov 3, §159) "Nora Lane paid $996.00 more meanwhile (3:20 PM): this part is now paid the most it can be ($500.00), so there's nothing to dispute." */
export const paidMostMeanwhileLine = (dev: string, cents: number, more: boolean, time: string, maxCents: number) =>
  `${dev} paid ${money(cents)}${more ? " more" : ""} meanwhile (${time}): this part is now paid the most it can be (${money(maxCents)}), so there's nothing to dispute.`;

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
 * MAX = its cap, the same one Pay + Pay more have (pieceRoom, batch 29 §38: the part's max in all, listed or not; a call also within what's left of the $500 for
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
/** (Batch 35 §70) Decide on a piece whose payment is waiting for the developer's bank. */
/** (Batch 35 §162) In the developer's recorded pronoun ("with her bank"); DECIDE_LOCKED is the unset one. */
export const decideLockedLine = (pronoun?: string | null) => `The developer is confirming a payment for this piece with ${pronouns(pronoun).poss} bank. Decide again once it's confirmed or fails.`;
export const DECIDE_LOCKED = decideLockedLine();
const devPronounOf = async (contractId: string) => (await db.contract.findUnique({ where: { id: contractId }, select: { test: { select: { developer: { select: { pronoun: true } } } } } }))?.test.developer.pronoun;

/** (Owner, Nov 5, §271) The team's Decide dispute is the one press a pause or hold never stops (no pause moment here, whatever happened since the page loaded). */
export async function decideDispute(admin: U, disputeId: string, body: Record<string, unknown>) {
  if (!isAdmin(admin)) throw new HttpError(403, "not_admin", "Only admins can decide disputes.");
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  // (Batch 15 section 21) The two-admin refusal names the other admin by email: "ben@… already decided this dispute at 3:10 PM."
  if (d.status !== "open") throw new HttpError(409, "decided", await decidedByLine(d.decidedById, d.decidedAt, presserOf(admin.id, body)));
  const seen = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  const seenAt = seen && !isNaN(seen.getTime()) ? seen : null;
  const shownSide = typeof body.devSideSeenAt === "string" ? new Date(body.devSideSeenAt) : null;
  const sideSeenAt = body.devSideSeenAt === undefined ? seenAt : shownSide && !isNaN(shownSide.getTime()) ? shownSide : null;
  const checkSide = body.devSideSeenAt !== undefined || seenAt !== null;
  const c = await db.contract.findUniqueOrThrow({ where: { id: d.contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const stopForNewSide = (current: Pick<typeof d, "devSide" | "devSideAt">) => {
    if (!checkSide || !current.devSideAt || (sideSeenAt && current.devSideAt <= sideSeenAt)) return;
    const at = current.devSideAt.toISOString();
    throw new HttpError(409, "stop_once", "Press again to go ahead.", {
      changes: [{ text: `The developer added ${pronouns(c.test.developer.pronoun).poss} side`, at, kind: "stop" }],
      press: "Decide", devSide: current.devSide, devSideAt: at,
    });
  };
  stopForNewSide(d);
  // (Owner, Oct 31, batch 35 §70) The developer's own payment on this piece waiting for their bank (up to 15 minutes) would be charged on top of the decision: refused until
  // it's confirmed or fails, so the piece is never paid more than decided.
  if (await (await import("./confirm")).pieceLocked({ submissionId: d.submissionId, callId: d.callId })) throw new HttpError(409, "locked", decideLockedLine(await devPronounOf(d.contractId)));
  const { review, min, max, poolBinds } = await disputeBounds(d);
  // A blank box keeps the pay as it is.
  const blank = body.total === undefined || body.total === null || String(body.total).trim() === "";
  const decided = blank ? min : toCents(body.total);
  // (Owner, Nov 3, batch 35 §149) The developer's Pay more since the admin's page loaded: the decision is still the piece's TOTAL. Below what is paid now, Decide stops
  // once naming it (nothing charged, the dispute stays open; the box's range moves up to what's paid); at or above it, it goes through charging only the difference.
  const key = d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! };
  const paidSince = (tx: Prisma.TransactionClient = db) => (seenAt ? tx.payment.aggregate({ where: { ...key, kind: "extra", status: { in: COUNTED }, createdAt: { gt: seenAt } }, _sum: { amountCents: true } }).then((a) => a._sum.amountCents ?? 0) : Promise.resolve(0));
  const payChanged = async (paidNow: number, more: number, testerName: string) => {
    const at = new Date();
    return new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text: decidePayChangedLine(testerName, more, paidNow, decided!), at: at.toISOString(), kind: "stop" }], press: "Decide", minCents: paidNow, maxCents: Math.max(paidNow, max), range: disputeRangeLine(paidNow, Math.max(paidNow, max) - paidNow), seenAt: at.toISOString() });
  };
  const moreBefore = blank || decided == null ? 0 : await paidSince();
  if (!blank && decided != null && Number.isInteger(decided) && decided < min && moreBefore > 0) {
    const t = await db.contract.findUniqueOrThrow({ where: { id: d.contractId }, include: { tester: true } });
    throw await payChanged(min, moreBefore, displayName(t.tester));
  }
  // What the admin's page showed as paid: a decision above it is a raise, even when a Pay more since reached it (goes through, nothing more charged).
  const raise = !blank && decided != null && decided > min - moreBefore;
  const check = checkDisputeDecision(decided, min, max, poolBinds);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const extra = check.extraCents!;
  const decidedPart = await partWords(d, callAt(c.test.developer));
  const note = readText(body.note, LIMITS.reason, "bad_note"); // (batch 15 section 20) the admin's decision note: 1,000
  // (Owner, Oct 30, batch 35 §1) A raise needs the tick naming exactly what it charges; a tick for another amount (the box changed) doesn't count.
  // (§149) A Pay more since the page loaded lowered what the raise charges: the tick the admin gave for what the page showed still counts (it charges less, never more).
  const tickOk = body.tickCents === extra || (moreBefore > 0 && body.tickCents === decided! - (min - moreBefore));
  if (extra > 0 && !tickOk) throw new HttpError(400, "needs_tick", decideTickLine(displayName(c.test.developer), extra, decided!));
  // Claim the dispute first so two admins can't charge twice.
  // (Owner, Nov 3, races) The claim, what the piece is paid now and the decision's line on the test commit together under the test's lock (as Pay more's reservation
  // takes it): a Pay more pressed meanwhile either reserved first (counted here: the decision charges only what is still due, never more than decided minus what's
  // paid) or comes after and stops once naming the decision (its line is already on the test). One still at the bank is §70's refusal, read again here.
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    // The response can arrive after the first read. Check its timestamp in the same write that claims Decide.
    const claimed = await tx.dispute.updateMany({
      where: { id: d.id, status: "open", ...(checkSide ? { OR: [{ devSideAt: null }, ...(sideSeenAt ? [{ devSideAt: { lte: sideSeenAt } }] : [])] } : {}) },
      data: { status: "decided", decidedCents: decided!, decisionNote: note, decidedById: admin.id, decidedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const current = await tx.dispute.findUnique({ where: { id: d.id }, select: { status: true, devSide: true, devSideAt: true } });
      if (current?.status === "open") stopForNewSide(current);
      return null;
    }
    if (await tx.payment.count({ where: { ...key, status: { in: ["pending", "needs_action", "needs_confirmation"] } } })) throw new HttpError(409, "locked", decideLockedLine(c.test.developer.pronoun)); // the claim rolls back
    const piece = await pieceOf(key, tx);
    const paidNow = Math.max(review.amountCents, piece ? (await pieceRoom(piece, tx)).paidCents : review.amountCents);
    // (§149) A Pay more that went through just now took the pay above the decision: the same stop (the claim rolls back).
    if (!blank && decided! < paidNow) throw await payChanged(paidNow, Math.max(await paidSince(tx), paidNow - min), displayName(c.tester));
    const due = raise ? Math.max(0, decided! - paidNow) : 0;
    // (Owner, Nov 3, batch 35 §163) One wording whenever the decision equals what's paid now: "kept the pay at $12.00, which was already paid: nothing more was charged"
    // (it read "raised the pay to $12.00, which was already paid…" after a Pay more, and "kept the pay at $12.00" after the §149 stop).
    const what = { paidNowCents: paidNow, dueCents: due, decidedCents: decided!, rejected: review.rejected };
    const line = `The team ${decisionWhat(what)}.`;
    // (Owner, Nov 4, §177) The decision names the part it decided: "The team decided Nina Park's dispute on her live call on Tue, Oct 27, 8:00 AM: raised the pay to
    // $20.50 ($5.00 more)" (the call in the developer's zone).
    const ev = await tx.testEvent.create({ data: { testId: c.testId, kind: "admin", text: `The team decided ${displayName(c.tester)}'s dispute on ${pronouns(c.tester.pronoun).poss} ${decidedPart}: ${decisionWhat(what)}`, contractId: c.id, link: devPartRow(d) } }); // (Owner, Nov 6, §284) the place the line opens: the part decided
    return { due, line, what, eventId: ev.id };
  });
  if (!claim) {
    // Any admin, first decision wins: the second press says who and when.
    const won = await db.dispute.findUnique({ where: { id: d.id } });
    throw new HttpError(409, "decided", await decidedByLine(won?.decidedById ?? null, won?.decidedAt ?? null, presserOf(admin.id, body)));
  }
  const { due, line } = claim;
  let delayed = false;
  let heldNow = false; // (batch 35 §82) this decision's own decline started a hold: the test is paused now
  const owedRow = { kind: "dispute", disputeId: d.id, submissionId: d.submissionId, callId: d.callId, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, amountCents: due, feeCents: 0, testerCents: 0 };
  const waiting = due > 0 ? await (await import("./holds")).deferIfHeld(owedRow) : null;
  // (Owner, Nov 2, §131) The developer's lines name the decision by its piece: "the team's dispute decision on Ana Silva's written answers on “Harbor Run”".
  const decision = disputeDecisionName((await (await import("./holds")).paymentPiece(owedRow)) ?? `${displayName(c.tester)}'s work on “${c.test.title}”`);
  if (waiting) {
    await bell(c.test.developerId, `${decision.replace(/^the/, "The")} (${money(due)} more) is added to what you owe: it's paid with it, as one payment`, "/app/payments#owed", undefined, { side: "developer", payment: true, group: "payhold" });
    delayed = true;
  } else if (due > 0) {
    // Charged at once, also during an admin suspension with no hold (owner, Oct 28 afternoon): a declined card starts a payment hold and the raise is owed.
    let result;
    try {
      // (Owner, Nov 3) "Playtest: The team's dispute decision on Ana Silva's written answers on “Harbor Run”" (its row is made after the charge: one key, one try).
      result = await charge(c.test.developer, c.tester, due, serverKey("dispute", d.id), await stripeDescription({ payment: owedRow }));
      if (result.status === "requires_action") {
        // (Batch 11) The developer's bank wants them to confirm: it waits 3 days for their Confirm in Payments (the tester reads "Payment may be delayed").
        const row = await db.payment.create({ data: { ...owedRow, status: "needs_confirmation" } });
        await (await import("./confirm")).awayAction(row.id, result as NeedsAction);
        result = undefined;
        delayed = true;
      }
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "card_failed")) {
        await db.dispute.update({ where: { id: d.id }, data: { status: "open", decidedCents: null, decidedAt: null, decidedById: null, decisionNote: "" } }); // (Nov 2, §119) no longer names who
        await db.testEvent.deleteMany({ where: { id: claim.eventId } }); // (Owner, Nov 3, races) nothing was decided after all: its line goes with the claim
        // (§130) The developer's card was unknown to Stripe (cleared): the team reads why, not the developer's "Add a card".
        if (e instanceof HttpError && e.code === "no_card") throw new HttpError(409, "no_card", `The developer's saved card is no longer available, so nothing was charged and the dispute stays open. Decide again once ${pronouns(c.test.developer.pronoun).subj} ${pronouns(c.test.developer.pronoun).v("adds", "add")} a card.`);
        throw e;
      }
      const failed = await db.payment.create({ data: { ...owedRow, status: "failed", failure: e.message, owedUntil: new Date() } });
      await (await import("./holds")).declinedPayment(c.test.developerId, failed.id, due, decision);
      delayed = true;
      heldNow = true;
    }
    if (result) {
      // (Owner, Nov 3) Full names in the receipt email.
      const decisionFull = disputeDecisionName((await (await import("./holds")).paymentPiece(owedRow, undefined, true)) ?? `${displayName(c.tester)}'s work on “${c.test.title}”`);
      await receipt(c.test.developer.email, decisionFull, due, result.status, `/app/tests/${c.testId}#tester-${c.id}`);
      await db.payment.create({ data: { kind: "dispute", disputeId: d.id, submissionId: d.submissionId, callId: d.callId, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, ...result } });
    }
  }
  await (await import("./ratings")).maybePromptRating(c.id);
  // (Owner, Nov 4, §177) Both emails and bells name the part: "Your dispute about your live call on “Harbor Run” (Tue, Oct 27, 8:00 AM EST) was decided".
  await notify(c.tester.email, `Your dispute about ${await partOnTest(d, "your", c.test.title)} was decided`, [line, ...(delayed ? [heldNow || testPaused(c.test.developer, c.test) ? "Payment may be delayed until the test resumes." : "Payment may be delayed."] : []), ...(note ? [`Their note: “${note}”`] : [])], `/app/sessions/${c.id}#${d.callId ? `call-${d.callId}` : partAnchor((await db.submission.findUnique({ where: { id: d.submissionId ?? "" } }))?.kind === "recording" ? "recording" : "written answers")}`, { group: "disputedecided" });
  await notify(c.test.developer.email, `${displayName(c.tester)}'s dispute about ${await partOnTest(d, pronouns(c.tester.pronoun).poss, c.test.title)} was decided`, [line, ...(note ? [`The team's note: “${note}”`] : [])], `/app/tests/${c.testId}#tester-${c.id}`, { group: "disputedecided" });
  await (await import("./live")).logAction(admin.id, c.testId, body, "decided a dispute", { a: "decide", k: [`dispute:${d.id}`], answers: { item: d.id } });
  // (Owner, Nov 3, batch 35 §163) The admin reads what the decision did, not just "Done.": "Done: raised the pay to $10.00 ($3.00 more charged)."
  return { extraCents: due, line: decideDoneLine(decisionWhat(claim.what, !delayed)) };
}

/**
 * "ben@playtest.test already decided this dispute at 3:10 PM." ("An admin (deleted)" once that account is gone). (Owner, Nov 3, §157; like §45) The same admin's
 * own decision: "You already decided this dispute in another tab at 3:10 PM." (no "in another tab" when this page made it).
 */
async function decidedByLine(byId: string | null, at: Date | null, p: Presser | null = null) {
  const own = at ? await ownChange(p, byId, at) : null;
  if (own && at) return youAlready("decided this dispute", own, at);
  const by = byId ? await db.user.findUnique({ where: { id: byId }, select: { email: true, deletedAt: true } }) : null;
  const who = by && !by.deletedAt ? by.email : byId ? "An admin (deleted)" : "Another admin";
  return `${who} already decided this dispute${at ? ` at ${fmtTime(at)}` : ""}.`;
}

/**
 * A payment receipt to the developer for every payment that goes through: bell + email, always sent. (Owner, Nov 5, §201) No "Receipt:" prefix: "You paid $10.00 for
 * Ana Silva's written answers on “Harbor Run”" (the same words whoever pressed: a decision charge, the tester's Charge and an automatic call charge keep their own
 * "(charged by her after 7 days)" / "(… charged automatically after 7 days)" / "the team's dispute decision on …" naming). Every one stacks under ONE "Paid ·
 * N payments" entry a day across tests (`PAID_GROUP`), in the bell and in the end-of-day email.
 */
export async function receipt(devEmail: string, what: string, cents: number, status: string, path: string) {
  const line = paidLine(cents, what);
  await notify(devEmail, line, [line + ".", status === "not_set_up" ? "Payments aren't set up yet, so this was recorded and nothing was charged." : "Charged to your saved card."], path, { side: "developer", payment: true, group: PAID_GROUP });
}

/** The developer adds their side to a dispute once; it shows under that piece of work and the admin sees both. */
export async function addDevSide(dev: U, testId: string, body: Record<string, unknown>) {
  const d = await db.dispute.findUnique({ where: { id: String(body.disputeId ?? "") } });
  const c = d ? await db.contract.findUnique({ where: { id: d.contractId }, include: { test: true } }) : null;
  if (!d || !c || c.testId !== testId || c.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  if (d.status !== "open") throw new HttpError(409, "decided", "This dispute was already decided.");
  // (Owner, Oct 30, batch 15 section 27) Optional, never stopped by changes (§271: only by a pause or lift, below), up to 2,000 characters (refused beyond, never cut).
  const text = readText(body.text, LIMITS.devSide, "dev_side");
  const ok = checkDevSide(text, !!d.devSideAt);
  if (!ok.ok) throw new HttpError(ok.message.startsWith("You already") ? 409 : 400, "dev_side", ok.message);
  // (Owner, Nov 5, §271) The one stop it has: a pause since the page loaded (the team's, their own hold or suspension) or the team's lift of it, once, whatever the Alerts.
  const m = await import("./stopMoment");
  m.pauseStopOnce(await m.devPauseMoments(testId, m.loadedOf(body)), body);
  // (Owner, Nov 3, §157) Claimed: once, while the dispute is open. Two presses at once (two tabs): one side is kept, the other reads "You already added your side.";
  // a decision made meanwhile: "This dispute was already decided."
  const claimed = await db.dispute.updateMany({ where: { id: d.id, devSideAt: null, status: "open" }, data: { devSide: text, devSideAt: new Date() } });
  if (claimed.count !== 1) {
    const now = await db.dispute.findUniqueOrThrow({ where: { id: d.id }, select: { status: true, devSideAt: true } });
    throw new HttpError(409, now.devSideAt ? "dev_side" : "decided", now.devSideAt ? DEV_SIDE_ALREADY : "This dispute was already decided.");
  }
  // (Owner, Nov 6, §286) The tester's top box reads "Nora Lane added her side to your dispute about your written answers": her bell rings with the same words
  // (a call's time in her own zone), linking to that part on her session page, where the developer's side shows.
  const full = await db.dispute.findUniqueOrThrow({ where: { id: d.id }, include: { submission: { select: { kind: true } }, call: { select: { startsAt: true } } } });
  const devUser = await db.user.findUniqueOrThrow({ where: { id: c.test.developerId } });
  const kind = full.submission?.kind === "recording" ? "recording" : "written answers";
  await bell(c.testerId, devSideLine(displayName(devUser), devUser.pronoun, full.call ? T(full.call.startsAt) : null, full.submission?.kind), `/app/sessions/${c.id}#${pieceAnchor(full.callId ? "live call" : kind, full.callId)}`, undefined, { testId, group: "disputeside" });
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
 *   - (Batch 29 §38, correcting batch 28 §20) Every piece, listed or not: the part's max IN ALL (Pay + every Pay more + any dispute raise): $500 for written answers
 *     or a recording; $200/h × the measured minutes for a call. A listed price at the max leaves no Pay more room.
 *   - (Batch 15 section 34) Any call, listed or not: all of the tester's calls on the test together at most $500 (extra pay counted).
 * `roomCents`: the most the next payment (the first Pay or a "Pay more") can be. `aboveRoomCents`: for a listed piece, what is still left above the listing (for the
 * blocked line). `callPoolRoomCents`: for a call, what is left of the $500 for the tester's calls (else null); `ceilingBinds`: that's what limits this payment.
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
/** The blocked line for a payment over a piece's room (batch 9's wording; batch 15 section 34: a call over what's left of the $500 says so). */
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
  // (Owner, Nov 6, §311e) An unlisted call closed with $0 at its pay date is final too.
  if (paidReview.reason === UNLISTED_CALL_CLOSED) throw new HttpError(409, "closed", unlistedCallClosedLine(`${displayName(c.tester)}'s call`));
  // (Owner, Nov 11, §378; replaces batch 17 §19's one date per test) Pay more on a piece closes on that piece's own date, with its Pay and Charge (pieceCloseOut).
  {
    const at = await pieceCloseOut(piece.where);
    if (closedOut(at)) throw new HttpError(409, "pay_more_closed", payClosedLine(fmtDate(at!), true));
  }
  // (Owner, Oct 27) Unavailable during a payment or chargeback hold (the route refuses first; this is the backstop). (Owner, Nov 9, §368) A suspension or the team's
  // pause no longer stops it: it charges at once (a suspension that is also held keeps its own line).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { devSuspendedAt: true, holdStartedAt: true } });
  if (devNow.devSuspendedAt && devNow.holdStartedAt) throw new HttpError(403, "suspended", suspendedLine("extra pay")); // (§364 item 8)
  await (await import("./holds")).devHoldRefusal(dev.id, "pay", "Pay more");
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
    // (Owner, Nov 3, §159) A payment on this part waiting for the bank: refused (never a stop-once: it can't go ahead), read in the locked step, so a Pay more pressed
    // the moment a Charge starts waiting can't slip through.
    const waits = await bankWaitsLine(tx, at, name);
    if (waits) throw new HttpError(409, "bank_waits", waits);
    // (Batch 15 section 13) The same press again (its answer was lost): never twice. A press that failed without a charge can be pressed again.
    const again = await tx.payment.findFirst({ where: { kind: "extra", pressKey: extraKey } });
    if (again && again.status !== "failed" && again.status !== "cancelled") return { again };
    if (again) await tx.payment.update({ where: { id: again.id }, data: { pressKey: null } });
    // (Batch 9 section 6; batch 29 §38) Per piece: the part's max in all, listed or not.
    const room = await pieceRoom(piece, tx);
    const morePress = { ...payPressOf(c.id, at), fromNeeds: body.from === "needs" }; // (§362) Needs you's Pay (an update's), never the Testers list's Pay more
    if (amount! > room.roomCents) {
      // (Owner, Nov 4, batch 35 §163; replaces batch 16 section 21's stop first) More than what's left: refused on the first press, never after a stop.
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
    // (Owner, Nov 3) "Playtest: Pay more for Ana Silva's written answers on “Harbor Run”", as its "What you've paid" line.
    const description = await describedOnce(row.id, () => stripeDescription({ payment: row }));
    const charging = (key: string) => charge(dev, c.tester, amount!, key, description, "press");
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
    await (await import("./holds")).declinedPayment(dev.id, row.id, amount!, `extra pay for ${pieceName({ tester: name, part: piece.label, test: c.test.title, when: await callWhen(row), full: true })}`); // (§178)
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
    const line = `${displayName(dev)} paid $0 more for what you added to your ${label} on “${c.test.title}”`; // (batch 35 §136)
    // (Owner, Nov 6, §299) A payment line: it reaches her whatever the test's state (stopped or closed included); `about` no longer drops it (notify's reach).
    await notify(c.tester.email, line, [line + ".", ...(note ? [`${pronouns(dev.pronoun).Poss} note: “${note}”`] : [])], `/app/sessions/${c.id}#part-${label === "recording" ? "recording" : "written"}`, { payment: true, group: "tpaid", about: dev.id });
  }
  return { paid: true, amountCents: 0, status: "closed" };
}

/** (Batch 11) A Pay more went through (at once, or once the bank confirmed it). */
export async function finishExtraPay(paymentId: string, result: { status: string; feeCents?: number; testerCents?: number; transferStatus?: string; stripePaymentIntentId: string | null }) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: p.contractId! }, include: { tester: true, test: { include: { developer: true } } } });
  const dev = c.test.developer, name = displayName(c.tester), amount = p.amountCents;
  const label = p.callId ? "live call" : (await db.submission.findUnique({ where: { id: p.submissionId! } }))?.kind === "recording" ? "recording" : "written answers";
  const part = await partWords(p, callAt(dev));
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: p.id }, data: { status: result.status, stripePaymentIntentId: result.stripePaymentIntentId, ...(result.feeCents != null ? { feeCents: result.feeCents, testerCents: result.testerCents, transferStatus: result.transferStatus } : {}), actionPi: null, actionBy: null } });
    await recordEvent(tx, c.testId, "paid", `You paid ${name} ${money(amount)} extra for the ${part}`, false, {}, c.id); // (§177) a call with its date and time
    // (Batch 30 §2) A Pay more (any amount) answers an update the tester sent after it was paid: its Needs you row goes.
    if (p.submissionId) await answerUpdate(tx, p.submissionId, p.createdAt);
  });
  const line = `${displayName(dev)} paid you ${money(amount)} more for ${await partOnTest(p, "your", c.test.title)}`; // (§177) which call
  // (Owner, Nov 6, §299) A payment line: it reaches her whatever the test's state (stopped or closed included); `about` no longer drops it (notify's reach).
  await notify(c.tester.email, line, [line + `. You get ${money(testerShare(amount))}.`, ...(p.note ? [`${pronouns(dev.pronoun).Poss} note: “${p.note}”`] : []), ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : [])], `/app/sessions/${c.id}#${p.callId ? `call-${p.callId}` : `part-${label === "recording" ? "recording" : "written"}`}`, { payment: true, group: "tpaid", about: dev.id }); // (batch 29 §25) in the day's "You were paid" entry, no longer "Extra pay"
  await receipt(dev.email, `extra pay for ${pieceName({ tester: name, part: label, test: c.test.title, full: true, when: await callWhen(p) })}`, amount, result.status, `/app/tests/${c.testId}#tester-${c.id}`); // (§178)
  return { paid: true, amountCents: amount, status: result.status };
}
