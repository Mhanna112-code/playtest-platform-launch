import { HttpError, handle, ok } from "@/lib/server/http";
import { isAdmin, requireUser } from "@/lib/server/session";
import { KINDS, adminPage, type Kind } from "@/lib/server/adminLists";

// "Load more" on the admin dashboard: the next 20 of a list after the cursor (keyset by date).
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind") as Kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, "bad_list", "That list doesn't exist.");
    return ok(await adminPage(kind, u.id, q.get("after")));
  });
}
