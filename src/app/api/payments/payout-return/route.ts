import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { refreshPayoutStatus } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    const ready = await refreshPayoutStatus(u.id);
    return Response.redirect(`${base}/app/payments?${ready ? "saved=payout" : "pending=payout"}`, 303);
  } catch (e) {
    console.error("[payments] payout return:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=payout`, 303);
  }
}
