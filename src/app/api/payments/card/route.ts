import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { cardSetupUrl, isPaymentsOff, paymentsOff, stripeOn } from "@/lib/server/stripe";
import { sameOriginForm } from "@/lib/server/http";
import { formGate } from "@/lib/server/accountChanges";
import { cardAttempt } from "@/lib/server/cardLimits";
import { HttpError } from "@/lib/server/http";
import { clientIp } from "@/lib/server/passwords";

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
    // (Owner, Oct 28, batch 16 section 27) Changed in another tab or device since the page opened: back to Payments with the box under this button.
    const form = await req.formData().catch(() => new FormData());
    const back = await formGate(u.id, form, "card", base);
    if (back) return Response.redirect(back, 303);
    // (Owner, Nov 3, §157) This press's time (the page's, or the stop box's when pressed again) and tab go with the checkout: a card another tab saves meanwhile
    // stops this one's return once (saveCardFromCheckout).
    const field = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : "");
    const press = { since: form.get("confirmed") === "1" ? field("boxAt") : field("seenAt"), tab: field("tab") };
    // (§130) Live keys while payments are switched off: its own line, and not a card attempt.
    if (paymentsOff()) return Response.redirect(`${base}/app/payments?error=paused#card`, 303);
    // (Owner, Nov 2, batch 35 §127) Starting a card save is a card attempt (5 per account, 15 per network a day): over it, back to Payments with the line under this button.
    await cardAttempt(u.id, clientIp(req));
    return Response.redirect(await cardSetupUrl(u, base, press), 303);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return Response.redirect(`${base}/app/payments?error=card_limit#card`, 303);
    if (isPaymentsOff(e)) return Response.redirect(`${base}/app/payments?error=paused#card`, 303);
    console.error("[payments] card setup:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
