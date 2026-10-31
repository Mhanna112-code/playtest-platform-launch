import { chargebackOpened, chargebackWon } from "@/lib/server/holds";
import { db } from "@/lib/db";
import { payoutReadyOf, sendWaitingShares, verifyWebhook, webhookSecretsSet } from "@/lib/server/stripe";
import { payoutFixed, payoutProblem } from "@/lib/server/restrictions";

// Stripe webhook: a dispute (the developer's bank reversing a payment) opens a chargeback and a payment hold; a dispute the platform won closes it (batch 10).
export async function POST(req: Request) {
  if (!webhookSecretsSet()) return new Response("Webhooks aren't set up", { status: 503 });
  const raw = await req.text();
  // (Batch 15 section 5) Two endpoints share this URL: the platform's (STRIPE_WEBHOOK_SECRET) and Connect's (STRIPE_CONNECT_WEBHOOK_SECRET). Either secret is accepted.
  const verified = verifyWebhook(raw, req.headers.get("stripe-signature") ?? "");
  if (!verified) return new Response("Bad signature", { status: 400 });
  const event = verified as unknown as Event;
  // (Batch 15 section 41, L3) Stripe can deliver an event twice: each event id is handled once.
  if (typeof event.id === "string" && event.id) {
    const fresh = await db.stripeEvent.create({ data: { id: event.id, type: event.type } }).then(() => true).catch(() => false);
    if (!fresh) return Response.json({ received: true, duplicate: true });
  }
  // (Batch 35 §9) An event this server couldn't act on yet is forgotten again, so Stripe's retry (it retries for up to 3 days) is handled instead of ignored.
  const later = async (why: string) => {
    if (typeof event.id === "string" && event.id) await db.stripeEvent.deleteMany({ where: { id: event.id } });
    return new Response(why, { status: 503 });
  };
  try {
    return await handle(event, later);
  } catch (e) {
    console.error("[stripe] webhook failed:", (e as Error).message);
    return later("Couldn't handle it now; Stripe will retry");
  }
}

type Event = { id?: string; type: string; account?: string; data: { object: Record<string, unknown> } };
async function handle(event: Event, later: (why: string) => Promise<Response>): Promise<Response> {
  // (Batch 35 §9) A dispute can arrive a moment before this server has recorded the payment it is about (seconds in test mode): wait for Stripe's retry.
  const known = async (pi: string) => !!(await db.payment.findFirst({ where: { stripePaymentIntentId: pi }, select: { id: true } }));
  // (Batch 8) Stripe Billing: renewals, declined renewals and the end of a developer subscription.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required" || event.type === "customer.subscription.deleted") await (await import("@/lib/server/subscription")).subscriptionWebhook(event.type, event.data.object);
  if (event.type === "charge.dispute.created") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") {
      if (!(await known(pi))) return later("That payment isn't recorded yet");
      await chargebackOpened(pi);
    }
  }
  // (Owner, Oct 29, batch 10) A chargeback the platform won: its amount leaves what the developer owes (refunded if they already paid it).
  if (event.type === "charge.dispute.closed" && event.data.object.status === "won") {
    const pi = event.data.object.payment_intent;
    if (typeof pi === "string") {
      if (!(await known(pi))) return later("That payment isn't recorded yet");
      await chargebackWon(pi);
    }
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
      // (Batch 22 section 3) The tester's shares that waited for their payout setup go out now (each once).
      if (ready) for (const u of await db.user.findMany({ where: { stripeAccountId: account }, select: { id: true } })) await sendWaitingShares(u.id);
      else if (o.details_submitted === true && o.payouts_enabled === false) await payoutProblem(account);
    }
  }
  return Response.json({ received: true });
}
