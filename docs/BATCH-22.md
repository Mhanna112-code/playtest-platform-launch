# Batch 22: chargeback holds never retry on their own (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 21.

## 1. No automatic retries during a chargeback hold
`retryOwed` (src/lib/server/holds.ts ~363) runs during payment holds AND chargeback holds (daily, up to HOLD_RETRY_MAX, and at once when a new card is saved). During a **chargeback hold** it must not run at all: what's owed is only ever paid through **Pay what you owe**, which stays disabled until a card is verified with the bank (batch 17 §41), and the hold lifts only when an admin presses Approve.
- Payment holds keep their automatic retries (daily up to the limit, and on saving a new card), as today.
- A payment hold that turns into a chargeback hold stops retrying from that moment.
- Payments' chargeback steps show nothing about "next automatic try" during a chargeback hold.
- Tests: a chargeback hold with a saved card: the daily job and saving a card never charge; a payment hold still retries; a payment hold turning into a chargeback hold stops retrying.

## 2. A suspended tester is paid normally; no held shares (owner, Oct 29)
Today a tester-side suspension holds the tester's 80% of every payment ("Held tester shares" in the admin console, with Release to the tester / Refund the developer). Remove holding entirely:
- Payments for a suspended tester's sent work (Pay, Pay more, Charge they made before, dispute decisions) go to their Stripe account as for anyone (if their payouts are set up; otherwise the usual "waiting for payout setup").
- Remove the "Held tester shares" admin box, the Release / Refund actions and routes (`release-share`, `refund-share`), the held status and its notices; existing held shares (local test data only) are released.
- The Terms' "Payouts" paragraph and the design doc drop "shares can be held during a tester-side suspension".
- Tests: a suspended tester's work paid → the share goes out; no admin box.

## 3. Waiting payouts go out on their own when the tester finishes payout setup
A tester paid before finishing Stripe payout setup gets their share recorded as waiting (`not_set_up`), and today it only goes out when an admin presses "Send now" (`sendWaitingTransfer` is called from the admin action and from reinstatement only; `payoutFixed` doesn't send anything). Fix: when the tester's payouts become ready (the account.updated webhook / `refreshPayoutStatus`), every waiting share of theirs is sent automatically (each once, idempotent), the tester gets "Your payout setup is done: $X on its way." The admin "Payouts waiting" list becomes read-only (no Send now), showing who's waiting and since when. Tests: paid before setup → waiting; setup completes → sent once; a second webhook doesn't send twice.

## 4. The admin's test timeline speaks about people, not to them
The "For the team (only admins see this)" box on a test's page shows the developer's own wording: "You paid Cam Lee $10.00…", "Your tests are running again", "Your account is paused". For admins every line names who did it, in the third person: "Marc Hanna paid Cam Lee $10.00 for the written answers", "Marc Hanna's tests are running again", "Marc Hanna's developer account was paused (by ana@…)". Also merge the duplicated pairs (one dispute shows twice: "Ana Silva disputed the pay…" and "Ana Silva disputed a payment: “…”"; "The team decided…" and "Dispute by Ana Silva decided…"): one line each, the dispute line carrying the reason in italics, the decision line naming the admin. Check the three lists (Timeline, Contract changes, Payments) are the scroll boxes of batch 17 §7 (about 10 rows, loading more, "That's all (N)"). Tests: the admin timeline wording for pay, pause, resume and a dispute; no duplicates.

## 5. "Lift the pause" on a test that isn't paused any more (owner, Oct 29)
The owner pressed Lift the pause and got "That test isn't paused by the team." (src/lib/server/restrictions.ts ~318). Remove that bare line:
- The admin Tests list (and the test's admin box) only ever shows Lift the pause on a test the team paused, and the row updates live when the pause is lifted elsewhere (the button turns back into Pause).
- A press from an old row is refused like the other admin races, naming who did it: "That test's pause was already lifted (by ana@… at 3:10 PM)." (or "…lifted when it closed at …" / "…isn't paused by the team: it's paused by the developer's account state" for a hold or suspension pause, which admins can't lift), and the row refreshes.
- Tests: two admins lifting at once; a stale row after a lift; a test paused only by a developer hold shows no Lift button.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
