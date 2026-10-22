import { appUrl } from "@/lib/server/auth";
import { requireActive } from "@/lib/server/users";
import { cardSetupUrl, stripeOn } from "@/lib/server/stripe";

// Developer: open Stripe Checkout (setup mode) to save a card.
export async function GET(req: Request) {
  const base = appUrl(req);
  try {
    const u = await requireActive(req);
    if (!stripeOn()) return Response.redirect(`${base}/app/payments?error=off`, 303);
    return Response.redirect(await cardSetupUrl(u, base), 303);
  } catch (e) {
    console.error("[payments] card setup:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
