import { chargebackOpened } from "@/lib/server/holds";
import { fakeOn, getStripe } from "@/lib/server/stripe";

// Stripe webhook: a dispute (the developer's bank reversing a payment) opens a chargeback and a payment hold.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || (fakeOn() ? "fake" : "");
  if (!secret) return new Response("Webhooks aren't set up", { status: 503 });
  const raw = await req.text();
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = getStripe().webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret) as unknown as typeof event;
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  if (event.type === "charge.dispute.created") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") await chargebackOpened(pi);
  }
  return Response.json({ received: true });
}
