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
- **Most presses in another tab** (Stop, End early, Next round draft, Pay, Pay more, Edit saves, Accept/Decline applications, excerpt Allow/Deny, Rate…): no line in the live box. The page's UI updates as usual on its poll (banners, rows, buttons). **On press only:** a press this tab makes that the other tab's action affects (the same press, or one on the same thing) stops once with "You also did this in another tab: <what>." (as today), then refuses or goes through as usual. Edit keeps its own field notes (§17–§20).
- **End early in another tab (owner):** silent; this tab just updates (those testers show as ended). It stops once here only if this tab presses End early for any of the same testers ("You also did this in another tab: ended Ana Silva's work early"); testers already ended are dropped from the press, the rest go through after the second press.
- **End early here after pay or call actions in another tab (owner):** stops once only when those actions touch the testers ticked in this End early (a Pay on their work, a call requested, booked or cancelled with them), because the pop-up's summary for them (calls cancelled, work still waiting for Pay) is out of date; the box names what changed and the pop-up's summary refreshes. Pay or call actions about other testers don't stop it.
- **Invites and calls in another tab are the exception: live AND on press.**
  - Live: a line in the live box naming the change ("You invited Ana Silva in another tab", "You requested a call with Ben Okafor for Nov 3, 3:00 PM in another tab", "You cancelled the call with Cam Lee on …"), and this tab's UI updates at once to match: the invite panel shows the tester as "Invited <date>" (greyed, Cancel invite), the call panel shows the request or booking, a cancelled call leaves the list.
  - On press: an invite or call press touching the same tester or call stops once naming that change; after the second press, trying the same thing again shows it's already done (e.g. requesting the same time: "You already requested this time with Ben Okafor." as a refusal, and the request is shown in the panel).
- Tests: Pay in tab A then Pay in tab B (stop once, no live line); invite in A shows live in B and greys the row; same call request in both tabs; Stop in A updates B without a live line, and Stop in B stops once.

## Check and report
- Tests for items 1, 3, 4 and 5 (item 1: a tester joining with 40 days, 10 days and 2 days; a deadline moved later; a paused test).
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- No migration unless item 1 truly needs one; if it does, hand-write it and check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code` (template1 is damaged), and apply it only to the local `playtest_lite` DB on port 5499.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
