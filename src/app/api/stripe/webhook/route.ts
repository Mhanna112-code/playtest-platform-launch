import { chargebackOpened } from "@/lib/server/holds";
import { fakeOn, getStripe } from "@/lib/server/stripe";
import { payoutFixed, payoutProblem } from "@/lib/server/restrictions";

// Stripe webhook: a dispute (the developer's bank reversing a payment) opens a chargeback and a payment hold.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || (fakeOn() ? "fake" : "");
  if (!secret) return new Response("Webhooks aren't set up", { status: 503 });
  const raw = await req.text();
  let event: { type: string; account?: string; data: { object: Record<string, unknown> } };
  try {
    event = getStripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret) as unknown as typeof event;
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  if (event.type === "charge.dispute.created") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") await chargebackOpened(pi);
  }
  // (Design doc 9) A payout that fails, or a payout account that needs attention: the tester is told (banner + a bell every 3 days).
  const account = event.account ?? (typeof event.data.object.id === "string" && event.type === "account.updated" ? (event.data.object.id as string) : "");
  if (account) {
    if (event.type === "payout.failed") await payoutProblem(account);
    else if (event.type === "payout.paid") await payoutFixed(account);
    else if (event.type === "account.updated") {
      const o = event.data.object;
      if (o.payouts_enabled === false && o.details_submitted === true) await payoutProblem(account);
      else if (o.payouts_enabled === true) await payoutFixed(account);
    }
  }
  return Response.json({ received: true });
}
