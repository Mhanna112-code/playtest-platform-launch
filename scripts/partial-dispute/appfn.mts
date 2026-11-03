// Runs the app's own server functions against the rec_dispute schema with the Stripe TEST key (appfn.cjs sets the environment):
//   stripe <userId>          that developer's Stripe objects, listed through the API: every PaymentIntent of their Stripe customer with its charge (amount,
//                            amount_captured, refunds), description, metadata and any disputes (amount, status, reason, evidence due date, Stripe's fee), and
//                            the app's rows pointing at it
//   event <paymentIntentId>  the real charge.dispute.created event Stripe sent for that PaymentIntent (from Stripe's event list), or null
//   pagelines <userId>       that developer's What you've paid rows as the page reads them (line, hover), with their PaymentIntent and stored description
//   expire                   confirm.expireActions (the clock: a 3-day "Confirm with your bank" running out)
const [action, arg] = process.argv.slice(2);
const now = new Date();
let r: unknown;
const usd = (c: number | null | undefined) => (c == null ? null : (c / 100).toFixed(2));
if (action === "expire") r = await (await import("@/lib/server/confirm")).expireActions(now);
else if (action === "event") {
  const { getStripe } = await import("@/lib/server/stripe");
  const stripe = getStripe();
  let found: unknown = null;
  for await (const ev of stripe.events.list({ type: "charge.dispute.created", limit: 100, created: { gte: Math.floor(now.getTime() / 1000) - 6 * 3600 } })) {
    const o = ev.data.object as { payment_intent?: string | { id: string } | null };
    const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id;
    if (pi === arg) { found = ev; break; }
  }
  r = found;
} else if (action === "pagelines") {
  // That developer's "What you've paid" rows, read the way the page reads them (the same query and paymentRows.paidRows): the line shown, its hover (names uncut),
  // the PaymentIntent and the description it was charged with.
  const { db } = await import("@/lib/db");
  const { paidRows, plainLabel } = await import("@/lib/server/paymentRows");
  const ps = await db.payment.findMany({ where: { developerId: arg, OR: [{ status: { in: ["charged", "not_set_up"] } }, { status: "refunded", kind: "chargeback" }] }, orderBy: { createdAt: "desc" }, take: 500 });
  const rows = await paidRows(ps, "developer");
  r = ps.map((p) => { const x = rows.get(p.id); return { id: p.id, kind: p.kind, status: p.status, amount: usd(p.amountCents), pi: p.stripePaymentIntentId, page: x ? `${x.what}${x.how ? `, ${x.how}` : ""}` : plainLabel(p.kind), hover: x ? `${x.full}${x.how ? `, ${x.how}` : ""}` : null, stripeDescription: p.stripeDescription }; });
} else if (action === "stripe") {
  const { db } = await import("@/lib/db");
  const { getStripe } = await import("@/lib/server/stripe");
  const u = await db.user.findUniqueOrThrow({ where: { id: arg } });
  const stripe = getStripe();
  const out: Record<string, unknown>[] = [];
  if (u.stripeCustomerId) {
    for await (const pi of stripe.paymentIntents.list({ customer: u.stripeCustomerId, limit: 100, expand: ["data.latest_charge"] })) {
      const ch = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
      const refunds = ch ? (await stripe.refunds.list({ charge: ch.id, limit: 20 })).data : [];
      const disputes = (await stripe.disputes.list({ payment_intent: pi.id, limit: 10, expand: ["data.balance_transactions"] })).data;
      const rows = await db.payment.findMany({ where: { OR: [{ stripePaymentIntentId: pi.id }, { actionPi: pi.id }] }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, amountCents: true, chargeback: true, reversedCents: true, coveredById: true, repaysId: true } });
      const reservations = await db.reservation.findMany({ where: { stripePaymentIntentId: pi.id }, select: { id: true, status: true, amountCents: true } });
      out.push({
        id: pi.id, amount: usd(pi.amount), amount_received: usd(pi.amount_received), amount_capturable: usd(pi.amount_capturable), status: pi.status, capture_method: pi.capture_method,
        description: pi.description, metadata: pi.metadata, created: new Date(pi.created * 1000).toISOString(),
        last_payment_error: pi.last_payment_error ? `${pi.last_payment_error.code ?? ""}${pi.last_payment_error.decline_code ? "/" + pi.last_payment_error.decline_code : ""}` : null,
        charge: ch && {
          id: ch.id, amount: usd(ch.amount), amount_captured: usd(ch.amount_captured), amount_refunded: usd(ch.amount_refunded), captured: ch.captured, refunded: ch.refunded, disputed: ch.disputed,
          status: ch.status, card: ch.payment_method_details?.card ? `${ch.payment_method_details.card.brand} •••• ${ch.payment_method_details.card.last4}` : null,
          refunds: refunds.map((x) => ({ id: x.id, amount: usd(x.amount), status: x.status, created: new Date(x.created * 1000).toISOString() })),
        },
        disputes: disputes.map((d) => ({
          id: d.id, amount: usd(d.amount), status: d.status, reason: d.reason, created: new Date(d.created * 1000).toISOString(),
          evidence_due_by: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
          stripe_fee: usd(d.balance_transactions.reduce((a, b) => a + (typeof b === "object" ? b.fee : 0), 0)),
          net: usd(d.balance_transactions.reduce((a, b) => a + (typeof b === "object" ? b.net : 0), 0)),
        })),
        app_rows: rows.map((x) => ({ id: x.id, kind: x.kind, status: x.status, amount: usd(x.amountCents), chargeback: x.chargeback || null, reversed: usd(x.reversedCents), covered_by: x.coveredById, repays: x.repaysId })),
        app_reservations: reservations.map((x) => ({ id: x.id, status: x.status, amount: usd(x.amountCents) })),
      });
    }
  }
  out.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  r = { customer: u.email, stripe_customer: u.stripeCustomerId, at: now.toISOString(), count: out.length, paymentIntents: out };
} else throw new Error("unknown action");
console.log("RESULT " + JSON.stringify(r ?? null));
(await import("@/lib/db")).db.$disconnect();
