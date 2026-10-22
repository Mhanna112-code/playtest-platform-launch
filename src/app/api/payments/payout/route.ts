import { appUrl } from "@/lib/server/auth";
import { requireActive } from "@/lib/server/users";
import { payoutSetupUrl, stripeOn } from "@/lib/server/stripe";

// Tester: Stripe Connect Express onboarding.
export async function GET(req: Request) {
  const base = appUrl(req);
  try {
    const u = await requireActive(req);
    if (!stripeOn()) return Response.redirect(`${base}/app/payments?error=off`, 303);
    return Response.redirect(await payoutSetupUrl(u, base), 303);
  } catch (e) {
    console.error("[payments] payout setup:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=payout`, 303);
  }
}
