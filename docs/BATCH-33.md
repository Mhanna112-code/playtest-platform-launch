# Batch 33: the admin console's links (owner, Oct 30)

This file wins over the earlier batches and the design doc where they differ.

## 1. Every person, test and payment the team reads is a link
- **People:** every developer or tester named anywhere in the admin console and the admin boxes opens their profile (with its admin box): Open disputes (the tester and the developer), Decided disputes, Your actions (the person you suspended or reinstated, as well as the test), Chargeback holds, Payment holds, Lifts, Paused tests (the developer), Payments and Payouts lists (both people), No-show reports (both people), Reports (the reporter and the reported person), Contact messages (the sender, when signed in), Accounts. Show their name with the email after it ("Nora Lane (dev+…@playtest.test)"), the name as the link.
- **Tests:** every test named anywhere opens its page (with its admin box).
- **Payments:** a Stripe id (pi_…, ch_…, tr_…, dp_…) opens that object in the Stripe Dashboard in a new tab (test mode for a test key: https://dashboard.stripe.com/test/payments/<id>; live otherwise; disputes and transfers to their own Dashboard pages).
- **A piece** (written answers, a recording, a call) opens the session's part ("See the work" stays).

## 2. Open disputes say who wrote what
- "Tester: “…” · Developer's note when paying: “…”" becomes "Ana Silva's reason: “…” · Nora Lane's note when paying: “…”" (names as profile links), with the test and the part named above it ("“Harbor Run” · Ana Silva's written answers · paid $10.00").

## 3. A developer's admin box lists their payment failures
- New box "Payment failures (N)" on a developer's admin box, newest first: "$27.50 to Ana Silva for their written answers on “Harbor Run” · failed Thu, Oct 23, 1:16 PM: Your card was declined · paid later on Oct 24" (or "still owed" / "settled by the team"), the person and the test as links.

## 4. Empty boxes
- A box with nothing in it shows only its title with (0): no "None." line under it (admin boxes and admin console lists alike).

## 5. Local test data (not app code)
- On the owner's LOCAL database only (localhost:5499 playtest_lite): one developer-and-tester account with every admin box non-empty (payments made, payouts to them, disputes, chargebacks, holds and suspensions, payment failures, tests posted or joined, reports against them, parts they sent), and two lift requests waiting in the console's Lifts list. Made through the app's own server functions (no hand-written rows that the app couldn't make), throwaway @playtest.test accounts, password the same as the evidence script's test password.
