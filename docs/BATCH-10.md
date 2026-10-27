# Batch 10: owner decisions (Oct 29)

This file wins over the earlier batches and the design doc where they differ.

## 1. Every reviewed part can be disputed, unlisted ones too
A tester can dispute the developer's decision on any part the developer reviewed: a Pay (any amount, $0 included) or a Reject on a listed part, and a Pay (any amount, $0 included) on an unlisted part.
- Remove the refusal "This wasn't in your contract, so the developer's amount is final."
- The usual dispute rules apply: once per part, the developer adds their side once, an admin decides.
- When an admin decides an unlisted part for the tester, they set the amount. It may not exceed the unlisted cap ($1000 for a written or recording piece, $200/h × logged minutes for a call) minus what was already paid. The charge follows the existing rules: during a hold it's added to what is owed; otherwise it's charged at once, and a decline starts a hold.

## 2. A paused test hides what doesn't work, and testers get a banner explaining it
On the tester's session page, while the test is paused (the developer is on a hold or suspension, or the team paused it):
- Hide the buttons that don't work right now: Send, the call-request tools, Join call, and chat's message box. This replaces batch 6/7's "Send stays visible and is refused". Keep the server refusals as a backstop.
- At the top of the page, a blue banner (never "hold", "suspended", "failed" or "chargeback"):
  "This test is paused right now. For now you can save drafts of your parts, charge or let go of work left unreviewed, dispute, rate, leave the test, and cancel booked calls. Sending work, requesting calls and chat come back when it resumes."
  Build the list from what is actually available (e.g. leave out "charge or let go" when nothing is chargeable), so it never offers a button that isn't there.
- Testers' dashboard rows for a paused test keep the "Paused" tag.

## 3. Long written answers on the developer's side
Wherever the developer reads a tester's written answers (Needs you, the tester rows), one piece's answers sit in their own scroll box about 16 lines tall when they're longer than that. The question labels stay visible inside the box, which scrolls as one. The Pay box under it stays outside the scroll box, always visible.

## 4. Paying what is owed while a suspension continues
When a developer pays what they owe (or a chargeback hold lifts) but an admin suspension is still on, they get this instead of "Your tests are running again" (bell and email, sent even with email Off):
"Your payment went through. Your tests stay paused while your account is suspended."
"Your tests are running again" goes out only when nothing pauses them any more.

## 5. "Pay what you owe" updates live
On Payments, the owed box polls like other live pages (about every 20 s). The amount and the lines update when something is added (a declined payment, a chargeback, a tester's Charge during the hold) or paid in another tab, and the box disappears when nothing is owed.
- A press after a change shows the existing stop-once notice (the box already checks `seenTotalCents` / `seenIds`).
- Make sure a payment from another tab can never be charged twice: the server must refuse when nothing is owed.

## 6. A chargeback the platform wins
Handle Stripe's `charge.dispute.closed` with status `won`. Stripe returns the money and the fee, so remove that chargeback's amount from what the developer owes. If they already paid it, refund that amount to their card and give them a receipt line ("Refund: your bank's chargeback of $X was reversed").
- If that was the only thing owed for a chargeback hold, the hold lifts as usual: Approve is still needed from the 4th hold on.
- Bell and email to the developer: "Your bank's chargeback of $X was reversed in your favour."

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check` until it's green.
- If a migration is needed, write it by hand and check it with:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with the db name swapped to playtest_lite_shadow> --exit-code`
  It must report "No difference detected". A stale Prisma client (you can't run `generate` while port 3400 runs) is then the only acceptable failure; say so if it happens.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, any migration, and any interpretations.
