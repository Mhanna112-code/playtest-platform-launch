import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { confirmFinish, confirmStart } from "@/lib/server/confirm";
import { logPayMore, logReview } from "@/lib/server/actionText";
import { db } from "@/lib/db";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment": `start` hands the page what Stripe's pop-up needs (Confirm on Payments); otherwise the pop-up
// finished and the payment goes through, or nothing is charged ("Your bank didn't confirm the payment, so nothing was charged.").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.deletedAt) throw new HttpError(403, "deleted", "This account was deleted.");
    const body = await readJson(req);
    const paymentId = String(body.paymentId ?? "");
    if (body.start === true) return ok(await confirmStart(u, paymentId));
    const p = await db.payment.findUnique({ where: { id: paymentId }, select: { kind: true, submissionId: true, callId: true, status: true, contractId: true, amountCents: true } });
    const r = await confirmFinish(u, paymentId, body);
    if (p && p.status === "needs_action" && (p.kind === "review" || p.kind === "call") && "reviewId" in r) await logReview(u.id, { ...body, action: "pay", kind: p.callId ? "call" : "submission", id: p.callId ?? p.submissionId ?? "" }, r as { amountCents?: number });
    // (Batch 20 section 12) A Pay more the bank confirmed: another tab's presses stop once for it, as for one that went through at once.
    if (p && p.status === "needs_action" && p.kind === "extra" && (r as { paid?: boolean }).paid) await logPayMore(u.id, body, p);
    return ok(r);
  });
}
