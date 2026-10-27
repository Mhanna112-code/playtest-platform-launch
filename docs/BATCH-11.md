# Batch 11: owner decisions (Oct 29, later)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 10.

## 1. A deleted tester's SENT work is still reviewed
- Work the tester sent before deleting stays in the developer's Needs you, with Pay and Reject (and Pay only for unlisted parts), and the usual reminders.
- Pay reaches the tester's Stripe account if their payout account was connected.
- DEFAULT: if it wasn't connected, nothing can reach them, so those rows leave Needs you with the line "<name> deleted their account before setting up payouts, so this can't be paid."
- Unsent work is gone. Charge and Dispute are gone too, because the tester can't sign in.
- Update the tester's delete warning: "Work you already sent can still be paid by the developer, to your Stripe account if it's set up. After deleting, you can't charge for it or dispute it."
- Undo batch 5's refusal of Pay/Reject for deleted testers. That refusal is only right when there's no payout account.

## 2. The chargeback fee
- Each chargeback adds the fee to what the developer owes, on top of the reversed amount: `CHARGEBACK_FEE_CENTS = 1500`, one constant.
- Their Payments line reads: "Your bank reversed a $X payment: $X + $15 chargeback fee."
- When the platform wins (batch 10 item 6), the amount AND the fee come off what is owed, or are refunded if already paid.
- The developer's test page and Edit get this as a stop-once change: "Your bank's chargeback of $X was reversed: $Y refunded to your card." It is a payments-kind line (so Alerts can ignore it).
- "Pay what you owe" stops once for every change, this one included.

## 3. "Your bank wants to confirm this payment"
A Stripe result of `requires_action` (the bank wants the cardholder to confirm) is NOT a decline.
- **A developer's own press** (Pay, Pay what you owe, Subscribe, the chargeback steps): run it as an on-session payment. Stop sending `off_session: true` for presses. If the bank asks, show its confirmation pop-up in the page with Stripe.js (`handleNextAction`). Confirmed: it goes through as normal. Cancelled or failed: the blue notice under the button says "Your bank didn't confirm the payment, so nothing was charged." No hold.
- **Charges made while the developer isn't there** (a tester's Charge, a dispute decision, the retries in item 4, subscription renewals): the payment waits as "needs your confirmation".
  - The developer gets a bell and an email, sent even with email Off: "Your bank wants you to confirm a $X payment. Confirm it in Payments by <date>." Payments shows a "Confirm" button.
  - If they don't confirm within 3 days, it counts as declined: a payment hold for a charge, or a lapse for a renewal.
  - The tester sees "Payment may be delayed".

## 4. Automatic retries during a hold
While a payment hold or chargeback hold lasts, retry what is owed on the saved card:
- once a day, at most 7 tries per hold;
- and at once when the developer saves a new card.

**Success:**
- The lines it covers are paid, and "Pay what you owe" updates live (any open page stops once).
- Payment hold with nothing left owed: the hold lifts on its own, as if they had pressed Pay. From the 4th hold on, an admin's Approve is still needed.
- Chargeback hold: the money is collected, but the hold stays until the 3D Secure card check and the admin's Approve are done, as today.
- An admin suspension is never lifted by a payment. Use batch 10 item 4's message while it lasts.
- Bell to the developer: "We charged your card $X for what you owed."

**A failed retry:** no bell. Payments shows "Last try: <date> · next try: <date>" (or "No more automatic tries: press Pay what you owe").

A retry that hits `requires_action` follows item 3.

## 5. The paused banner mentions the deadline
Add this line to batch 10's tester banner when the tester has a deadline and `PAUSE_DEFAULTS.shiftDeadlines` is on: "Your deadline is paused too: it moves later by however long the pause lasts."

## 6. Extra pay merges into Pay
There's ONE Pay box per piece and no separate Extra pay box.
- An amount above the listing counts as extra pay, within batch 9 §6's per-piece caps. An unlisted piece's box goes up to the max plus 100% of it ($2000 for a written or recording piece; $400/h × logged minutes for a call).
- After a piece is paid, its row keeps the same box as "Pay more" until the cap is reached, with the same ticks and optional note.
- The blocked line is unchanged.
- The tester's bell says "<dev> paid you $X" for the first payment and "<dev> paid you $X more" for later ones.

## 7. Written parts: length, formatting, files and recordings
- **Length:** at most 10,000 characters per written part (all its answers together), with a live counter "N / 10,000".
- **Formatting:** a small toolbar with Bold, Italic and Code block. Store it as Markdown limited to those three, and render it safely: no raw HTML, no links that run scripts. The developer sees it formatted.
- **Attachments on a written part:** up to 5 files, 25 MB each (images, PDF, plain text, zip), plus recordings. Use the existing storage path, like recordings.
- **Record on the session page:** a "Record" button, for the Recording part and for attaching to a written part. It records the screen (and the microphone if allowed) in the browser with getDisplayMedia + MediaRecorder, with a timer and Stop. It then previews and uploads through the existing recording upload (500 MB limit, 5 per session). Uploading a file stays available. Look at the full app's components for reference: C:/Users/march/Projects/playtest-platform/src/components/recording-uploader.tsx and src/app/call/[slotId]/call-room.tsx.
- **The developer** sees attachments and recordings inside that piece's scroll box (batch 10 item 3), each one downloadable or playable.

## 8. Free during launch: no admin setting
- Remove the admin "Free for everyone until" setting and its change and clear notices.
- The date comes from the server configuration, the `FREE_UNTIL` environment variable (an ISO date). It's unset now, which means free with no end.
- The daily job sends the 30-day and 7-day notices for the configured date.
- Note in .env.example: set it at least 30 days ahead.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check` until it's green. A stale Prisma client after a new migration is the only acceptable failure.
- Migrations: write them by hand and check them with the `prisma migrate diff ... --exit-code` command from BATCH-10.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Never use live Stripe keys. Test mode or the fake Stripe only.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, the migrations, the DEFAULT items and any interpretations.
