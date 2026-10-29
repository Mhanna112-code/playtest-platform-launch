# Batch 28: leftovers from the batch 25-26 design doc check (Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 27. Lines marked DEFAULT are my proposals; the owner can change them.

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

## 11. Stopped, closed, paused: the same stop-once rules as a running test (owner, Oct 29; replaces batch 16 §25's "goes through on the first press")
On a stopped, closed or paused test (any cause: the team, the developer's hold or suspension), after a tester's work ended (ended early, left, removed, blocked), and while the developer is held or suspended, every press that is still allowed follows the SAME stop-once rules it has on a running test: the first press after a change the page hasn't shown stops once in the blue box (with the Alerts types as usual), the second goes ahead. Applies to both sides: the developer's Pay, Pay more, Confirm with your bank, Stop, End early, Cancel call, Next round / Go to the next round; the tester's Charge, Let it go, Dispute, Cancel call.
- **Exceptions stay as they are:** Rate keeps its own short list (Why a press stops: Rate); excerpt Allow / Deny / Take down and "Send your side" keep their current rules; Leave and Block never stop.
- The stop (or pause, close, end) itself is a change like any other: a page opened before it stops once naming it ("Nora Lane stopped this test at 3:10 PM."), as batch 17 §12 does for money presses today.
- Refusals stay plain ("Pay closed on <date>.", already paid elsewhere …).
- Update the design doc's "Stopped tests" rules accordingly (doc agent). Tests: on a stopped test, a tester's dispute after the page loaded stops the developer's Pay once; on a paused test a payment elsewhere stops Charge once; Rate still uses its own list; excerpt presses unchanged.

## 12. Your own changes in another tab stop every press once, on the test page AND Edit (owner, Oct 29; widens batch 16 §21 / the Oct 28 "big changes" rule)
Today only End early, Stop, Pay / Pay more and call changes made in another tab stop the test page's presses, and Edit saves, Accept / Decline, invites and Next round from another tab stop nothing. New rule, for the developer, across the test page and its Edit page (and the dashboard's buttons for that test):
- **Changes that count** (made by the developer in another tab or device since the page loaded): an Edit save (any field), Pay, Pay more, Confirm with your bank, End early, Stop, Next round (the draft made), any call change (request, withdraw, accept, decline, cancel), Invite / Cancel invite, Accept / Decline of an application or rejoin ask.
- **Presses they stop once:** every developer press on the test page and on Edit: Save, Next round / Go to the next round, End early, Stop, Pay, Pay more, Confirm with your bank, the call buttons, Invite, Accept / Decline. The blue box lists them as "You … in another tab" lines with times: "You paid Ana Silva $10.00 for the written answers in another tab", "You saved the listing in another tab: spots, description", "You started the next round in another tab", "You booked a call with Ana for Thu, Nov 5, 3:00 PM in another tab", "You accepted Ben Okafor's application in another tab". Second press goes ahead (or is refused if it can no longer happen).
- **Exceptions (DEFAULT reading of the owner's words):** Rate and excerpt Allow / Deny / Take down are never stopped by these, and ratings / excerpt decisions made in another tab aren't lines that stop other presses; they only race with the same action (the same rating or the same excerpt: "You already rated Ana Silva.", "You already allowed this excerpt.").
- **Live:** these lines also show in the top box (and raise the pill) on both pages, as other updates do. Edit keeps its per-field notes for another tab's saves; the stop box line is in addition.
- Not in Alerts (your own actions can't be switched off), as today. The batch 28 §11 rule (stopped / closed / paused tests keep stop-once) applies to these too.
- Tests: Pay in tab A stops Save on Edit in tab B once; an Edit save in tab A stops Next round, End early and Request a time in tab B once; Rate / excerpt presses not stopped; same rating twice refused.

## 13. The tester's own changes in another tab, the same way (owner, Oct 29; mirrors §12)
Today a tester's own press in another tab stops only the SAME press ("You also did this in another tab: …"). New rule, across the tester's session page, the join page and their dashboard buttons for that test:
- **Changes that count** (made by the tester in another tab or device since the page loaded): Send / Send updated (answers or recording), Switch or Keep, Charge, Let it go, Dispute, any call change (request, withdraw, accept, decline, cancel), Leave, joining / applying / asking to rejoin / withdrawing an application, accepting or declining an invite ("No thanks").
- **Presses they stop once:** every tester press on those pages: Send, Switch / Keep, Charge, Let it go, Dispute, the call buttons, Join / Apply / Ask to rejoin / Withdraw application, Accept invite / No thanks. Lines: "You sent your updated answers in another tab", "You charged Nora Lane $10.00 for your recording in another tab", "You requested a call for Thu, Nov 5, 3:00 PM in another tab", "You applied to join in another tab". Second press goes ahead (or is refused if it can no longer happen: "You already disputed this payment.").
- **Exceptions:** Rate (and its finishing your part) keeps its own short list and, done in another tab, only races with Rate itself ("You already rated Nora Lane."); excerpt requests / Remove the same way; Leave and Block never stop (but a Leave made in another tab is a line that stops the others).
- These stop even with Alerts Off? No: they follow Alerts like "other tabs" today (Off = only contract changes stop), except the same press, which is always a plain refusal.
- Live: these lines show in the top box and raise the pill. §11 (stopped / closed / paused keep stop-once) applies.
- Tests: Send in tab A stops Charge in tab B once; a call request in A stops Dispute in B once; Apply in A stops Join on B's join page once; Rate in A refuses Rate in B plainly.

## 14. Say when a piece can't be paid more (owner, Oct 29; DEFAULT wording)
Today nothing says it; the Pay more box just disappears at the cap, and the tester can keep sending updates that can't be paid more.
- **Developer, on the piece:** once the cap is reached, where Pay more was: "Paid the most this piece can be paid ($20.00)." (grey).
- **Tester, on a paid part, above Send my updated answers / recording:** while Pay more is still possible: "<dev> has paid $10.00 for this. An update can be paid more, up to $20.00 in all."; once the cap is reached: "This part is already paid the most it can be ($20.00): an update can't be paid more." (grey, not a stop; Send still works, e.g. to fix something).
- After Pay more closed (close-out): the tester's line says "Pay more closed on <date>: an update can't be paid more."
- The tester's Dispute line stays: "Already paid the most a dispute could award, so there's nothing to dispute." (a dispute can only raise the pay up to the listing, minus what's already paid for that part).
- Tests: both lines at and below the cap; after Pay more closed.

## 15. A dispute can award up to the piece's cap, not just the listing (owner, Oct 29)
Today a team decision can raise a listed piece's pay only up to the listing (minus what was paid for that part on other pieces), so a recording listed at $10 and paid $20 can't be disputed. The owner: a tester and developer may have agreed more in chat. New rule:
- **The decision range runs up to the piece's own cap** (the same cap Pay + Pay more have: for a listed part the listing plus its extra-pay room; for an unlisted part its cap; for a call, also within what's left of the $1,000 for that tester's calls), minus what that piece was already paid. A decision still only raises pay.
- **Dispute is open while the piece is below its cap.** At the cap: "Already paid the most this piece can be paid, so there's nothing to dispute." (replaces the old line).
- The admin form shows the new range ("$20.00 paid · can raise up to $20.00 more"); the server refuses outside it.
- **The team can read the chat for a dispute (DEFAULT):** the admin's dispute view gets a read-only "Their chat on this test" fold (both people's messages, newest last, scroll box), so an agreement made in chat can be checked. The Terms' dispute paragraph says so: "To decide a dispute, our team can read the chat between the tester and the developer." (If the Terms text changes, follow how earlier Terms changes were versioned; nothing has launched.)
- Update every place that says "up to the listing" for disputes (design doc via the doc agent; the Terms; the landing page's "a decision can only raise the pay" stays true).
- Tests: a listed part paid above the listing but below its cap can be disputed and raised to the cap; at the cap it's disabled with the new line; the admin sees the chat fold; the server refuses above the cap.

## 16. The bank's check under Pay disappears before it can be done (found by the Stripe test-mode run)
On real Stripe, Pay with a card that needs 3D Secure (4000 0027 6000 3184) creates the PaymentIntent correctly (requires_action, a redirect_to_url check page), but within a few seconds the piece leaves Needs you and the inline check (PayBox.tsx, `bank.view`) unmounts with it, so the developer never sees the bank's page; the Payment stays needs_action until it times out. Batch 17 §11 says the piece stays, locked, with the check open, and the page doesn't refresh itself while it's open. Fix: a piece whose Pay is waiting for the bank stays in Needs you (and on the test page) with its check open until the check ends (confirmed, cancelled, failed or timed out); the page's poll / redraw never removes it meanwhile; the same for Pay more, Pay what you owe and Subscribe. Test against real Stripe test mode too (the test key from .env, never printed). Tests: the piece and its check stay through several polls; confirm → paid; fail → "nothing was charged" line, piece free again.

## 17. Waiting shares must not need the platform's available balance (found by the Stripe test-mode run)
Sending a tester's waiting share later (payout setup finished, batch 22 §3) makes a separate Transfer from the platform's balance; on Stripe, money from a charge is "pending" for days, so the transfer fails with "insufficient available funds" (it did in test mode until the balance was topped up). In live mode this would fail for every waiting share for the first days. Fix: create those transfers with `source_transaction` set to the original charge (Stripe then sends the share as soon as that charge's funds are available, with no balance needed), keep them idempotent per share, and treat "pending" as sent-and-arriving for the tester ("$X on its way"). Check every other place a separate Transfer is made the same way (dispute decisions charged later, Approve paying testers after a chargeback hold, deferred charges). Tests (fake Stripe enforces source_transaction for transfers made after the charge).

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
