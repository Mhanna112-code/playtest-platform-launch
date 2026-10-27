import { handle, ok, readJson } from "@/lib/server/http";
import { openTesterChat } from "@/lib/server/messages";
import { requireUser } from "@/lib/server/session";

// "Chat with <name>" (developer side): checks that the chat can open, then the page goes to the per-test chat.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return ok(await openTesterChat(u, await readJson(req)));
  });
}
