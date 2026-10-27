import { handle, ok, readJson } from "@/lib/server/http";
import { requireActive, saveProfile } from "@/lib/server/users";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req, { devSide: "auto" });
    const user = await saveProfile(u.id, await readJson(req));
    return ok({ ok: true, isDeveloper: user.isDeveloper, isTester: user.isTester });
  });
}
