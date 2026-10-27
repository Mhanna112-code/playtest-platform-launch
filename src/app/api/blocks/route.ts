import { handle, ok, readJson } from "@/lib/server/http";
import { blockUser, unblockUser } from "@/lib/server/blocks";
import { requireActive } from "@/lib/server/users";

// Block / Unblock (owner, Oct 27): Block lives only on profiles. The one stop is a race check: already blocked in another tab.
// A held developer can Unblock (Blocked people stays open); a suspended account can't, and a restricted developer can't Block.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const unblock = body.action === "unblock";
    const u = await requireActive(req, unblock ? {} : { devSide: "auto" });
    const id = String(body.userId ?? "");
    if (unblock) return ok(await unblockUser(u, id));
    return ok(await blockUser(u, id));
  });
}
