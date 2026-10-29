# Batch 20 (owner, Oct 28 night)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 19 (04ccd67) and its recordings.

## 1. More than 3 questions: a scroll box, not "+N more"
Wherever a list of questions is shown read-only (the listing and join page, the tester's session page terms and "Your agreed scope", the Switch / Keep offer box's Before and Offered, Terms history, the developer's Contract changes, Find cards if they list questions, admin "See the work" question labels outside the answers), a list of more than 3 questions sits in a scroll box about 3 questions tall, every question inside (no "+N more"). Each long question keeps its own clamp (3 lines, "Show more") inside the box. 3 or fewer questions show without a box. **The tester's answer form on the session page too (owner):** with more than 3 questions, the questions and their answer boxes sit in a scroll box about 3 questions tall (each answer box keeps its toolbar); the "N / 50,000" counter, the files box and Send stay outside, below it, always visible; a red mistake on a question scrolls the box to it. Post and Edit (where questions are typed) are unchanged. Phones: same box, full width.
Tests: 2 questions (no box), 4 and 20 questions (box, all present), a long question clamped inside.

## 2. The 20-question limit shows as soon as it's reached (owner, Oct 28)
On Post, Edit and posting a draft, as soon as the questions list reaches 20, a line shows right in the questions box, under the last question: "At most 20 questions." and the "Add a question" button is disabled (greyed, same line as its tooltip). Deleting a question removes the line and enables the button again. It's a notice, not a mistake (not red, doesn't block Save or Post). The server still refuses more than 20 as today.
Tests: 19 → no line; 20 → line and disabled button; delete one → back.

