# Batch 9: paying for unlisted parts, notes and ticks on Pay (owner, Oct 28 night)

This file wins over the earlier batches and the design doc where they differ.

## 1. New caps for unlisted parts
An unlisted part is one with no listed price in the tester's contract (the "Not listed" label). Its caps replace the $100 cap, per piece, with extra pay included:
- written answers or a recording: at most **$1000**;
- a call: at most **$200 an hour** for the minutes logged (rate × logged minutes).

Split `NO_LISTING_CAP_CENTS` into `NO_LISTING_WORK_CAP_CENTS = 100_000` and `NO_LISTING_CALL_RATE_CAP_CENTS = 20_000` (a per-hour rate). These caps don't count toward the 100% extra-pay cap for listed parts, which is unchanged. The blocked line keeps batch 4's wording: "This is more than you can pay above the listing (up to $Y)."

## 2. Unlisted parts have only Pay in Needs you
- The Needs you row for an unlisted part has a Pay button, with no Reject.
- The Pay box starts empty. Paying $0 is allowed and closes the row; the tester reads it as "<dev> paid $0 for this" plus the note, if any.
- Charge or Let it go never opens for unlisted parts (as today), and they can't be rejected. They also can't be disputed: the existing rule stays ("This wasn't in your contract, so the developer's amount is final.").
- DEFAULT: the developer gets the usual review reminders for 14 days after sending, then no more reminders. The row stays until paid, even $0.

## 3. An optional note on every Pay
Every Pay box (Pay in Needs you, Pay on a tester row, Extra pay) gets an optional note field: "Note to <tester> (optional)". The tester reads it with the payment, on their session page and in the bell line.
- On a listed part paid below the listing, the note is required, as today ("Say why you're paying less…"). The same field serves both.

## 4. Paying for calls: a rate field
- The developer still logs the call's length first (existing).
- The call's Pay box gets a "Rate ($/h)" field. Typing a rate fills the amount with rate × logged minutes, rounded to the cent. Typing an amount directly clears the rate field.
- A listed call's rate starts at the contract rate. An unlisted call's rate starts empty and can't exceed $200/h; an amount above $200/h × the logged minutes is refused with the cap line.
- The tester sees the amount and, when one was typed, the rate.

## 5. Ticks on every Pay
- **Every** Pay and Extra pay has the tick "I understand this payment of $X can't be refunded and is charged now." It names the exact amount and replaces the old "charged now: $X" tick. A changed amount unticks it.
- **Over $200**, an additional tick appears: "I confirm this payment is over $200." Both are needed. The old over-$200 line becomes the every-payment tick above.
- Paying $0 needs no tick.
- Update `checkPay`, `checkExtraPay`, `PAY_TICK_LINE`, `PAY_TICK_CENTS` and every Pay UI to match.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check`. A stale Prisma client from batch 8's migration is the only acceptable failure; say so if it happens.
- If a migration is needed (for example the payment note or the call rate), write it by hand and check it with the `prisma migrate diff ... --exit-code` command from BATCH-8.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, any migration, and any interpretations.

## 6. Extra-pay caps, per piece (owner, Oct 28 night; replaces section 1's "extra pay included" and the per-contract 100% cap)
Extra pay is everything paid above the base: the listing for a listed part, or the max for an unlisted one. It's counted per piece, across Pay and every Extra pay on that piece.
- **Unlisted part:** the base Pay is at most the max ($1000 for a written or recording piece; $200/h × logged minutes for a call). Extra pay can add up to 100% of that max on top. A written piece can total $2000; a 30-minute call can total $100 + $100.
- **Listed part:** extra pay can add up to 100% of the listing, but never more than the max. A $20 written listing allows $20 extra; a $3000 listing allows $1000 extra; a $50/h call allows $50/h × minutes extra; a $300/h call allows $200/h × minutes extra.
- This replaces `EXTRA_PAY_CAP_PERCENT`'s per-contract total. Keep the percent (100) as one constant.
- The blocked line stays "This is more than you can pay above the listing (up to $Y)." For an unlisted part, write "above the max" instead of "above the listing".

## 7. One 7-day clock per paused test (owner, Oct 28 night)
A paused test has one closing clock: 7 days from when it was first paused, whatever the cause (payment hold, chargeback hold, admin suspension, or the team's pause of that test). A second cause starting doesn't restart or extend it, and neither does one cause lifting while another remains. The card shows every reason, e.g. "Paused: payment hold · paused by the team". The daily paused reminder uses that one date.
