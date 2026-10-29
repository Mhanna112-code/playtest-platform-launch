# Batch 30: after launch (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after launch.

## 35. Storage running out: tell the admins, inside and outside the app (owner, Oct 29)
- Once a day (the daily timed run) the app measures the database's size (pg_database_size) and the total size of stored uploads (from its own records of R2 files). Limits come from settings: `DB_STORAGE_LIMIT_GB` (e.g. 0.5 on Neon's free plan, the plan's size on a paid one) and `UPLOADS_LIMIT_GB` (the R2 budget); unset = not checked.
- At 80% or more of either: a red box at the top of the admin console ("Storage is 82% full: database 410 MB of 500 MB." / "Uploads are 85% full: 8.5 GB of 10 GB."), one admin bell line per crossing ("Storage is filling up (database 82%)"), and the keyed /api/health answers "degraded: storage" (HTTP 200, alongside the emails keyword), so the UptimeRobot keyword monitor alerts the owner outside the app. Under 80% again: the box goes.
- HANDOVER: set the two limits; add "degraded: storage" to the keyword monitor; also turn on Neon's usage alerts (Neon console) and Cloudflare's billing notifications for R2.
- Tests: 79% → nothing; 81% → box, one bell line, health keyword; back under → gone; limits unset → no check.

## 2. Sending a part again after it's paid (owner, Oct 29)
Today a paid part is locked ("Your written answers were already paid for, so they can't be changed. Send anything new in the chat."). New:
- After a part is paid, the tester can send an updated version (written answers or a recording; attachments included). Above Send: "<dev> has paid $X for this. An update can be paid more, up to $Y in all." (or, at the cap, "This part is already paid the most it can be ($X): <dev> can't pay more for an update.").
- **Below the cap:** the update appears in the developer's Needs you as its own row, "Ana sent an updated version after you paid ($10.00 paid · up to $990.00 more)", with the piece's **Pay more** box right there (any amount up to the piece's cap, $0 closes the row with an optional note; the usual ticks). Pay more pays the same piece (no new piece, no Charge, no countdown reminders: the part was already reviewed). The row leaves Needs you once Pay more is pressed (any amount, $0 included) or Pay more closes.
- **At the cap:** the update doesn't go into Needs you (nothing more can be paid). The developer sees it on the tester's row ("Updated after you paid · already paid the most") and as a quiet live-box line, "Ana sent an updated version of their written answers (already paid the most)"; no bell stop beyond the usual Work sent alert.
- Disputes: an update doesn't reopen a dispute; the existing rules apply to the piece's total.
- Tests: update below the cap → Needs you row with Pay more; $0 closes it; at the cap → no Needs you row, the quiet line; Pay more closed → the row leaves.

## 3. Late work: no Charge (owner, Oct 29)
A listed part (written answers or a recording) sent after the tester's own deadline never opens Charge or Let it go: only the developer's own Pay settles it, like unlisted work.
- **Developer:** the piece sits in Needs you with its Pay box (starting at the listing), labelled "Sent late (deadline was <date>)"; any amount, $0 included (below the listing still needs the reason the tester reads). Review reminders count down to its review date (7 days after sending) like other work, then stop; it isn't in the daily "Pay now" line (§31 of batch 29) since the tester can't charge. If still unpaid at the piece's closing date it closes "Closed on <date>: not paid." as other pieces do.
- **Tester, before sending after their deadline:** a grey line above Send: "Your deadline passed on <date>. You can still send this: <dev> decides what to pay for late work, and you can't charge for it." After sending: "Sent late (deadline was <date>): <dev> decides what to pay. You can't charge for late work." Dispute still works on whatever is paid (once, up to the cap).
- An update of a late piece stays late; an update sent before the deadline of a piece first sent on time stays on time.
- Listed calls are unchanged (a call is booked by both sides; it's still charged automatically after 7 days).
- Post's Charge tick, the Terms and the design doc: Charge applies to listed work sent by the tester's deadline (doc agent for the doc).
- Tests: on-time listed work → Charge opens as today; late listed work → no Charge / Let it go anywhere (UI and server: "You can't charge for work sent after your deadline."), Pay works, closes unpaid at its closing date; the tester's lines before and after sending.

## 4. Remove a Rate rule that can never apply (owner, Oct 29)
The developer's Rate "stops once for call changes between the two of them on a running test while that tester is still working" can never trigger: the developer's Rate only opens after the tester rated (which ends their part) or at close-out. Remove it from the stop list (the developer's Rate keeps: a dispute with that tester decided; their own Pay more to that tester in another tab or device; the stop itself on a page opened before it) and from the design doc's "Why a press stops: Rate" (doc agent). Tests unchanged in behaviour.

## 5. Admin: close a developer's open reviews at $0, with a reason (owner, Oct 29)
For abuse cases (spam testers, a fraudulent test, an abandoned account), the team can settle every unpaid piece at $0 on the developer's behalf.
- **Where:** the developer's admin box (profile and Accounts list): "Close all open reviews for $0", and on a test's admin box: "Close this test's open reviews for $0".
- **Preview first** (like Suspend's): "This closes 7 pieces from 4 testers on 3 tests at $0: …" (the list), then a required reason (5+ characters, up to 1,000; testers read it), then the button. The race check: anything paid, charged or let go since the preview is left alone, and the result says so ("5 closed; 2 were settled meanwhile").
- **What it does:** every sent piece still unpaid (listed or unlisted written answers and recordings, and listed calls not yet charged) is paid $0 with the team's reason as its note: "The team closed this for $0: <reason>". Charge / Let it go and the automatic call charge no longer apply to them; their Needs you rows go; reminders stop. Nothing is charged to anyone.
- **Testers:** a payment line ("<test>: the team closed your <part> for $0") in the bell's "You were paid" stack and the payment email, the reason on the session page. It's final (owner, Oct 29): no dispute on a team closure ("The team closed this for $0, so it can't be disputed.").
- **Developer:** one line ("The team closed 7 open reviews on your tests for $0") in their account stack and email, with the reason.
- Logged in the admin history (who, when, reason, count); the developer's and the tests' timelines show it in the third person.
- Tests: preview counts; closing settles exactly the open pieces; a race with a Pay; Dispute disabled with its line; nothing charged.

## 6. Leftovers from the batch 29 design doc check
- "Pay now" and "Closing soon" link to `/app#needs-you`, but pieces to pay are in "Needs review" (`#needs-review`) and Needs you isn't rendered when empty: link to where the pieces are (open the dashboard at Needs review, marked).
- "This test closed to new testers on <date>." (closedToNewLine, tests.ts closeJoiningAfterOpenUntil) now stacks across tests in "Applications and invites" without naming the test: "“<test>” closed to new testers on <date>."
- "Your invite to “<test>” was closed." is only in the live box (api/live/route.ts): add it as a bell line in "Applications and invites" (per batch 29 §23).
- The dashboard Calls box Cancel (CallsBox.tsx) sends no seenAt, so it skips stop-once: send it and gate it like the test page's Cancel.
- goNextRound skips the stop-once gate whenever Open until has passed (`const closed = openUntil < now`): remove the skip (batch 29 §11: stop-once everywhere).
- Dead code: bell.ts group titles textra, appclosed, reinvited, team, disputes, trejected; rules.ts bankConfirmLine, bankConfirmTestLine, chargeByLine, payByLine.
- The session route's comment above LIMITED_ACTIONS still says Dispute, Charge, Let it go and Rate work "on the first press": fix the comment.

## 7. Invite search says why a person isn't listed (owner, Oct 29)
Searching the Invite panel for someone who can't be invited shows "No testers match “fbbb”." even when fbbb is already invited. Instead, a matching person who isn't invitable shows as a greyed row with the reason, no tick box:
- already invited: "fbbb · already invited, waiting for them to join" (with the invite's Cancel invite reachable from the Invited list above, which scrolls into view and marks their row);
- already in this test: "fbbb · already in this test";
- applied / asked to rejoin: "fbbb · applied: answer them in Needs you →";
- in 10 tests or suspended: the existing "Can't join this test";
- blocked either way: not shown (never revealed), so the plain "No testers match" stays for them.
Tests: a search for an invited, a joined and an applying tester shows the right line; a blocked one shows nothing.

## 8. A new invite shows on the tester dashboard live (owner, Oct 29)
The owner had the tester dashboard open; a new invite only appeared after a reload. The dashboard does poll (AutoRefresh "invites=1", every 20 s, fingerprinting all the tester's invites), but: (a) its baseline is the first poll after mount, not what the server rendered, so an invite arriving between render and that first poll is never noticed; (b) the top box ("invites:me") only announces invites closing, never a new one, so nothing tells the tester when the page does update. Fix:
- Seed AutoRefresh's baseline from the server-rendered fingerprint (pass it from the page), so any change after render refreshes on the next poll.
- A new invite (and a re-sent one) shows as a top-box line, "Marc Hanna invited you to “ddddd”", raising the pill like other updates, and the Invitations section appears in place.
- Check the same baseline issue for every other AutoRefresh user (developer dashboard, Payments, the bank box, Ratings to give) and fix it the same way.
- Tests: an invite created right after render shows on the next poll; the top-box line and pill.

## 9. A locked field's change is named, and locked boxes are really locked (owner, Oct 29)
Edit refused Save with only "You've changed the parts and prices 3 times since testers joined. Contact us in Settings to change it again." while the cause (a changed live call rate, outlined red far up the page) wasn't named, and the price boxes could still be typed in although the group was locked. The 3-changes-per-field rule itself stays (parts and prices remain ONE counter; owner, Oct 29).
- Once a field (group) is locked, every input in it is disabled: for parts and prices that includes the price, rate and call-length boxes, not only the ticks.
- If a locked field still differs (another tab's save locked it meanwhile), the line at Save names the change and links to it: "Your change to the live call rate ($24.00/h → $30.00/h) can't be saved: you've changed the parts and prices 3 times since testers joined." with **Put it back** (restores the saved value) beside it; the field name scrolls to the field, marked.
- Tests: locked price boxes disabled; another tab locking it meanwhile → the named line and Put it back; after Put it back the other changes save.

## Decided, no change (owner, Oct 29)
- **Charge / Let it go stays** for listed written answers and recordings (the owner said no to charging listed work automatically at its review date; only listed calls are charged automatically).
- **The tester's Rate still closes at the test's close-out**, not at their own pieces' closing date (a last tester who waits past the close-out to Charge can't rate any more). Don't change it.
- **Late sending stays** (a tester can still send after their own deadline, "Sent late (deadline was <date>)"); work isn't closed at the deadline. What changes for late work is §3.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
