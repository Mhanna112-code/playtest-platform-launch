# Batch 16: per-tester deadline reminders, Find sort, Alerts line, Pays on average (owner, Oct 28)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 15 and the wording fixes (22b5a64).

## 1. Each tester is reminded before their OWN deadline
Today (holds.ts ~line 556) the tester's "Your deadline on “<test>” is <date>: send your work before then." rides on the developer's Open until marks, and only reaches testers whose deadline is within a day of Open until. Later joiners get nothing. Replace it:
- Each working tester gets their own reminders, counted to **their own deadline** (`dueAt`, the date their session page shows): **1 month, 1 week, 3 days and 1 day before**.
- Same rule as the developer's review reminders (`reviewMarksFor`): only marks still ahead when the tester **joins** are used; the 1-month mark only if the deadline was more than a month away at joining; a mark within 24 hours of joining is skipped.
- Batch 15 §18 is unchanged and is the owner's rule: every tester gets the same tester days (test opened → Open until), counted from when they join, and "Sent late" applies after those days. So on one test every tester gets the same set of reminders, decided by its tester days. Example: a test with 10 days per tester gives every tester 1 week, 3 days and 1 day; one with 45 days gives every tester all four. Only an Edit moving Open until later (deadlines move D days for working testers) changes what's still ahead.
- Line unchanged: "Your deadline on “<test>” is <date>: send your work before then." Link: their session page. Bell group: that test's day, as now.
- Track sent marks per tester (per contract), not per test. If their deadline moves later (Open until extended, or a pause shift), the marks still ahead of the new deadline can fire again; a mark is never sent twice for the same deadline.
- Who gets them: as now, testers still working on the test (not left, not ended, not finished). Reminders wait while the test or the tester is paused (the existing rule).
- The developer's "“<test>” closes to new testers on <date>." stays on the Open until marks (1 month, 1 week, 3 days, 1 day), unchanged.

## 2. "Sent late" stays
No change: it's measured against the tester's own deadline since batch 15. Only make sure no comment or doc line in the code calls it obsolete.

## 3. Find: "Most time to finish" sorts by days per tester
`src/app/app/find/page.tsx` line ~48 sorts by Open until, which no longer says how long a tester has. Sort by the days each new tester gets (`testerDays ?? testerDaysOf(createdAt, openUntil)`, the number in the card's "N days per tester" badge), most first. Ties: the later Open until first (more time left to join). Tests without Open until go last. The label stays "Most time to finish". Update the comment above it.

## 4. Tester Alerts: say what stops, in the grey line under the button
Replace the line under "Alerts: On / Off" (TesterAlertsToggle.tsx) with ONE short grey line that matches the current state and lists what stops a press:
- On: "Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs."
- Off: "Stops a press only for: new terms, your key marked as working."
It swaps when the button is pressed. Keep it `text-xs text-slate-400`, right-aligned on desktop and left on phones as now, wrapping inside the existing `max-w-xs`. Check the lists against the tester table in DESIGN-DOC.md (Why a press stops → Tester) and the code's tester stop kinds; if a kind is missing from the list above, add it in the same short style and report it.
Update tests/batch15-stops.test.ts (~line 68) and any evidence/media check that reads the old line.

## 5. Developer profile: "Pays on average" without the split
In profileStats.ts the hint "50% accepted in full, 25% partly, 25% rejected" goes. The tile keeps its value (the average share of the listing paid, as now) with the hint **"of the listing, over N pieces of work"** (N = the pieces counted; "1 piece of work" when one; "no paid work yet" with value "-" when none). The footnote (DEV_FOOTNOTE) stays as it is. Update tests/profile-stats.test.ts (~line 36), the find/[id] page line that shows `pays.hint`, and scripts/evidence.cjs ~line 1567.

## 6. Clean-up left from batch 15 (nothing user-visible)
- Remove the dead `checkReject` in rules.ts and anything only it uses.
- Remove the unreachable "you can only cancel booked calls here" text on the developer test page (~line 558), if it truly can't show.
- Fix stale comments: TestForm.tsx:179, find/page.tsx:47, terms.ts:84, rules.ts:529.

## 7. No waitlist: the home page is the launch page (owner, Oct 28)
The site launches with open sign-up, so the waitlist (built Oct 22 as a pre-launch page) goes completely:
- Home page: remove `<WaitlistForm />` from the hero and the comment mentioning it. The Sign up / Log in buttons stay as they are.
- Remove `WaitlistForm.tsx`, `api/waitlist`, `server/waitlist.ts` (`joinWaitlist`), its rate limit (5 sign-ups per network an hour), the admin console's Waitlist list (admin page, PagedList, adminLists) and the privacy page's waitlist line (privacy/page.tsx line 16, and the comment on line 8).
- Drop the `WaitlistEntry` table with a hand-written migration (no hosted DB has it yet, so this is safe); check it with `prisma migrate diff` as below and apply it to the local `playtest_lite` DB only.
- Remove or update every test, evidence and media script step that uses the waitlist (tests/batch15-security, bell-admin, extras; scripts/evidence.cjs, scripts/media.cjs).
- Check and report: the home page signed out shows no email box; `/api/waitlist` is gone (404); the admin console has no Waitlist section.

## 8. No "How testers see it" under the NDA (owner, Oct 28)
On Post and Edit, the NDA box's "How testers see it" preview (TestForm.tsx ~line 534, `<NdaBox label="How testers see it" …>`) only repeats what was just typed. Remove it. NdaBox stays everywhere else (join page, session page, terms history). Update any test, evidence or media step that looks for it.

## 9. Mature (18+): say why the box is red (owner, Oct 28)
The "Why is this test mature?" box turns red for "idk" because the server needs at least 5 characters (rules.ts ~295), but nothing says so and the message "it's required" reads as if the box were empty.
- Keep the 5-character minimum. Add a counter under the box, "N / 500", like the other limited fields.
- When it's red, show a red line under the box (the form's usual red line, on blur or after a press, like the other fields): empty → "Say why this test is mature (18+): it's required for mature content."; 1–4 characters → "Say a little more: at least 5 characters." Use the same two messages on the server.
- The grey line under the tick box contradicts itself ("No graphic content … Graphic content must be marked Mature"). Change it to: "Tick this if your test has mature content, and say why. Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic content must be marked Mature." Check the Terms of Use say the same and report if they don't.

