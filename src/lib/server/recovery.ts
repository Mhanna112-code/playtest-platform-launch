import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { splitFee } from "@/lib/rules";
import { getStripe, stripeOn } from "./stripe";
import { isChoiceKey } from "./pressKeys";

// (Owner, Oct 30, batch 15 section 9) Payments stuck "in progress". A Pay (or Pay more, or a tester's Charge) reserves its piece and a `pending` Payment, then charges
// Stripe. If the answer from Stripe was lost (the server stopped, or the connection dropped) the payment stays pending. After 15 minutes it is checked: by the daily job,
// and when the developer's test page, Payments or the tester's session page loads (at most once a minute per payment). The PaymentIntent is found by its metadata payKey:
//   - succeeded: finished as normal (finishReviewPay / finishExtraPay / finishChoicePay);
//   - requires_action / processing: left for the bank-confirmation timers;
//   - failed, cancelled or not found: cleared. The review (the press's reservation) is deleted, the payment is marked failed "interrupted", and the piece is back in
//     Needs you so Pay can be pressed again. Nobody gets a bell.
// Never twice: a new press on the same piece within 24 hours of an interrupted one charges with the SAME idempotency key (pressKeyFor).

export const STUCK_MS = 15 * 60_000;
const CHECK_EVERY_MS = 60_000;
const REUSE_MS = 24 * 3_600_000;
export const INTERRUPTED = "interrupted";
/** The blue line under a press whose answer from Stripe was lost. */
export const PAYMENT_CHECKING = "We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.";

type PieceKey = { submissionId?: string | null; callId?: string | null };

/**
 * The key a new press on this piece charges with: an interrupted press's key from the last 24 hours, else the press's own. The interrupted row hands its key over (its
 * payKey is cleared: (kind, payKey) is unique, batch 15 section 41, M2).
 */
export async function pressKeyFor(where: PieceKey, kinds: string[], fresh: string, tx: Prisma.TransactionClient = db, now = new Date()) {
  const key = where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId ?? "" };
  const prev = await tx.payment.findFirst({ where: { ...key, kind: { in: kinds }, status: "failed", failure: INTERRUPTED, payKey: { not: null }, createdAt: { gt: new Date(now.getTime() - REUSE_MS) } }, orderBy: { createdAt: "desc" } });
  if (!prev?.payKey) return fresh;
  await tx.payment.update({ where: { id: prev.id }, data: { payKey: null } });
  return prev.payKey;
}

/**
 * (Batch 19 section 5) A press's charge key that no earlier attempt holds. A cancelled or failed bank check frees the press (its review is deleted and nothing was
 * charged), so the next Pay on that piece is a NEW attempt: when the page sends the same press key again, the attempt gets "<key>:2", "<key>:3" … (a client's key is a
 * UUID, so it can never end like that), a fresh Stripe idempotency key, and no unique-key clash with the cancelled row on (kind, payKey). A double press of one attempt
 * still meets that attempt (its review, or for Pay more its pending row) first, so it is charged once.
 */
export async function freshPayKey(tx: Prisma.TransactionClient, kinds: string[], key: string) {
  for (let n = 1; n < 1000; n++) {
    const k = n === 1 ? key : `${key}:${n}`;
    if (!(await tx.payment.findFirst({ where: { kind: { in: kinds }, payKey: k }, select: { id: true } }))) return k;
  }
  return `${key}:${Date.now()}`;
}

/** The PaymentIntent a press created, by its metadata payKey (Stripe's search; the fake keeps its own list). */
export async function findPaymentIntent(payKey: string): Promise<{ id: string; status: string; transfer_data?: { destination?: unknown } | null } | null> {
  if (!stripeOn() || !/^[\w:-]{1,200}$/.test(payKey)) return null;
  const r = await getStripe().paymentIntents.search({ query: `metadata['payKey']:'${payKey}'`, limit: 1 });
  return (r.data[0] as unknown as { id: string; status: string; transfer_data?: { destination?: unknown } | null }) ?? null;
}

/** Check one stuck payment. Returns what happened: "finished" | "waiting" | "cleared" | null (not stuck, or checked under a minute ago). */
export async function recoverPayment(paymentId: string, now = new Date()) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.status !== "pending" || now.getTime() - p.createdAt.getTime() < STUCK_MS) return null;
  // Claim this check (at most one a minute, and never two at once).
  const claimed = await db.payment.updateMany({
    where: { id: p.id, status: "pending", OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } }] },
    data: { checkedAt: now },
  });
  if (claimed.count !== 1) return null;
  const pi = p.payKey ? await findPaymentIntent(p.payKey) : null;
  if (pi?.status === "succeeded") {
    const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
    const result = { status: "charged", stripePaymentIntentId: pi.id, ...splitFee(p.amountCents), transferStatus: pi.transfer_data?.destination ? "sent" : "waiting" };
    if (p.kind === "extra") await (await import("./payments")).finishExtraPay(p.id, result);
    else if (isChoiceKey(p.payKey)) await (await import("./holds")).finishChoicePay(p.id, result);
    else await (await import("./payments")).finishReviewPay(p.id, result);
    return "finished" as const;
  }
  if (pi && ["requires_action", "processing", "requires_confirmation", "requires_capture"].includes(pi.status)) return "waiting" as const;
  // Failed, cancelled or never made: clear it, and the piece can be paid (or charged) again.
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: p.id }, data: { status: "failed", failure: INTERRUPTED } });
    if (p.kind !== "extra") {
      const where = p.submissionId ? { submissionId: p.submissionId } : { callId: p.callId ?? "" };
      await tx.review.deleteMany({ where });
    }
  });
  return "cleared" as const;
}

/** Check the stuck payments of one developer's test, one tester's session, or (the daily job) all of them. Never throws: a page load must not fail on it. */
export async function checkStuck(scope: { testId?: string; contractId?: string; developerId?: string } = {}, now = new Date()) {
  try {
    const rows = await db.payment.findMany({
      where: {
        status: "pending",
        createdAt: { lt: new Date(now.getTime() - STUCK_MS) },
        ...(scope.contractId ? { contractId: scope.contractId } : {}),
        ...(scope.developerId ? { developerId: scope.developerId } : {}),
        ...(scope.testId ? { contractId: { in: (await db.contract.findMany({ where: { testId: scope.testId }, select: { id: true } })).map((c) => c.id) } } : {}),
      },
      select: { id: true },
      take: 50,
    });
    const out = [];
    for (const r of rows) out.push(await recoverPayment(r.id, now).catch((e) => (console.error("[recovery]", (e as Error).message), null)));
    return out;
  } catch (e) {
    console.error("[recovery]", (e as Error).message);
    return [];
  }
}
