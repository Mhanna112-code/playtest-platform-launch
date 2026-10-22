import { handle, ok, readJson } from "@/lib/server/http";
import { blockUser, unblockUser } from "@/lib/server/blocks";
import { requireActive } from "@/lib/server/users";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    const id = String(body.userId ?? "");
    return ok(body.action === "unblock" ? await unblockUser(u, id) : await blockUser(u, id));
  });
}
