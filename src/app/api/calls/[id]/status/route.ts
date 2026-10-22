import { handle, ok } from "@/lib/server/http";
import { callStatus } from "@/lib/server/blocks";
import { requireUser } from "@/lib/server/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const { id } = await params;
    return ok(await callStatus(u, id));
  });
}
