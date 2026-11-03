// Runs the app's own server functions against the rec schema with the Stripe TEST key (scripts/payments-proof/appfn.cjs sets the environment):
//   chargeback <paymentIntentId>   holds.chargebackOpened: exactly what Stripe's charge.dispute.created webhook calls (the webhook can't reach localhost)
//   daily                          holds.runDaily (the daily job: expiries, retries of what's owed, ...)
//   expire                         confirm.expireActions (the clock: a 3-day check running out)
//   sweep                          holds.runSweep (the 5-minute sweep: charges waiting for a lift, Charge opening, ...)
//   stripe <userId>                the developer's PaymentIntents at Stripe (amount, status, last_payment_error, created, dispute status)
const [action, arg] = process.argv.slice(2);
const now = new Date();
let r: unknown;
if (action === "chargeback") { const [pi, cents] = arg.split(":"); r = await (await import("@/lib/server/holds")).chargebackOpened(pi, cents ? Number(cents) : null); }
else if (action === "daily") r = await (await import("@/lib/server/holds")).runDaily(now);
else if (action === "expire") r = await (await import("@/lib/server/confirm")).expireActions(now);
else if (action === "sweep") r = await (await import("@/lib/server/holds")).runSweep(now);
else if (action === "stripe") {
  const { db } = await import("@/lib/db");
  const { getStripe } = await import("@/lib/server/stripe");
  const u = await db.user.findUniqueOrThrow({ where: { id: arg } });
  const stripe = getStripe();
  const out: Record<string, unknown>[] = [];
  if (u.stripeCustomerId) {
    for await (const pi of stripe.paymentIntents.list({ customer: u.stripeCustomerId, limit: 100 })) {
      const ch = typeof pi.latest_charge === "string" ? await stripe.charges.retrieve(pi.latest_charge) : null;
      const disputes = (await stripe.disputes.list({ payment_intent: pi.id, limit: 10 })).data;
      const rows = await db.payment.findMany({ where: { OR: [{ stripePaymentIntentId: pi.id }, { actionPi: pi.id }] }, select: { kind: true, status: true, chargeback: true, amountCents: true } });
      out.push({
        id: pi.id, amount: (pi.amount / 100).toFixed(2), status: pi.status, description: pi.description,
        last_payment_error: pi.last_payment_error ? `${pi.last_payment_error.code ?? ""}${pi.last_payment_error.decline_code ? "/" + pi.last_payment_error.decline_code : ""}` : null,
        created: new Date(pi.created * 1000).toISOString(), canceled_at: pi.canceled_at ? new Date(pi.canceled_at * 1000).toISOString() : null, cancellation_reason: pi.cancellation_reason,
        amount_received: (pi.amount_received / 100).toFixed(2), captured: ch?.captured ?? null, card: ch?.payment_method_details?.card?.last4 ?? null,
        stripe_dispute: disputes.length ? disputes.map((d) => d.status).join(",") : (ch?.disputed ? "disputed" : "none"),
        app_rows: rows.map((x) => `${x.kind}:${x.status}${x.chargeback ? ":chargeback=" + x.chargeback : ""}`).join(" "),
      });
    }
  }
  out.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  r = { customer: u.email, count: out.length, succeeded: out.filter((x) => x.status === "succeeded").length, paymentIntents: out };
} else throw new Error("unknown action");
console.log("RESULT " + JSON.stringify(r ?? null));
(await import("@/lib/db")).db.$disconnect();
