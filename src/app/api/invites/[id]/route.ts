import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";
import { listingGate } from "@/lib/server/joining";
import { logAction, logEvent } from "@/lib/server/live";
import { displayName } from "@/lib/format";

// The tester answers an invite with "No thanks" (no more reminders).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireActive(req);
    const { id } = await params;
    const body = await readJson(req);
    const inv = await db.invite.findUnique({ where: { id } });
    if (!inv || inv.testerId !== u.id) throw new HttpError(404, "not_found", "That invite doesn't exist.");
    if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "You already joined." : inv.status === "replaced" ? "This invite was replaced by a new one with the current listing." : "This invite is closed.");
    await listingGate(u.id, inv.testId, body, "decline");
    await db.invite.update({ where: { id }, data: { status: "declined" } });
    await logAction(u.id, inv.testId, body, "said no thanks to the invite");
    await logEvent(inv.testId, "invite", `${displayName(u)} said no thanks to your invite`);
    return ok({ ok: true });
  });
}
