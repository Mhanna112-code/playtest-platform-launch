import { HttpError, handle, ok } from "@/lib/server/http";
import { ADMIN_PAUSED, adminAccount, isAdmin, requireUser } from "@/lib/server/session";
import { KINDS, adminPage, type Kind } from "@/lib/server/adminLists";
import { searchOf, ticksOf } from "@/lib/adminScroll";

// The admin lists, 25 rows at a time: the rows after a cursor, keyset by date. (Batch 17 §7) The scroll box asks for the next 25 as it nears its end, and for the
// first 25 again to find rows that arrived live. (Batch 17 §5) Accounts and Tests: `q` (the search) and `f` (the ticks, comma-separated) narrow every row, server-side.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (adminAccount(u) && !isAdmin(u)) throw new HttpError(403, "suspended", ADMIN_PAUSED);
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind") as Kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, "bad_list", "That list doesn't exist.");
    return ok(await adminPage(kind, u.id, q.get("after"), q.get("arg") ?? "", { q: searchOf(q.get("q")), ticks: ticksOf(kind, q.get("f")) }));
  });
}
