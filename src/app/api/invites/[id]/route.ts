import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";
import { inviteClosedLine, listingGate } from "@/lib/server/joining";
import { logAction, logEvent } from "@/lib/server/live";
import { displayName, fmtTime } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { asListing } from "@/lib/server/tests";

// The tester answers an invite with "No thanks" (no more reminders).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireActive(req);
    const { id } = await params;
    const body = await readJson(req);
    const inv = await db.invite.findUnique({ where: { id } });
    if (!inv || inv.testerId !== u.id) throw new HttpError(404, "not_found", "That invite doesn't exist.");
    if (inv.status === "replaced") {
      const t = await db.test.findUniqueOrThrow({ where: { id: inv.testId }, include: { developer: true } });
      const fresh = await db.invite.findFirst({ where: { testId: inv.testId, testerId: u.id, status: "sent" } });
      throw new HttpError(409, "gone", fresh ? `${displayName(t.developer)} changed the listing at ${fmtTime(inv.updatedAt)} and sent you a new invite: ${termsLine(asListing(t), true)}.` : `${displayName(t.developer)} changed the listing at ${fmtTime(inv.updatedAt)}, and this invite closed.`, fresh ? { newInviteId: fresh.id } : {});
    }
    // (Batch 16 section 32) Closed meanwhile: refused with the reason (never "hold" or "suspended"); the card goes.
    if (inv.status === "cancelled") throw new HttpError(409, "invite_closed", await inviteClosedLine(inv.testId));
    if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "You already joined." : inv.status === "closed_full" ? "This invite closed: the test filled up." : "This invite is closed.");
    await listingGate(u.id, inv.testId, body, "decline");
    await db.invite.update({ where: { id }, data: { status: "declined" } });
    await logAction(u.id, inv.testId, body, "said no thanks to the invite");
    await logEvent(inv.testId, "invite", `${displayName(u)} said no thanks to your invite`);
    return ok({ ok: true, ...(typeof body.__note === "string" ? { note: body.__note } : {}) });
  });
}
