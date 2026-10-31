import { db } from "@/lib/db";
import { ALERT_TYPES } from "@/lib/alerts";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { alertsTest } from "@/lib/server/testAlerts";

// The developer's Alerts menu: the update types they chose not to be stopped for. (Owner, Oct 31, batch 35 §73) Saved on the test (`testId`, only its
// developer may), not the account: a new test and a Next round start with every alert on.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const testId = await alertsTest(u.id, b.testId);
    const allowed: string[] = ALERT_TYPES.map((a) => a.key);
    // (Batch 20 section 8) The menu sends one type (`key`, `off`): only it is added or removed, from what's saved now, so a chip's press in a stop box (or
    // another tab's tick) is never undone by a menu drawn before it. The whole list (`ignored`) is still accepted.
    if (typeof b.key === "string") {
      if (!allowed.includes(b.key)) throw new HttpError(400, "bad_alert", "That update type can't be turned off.");
      const key = b.key;
      const now = (await db.test.findUniqueOrThrow({ where: { id: testId }, select: { ignoredAlerts: true } })).ignoredAlerts;
      const list = b.off === true ? [...new Set([...now, key])] : now.filter((x) => x !== key);
      await db.test.update({ where: { id: testId }, data: { ignoredAlerts: list } });
      return ok({ ignored: list });
    }
    const ignored = Array.isArray(b.ignored) ? [...new Set(b.ignored.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : [];
    await db.test.update({ where: { id: testId }, data: { ignoredAlerts: ignored } });
    return ok({ ignored });
  });
}
