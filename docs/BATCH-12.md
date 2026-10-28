# Batch 12: owner decisions (Oct 29, evening)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 11.

## 1. Developer deletion: the owner's version (replaces batch 5's blockers)
- A developer can always delete their account. Remove `devDeleteBlockers` and its listing in the Delete account section.
- Parts where Charge is **already open** when they delete stay open: the tester can still Charge or Let it go, and the charge goes to the deleted developer's saved card.
  - If it's declined, there's no account left to hold. The payment stays "delayed" for the tester and is listed for admins, and the platform doesn't cover it.
- Work still **under review** (Charge not yet open) never opens Charge. The tester's part reads: "<dev> deleted their account, so this can't be paid."
- An open dispute is still decided by the admins. A decision for the tester charges the saved card, as above.
- What the developer owes stays owed. Deleting still never clears it.
- The developer's delete warning lists, with counts: work waiting for review, parts testers can still charge, and open disputes. Then: "Testers can still charge for parts already open to charging. Work you haven't reviewed can't be charged after you delete."

## 2. Calls: per-call rate cap and a total cap (replaces batch 11 §6's "$400/h" for unlisted calls)
- An unlisted call: at most **$200/h** for its logged minutes, with no extra on top for calls.
- All of one tester's unlisted calls on a test together: at most **$1000**. Example: 5 hours at $200/h comes to $1000, and nothing more can be paid for unlisted calls.
- Listed calls keep batch 9 §6: up to 100% of the listing above it, per call.
- Show the remaining room in the call's Pay box: "up to $X more for unlisted calls".

## 3. "Pay more" on every paid piece in the tester rows
In each tester row on the developer test page, every paid piece shows the "Pay more" box (batch 11 §6): written answers, recordings and calls, listed or unlisted, until its cap is reached.

## 4. At most 10 open tests per developer
- Open, Full and Paused tests count; drafts, Stopped and Closed don't.
- Posting an 11th is refused with the blue notice under Post the test: "You have 10 open tests, the most you can have at once. Stop or close one to post another." This also covers posting a draft.
- Subscribers get up to 10 open tests; the free plan gets 1 (batch 8).
- Count on the server at press time. If another tab stopped a test so the count is now under the limit, the post simply goes through. A drop in the count is never a stop-once reason.

## 5. Bank confirmation and the stop-once check
- The stop-once check runs first, and the payment starts only if nothing changed.
- While the bank's confirmation is pending, lock the piece. A tester's Charge or Let it go on it is refused with "A payment for this is being confirmed right now." The lock clears when the bank confirms, refuses or times out (the pop-up is closed or after 15 minutes).
- Never charge a piece twice.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check` until it's green. A stale Prisma client after a new migration is the only acceptable failure.
- Migrations: write them by hand and check them with the `prisma migrate diff ... --exit-code` command from BATCH-10.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never use live Stripe keys.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.

## 6. Open until, tester deadlines and the review window (owner, Oct 29; final)
- **Open until is required**: at least 3 days and at most 30 days after today, on Post and on Edit. Edit can still only move it later, within 30 days of today. A pause lifting can still push it later than that (batch 6).
- **There's no "days after joining" field any more.** Remove it from Post and Edit, from the listing badges ("10 days per tester"), from terms lines and from the join page. Old tests keep their stored value, which is unused for new joins.
- **A tester's deadline is Open until, for everyone** (owner: no 3-day extension for late joiners).
  - When Edit moves Open until later, every working tester's deadline moves with it.
  - The join page shows the deadline with the time left before they join ("Your deadline: <date> (in 2 days 5 hours)").
- **The review window drops from 14 days to 7.** Charge opens at the later of Open until and **7 days** after the part was sent, so the developer always has at least a week.
  - Update `chargeOpensAt`, the reminder schedule (1 week / 3 days / 1 day before Charge opens, then daily) and every "14 days" wording.
  - `UNLISTED_REMIND_DAYS` becomes 7.
- The 3-change limit, the "Open until can only move later" rule and the pause shifts are unchanged.
- Existing tests keep their data. The new rules apply to new posts, new joins, and Edit saves that touch Open until.
