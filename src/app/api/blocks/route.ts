import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { handle, ok, readJson } from "@/lib/server/http";
import { blockUser, unblockUser } from "@/lib/server/blocks";
import { logAction } from "@/lib/server/live";
import { testerGate } from "@/lib/server/testerGate";
import { devGateIfSeen } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";

// Block / Unblock. Blocking from a session page (tester) or a test page (developer) goes through that page's stop-once
// gate first, and is logged for the person's other tabs.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    const id = String(body.userId ?? "");
    if (body.action === "unblock") return ok(await unblockUser(u, id));
    const c = body.sessionId ? await db.contract.findUnique({ where: { id: String(body.sessionId) } }) : null;
    const t = body.testId ? await db.test.findUnique({ where: { id: String(body.testId) } }) : null;
    const asTester = c && c.testerId === u.id && c.status === "working" ? c : null;
    const asDev = t && t.developerId === u.id ? t : null;
    if (asTester) await testerGate(u.id, asTester.id, asTester.testId, body);
    if (asDev) await devGateIfSeen(asDev.id, body);
    const r = await blockUser(u, id);
    const other = await db.user.findUnique({ where: { id } });
    const testId = asTester?.testId ?? asDev?.id;
    if (testId && other) await logAction(u.id, testId, body, `blocked ${displayName(other)}`);
    return ok(r);
  });
}
