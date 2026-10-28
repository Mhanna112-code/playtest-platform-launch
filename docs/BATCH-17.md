# Batch 17: rating rules (owner, Oct 28 evening)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 16 (bdafb1f).

## 1. Rate is disabled while something is still open, with a short line under it
**Tester:** the Rate box's button is disabled (not hidden) while any of these is true, with one short grey line under it naming the first that applies:
- a part or listed call they can still Charge or Let it go: "Charge or let go of your unreviewed work first."
- a dispute of theirs is open: "Rating opens once the team decides your dispute."
- work they sent is still inside its review window (today's rule: sent, not reviewed, Charge not open yet): "Rating opens on <date>, or sooner if <dev> reviews everything you sent." (<date> = the latest review date among those pieces; an unlisted part stops blocking at its review date, as today).
**Developer:** Rate for a tester is disabled while a dispute with that tester on this test is open: "Rating opens once the team decides <name>'s dispute." (today this is only a refusal after the press).
- The line and the button update live as things are decided.
- The server refuses the same cases with the same lines (a press from an old page).
- A tester can still open a dispute after rating (unchanged): rating only opens once everything is decided, so a later dispute can only be about a payment already made.

## 2. No rating during a suspension
While the developer side or the tester side is suspended, that side can't rate:
- The Rate box is hidden on their pages (the suspended tester's limited view from batch 16 §28 drops Rate; the developer's restricted test view has no Rate).
- A press from an old page is refused: "You can rate once your account is active again."
- The developer's 14-day rating window and reminders pause whenever the developer can't rate (their developer side suspended, a payment or chargeback hold, or the test paused by the team, where the paused view has no Rate) and continue afterwards. A tester's Rate has no end date, so only its reminders pause.
- The other side can still rate them (unchanged).

## 3. (Replaced by §12.)

## 4. Leftovers found by the batch 16 doc pass
- **No thanks on an invite** (`src/app/api/invites/[id]/route.ts` ~18–25) still uses the old refusals ("This invite closed: the test filled up." for `closed_full`, "This invite is closed."). Make it follow batch 16 §32 exactly like Join and Accept: a full test keeps the invite open (No thanks just declines it); a closed invite gets the §32 reason lines and the card goes; an invite re-sent on a new listing stops once (blue) instead of being refused.
- **The bell line "<tester> asked for a call: …"** links to `#needs-you`; make it open the Live session's Call requests panel with that request highlighted (batch 16 §35), like the Needs you row.
- Tests for both.

## 5. Admins can look people and tests up (owner, Oct 28)
Today the admin console's Accounts and Tests lists are newest-first pages of 25 with no search.
- **Accounts:** a search box above the list (name or email, any part, case-insensitive, server-side over every account) and tick boxes: Developer, Tester, Suspended, On a hold, Deleted. Results keep pages of 25 with "1–25 of N". Clearing the box brings the full list back.
- **Tests:** a search box (test name, product name or developer name/email, any part) and tick boxes: Open, Joining closed, Paused, Stopped / closed, Draft.
- Both update as typed (after a short pause); only that list reloads.

## 6. Suspend and Reinstate on a profile's admin view (owner, Oct 28)
On a tester or developer profile seen by an admin, next to the admin's history boxes: Suspend (per side, reason required up to 1,000 characters, with Preview) and Reinstate per suspended side, and Delete, exactly as in the Accounts list (same server actions and refusals: "That account's developer side is already suspended (by ana@…).", etc.).
- **Preview check:** Suspend and Reinstate send when the admin's Preview (or the page) was loaded; if another admin suspended, reinstated or deleted that side since, the press is refused naming who and when, and the profile's state updates. Same check added to the Accounts list.
- Tests: two admins racing (suspend/suspend, suspend/reinstate), a stale Preview, suspend vs delete (delete wins: "That account was deleted.").

## 7. Admin lists: scroll boxes that load as you scroll, no pages (owner, Oct 28)
Every paged admin list (console lists and the admin boxes on profiles and test pages: today "pages of 25 with Previous / Next and 1–25 of N") becomes a scroll box about 10 rows tall that loads the next 25 when you near its end (the existing cursors), with a small "Loading…" row and, at the end, "That's all (N)".
- The heading keeps the total: "Accounts (1,204)"; with a search or ticks: "Accounts: 12 match".
- Searching or ticking a filter resets the box to the top.
- Rows that arrive live while you're scrolled down don't move the list: a pill "3 new ↑" scrolls back to the top and shows them.
- Phones: the same box, full width.
- Tests: load past 25, the end line, filters reset, the new-rows pill.

## 8. Find tests: a search box, for testers and admins (owner, Oct 28)
- **Testers:** a "Search tests or developers" box at the top of Find tests (test name, product name or developer name, any part, case-insensitive, server-side), working together with the category chips, Device / Part / Sort by / Show filters. No match: "No open tests match “<typed>”." (Batch 16 §13's "Search by developer" on the tester dashboard stays as built.)
- **Admins get Find tests too** (a "Find tests" link in the admin header): the same page and search, but listing every test, not only those open to join: each card carries its state (Open, Full, Joining closed, Paused, Stopped, Closed, Draft, Invite only), with tick boxes for those states above the list. A card opens the test's public page with the admin's boxes (timeline, contract changes, payments). Admins never get Join / Apply.

## 9. Developer profile's "Open tests" stays current (owner, Oct 28)
On a developer's profile seen by a tester (batch 16 §14: invite-only tests listed only for testers invited to, applied to or in them):
- **Live:** the list updates on the page's poll; a test that pauses, fills up, stops, passes Open until, turns invite-only for this tester, or whose invite to this tester closes, leaves the list (a newly open test appears).
- **On press:** clicking a test that is no longer available to this tester opens its page with the usual refusal and nothing of the listing ("This test isn't available right now." for invite-only/paused/blocked; "This test is full." / "This test closed to new testers on <date>." / "This test was stopped." as today), and the profile list drops it on return.
- Tests: each change while the profile is open (leaves live), a stale click (refused page).

## 10. A suspended tester: only Dispute (owner, Oct 28; changes batch 16 §28)
In the suspended tester's limited view of tests they were removed from, **Dispute is the only press**. Charge and Let it go are hidden there (and refused on the server: "You can do this once your account is active again."); Rate is already gone (§2). Nothing is lost: Charge never happens on its own, so whatever was open to Charge or Let it go is still open when they're reinstated. Their calls were already cancelled when they were removed. The top line becomes: "Your account is paused. You can still dispute a payment."

## 11. The bank's check shows inline, under the button that charges (owner, Oct 28)
When the bank asks the developer to confirm a payment (3D Secure), its check opens inline directly under the button that was pressed, not as a pop-up: Pay and Pay more (test page), Pay what you owe, Subscribe and "Verify a card" (Payments). Confirm or cancel there; the result shows under the button. The piece stays locked while it's open (as today).
- **Charges made while the developer was away** (a tester's Charge, an automatic retry) that need the bank's check: the confirm lives on the **test page**, under the affected piece, as a "Confirm with your bank" button that opens the same inline check. Payments and the bell line ("Confirm this payment by <date>") link straight to that button (the piece highlighted), instead of having their own.
- The fake Stripe used in tests and recordings draws a clearly-marked stand-in for the bank's check ("Stand-in for your bank's check · Confirm / Cancel") in the same inline place, so recordings show the step.
- Tests: Pay with a check (confirm, cancel), Pay what you owe with a check, an away charge confirmed from the test page via the Payments link, the lock while open.

## 12. When a test stops while a page is open (owner, Oct 28; replaces batch 16 §25 for this moment)
"Stops" here = the developer's Stop, the team's Stop, the test closing (after 7 days paused, or Close now), and End early for that tester (DEFAULT: all treated alike). The next press on a page opened BEFORE the stop:
- **Stops once** with the stop as the change (developer's Stop, to testers: "Nora stopped this test at 3:10 PM."; the team's Stop: testers read only "This test was stopped at 3:10 PM." (never that the team did it, never the reason), the developer reads "The team stopped this test at 3:10 PM." with the reason on the banner; closing: "This test closed at …"; End early: "Nora ended your work early at …"); the second press goes ahead: tester's **Charge, Let it go**; developer's **Pay, Pay more**; **Rate on both sides**.
- **Refused:** Cancel call ("This call was cancelled when the test stopped.").
- **Go straight through, never stopped by the stop:** the tester's **Dispute**, the developer's side of a dispute, excerpt requests / Allow / Deny / Take down / Remove.
- A page opened AFTER the stop: everything still allowed goes straight through (batch 16 §25 as built), except the refusals in §1–2.
- **Dispute (tester) also goes straight through a suspension** of either side (it's available in the suspended tester's limited view, §10).
- On a running test, Dispute and Rate keep their usual stop-once for payment changes (e.g. a Pay more arriving before a Dispute; a payment arriving before the tester's Rate).
- **Rate and suspensions:** your own side suspended: Rate hidden and refused, window paused (§2). The OTHER side suspended or held while your page is open: Rate goes straight through, with no notice (a tester is never told a developer is suspended or on a hold).
- Tests: each press type × each kind of stop; page opened after the stop; Dispute during each suspension.

## 13. Small things found while recording batch 16
- The tester's stop box (e.g. for new terms) still says "Turn off alerts" and "You can turn these stops off below" when Alerts is already Off. With Alerts Off, drop both lines (only "Press <button> again to go ahead." / the terms tail remain).
- Edit shows the same red line twice ("Add 1 more key: 3 open spots, 2 free keys."): under the Free box and again below the key boxes. Show it once, under the Free box.

## 14. Rate: what stops it, and paused tests (owner, Oct 28)
- **A test paused by the team (nobody suspended or on a hold):** both sides can rate, straight through. Add Rate to the developer's paused view. A developer on a hold or suspended still can't rate (§2 and the 14-day pause).
- **On a running test, Rate stops once ONLY for changes about that person and your shared work** (replaces "every kind of change"):
  - Tester's Rate: the developer's Pay or Pay more on their work; a dispute of theirs decided.
  - Developer's Rate: the tester's Charge or Let it go; a dispute with them decided. (The tester can't send work any more once the developer can rate them.)
  - Both: the test stopping, closing, or that tester's work ending early (§12).
- **Rate ignores** everything else: other testers joining, leaving or sending; calls; listing edits; keys; Alerts; the other person's suspension or hold; the test being paused.
- A dispute opened meanwhile isn't a stop: Rate becomes disabled with its line (§1).
- Tests: each stopping change for each side; an ignored change going straight through; Rate on a team-paused test for both sides.

## 15. Stop the test needs a reason testers read (owner, Oct 28)
The developer's Stop pop-up ("Are you sure you want to stop “<test>”?") gets a required "Why?" box, like End early: up to 10,000 characters with "N / 10,000", Stop disabled ("Say why first") until it has text; the server refuses an empty or too-long reason. Testers read it in italics in a scroll box on their session page (under the stopped line) and in full in the email; never in the bell line. Also in the developer's Contract changes / History and the admin timeline. A paused or restricted developer's Stop needs it too. The team's Stop keeps its own reason, shown only to the developer (§12).

## 16. The developer rates a tester only after the tester has rated (owner, Oct 28)
The developer's Rate for a tester opens only when **everything that tester sent is settled** (paid, charged or let go; any dispute decided) **and the tester has rated** the developer. Until then the developer's Rate box is **hidden** (owner); a press from an old page is refused: "You can rate Ana once they've rated you and everything they sent is settled." The developer's 14 days (and the reminders "<tester> finished <test>. You can rate them for 14 days.") start then.
- **No tester deadline for rating (owner, final):** the tester's Rate keeps no end date (as today). The developer's Rate stays pending until the tester has rated and everything is settled, however long that takes; a tester who never rates is never rated by that developer. The developer's 14 days start when the tester rates.
- §14's developer-side stops for Charge / Let it go no longer apply (everything is settled before the developer can rate); a dispute opened after the tester rated still disables the developer's Rate until decided (§1), and its decision stops the developer's Rate once.
- Update ratings reminders, the dashboard "testers waiting to be rated" rows and the profile rating counts accordingly; tests for each path.

## 17. "Ratings to give" on both dashboards (owner, Oct 28)
A small box on each dashboard listing every rating the person can give right now, newest first, in a plain scroll box (batch 16 §14); each row links to the rating box (developer: that tester's row on the test page; tester: the session page's Rate box), highlighted for a few seconds.
- **Tester:** a row appears once everything they sent on that test is settled and no dispute of theirs is open (Rate available): "Rate Nora Lane on “Harbor Run”".
- **Developer:** a row appears once that tester has rated and everything they sent is settled (§16): "Rate Ana Silva on “Harbor Run” · 12 days left".
- Rows follow every Rate rule: they disappear live when Rate becomes unavailable (a dispute opens, the person's own side is suspended, a developer hold, already rated) and reappear when it's available again; a stale click lands on the page with the usual refusal.
- Hidden entirely while the viewer's own side is suspended (and for a developer on a hold).
- Replaces the developer's "testers waiting to be rated" rows and the tester's Rate rows in To do, so a rating is listed in one place.

## 18. "Tests visited" on the tester dashboard (owner, Oct 28)
A section listing every test the tester has **opened the join page of but never joined**, most recent visit first, in a plain scroll box (batch 16 §14). Each card shows the test, the developer and its state now, and opens the join page, which shows the matching state and refusal:
- Open ("Accepting testers"), Full, Joining closed ("Closed to new testers on <date>"), Paused, Stopped / Closed, Applied (waiting), Invited (links to the invitation).
- **Invite only and not invited:** the card says "Invite only"; the page shows only "This test isn't available right now." (the same as a paused test for someone not involved), nothing of the listing.
- A test from a developer blocked either way is left out (batch 16 §11).
- Each card has a small "Remove" (×) that drops it from the list (no confirm); opening the join page again brings it back.
- States update live (the dashboard poll).
- Storage: record (tester, test, last visited) when a signed-in tester opens a join page for a test they're not in. This needs a small table: hand-write the migration, check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code`, apply it only to the local playtest_lite DB, and say in the report that the 3400 server needs a restart.
- Tests: each state, invite-only not invited, Remove, a visit then joining (it leaves the list), blocked.

## 19. Close-out: 14 days after the last tester's deadline (owner, Oct 28; final)
Each test gets one **close-out date: 14 days after the last tester's deadline has passed** (moves later with pauses and outages, like deadlines). On that date:
- (Pay more: see below.)
- **Testers can no longer rate:** "Rating closed on <date>."
- **Charge / Let it go and the developer's Pay close**, except for pieces whose Charge opened less than 14 days before: **each piece gets at least 14 days of Charge** from when its Charge opened (Charge opens at the later of the tester's deadline and 7 days after sending), so such a piece keeps Charge / Let it go and the developer's Pay until 14 days after its Charge opened. When a piece closes unpaid: the developer's row leaves Needs you with "Closed on <date>: not paid."; the tester's part reads "Not paid (closed on <date>)".
- **The developer can rate a tester who never rated**, for 14 days from the close-out date (or from when that tester's last open piece settles or closes, if later), only if everything that tester sent was settled (paid, charged or let go). If anything closed unpaid, there's no rating of that tester.
- **Disputes are unchanged** (a dispute filed before its piece closed is still decided; a decision raising pay still charges the developer).
- Until a piece closes, the developer can still Pay it after its Charge opens (whichever comes first settles it).
- **Pay more closes together with the last Pay / Charge on the test (owner, final):** on the close-out date, or, if a piece's Charge window runs later (14 days after its Charge opened), on that later date. One date for the test; it replaces batch 16 §22's "30 days after the test ends". Its last-7-days line: "Pay more closes on <date>."
**Protections (DEFAULT, owner to confirm):**
- The Charge box and Needs you rows show "Charge closes on <date>" / "Pay closes on <date>" in their last 7 days; bell reminders 3 days and 1 day before close-out to whoever still has something open ("Charge or let go of your work on “<test>” by <date>" / "Pay <tester>'s work on “<test>” by <date>"); these emails ignore the email setting (money).
- A tester whose tester side is suspended during the window gets the suspended time added to their pieces' Charge windows (their Charge is hidden while suspended, §10), so a suspension never eats their Charge window.
- The "closes on" lines and reminders use each piece's own closing date (Charge, Pay) the test's last money date for Pay more, and the close-out date for Rate.
- Tests: close-out date with late joiners, pause shift, a suspended tester's extension, Pay / Pay more / Charge / Rate refused after close-out, the developer's rating after close-out, a dispute decided after close-out.

## Check and report
- Tests for each rule, both sides.
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- §18 needs a migration; for it (and any other), hand-write it, check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code`, and apply it only to the local playtest_lite DB.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md (it's updated after you report).
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
