import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { payoutSetupUrl, stripeOn } from "@/lib/server/stripe";
import { confirmSkipped } from "@/lib/server/users";
import { sameOriginForm } from "@/lib/server/http";

// Tester: Stripe Connect Express onboarding. (Batch 15 section 41, L5) Only a POST from this site's own form makes Stripe objects; a GET goes back to Payments.
export async function GET(req: Request) {
  return Response.redirect(`${appUrl(req)}/app/payments#payout`, 303);
}
export async function POST(req: Request) {
  const base = appUrl(req);
  if (!sameOriginForm(req, base)) return new Response("Forbidden", { status: 403 });
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    if (!stripeOn()) return Response.redirect(`${base}/app/payments?error=off`, 303);
    // (Batch 15 section 41, H2) Payouts only to a confirmed email address.
    if (!u.emailVerifiedAt && !confirmSkipped()) return Response.redirect(`${base}/app/payments?error=confirm`, 303);
    return Response.redirect(await payoutSetupUrl(u, base), 303);
  } catch (e) {
    console.error("[payments] payout setup:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=payout`, 303);
  }
}
