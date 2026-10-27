import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { cancelSubscription, keepSubscription, subscribe } from "@/lib/server/subscription";

// (Owner, Oct 28, batch 8) The developer subscription on Payments: subscribe, cancel, keep. Payments stays open during a hold or a suspension
// (Cancel and Keep work then; Subscribe is refused with its own line).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.deletedAt) throw new HttpError(403, "deleted", "This account was deleted.");
    const body = await readJson(req);
    if (body.action === "subscribe") return ok(await subscribe(u));
    if (body.action === "cancel") return ok(await cancelSubscription(u));
    if (body.action === "keep") return ok(await keepSubscription(u));
    throw new HttpError(400, "bad_action", "That action doesn't exist.");
  });
}
