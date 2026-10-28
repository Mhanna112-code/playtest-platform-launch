import { handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { latestAccountChange } from "@/lib/server/accountChanges";

// (Owner, Oct 28, batch 16 section 27) Payments, the profile editor and Settings poll this: when the account changed in another tab or device, the page
// refreshes its data silently (no line); the first press afterwards stops once with what changed.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const at = await latestAccountChange(u.id);
    return ok({ latest: at ? at.toISOString() : null });
  });
}
