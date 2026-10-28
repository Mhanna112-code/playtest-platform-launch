import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { requireActive } from "@/lib/server/users";
import { decideExcerpt, removeExcerpt, requestExcerpt } from "@/lib/server/excerpts";

// (Owner, Oct 29, batch 13) Excerpt requests. A NEW request needs an active account (a suspended tester's session pages are closed); Allow, Deny and Remove work for
// anyone signed in, suspended or held included. None of them stops once.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (body.action === "request") return ok(await requestExcerpt(await requireActive(req), body));
    const u = await requireUser(req);
    if (body.action === "decide") return ok(await decideExcerpt(u, body));
    if (body.action === "remove") return ok(await removeExcerpt(u, body));
    throw new HttpError(400, "bad_action", "Unknown action.");
  });
}
