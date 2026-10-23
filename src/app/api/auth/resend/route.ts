import { appUrl } from "@/lib/server/auth";
import { handle, ok, readJson } from "@/lib/server/http";
import { sendVerification } from "@/lib/server/passwords";
import { requireUser } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    await readJson(req);
    return ok(await sendVerification(u.id, appUrl(req)));
  });
}
