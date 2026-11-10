import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import * as RF from "@/lib/refusal";
import { confirmFinish, confirmStart } from "@/lib/server/confirm";
import { peekBankCheck } from "@/lib/server/bankPeek";
import { heartbeat } from "@/lib/server/bankHeartbeat";
import { logConfirmed, logPayMore, logReview } from "@/lib/server/actionText";
import { db } from "@/lib/db";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment": `start` hands the page what Stripe's pop-up needs (Confirm on Payments); otherwise the pop-up
// finished and the payment goes through, or nothing is charged ("Your bank didn't confirm the payment, so nothing was charged.").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.deletedAt) throw new HttpError(403, "deleted", RF.ACCOUNT_NO_LONGER_EXISTS); // (§364 item 12)
    const body = await readJson(req);
    const paymentId = String(body.paymentId ?? "");
    // (§158) The open bank check asks whether Stripe still waits for the customer: read-only (nothing is finished, cancelled or charged), the developer's own only.
    if (body.peek === true) {
      const r = await peekBankCheck(u, body);
      // (§160) The page holding the bank window is still open: its heartbeat (an open check with none for 3 minutes is ended like Cancel).
      await heartbeat(u.id, typeof body.paymentId === "string" && body.paymentId ? body.paymentId : typeof body.setupIntent === "string" ? body.setupIntent : "");
      // (Owner, Nov 5, §270) The notice's lines name people and tests: their green links come with them.
      const changes = (r as { changes?: unknown }).changes;
      if (Array.isArray(changes) && changes.length) {
        const { linkPool, linksForTexts } = await import("@/lib/server/lineLinks");
        return ok({ ...r, links: linksForTexts(await linkPool(u.id), changes.filter((x): x is string => typeof x === "string")) });
      }
      return ok(r);
    }
    // (Batch 23 section 9) The start runs the stop-once check (the page's seen marker) and the plain refusals first.
    if (body.start === true) return ok(await confirmStart(u, paymentId, body));
    const p = await db.payment.findUnique({ where: { id: paymentId }, select: { id: true, kind: true, submissionId: true, callId: true, status: true, contractId: true, amountCents: true, repaysId: true } });
    const r = await confirmFinish(u, paymentId, body);
    if (p && p.status === "needs_action" && (p.kind === "review" || p.kind === "call") && "reviewId" in r) await logReview(u.id, { ...body, action: "pay", kind: p.callId ? "call" : "submission", id: p.callId ?? p.submissionId ?? "" }, r as { amountCents?: number });
    // (Batch 20 section 12) A Pay more the bank confirmed: another tab's presses stop once for it, as for one that went through at once.
    if (p && p.status === "needs_action" && p.kind === "extra" && (r as { paid?: boolean }).paid) await logPayMore(u.id, body, p);
    // (§86) Confirm of a Charge / dispute payment made while away also answers the piece.
    // The ordinary Pay / Pay more paths above already log their answer; a repeated finish is not another action.
    // (Owner, Nov 3, batch 35 §163) One own line per confirmed charge, calls included: "You confirmed Ana Silva's $10.00 charge for her written answers with your
    // bank in another tab" (the other tabs' stop boxes and open bank boxes show it; this tab never does).
    const went = (r as { done?: boolean }).done === true && !("repeated" in r && r.repeated);
    if (p?.contractId && ["needs_confirmation", "failed", "owed", "paying"].includes(p.status) && went) await logConfirmed(u.id, body, p);
    // (Batch 35 §117) Pay what you owe's one payment confirmed (and Confirm all's, §147): one line for each charge it paid.
    if (p?.kind === "owed" && went) {
      for (const d of await db.payment.findMany({ where: { coveredById: paymentId, contractId: { not: null } }, select: { id: true, kind: true, submissionId: true, callId: true, contractId: true, amountCents: true, repaysId: true } })) await logConfirmed(u.id, body, d);
    }
    return ok(r);
  });
}
