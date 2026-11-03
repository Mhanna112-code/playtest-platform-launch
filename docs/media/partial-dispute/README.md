# Partial dispute proof (§133, Nov 3)

A bank can dispute **part** of a card payment, for example $96 of a $444.67 "Pay what you owe" payment. Stripe then takes back only the $96, plus its $15
dispute fee. This proof shows playtest-lite doing that against **Stripe TEST mode**: the developer owes $96 + one $15 fee, not the whole payment, and the testers'
earnings don't move. It also shows a whole (full) dispute working as before. The same run shows the §133 addition: every PaymentIntent's description reads like
its line on the developer's Payments page.

Code: commits `21ddde4c` (§133) and `6b87c40c` (the descriptions) on `feat/partial-dispute`. Tests: `tests/partial-dispute.test.ts` and
`tests/stripe-descriptions.test.ts`.

## How it was run

- **Server.** A separate dev server on port 3485, run from the `pl-dispute` worktree, using the `rec_dispute` schema of the local 5499 database (migrations
  applied there only). Stripe keys come from `.env` and were checked to be `sk_test_`/`pk_test_`; no key or secret was printed.
- **No real email.** Every email went to the dev outbox (`/dev/outbox`). The only admin was the throwaway `rec+pdadmin@playtest.test`.
- **Harness.** `scripts/partial-dispute/` contains:
  - `serve.cjs`, the server;
  - `run.cjs`, the steps;
  - `webhook.cjs`, which signs and delivers events;
  - `appfn.mts`, which lists Stripe objects through the API.
- **Accounts.** Throwaway accounts `rec+pd…@playtest.test`. The browser is Chrome, driven by Playwright.
- **Real payments.** Every payment below is a real test-mode PaymentIntent made through the app's own routes: Pay (`/api/review`), the tester's Charge
  (`/api/sessions/…/choose`), the Pay what you owe button, Verify a card, the reservation, and the admin's Approve.
- **Cards** (entered on Stripe's own Checkout page):
  - 4242 4242 4242 4242: plain.
  - 4000 0027 6000 3184: the bank asks every time (3D Secure). Its test page was completed in the browser.
  - 4000 0000 0000 0259: the charge goes through, then the bank disputes the WHOLE amount.
  - Verify a card used Stripe's test card `pm_card_authenticationRequired` (the 3184 card) with its 3D Secure page.
- **Webhooks.** Stripe's webhooks can't reach this local server. Instead, each event was posted to `http://localhost:3485/api/stripe/webhook` exactly as Stripe
  sends one: the event JSON with a `Stripe-Signature` header made with the local webhook secret, by Stripe's own library
  (`stripe.webhooks.generateTestHeaderString`). The server checked the signature as usual.
  - **Step A (full dispute):** the event is Stripe's **real** event (`evt_1UXc1dAwolF8enxCQWfyFh8U`), read back from Stripe's API.
  - **Steps D to G (partial):** Stripe test mode can't open a PARTIAL dispute (card 0259 always disputes the whole amount). So the partial
    `charge.dispute.created` (and the later `charge.dispute.updated` and `charge.dispute.closed`) were built from the real event's dispute object, with the real
    PaymentIntent and charge ids of the combined payment and `amount: 9600`. Because Stripe never saw these three, its listing shows **no dispute** on that
    PaymentIntent.
- **Moved time.**
  - Cid's work was dated 15 days back so his Charge could open.
  - His bank check's 3 days were made to run out (its `actionBy` moved, then the app's clock, `confirm.expireActions`).
  - Both changes were made in the `rec_dispute` schema only.
- **Testers have no payout account**, so their shares read "delayed until your payout account is ready" and nothing was transferred.
- **Runs.**
  - Step A comes from the first run.
  - The second run stopped at a screenshot (a wrong page selector in the harness). Its leftover $111.00 reservation was released through the admin's
    "Don't approve: release the reservation", which cancelled it at Stripe.
  - Steps B to H are the third run. Every id below is from these runs.

