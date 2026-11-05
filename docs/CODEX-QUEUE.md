# Codex queue (updated Nov 2): paste each block into Codex as its own task, in this order

Start with docs/RESUME-CODEX.md. Everything not listed here is done and merged.

## 1. Task 29: One card in play; bank checks never double-charge (money: do first)

```
Read AGENTS.md first and follow it. Task number: 29 (schema codex29, build folder .next-codex29, branch codex/one-card-checks,
worktree C:/Users/march/Projects/pl-codex-29, branched from master).

Owner decision (Nov 2): make bank confirmations ("Confirm with your bank", src/lib/server/confirm.ts) and "Pay what you owe"
(src/lib/server/holds.ts payOwed / chargeOwedOne / retryOwed, owedForBox; the chargeback path in chargeback.ts) as simple as
possible, with NO way to pay the same thing twice. Today: a Confirm may finish an old check on an OLD card or retry on the card on
file (confirmStart); saving a card retries plain debts but leaves waiting checks alone; when a check's 3 days run out
(expireActions) the app stops tracking it WITHOUT cancelling it at Stripe (an old bank page could still complete it later, while the
debt is retried and charged again); a Pay what you owe press cancels a debt's waiting check right before charging (a same-second
race with finishing that check in another tab could charge twice).

Rules to build:
1. ONE CARD IN PLAY. Saving a new card cancels every waiting bank check at Stripe (debts and new charges made while away) and tries
   each item again on the NEW card at once: goes through -> paid; the bank asks -> a new "Confirm with your bank" item on the new
   card (3 days); declined -> a debt stays owed / a new charge becomes a debt (a hold, or added to the current one). "Confirm with your
   bank" therefore always means "approve it on my current card": confirmStart never finishes a check made on another card.
2. (Owner: no change) A declined or failed Confirm keeps today's rule: the item keeps waiting until its 3-day date, then a new charge
   becomes a debt and a debt stays owed. When that date passes, rule 4 applies.
3. A WAITING DEBT IS LOCKED IN PAY WHAT YOU OWE. A debt with a bank check waiting shows "Waiting for your bank" and is NOT charged by
   a Pay what you owe press, a daily retry or a new-card retry (other debts are). Next to it: "Cancel this check" (cancels at Stripe,
   the debt becomes payable at once). The same during a chargeback hold's Pay what you owe (reservation).
4. NEVER AN ORPHAN CHECK. Whenever the app stops tracking a check (3 days ran out, failed, cancelled, replaced by a new card, the
   hold lifted another way), it cancels the PaymentIntent at Stripe first; if Stripe says it already SUCCEEDED, the app records that
   payment as paid instead (and does not charge the item again).
6. (Added Nov 2) PAY WHAT YOU OWE IS ONE PAYMENT. A Pay what you owe press and every retry (daily / new card) charge the TOTAL of what's
   owed as ONE payment: one charge, one bank check if the card asks, one "Confirm with your bank" item and one lock on the whole
   box (rule 3 then always covers every debt at once; "Cancel this check" cancels the one check and the whole box is payable again).
   Approved: every debt in it is paid together and the hold lifts as today. The box, the confirm item, the receipt and the email still
   LIST the payments it covers (each item's name and amount, as owedItemName / the box lines do today), and each covered debt is
   marked paid by that one payment (keep a link from each debt to the payment that paid it, for the admin's views and refunds).
   The chargeback hold's reservation already works this way; keep it.
5. Before charging any debt (press, retry, chargeback steps), re-check that it has no waiting check and isn't paid (inside the
   existing claim: owed -> paying in one updateMany).
Testers never see "hold", "failed" or "chargeback"; keep today's tags ("Payment delayed" / "Paid").

Tests in tests/batch35-one-card-checks.test.ts (fake Stripe): Pay what you owe with three debts makes one charge / one check, lists all three, and marks all three paid on approval; new card cancels old checks and retries on the new card (each outcome);
a declined Confirm still waits until its date; a waiting debt is skipped by press and retries and payable after Cancel this
check; an expired check is cancelled at Stripe, and one that had already succeeded is recorded as paid with no second charge; a
press and a check finishing at the same moment charge once. Update tests that expected old behaviour. Append "## §117 One card in
play; bank checks never double-charge (owner, Nov 2)" to docs/BATCH-35.md. npm run check green (known flaky list as in the earlier
tasks). Commit on the branch; don't push or merge.
```

## 2. Task 25: New charges during a hold wait until it lifts (money)

