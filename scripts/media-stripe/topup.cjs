// Test mode only: adds AVAILABLE balance to the platform's test account (a charge with Stripe's test card 4000 0000 0000 0077, which skips the pending period),
// so separate transfers to testers (waiting shares, shares paid on Approve) can go out at once. node topup.cjs [dollars]
const Stripe = require("C:/Users/march/Projects/playtest-lite/node_modules/stripe");
const { stripeKeys } = require("./env.cjs");
const stripe = new Stripe(stripeKeys().sk);
(async () => {
  const cents = Math.round(Number(process.argv[2] || 500) * 100);
  const pi = await stripe.paymentIntents.create({ amount: cents, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: "never" }, description: "Test-mode balance top-up for the Stripe recording", metadata: { recording: "stripe-media" } });
  const b = await stripe.balance.retrieve();
  console.log(pi.status, "available:", b.available.map((x) => `${x.amount / 100} ${x.currency}`).join(", "));
})();
