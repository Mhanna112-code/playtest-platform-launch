# Batch 15: what to check yourself, at home

Some fixes talk to outside services the recorder can't reach (it runs on a fake Stripe, local disk and fake alerts). These are the checks to do once,
in **test mode**, before launch. Nothing here needs a live key. Where a setting is named, its line is in `.env.example`.

## 1. Stripe test mode (sections 4, 5, 9, 41 M1)

1. In the Stripe dashboard, switch on **Test mode** and copy the test secret key (`sk_test_…`) into `STRIPE_SECRET_KEY`. A live key (`sk_live_…`) is refused
   unless `STRIPE_ALLOW_LIVE=1`; leave that unset.
2. Sign up as a developer, add the card `4242 4242 4242 4242` in Payments, post a test, join it as a tester in another browser, send written answers, and **Pay**.
   The payment shows in Stripe → Payments with the metadata `payKey`.
3. Declines: add `4000 0000 0000 0002` instead and Pay. The page says the card was declined, a payment hold starts, and Payments → "Pay what you owe" lists it.
   Change the card back to 4242 and press Pay what you owe: the hold lifts.
4. Bank confirmation: `4000 0027 6000 3184` asks for 3-D Secure; the pop-up appears in the page; approve it and the Pay goes through.
5. Payments stuck "in progress" (section 9): there is no button for this. It is covered by `tests/batch15-recovery.test.ts` (proof `b15-09-recovery.txt`).

## 2. Stripe Connect webhook (sections 4 and 5)

1. Stripe → Developers → Webhooks → **Add endpoint**, URL `https://<your domain>/api/stripe/webhook`, "Events on your account":
   `charge.dispute.created`, `charge.dispute.closed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
   `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
2. **Add a second endpoint** at the same URL, choose **"Events on connected accounts"**, events `account.updated`, `payout.failed`, `payout.paid`. Copy its
   signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`.
3. As a tester, open Payments → **Set up payouts** and finish Stripe's test onboarding (use the test values Stripe offers). Back on Payments the payout
   banner goes away within a minute: Stripe sent `account.updated` and the account counts as ready once `payouts_enabled` is on and the `transfers`
   capability is `active` (charges don't matter).
4. In Stripe → Webhooks, each endpoint's "Recent deliveries" should show 200s. A 400 means the secret is wrong for that endpoint.

## 3. Cloudflare R2 bucket (sections 6 and 41 M5, M6)

1. Cloudflare → R2 → **Create bucket** (private). Create an API token with Object Read & Write on that bucket and set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`.
2. Bucket → Settings → **CORS policy**: allow `PUT` and `GET` from `https://<your domain>` with the headers `content-type` and `content-length`.
3. As a tester, attach an image and record a short screen recording; send them. Both play or open for the developer.
4. Sizes: try a file over 500 MB as an attachment (batch 31; was 25 MB): refused before upload. (A larger upload forced past the page is refused by R2 itself, because the signed URL
   carries its exact length.)
5. Types: a `.png` opens in the page; a `.zip` downloads (never shown inline).
6. Clean-up: remove a recording from the part; within the next daily job its object is gone from the bucket.

## 4. UptimeRobot checks (section 10)

1. Set `OUTAGE_CHECKS=1` and a long random `HEALTH_KEY` (not the placeholder: the build refuses it).
2. UptimeRobot → **Add monitor**, HTTP(s), URL `https://<your domain>/api/health?key=<HEALTH_KEY>`, every 5 minutes.
3. UptimeRobot → My Settings → **Alert Contacts → Add**: type **Webhook**, method POST, URL `https://<your domain>/api/health/alert?key=<HEALTH_KEY>`,
   "Send as JSON" with `{"alertType": "*alertType*", "alertDateTime": "*alertDateTime*", "monitorFriendlyName": "*monitorFriendlyName*"}`. Attach it to the
   monitor and tick both **down** and **up**.
