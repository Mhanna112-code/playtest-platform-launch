import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { DEV_SUSPENDED } from "@/lib/server/users";
import { payOwed } from "@/lib/server/holds";
import { requireUser } from "@/lib/server/session";

// "Pay what you owe": retries every failed charge still owed; lifts the payment hold when all are paid.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    // (Owner, Oct 26) "Pay what you owe" exists only during a payment hold: a suspension on its own never offers it.
    if (u.suspendedAt && !u.holdStartedAt) throw new HttpError(403, "suspended", DEV_SUSPENDED, { suspended: true });
    return ok(await payOwed(u, await readJson(req)));
  });
}
