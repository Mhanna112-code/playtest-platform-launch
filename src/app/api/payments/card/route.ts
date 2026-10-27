import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { cardSetupUrl, stripeOn } from "@/lib/server/stripe";

// Developer: open Stripe Checkout (setup mode) to save a card.
export async function GET(req: Request) {
  const base = appUrl(req);
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
