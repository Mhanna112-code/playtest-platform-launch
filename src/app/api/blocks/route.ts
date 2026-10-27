import { handle, ok, readJson } from "@/lib/server/http";
import { blockUser, unblockUser } from "@/lib/server/blocks";
import { requireActive } from "@/lib/server/users";

// Block / Unblock (owner, Oct 27): Block lives only on profiles. The one stop is a race check: already blocked in another tab.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    const id = String(body.userId ?? "");
    if (body.action === "unblock") return ok(await unblockUser(u, id));
    return ok(await blockUser(u, id));
  });
}
