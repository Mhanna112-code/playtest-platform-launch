import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";

// The tester answers an invite with "No thanks" (no more reminders).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireActive(req);
    const { id } = await params;
    await readJson(req);
    const inv = await db.invite.findUnique({ where: { id } });
    if (!inv || inv.testerId !== u.id) throw new HttpError(404, "not_found", "That invite doesn't exist.");
    if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "You already joined." : "This invite is closed.");
    await db.invite.update({ where: { id }, data: { status: "declined" } });
    return ok({ ok: true });
  });
}