Each step's files:
- `<step>.png`: screenshots;
- `<step>.stripe.json` / `<step>.stripe.md`: the Stripe objects for that developer's Stripe customer, listed through the API. Each PaymentIntent has its
  id, amount, received, status, description and metadata; its charge (amount, captured, refunded, refunds); any disputes (amount, status, reason, Stripe's fee,
  evidence due date); and the app's rows pointing at it.
- `results.json`: the run's notes and lines;
- `made.json`: every file with its caption.

## Step by step

### A. A full dispute, for real (card 0259): unchanged

Fred Ortiz (card ending 0259) pays Eve Park $50.00 for her written answers on “Sky Harbor”. Stripe opens a dispute on that payment by itself.

| | Stripe ([A2-full-owed.stripe.md](A2-full-owed.stripe.md)) | The app |
|---|---|---|
| Payment | `pi_3UXc1bAwolF8enxC4ve6xZYy` $50.00, succeeded; charge `ch_3UXc1bAwolF8enxC4vJIQrPs`, $50.00 captured, disputed | Fred's What you've paid: "Eve Park's written answers on “Sky Harbor”" $50.00 ([A1-paid-0259.png](A1-paid-0259.png)) |
| Description | "Playtest: Eve Park's written answers on “Sky Harbor”" | the same line, without "Playtest: " |
| Dispute | `du_1UXc1bAwolF8enxC7S2e7Tr5`: **$50.00**, needs_response, fraudulent, evidence due Nov 11, 2026 23:59 UTC, Stripe's fee **$15.00**, net **−$65.00** | owed: "Your bank reversed $50 you paid for Eve Park's written answers on “Sky Harbor” (Nov 3): $50 + $15 chargeback fee", Pay what you owe **$65.00** ([A2-full-owed.png](A2-full-owed.png)) |
| Admin | — | "Chargeback open: $50.00 · pi_3UXc1bAwolF8enxC4ve6xZYy", "$65.00 owed" ([A3-admin-row-full.png](A3-admin-row-full.png)); email "Playtest: new chargeback of $50.00" |

- **How they match:** the same PaymentIntent id. Stripe's disputed amount ($50.00) is the amount owed. Stripe's $15 fee is the app's $15 chargeback fee.
  Stripe's net −$65.00 is what the developer owes, $65.00.
- **A second delivery:** the real event delivered a second time answered `{"received":true,"duplicate":true}` and changed nothing.
- The real event is saved in [A2-real-event.json](A2-real-event.json).

### B. Dana pays two pieces (card 4242)

Dana Reyes pays Ana Silva and Ben Okafor $244.67 each for their written answers on “Harbor Run” ([B1-two-paid.png](B1-two-paid.png): total $489.34).
Stripe ([B1-two-paid.stripe.md](B1-two-paid.stripe.md)): `pi_3UXcAOAwolF8enxC0yKq1x7s` and `pi_3UXcAPAwolF8enxC3bjRGjbO`, $244.67 each, succeeded.

### C. A payment hold, then ONE combined Pay what you owe payment

1. Dana changes her card to 3184.
2. Cid Moreau presses Charge $244.67. The bank wants Dana to confirm it, so it becomes a "Confirm with your bank" item. Its 3 days run out: it's a declined
   payment, and a payment hold starts. Stripe: `pi_3UXcAtAwolF8enxC41AgK19a` $244.67, **canceled**, $0 received.
3. During the hold, Dee Lin presses Charge $200.00. It waits for the lift and rides along with what's owed (no PaymentIntent yet).
4. The owed box lists both: $244.67 + $200.00 = **$444.67** ([C1-hold-owed.png](C1-hold-owed.png)).
5. Dana presses **Pay what you owe** and completes the bank's 3D Secure test page. Stripe makes **one** PaymentIntent:
   - `pi_3UXcBDAwolF8enxC07pdqlgP`: **$444.67**, succeeded; charge `ch_3UXcBDAwolF8enxC0rLzn9De`;
   - description "Playtest: What you owe (Cid Moreau's written answers on “Harbor Run” $244.67, Dee Lin's written answers on “Harbor Run” $200.00)";
   - metadata `payKey=owedall:<the one payment's id>` ([C2-one-payment.stripe.md](C2-one-payment.stripe.md)).
