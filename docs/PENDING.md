# Pending: decided or suggested, not built yet (owner, Oct 30)

Claude brings this list up when a batch lands and in summaries. Newest first.

## Waiting for the owner's go
- **Save cards only, no Stripe Link (before launch; found Oct 31).** Saving a card offers Stripe Link; a Link wallet doesn't ask the bank to confirm like the card itself, so off-session charges (tester Charge, retries, Decide) fail into a hold instead of waiting for Confirm. Ask Stripe for card-only when saving a card (payment_method_types card).
- **The admin's Decide should respect the bank-check lock (found Oct 31).** Decide charges a dispute's extra without checking pieceLocked; if the developer's own Pay more on that piece is waiting for their bank (up to 15 min), both could go through and the piece end up paid more than decided. Fix: Decide on a locked piece is refused ("The developer is confirming a payment for this piece with their bank. Decide again once it's confirmed or fails."), or the waiting amount counts as paid when the extra is worked out.
- **Admins can lift any kind of hold, then a suspension (owner, Oct 31).** A team button to lift a payment hold or a chargeback hold directly (with a reason; what is owed stays owed or is written off — to decide), and once no hold is left, Reinstate works on the developer side as usual (today a held developer side can't be reinstated).
- **Flaky tests to fix:** batch22 "two admins at once" (race), batch17-rate §12 and codex9 "resource_missing" (~1 in 3), batch34-invite-beats-application "asked to rejoin first…" (rare), batch16-account-tabs (once).
- **Open question: drafts propagating to old tabs (owner, Oct 31).** Today unsent typing never shows in another open tab until it reloads (one shared draft per form, last typed wins). Should an old tab learn about a newer draft typed in another tab (e.g. a "You have newer unsent changes from another tab · Load them" line), or keep showing its own?
- **"You can't join this test again." should say why** (e.g. "<Dev> rated your work on this test, so this test is finished for you."); today the generic line covers a developer's rating of the tester.
- **A new Post form starts with "Productivity" ticked** under Categories, and a posted listing can carry categories the form didn't show ticked (seen while making the launch reels).
- **Developer Alerts per test, not per account (owner, Oct 31).** Today the developer's Alerts ticks (User.ignoredAlerts) apply to every test they have; the owner wants them per test, and a Next round starts with every alert on (nothing carried over). Needs a Test-level column (migration) and the Alerts menu / devChanges filter reading the test's list. Also: the menu always shows every kind (Applications and Joins too), greying the ones that can't happen in the test's current state (e.g. stopped) so "(N off)" matches the ticks shown.
- **Two admins pressing Lift the pause at the same instant (found Oct 31).** tests/batch22.test.ts "two admins at once" fails about 1 run in 3: the loser's refusal can name the wrong admin ("You already lifted…"). An existing race between two simultaneous presses, made slightly more likely by batch 35 §51's per-press logging; fix by locking the test row around the check and the lift.
- **Admin "Your actions" links go to the action on the same page (owner, Oct 31).** Each line in the console's "Your actions" list takes the admin to that action's row or box on the same page (scroll + mark, like See it), instead of opening another page.
- **Found by the last screenshot run (Oct 31), not fixed yet:** (1) the admin's test Timeline can quote the wrong reason for a pause when Pause and Stop happen within seconds (both read the test's single adminNote; src/lib/server/adminLists.ts ~line 752); (2) the needs pop-up shows a language icon next to "A device this test runs on"; (3) once, Delete account after the same admin's Suspend in another tab went straight through (likely the page had redrawn and shown the suspension, which counts as seen; recheck); (4) recordings made before Oct 31 have no length, so their time bar can't be dragged (new ones can).
- **Per-field drafts (after launch; owner, Oct 31).** Today a form's draft is the whole form from the tab typed in last. Per-field: each tab sends only the fields it changed, the server keeps each field's latest (related fields as one unit: Parts and prices as ONE unit for all three parts (owner, Oct 31), Mature + why, questions + required ones; every other Edit field on its own; written answers per question). About 1½–2 hours.
- **Join page: show what changed, not just which fields.** The blue "Changed since you opened this page" box (and the stop box under Join) lists Before → Now for each changed field (short values inline; description, questions and NDA in small scroll boxes of about 8 lines), instead of "questions · See it". About 30–45 min.

## Decided, not doing (owner, Oct 30)
- Bank-check stalling on Charge (Oct 31): keep the lock as is (a developer's open bank check locks the piece for up to 15 minutes; no limit on repeats).
- Back/Forward and paying-twice recordings (Pay on a restored page, Pay what you owe from an older tab): the owner tests these by hand; no recordings.
- Local "Testing" buttons for Charge: no (the owner tests by hand; Claude moves a session's dates on request).
- Listing changes have no tester bell/email line; an on-time part updated after the deadline becomes late: both stay as they are.
- A read-only session view for admins: not now.
- Repeat chargebacks: no automatic suspension (each one is a new chargeback hold; "More than 3 holds" flags them; the team can suspend).
- Dropping one side of an account: left out for launch.
- The admin's Suspend "Why" box cleared by a live update: the owner will test; fix only if it happens.

## Being built (Codex)
- Task 3: the paperclip (files placed at the cursor in written answers).
- Task 4: the admin top bar (Dashboard, Developers, Testers, Tests).
- Task 5: Accept / Decline, Invite and Cancel invite stop only for needed devices/languages and a 1-star rating change, named.
- Task 6: the reserved Pay what you owe: label "$X is charged after the team approves", no "added since" sentence.
- Task 7: the design doc for batches 32–34.
- Task 8: the two sides as two separate accounts (only the switch button; notifications per side; no in-between switch page; delete says both sides).

## After Codex lands
- **Stripe proof, light** (owner, Oct 30: "only a couple"): two screenshots from Stripe test mode in the final run (the reservation Uncaptured, then Succeeded after Approve). No recording.
- Join page listing section as the same Listing panel (the pop-up's See it already scrolls to the current section).
- One screenshot run (Codex features + the side-leak proof) and the report republished with everything (incl. the 20 batch 34 admin screenshots).
