import { db } from "@/lib/db";
import { ALERT_TYPES } from "@/lib/alerts";
import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// The developer's Alerts menu: the update types they chose not to be stopped for (saved per developer).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const allowed: string[] = ALERT_TYPES.map((a) => a.key);
    const ignored = Array.isArray(b.ignored) ? [...new Set(b.ignored.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : [];
    await db.user.update({ where: { id: u.id }, data: { ignoredAlerts: ignored } });
    return ok({ ignored });
  });
}
