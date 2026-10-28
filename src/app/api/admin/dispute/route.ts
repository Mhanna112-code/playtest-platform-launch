import { db } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/server/http";
import { ADMIN_PAUSED, adminAccount, isAdmin, requireUser } from "@/lib/server/session";

// (Batch 15 section 27) An open dispute row's live check: the developer's side, once added ("added <time>").
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (adminAccount(u) && !isAdmin(u)) throw new HttpError(403, "suspended", ADMIN_PAUSED);
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const d = await db.dispute.findUnique({ where: { id: new URL(req.url).searchParams.get("id") ?? "" }, select: { devSide: true, devSideAt: true, status: true } });
    if (!d) throw new HttpError(404, "not_found", "That dispute doesn't exist.");
    return ok({ devSide: d.devSide, devSideAt: d.devSideAt, status: d.status });
  });
}
