import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money, toCents } from "@/lib/format";
import { canDispute, checkDisputeDecision, checkPay, checkReject, listingAmount, MAX_PAY_CENTS, PAY_WAITS, testerShare } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { isAdmin } from "./session";
import { cardRefusal, charge } from "./stripe";
import { devGate, devOnHold, recordEvent } from "./tests";

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
    return { contract: c.contract, review: c.review, listing: c.rateCents == null ? null : listingAmount({ writtenCents: null, recordingCents: null, liveRateCents: c.rateCents }, "call", c.minutes), label: "live call", where: { callId: c.id } };
  }
  return null;
}

/**
 * Pay or Reject one piece. Checks (in order): the piece is on the developer's test and not paid/rejected yet (final
 * refusal: "You already paid $8.00 for this."), the tester's account can be paid (final), the developers' one stop-once
 * gate (test-wide, since the page loaded), then the amount rules and the "charged now" tick (Pay) or a reason (Reject).
 * Pay reserves the piece, charges once (idempotent by payKey) and records the payment; Reject charges nothing.
 */
export async function review(dev: U & Parameters<typeof cardRefusal>[0], body: Record<string, unknown>) {
  const reject = body.action === "reject";
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const payKey = typeof body.payKey === "string" && /^[\w-]{8,80}$/.test(body.payKey) ? body.payKey : "";
  if (!payKey) throw new HttpError(400, "bad_request", "This page is out of date. Refresh to see the latest.");
  const done = await db.review.findUnique({ where: { payKey } });
  if (done) return { reviewId: done.id, amountCents: done.amountCents, rejected: done.rejected, repeated: true }; // the same press again: never twice
  const amountCents = reject ? 0 : toCents(body.amount);
  const tickedCents = typeof body.tickedCents === "number" ? body.tickedCents : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

  const reserved = await db.$transaction(async (tx) => {
    const piece = await loadPiece(tx, kind, id);
    if (!piece || piece.contract.test.developerId !== dev.id) throw new HttpError(404, "not_found", "That work doesn't exist or isn't on your test.");
    const c = piece.contract;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const name = displayName(c.tester);
    const already = await tx.review.findFirst({ where: piece.where });
    if (already) throw new HttpError(409, "reviewed", already.rejected ? "You already rejected this." : `You already paid ${money(already.amountCents)} for this.`);
    if (c.tester.suspendedAt) throw new HttpError(409, "closed_account", `${name}'s account is closed for now, so they can't be paid.`);
    if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", PAY_WAITS);
    await devGate(tx, c.testId, body.seenAt, body.confirmed === true, { paidSoFarCents: await paidSoFar(c.id, tx), name });
    if (reject) {
      const r = checkReject(reason);
      if (!r.ok) throw new HttpError(400, "bad_reason", r.message);
    } else {
      const check = checkPay(amountCents, piece.listing, reason, tickedCents);
      if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
      const card = amountCents! > 0 ? cardRefusal(dev) : "";
      if (card) throw new HttpError(409, "no_card", card);
    }
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
    await notify(c.tester.email, `Your ${piece.label} on “${c.title}” wasn't accepted`, [`${displayName(dev)} rejected your ${piece.label}: “${rev.reason}”`, canDisp ? "It's part of your contract, so you can dispute this once from your session page." : "It was extra work (not in the listing), so this is final."], `/app/sessions/${c.id}`);
    return { reviewId: rev.id, amountCents: 0, rejected: true, paidSoFarCents: await paidSoFar(c.id) };
  }
  let result;
  try {
    result = await charge(dev, c.tester, rev.amountCents, payKey, `Playtest: ${piece.label} on “${c.title}”`);
  } catch (e) {
    // Not charged: free the piece so the developer can press Pay again after fixing the card.
    await db.$transaction([
      db.payment.update({ where: { id: payment!.id }, data: { status: "failed", failure: (e as Error).message } }),
      db.review.delete({ where: { id: rev.id } }),
    ]);
    throw e;
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
    `/app/sessions/${c.id}`,
  );
  return { reviewId: rev.id, amountCents: rev.amountCents, status: result.status, rejected: false, paidSoFarCents: await paidSoFar(c.id) };
}

/** Tester: dispute once, only for parts in the contract paid below the listing amount. */
export async function openDispute(tester: U, contractId: string, body: Record<string, unknown>) {
  const kind = String(body.kind ?? ""), id = String(body.id ?? "");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
  if (reason.length < 10) throw new HttpError(400, "bad_reason", "Say why you think the pay should be higher (at least a sentence).");
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  const where = kind === "call" ? { callId: id } : { submissionId: id };
  const review = await db.review.findFirst({ where: { ...where, contractId } });
  if (!review) throw new HttpError(409, "not_paid", "This hasn't been paid yet.");
  const existing = await db.dispute.findFirst({ where });
  // Extra work paid $0 automatically after 14 days: the tester can flag it to the admin (once).
  const flag = review.auto && review.agreedCents == null && !existing;
  const ok = flag ? { ok: true as const } : canDispute(review.amountCents, review.agreedCents, !!existing);
  if (!ok.ok) throw new HttpError(409, "no_dispute", ok.message);
  const d = await db.dispute.create({ data: { ...where, contractId, testerId: tester.id, reason } });
  await notify(c.test.developer.email, `${displayName(tester)} disputed a payment on “${c.title}”`, [`${displayName(tester)} thinks the pay should be higher: “${reason}”`, "Our team decides. A decision can only raise the pay, up to the listing amount."], `/app/tests/${c.testId}`);
  return d;
}

/** Admin: decide a dispute. The total can only go up (to at most the listing amount); the extra is charged. */
export async function decideDispute(admin: U, disputeId: string, body: Record<string, unknown>) {
  if (!isAdmin(admin)) throw new HttpError(403, "not_admin", "Only admins can decide disputes.");
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
  if (d.status !== "open") throw new HttpError(409, "decided", "This dispute was already decided.");
  const review = await db.review.findFirstOrThrow({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
  const decided = toCents(body.total);
  const check = checkDisputeDecision(decided, review.amountCents, review.agreedCents ?? MAX_PAY_CENTS);
  if (!check.ok) throw new HttpError(400, "bad_amount", check.message);
  const extra = check.extraCents!;
  const c = await db.contract.findUniqueOrThrow({ where: { id: d.contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  // Claim the dispute first so two admins can't charge twice.
  const claimed = await db.dispute.updateMany({ where: { id: d.id, status: "open" }, data: { status: "decided", decidedCents: decided!, decisionNote: note, decidedById: admin.id, decidedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, "decided", "This dispute was already decided.");
  if (extra > 0) {
    let result;
    try {
      result = await charge(c.test.developer, c.tester, extra, `dispute-${d.id}`, `Playtest: dispute decision on “${c.title}”`);
    } catch (e) {
      await db.dispute.update({ where: { id: d.id }, data: { status: "open", decidedCents: null, decidedAt: null } });
      throw e;
    }
    await db.payment.create({ data: { kind: "dispute", disputeId: d.id, submissionId: d.submissionId, callId: d.callId, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, ...result } });
  }
  const line = extra > 0 ? `The team raised the pay to ${money(decided!)} (${money(extra)} more).` : `The team kept the pay at ${money(review.amountCents)}.`;
  await notify(c.tester.email, `Your dispute on “${c.title}” was decided`, [line, ...(note ? [`Their note: “${note}”`] : [])], `/app/sessions/${c.id}`);
  await notify(c.test.developer.email, `A dispute on “${c.title}” was decided`, [line, ...(note ? [`The team's note: “${note}”`] : [])], `/app/tests/${c.testId}`);
  return { extraCents: extra };
}
