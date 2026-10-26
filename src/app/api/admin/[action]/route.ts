import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { decideDispute } from "@/lib/server/payments";
import { isAdmin, requireUser } from "@/lib/server/session";
import { sendWaitingTransfer } from "@/lib/server/stripe";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { closePausedTest, extendPauseClosure } from "@/lib/server/pauseClosure";
import { adminStopTest, deleteAccount, pauseTest, previewSuspension, reinstateAccount, releaseHeldShares, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { refundPayment } from "@/lib/server/stripe";

type Ctx = { params: Promise<{ action: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { action } = await params;
    const u = await requireUser(req);
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const body = await readJson(req);
    const id = String(body.id ?? "");
    switch (action) {
      case "decide":
        return ok(await decideDispute(u, id, body));
      case "suspend": {
        if (id === u.id) throw new HttpError(409, "self", "You can't pause your own account.");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        if (note.length < 3) throw new HttpError(400, "bad_note", "Record why (it is kept with the suspension).");
        return ok(await suspendAccount(u.id, id, note));
      }
      case "unsuspend":
        return ok(await reinstateAccount(id));
      case "preview-suspension":
        return ok(await previewSuspension(id));
      case "delete-account": {
        if (id === u.id) throw new HttpError(409, "self", "Use Settings to delete your own account.");
        const reason = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        if (reason.length < 3) throw new HttpError(400, "bad_note", "Record why (it is kept with the deletion).");
        return ok(await deleteAccount(id, "admin", reason));
      }
      case "pause-test":
        return ok(await pauseTest(u.id, id, typeof body.note === "string" ? body.note.trim().slice(0, 500) : ""));
      case "unpause-test":
        return ok(await unpauseTest(id));
      case "stop-test":
        return ok(await adminStopTest(id, typeof body.note === "string" ? body.note.trim().slice(0, 500) : "", u.id));
      case "release-share": {
        const p = await db.payment.findUniqueOrThrow({ where: { id } });
        return ok(await releaseHeldShares(p.testerId, [p.id]));
      }
      case "refund-share":
        await refundPayment(id);
        return ok({ ok: true });
      case "allow-critical-changes":
        await db.test.update({ where: { id }, data: { criticalChanges: 0 } });
        return ok({ ok: true });
      // (Owner, Oct 26) A chargeback hold needs the admin's approval (id = the developer) once the card is verified and what is owed is paid.
      case "approve-chargeback":
        return ok(await approveChargebackHold(id));
      // A paused test closes after 7 days: the admin can move its date later (days, default 7) or close it now (id = the test).
      case "extend-pause":
        return ok(await extendPauseClosure(id, body.days));
      case "close-paused":
        return ok(await closePausedTest(id, "admin", new Date(), u.id));
      case "transfer":
        await sendWaitingTransfer(id);
        return ok({ ok: true });
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  });
}
