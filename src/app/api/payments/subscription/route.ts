import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { cancelSubscription, keepSubscription, subscribe } from "@/lib/server/subscription";
import { accountGate, logAccountChange } from "@/lib/server/accountChanges";
import { subscribed } from "@/lib/subscription";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

// (Owner, Oct 28, batch 8) The developer subscription on Payments: subscribe, cancel, keep. Payments stays open during a hold or a suspension
// (Cancel and Keep work then; Subscribe is refused with its own line).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.deletedAt) throw new HttpError(403, "deleted", "This account was deleted.");
    const body = await readJson(req);
    if (!["subscribe", "cancel", "keep"].includes(body.action as string)) throw new HttpError(400, "bad_action", "That action doesn't exist.");
    // (Owner, Oct 28, batch 16 section 27) A repeat of what another tab or device already did is a plain refusal, at once.
    const on = subscribed(u);
    if (body.action === "cancel" && on && u.subscriptionCanceling) throw new HttpError(409, "already", "Your subscription is already cancelled.");
    if (body.action !== "cancel" && on && !u.subscriptionCanceling) throw new HttpError(409, "already", "You're already subscribed.");
    // Otherwise the card, the subscription or the payout account changed elsewhere since this page opened: the first press stops once; the second goes ahead.
    await accountGate(u.id, body, "payments");
    const r = body.action === "subscribe" ? await subscribe(u) : body.action === "cancel" ? await cancelSubscription(u) : await keepSubscription(u);
    // Logged once it's done (a Subscribe still waiting for the bank isn't active yet: nothing to log).
    const now = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const line = body.action === "cancel" ? `Subscription: cancelled, ends ${day(now.subscriptionRenewsAt)}` : now.subscriptionStatus === "active" && !now.subscriptionCanceling ? `Subscription: ${body.action === "keep" ? "kept" : "active"}, renews ${day(now.subscriptionRenewsAt)}` : "";
    if (line) await logAccountChange(u.id, typeof body.tab === "string" ? body.tab : "", { scopes: ["payments"], field: "subscription", label: "Subscription", line });
    return ok(r);
  });
}
