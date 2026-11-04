import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { failedLine, requireActive } from "@/lib/server/users";
import { refuseTeamPaused } from "@/lib/server/teamPause";
import { logReview } from "@/lib/server/actionText";
import { maybePromptRating } from "@/lib/server/ratings";
import { db } from "@/lib/db";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // (Owner, Oct 26) A suspended developer can neither Pay nor Reject: both wait until the suspension is lifted (a payment hold only
    // delays the CHARGE; see review()).
    const piece0 = { kind: String(body.kind ?? ""), id: String(body.id ?? "") };
    const u = await requireActive(req, { devSide: true, what: "Pay", piece: piece0 });
    // (Owner, Nov 4, §172) The team paused this piece's test: Pay waits for the lift, exactly as under a suspension, and the press goes back to the test, whose banner
    // names it (a team pause's refusal; a suspension's goes to the dashboard top).
    const where = piece0.kind === "call" ? await db.call.findUnique({ where: { id: piece0.id }, select: { contractId: true, contract: { select: { test: { select: { developerId: true } } } } } }) : await db.submission.findUnique({ where: { id: piece0.id }, select: { contractId: true, contract: { select: { test: { select: { developerId: true } } } } } });
    if (where && where.contract.test.developerId === u.id) await refuseTeamPaused(db, where.contractId, "Pay", { failed: await failedLine(req, "Pay", piece0) });
    // A declined Pay is refused under Pay and is not a debt: nothing is logged or shown anywhere else.
    const r = await review(u, body);
    // (Batch 11) The bank wants the developer to confirm: the page shows its pop-up, then /api/payments/confirm finishes it.
    if ("requiresAction" in r) return ok(r);
    await logReview(u.id, body, r);
    const piece = body.kind === "call" ? await db.call.findUnique({ where: { id: String(body.id) } }) : await db.submission.findUnique({ where: { id: String(body.id) } });
    if (piece) await maybePromptRating(piece.contractId);
    return ok(typeof body.__note === "string" ? { ...r, note: body.__note } : r);
  });
}
