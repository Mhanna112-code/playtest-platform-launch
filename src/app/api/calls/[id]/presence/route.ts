import { handle, ok, readJson } from "@/lib/server/http";
import { heartbeat } from "@/lib/server/calls";
import { requireUser } from "@/lib/server/session";

// (Batch 15 section 40) The call page's heartbeat, every ~10 seconds while it's open: the site measures the minutes both people were there at once.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    await readJson(req);
    const { id } = await params;
    return ok(await heartbeat(u, id));
  });
}
