import { handle, ok, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";
import { sendDirect } from "@/lib/server/directMessages";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireActive(req, { devSide: "auto", what: "Send" });
    const { id } = await params;
    const body = await readJson(req);
    return ok(await sendDirect(u.id, id, body.body, body.clientId));
  });
}
