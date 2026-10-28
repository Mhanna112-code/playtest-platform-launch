import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";
import { INVITE_NOT_OPEN, inviteClosedLine, listingGate } from "@/lib/server/joining";
import { logAction, logEvent, seenOf } from "@/lib/server/live";
import { displayName } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { asListing } from "@/lib/server/tests";
import { reinvitedLine } from "@/lib/server/invites";

// The tester answers an invite with "No thanks" (no more reminders).
// (Owner, Oct 28, batch 17 section 4) It follows batch 16 section 32 exactly like Join and Accept: a full test keeps the invite open (No thanks just declines it); a
// closed invite is refused with the section 32 reason and the card goes; an invite re-sent on a new listing stops once (blue) instead of being refused.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireActive(req);
    const { id } = await params;
    const body = await readJson(req);
    let inv = await db.invite.findUnique({ where: { id } });
    if (!inv || inv.testerId !== u.id) throw new HttpError(404, "not_found", "That invite doesn't exist.");
    if (inv.status === "replaced") {
      const fresh = await db.invite.findFirst({ where: { testId: inv.testId, testerId: u.id, status: "sent" }, orderBy: { createdAt: "desc" } });
      // Not sent again (the tester couldn't be invited any more): closed, with the reason.
      if (!fresh) throw new HttpError(409, "invite_closed", await inviteClosedLine(inv.testId));
      // Re-sent: the first press stops once with the new listing; the second (from that box) says no thanks to the new invite.
      const boxAt = seenOf(body.boxAt);
      if (body.confirmed !== true || (boxAt && boxAt < fresh.createdAt)) {
        const t = await db.test.findUniqueOrThrow({ where: { id: inv.testId }, include: { developer: true } });
        throw new HttpError(409, "stop_once", "Press again to go ahead.", {
          changes: [
            { text: reinvitedLine(displayName(t.developer), t.title).replace(/\.$/, ""), at: fresh.createdAt },
            { text: `The new listing: ${termsLine(asListing(t), true)}`, at: fresh.createdAt },
          ],
          tail: "Press again to go ahead.",
          newInviteId: fresh.id,
          alertsOff: !!u.testerAlertsOff, // (batch 17 section 13)
        });
      }
      inv = fresh;
    }
    // (Batch 16 section 32) Closed meanwhile: refused with the reason (never "hold" or "suspended"); the card goes.
    if (inv.status === "cancelled") throw new HttpError(409, "invite_closed", await inviteClosedLine(inv.testId));
    if (inv.status === "joined") throw new HttpError(409, "gone", "You already joined.");
    if (inv.status !== "sent") throw new HttpError(409, "invite_closed", INVITE_NOT_OPEN);
    await listingGate(u.id, inv.testId, body, "decline");
    await db.invite.update({ where: { id: inv.id }, data: { status: "declined" } });
    await logAction(u.id, inv.testId, body, "said no thanks to the invite");
    await logEvent(inv.testId, "invite", `${displayName(u)} said no thanks to your invite`);
    return ok({ ok: true, ...(typeof body.__note === "string" ? { note: body.__note } : {}) });
  });
}
