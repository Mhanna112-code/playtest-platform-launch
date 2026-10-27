import { handle, ok, readJson } from "@/lib/server/http";
import { createTest } from "@/lib/server/tests";
import { requireActive, requireConfirmed } from "@/lib/server/users";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req, { devSide: true, what: "Post" });
    requireConfirmed(u);
    const t = await createTest(u, await readJson(req));
    return ok({ id: t.id });
  });
}
