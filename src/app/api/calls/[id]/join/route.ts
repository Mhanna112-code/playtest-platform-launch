import { handle, ok, readJson } from "@/lib/server/http";
import { joinCall } from "@/lib/server/blocks";
import { requireUser } from "@/lib/server/session";

// Join call: returns the room link, or the refusal line shown under the Join button.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req);
    const { id } = await params;
    return ok(await joinCall(u, id, body)); // (§271) with the page's load time: a pause or lift since then stops Join once
  });
}
