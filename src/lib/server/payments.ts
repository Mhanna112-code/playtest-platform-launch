import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money, toCents } from "@/lib/format";
import { CHARGED_BY_TESTER, LET_GO_BY_TESTER, callReference, checkDevSide, canDispute, checkDisputeDecision, delayedPayLine, declinedHoldLine, checkPay, checkReject, STRIPE_MAX_CENTS, checkExtraPay, EXTRA_PAY_CAP_PERCENT, NO_LISTING_CAP_CENTS, overListingLine, PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS, testerShare } from "@/lib/rules";
import { HttpError } from "./http";
import { adminUsers, bell, notify } from "./notify";
import { blockedEitherWay } from "./blocks";
import { labelled, reportedOver3 } from "./reports";
import { partAnchor } from "@/lib/links";
import { isAdmin } from "./session";
import { cardRefusal, charge } from "./stripe";
import { devGate, devGateIfSeen, devOwes, recordEvent } from "./tests";
import { logEvent } from "./live";
import { testerGate } from "./testerGate";

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
    return { contract: s.contract, review: s.review, listing: s.agreedCents, label: s.kind === "written" ? "written answers" : "recording", where: { submissionId: s.id } };
  }
  if (kind === "call") {
    const c = await tx.call.findUnique({ where: { id }, include: { review: true, contract: { include: { test: true, tester: true } } } });
    if (!c) return null;
    if (c.status === "cancelled") throw new HttpError(409, "cancelled", "This call was cancelled, so there's nothing to pay.");
    if (c.startsAt > new Date()) throw new HttpError(409, "not_yet", "You can pay for this call once it has started.");
    return { contract: c.contract, review: c.review, listing: callReference(c.rateCents, c.actualMinutes ?? c.minutes).cents, label: "live call", where: { callId: c.id } };
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
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  // (Owner, Oct 27) Pay and Reject are unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, suspendedAt: true } });
  if (devNow.suspendedAt || devNow.holdStartedAt) throw new HttpError(403, devNow.suspendedAt ? "suspended" : "held", devNow.suspendedAt ? "Your account is suspended: Pay and Reject wait until it is lifted." : PAY_WAITS);

  const reserved = await db.$transaction(async (tx) => {
    const piece = await loadPiece(tx, kind, id);
    if (!piece || piece.contract.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That work doesn't exist or isn't on your test.");
    const c = piece.contract;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const name = displayName(c.tester);
    // (Owner, Oct 28) A tester who deleted their account: work of theirs that isn't paid yet can no longer be paid, charged or disputed (final).
    if (c.tester.deletedAt && !(await tx.review.findFirst({ where: piece.where }))) throw new HttpError(409, "gone", "This tester deleted their account, so this work can't be paid or rejected any more.");
    const already = await tx.review.findFirst({ where: piece.where });
    if (already) {
      if (already.reason === CHARGED_BY_TESTER) throw new HttpError(409, "reviewed", `${name} already charged ${money(already.amountCents)} for this.`);
      if (already.reason === LET_GO_BY_TESTER) throw new HttpError(409, "reviewed", `${name} let this go: nothing was charged.`);
      const owedNow = !already.rejected && (await tx.payment.findFirst({ where: { ...piece.where, status: "failed", owedUntil: { not: null }, settledAt: null } }));
      if (owedNow) throw new HttpError(409, "owed", `This ${money(already.amountCents)} is owed: pay it with “Pay what you owe” in Payments.`);
      throw new HttpError(409, "reviewed", already.rejected ? "You already rejected this." : `You already paid ${money(already.amountCents)} for this.`);
    }
    if (!reject && (await devOwes(dev.id))) throw new HttpError(409, "owed_first", PAY_WAITS);
    // Form mistakes (red at the field) come BEFORE the stop-once: a second press would only fail on them.
    if (reject) {
      const r = checkReject(reason);
      if (!r.ok) throw new HttpError(400, "bad_reason", r.message);
    } else {
      const check = checkPay(amountCents, piece.listing, reason, tickedCents);
      if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
      // (Owner, Oct 27) Over $200 the Pay box shows the tick "I understand this payment can't be refunded and is charged now." every time: refused until ticked.
      if (amountCents! > PAY_TICK_CENTS && body.understood !== true) throw new HttpError(400, "bad_tick", `Tick “${PAY_TICK_LINE}” to pay.`);
      // Everything paid above the listing prices (this Pay's excess plus extra pays) is capped at EXTRA_PAY_CAP_PERCENT of the tester's contract total.
      if (piece.listing != null && amountCents! > piece.listing) {
        const { roomCents } = await overListingRoom(c.id);
        if (amountCents! - piece.listing > roomCents) throw new HttpError(400, "over_cap", overListingLine(roomCents));
      } else if (piece.listing == null) {
        // (Owner, Oct 27) A part with no listed price can be paid at most $100 in total (its own cap).
        const room = await noListingRoom(piece.where, tx);
        if (amountCents! > room) throw new HttpError(400, "over_cap", overListingLine(room));
      }
      const card = amountCents! > 0 ? cardRefusal(dev) : "";
      if (card) throw new HttpError(409, "no_card", card);
    }
    await devGate(tx, c.testId, body, { paidSoFarCents: await paidSoFar(c.id, tx), name });
    const rev = await tx.review.create({ data: { ...piece.where, contractId: c.id, amountCents: amountCents!, agreedCents: piece.listing, reason, payKey, rejected: reject } });
    const payment = reject
      ? null
      : await tx.payment.create({
          data: { kind: kind === "call" ? "call" : "review", submissionId: piece.where.submissionId ?? null, callId: piece.where.callId ?? null, contractId: c.id, developerId: dev.id, testerId: c.testerId, amountCents: amountCents!, feeCents: 0, testerCents: 0, status: "pending" },
        });
    if (reject) await recordEvent(tx, c.testId, "rejected", `You rejected ${name}'s ${piece.label}`, false, {}, c.id);
    return { rev, payment, c, piece, name };
  });

  const { rev, payment, c, piece, name } = reserved;
  if (reject) {
    const canDisp = rev.agreedCents != null && rev.agreedCents > 0;
    await notify(c.tester.email, `Your ${piece.label} on “${c.title}” wasn't accepted`, [`${displayName(dev)} rejected your ${piece.label}: “${rev.reason}”`, canDisp ? "It's part of your contract, so you can dispute this once from your session page." : "It wasn't in your contract, so this is final."], `/app/sessions/${c.id}#${partAnchor(piece.label)}`, { payment: true, group: "trejected" });
    return { reviewId: rev.id, amountCents: 0, rejected: true, paidSoFarCents: await paidSoFar(c.id) };
  }
  let result;
  try {
    result = await charge(dev, c.tester, rev.amountCents, payKey, `Playtest: ${piece.label} on “${c.title}”`);
  } catch (e) {
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
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment!.id }, data: result });
    await recordEvent(tx, c.testId, "paid", `You paid ${name} ${money(rev.amountCents)} for the ${piece.label}`, false, {}, c.id);
  });
  await notify(
    c.tester.email,
    `You were paid for your ${piece.label} on “${c.title}”`,
    [
      `${displayName(dev)} paid ${money(rev.amountCents)} for your ${piece.label}: you get ${money(testerShare(rev.amountCents))}.`,
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

/** Tester: dispute once, only for parts in the contract paid below the listing amount. */
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
  const ok = canDispute(review.amountCents, review.agreedCents, !!existing);
  if (!ok.ok) throw new HttpError(409, "no_dispute", ok.message);
  const d = await db.dispute.create({ data: { ...where, contractId, testerId: tester.id, reason } });
  await logEvent(c.testId, "dispute", `${displayName(tester)} disputed the pay for their ${kind === "call" ? "live call" : (await db.submission.findUnique({ where: { id } }))?.kind === "recording" ? "recording" : "written answers"}`, contractId);
  await notify(c.test.developer.email, `${displayName(tester)} disputed a payment on “${c.title}”`, [`${displayName(tester)} thinks the pay should be higher: “${reason}”`, "Our team decides. A decision can only raise the pay, up to the listing amount."], `/app/tests/${c.testId}#item-dispute-${d.id}`, { group: "disputefiled" });
  // (Owner, Oct 26) Admins are told too: new-dispute lines on the same day stack into one line across tests, linking to the disputes.
  const flagged = await reportedOver3([tester.id, c.test.developerId]);
  for (const a of await adminUsers()) await bell(a.id, `Dispute on “${c.title}”: ${labelled(displayName(tester), flagged.has(tester.id))} says the pay should be higher (${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))})`, "/admin#disputes", undefined, { group: "disputes" });
  return d;
}

/**
 * (Item 28) What an admin may decide for a dispute: MIN = what this piece was paid; MAX = the part's listing minus what was
 * already paid for that part on OTHER pieces (payments on the same work that are not this review's).
 */
export async function disputeBounds(d: { submissionId: string | null; callId: string | null }) {
  const review = await db.review.findFirstOrThrow({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
  const paid = await db.payment.aggregate({ where: { ...(d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! }), kind: { not: "dispute" }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  const other = d.submissionId ? Math.max(0, (paid._sum.amountCents ?? 0) - review.amountCents) : 0;
  const listing = review.agreedCents ?? STRIPE_MAX_CENTS;
  return { review, listing, other, min: review.amountCents, max: Math.max(review.amountCents, listing - other) };
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
  const { review, other } = await disputeBounds(d);
  // A blank box keeps the pay as it is.
  const blank = body.total === undefined || body.total === null || String(body.total).trim() === "";
  const decided = blank ? review.amountCents : toCents(body.total);
  const check = checkDisputeDecision(decided, review.amountCents, review.agreedCents ?? STRIPE_MAX_CENTS, other);
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
    where: { developerId: devId, contracts: { some: { tester: { deletedAt: null }, OR: [{ submissions: { some: { review: null } } }, { calls: { some: held } }] } } },
    orderBy: { createdAt: "desc" },
    include: { contracts: { where: { tester: { deletedAt: null } }, include: { tester: true, submissions: { where: { review: null } }, calls: { where: held } } } },
  });
}

/**
 * (Owner, Oct 27) How much more can this tester still be paid ABOVE the listing prices? Everything above a part's listed price (a Pay above the listing, plus extra pays on
 * parts that have a listed price) may total at most EXTRA_PAY_CAP_PERCENT of their current contract total: the current part prices plus the agreed totals of their booked and held calls.
 * Parts with no listed price have their own $100 cap (noListingRoom) and do not count here.
 */
export async function overListingRoom(contractId: string, tx: Prisma.TransactionClient = db) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { calls: { where: { status: "booked" } }, submissions: { select: { id: true, agreedCents: true } } } });
  const callTotal = c.calls.reduce((a, x) => a + (callReference(x.rateCents, x.actualMinutes ?? x.minutes, c.liveRateCents).cents ?? 0), 0);
  const contractTotal = (c.writtenCents ?? 0) + (c.recordingCents ?? 0) + callTotal;
  const capCents = Math.round((contractTotal * EXTRA_PAY_CAP_PERCENT) / 100);
  const reviews = await tx.review.findMany({ where: { contractId, rejected: false }, select: { amountCents: true, agreedCents: true } });
  const over = reviews.reduce((a, r) => a + (r.agreedCents != null ? Math.max(0, r.amountCents - r.agreedCents) : 0), 0);
  const listed = new Set(c.submissions.filter((s) => s.agreedCents != null).map((s) => s.id));
  const extraRows = await tx.payment.findMany({ where: { contractId, kind: "extra", status: { in: ["charged", "not_set_up", "deferred", "pending"] } }, select: { amountCents: true, submissionId: true } });
  const extras = extraRows.filter((p) => p.submissionId && listed.has(p.submissionId)).reduce((a, p) => a + p.amountCents, 0);
  return { contractTotal, capCents, usedCents: over + extras, roomCents: Math.max(0, capCents - over - extras) };
}

