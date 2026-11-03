// Delivers a Stripe event to the 3485 server's /api/stripe/webhook exactly as Stripe sends one: the JSON body with a Stripe-Signature header made with the local
// webhook secret (Stripe's own library makes the header: stripe.webhooks.generateTestHeaderString). The secret and the header are never printed.
/* eslint-disable */
const path = require("path");
const { stripeKeys, WT, PORT } = require("./env.cjs");
const Stripe = require(path.join(WT, "node_modules", "stripe"));
const { sk, whsec } = stripeKeys(); // stops unless the key is a TEST key
const stripe = new Stripe(sk);
async function deliver(event) {
  const payload = JSON.stringify(event, null, 2);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: whsec });
  const r = await fetch(`http://localhost:${PORT}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.text() };
}
/** Stripe's event envelope around an object (a test-mode event: livemode false). */
function envelope(type, object, id = `evt_proof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`) {
  return { id, object: "event", api_version: "2026-09-30.basil", created: Math.floor(Date.now() / 1000), data: { object }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type };
}
module.exports = { deliver, envelope };
if (require.main === module) {
  const ev = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  deliver(ev).then((r) => console.log(JSON.stringify(r)));
}
