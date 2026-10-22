import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { decideDispute } from "@/lib/server/payments";
import { isAdmin, requireUser } from "@/lib/server/session";
import { sendWaitingTransfer } from "@/lib/server/stripe";

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
      case "suspend":
      case "unsuspend": {
        if (id === u.id) throw new HttpError(409, "self", "You can't pause your own account.");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        await db.user.update({ where: { id }, data: action === "suspend" ? { suspendedAt: new Date(), suspendNote: note } : { suspendedAt: null, suspendNote: "" } });
        return ok({ ok: true });
      }
      case "transfer":
        await sendWaitingTransfer(id);
        return ok({ ok: true });
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  });
}
