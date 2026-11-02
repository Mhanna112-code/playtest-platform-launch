import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { DEV_SUSPENDED } from "@/lib/server/users";
import { payOwed } from "@/lib/server/holds";
import { requireUser } from "@/lib/server/session";

// "Pay what you owe": retries every failed charge still owed; lifts the payment hold when all are paid.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    // (Owner, Oct 26) "Pay what you owe" exists only during a payment hold: a suspension on its own never offers it.
    if (u.devSuspendedAt && !u.holdStartedAt) throw new HttpError(403, "suspended", DEV_SUSPENDED, { suspended: true });
    const body = await readJson(req);
    // (Owner, Nov 2, batch 35 §117 rule 3) "Cancel this check" next to a debt waiting for the bank: cancelled at Stripe, payable at once.
    if (typeof body.cancelCheck === "string") return ok(await (await import("@/lib/server/owedOnce")).cancelOwedCheck(u.id, body.cancelCheck));
    return ok(await payOwed(u, body));
  });
}
