import { handle, ok, readJson } from "@/lib/server/http";
import { reportPerson } from "@/lib/server/reports";
import { requireActive } from "@/lib/server/users";

// Report a person (once per pair, ever), from their profile.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req, { devSide: "auto" });
    return ok(await reportPerson(u, await readJson(req)));
  });
}
