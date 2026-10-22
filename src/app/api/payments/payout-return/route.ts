import { appUrl } from "@/lib/server/auth";
import { requireActive } from "@/lib/server/users";
import { refreshPayoutStatus } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  try {
    const u = await requireActive(req);
    const ready = await refreshPayoutStatus(u.id);
    return Response.redirect(`${base}/app/payments?${ready ? "saved=payout" : "pending=payout"}`, 303);
  } catch (e) {
    console.error("[payments] payout return:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=payout`, 303);
  }
}
