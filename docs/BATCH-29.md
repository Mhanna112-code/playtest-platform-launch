# Batch 29: the same stop-once rules everywhere, and your own changes in another tab (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 28 (moved out of batch 28 so launch isn't held up by it; sections keep their batch 28 numbers).

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

## 20. Leftovers from the batch 27 design doc check (not launch-critical)
- **Dashboard Join call and new terms:** a Join call from the tester dashboard's Upcoming calls refused with "Answer the new terms first: Switch or Keep." gives no way to the offer: add "Answer them on the session page →" opening the session page at the Switch / Keep box, highlighted.
- **Charge / Let it go and new terms:** their stop box ends "Press again to send under your current terms, or switch first." (testerTermsGate, terms.ts); "send" reads oddly there: "Press again to go ahead under your current terms, or switch first."
- **Admin Tests row text** (adminLists.ts testRow): "the team" fallback when an admin's name is missing; "at" before the time in the no-lift branch; pair a lift with the pause it ended (check order).
- **A team-paused test closed after 7 days** (pauseClosure.ts keeps adminPausedAt): its admin row must read as closed, with no Lift the pause.
- **Admin live check covers only the first 25 rows:** rows loaded further down by scrolling must follow pause changes too.
- **One wording:** the form's "Pick a time in the future." vs the server's "Pick times in the future.": use "Pick a time in the future." everywhere.
- **Local call lead:** the forms always use 1 minute in the browser (CALL_MIN_AHEAD_MINUTES isn't public); expose it as NEXT_PUBLIC_ or pass it from the server so form and server agree.
- Fix the garbled characters in goNextRound's comment (tests.ts); confirm "Go to the next round" opens at once on a paused test (trace devGate's quiet state) and add a test.

## 21. Rating reminders (owner, Oct 29)
- **The developer's reminders come on running tests too.** Today "Reminder: rate <tester> for “<test>” (until <date>)" is sent every 3 days only on a stopped test (ratings.ts ~352); on a running test the developer gets just the first line ("<tester> finished <test>. You can rate them for 14 days."). Send it every 3 days inside the 14 days whatever the test's state, waiting while the developer can't rate (hold, suspension).
- **Rating lines get their own stack, on both sides:** "<tester> finished <test>. You can rate them…", the developer's reminders, the tester's "Rate <dev> on <test>" and its reminders no longer stack in "that test's day"; they stack in one "Ratings to give" entry per day across tests (like payments and holds), opening the dashboard's Ratings to give box. Update the bell table's "Stacks in" column (doc agent).
- Tests: reminders on a running test; the new stack across two tests.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
