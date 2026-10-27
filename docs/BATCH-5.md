# Batch 5: owner decisions (Oct 28)

This file wins over docs/BATCH-4.md and the design doc where they differ. Items marked DEFAULT are my recommendation, not yet confirmed by the owner: build them so they're easy to change, and list them in your report.

## 1. Contract-change line under buttons
The stop-once list under a pressed button already includes "Ana switched to the new terms" / "kept their current terms". Give that line the same "See their contract" link as the top box:
- on the test page it scrolls to that tester's row with the contract shown (opening the Testers fold);
- on Edit it opens the test page at that row in a new tab.
(ChangesBox already receives `contract` on each change; render the link when it is set and the line is a terms line.)

## 2. The 3-change limit covers different fields
Once the first tester has joined, at most 3 Saves may change these fields (one Save = one change, however many of them it touches):
- what to do (the steps / `description`);
- the NDA (`ndaText`): now confirmed by the owner, not a DEFAULT;
- questions;
- required languages (`languages`);
- required devices / technology (`devices`).

Part prices, parts and the build link are NO LONGER limited. Changing prices or parts still sends working testers the Switch/Keep offer, as today.
- Update `CRITICAL_FIELDS` in src/lib/limits.ts, the refusal line ("You've changed the steps, NDA, questions, languages or devices 3 times since testers joined. Contact us in Settings to change them again."), the "Changes left: N of 3" note, and the lock notes on Edit.
- Access keys stay out of the limit: a key given to a tester stays theirs, so adding keys never changes anyone's terms.
- Fix the schema comment on `criticalChanges`.

## 3. Suspended accounts: every signed-in page goes to the dashboard
For a suspended TESTER, and for a developer under a suspension, payment hold or chargeback hold (on their developer side), every signed-in page except these moves them to the dashboard TOP (live, and on load):
- the dashboard;
- Payments (receipts, Pay what you owe, Change card, payout setup);
- Settings (Contact us, email setting, delete account; the profile editor stays hidden);
- the bell list (a line whose page is closed lands on the dashboard top).

Closed for them now as well: tester and developer profile pages, session pages (a suspended tester's read-only session page goes), Find tests and test listings, Messages and chat, Edit, test pages, Post a test.
- On the dashboard, names in their rows show as plain text: no hover card, so no Chat with, Report, Block or profile link.
- A tester whose DEVELOPER is suspended or on hold is not restricted: they keep their session page (cancel calls, and the existing paused rules).
- An account with both sides on a payment or chargeback hold keeps its tester side open (the hold restricts only the developer side, as today). An admin suspension closes both sides.
- Update the layout's hidden nav links to match, and `ShellWatch`/`SessionWatch` need no change.
- The dashboard's blue box for a suspended tester: their account is paused, they were removed from their tests, how to appeal (Contact us in Settings), and that pay for work already accepted still reaches their Stripe account.

## 4. No automatic re-invite after a tester's suspension
Remove `reinviteAfterSuspension` (restrictions.ts) and its call in `reinstateAccount`.
- After reinstatement, the tests they were removed from stay at the dashboard top with the label "You were removed from this test" and "Ask to rejoin" (only while the test is open, has a spot and isn't paused), until they ask or dismiss.
- The developer can also invite them again as usual.
- Remove the "Suspended" label and Rejoin from batch 4's D1.

## 5. Rate on a test that is still open
When Rate is pressed on a test that is still open, EVERY stop-once kind applies (the full developer or tester list), not only the post-close subset. After a test closes, the post-close subset from batch 4 D4 stays.

## 6. Deleting an account
### Tester
The confirm pop-up becomes a thorough warning, with the real numbers for this tester:
- "Pay already sent to your Stripe account stays there. Your Stripe account is separate from Playtest: you can still sign in to Stripe and withdraw it."
- Pay already charged but not yet sent (waiting for payout setup): "$X is waiting for your payout setup. Finish it before deleting, or it can't reach you." (Show only when > 0; add a "Set up payouts" link.)
- Delayed payments (the developer's payment didn't go through yet): they still reach the tester's Stripe account when the developer pays, if payout setup is finished. Make sure the repay transfer works for a deleted tester (today `payments.ts:310` refuses a deleted tester for Pay; the repay path must not).
- Unpaid work: "N parts you sent aren't paid yet (up to $X). After deleting, they can't be paid, charged or disputed." Count work under review, parts where Charge is open, and open disputes.
- "You leave every test you're in. Calls ahead are cancelled, and your invites and applications are cancelled. Open disputes are withdrawn."
- "Your chats close. The ratings you gave and got stay."
- "You can't sign in again, and this can't be undone."

### Developer (DEFAULT)
Refuse deletion while the developer has any of these, and list them in the Delete account section with links:
- sent work waiting for Pay or Reject (including parts where Charge is open);
- an open dispute;
- a payment hold or chargeback hold (pay what you owe first).
Refusal line: "Pay or reject the work waiting for you first: <list>." Once none is left, deletion works as today, and since nothing is left under review, Charge never opens later.
(The owner suggested instead: keep open Charge rows and never open Charge for work still under review. I recommended the block because that version lets a developer skip paying for work by deleting. Keep the check in one function, `devDeleteBlockers`, so it can be swapped.)

## 7. Docs lines (design doc only; no code)
The design doc is updated separately. Don't edit docs/DESIGN-DOC.md.

## Check and report
- Tests for every item above. Run `NEXT_DIST_DIR=.next-build npm run check` until green.
- No migration should be needed. If one is, write it by hand and check it with the `prisma migrate diff ... --exit-code` command from BATCH-4.md F.
- Don't touch port 3400, and don't run `migrate deploy` or `generate` while it runs.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report: what changed, the DEFAULT items, and anything you couldn't do.
