import { chargebackOpened, chargebackWon } from "@/lib/server/holds";
import { db } from "@/lib/db";
import { payoutReadyOf, verifyWebhook, webhookSecretsSet } from "@/lib/server/stripe";
import { payoutFixed, payoutProblem } from "@/lib/server/restrictions";

// Stripe webhook: a dispute (the developer's bank reversing a payment) opens a chargeback and a payment hold; a dispute the platform won closes it (batch 10).
export async function POST(req: Request) {
  if (!webhookSecretsSet()) return new Response("Webhooks aren't set up", { status: 503 });
  const raw = await req.text();
  // (Batch 15 section 5) Two endpoints share this URL: the platform's (STRIPE_WEBHOOK_SECRET) and Connect's (STRIPE_CONNECT_WEBHOOK_SECRET). Either secret is accepted.
  const verified = verifyWebhook(raw, req.headers.get("stripe-signature") ?? "");
  if (!verified) return new Response("Bad signature", { status: 400 });
  const event = verified as unknown as { type: string; account?: string; data: { object: Record<string, unknown> } };
  // (Batch 8) Stripe Billing: renewals, declined renewals and the end of a developer subscription.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required" || event.type === "customer.subscription.deleted") await (await import("@/lib/server/subscription")).subscriptionWebhook(event.type, event.data.object);
  if (event.type === "charge.dispute.created") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") await chargebackOpened(pi);
  }
  // (Owner, Oct 29, batch 10) A chargeback the platform won: its amount leaves what the developer owes (refunded if they already paid it).
  if (event.type === "charge.dispute.closed" && event.data.object.status === "won") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") await chargebackWon(pi);
  }
  // (Design doc 9) A payout that fails, or a payout account that needs attention: the tester is told (banner + a bell every 3 days).
  const account = event.account ?? (typeof event.data.object.id === "string" && event.type === "account.updated" ? (event.data.object.id as string) : "");
  if (account) {
    if (event.type === "payout.failed") await payoutProblem(account);
    else if (event.type === "payout.paid") await payoutFixed(account);
    else if (event.type === "account.updated") {
      // (Batch 15 section 4) Ready = payouts on and the transfers capability active (the same rule as refreshPayoutStatus).
      const o = event.data.object as Parameters<typeof payoutReadyOf>[0] & { details_submitted?: boolean };
      const ready = payoutReadyOf(o);
      await db.user.updateMany({ where: { stripeAccountId: account }, data: { payoutsReady: ready } });
      if (ready) await payoutFixed(account);
      else if (o.details_submitted === true && o.payouts_enabled === false) await payoutProblem(account);
    }
  }
  return Response.json({ received: true });
}
