import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { toCents } from "@/lib/format";
import { review } from "@/lib/server/payments";
import { requireActive } from "@/lib/server/users";
import { logReview } from "@/lib/server/actionText";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    try {
      const r = await review(u, body);
      await logReview(u.id, body, r);
      return ok(r);
    } catch (e) {
      // A declined Pay is the developer's own press: their other tabs read it as reason E.
      if (e instanceof HttpError && e.code === "card_failed") await logReview(u.id, body, { amountCents: toCents(body.amount) ?? 0, status: "failed" });
      throw e;
    }
  });
}
