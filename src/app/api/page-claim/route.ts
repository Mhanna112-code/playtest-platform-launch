import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { claimPage, holdsPage } from "@/lib/server/pageClaim";
import { isScope } from "@/lib/pageClaim";

// (Owner, Nov 11, §380) Opening a one-at-a-time page claims it for this tab: any older copy is sent to the dashboard.
// (§380 J) ... unless the older copy has a press on its way: then `{ claimed: false, waiting: true }`, and the new copy asks again (or "Open now": `now`).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req, 2_000);
    return ok(await claimPage(u.id, String(body.scope ?? ""), typeof body.tab === "string" ? body.tab : "", { now: body.now === true }));
  });
}

// (Owner, Nov 11, §380 K) A one-at-a-time page with no poll of its own asks whether this copy (x-tab) still holds it.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const scope = new URL(req.url).searchParams.get("scope") ?? "";
    const tab = req.headers.get("x-tab") ?? "";
    if (!isScope(scope) || !tab) return ok({});
    return ok((await holdsPage(u.id, scope, tab)) ? {} : { moved: true });
  });
}
