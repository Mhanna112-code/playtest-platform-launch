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
4. Sizes: try a file over 25 MB as an attachment: refused before upload. (A larger upload forced past the page is refused by R2 itself, because the signed URL
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
- Open a call page and check the video room loads (the security headers allow `meet.jit.si`; a developer's own meeting link opens in a new tab instead).
- Run the database migrations with `DIRECT_URL` set (see HANDOVER section 7).