## 3. "Invite anyway" names every missing need (owner, Oct 28)
Today the Invite anyway box (and its server lines, `missingNeed` in src/lib/server/invites.ts) names only one kind of need: the missing languages if any, else the missing devices. A tester missing both only hears about the languages. Change:
- Each ticked tester gets one line naming everything they're missing, both kinds: "fbbb doesn't list a language this test needs (Chinese or Portuguese) or a device it needs (Windows PC, Switch, VR headset, Steam Deck, iPhone, Android phone, iPad or Android tablet)." With only one kind missing, only that part.
- A long device or language list is cut to its first 3 with "+N more", which opens the rest in place (like the row tags' "+7 more" / "fewer").
- More than 3 testers in the box: their lines sit in a scroll box about 3 lines tall; Invite anyway / Cancel stay below it.
- The server's gap lines (and the `seenGaps` comparison) use the same full wording, so a stale box is still detected.
- Same for the tester's "Join anyway" box and the batch 16 §31 Invite stop lines where they name needs.
- Tests: missing languages only, devices only, both; long lists; 5 testers.

## 4. Invite stops only for profile changes that matter to this test (owner, Oct 28)
Batch 16 §31 stops Invite for any change to a ticked tester's devices or languages, one line per edit (e.g. "fbbb changed their languages: Chinese → Chinese, French", "…devices: VR headset → VR headset, Android tablet, iPad, PlayStation, Xbox"). Change it:
- Only languages and devices **this test requires** count. Adding or removing anything else (French, PlayStation, Xbox when the test doesn't need them) never stops Invite and isn't listed.
- **One line per tester, the net change since the page loaded**, naming only the required items: "fbbb now lists Chinese and Windows PC, which this test needs." / "fbbb no longer lists Chinese, which this test needs." / both in one line: "fbbb now lists Windows PC but no longer lists Chinese (this test needs Chinese or Portuguese)." No times-per-edit list; one time (the latest change).
- If the edits cancel out (added then removed the same required item), there's no line and no stop.
- The test's own requirement changes (Edit) keep their line ("The test's requirements changed: …").
- Same rule for the tester's Join / Apply stops about their own profile, if any.
- Tests: an unrelated language/device (no stop), a required one added, removed, both, added-then-removed (no stop), several edits collapsing into one line.

## 5. Confirm 18+ when creating an account (owner, Oct 28)
- **Sign-up (email):** a required tick next to the Terms agreement: "I'm 18 or older." Sign up stays refused until ticked (red, §10 mistake rules): "You must be 18 or older to use Playtest." The server refuses the same.
- **Sign-up with Google:** after Google returns for a new account, one short step before the account is used: the same tick plus the Terms agreement, then Continue. No account is created until it's ticked.
- **Existing accounts:** not asked (owner, §21): nothing has launched, so only sign-up confirms age.
- Store when the age was confirmed (a nullable `User.ageConfirmedAt`; hand-write the migration, check it with `prisma migrate diff` against playtest_lite_shadow with --exit-code, apply only to the local playtest_lite DB, and say the 3400 server needs a restart).
- **Terms:** make sure they say "You must be 18 or older to use Playtest." (add it to version 2 and its What changed if missing; nothing has launched).
- Tests: email sign-up unticked/ticked, Google new account step, an existing account's updated-Terms box, server refusals.

## 6. Developer profile "Open tests": tests you're part of always show (bug found by the owner, Oct 28)
Owner's case: fbbb accepted the invite to "jj" (invite only, 1 spot) and joined; "jj" is now full, and `profileOpenTests` drops full tests for everyone but the developer, so it vanished from Marc Hanna's profile for fbbb, the one tester in it.
- A test the viewer is **working in** always shows (whatever its spots or Open until), with "You're in this test", and opens their session page.
- A test the viewer has an **open invite** to stays listed when it's full, with "Full right now: your invite stays open" (matching their Invitations card), opening the join page.
- A **pending application**: listed with "Applied (waiting)"; a full test closes it as today, then the test leaves the list.
- Everything else unchanged (other full, paused, stopped, past Open until or not-involved invite-only tests stay hidden; live updates and stale-click refusals as built).
- Tests: the owner's case (invite-only, 1 spot, joined), an invited tester on a full test, an applicant.

## 7. Request a time: no false "overlaps" flash after pressing (bug found by the owner, Oct 28)
Owner's case: as a tester with no other calls or requests, booking a weekly call briefly showed a red "overlaps" line, then went through. Likely the live clash check (batch 16 §33) comparing the form's rows against the request this same press just created (or a set's calls against each other / the exact-match booking) before the form clears. Find the real cause and fix it: a press's own new request or booking never counts as a clash for that form; clash lines are recomputed only from data that existed before the press, and the form clears (or the rows drop) as soon as the press succeeds. Also check a Daily / Weekly set's own calls are never compared with each other. Tests: tester and developer, Once / Daily / Weekly, no prior calls → no red line at any moment (check the state right after the response and after the next poll).

## 8. "Don't stop me for" and the Alerts menu stay in sync (bug found by the owner, Oct 28)
Owner's case: in the developer's stop box under Next round, pressing "Don't stop me for: Call changes" turned the chip to "Call changes (off)", but the Alerts menu (opened right after) still showed Call changes unticked. Find whether the press didn't save, or saved but the menu (and other open tabs / pages) didn't update. Fix: the chip press saves the same setting the menu uses; the menu, every other button's stop box and other tabs reflect it at once (an event in this tab, the poll elsewhere); un-ticking in the menu turns the chip back. Same for the tester's "Turn off alerts". Tests: chip → menu ticked (same page, after reload, other tab); menu → chip.

## 9. Invite search works from 1 character (bug found by the owner, Oct 28)
Owner's case: a tester named "m" can't be found: "Search by name" only searches from 2 characters (InvitePanel.tsx ~47, invites.ts ~146), so a one-letter name never matches. Change: search from 1 character. With 1–2 characters, match names that **start with** it (any word in the name, case-insensitive) or equal it, so results stay short; from 3 characters, match any part as today. An exact name match always comes first. Same rule for the admin Accounts search and Find's search (batch 17), and the tester dashboard's "Search by developer". Tests: a one-letter name found by its letter; "an" finds "Ana Silva" and "Dan" but not "Joanna"; "ann" finds "Joanna".

## 10. Invite is disabled while the test is full (owner, Oct 28)
Today a full test's Invite button stays active and the press is refused ("<test> is full. Add spots to invite more people."). Instead, while every spot is taken: the Invite button is disabled (greyed) with the line under it "This test is full. Add spots in Edit to invite more people." ("in Edit" links to Edit's spots field); ticking stays possible so a selection isn't lost; Cancel invite on the Invited list still works. It updates live when a spot opens (someone leaves, spots are raised) or fills. The server refusal stays for old pages. Same for the paused / stopped / joining-closed states, each with its existing line.
Tests: full → disabled with the line; a spot opens → enabled live; old page press refused.

## 11. Call history: a scroll box past 3 calls (owner, Oct 28)
The tester's "Call history" on the session page, and the developer's "Calls (N)" fold in each tester row (and any other list of past calls, e.g. the admin's), show more than 3 calls in a plain scroll box about 3 calls tall, newest first, every call inside (no "Show N more"); 3 or fewer show without a box. Each call keeps its Pay / Charge / Dispute controls inside the box. A bell link to a call scrolls the box to it and highlights it. Tests: 2 and 6 calls; a bell link to the 5th.

## 12. A Pay more stops the tester's presses once (bug found by the owner, Oct 28)
Owner's case: the developer used Pay more for fbbb; fbbb (Alerts On) then pressed Cancel call and it went straight through. Cause: the tester's stop-once (src/lib/server/testerGate.ts ~47) builds its "paid" changes from Reviews only; Pay more payments (`Payment.kind = "extra"`) are never listed, so they never stop a tester press (nor show in the tester's stop box). Fix: each charged Pay more since the page loaded is a "paid" change: "<dev> paid you $X more for your <part>" (Alerts type: pay; switched off with Alerts Off like other pay lines). Check the tester's live box shows it too, and that every tester press (Send, Charge, Let it go, Dispute, Rate per batch 17 §14, call buttons incl. Cancel call, Switch / Keep) stops once for it. **Developer side too (owner):** a Pay more made in another tab or device must stop every developer press once (batch 16 §21's "big changes"), listed as "You paid <tester> $X more for their <part> in another tab"; check `devGate` really collects `kind: "extra"` payments (the same gap as the tester side is likely) and fix it if not. Also check every other place that lists payment changes (live boxes, Rate's stop list, Pay what you owe's changed-total check) counts Pay more.
Tests: Pay more then each tester press (Alerts On stops once; Off goes through); Pay more in tab A then each developer press in tab B stops once.

## 13. A call request shows while the tester is typing (bug found by the owner, Oct 28; corrected)
Owner's case: as the tester, typing in the Dispute box; the developer requested a call. The page correctly did NOT scroll (that part works), but **no notice appeared**: no "1 new update ↑" pill and no line in the live box. Find why (the request may not reach the tester's live box at all, or the pill isn't raised for it) and fix: every change the tester can see (a call request, booking, cancel, payment, Pay more, new terms, keys…) appears in the live box, and while they're typing or in a pop-up the pill shows and counts it. Tests: typing in the Dispute box / answers / chat while the developer requests a call → pill shown, the line in the live box when opened, the request in the Call requests panel, no scroll.

## 14. Rate also stops for call changes between the two people (owner, Oct 28)
Rating ends the tester's part (their calls ahead and requests close). So on a running test, add to Rate's stop list (batch 17 §14): any call change between that tester and the developer since the page loaded: a request, a booking, a decline, a withdraw or a cancel ("Nora Lane requested a call for Thu, Nov 5, 3:00 PM"). The developer's Rate gets the same for that tester. Other testers' calls still never stop Rate. Alerts On / Off apply as for other call changes.
Tests: the developer requests a call, then the tester's Rate stops once naming it; another tester's call doesn't.

## 15. Dispute is disabled when nothing more can be awarded (owner, Oct 28)
A team decision can only raise pay, up to the listing (minus what was paid for that part on other pieces) or, unlisted, the piece's max; calls also within what's left of the $1,000. `canDispute` (src/lib/rules.ts ~120) ignores the amounts today. When what's already paid for the piece (Pay plus Pay more, after any earlier decision) is at that maximum, there's nothing a dispute could add:
- The tester's Dispute button is disabled (shown, greyed) with the grey line "Already paid the most a dispute could award, so there's nothing to dispute." It updates live (e.g. after a Pay more).
- The server refuses the same with that line (old pages).
- Use the same max the admin's decision form uses (`disputeRange` / the "up to" note), so the two never disagree.
- Tests: listed piece paid in full; unlisted piece at its max; a call at the $1,000; one cent below the max (Dispute allowed); a Pay more reaching the max disables it live.

## 16. Admin accounts are admin only (owner, Oct 28)
An admin account is only an admin: no developer or tester side, ever. To test as a developer or tester, the admin makes a separate account.
- **First sign-in:** the "Welcome to Playtest" setup shows only Name (required) and Pronoun, no "I'm here to"; Continue goes to the admin console (/admin). From then on an admin always lands on /admin.
- **No sides:** no Developer/Tester switch in the header, no "Start posting tests too" / "Start testing too" on the account page, and every developer or tester page (dashboard sides, Post, Find, sessions, Payments' developer/tester parts, profile editor's sides) moves an admin to /admin. Admins still see the admin views of profiles and test pages, and Find (batch 17 §8, admin version).
- **Existing admin accounts that already have a side** (local test data): the side is ignored for them; nothing is deleted.
- Signing up can never make an admin: admin comes only from ADMIN_EMAILS with a confirmed email (or the isAdmin flag), as today.
- Tests: a new admin completes setup without a side and lands on /admin; developer/tester pages move an admin to /admin; non-admins unchanged.

## 17. A blocked profile shows a proper page, not a 404 (owner, Oct 28)
Today opening the profile of someone you blocked (or who blocked you) gives the bare 404 page (`notFound()` in developers/[id] and testers/[id]). Instead, with the normal header and a "← Back" link:
- **You blocked them (owner):** you can still open their profile as usual (name, ratings, stats, bio, excerpts), but where **Block** was there's an **Unblock** button (no confirm needed; "Unblocked." after). While blocked: no "Chat with" and no invite (Report stays available), and a developer's "Open tests" list stays hidden for you (batch 16 §11), replaced by "You blocked <name>, so their tests are hidden." After Unblock, everything comes back at once.
- **They blocked you:** "This profile isn't available." (never reveal the block).
- Truly unknown or deleted ids keep a proper not-found page with the header ("This page doesn't exist.").
- Tests: each case for developer and tester profiles.

## 18. Never reload a page under someone's typing (bug found by the owner, Oct 28)
Owner's case: on the developer test page, a sudden full reload wiped what they had typed in Live session's Request a time. Likely cause: batch 19's AutoRefresh fallback (src/components/AutoRefresh.tsx ~64) does `window.location.reload()` when the page's fingerprint still doesn't match the poll 5 seconds after a refresh; it only checks `bankCheckOpen()`, not typing or open boxes. Fix:
- Never hard-reload while any field on the page has unsaved typed content or focus, or a pop-up / inline box (Invite anyway, stop box, End early, Stop, dispute, rate, charge…) is open. Wait until that's no longer true, or show the "N new update ↑" pill / a quiet "This page has updates · Refresh" line instead.
- Prefer re-rendering from the poll over reloading; keep the reload only as the last resort it was meant to be, and only when nothing would be lost.
- Forms that matter keep their typed values across any reload anyway (Request a time rows and length, Pay amount and note, dispute and rating text, End early / Stop reasons, chat), using the existing kept-form storage.
- Tests: typing in Request a time while a change arrives that triggers the fallback → no reload, values kept; idle page → still refreshes.

## 19. Number boxes can't take negatives or zero (owner, Oct 28)
Today the spots box accepts typing "-20" (and shows a red line). Make it impossible to type:
- **Whole-number boxes** (tester spots, call Length, admin Extend days, any other count): only digits can be typed or pasted (minus, "e", "+", "." and letters are ignored; the arrow keys and spinner never go below the box's minimum). A value of 0 or below can't be entered: typing "0" as the whole value is ignored (the box stays empty or keeps its last valid value), so the smallest that stays is the box's minimum (spots 1, Length 10, …).
- **Money boxes** (Pay, Pay more, Charge, prices, rates): no minus sign can be typed or pasted; $0 stays allowed where it's allowed today (Pay at $0 with a reason).
- Above the maximum still shows the existing red line (e.g. "You can take up to 10 testers per test…").
- The server keeps refusing anything out of range, as today.
- Tests: typing/pasting "-20", "0", "1e3", "2.5" into spots; minus into a Pay amount; the spinner at the minimum.

## 20. The Open until line names the later of the two dates (owner, Oct 28)
In batch 19 §8's line on Post and Edit, replace the last sentence "You pay each piece within 7 days of it arriving, or the tester can charge you." with: "You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you." (The rule itself is unchanged: Charge opens at the later of 7 days after sending and the tester's deadline.) Update tests that read the line.

## 21. The updated-Terms tick sits above the button, with the other ticks (owner, Oct 28)
Batch 18 §1's box under Post / Join / Apply / Ask to rejoin ("We updated our Terms of Use. Read what changed." + tick) becomes one more tick **above the button**, in the same style as the Charge tick, shown only while the account hasn't agreed to the current version: "I agree to the updated Terms of Use. Read what changed" ("Read what changed" opens /terms#what-changed in a new tab). Required like the other ticks (red "Tick to agree to the updated Terms of Use." in the mistake list; server refuses unticked).
- **Drop "I'm 18 or older" from it** (§5 change): age is confirmed at sign-up (email and Google). Accounts that existed before §5 (local test data only, nothing launched) aren't asked again.
- On Post the order above the button is: the updated-Terms tick (when shown), then the Charge tick.
- Tests: Post and Join with an old Terms version (tick above, required), current version (no tick).

## 22. Post / Edit: a ticked part needs a price; Save looks disabled; "Not saved yet" (owner, Oct 28)
- **A ticked part can't be left blank:** ticking Written answers, Recording or Live call and leaving its price (or rate) empty is a red mistake at that box (on leaving it and on press): "Enter a price for the written answers, or tick Free." (recording / "Enter an hourly rate for live calls, or tick Free."). $0 is only possible through the Free tick, never by leaving the box blank (today a blank box seems to be taken as free). The server refuses a ticked part with no price and no Free tick with the same line.
- **Save is visibly disabled until something changes:** today it's `disabled` but styled like an active button. Grey it out (the app's disabled button style) with its tooltip "Nothing has changed yet"; the Charge tick appears and Save lights up as soon as anything changes (batch 19 §7, unchanged).
- **The "Not sent yet" badge on Edit reads "Not saved yet"** (it means typed changes are kept on the server until Save); Post keeps "Not sent yet" → rename to "Not posted yet" there.
- Tests: tick a part with a blank price → red, Post / Save refused; Free tick → OK; Save disabled styling on an unchanged Edit; the badges' words.

## 23. "In N tests with you" says how each one went (owner, Oct 28)
In the invite panel (People you've worked with, and other rows using `together`), the fold "In 2 tests with you" reads as if the tester is in those tests now, even when their sessions ended (owner's case: fbbb's sessions on "jj" and "jjj" ended by a block, since lifted). Change the fold label to "Worked with you on 2 tests" and list each with its state: "jj · ended", "jjj · ended", "Harbor Run · in it now", "Sky Lab · left", "Kelp Forest · finished" (rated). Rows for a tester currently working in THIS test keep "Already in this test" (greyed) as today. Tests: ended, left, finished, working, mixed.

## 24. A tester's rating updates the developer's pages live and never stops a press (owner, Oct 28)
Owner's case: tester "ff" (session already ended) rated Marc Hanna while Marc was about to Invite on the test page; the page reloaded (the §18 bug) and nothing about the rating showed.
- **No stop for the rating itself (owner, final):** a tester's rating never stops a developer press and isn't an Alerts type (no "Ratings from testers"). **But a working tester who rates leaves the test, and that leave stops once** under the existing "Testers leaving" type: "ff finished their part (rated you) · 3:10 PM". A tester whose session had already ended (left, ended early, blocked, stopped) gives no stop at all.
- **Live update, no reload:** the developer's test page shows a live-box line "ff rated you. You can rate them until <date>." (info only), the tester's row gets its Rate box, the test page's Needs you lists "Rate ff · 14 days left" (linking to that row's Rate box), and the dashboard's "Ratings to give" adds the row: all on the next poll, without reloading.
- Tests: an ended tester rates while the developer's page is open → live line, Rate box and Needs you row appear, and the next Invite press goes straight through; a WORKING tester who rates → the next press stops once with "ff finished their part (rated you)" (Testers leaving), or goes through with that type ticked off.

## 25. A tester's Switch / Keep never stops the developer (owner's batch 14 rule; bug)
Batch 14 §4: a tester switching to new terms is only a quiet line in the developer's live box ("Ana switched to the new terms" + "See their contract"); Keep shows nothing; neither ever stops a developer press. The code still lets them in: tester Switch events have kind "terms", `devLine` (src/lib/server/tests.ts ~538) carries them into the stop box, and `alertOf("terms")` returns null, which means "always stops" (src/lib/alerts.ts default). Fix: the developer's stop-once never includes tester Switch / Keep events (or any "terms" event that comes from a tester's choice); they stay as the quiet live-box line. Then audit every event kind the developer side can see: any kind that falls to `alertOf`'s default (null = always stops) must be deliberate (holds, pauses, stops, chargebacks, subscription end, refusals); list the kinds and their Alerts types in the report.
Tests: a tester switches while the developer's page is open → quiet live line, no stop on any developer press; Keep → nothing.

## 26. "Send my updated answers / recording" is disabled until something changed (owner, Oct 28)
On the tester's session page, after a part was sent (and before it's paid), "Send my updated answers" / "Send my updated recording" stays disabled (visibly greyed, tooltip "Nothing has changed since you sent it") until the answers, attachments or recordings differ from what was last sent. Changing them back to exactly what was sent disables it again. The server refuses a resend identical to the last send: "Nothing has changed since you sent it." (no new piece, no bell). The first Send (never sent) works as today. Tests: sent → disabled; edit → enabled; undo the edit → disabled; attachment added/removed → enabled; server refusal for an identical resend.

## 27. End early's (and Stop's) reason needs at least 5 characters (owner, Oct 28)
The "Why? (each tester you tick reads it)" box in End early needs at least 5 characters (after trimming), like the Mature reason: until then the button stays disabled and, once the box is left or End early is pressed, a red line "Say a little more: at least 5 characters." Empty keeps "Say why first". The server refuses the same. Apply the same minimum to Stop the test's required reason (batch 17 §15) for consistency. Tests: 0, 4 and 5 characters for both.

## 28. Send refused with "Answer every required question" when it is answered (bug found by the owner, Oct 29)
Owner's case: tester session page, written part "Written answers: Not listed", the only required question "Your feedback" answered ("ee"), "Anything else" empty: Send my answers is refused with "Answer every required question before sending." under the button. `sendWritten` (src/lib/server/tests.ts ~915) also refuses when `answers.length !== qs.length`: likely the form shows a default "Your feedback" question for a part that isn't listed while `writtenQuestions(c0)` returns a different list (or none), so the counts differ. Find the real cause and fix it so the form and the server use the same question list (for listed, unlisted and changed-questions cases). A real missing answer must show red AT that question (batch 16 §10), not only under the button. Also: the required "*" wraps onto its own line under "Your feedback"; keep it next to the label.
Tests: an unlisted written part with the default question answered → sends; a listed part with 3 questions, one required empty → red at that question; after a questions change and Switch.

## Check and report
- Tests for each item. Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- §5 needs a small migration (see §5).
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
