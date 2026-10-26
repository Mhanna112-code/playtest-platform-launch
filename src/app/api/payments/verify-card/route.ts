import { handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { startCardVerification } from "@/lib/server/chargeback";

// (Owner, Oct 26) Chargeback hold, step (a): start the 3D Secure card check (a Stripe SetupIntent). With no Stripe in dev it is simulated and succeeds at once.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return ok(await startCardVerification(u));
  });
}
