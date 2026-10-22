import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { requireActive } from "@/lib/server/users";
import { logReview } from "@/lib/server/actionText";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    // A declined Pay is refused under Pay and is not a debt: nothing is logged or shown anywhere else.
    const r = await review(u, body);
    await logReview(u.id, body, r);
    return ok(typeof body.__note === "string" ? { ...r, note: body.__note } : r);
  });
}