## 10. A press with mistakes: the list under the button stays, and works (owner, Oct 28)
Today Post lists the server's messages under the button ("Fix the mistake above, then press Post the test again." plus a bullet per mistake), while the field itself may or may not be red: the owner saw the Mature line in the list with the "idk" box not red. The two systems (FieldChecks on blur and the server's `errs` matched by FIELD_WORDS) disagree. The owner is fine with the list as long as it matches the fields.
- **One rule, every form with fields** (Post, Edit, posting a draft, profile/settings, sign up, log in, reset password, Contact us, dispute and rating boxes, and any other form that has field mistakes):
  - Each mistake shows at its field: the box red, with the red line under it saying what's wrong (from the client check or the server, the same text).
  - Under the button: the existing heading line and one bullet per field that is red right now, with the same text as the field's line. Each bullet is a link that goes to its field and puts the cursor in it.
  - On the press, the page also scrolls to the **first** red field (top to bottom) and puts the cursor in it.
  - The list and the fields always agree: a field stays red until its own value is fixed (re-checked as it's typed in once it has been red; editing another field never clears it), and its bullet goes at the same moment. When the last one is fixed, the list goes.
- A server mistake that belongs to no field (rare) stays in the list without a link; refusals that aren't mistakes (blue, e.g. "Confirm your email first.") and the blue stop-once box are unchanged.
- Every server field message must map to its field; add a test that each Post/Edit field message from `checkListing`/`editCheck` lands on a field (no FIELD_WORDS misses).
- Proof: a short recording on Post: two mistakes (Mature "idk" and an empty title), press Post, the page goes to the title, both are red and listed, fix the title (its bullet goes), click the Mature bullet, fix it, the list goes.

## 11. A block hides the developer's other tests, either way; past tests stay (owner, Oct 28)
Whoever blocked whom (tester → developer or developer → tester), the tester never sees that developer's tests they weren't already part of. Tests they were part of stay on their dashboard as now (ended by the block if they were working, with their history, payments, Charge, Dispute and Rate as today).
Already true (keep, and cover with tests in both directions): Find hides them (`findTests` uses `blockPartners`), the developer's profile is not found, invites can't be sent, sessions end.
Change:
- **A direct link** to one of that developer's tests the tester was never part of (no contract, invite or application from before the block) reads "This test isn't available right now." with nothing of the listing shown, the same as a paused test for someone not involved. Today it shows the full listing with "This test isn't taking new testers right now." Never reveal the block.
- **Pending applications** between them close at the block, like invites (check `blockUser`; today it cancels invites and ends working sessions only). The tester's application line: the neutral "<test>: your application was closed." The developer's: none.
- **Audit every other place a tester can meet a new test** and hide that developer's tests there too: bell lines and emails (e.g. a spot opening, a new invite, a Next round, closing reminders for tests they only applied to), chat (stays closed as now), rejoin requests ("Ask to rejoin" is refused neutrally: "This test isn't taking new testers right now."), and any list or count of open tests. Report what you found.
- Unblocking brings everything back as before (Find, profile, links); nothing closed by the block reopens by itself.

## 12. Invite: "Search by name" finds every tester, not the newest 500 (bug found Oct 28)
`invitableTesters` (server/invites.ts ~line 20) loads `take: 500` testers, newest first, and the panel's "Search by name" only filters those. The owner's local DB has 981 testers; the real tester "fbbb" (created Oct 27) has 790 newer accounts, so the search never finds them. At launch this silently hides every tester past the newest 500.
- **Search by name asks the server** (2+ characters, after a short pause in typing): all testers who are invitable or greyed by the usual rules (not deleted, not blocked either way, not in this test), case-insensitive, matching any part of the name, ordered as today (invitable first, then meets and score), every match in a scroll box about 8 rows tall (no pages); above 100 matches it shows the first 100 with "Showing 100 of N: type more of the name". The device/language ticks still narrow it.
- **Suggested** (top 5) and **People you've worked with** are computed over all testers on the server, not over a capped list. No silent caps anywhere: if a list is limited, it says so.
- Tests: more than 500 testers with the target the oldest; search finds them; blocked or deleted never appear; filters apply.

## 13. Tester dashboard: search your tests by developer name (owner, Oct 28)
- A "Search by developer" box at the top of the tester dashboard's tests (sessions) list. Typing 1+ characters narrows the list to tests whose developer's name contains it (case-insensitive, any part of the name), across every test the tester has been in: working, finished, left, ended, stopped, closed. Results most recent first (by when they joined). Clearing the box brings the normal dashboard back.
- No match: "No tests with a developer named “<typed>”." Names of deleted developers ("Deleted account") match that text.
- It searches all of the tester's tests, not only the ones shown on the current page of the list (if the list is paged or folded, the search covers everything). Blocked developers' past tests are included (they stay on the dashboard, §11).
- Phones: the box is full width above the list.
- Tests: several developers, a partial and a different-case match, an old ended test found, no-match line.

## 14. Dashboard and profile lists: plain scroll boxes, no "Show N more" (owner, Oct 28)
Every list panel on the **tester dashboard**, the **developer dashboard** (Your tests, Needs you, disputes, excerpts, invites, applications, left/removed and the rest) and the **"Open tests" on a developer's profile** becomes a plain scroll box:
- Everything is in the list, newest or most urgent first as today; no "Show N more" button, no pages, no cut-off.
- The box is about 4 rows tall for row lists; the developer's "Your tests" card grid scrolls inside a box about 2 card rows tall (one column of about 3 cards on phones). A short list shows without a scroll bar.
- Headings, filters, chips and search boxes stay above the box and never scroll away.
- This replaces `LongList` on these pages only. Blue boxes (live box, stop boxes, notices) keep their "3 lines, then Show N more" rule.
- §13's search results show in the same scroll box.

- **Developer profile "Open tests" seen by a tester:** invite-only tests are not listed (as in Find), unless this tester is invited to, applied to or in that test.

## 15. A tester's profile, seen by a developer: your tests with them (owner, Oct 28)
New section on the tester profile (testers/[id]/page.tsx), shown only to a developer viewing it: **"Your tests with <name>"**, every one of THIS developer's tests the tester has been part of (joined), most recent first, in a scroll box like §14. Other developers' tests never show, so nothing private leaks. The tester's own view of their profile doesn't have it; neither does an admin view (admins have their own lists).
- Filters above it, two tick boxes: **Open** and **Closed**, both ticked at first (= all). Open = the test is still running (taking testers, or joining closed with testers still working); Closed = stopped, ended or closed. Unticking both shows all too.
- Each row: test name (opens the developer's test page), "Joined <date>", and the tester's state there (Working, Finished, Left, Ended).
- None yet: "<name> hasn't been in any of your tests yet."
- Not shown when blocked either way (the profile itself isn't).
- Phones: the filters wrap above the box.
- Tests: mixed open/closed, both filters, another developer's tests never appear, the tester's own view has no section.

## 16. Open until: at most 30 days from when the test opened (owner, Oct 28)
Today Edit allows Open until up to 30 days from TODAY, so repeated extensions keep a test open for ever and grow every tester's days without limit (each extension adds D to `testerDays`).
- **The cap:** Open until can be at most **30 days after the test opened**: posted, or its current Next round opened (the same "opened" moment `testerDays` counts from). So tester days never exceed 30.
- **Post:** unchanged in effect (opening is today): hint "only later, up to 30 days from today" stays on Post.
- **Edit:** Open until can only move later and never past the cap. Hint: "only later, up to <cap date> (30 days after the test opened)". A later date is red: "Open until can be at most 30 days after the test opened (<cap date>)." Server: same message.
- **Pause and outage shifts** still move Open until and deadlines later automatically, even past the cap (the developer couldn't use that time).
- **Next round** opens a fresh 30 days, as now.
- **Edit's "Each tester gets…" hint is wrong today** (it counts today to the date, e.g. "35 days"). On Edit it must show what each tester will get after the change: current tester days + the extension ("Each tester gets 19 days from when they join (14 now + 5)."). Post keeps "today to this date (N days)".
- Existing tests already past the cap keep their date; they just can't move later.
- Tests: extend within the cap; past the cap refused (client and server); a paused test shifted past the cap; Next round resets; the Edit hint's numbers.

## 17. Another tab saved the same value: no blue note, no stop (owner, Oct 28)
On Edit (and posting a draft), when another tab or device saves a field to exactly the value this tab already has in that field (typed or untouched), it's not news:
- **Live:** no blue note under that field (TestForm `applyElsewhere` today adds a note whenever the saved value differs from this tab's base, even when this tab had typed the same thing). The field's base simply moves to the saved value, so it no longer counts as an unsaved change.
- **On press:** that field is not a reason to stop once ("You also did this in another tab" / "changed in another tab"), on the client or the server (edit stop-once compares what this press sends with what's saved now; equal values are dropped from the stop list). If nothing else differs, Save goes straight through (or says nothing changed, as today when nothing changed).
- Other fields saved elsewhere with a different value keep today's note and stop.
- **Access keys are the exception (owner):** key changes from another tab are always shown, even when this tab made the same change, because they decide which keys can still be added. See §18.
- Tests: same value typed in both tabs (no note, no stop); different value (note + stop as today); mixed (only the different field is listed).

## 18. Keys note: grouped, and removals named (owner, Oct 28)
The blue note under Edit's key boxes repeats "added in another tab" after every key, and a key deleted in another tab only reads "HR-5555 is no longer free". The heading already says "Changed in another tab or device at <time>:", so:
- One line per kind, keys comma-separated: "Added: HR-8888, HR-9999, HR-7777" · "Removed: HR-5555".
- A key given to a joining tester stays its own line, "Ana Silva joined and was given HR-4444" (and the join-only label as today); it is never listed under Removed.
- Long lists follow the blue-box rule (3 lines, then "Show N more").
- Same wording in the stop-once box on Save when keys changed elsewhere. Key changes are always listed, even ones this tab also made (§17's exception).
- **Keys this tab typed that another tab already added** merge as today: the Free box shows each key once, no red, Save isn't refused. The note still lists them under "Added" (key changes are always shown).
- **Keys another tab deleted** are removed from this tab's Free box automatically (as today), and the note says "Removed: HR-5555". Reason: a deleted free key may have been sent to a tester in a message, so it must never come back by itself. To add it again, the developer types it again.
- Update the media/evidence checks that read the old lines.

## 19. Field notes from another tab: say what it was, expandable (owner, Oct 28)
Today the blue note under a field saved elsewhere repeats the NEW value ("the instructions: now: …"), which the box already shows, and what this tab had typed is cut to 80 characters ("you had typed …; the newer value is kept"), so long typed text is lost.
- The note says what changed and what it replaced: "Changed in another tab or device at 7:15 AM." then **"Before:"** the value this tab had shown (the saved value it replaced).
- If this tab had typed something different and unsaved, also **"What you typed (not saved):"** with the full text and a **Copy** button, so nothing is lost.
- **Format (owner):** after the heading's colon, "<Field name>: <what changed>", never "now:". The field name is capitalised as on the form label's short name.
  - Short values: before → after on one line: "Changed in another tab or device at 7:16 AM: Spots: 4 → 5", "Price for written answers: $8.00 → $10.00", "Devices: Windows PC → Windows PC, iPad".
  - Long text (steps, questions, NDA, description): "Instructions:" then the **Before** text (the new one is in the box) under the blue-box rule: 3 lines, then "Show more", opening a scroll box about 8 lines tall. Questions show as a list, 3 then "+N more".
- Same in the Save stop-once box for those fields. §17 still applies (same value: no note).
- Tests: a 20,000-character field changed elsewhere (note folded, expands), typed text kept in full and copyable, a short field inline.

## 20. A key you deleted (not saved yet) given to a joining tester: warn live and on press, not red (owner, Oct 28)
Today (KeyBoxes `freeBoxCheck`): if this tab deleted K-2 but hasn't saved, and Ben joins meanwhile, the server still had K-2 free and gives it to Ben. The page then shows a RED mistake "K-2 was given to a tester since you opened this page, so it's in use now and can't be removed." only once the box is left or Save is pressed, Save is refused, and the red disappears by itself after the refresh. Nothing for the developer to fix, and the real risk (they may have sent K-2 to someone in a message) isn't said.
- **Live, as soon as the page's poll sees it** (no blur or press needed): a blue line in the keys note, "Ben Okafor joined and was given K-2, which you had deleted here." (owner: nothing more) K-2 simply leaves this tab's pending deletions (it's in use now); it is not a mistake and not red.
- **On press:** Save stops once with the same line in the blue "since you opened this page" box (if the page hadn't shown it yet); the second press saves the rest of this tab's key edits.
- Remove the red "…was given to a tester since you opened this page…" error. Real mistakes stay red (too few free keys, a key in use typed in, a key typed twice).
- Several at once stack: "Ben Okafor and Cam Lee joined and were given K-2 and K-3, which you had deleted here."
- Update the keysrace media group and its captions to the new behaviour; tests for the live line, the stop, and no red.

## 21. Developer Alerts: no "your other tab" type; a closed tester account counts as leaving (owner, Oct 28)
**A tester who deleted their account or was suspended** is treated like a tester leaving: the same live line the developer gets for a leave (keep today's neutral wording and the "Deleted account" name where it applies), under the **Testers leaving** Alerts type, so it can be ticked off like a leave. Remove "a closed tester account" from the menu's intro: "Tick what should **not** stop your buttons. A payment hold or pause, a stopped test and final refusals always stop." Final refusals are unchanged (e.g. Pay to a deleted tester without payouts is still refused).

**Remove "Your saves and presses in another tab" from Alerts** (`ALERT_TYPES`, `PAUSED_ALERTS`, `STOPPED_ALERTS`, the design of the menu, stored ticks ignored). What the developer did in another tab is never news and can't be switched off:
**What the developer did in another tab, and the old test page (owner, Oct 28; replaces the earlier bullets and table):**
- **"Big" changes stop EVERY press once** (every button on the test page, Accept / Decline, Rate and excerpt Allow / Deny included), even when the press is about something else: **End early, Stop the test, Pay or Pay more (on any piece), and any call change** (request, withdraw, accept, decline, cancel, Lower the length). The stop box lists them as "You … in another tab" lines; the second press goes ahead (or is refused as usual if it can no longer happen).
- **Special cases, on press:** End early on testers the other tab already ended (those testers are dropped, the rest go through on the second press); Stop when the other tab already stopped the test (then refused: already stopped); Next round when the other tab already made the draft (the box links to it).
- **Special cases, live AND on press** (a line in the live box at once, and the UI updates while keeping what you typed):
  - **Pay on the same piece (owner):** the piece was unpaid here and the other tab paid it: the Pay box simply disappears (the Needs you row goes; the tester row shows the paid amount and an empty Pay more as for any paid piece). What was typed is dropped.
  - **Pay more on the same piece:** the box updates to the new paid total and room; the amount and note you typed stay.
  - **Call changes:** the call panel updates at once: cancelled calls leave, newly booked or requested ones appear, and anything you were requesting that is now booked or requested is marked ("Already booked" / "Already requested"); the rest of your request form (times you picked, length) stays.
  - **Invite / Cancel invite** (as before): the invite panel updates at once (Invited <date> / tickable again); an Invite press for that tester stops once.
- **Obvious cases, refused, no stop box:** a press the other tab already made on the same item: "You already rated Ana Silva.", "You already allowed this excerpt.", "You already declined this application.", "You already sent your side." The page updates to show it.
- **Everything else from another tab** (Edit saves, Accept / Decline elsewhere, Rate elsewhere, excerpts, Alerts ticks, chat): no line and no stop; the page just updates on its poll.
- **Pay more** only appears after the developer's first Pay on a piece (unchanged).
- **Testers switching or keeping terms** are never in a stop box (unchanged since batch 14); a Switch is only the quiet line in the live box, a Keep nothing.

- Tests: Pay in tab A, then Rate in tab B stops once listing it; Pay on the same piece in both (live update, typed amount kept); invite in A shows live in B and greys the row; same call request in both tabs; Stop in A updates B without a live line, and Stop in B stops once.

## 22. Pay more closes 30 days after the test ends (owner, Oct 28)
Pay more on a paid piece stays until its cap is reached, but no longer for ever: it closes **30 days after the test ends** (stopped, closed, or done when the last tester's deadline passed; a Next round is a new test and has its own clock).
- Until then the box shows a small grey line in its last 7 days: "Pay more closes on <date>."
- After it closes the box is gone; a press from an old page is refused: "Pay more closed on <date>, 30 days after the test ended."
- Pays still owed (Needs you), Charge, disputes, delayed payments and the admin's decisions are unaffected.
- Tests: open at day 29, refused at day 31 (client and server), the grey line in the last 7 days.

## Decided, no change (owner, Oct 28)
- Open until stays one date: it sets the last day to join AND the days each tester gets (opened → Open until). No separate "days per tester" field.

## 23. No excerpts in hover cards (owner, Oct 28)
Remove the shown excerpts from the tester hover card (the avatar row on the developer test page: tests/[id]/page.tsx ~line 419 passes `excerpts` to TestersJoined). The hover card keeps rating, accepted parts, the profile link and "Chat with <name>". Excerpts stay on the tester's profile. Update the media/evidence step that shows them in the hover card.

## 24. Tester page after the test stops (owner, Oct 28)
Applies when the developer stops the test, the team stops it, it closes, or the developer ends this tester's work early: the tester's work is over.
- **Gone from the page** (hidden at once by the live update, and refused on the server): Switch / Keep (the offer box), Send for written answers and recordings, Record, attachments and drafts' Save, Request a time, Accept, Decline, Withdraw, Cancel call, Join call, **the access key box with "This key doesn't work"**, and the Alerts toggle if nothing left on the page can stop.
- **A press of any of those from an old page** is refused and the page **moves to the top**, where the stopped line names what didn't go through: "<dev> stopped the test on <date>, so your Send didn't go through. Work you sent is still reviewed." (ended early / closed / team stop use their own first half as today). No stop box.
- **Still works, and the stop itself never stops them** (no stop-once for the stop): Charge, Let it go, Dispute, Rate, chat, asking to show an excerpt, Remove excerpt. Other changes keep their usual rules (e.g. the developer paid that piece meanwhile: Charge is refused as today; a new Pay still stops Rate once).
- **Leave (owner to confirm, DEFAULT):** hidden after the stop, because the tester's work has already ended and there is nothing to leave; their part ends when they rate.
- **The stopped line lists what still works**, built from what is actually available (as the paused banner does), e.g. "<dev> stopped this test on Nov 3. You can still charge or let go of unreviewed work, dispute, rate and chat. Work you sent is still reviewed."
- Tests: each hidden press from an old page (refused + scroll to top), each allowed press goes through on the first press after a stop, the key box gone.

## 25. Stopped, closed, ended, paused, held or suspended: what still works goes through silently (owner, Oct 28)
In any of these states, every press that is still allowed goes through on the **first press**: no stop-once for anything (other people's changes, other tabs, the state itself). Refusals stay exactly as they are (already done, caps, "<dev> paid $X for this meanwhile.", "already rated", an NDA now on the test, etc.); a refused press shows its reason and the page updates.
**Developer, test stopped or closed:** Pay, Pay more (until it closes, §22), Rate, Next round, excerpt Allow / Deny / Take down, Send your side (dispute), chat, Alerts ticks.
**Developer, test paused (any cause) or developer held / suspended:** Stop the test, End early, Cancel call (test page and dashboard Calls box), excerpt Allow / Deny / Take down, Send your side.
**Tester, test stopped / closed / their work ended early, or a test they left or were removed from (incl. by a suspension of their tester side: see §28):** Charge, Let it go, Dispute, Rate, chat, ask to show an excerpt, Remove excerpt (§24; Leave hidden). Today leaving or removal blocks Dispute and excerpt requests: allow both (owner).
**Tester, test paused:** save drafts, Charge, Let it go, Dispute, Rate, Leave, Cancel call, chat, excerpts.
**Tester, own side suspended:** Remove excerpt (Settings), payout setup.
**Exceptions that still stop once (DEFAULT, owner to confirm), because money or a judgement would act on something unseen:**
- **Pay what you owe:** if the amount owed changed since the page loaded (a tester charged meanwhile), it stops once showing the new total; it never charges an amount the developer didn't see.
- **Rate (both sides):** stops once if a payment, Charge, Let it go or dispute decision about that person's work arrived since the page loaded, so nobody rates without seeing it.
- §21's other-tab stops don't apply in these states; other-tab repeats are plain "already" refusals.
- Tests: each listed press goes through on the first press in each state; the two exceptions; refusals unchanged.

## 26. No "Lower the length": a call has just Pay (owner, Oct 28)
Remove batch 15 §40's "Lower the length" completely: the `LowerLength` box in PayBox.tsx, the `lower-length` action (api/tests/[id]/[action]/route.ts, STOPPED_ALLOWS), its stop-once and Alerts wiring, its tester line and reason, and its tests/media. A call's Pay box starts at the measured length × the rate, and the developer just presses Pay; paying less than that uses the usual required reason ("Say why you're paying less …"), and the tester can dispute once as usual. Charge still uses the measured length × the contract rate. Old lowered lengths stay as recorded.

## 27. Settings, profile and Payments: changes made elsewhere update silently, and stop once on press (owner, Oct 28)
Covers every button on **Payments** (Change card, Subscribe, Cancel / Keep subscription, payout setup, Pay what you owe), the **profile editor** (name, bio, devices, languages, categories, photo; the Developer / Tester / both switch) and **Settings from Change password up** (name and email, Resend the link, the side switch, Change password). Delete account, Sign out of all devices and the email setting keep their own rules.
- **Live:** when one of these is changed in another tab or device, this page updates silently on its poll (no live line): the card shown, subscription state and buttons, payout status, saved profile values. Fields the user is typing in keep what they typed.
- **On press:** the first press after such a change stops once with a blue box: "Changed in another tab or device since you opened this page:" and what changed in short form ("Card: Visa ending 1111 → Visa ending 4242", "Subscription: cancelled, ends Dec 1", "Devices: Windows PC → Windows PC, iPad", "Password changed at 3:10 PM"), then "Press <button> again to go ahead." Typed values are kept; the second press saves them on top (as Edit does). §17's same-value rule applies: a field changed elsewhere to exactly what this tab has is not listed.
- **Repeats** are plain refusals: "Your subscription is already cancelled.", "You're already subscribed."
- **Pay what you owe** keeps §25's exception (stops once showing the new total if it changed), including during a hold.
- Tests: card changed in tab A, Cancel in tab B stops once; profile devices changed in A, Save in B stops once and keeps B's typed bio; password changed in A, Change password in B stops once.

## 28. A suspended tester: a limited view of tests they were removed from (owner, Oct 28)
Today a suspended tester side has only a read-only "Tests you were removed from" list and every other press is refused. Change:
- Each row in "Tests you were removed from" opens a **limited view** of that session page (like the developer's paused view): their parts with status and what each was paid, the work they sent (read-only), and only these presses, which go through on the first press (§25): **Dispute, Charge, Let it go, Rate**.
- Hidden there: sending work, drafts, calls, chat, the key box, Leave, excerpt requests. Find tests and profiles stay closed.
- **Excerpt requests wait until the suspension lifts** (owner): once reinstated, they can ask for excerpts from these tests (and from tests they left), as §25 allows.
- A short line at the top of the limited view: "Your account is paused. You can still dispute, charge or let go of unreviewed work, and rate."
- Tests: open the limited view while suspended; each allowed press works; excerpt request hidden and refused on the server while suspended, allowed after reinstating.

## 29. Invite: search results right under the search box (owner, Oct 28)
In the invite panel, the "Find testers" results show directly under "Search by name" (above People you've worked with and Suggested), in their own scroll box (§12), so a search never needs scrolling down the lists. With the box empty, the "Find testers" heading and results are hidden.

## 30. Account page: current side only, fewer duplicates (owner, Oct 28)
Changes to /app/account only; every page it links to stays as it is.
- **Top:** the name and email card (with "not confirmed yet" and Resend the link), heading "<name> · Developer" or "· Tester" for the side you're on.
- **No "Developer, tester, or both" cards** (the page shows only the side you're on). When the other side is off, one small line with a button: "Want to test other people's products too? Start testing too" / "Want to post tests too? Start posting tests too". When both are on, nothing (the header's ⇄ switches sides).
- **The Settings link list stays**, with two changes: only the profile link for the side you're on (Tester profile OR Developer profile), and no "Change password" link (the "Change your password" form is on the same page). Payments, Notifications and alerts, Blocked people, Privacy and Contact us stay.
- **"Your excerpts" list removed** from this page (it's on the tester's own profile, with Remove). A suspended tester's Remove excerpt (batch 13) must stay possible: the tester profile's excerpt list stays reachable while suspended, or Remove is offered from the dashboard's blue box; report which.
- **Unchanged:** Change your password (the form), Signed-in devices, Delete account. Blocked people and Delete account stay account-wide (a block is between people; Delete account removes the whole login, both sides).
- Update the design doc references and media/evidence steps that read the removed items.

## 31. Invite: requirement changes update the panel and stop Invite once (bug found by the owner, Oct 28)
Owner's test: the test's required devices/languages were changed in Edit in another tab, and a tester (who listed none) added one of the new requirements and removed an old one. The old test page's invite panel didn't update, and Invite went through with no stop. Today Invite only stops for "<name> removed <X>, which this test needs".
- **Live (the page's poll):** the invite panel refreshes from the server: the filter tick boxes show the test's current devices and languages, each row's "Doesn't list …" tag, greyed state and the Suggested order are recomputed. Ticked testers stay ticked (unless now greyed). Search text stays.
- **On press (Invite and Invite anyway), stop once** if, since the panel was last shown:
  - the test's required devices or languages changed (Edit in any tab): "The test's requirements changed: Devices: Windows PC → iPad · Languages: Russian, Turkish → English";
  - a ticked tester's devices or languages changed in any way (added or removed): "Fay Ito changed their devices: none → iPad" / "…removed Russian, which this test needs".
  The box ends "Press Invite again to go ahead." The panel shows the updated tags at the same time. On the second press, a ticked tester missing a current need gets the usual "Invite anyway" confirm with the CURRENT needs; Invite anyway also re-checks that the gap lines it shows are current (the server's `seenGaps` check) and stops once if not.
- Covered by "Listing changes" (test requirements) and "Joins and applications" (tester profile) in Alerts? No: these are Invite's own checks and always stop Invite (like today's "removed X" line).
- Tests: both changes from the owner's case; only the test's requirements changed; only the tester's profile changed (added, removed); Invite anyway with stale gaps; the panel's live refresh.

## 32. Tester invitations follow every close, live and on press (owner, Oct 28)
Rules unchanged: an invite stays open when the test is full ("…is full right now. Your invite stays open…") and is sent again when an Edit changes the listing (it stays pending, on the new listing); it closes when the test or the developer can't take testers (any pause, hold or suspension, a stop, a deleted developer), at Open until, when the developer cancels it, after a block either way, or when the tester is deleted. After a pause or hold the developer can invite again; nothing reopens by itself.
- **Live:** the tester's Invitations (dashboard and the join page) update on the poll: a closed invite's card disappears, with a neutral line in the live box, e.g. "Your invite to “Harbor Run” was closed." A re-sent invite updates its card in place ("Sent again on the new listing · <date>"); a full test's card shows "Full right now: your invite stays open".
- **On press:** Join this test / Accept / Decline on an invite that closed meanwhile is refused (no stop box) with the reason, and the card disappears:
  - pause, hold or the developer's suspension: "“<test>” isn't taking new testers right now, so this invite was closed." (never "hold" or "suspended");
  - Open until passed: "“<test>” closed to new testers on <date>.";
  - stopped (or developer deleted): "This test was stopped.";
  - cancelled, blocked or anything else: "This invite is no longer open."
- A press on an invite that was re-sent meanwhile stops once as today ("<dev> updated <test>: …"), showing the new listing.
- Tests: each close reason (live removal + refused press + card gone), the re-sent case, the full case.

## 33. Calls: live panels, one scrollable requests panel, clashes shown before the press (owner, Oct 28)
Owner's case: fbbb requested Mon, Nov 2, 1:38 PM while the developer was filling Request a time with the same time. The developer's press stopped once (listing the request), but the tester card below still read "No calls or requests", and nothing marked the clash.
- **Live:** the Live session panel updates on the page's poll: each tester card shows new requests (theirs and yours), bookings and cancellations as they happen; the stop box is no longer the only place a new request appears.
- **One "Call requests" panel** (developer test page, Live session; and the tester's session page for their own): every waiting request on this test in both directions, soonest first: tester, time(s), Once / Daily / Weekly (N calls or Forever), length, who asked, with Accept / Decline (theirs) or Withdraw (yours). A plain scroll box about 5 rows tall (§14 style); updates live.
- **Clash checks while filling the form** (both sides' Request a time; each time row checked live as it's typed and whenever the data changes), for every ticked tester and every call in a Daily / Weekly set (Forever: its first 8):
  - **Exact match** with the other side's waiting request (same start, same length, same repeat): not red; a blue line under the row "fbbb asked for exactly this: Request a time books it." The press books at once, as today ("Booked: you both picked <time>"), and both requests leave the panel.
  - **Overlap** with a call or waiting request between the two of you: red "Overlaps fbbb's request for Mon, Nov 2, 1:38–1:48 PM." / "Overlaps your call with fbbb on …".
  - **Overlap with the developer's other calls** (another tester, any of their tests): red "You have a call with Ana Silva then (1:30–2:00 PM)." Same for the tester's other calls.
  - Two rows in the same form overlapping each other: red on the later row.
  - The existing limits (3 waiting requests, 3 booked times, the $1,000 for a tester's calls) show red at the form before the press, with today's wording.
  - A set with a clash names the first one: "The 3rd call (Thu, Nov 12) overlaps …".
  - Red rows follow §10 (listed under the button, the button refused until fixed); the server re-checks everything on press.
- **Stop-once unchanged:** a change the page hasn't shown yet still stops the press once, and the panels already show it.
- Tests: the owner's case (exact match books, panel updates), an overlap from each source, a weekly set with a later clash, live arrival of a request while the form is open.

## 34. (Moved to post-launch by the owner, Oct 28: do NOT build) Files placed at the cursor in written answers
Keep today's "Files and recordings" box under the written answers for launch. If any of this was started, revert it. The idea (📎 and ⏺ in each answer's toolbar, files shown in place) goes in the design doc's post-launch ideas.

## 35. Call requests in Needs you open the Live session panel (owner, Oct 28)
The Needs you row "<tester> asked for a live call: <time> · <length> · <Listed/Not listed>" (developer test page and dashboard) loses its own Accept / Decline. The whole row (and a "Answer in Live session →" link on it) opens the test page at the Live session's Call requests panel (§33) with that request highlighted for a few seconds. Accept / Decline happen only there, so they follow every rule of that panel: stop-once (blue box), the clash checks, the paused / stopped / restricted refusals, and §25 where it applies. The row still leaves Needs you once the request is answered, withdrawn or closed (live). Same for a tester's view if they have such a row.

## 36. Money boxes round to cents instead of refusing (owner, Oct 28)
Today `toCents` (lib/format.ts) refuses more than 2 decimals ("Enter an amount like 7.50."), so "1.4545454545" in a Pay box is red and Pay is refused.
- Every money box (Pay, Pay more, a call's rate and amount, Charge, Post/Edit prices and the live rate, Pay what you owe if typed) **rounds to cents when the box is left**, half up, and shows the rounded value (1.4545 → 1.45; 2.005 → 2.01), so the developer sees exactly what will be charged before pressing.
- The server rounds the same way (toCents accepts any number of decimals and rounds); a press that arrives unrounded is charged at the rounded amount shown in the result.
- Limits and minimums apply to the rounded value ($0.50 minimum, caps).
- Still refused: letters, negative numbers, empty where required.
- Tests: 1.4545 → $1.45 on blur and on the server; 0.495 → $0.50; 0.494 → refused below the minimum (or $0.00 if typed as 0.004 → 0.00: allowed as $0 with its reason).

## 37. Excerpts show the question they answer (owner, Oct 28)
On the tester's profile ("Excerpts of their work") and their own "Your excerpts" list, each excerpt shows the question it answers above the quote, in small grey text cut to 2 lines with "Show more" (the data already carries `question`; ExcerptList.tsx doesn't render it). The developer's Allow / Deny row in Needs you shows it the same way. An excerpt from "Anything else" reads "Anything else (bugs, ideas)".

## 38. Two bugs from the owner's test (Oct 28, ~2:10 PM)
**A. "That offer doesn't exist." under Switch / Keep.** The offer arrived while the session page was open (it came in through Send's stop box at 2:09 PM). `TesterTop` keeps `offerId` in `useState(offer?.id ?? "")`, so it stays "" when the offer appears live, and the press sends an empty id; `decideTerms` (terms.ts ~67) then throws "That offer doesn't exist."
- Fix: `offerId` follows the offer currently shown (update it whenever the live offer changes).
- Server: when the id is missing or not the newest open offer, act on the newest open offer under the existing "changed the terms again" stop-once (shows the newest; the second press decides on it). Only when there's no open offer at all: "These terms are no longer on offer." (never "doesn't exist").
- Test: the offer arrives after the page loads; Switch and Keep both work; an offer replaced by a newer one; no offer left.
**B. Dispute didn't stop once for the developer's call request (tester Alerts On).** Likely cause: the developer's Request a time shows to the tester as kind `offered` (calls.ts ~63, "A new call time was offered"), but the tester's stop-once `KINDS` in testerGate.ts (~78) list `requested`, `booked`, `cancelled` and not `offered` (nor `removed`, `withdrew_req`, `declined_req`, `confirmed`). Check every call-change kind the tester can see is in the tester's kinds, for every tester press (Dispute, Send, Charge, Let it go, Rate, call buttons, Switch / Keep), and that the Dispute box sends `seenAt`. Test: each call change before each tester press stops once with Alerts On, and doesn't with Alerts Off.

## 39. Charge: no confirm tick, except above $200 (owner, Oct 28)
The tester's Charge box today needs the tick "charge <dev> $X now" for every amount. Remove it for ordinary amounts: the Charge button (which already names the amount, "Charge Nora Lane $9.00") goes through on its own. Above $200 (the same `PAY_TICK_CENTS` line the developer's Pay uses), the tick stays and is required: "Charge Nora Lane $X now (over $200)"; the button stays disabled until it's ticked, and the server refuses an unticked charge over $200 (the tick must name the typed amount, as today). Let it go is unchanged. Update tests and media steps.

## 40. Tester's live call part: no blue box per call (owner, Oct 28)
On the tester's session page, each held call under the Live call part shows a blue box "Live call on <time>: waiting for <dev> to pay. Listing: $15.00 · Paid so far for this part: $0.00 (you get 80%)". Remove the blue box; the part line above already shows the contract rate and paid so far. Each call becomes one short grey line: "<Wed, Oct 28, 5:49 AM> · 30 min · waiting for <dev> to pay" (or "paid $X", "charged", "let go"), with Charge / Let it go / Dispute under it when they apply, as today. Blue stays only for real notices.

## 41. Chargeback hold: verify first, then pay, then the team lifts it (owner, Oct 28)
The three steps on Payments stay (verify a card with 3D Secure, pay what is owed, the team's Approve), now in strict order:
- **Pay what you owe is disabled until a card is verified with 3D Secure**, with the line under it: "Verify your card first (step 1): then you can pay what you owe."
- **Paying doesn't lift the hold** (DEFAULT, owner to confirm): after the payment goes through, step 2 shows ✓ and the box reads "Paid. Your tests stay paused until the team approves." The hold lifts only when an admin presses Approve (step 3); the bell "Your tests are running again" comes then.
- The server refuses Pay what you owe during a chargeback hold without a verified card ("Verify your card first.").
- Payment holds (not chargebacks) are unchanged: paying lifts them as today.
- Tests: pay before verifying (disabled and refused), verify then pay (hold stays), admin Approve lifts it.

## Check and report
- Tests for items 1, 3, 4 and 5 (item 1: a tester joining with 40 days, 10 days and 2 days; a deadline moved later; a paused test).
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- No migration unless item 1 truly needs one; if it does, hand-write it and check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code` (template1 is damaged), and apply it only to the local `playtest_lite` DB on port 5499.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
