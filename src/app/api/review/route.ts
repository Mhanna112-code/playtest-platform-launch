import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { requireActive, requireConfirmed } from "@/lib/server/users";
import { logReview } from "@/lib/server/actionText";
import { maybePromptRating } from "@/lib/server/ratings";
import { db } from "@/lib/db";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // (Owner, Oct 26) A suspended developer can neither Pay nor Reject: both wait until the suspension is lifted (a payment hold only
    // delays the CHARGE; see review()).
    const u = await requireActive(req, { what: body.action === "reject" ? "Reject" : "Pay", piece: { kind: String(body.kind ?? ""), id: String(body.id ?? "") } });
    requireConfirmed(u);
    // A declined Pay is refused under Pay and is not a debt: nothing is logged or shown anywhere else.
    const r = await review(u, body);
    await logReview(u.id, body, r);
    const piece = body.kind === "call" ? await db.call.findUnique({ where: { id: String(body.id) } }) : await db.submission.findUnique({ where: { id: String(body.id) } });
    if (piece) await maybePromptRating(piece.contractId);
    return ok(typeof body.__note === "string" ? { ...r, note: body.__note } : r);
  });
}
