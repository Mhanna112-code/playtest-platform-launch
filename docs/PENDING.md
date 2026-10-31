# Pending: decided or suggested, not built yet (owner, Oct 30)

Claude brings this list up when a batch lands and in summaries. Newest first.

## Waiting for the owner's go
- **Developer Alerts per test, not per account (owner, Oct 31).** Today the developer's Alerts ticks (User.ignoredAlerts) apply to every test they have; the owner wants them per test, and a Next round starts with every alert on (nothing carried over). Needs a Test-level column (migration) and the Alerts menu / devChanges filter reading the test's list. Also: the menu always shows every kind (Applications and Joins too), greying the ones that can't happen in the test's current state (e.g. stopped) so "(N off)" matches the ticks shown.
- **Two admins pressing Lift the pause at the same instant (found Oct 31).** tests/batch22.test.ts "two admins at once" fails about 1 run in 3: the loser's refusal can name the wrong admin ("You already lifted…"). An existing race between two simultaneous presses, made slightly more likely by batch 35 §51's per-press logging; fix by locking the test row around the check and the lift.
- **Admin "Your actions" links go to the action on the same page (owner, Oct 31).** Each line in the console's "Your actions" list takes the admin to that action's row or box on the same page (scroll + mark, like See it), instead of opening another page.
- **Found by the last screenshot run (Oct 31), not fixed yet:** (1) the admin's test Timeline can quote the wrong reason for a pause when Pause and Stop happen within seconds (both read the test's single adminNote; src/lib/server/adminLists.ts ~line 752); (2) the needs pop-up shows a language icon next to "A device this test runs on"; (3) once, Delete account after the same admin's Suspend in another tab went straight through (likely the page had redrawn and shown the suspension, which counts as seen; recheck); (4) recordings made before Oct 31 have no length, so their time bar can't be dragged (new ones can).
- **Per-field drafts (after launch; owner, Oct 31).** Today a form's draft is the whole form from the tab typed in last. Per-field: each tab sends only the fields it changed, the server keeps each field's latest (related fields as one unit: Parts and prices as ONE unit for all three parts (owner, Oct 31), Mature + why, questions + required ones; every other Edit field on its own; written answers per question). About 1½–2 hours.
- **Join page: show what changed, not just which fields.** The blue "Changed since you opened this page" box (and the stop box under Join) lists Before → Now for each changed field (short values inline; description, questions and NDA in small scroll boxes of about 8 lines), instead of "questions · See it". About 30–45 min.

## Decided, not doing (owner, Oct 30)
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
