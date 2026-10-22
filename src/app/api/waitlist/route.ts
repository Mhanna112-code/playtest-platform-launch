import { handle, ok, readJson } from "@/lib/server/http";
import { joinWaitlist } from "@/lib/server/waitlist";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req, 2000);
    await joinWaitlist(body.email, body.role);
    return ok({ ok: true });
  });
}