```
Read AGENTS.md first and follow it. Task number: 25 (schema codex25, build folder .next-codex25, branch codex/charges-after-lift,
worktree C:/Users/march/Projects/pl-codex-25, branched from master).

Owner decision (Nov 1): while a developer is on a payment hold or a chargeback hold, NEW charges that arrive during the hold must
not be added to what they owe (today they are, so "Pay what you owe" keeps changing under them and a chargeback hold's
reservation stops covering it: see owedForBox / reservedAddedLine / the "addedCents" step in src/lib/server/chargeback.ts and
holds.ts). New charges = a tester's Charge, a listed call charged automatically (autoChargeCalls), a team dispute decision that
raises pay, anything else the hold code currently turns into "owed" after holdStartedAt.

Wanted:
- During the hold those charges are recorded as waiting until the hold lifts (reuse the existing "deferred" status a developer-side
  suspension already uses for auto-charged calls, if it fits; otherwise a clear new status), NOT owed. "Pay what you owe" (and a
  chargeback hold's amount and reservation) covers only what was owed when the hold began plus the charged-back amount, so paying
  it can lift the hold.
- The moment the hold lifts (paid off, the team's Approve for a chargeback hold or the 4th-hold review, or an admin lifting it),
  each waiting charge is made automatically, oldest first, as a charge made while the developer is away: the bank may ask to
  confirm (needs_confirmation, 3 days, "Your bank wants you to confirm"), a decline starts a NEW payment hold as today.
- Testers read "Payment delayed" on those parts until then (the batch 35 §97 tag; never "hold", "suspended", "failed" or
  "chargeback"); the developer's Payments shows them under "Charged once your tests resume" with amounts, not in Pay what you owe.
- (Added Nov 2) A charge whose bank check started BEFORE the hold and whose 3 days run out DURING the hold also joins "Charged once
  your tests resume" (it is not added to Pay what you owe). Pay what you owe only ever holds what was owed when the hold began.
- Nothing changes for charges made when no hold is on.
Tests in tests/batch35-charges-after-lift.test.ts: a tester's Charge during a payment hold isn't added to Pay what you owe; paying
what was owed lifts the hold and then charges the waiting Charge; the same for a chargeback hold (its reservation isn't topped up);
a waiting charge that declines after the lift starts a new hold; no hold -> unchanged. Update tests that expected new charges to be
added to what's owed during a hold. Append "## §113 New charges during a hold wait until it lifts (owner, Nov 1)" to
docs/BATCH-35.md. npm run check green (known flaky list as in the earlier tasks). Commit on the branch; don't push or merge.
```

## 3. Task 27: An attachment placed in the text shows once

```
Read AGENTS.md first and follow it. Task number: 27 (schema codex27, build folder .next-codex27, branch codex/attachment-once,
worktree C:/Users/march/Projects/pl-codex-27, branched from master).

Bug (owner, Nov 1): a tester attached an image in a written answer ("Anything else" box) and placed it in the text (the
"[📎 name.jpg #id]" marker from the answer editor's paperclip). On the DEVELOPER's view of the sent answers the image showed twice:
once inline where the marker is, and again in the attachments list under the answer (src/components/AttachmentList.tsx and
wherever written answers render their attachments: search for the marker parsing, e.g. "#ux" / paperclip / AttachmentList, in
src/components and src/app/app/tests/[id]). The tester's editor preview shows it once. Confirm this is the cause first.

Wanted: a file placed inline in an answer's text is shown only there; the attachments list under that answer lists only the files
NOT placed in its text (and is hidden when it has none). Same rule everywhere sent answers are shown (developer test page, Needs
you, the tester's own sent view, the admin's dispute "See the work", updated-version views, history). Downloads / open-in-new-tab
for inline files keep working.
Tests in tests/batch35-attachment-once.test.ts: an answer with one inline image and one not-inline file shows the image once inline
and lists only the other file; an answer with only inline files has no list. Append "## §115 An inline attachment shows once
(owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky list as in the earlier tasks). Commit on the branch; don't push
or merge.
```

## 4. Task 26: Signing up again with a deleted account's email: DONE (Nov 5)

Built by Claude on branch feat/reuse-email: see BATCH-35 §114 (the owner's Nov 5 wording "This account was closed."; an admin's deletion is not clean). Don't paste this one into Codex.

## 5. Task 22: Your own page is the page load on every side (optional)

```
Read AGENTS.md first and follow it. Task number: 22 (schema codex22, build folder .next-codex22, branch codex/page-load-own,
worktree C:/Users/march/Projects/pl-codex-22, branched from master).

docs/BATCH-35.md §51 made the ADMIN side treat "your own page" as the same PAGE LOAD (x-load, src/app/admin/PageLoad.tsx,
ActionLog "admin-tab"). The developer and tester sides still key their own actions on the per-tab id (src/lib/server/live.ts
tabOf / ownChanges, ActionLog.tab; src/lib/client.ts TAB / PAGE_LOAD). Make developer and tester own-action checks use the page
load the same way (a press without x-load falls back to x-tab, as on the admin side), so: a press from the page that made the
change never stops itself; a page drawn after the change goes straight through, even in the same tab; a page drawn before it
(another tab, or the same tab via Back) stops once.
Also change the wording everywhere from "in another tab" to "on another page or tab" (search the rules and server text; keep one
helper for it), and update the tests that expect the old words.
Tests in tests/batch35-page-load-own.test.ts for developer and tester: same page load never stops; same tab, later page load goes
through; earlier page load in the same tab stops once with "on another page or tab". Append "## §110 Your own page is the page
load on every side (owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky list as in the earlier tasks). Commit on
the branch; don't push or merge.
```
