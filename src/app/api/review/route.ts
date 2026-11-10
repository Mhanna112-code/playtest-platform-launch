import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { requireActive } from "@/lib/server/users";
import { logReview } from "@/lib/server/actionText";
import { maybePromptRating } from "@/lib/server/ratings";
import { db } from "@/lib/db";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const piece0 = { kind: String(body.kind ?? ""), id: String(body.id ?? "") };
    // (Owner, Nov 9, §368; replaces Oct 26 and §172) Pay goes through during a developer suspension and the team's pause of its test, as the tester's Charge does;
    // only a payment or chargeback hold refuses it.
    const u = await requireActive(req, { devSide: true, what: "Pay", piece: piece0, payOk: true });
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
