import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { pageHandover } from "@/lib/server/pageClaim";

// (Owner, Nov 11, §380 J) The copy holding a one-at-a-time page: its press is over ("done": is a newer copy waiting?), or it hands the page over ("release").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req, 2_000);
    return ok(await pageHandover(u.id, String(body.scope ?? ""), typeof body.tab === "string" ? body.tab : "", body.release === true ? "release" : "done"));
  });
}
