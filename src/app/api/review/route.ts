import { handle, ok, readJson } from "@/lib/server/http";
import { review } from "@/lib/server/payments";
import { requireActive } from "@/lib/server/users";

// Pay or Reject one piece of sent work or a held call.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    return ok(await review(u, await readJson(req)));
  });
}
