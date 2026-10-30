import { notificationScopeFor } from "@/lib/server/notify";
import { db } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// Opening a stack of same-day lines marks them read (each line keeps its own read state).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    await db.notification.updateMany({ where: { userId: u.id, ...await notificationScopeFor(u.id), id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
    return ok({ ok: true });
  });
}
