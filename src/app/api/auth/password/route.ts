import { handle, ok, readJson } from "@/lib/server/http";
import { changePassword } from "@/lib/server/passwords";
import { requireUser } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return ok(await changePassword(u.id, req, await readJson(req)));
  });
}
