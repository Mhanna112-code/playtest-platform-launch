import { ALERT_TYPES } from "@/lib/alerts";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { alertsTest, saveTestAlerts } from "@/lib/server/testAlerts";

// "Don't stop me for: <type>" in a stop box: adds that one type to the Alerts the developer ignores on that test (batch 35 §73: `testId`, only its developer).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const key = typeof b.key === "string" ? b.key : "";
    if (!ALERT_TYPES.some((a) => a.key === key)) throw new HttpError(400, "bad_alert", "That update type can't be turned off.");
    const testId = await alertsTest(u.id, b.testId);
    // (Batch 20 section 8) Added to what's saved now (not the copy read with the session), and the saved list returned: the page's Alerts menu, its other stop
    // boxes and other tabs show it at once. (Owner, Nov 4, §169) In one locked write with its version (`v`): a menu tick at the same moment is kept too.
    return ok({ ok: true, ...(await saveTestAlerts(testId, { on: [key] })) });
  });
}
