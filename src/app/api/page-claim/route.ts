import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { claimPage } from "@/lib/server/pageClaim";

// (Owner, Nov 11, §380) Opening a test page (or its Edit) or a session page claims it for this tab: any older copy is sent to the dashboard.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req, 2_000);
    await claimPage(u.id, String(body.scope ?? ""), typeof body.tab === "string" ? body.tab : "");
    return ok({ claimed: true });
  });
}
