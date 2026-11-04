import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { confirmFinish, confirmStart } from "@/lib/server/confirm";
import { peekBankCheck } from "@/lib/server/bankPeek";
import { heartbeat } from "@/lib/server/bankHeartbeat";
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
    // (§158) The open bank check asks whether Stripe still waits for the customer: read-only (nothing is finished, cancelled or charged), the developer's own only.
    if (body.peek === true) {
      const r = await peekBankCheck(u, body);
      // (§160) The page holding the bank window is still open: its heartbeat (an open check with none for 3 minutes is ended like Cancel).
      await heartbeat(u.id, typeof body.paymentId === "string" && body.paymentId ? body.paymentId : typeof body.setupIntent === "string" ? body.setupIntent : "");
      return ok(r);
    }
    // (Batch 23 section 9) The start runs the stop-once check (the page's seen marker) and the plain refusals first.
    if (body.start === true) return ok(await confirmStart(u, paymentId, body));
    const p = await db.payment.findUnique({ where: { id: paymentId }, select: { kind: true, submissionId: true, callId: true, status: true, contractId: true, amountCents: true } });
    const r = await confirmFinish(u, paymentId, body);
    if (p && p.status === "needs_action" && (p.kind === "review" || p.kind === "call") && "reviewId" in r) await logReview(u.id, { ...body, action: "pay", kind: p.callId ? "call" : "submission", id: p.callId ?? p.submissionId ?? "" }, r as { amountCents?: number });
    // (Batch 20 section 12) A Pay more the bank confirmed: another tab's presses stop once for it, as for one that went through at once.
    if (p && p.status === "needs_action" && p.kind === "extra" && (r as { paid?: boolean }).paid) await logPayMore(u.id, body, p);
    // (§86) Confirm of a Charge / dispute payment made while away also answers the piece.
    // The ordinary Pay / Pay more paths above already log their answer; a repeated finish is not another action.
    if (p?.submissionId && ["needs_confirmation", "failed", "owed", "paying"].includes(p.status) && !("repeated" in r && r.repeated)) {
      if (p.kind === "extra") await logPayMore(u.id, body, p);
      else await logReview(u.id, { ...body, kind: "submission", id: p.submissionId }, { amountCents: p.amountCents });
    }
    // (Batch 35 §117) Pay what you owe's one payment confirmed: each sent part it paid is answered the same way.
    if (p?.kind === "owed" && !("repeated" in r && r.repeated)) {
      for (const d of await db.payment.findMany({ where: { coveredById: paymentId, submissionId: { not: null } }, select: { kind: true, submissionId: true, callId: true, status: true, contractId: true, amountCents: true } })) {
        if (d.kind === "extra") await logPayMore(u.id, body, d);
        else await logReview(u.id, { ...body, kind: "submission", id: d.submissionId! }, { amountCents: d.amountCents });
      }
    }
    return ok(r);
  });
}
