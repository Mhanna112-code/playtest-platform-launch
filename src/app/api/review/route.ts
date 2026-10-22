import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { requireActive } from "@/lib/server/users";
import { logReview } from "@/lib/server/actionText";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    const r = await review(u, body);
    await logReview(u.id, body, r);
    return ok(r);
  });
}
