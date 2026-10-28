import { db } from "@/lib/db";
import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// (Batch 15 section 26) The tester's one-press Alerts: On (every change since the page opened stops a press once) or Off (only changes to their contract do). Saved per tester.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const off = b.off === true;
    await db.user.update({ where: { id: u.id }, data: { testerAlertsOff: off } });
    return ok({ off });
  });
}