6. The app records that one payment (`owed bundled $444.67`) and both pieces as paid by it. The hold lifts.
7. What you've paid lists Cid's and Dee's pieces "paid through Pay what you owe" (total $934.01, [C2-one-payment.png](C2-one-payment.png)).
8. The testers see their earnings: Cid "you get $195.74", Dee "you get $160.00" ([C3-tester-cid.png](C3-tester-cid.png), [C3-tester-dee.png](C3-tester-dee.png)).

### D. The bank disputes $96 of the $444.67

A `charge.dispute.created` (`evt_proof_1793691080133_6p94f5`, dispute `dp_proof_ed38616f636a`) is delivered for `pi_3UXcBDAwolF8enxC07pdqlgP` and charge
`ch_3UXcBDAwolF8enxC0rLzn9De`, with `amount: 9600` ([D1-partial-event.json](D1-partial-event.json)). The server answered 200. The same event again answered
`duplicate` and changed nothing.

- **Dana's Payments** ([D1-partial-owed.png](D1-partial-owed.png), close-up [D1-partial-owed-box.png](D1-partial-owed-box.png)):
  - the chargeback steps ask for **$111.00**;
  - the owed line reads **"Your bank reversed $96 of your $444.67 payment: $96 + $15 chargeback fee"**;
  - under it, "That payment covered:" lists Cid's $244.67 and Dee's $200.00. The bank gives only an amount, so none is named as the disputed one;
  - Pay what you owe ($111.00).
- **What you've paid** ([D2-partial-paid-list.png](D2-partial-paid-list.png)): the pieces stay paid, and the total drops by exactly the $96 the bank took back,
  from $934.01 to **$838.01**.
- **The admin:**
  - the row reads **"Chargeback open: $96.00 of a $444.67 payment · pi_3UXcBDAwolF8enxC07pdqlgP"**, "$111.00 owed" ([D3-admin-row-partial.png](D3-admin-row-partial.png));
  - the email reads **"Playtest: new chargeback of $96.00"** / "A developer's bank reversed $96.00 of a $444.67 payment (pi_3UXcBDAwolF8enxC07pdqlgP)…"
    ([D4-admin-email.png](D4-admin-email.png)).
- **The testers:** their Payments are unchanged ([D5-tester-cid.png](D5-tester-cid.png), [D5-tester-dee.png](D5-tester-dee.png)).
- **Stripe** ([D6-partial.stripe.md](D6-partial.stripe.md)): the $444.67 payment is still succeeded, with no dispute. This event was delivered to the app, not
  made at Stripe (see "How it was run").
- **How they match:** the event names the same PaymentIntent and charge as Stripe's listing. 9600 cents is $96. $96 + $15 = $111.00 owed, against the whole
  $444.67 + $15 the code asked for before §133.

### E. Stripe changes the disputed amount (`charge.dispute.updated`)

- **Changed to 12000 while nothing is repaid:** followed. The box reads "Your bank reversed $120 of your $444.67 payment: $120 + $15 chargeback fee", Pay what
  you owe ($135.00) ([E1-followed.png](E1-followed.png)).
- **Changed back to 9600:** followed, $111.00 again.

### F. The chargeback steps: verify, reserve $111, the team's Approve

