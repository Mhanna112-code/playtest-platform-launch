import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { cardSetupUrl, stripeOn } from "@/lib/server/stripe";
import { sameOriginForm } from "@/lib/server/http";

// Developer: open Stripe Checkout (setup mode) to save a card. (Batch 15 section 41, L5) Only a POST from this site's own form makes Stripe objects.
export async function GET(req: Request) {
  return Response.redirect(`${appUrl(req)}/app/payments`, 303);
}
export async function POST(req: Request) {
  const base = appUrl(req);
  if (!sameOriginForm(req, base)) return new Response("Forbidden", { status: 403 });
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    if (!stripeOn()) return Response.redirect(`${base}/app/payments?error=off`, 303);
    return Response.redirect(await cardSetupUrl(u, base), 303);
  } catch (e) {
    console.error("[payments] card setup:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
