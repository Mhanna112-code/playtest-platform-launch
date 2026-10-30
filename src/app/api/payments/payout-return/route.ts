import { db } from "@/lib/db";
import { hasSide } from "@/lib/sides";
import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { refreshPayoutStatus } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    // (Owner's finding, Oct 30, batch 32 §17) Back from Stripe on the tester side: a tester page in another tab may have changed the side used last.
    if (hasSide(u, "tester") && u.side !== "tester") await db.user.update({ where: { id: u.id }, data: { side: "tester" } });
    const ready = await refreshPayoutStatus(u.id);
    return Response.redirect(`${base}/app/payments?${ready ? "saved=payout" : "pending=payout"}`, 303);
  } catch (e) {
    console.error("[payments] payout return:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=payout`, 303);
  }
}
