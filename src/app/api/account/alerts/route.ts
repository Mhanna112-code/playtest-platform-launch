import { ALERT_TYPES } from "@/lib/alerts";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { alertsTest, saveTestAlerts } from "@/lib/server/testAlerts";

// The developer's Alerts menu: the update types they chose not to be stopped for. (Owner, Oct 31, batch 35 §73) Saved on the test (`testId`, only its
// developer may), not the account: a new test and a Next round start with every alert on.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const testId = await alertsTest(u.id, b.testId);
    const allowed: string[] = ALERT_TYPES.map((a) => a.key);
    const bad = () => new HttpError(400, "bad_alert", "That update type can't be turned off.");
    // (Owner, Nov 4, §169) "All" is ONE request: its types (`keys`) all ticked or all unticked (`off`), applied together in one locked write (saveTestAlerts).
    // Seven saves one after another showed one tick at a time, and a poll answered between them put an older list back.
    if (Array.isArray(b.keys)) {
      const keys = [...new Set(b.keys.map(String))];
      if (!keys.length || keys.some((k) => !allowed.includes(k))) throw bad();
      return ok(await saveTestAlerts(testId, b.off === true ? { on: keys } : { off: keys }));
    }
    // (Batch 20 section 8) The menu sends one type (`key`, `off`): only it is added or removed, from what's saved now, so a chip's press in a stop box (or
    // another tab's tick) is never undone by a menu drawn before it. The whole list (`ignored`) is still accepted.
    // (Owner, Nov 4, §169) In the same locked write: two at the same moment (two tabs, a chip and the menu) both stay.
    if (typeof b.key === "string") {
      if (!allowed.includes(b.key)) throw bad();
      return ok(await saveTestAlerts(testId, b.off === true ? { on: [b.key] } : { off: [b.key] }));
    }
    const ignored = Array.isArray(b.ignored) ? b.ignored.filter((x): x is string => typeof x === "string" && allowed.includes(x)) : [];
    return ok(await saveTestAlerts(testId, { set: ignored }));
  });
}