/** (Owner, Oct 27) What can still be paid for a part with no listed price: $100 in total (the Pay and any extra pays on it). */
export async function noListingRoom(where: { submissionId?: string | null; callId?: string | null }, tx: Prisma.TransactionClient = db) {
  const key = where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId! };
  const rev = await tx.review.findFirst({ where: { ...key, rejected: false }, select: { amountCents: true } });
  const extras = (await tx.payment.aggregate({ where: { ...key, kind: "extra", status: { in: ["charged", "not_set_up", "deferred", "pending"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  return Math.max(0, NO_LISTING_CAP_CENTS - (rev?.amountCents ?? 0) - extras);
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
  const sub = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") } });
  if (!sub || sub.contractId !== c.id) throw new HttpError(404, "not_found", "Choose a part they sent.");
  // (Owner, Oct 27) Unavailable during ANY payment hold, chargeback hold or suspension (the route refuses first; this is the backstop).
  const devNow = await db.user.findUniqueOrThrow({ where: { id: dev.id }, select: { suspendedAt: true } });
  if (devNow.suspendedAt) throw new HttpError(403, "suspended", "Your account is suspended: extra pay waits until it is lifted.");
  await (await import("./holds")).devHoldRefusal(dev.id, "pay");
  if ((await blockedEitherWay(dev.id, c.testerId)) || c.tester.deletedAt) throw new HttpError(409, "unavailable", "This payment isn't available.");
  const amount = toCents(body.amount);
  const check = checkExtraPay(amount, body.understood === true);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  // (Owner, Oct 27) Any amount above a part's listed price counts toward the cap (100% of the contract total); a part with no listed price has its own $100 cap in total.
  const room = sub.agreedCents == null ? await noListingRoom({ submissionId: sub.id }) : (await overListingRoom(c.id)).roomCents;
  if (amount! > room) throw new HttpError(400, "over_cap", overListingLine(room));
  const card = cardRefusal(dev);
  if (card) throw new HttpError(409, "no_card", card);
  await db.$transaction((tx) => devGate(tx, testId, body));
  const payKey = typeof body.payKey === "string" && /^[\w-]{8,80}$/.test(body.payKey) ? body.payKey : randomUUID();
  const name = displayName(c.tester);
  const label = sub.kind === "recording" ? "recording" : "written answers";
  let result;
  try {
    result = await charge(dev, c.tester, amount!, `extra-${payKey}`, `Playtest: extra pay for ${name} on “${c.test.title}”`);
  } catch (e) {
    if (!(e instanceof HttpError && e.code === "card_failed")) throw e;
    // (Owner, Oct 27) A declined extra pay starts the payment hold at once, like any declined payment.
    const failed = await db.payment.create({ data: { kind: "extra", contractId: c.id, submissionId: sub.id, developerId: dev.id, testerId: c.testerId, amountCents: amount!, feeCents: 0, testerCents: 0, status: "failed", failure: (e as Error).message, owedUntil: new Date() } });
    await (await import("./holds")).declinedPayment(dev.id, failed.id, amount!, `extra pay for ${name}`);
    throw new HttpError(402, "card_failed", `Your card was declined, so ${name} wasn't paid ${money(amount)} extra yet. Your tests are paused until you pay what you owe: open Payments.`, { held: true, failed: `Your extra pay on ${c.test.title} was declined` });
  }
  await db.$transaction(async (tx) => {
    await tx.payment.create({ data: { kind: "extra", contractId: c.id, submissionId: sub.id, developerId: dev.id, testerId: c.testerId, ...result, amountCents: amount! } });
    await recordEvent(tx, testId, "paid", `You paid ${name} ${money(amount)} extra for the ${label}`, false, {}, c.id);
  });
  const line = `${displayName(dev)} paid you ${money(amount)} extra for ${c.test.title}`;
  await notify(c.tester.email, line, [line + `: you get ${money(testerShare(amount!))}.`, ...(result.status === "not_set_up" ? ["Payments aren't set up yet, so the money is delayed until they are."] : [])], `/app/sessions/${c.id}#part-${sub.kind}`, { payment: true, group: "textra", about: dev.id });
  await receipt(dev.email, `an extra payment to ${name}`, amount!, result.status, `/app/tests/${testId}#tester-${c.id}`);
  return { paid: true, amountCents: amount, status: result.status };
}
