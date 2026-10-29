# Batch 28: leftovers from the batch 25-26 design doc check (Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 27. Launch-critical: build it before launch (owner, Oct 29). Sections 11-13 moved to BATCH-29. Lines marked DEFAULT are my proposals; the owner can change them.

## 1. The heartbeat never records an outage on its own (DEFAULT)
`sweepGap` (src/lib/server/outages.ts) records any 15+ minute gap between sweeps as an outage. But the sweep runs from the uptime check itself, so pausing the monitor, a lapsed UptimeRobot plan, or a local server restarted after 15 minutes all record "outages" that move every timer (under 24 hours with no Approve). Fix:
- A heartbeat gap alone is **never applied**. It's listed in the admin console's Outages box as "Possible outage: no checks from 3:10 PM to 3:42 PM (32 min). Nothing has moved." with **Approve: move every timer** and **Dismiss** (any length, not only over 24 hours).
- An outage reported by UptimeRobot (down + up, or an up alert with its duration) is applied as today; when it overlaps a heartbeat gap, the gap is closed as covered by it.
- Any server activity counts as a heartbeat (page loads, API calls, the daily cron, the sweep), so a gap means the server really answered nothing.
- HANDOVER: pausing the monitor no longer moves anything; a gap shows for an admin to decide.
- Tests: a heartbeat gap alone → listed, nothing moved; Approve moves; Dismiss clears; an up alert overlapping the gap → applied once with the alert's span.

## 2. Merging never widens an applied outage by itself
`recordGap` keeps the union of overlapping reports, so an accurate up-alert outage grows to the heartbeat's span, and an extra part can move clocks without Approve even past 24 hours. Fix: when an UptimeRobot report exists, its span wins (no union with a heartbeat gap). Two UptimeRobot reports that overlap merge, and any extension of an outage already applied that brings the total over 24 hours waits for Approve. Tests: up-alert + heartbeat → the alert's span; an applied 20-hour outage extended to 26 → the extra waits for Approve.

## 3. One wording for a team Stop
`sessionRefusal` (tests.ts) and other `testerRefusal` / `endedLine` callers don't pass `teamTime`, so some paths say "This test was stopped on Oct 29, 2026." while others say "This test was stopped at 3:10 PM.". Use the time form everywhere (the reader's zone; the date added after 12 hours, like other stop lines).