4. To see it work: pause the site for 20 minutes (or use UptimeRobot's "Test notification" twice, a down then an up, 15+ minutes apart). The admin console's
   **Outages** section lists it; every running deadline, Open until and review date moved later by its length; open pages say "The site was down from … to …".
   An outage over 24 hours waits for **Approve** in the console before it moves anything.

## 5. After deploying

- The settings box at the top of the admin console (shown to `OWNER_EMAIL`) must be empty. The build already stops on the serious ones.
- Open a call page and check the built-in call room shows your camera (batch 21: the app's own room; the security headers allow the camera, microphone and screen share for this site only).
- Run the database migrations with `DIRECT_URL` set (see HANDOVER section 7).

## 6. Emails that fail: the outside alert (batch 23 sections 1 and 2)

1. Set up the second UptimeRobot monitor from the HANDOVER launch checklist: type **Keyword**, URL `https://<staging domain>/api/health?key=<HEALTH_KEY>`,
   keyword `degraded: emails`, alert when the keyword **exists**, every 5 minutes, alert contacts: your email and your phone (SMS).
2. On **staging**, set `RESEND_API_KEY` to a wrong value (for example the right one with a letter changed) and redeploy.
3. Trigger a few emails: "Forgot your password?" for your own account, or Contact us. Nothing arrives.
4. Within a few minutes the admin console shows the red box at the top: "Emails aren't sending: 2 waiting since 3:10 PM. Resend says: 401: API key is
   invalid." and your bell has one line "Emails aren't sending (since 3:10 PM)".
5. After 15 minutes, `https://<staging domain>/api/health?key=<HEALTH_KEY>` answers `{"ok":true,"emails":"degraded: emails"}`, and **UptimeRobot alerts you**
   by email and text (through its own system, so it works while Resend is down).
6. Put the right key back and redeploy: within the next 5-minute sweep the waiting emails go out (each once), the red box goes, the health answer says
   `"emails":"sending"` and UptimeRobot sends its "up" alert.
7. Optional, Resend's free plan: after 100 emails in a day Resend refuses with its daily limit. The red box then says "Resend's daily limit was reached
   (free plan: 100 a day). Emails will go out tomorrow, or upgrade the plan." and the emails go out after midnight UTC.

## 7. Stripe test mode: the cards to try (batch 23 section 10)

Use Stripe's test cards (any future expiry, any CVC, any postcode) with `sk_test_…` keys:

| Card | What it does | What the app shows | What the Stripe dashboard (Test mode → Payments) shows |
| --- | --- | --- | --- |
| `4000 0027 6000 3184` | Always asks for the bank's check (3-D Secure) | Under Pay (or Pay what you owe, Subscribe, Verify a card) the bank's check opens inline. Complete it: the payment goes through. Fail it: "Your bank didn't confirm the payment, so nothing was charged." | Completed: **Succeeded**, with "3D Secure: authenticated". Failed: **Incomplete** / **Canceled**, nothing taken |
| `4000 0000 0000 0002` | Always declines | "Your card was declined, …": a payment hold starts; Payments → Pay what you owe lists it. Save a 4242 card and press Pay what you owe: the hold lifts | **Failed** (`card_declined`) |
| `4000 0000 0000 0259` | Charges, then the cardholder disputes it (a chargeback) | Within a minute (the `charge.dispute.created` webhook) the developer's tests pause on a **chargeback hold**; Payments shows the three steps; every admin gets the chargeback email and the console's Chargeback holds row | The payment shows **Disputed** (Disputes lists it, "Needs response") |

Then finish the chargeback hold, as the developer and the admin:

1. Payments → **Verify a card** with `4000 0027 6000 3184` (the bank's check opens inline; complete it). Step 1 ✓.
2. **Pay what you owe**: it **reserves** the money. Payments says "Reserved $X: it's taken when the team approves lifting your hold."; the steps show
   "What you owe reserved on your card ✓". In Stripe the new payment is **Uncaptured** (an authorization: nothing taken yet).
3. As an admin, the Chargeback holds row shows "owed reserved ✓ ($X reserved)". Press **Approve**: in Stripe the payment becomes **Succeeded** (captured),
   the developer's tests resume, and the testers waiting on that money get "… paid $X for your …".
4. Or press **Don't approve: release the reservation** instead: Stripe shows it **Canceled** (nothing taken) and the hold stays; the developer can press
   Pay what you owe again.
5. A reservation not approved within 7 days is released by the app (Stripe shows it **Canceled**); Payments then says "Your reservation expired: press Pay
   what you owe again so the team can approve it." and the admin's row "Reservation expired". (Stripe test mode can't fast-forward 7 days: this is covered
   by `tests/batch23.test.ts`.)

## 8. Right after going live: one real $1 payment (batch 23 section 10)

With **live** keys (`sk_live_…`, `STRIPE_ALLOW_LIVE=1`), between two of your own accounts, with your own card:

1. Account A (tester): sign up, Payments → **Set up payouts**, finish Stripe's real onboarding (your own bank account).
2. Account B (developer): add your own card in Payments, post a small test, let account A join and send written answers, then **Pay $1.00**.
3. If your bank asks to confirm, its real check opens under Pay: complete it. The payment goes through.
4. Stripe dashboard (live mode) → Payments: the $1.00 charge, **Succeeded**, with the platform's fee; Connect → account A: the transfer of the tester's share.
5. Refund it afterwards from the Stripe dashboard: the payment → **Refund** → full amount. (The transfer to account A stays with account A unless you reverse
   it in Connect → the transfer → Reverse.)