1. **Verify a card:** a 3D Secure check, completed.
2. **Pay what you owe reserves $111.00** (the bank's page completed). At Stripe it is `pi_3UXcCYAwolF8enxC2vG4uplO`: $111.00, **requires_capture** (the
   Dashboard's "Uncaptured"), manual capture.
   - Its description: "Playtest: Reserved for the team's review: Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee) $111.00".
   - Its metadata: `purpose=chargeback-reserve`, `reservationId` ([F1-reserved.png](F1-reserved.png), [F1-reserved.stripe.md](F1-reserved.stripe.md)).
3. **A `charge.dispute.updated` to 5000 arrives after the reservation:** NOT followed (it's reserved), so the amount stays $96. It's logged for the admins:
   - the email "Playtest: a chargeback's amount changed ($96.00 to $50.00)";
   - Dana's Chargebacks box in the admin console lists all three amount changes ([F2-admin-log.png](F2-admin-log.png)).
4. **The admin's row:** "card verified ✓, owed reserved ✓ ($111.00 reserved)" ([F3-admin-approve.png](F3-admin-approve.png)).
5. **Approve** answered `{"ok":true,"lifted":true,"takenCents":11100}`. Stripe captured **$111.00**: charge `ch_3UXcCYAwolF8enxC2uilMLN5` $111.00 captured
   ([F4-repaid.stripe.md](F4-repaid.stripe.md)).
6. **What you've paid** ([F4-repaid.png](F4-repaid.png)):
   - the repayment row reads **"Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)"** · $111.00;
   - the total is **$949.01**: $934.01 − $96 + $111.
7. **The testers:** still unchanged ([F5-tester-cid.png](F5-tester-cid.png), [F5-tester-dee.png](F5-tester-dee.png)).

### G. The platform wins it: exactly what was repaid is refunded

A `charge.dispute.closed` with `status: won` was delivered. Stripe made refund `re_3UXcCYAwolF8enxC2RnbjyLU` of **$111.00** (succeeded) on the reservation's
charge `ch_3UXcCYAwolF8enxC2uilMLN5`. That is exactly the $96 + $15 that was repaid ([G1-won.stripe.md](G1-won.stripe.md)).

What you've paid ([G1-won.png](G1-won.png)):
- the repayment reads "· refunded (your bank's chargeback was reversed)";
- the total is **$934.01** again (the whole $444.67 counts).

### H. Each description next to its Payments row ([H1-descriptions.json](H1-descriptions.json))

| PaymentIntent | Stripe: amount, status | Stripe's description | The app's What you've paid row for the same payment |
|---|---|---|---|
| `pi_3UXc1bAwolF8enxC4ve6xZYy` | $50.00 succeeded | Playtest: Eve Park's written answers on “Sky Harbor” | Eve Park's written answers on “Sky Harbor” (Fred) |
| `pi_3UXcAOAwolF8enxC0yKq1x7s` | $244.67 succeeded | Playtest: Ana Silva's written answers on “Harbor Run” | Ana Silva's written answers on “Harbor Run” |
| `pi_3UXcAPAwolF8enxC3bjRGjbO` | $244.67 succeeded | Playtest: Ben Okafor's written answers on “Harbor Run” | Ben Okafor's written answers on “Harbor Run” |
| `pi_3UXcAtAwolF8enxC41AgK19a` | $244.67 canceled | Playtest: Cid Moreau's written answers on “Harbor Run”, charged by Cid Moreau after 7 days without a review | (its bank check ran out; the piece was then paid by the payment below) |
| `pi_3UXcBDAwolF8enxC07pdqlgP` | $444.67 succeeded | Playtest: What you owe (Cid Moreau's written answers on “Harbor Run” $244.67, Dee Lin's written answers on “Harbor Run” $200.00) | Cid Moreau's written answers on “Harbor Run”, paid through Pay what you owe · Dee Lin's written answers on “Harbor Run”, paid through Pay what you owe |
| `pi_3UXcCYAwolF8enxC2vG4uplO` | $111.00 captured, refunded | Playtest: Reserved for the team's review: Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee) $111.00 | Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee) |

The names here are short, so the page shows them whole. Longer names are cut on the page ("chargechar…") with the whole name on hover, and Stripe always gets
the whole name (`tests/stripe-descriptions.test.ts`).

## How to check charges in Stripe

- **Test or live.** The Stripe Dashboard (dashboard.stripe.com) shows one mode at a time.
  - Everything here was made in **test mode**: switch the Dashboard to test mode ("Test mode" switch at the top right; on newer accounts, the account menu at
    the top left lists the test environment).
  - Test pages have `/test/` in their address, e.g. `https://dashboard.stripe.com/test/payments/pi_3UXcBDAwolF8enxC07pdqlgP`.
  - The hosted site's live payments show only in live mode.
- **Payments** (left menu, Payments or Transactions): one row per payment (PaymentIntent), with its amount, status (Succeeded, Uncaptured, Refunded, Disputed,
  Canceled, Failed), description, customer and date. Opening one shows its description, its metadata, the charge, any refunds and any dispute.
- **Customers** (left menu): search a developer's email. Our customers are made with the developer's email and the metadata `userId` (the app's user id).
  A customer's page lists their payments and saved card.
- **Finding one of our payments:**
  - **By its id.** The admin console shows each payment's PaymentIntent id (`pi_…`), and each id is a link that opens that payment in the Dashboard (test mode
    while the site uses a test key). It appears in:
    - the Chargeback holds row ("Chargeback open: $96.00 of a $444.67 payment · pi_…");
    - a person's Payments and Chargebacks boxes;
    - a test's Payments box.

    In the database it's `Payment.stripePaymentIntentId` (`Payment.actionPi` while a bank check waits), and `Reservation.stripePaymentIntentId` for a
    reservation. Paste the id into the Dashboard's search.
  - **By what our code sets** (`src/lib/server/stripe.ts`):
    - **Pay, Pay more, a team decision, a tester's Charge, an automatic call charge** (`charge()`):
      - description: the payment's "What you've paid" line with full names, e.g. "Playtest: Ana Silva's written answers on “Harbor Run”";
      - metadata: `developerId`, `testerId`, `payKey`. The `payKey` is the press ("press:<developer id>:<uuid>") or a server key: "choice:<part id>" for a
        tester's Charge, "autocall:<call id>", "dispute:<dispute id>";
      - customer: the developer's;
      - when the tester's payout account is ready, also `transfer_data.destination` (their connected account) and `application_fee_amount` (the platform's share).
    - **Pay what you owe's one payment, a repayment after a lift, a subscription** (`chargePlatform()`): description ("Playtest: What you owe (…)", "Playtest:
      Repaid …", "Playtest subscription ($7/month)") and metadata `developerId`, `payKey` ("owedall:<payment id>", "deferred:<payment id>"). The platform keeps
      it (no transfer).
    - **A chargeback hold's reservation** (`authorize()`): capture "manual" (Uncaptured until the team's Approve), description "Playtest: Reserved for the team's
      review: …", metadata `developerId`, `reservationId`, `purpose=chargeback-reserve`.
    - Every description starts with "Playtest: " and names the tester, the part and the test (or each item, for a combined payment), so a payment can be
      recognized in the Payments list without opening it.
- **Disputes** (Payments → Disputes):
  - Each dispute shows the **disputed amount**, the reason (e.g. Fraudulent), the **status** (Needs response → Under review → Won / Lost) and the **"Respond
    by" date** (the evidence due date; here Nov 11, 2026).
  - Opening it shows the payment, the **$15.00 dispute fee**, the amount withdrawn from the balance (for the $50.00 dispute: −$65.00, the amount + the fee)
    and the form to send evidence.
  - The disputed amount is what the bank takes back. The app charges the developer that amount plus its own $15 chargeback fee (which covers Stripe's).
  - A dispute for only part of a payment shows the smaller amount here, next to the payment's full amount.

## Files

A1–A3 full dispute, B1 two Pays, C1–C3 the hold and the one payment, D1–D6 the partial dispute, E1 the amount followed, F1–F5 the chargeback steps and the
repayment, G1 won, H1 descriptions. Captions: [made.json](made.json); notes and the lines read off the pages: [results.json](results.json).
