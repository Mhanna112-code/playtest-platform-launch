import { db } from "@/lib/db";
import { ALERT_TYPES } from "@/lib/alerts";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// "Don't stop me for: <type>" in a stop box: adds that one type to the Alerts the developer ignores.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const key = typeof b.key === "string" ? b.key : "";
    if (!ALERT_TYPES.some((a) => a.key === key)) throw new HttpError(400, "bad_alert", "That update type can't be turned off.");
    await db.user.update({ where: { id: u.id }, data: { ignoredAlerts: [...new Set([...u.ignoredAlerts, key])] } });
    return ok({ ok: true });
  });
}
