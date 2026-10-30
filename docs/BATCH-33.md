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

## 6. The admin console shows only these sections (owner, Oct 30)
- In this order, and nothing else: 1. Chargeback holds (the very top, under the header); 2. Your actions; 3. Tests you paused (only tests paused by THIS admin, still paused, each with Lift the pause); 4. Suspensions (accounts suspended now, developer or tester side, each with Reinstate as today); 5. Outages, in a scroll box like the other lists; 6. Open disputes; 7. Payment holds; 8. Reports; 9. Lifts; 10. No-show reports; 11. Contact us; 12. Settings: the "Settings to fix" box, with the emails-not-sending and storage warnings folded into it (only when there is something to show; nothing when all is well).
- Removed from the console: the totals tiles, Decided disputes, the all-tests Paused tests list, the Payments and Payouts lists, the Accounts and Tests lists, and anything else not listed. The header row stays exactly as it is. Server code still used elsewhere (the person and test admin boxes, the daily admin email) stays.

## 7. Admin pages follow other admins' changes live (owner, Oct 30)
- A profile's admin box (the suspended sides with Reinstate, Suspend, Delete, the $0 close-out) and the console's lists poll like the app's other live pages, with a fingerprint of that account's suspension and deletion state (on a profile) and of the lists' newest rows and every admin's latest action (on the console). When another admin changed something they redraw without losing what this admin has typed (the Why boxes, the side choice). A press made before the redraw still gets today's refusal naming who and when.
- (Fix) No <div> inside a <p> on the admin rows: a suspended side's line, Delete and the rows' button lines are <div>s (the buttons' mistake lists are <div>s; React warned of a hydration error).
