import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// (Batch 15 section 26) The tester's one-press Alerts: On (every change since the page opened stops a press once) or Off (only changes to their contract do). Saved per tester.
// (Owner, Nov 3, batch 35 §157) The press sends the state it means ("on" / "off": what the button offered), never a flip: a stale page elsewhere can't turn it back,
// and a press for the state it already has changes nothing (`unchanged`). An older page's `off: true/false` is read the same way.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const want = b.alerts === "on" || b.alerts === "off" ? b.alerts === "off" : typeof b.off === "boolean" ? b.off : null;
    if (want === null) throw new HttpError(400, "bad_alerts", "Choose On or Off.");
    const changed = await db.user.updateMany({ where: { id: u.id, testerAlertsOff: !want }, data: { testerAlertsOff: want } });
    return ok({ off: want, ...(changed.count ? {} : { unchanged: true }) });
  });
}