## 4. One time zone in a stop box
ChangesBox's `time()` uses the browser clock while stop lines now use the saved zone. Use the reader's saved zone everywhere in the box (the browser's only when none is saved).

## 5. The charge-opens line on the session page
A sent, listed part on the tester's session page doesn't show "If <dev> hasn't paid by <date>, you can charge or let it go then." (only dashboard rows and listed call rows do). Add it under each sent, listed part that's waiting for the developer.

## 6. Leftovers from the old question rule
- `answerSets.ts`: a question it can't find defaults to `required: true` (a "*" on a "Question N" placeholder): default to not required.
- `byQuestion.ts`: remove the unused `notRequired`.

## 7. Admin "Payouts waiting": oldest first
Batch 26 §12 made it newest first; the oldest waiting payouts are the most urgent. Oldest first, with "waiting since <date>", still the scroll box.

## 8. A Charge after the reservation never blocks Approve (owner, Oct 29; replaces batch 23 §6's "Approve is refused while short")
During a chargeback hold, when a tester's Charge (or anything else) is added to what's owed AFTER the developer reserved with Pay what you owe:
- **Approve still goes through:** it takes the reserved amount and lifts the hold, as when nothing was added. No "Not yet: $X is owed but $Y is reserved." refusal any more.
- **What was added after the reservation is charged right after the lift,** on the card the developer verified, as an ordinary charge (receipt naming it: "Receipt: you paid $X for Ana Silva's written answers (charged by them after 7 days)"); the tester is paid when it goes through. If the bank asks to confirm, it waits as "Your bank wants you to confirm" (dashboard box, 3 days); if it's declined, it starts a normal payment hold (not a chargeback hold).
- The admin's chargeback row shows it before Approve: "$X reserved · $Y added since (charged after the hold lifts)".
- Payments, before Approve: "Reserved $X: it's taken when the team approves lifting your hold. $Y added since will be charged right after." **Simpler (owner, Oct 29): Pay what you owe reserves once.** After the reservation its button is disabled with that line; anything added later is only ever charged after the lift (no second reservation for the difference). A new Pay what you owe is only needed if the reservation expired or was released ("Don't approve"), and then it reserves the full amount owed at that time.
- Tests: reserve, a Charge added, Approve → reservation taken, hold lifted, the added amount charged once; declined → payment hold; bank asks → waits for Confirm.

## 9. A refused press redraws the page at once (owner, Oct 29)
Seen in the Blocks recording "Join call vs the block": the tester's Join call, pressed on a page opened before the block, is refused ("Your Join call didn't go through: this call isn't available.") but the page keeps Join call, "Call in progress / measuring" and the minutes box until its next poll. Rule, on every page and both sides: when a press is refused because the state changed (a block, a stop, a pause, an ended session or call, a closed request, already paid…), the page redraws right away (the same as its poll, without a full reload and without losing typed text), so the dead buttons go and the new state shows (here: the call ended, "Call ended: the call was cancelled."), with the refusal line kept under where the button was until the next press or for a few seconds. Also check the session page drops every call control live on a block (Join call, Request a time, call requests) on its normal poll. Tests: a refused Join call after a block → the call controls are gone at once; a refused Pay after another tab paid → the Pay box gone at once.

## 10. Stripe API 2026-09-30: audit every call (found by the Stripe test-mode run)
The installed stripe-node 23 speaks API 2026-09-30. On-session PaymentIntents sent `payment_method_types` (now refused), so every developer press failed on real Stripe ("Payments are having a problem right now…"); fixed in commit bcf92ac (`allowed_payment_method_types`). Casts hid it from the type check. Audit every Stripe call and every webhook field against this version's types (node_modules/stripe/cjs/resources/*.d.ts and its CHANGELOG), without `as unknown as` casts where possible:
- **Subscriptions:** `subscription.ts` expands `latest_invoice.payment_intent` and the invoice webhooks read `o.payment_intent`; invoices no longer carry `payment_intent` (use `invoice.payments` / `confirmation_secret`, or retrieve the payment). Make Subscribe (incl. its bank check), renewals, `invoice.paid`, `invoice.payment_failed` and `invoice.payment_action_required` work on this version.
- Every other create/retrieve/confirm/capture/cancel/refund/transfer/dispute call and webhook field (charges, disputes, account.updated, payouts).
- Tests where the fake Stripe enforces the new shapes (refuse removed parameters), so this can't silently happen again.
- Verify against Stripe test mode with the test key read from .env (never printed; only sk_test_; never the CLI's saved live login).

## 14. Say when a piece can't be paid more (owner, Oct 29; DEFAULT wording)
Today nothing says it; the Pay more box just disappears at the cap, and the tester can keep sending updates that can't be paid more.
- **Developer, on the piece:** once the cap is reached, where Pay more was: "Paid the most this piece can be paid ($20.00)." (grey).
- **Tester, on a paid part, above Send my updated answers / recording:** while Pay more is still possible: "<dev> has paid $10.00 for this. An update can be paid more, up to $20.00 in all."; once the cap is reached: "This part is already paid the most it can be ($20.00): an update can't be paid more." (grey, not a stop; Send still works, e.g. to fix something).
- After Pay more closed (close-out): the tester's line says "Pay more closed on <date>: an update can't be paid more."
- The tester's Dispute line stays: "Already paid the most a dispute could award, so there's nothing to dispute." (a dispute can only raise the pay up to the listing, minus what's already paid for that part).
- Tests: both lines at and below the cap; after Pay more closed.

## 15. A dispute can award up to the piece's cap, not just the listing (owner, Oct 29; the chat part confirmed by the owner)
Today a team decision can raise a listed piece's pay only up to the listing (minus what was paid for that part on other pieces), so a recording listed at $10 and paid $20 can't be disputed. The owner: a tester and developer may have agreed more in chat. New rule:
- **The decision range runs up to the piece's own cap** (the same cap Pay + Pay more have: for a listed part the listing plus its extra-pay room; for an unlisted part its cap; for a call, also within what's left of the $1,000 for that tester's calls), minus what that piece was already paid. A decision still only raises pay.
- **Dispute is open while the piece is below its cap.** At the cap: "Already paid the most this piece can be paid, so there's nothing to dispute." (replaces the old line).
- The admin form shows the new range ("$20.00 paid · can raise up to $20.00 more"); the server refuses outside it.
- **The team can read the chat for a dispute (owner: yes):** the admin's dispute view gets a read-only "Their chat on this test" fold (both people's messages, newest last, scroll box), so an agreement made in chat can be checked. This is the ONLY place admins can read a chat (owner, Oct 29): not from profiles, reports or anywhere else, and no read log is needed. The Terms' dispute paragraph says so: "To decide a dispute, our team can read the chat between the tester and the developer." (If the Terms text changes, follow how earlier Terms changes were versioned; nothing has launched.)
- Update every place that says "up to the listing" for disputes (design doc via the doc agent; the Terms; the landing page's "a decision can only raise the pay" stays true).
- Tests: a listed part paid above the listing but below its cap can be disputed and raised to the cap; at the cap it's disabled with the new line; the admin sees the chat fold; the server refuses above the cap.

## 16. (Dropped: not an app bug. Chrome's Local Network Access check blocked the bank frame's return to localhost; on the public site it works.) The bank's check under Pay disappears before it can be done
On real Stripe, Pay with a card that needs 3D Secure (4000 0027 6000 3184) creates the PaymentIntent correctly (requires_action, a redirect_to_url check page), but within a few seconds the piece leaves Needs you and the inline check (PayBox.tsx, `bank.view`) unmounts with it, so the developer never sees the bank's page; the Payment stays needs_action until it times out. Batch 17 §11 says the piece stays, locked, with the check open, and the page doesn't refresh itself while it's open. Fix: a piece whose Pay is waiting for the bank stays in Needs you (and on the test page) with its check open until the check ends (confirmed, cancelled, failed or timed out); the page's poll / redraw never removes it meanwhile; the same for Pay more, Pay what you owe and Subscribe. Test against real Stripe test mode too (the test key from .env, never printed). Tests: the piece and its check stay through several polls; confirm → paid; fail → "nothing was charged" line, piece free again.

## 17. Waiting shares must not need the platform's available balance (found by the Stripe test-mode run)
Sending a tester's waiting share later (payout setup finished, batch 22 §3) makes a separate Transfer from the platform's balance; on Stripe, money from a charge is "pending" for days, so the transfer fails with "insufficient available funds" (it did in test mode until the balance was topped up). In live mode this would fail for every waiting share for the first days. Fix: create those transfers with `source_transaction` set to the original charge (Stripe then sends the share as soon as that charge's funds are available, with no balance needed), keep them idempotent per share, and treat "pending" as sent-and-arriving for the tester ("$X on its way"). Check every other place a separate Transfer is made the same way (dispute decisions charged later, Approve paying testers after a chargeback hold, deferred charges). Tests (fake Stripe enforces source_transaction for transfers made after the charge).

## 18. Payment emails go out even with email Off (owner, Oct 29)
Today, with email Off only "Your Playtest account updates" lines are emailed; receipts, "You were paid…", the retry line and other payment lines aren't. New: payment lines are emailed the same evening whatever the setting, in "Your Playtest payment updates" (as Weekly / Monthly already do): Off, Daily (still inside the daily summary), Weekly and Monthly. The Notifications page's "How you're notified" text says so: "Payment updates are always emailed the same evening." Update the design doc's Emails rules and the bell table's email column (doc agent). Tests: email Off still gets the evening payment email; nothing else.

## 19. Verify a card never shows Stripe's card form (launch-critical, found by the Stripe test-mode run)
During a chargeback hold, "Verify a card" (src/components/ChargebackSteps.tsx) never mounts Stripe's card form; "Verify this card" fails with "Could not find a ready element to create a payment method from.", so no chargeback hold could be lifted. Mount the element with the SetupIntent's client secret from /api/payments/verify-card, confirm with the matching Stripe.js call and a return_url, keep the inline 3D Secure and the fake-Stripe stand-in. Verify in real Stripe test mode.

## 20. A listed piece's cap is its listing plus the part's max (owner, Oct 29; drops the 100%-of-listing rule)
Extra pay above the listing is no longer limited to 100% of the listing: a listed piece can be paid up to its listing plus the part's max ($1,000 for written answers or a recording; $200/h × measured minutes for a call, within the $1,000 for that tester's calls). Unlisted pieces are unchanged. Pay / Pay more hints and refusals, §14's lines, §15's dispute range, the admin form, the Terms and the design doc follow.

## 21. Listed calls are charged automatically after 7 days (owner, Oct 29; replaces Charge / Let it go for listed calls)
How hourly platforms bill (Wyzant, Upwork): the measured time is charged unless the client acts within a review window.
- **The week after a listed call** (from its end; it moves with pauses and outages like other review dates): the developer can Pay it themselves, any amount; below rate × measured minutes needs a reason the tester reads (as today), and the tester can dispute it once. Reminders: "“<test>”: pay <tester>'s call on <date> within 3 days / by tomorrow" at the marks still ahead (3 days, 1 day), and a line in the call's Pay box: "If you don't pay by <date>, it's charged automatically: $X (<N> min × $Y/h)."
- **Not paid by then:** the app charges the developer's card for rate × measured minutes (within the $1,000 for that tester's calls), off-session, as a payment made while away: the developer's receipt "Receipt: you paid $X for <tester>'s call on <date> (charged automatically after 7 days)"; the tester's "<dev> paid you $X for your call on <date>." Bank asks → the dashboard's "Your bank wants you to confirm" box (3 days, then counts as declined); declined → a payment hold as for any declined charge (testers see "delayed", never "failed"). During a hold or suspension it's added to what's owed, as a tester's Charge is today.
- **No Charge or Let it go for listed calls**, anywhere (session page, dashboard "Charge or cancel", reminders, bell lines); the tester's call row shows "If <dev> doesn't pay by <date>, it's charged automatically." A call with 0 measured minutes is closed with nothing to pay.
- **Unlisted calls unchanged:** any amount ($0 included), the weekly "Pay your calls" line, no automatic charge, no end date.
- Pay more on a call works as for other pieces, up to its cap (§20).
- Existing local data: listed calls whose Charge already opened switch to the automatic charge at the next sweep.
- Terms, HANDOVER and the design doc (doc agent): the automatic charge replaces Charge for listed calls; Post's Charge tick wording covers it ("…for work I haven't paid once 7 days have passed since they sent it and their own deadline has passed, and listed calls 7 days after they take place").
- Tests: auto-charge at day 7 once (idempotent, the sweep running twice), paid before → nothing, bank asks, declined → hold, paused → added to owed, 0 minutes → nothing, unlisted untouched, no Charge/Let it go shown for listed calls.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
