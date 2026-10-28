import { handle, ok, readJson } from "@/lib/server/http";
import { joinWaitlist } from "@/lib/server/waitlist";
import { clientIp, networkLimit } from "@/lib/server/passwords";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req, 2000);
    // (Batch 15 section 41, L2) At most 5 sign-ups to the waitlist per network an hour.
    await networkLimit("waitlist", clientIp(req), 5, 3_600_000, "Too many sign-ups from here. Try again in an hour.");
    await joinWaitlist(body.email, body.role);
    return ok({ ok: true });
  });
}
