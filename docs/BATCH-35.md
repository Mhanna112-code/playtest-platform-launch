# Batch 35 (owner, Oct 30)

## §1 A tick on a dispute decision that charges
When an admin's Decide raises a dispute's pay, a tick appears next to Decide naming what it charges, for any amount (not only over $200):
"Charge Dana Reyes $6.00 more ($10.00 in all for this piece)". Decide stays disabled until it's ticked; changing the amount unticks it.
Keeping the pay (blank, or the amount already paid) needs no tick. The server refuses a raise without the tick, or with a tick for
another amount: "Tick “Charge … more (…)” to decide." and nothing is charged; the dispute stays open.
During a payment or chargeback hold the raise is still added to what the developer owes, as before.

## §2 Accept / Decline name their press
On a developer's application row the stop box names the button pressed: "Your Accept didn't go through. … Press Accept again to go ahead." (Decline likewise),
not "Answer". The label comes from the request body's `action` (src/lib/pressLabels.ts `bodyPressVerb`, used by `pressLabelOf` on the page). The server's
failed-press lines (a team pause or stop, a suspension or hold: "Your Accept on Harbor Run didn't go through") name it the same way. Every other press keeps its wording.

## §3 See it marks only its own save's fields
Each listing line ("You saved the listing in another tab: … · See it") carries the save it is about (the time of that save's `listing_saved` record), in the top
box and in the stop boxes. The developer's Listing panel says which save it shows (`data-saved-at`). See it:
- the panel shows that save: marks its fields, as before;
- the line's save is newer (the line arrived before the page redrew): the page redraws first (router.refresh) and marks the fields once the panel shows that save
  (it waits up to about 10 seconds, then only brings the panel into view);
- the line's save is older than the panel's: brings the panel into view and marks nothing.
It never marks another save's fields. The session page's contract box works as before.

## §4 A short marker for files in written answers
A file or recording placed in an answer shows in the answer box as a short marker, one format for both: "[📎 map.png #k3f9]". The tag is the end of the
upload's id (4 characters, more only when another upload on that contract ends the same; the server gives it when the upload starts), so the marker keeps a
stable link to the upload; the server's removal checks and every renderer resolve it against the contract's uploads. Answers already stored with the long form
"[[attachment:<id>|map.png]]" still render. Markers still don't count toward the 50,000-character limit or the 50-character minimum; excerpts still show "[file]".

## §5 File sizes
Files and recordings show their size in KB under 1 MB ("15 KB") and in MB with one decimal from 1 MB ("1.1 MB"): the written answers' file list, the chips in
answers, the sent piece's attachments and the recordings list (one helper, `fileSize`).

## §6 Keep what was typed when another tab moves this one
When the account switches sides in another tab, an open tab still reloads to the new side, and when another account signs in in another tab, open tabs still
switch to it; neither loses what was typed:
- Side switch: every open form draft (useKept) is sent at once before the reload (it waits a moment for them).
- Both: the page's other typed fields (text boxes and dropdowns with an id or name in the main content; never passwords, files, hidden fields, ticks or
  card / payment fields) are kept in that tab, under the account, the side and the page. They come back only when that same account, on that same side, shows
  that same page in that tab again (for a side switch, after switching back), into fields that are still empty; a line says "Kept what you typed before you switched."
  for a few seconds. Restored, or after an hour, they're gone.
- Privacy: what one account typed is never shown to another account. A draft request names the account its page belongs to; the server refuses it when the
  browser is already signed in as someone else, so on an account change nothing is sent, and the kept fields are only for the account that typed them.

## §7 A link to a paid piece
Bell and email lines such as "Ana Silva sent written answers for …" link to the test page at the piece (`#piece-<id>`, in Needs you). Once that piece is paid it
leaves Needs you; the link then goes to that part's line on the tester's row (`#part-<id>`, marked a moment) instead of the top of the page. Links whose target is
still on the page work as before.

## §8 Drafts after signing back in (owner, Oct 30)
Forms keep a typed-but-unsent draft on the server per person and form (useKept, `/api/kept`), shared by every tab and device (last typed wins).
1. Still signed in (other tabs, live updates, a side switch reload): everything stays as it was. Edit keeps its per-field notes with "Use theirs", the
   stop-once lines and the ticks; a side switch keeps the tab's typing (§6). The line "Kept what you typed before you switched." is gone: the tab's typing
   comes back silently.
2. Signing back in (after signing out, or after another account signed in on this browser): every form comes back with its latest draft (last typed, any tab
   or device), marked "Draft" with a "Use saved" button that puts it back to its saved value (a box with nothing saved yet, such as a chat message, a rating
   comment or a reason, empties). On Edit and Post the tag and "Use saved" are per field (the parts and prices share one, the questions and their Required ticks
   share one), and "Use saved for all" beside Save puts every marked field back. Written boxes covered: Edit / Post's Product, Name of this test, Instructions,
   Link, NDA, Why it's mature, Questions and the access keys; written answers and notes; the tester's dispute reason; the developer's dispute side; the Pay /
   Pay more note; End early's and Stop's reasons; rating comments; chat messages; Contact us. (Fix: the Pay / Pay more note was never kept: its keys were
   missing from the server's list.)
3. Selections and numbers after signing in. One switch decides it (`SIGN_IN_DRAFTS` in `src/lib/keptText.ts`), applied at every sign-in on the server, so it
   holds on every device:
   - "whole" (in use, Oct 30, while the owner reconsiders this step: some selections belong with their text, such as the Mature tick with Why it's mature, the
     written part and its Required questions with Questions): the draft comes back whole, text and selections, and each changed field is marked Draft with
     Use saved. Call requests' times, length and ticks come back the same way.
   - "written" (the first wording of this step): every selection or number (Open until, part ticks and prices, spots, devices, languages, join mode, categories,
     Contact us' topic, call times / length / ticks) is dropped at the sign-in, so it shows the SAVED value; a draft with nothing written goes.
   Things outside a kept form (invite ticks, search boxes) always start over after signing in.
4. The tab's own copy (§6) is kept only for a side switch while still signed in. When another account signs in, nothing is snapshotted, and the tab's copies go
   (also at every sign-in and sign-out in that tab); the server's drafts bring the written boxes back when that person signs in again. One account's text never
   shows for another. Signing out sends the forms' drafts first, so what was typed that moment is kept.
5. Wording: the tag reads "Draft" (it read "Not sent yet"; Edit's whole-form "Not saved yet" and Post's "Not posted yet" stay for a draft back while still
   signed in), the button "Use saved".

## §9 An early dispute waits for Stripe's retry
Found in the Stripe test-mode run (Oct 30): a dispute can arrive a moment before the app has recorded the payment it is about (1–2 seconds in test mode). The
webhook stored the event as handled and did nothing, so Stripe's retries were ignored and no chargeback hold started. Now a dispute (opened or won) on a payment
not recorded yet answers 503 and the event is forgotten again, so Stripe's retry (for up to 3 days) is handled. Any other failure while handling an event does the same. Before that, the dispute waits up to 8 seconds for the payment to be recorded (the usual
gap is a second or two), so the hold starts at once; the log says "dispute arrived before its payment was recorded; waited 1.4 s".

## §10 Discard where nothing is saved; drafts for the Apply note and profile edits (owner, Oct 30)
1. The button beside "Draft" after a sign-in is named by what the box has (`DraftTag`'s `kind` in `src/lib/useKept.tsx`; same press either way):
   - "Discard" (kind "discard") where the box has no saved version (its text only exists once its button is pressed): End early's and Stop's reasons, the
     developer's dispute side, rating comments (both sides), chat messages, the tester's dispute reason, Contact us, the developer's Request a call form, the
     tester's call request form (Propose times) and the Apply note. It empties the box and the draft goes. On a call request it clears only the form being typed;
     sent or pending requests and booked calls are untouched.
   - "Use saved" (kind "saved") where a saved version exists: Edit, Post (Use saved = the empty start; "Use saved for all" stays), Pay / Pay more, written answers
     and the profile.
2. Two more drafts, kept like the others (while typing; "Draft" after a reload; after a sign-in "Draft" with its button; cleared when the press goes through; a
   stopped or refused press keeps it). The server's list of kept forms (`src/lib/server/kept.ts`) adds both prefixes.
   - The tester's note to the developer on the join page (`apply:<testId>`): the note sent with Apply to join, and with Ask to rejoin (Join itself has no note).
     After a sign-in: "Draft" + "Discard" at the note. Apply, Ask to rejoin or Join going through (the button or the needs pop-up) clears it; Withdraw doesn't.
   - The profile edits (`profile:<side>`, one per side, since each side's form shows different fields): the fields that differ from the saved profile (name,
     pronoun, devices, languages, bio). After a sign-in: "Draft" + "Use saved" beside Save profile, putting every field back to the saved profile. Save profile going
     through clears it. The first setup (after sign-up) keeps no draft. Per `SIGN_IN_DRAFTS` ("whole") the draft comes back whole, text and selections; under
     "written" only the name and bio would.

## §11 Drafts for the admin console's reasons and Decide (owner, Oct 30)
Every admin box with typed text or an amount keeps a draft like the other forms (§8, §10): per admin and box, on the server (`/api/kept`), shared by every tab and
device (last typed wins); "Draft" after a reload; after a sign-in "Draft" with its button; cleared when the press goes through; a stopped (stop-once) or refused press
keeps it. The key is `admin:<action>:<id>` (one prefix, `admin:`, on the server's list of kept forms). Only admins may keep or read an `admin:` draft: the server
refuses anyone else ("Only admins can do that.", 403) and keeps nothing; an admin whose account is suspended loses admin access, so their admin drafts too.
- The dispute Decide (`admin:decide:<disputeId>`): the total and the note. After a sign-in the total's button is "Use saved" (it puts the total back to blank, keeping the
  pay as it is); the note's is "Discard". The tick (§1) is never kept: a restored raise is ticked again before Decide, and Use saved unticks.
- Every admin button's box (`admin:<action>:<target id>`, "Discard"): Suspend's Why with its side choice (`admin:suspend:<userId>`), Delete account's Why
  (`admin:delete-account:<userId>`), Pause's and Stop (close)'s Why (`admin:pause-test:<testId>`, `admin:stop-test:<testId>`, the same on the tests list and the
  test's own admin box), Extend's days (`admin:extend-pause:<testId>`) and Don't approve's Why (`admin:decline-chargeback:<chargebackId>`). A draft puts back only the
  button's own boxes (and a side its choice still offers). Buttons with no box (Reinstate, Lift the pause, Mark replied, Approve, Close now, Allow 3 more changes,
  Approve / Dismiss a gap, Clear this list) keep nothing.
- The team close-out's reason (`admin:team-close-developer:<userId>`, `admin:team-close-test:<testId>`, "Discard"): its tag shows beside Preview until the reason box shows.
- The hold lift's note to the developer (`admin:approve-hold:<liftId>`, "Discard").
- A box swapped in for a new state starts empty, as before (batch 27 section 5, batch 33 §7): Suspend's draft is kept with the sides open when it was typed and never
  comes back into a Suspend box for other sides (it goes); a test paused while its Pause box was shown drops that Pause's draft.
- With `SIGN_IN_DRAFTS` "written" the reasons and notes would come back and the numbers (Decide's total, Extend's days) would not.

## §12 A first rating stops once; at most 20 questions in the box (owner, Oct 30)
- Invite, Invite anyway, Cancel invite, Accept and Decline stop once when a tester the page showed with "No ratings yet" has since got their first rating:
  "fbbb got their first rating: 1.0". (A page that didn't say what it showed never stops for it.) The full-star rule for later changes is unchanged.
- Post / Edit's questions box takes no 21st question: typing on a new line past 20 questions is ignored, and a paste keeps the first 20. Editing the 20
  and empty lines are free. The server's 20-question refusal stays.

## §13 Each question once (owner, Oct 30)
The same question twice in Post / Edit's questions box (ignoring case and extra spaces) is red at the box and refused on Save / Post:
"“What did you like?” is in the list twice: each question can be there once." A tester's draft answers follow their questions by text, so after
the developer changes the questions (and the tester switches to them), answers to questions that stayed the same keep their draft, in any order.

## §14 The join page shows the Listing panel; See it on every listing line (owner, Oct 30: batch 34 §14 "The join page too")
- **The panel.** The join page's listing section is the developer's Listing panel (`ListingPanel side="tester"`, id "listing"), rows from
  `testerListingPanel` (src/lib/server/listingPanel.ts): every field of the current listing, the fields of the most recent listing Save tagged
  "Updated <time>" (Before / Now), and `data-saved-at` naming that Save. The header card (tile, product, title, "by <dev>", rating, Invited / approves
  badge, price block, the category / part / Mature / NDA / device / language / testers badges) sits at the top of the panel and "What testers said" at its
  foot; the steps and the Mature note, which the header card showed, are the panel's "What to do" and "Mature (18+)" lines. "How it works",
  "<dev> wants to know", "Your deal" and "How <dev> reviews" stay as they were.
- **The tester's words, nothing developer-only.** Prices are the tester's 80% ("Written answers: $8.00 for you · Required", "$24.00/h for you · 30-minute
  calls"), never the developer's price; "Your deadline: 14 days from joining" (the days the page's deadline uses); "Who can join: Approved only (the developer
  accepts or declines)"; "Spots: 3 · 2 spots left". The build link is never shown before joining: "Build link: You get it when you join" (a changed link
  reads Before "An earlier link"), as the join page never showed it (it can be under an NDA the tester hasn't accepted). Access keys are never in it, and a
  Save of only the keys isn't the tester's "most recent Save" (the panel keeps the last listing Save's tags). No hold, suspension, failed payment or chargeback.
- **See it everywhere.** Every listing line on the join page names its Save (`saveAt`, the time of that Save's `listing_saved` record, as on the
  developer's side) and carries the green See it to the panel, with the batch 35 §3 rules (marks when the panel shows that Save; redraws first when the
  line is newer; marks nothing for an older Save): the top box, "Changed since you opened this page" (now through `seeItClick`), every stop box (the page
  is wrapped in `SeeItTarget "#listing"`; No thanks' box too, which now also reads as the tester's box), and the "Join anyway?" / "Apply anyway?" /
  "Ask to rejoin anyway?" pop-up (it closes, then scrolls). A rename alone is a listing line too (it still never stops a press). The pop-up's own needs
  lines ("Nora Lane added Spanish to the languages this test needs") name the Save that last changed the devices or languages (`needsSaveAt` from my-gaps).
- **Pays on average** (owner, Oct 30) shows only on the developer's own dashboard: it's gone from the join page's "How <dev> reviews" and from the developer
  profile as testers see it (and the developer's own view of it); `DeveloperTiles pays` on the dashboard only, the profile's footnote without its sentence.

## §15 The Listing panel's labels read apart from its values (owner, Oct 31, screenshot of the developer's Listing panel)
- "No way to tell difference between question and answers": every line read "Label: value" in the same text ("Product: PENIQQQ", "Name: …", "What to do:" then the
  text, "Questions:" then the quoted questions). Now each line is its **label** (small, muted, uppercase: `text-[11px] font-medium uppercase tracking-wide
  text-slate-400`, on its own line, no colon) over its **value** (bright, `text-slate-100`). The "Updated <time>" tag stays right after its label (Before / Now
  opens below it, above the value).
- **The questions** are a numbered list (`QuestionList numbered`), each question quoted, with **Required** as a small amber tag after the quote (never
  "(required)" inside it). More than 3 still sit in the batch 20 scroll box.
- **What to do** and the **NDA** keep their scroll boxes (6 and 4 lines tall), now on a faint ground so the long text reads as the value.
- One component (`ListingPanel`), so the developer's test page and the tester's join page (§14) look the same.

## §16 An idle tab never sends its older draft again (bug found on video, Oct 31)
- "One draft per form, last typed wins" failed on sign-out: three tabs on one session typing different answers; Log out in one tab made that tab send its
  OLDER text again (`flushKept` asks every mounted form to send now, and each form sent its text whether or not it had changed), so after signing back in every
  tab showed the first-typed answer. Leaving, hiding the tab and the side-switch reload sent the same way.
- Now a form sends on a flush (Log out, Sign out of all devices, leaving, hiding, the side-switch reload) **only what this tab typed since its own last save**
  (`flushDraft` in src/lib/useKept.tsx: typing marks the draft unsent; the save a moment later, or the flush, sends it). A tab whose last typing is already
  saved, or that only showed the draft, sends nothing, so another tab's newer draft stays. Typed within the moment before Log out: it still goes (it is the
  last typed); emptied within that moment: the draft goes.

## §17 One line per rename saved with other fields (bug seen once on video, Oct 31)
- A rename saved in another tab with other fields showed twice on the developer's test page: in "You saved the listing in another tab: title (now “Harbor Run:
  night harbors”), …" and as "You renamed the test to Harbor Run: night harbors". **Cause:** the Save's own line is written to the action log only after the
  Save's transaction and its response (logTestAction), while the "renamed" event is written inside it. A live poll in that moment (the other tab's page redraw
  asks at once) found the rename without the Save line, so devChanges kept it; the live box keeps every line it ever got, and the next poll added the Save line:
  two lines. (The wording check from batch 30 was right; the timing wasn't covered.)
- Now the Save's own record (`listing_saved`, written in the same transaction before the rename) says it at once: it notes the tab that saved and, when the
  access keys changed too, `keys`. A rename of the developer's own whose Save changed more than the title (or the keys), from another tab than the page's, is
  never its own line: the Save's line names it. A rename alone stays its own line ("You renamed the test to …", info only); the tab that saved keeps what it had.

## §18 A restored draft can always be discarded (owner, Oct 31)
- Signed in, Post a test opened with the shared draft (key `test:new`) and only "Not posted yet" at the bottom: no way to start a brand-new test. Now **whenever a
  form opens with a restored draft** (a reload, a new tab, or after a sign-in), its Draft tag shows its button ("Use saved" where a saved version exists,
  "Discard" where nothing is saved: §10), not only after a sign-in. Every form (written answers, chat, rating comments, reasons, Pay / Pay more, the profile,
  call requests, the Apply note, Contact us, the admin console's boxes, End early / Stop reasons).
- **Post / Edit** also open with a line at the TOP of the form: "Started from your unsent draft (<time the draft was last kept>) · Start empty" on Post (every
  field back to the empty start, the keys too, and the draft is deleted) / "· Use saved for all" on Edit (and on a saved draft opened in Post: every field and
  the keys back to what is saved; the draft goes). The time comes with the kept draft (`/api/kept` now returns `at`).
- **Every field the draft changed is marked** (owner, Oct 31: Edit opened from another tab's draft didn't say which fields came from it): whenever Post / Edit
  opens from a restored draft (a reload, a new tab, or after a sign-in), each field that differs from the saved listing (Edit, a saved draft) / the empty start
  (Post) carries "Draft" with its button, as after a sign-in (§8). A field typed in this tab after opening keeps its mark too until the draft is saved, posted
  or emptied (the marks follow the draft, not who typed: the simpler rule). The whole-form "Not saved yet" / "Not posted yet" tag shows only when no field
  differs.
- **The tester's written answers** the same way: each answer box (and "Anything else") whose restored text differs from what was sent (or from empty when
  nothing was sent) shows "Draft" with "Use saved" under that box (that one box back to its sent answer, or empty); one "Use saved for all" beside Send
  replaces the single Draft tag there. A file whose marker leaves with a reverted box follows the existing rules (named by no box: back in the files list).

## §19 A field that becomes disabled never keeps its red line (owner's bug, Oct 31)
- Post / Edit, Parts and prices: Live session ticked, its rate box empty and red ("Enter an hourly rate for live calls, or tick Free."); ticking Free greyed
  the box but the red line stayed and couldn't be cleared, even after unticking, leaving the box and ticking Free again. **Cause:** FieldChecks re-checked a
  red field only on its own typing / leaving, and a disabled field was skipped by the checks but kept the red it already had.
- Now (src/components/FieldChecks.tsx) a disabled field (itself, or inside a disabled fieldset) is never red: no outline, no line, never in the list under the
  button (`redFields`), skipped by a press's checks, and the server's line for it goes too. Every red field is checked again after any typing or tick
  anywhere (once the page has redrawn) and whenever an attribute that decides its rule changes (`disabled`, `data-required`, min / max…: a MutationObserver),
  so ticking Free or unticking the part clears that box's red mark and line at once, every time. Each field still goes by its own value: editing another
  field never fixes it.

## §20 A tab keeps its place when a request finds it signed out (bug from the video run, Oct 31)
- A request that got a 401 sent the tab to "/login" with no `next`; when such a background request beat SessionWatch's redirect (which keeps `next`), the tab
  landed on the dashboard after signing back in. Now both go through one `toLogin` (src/lib/client.ts): `/login?next=<path + hash>` (or `/login?gone=1` for a
  deleted account), and only once per page.

## §21 "Everyone you ticked now meets this test's needs" only while it's true (bug from the video run, Oct 31)
- After a press stopped once for a needs change, the Invite panel still said "Everyone you ticked now meets this test's needs. Press Invite to send." beside
  ticked testers tagged "Doesn't list languages" (the next press opened the needs box for Spanish). The notice now shows only while it's true for the current
  ticks and rows: someone is ticked, and every ticked tester's profile (as the rows show it) meets the test's needs as the page now has them (`everyoneMeets`,
  src/lib/gaps.ts); after a stop or redraw that makes it false, it goes.

## §22 A chargeback hold names the chargeback steps (owner approved, Oct 31)
- During a chargeback hold, paying isn't enough (a 3D Secure card check and the team's approval too). The developer's lines now read "Your tests are paused
  until the chargeback steps are done." with "the chargeback steps" linking to /app/payments#chargeback-steps (the test page's banner); Invite's line "This test
  is paused until the chargeback steps are done, so nobody can be invited."; the calls line "…: calls wait meanwhile."; the test's own "paused" line when the
  hold starts. A payment hold keeps "until you pay what you owe". The header strip already said "Your tests are paused after a chargeback. Follow the steps in
  Payments." Developer-facing only.

## §23 A new Post has nothing saved: Discard and Start empty (owner, Oct 31)
- Post a test for a NEW test (key `test:new`): each field's Draft mark reads "Discard" (that field back to the empty start) and the whole form's buttons read
  "Start empty" (the line at the top, and the one beside Post after a sign-in); never "Use saved" / "Use saved for all". A saved draft opened from the drafts
  list (`test:draft:<id>`) and Edit keep "Use saved" / "Use saved for all".

## §24 The question checks only while the written part is on (owner's bug, Oct 31)
- Edit with the Written report part unticked (its questions box hidden): Save showed the red "“…” is in the list twice: each question can be there once." above
  Save, which couldn't be fixed (the box isn't shown). The question checks (each question once §13, at most 20,000 characters, at most 20 questions) now apply
  only while the written part is on (`checkListing`: `writtenCents != null`); the stored questions stay as they are. Ticking the written part on again shows
  the box, so its questions are checked then too. The questions box's own red line is never set while the part is off (§19: a hidden or disabled field never
  shows or lists a red mark).

## §25 Number-only boxes (owner, Oct 31)
- Every **money box** (`data-money`: the part prices for written answers and a recording, the live call rate, Pay and Pay more amounts and a call's rate there,
  the admin's dispute Decide total, the tester's Charge amount) holds only digits and one decimal point, with at most 2 decimals. Every **whole-number box**
  (`data-whole`: spots, a call's Length in minutes, the admin's Extend days) holds digits only (batch 20 §19: a value of only zeros is still ignored). There is
  no typed tester-deadline-days box (the deadline comes from Open until, a date picker), so nothing to change there.
- Typing anything else is ignored (the box keeps what it had and the cursor stays: a letter, a second point, a third decimal). A paste keeps only the digits and
  the first decimal point ("$1,000.50" → "1000.50"; decimals past the second are dropped, not rounded); a whole-number box keeps its digits.
- One shared helper, `src/lib/numberInput.ts` (`moneyText`, `wholeText`, `typedMoney`, `pastedNumber`, `keyAllowed`), applied by FieldChecks to every such box
  on the page (keydown, beforeinput, paste, input), before the page's own handlers. The range checks and their red lines are unchanged (data-min / data-max and
  their messages; a money box still rounds to the cent when it's left). A draft restoring such a value sets it directly, so it comes back as it was kept.

## §26 Notes under untouched Edit fields (owner, Oct 31)
- Edit open, another tab or device saves: a field this tab hasn't touched still takes the saved value (batch 23 §5, `mergeElsewhere`), and now also shows a small
  blue note under it, live: "Changed in another tab at 11:43 PM: was “Harbor Run”" ("was empty" when it was empty; under Parts and prices, which share one
  place, the field is named: "…: Price for a recording was “$15.00”"; long text folds). No "Use theirs": the field already shows their value. A later save
  elsewhere replaces the line with the newer time and what the field showed just before it.
- The note goes when that field is edited (also through a Draft mark's Use saved or Start empty / Use saved for all) and on Save (the press). Spots and Open until
  keep their own notes ("Spots: 4 → 5"); a typed field keeps its "Saved in another tab or device" note with Use theirs. `WasNote` (src/components/FieldNote.tsx),
  the same blue note style; the line is `wasLine` (src/lib/editMerge.ts).

## §27 The build link checks itself (owner, Oct 31)
- "Link to the product or build" turns red at the box with "The build link must start with https://" as soon as it holds something not starting with https://
  (on leaving it, then live as it's typed in once red, like the other fields: FieldChecks `data-pattern`, a new generic rule, with `data-msg`). On Edit only
  once the link is changed (an older link never blocks saving another field), as with the title's minimum.
- The server's refusal with that line (src/lib/server/tests.ts parseListing, now `BUILD_URL_LINE` / `buildUrlOk` from src/lib/listingFields.ts, the same rule)
  lands on that box (`fieldOfMistake` → "buildUrl", and the box's `data-match`), never as a loose line above Save.

## §28 Cents wording (owner, Oct 31)
- The parts help line now starts "Prices can include cents, like 9.99." instead of "Any cents.": "Prices can include cents, like 9.99. Free makes a part
  unpaid. Otherwise $1 to $1,000 for …".

## §29 Labels apart from values everywhere (owner, Oct 31)
- §15's look (the label small, muted and uppercase on its own line with its "Updated" tag, the value bright below it; questions as a numbered list with a
  small "Required" tag; long texts in their scroll boxes) now applies wherever listing or contract fields are listed, through one shared pair,
  `FieldLabel` / `FieldValue` (src/components/FieldLines.tsx), which the Listing panel itself now uses:
  - the tester's session page, "Your agreed scope": the contract (Written answers, Screen recording, Live call, Questions, NDA "Accepted <date>" / "None", Due)
    and the listing information (each line's "Updated" tag next to its label; What to do in its scroll box on the faint ground);
  - the new-terms offer (Switch / Keep): "Before" / "After" over the numbered questions (the offer now carries each question's Required mark);
  - the terms history's "Questions then and now": "Then" / "Offered".
- The admin console has no list of a test's listing or a contract's terms in "Label: value" lines (its Contract changes box is dated sentences, and admins see a
  test's listing on its join page, which already draws the panel), so nothing changed there. The one-line contract summary at the top of each part panel
  ("Written answers: $8 · Required") is a sentence, not a field list, and stays.

## §30 Open until's "only extended" line once, at the box (owner's screenshot, Oct 31)
- Edit restored from a draft with Open until Nov 4 (saved: Nov 28) showed the red line twice in two wordings: under the box the server's "Open until can only be
  extended: it's Nov 28, 2026 now." (FieldChecks put it there: its words differed from the page's own) and below the help text the page's own "…: it's Nov 28
  now.". Now one wording, without the year like the hint beside the box ("only later, up to Nov 29 …"): `openUntilExtendLine` (src/lib/rules.ts), used by the
  page and by the server (`openUntilShortened`, no formatter any more). The page's own line sits right under the box; the server's same line matches the box's
  `data-red-msg`, so it's never added a second time.

## §31 Every mistake under the one heading (owner, Oct 31)
- "Fix the mistake above, then press Save again." once showed an empty bullet. Now (MistakeList / redFields, src/components/FieldChecks.tsx, used by every form and
  FormMistakes): every red field's line (linked to its field) AND every server mistake that belongs to no field are bullets in the same list (no loose red
  line any more), each text once (trimmed), never blank: a red field with no line text reads "<its label> needs fixing." (`fieldNameOf`: its label, aria-label,
  legend or placeholder; "A field needs fixing." without one). The heading's count is the number of bullets (`mistakeBullets`). A server line for no field shows
  the list at once. A blue refusal (not a mistake) still shows as before.

## §32 The tester deadline a tester joining now gets, on both sides (video run, Oct 31)
- The developer's Listing panel read the stored `deadlineDays` ("Tester deadline 7 days") while the join page worked out the days a tester joining now gets
  ("14 days from joining"). The true rule is batch 15 §18: each tester gets `Test.testerDays` from joining (moving Open until later by D adds D); a test with
  Open until but no stored days: opening → Open until; neither: the listing's days. One helper, `joinerDays` (src/lib/rules.ts), on both pages, and the value
  reads the same on both: "14 days from joining" (the developer's label stays "Tester deadline", the tester's "Your deadline").

## §33 The developer's tester rows keep only the terms line (owner, Oct 31)
- Under each tester's terms line ("Switched to the Oct 31 terms" / "On their original terms · offered new terms …") the developer's test page no longer lists
  the contract changes ("Renamed: … · Sat, Oct 31, 1:01 AM", a Stop's note). They're still recorded (contractNote) and shown on the tester's own session page.

## §34 One line for all listing changes since the page's seen time (owner, Oct 31; replaces batch 34 §8's one line per Save naming its fields)
- **Developer** (their own Saves and renames in other tabs): "You saved the listing in another tab · See it", at the latest one's time. **Tester** (the
  developer's edits): "<Dev name> edited the listing · See it", at the latest edit. No field list; renames are part of it (no "Renamed" / "You renamed the
  test to …" listing line). Everywhere such lines show: the top "Updated" box, every stop box, the join page's "Changed since you opened this page" and the
  "… anyway?" pop-ups (`collapseListing` / `listingSaveLines`, src/lib/server/live.ts). A rename alone stays info only (it never stops a press).
- **See it** marks every panel line any of the covered Saves changed (`keys`, the union since the page's seen time; `panelKeysOf`); the line names the newest
  Save, so a panel that's behind redraws first (§3). A box that already holds the line replaces it with the newer one and keeps covering the earlier fields
  (`mergeChanges`, key "listing"; the live box now merges this way too).
- What isn't listing info keeps its own line: a Save's consequences ("You re-sent fbbb's invite (the listing changed)", "You closed Ana's application (the
  listing changed)", "You closed Ana's invite (fewer spots)": kept with the Save in its action-log record), the join page's NDA to accept again ("<Dev> changed
  the NDA: read and accept it again below"), a tester's new-terms offer. Edit's own Save stop (the per-field "your version will replace …" lines) is unchanged.

## §35 No Developer / Tester ticks on the Developers and Testers pages (owner, Oct 31)
- /admin/developers and /admin/testers list one side already: the "Developer" / "Tester" ticks are gone there (PagedList drops the role ticks when it has a
  `sideFilter`); Suspended, On a hold, Deleted and the search stay. A users list without a side keeps them.

## §36 Admin reason boxes as wide as the panel, the button below (owner's screenshot, Oct 31)
- Every admin button with a box (Suspend, Delete account, Pause / Stop / Extend on a test, Don't approve) is laid out as Suspend's: the box the panel's full
  width, its counter under the box's right edge, the button below (AdminButton: any button with fields is stacked). The same for the close-out reason
  (TeamCloseBox: no narrower max width), Decide's note (DisputeDecision) and the hold-lift note (PagedList). Each box shrinks with the panel on a phone.

## §39 "Use saved" only where a saved version exists (owner, Oct 31)
- A restored draft's button reads **"Use saved"** only where a saved version of that box exists: Edit's fields, a saved draft opened from the drafts list, the
  profile, and written answers already sent (back to the sent answers; "Use saved for all").
- Everywhere else **"Discard"**: Pay and Pay more (the amount back to its start: the listing amount for Pay, blank for Pay more; the note emptied; the ticks
  off), the admin's Decide total and note (ONE Discard for both; the dispute tick is needed again), written answers never sent (each box empties; beside Send
  "Discard all"), and every box that already said Discard (admin reasons, the developer's side of a dispute, the tester's dispute reason, ratings, chat,
  Contact us, call requests, the Apply note, a new Post). Same behaviour as before apart from the words (and Decide's one button).

## §37 One check, not two: the page redraw and the Updated box move together (owner, Oct 31)
- Before: pages ran two separate 20-second checks, the page redraw (AutoRefresh's fingerprint poll, router.refresh; on the join page JoinWatch) and the live
  "Updated" box with its "1 new update ↑" pill (LiveTop, its own `every` = 20 s timer). They drifted, and a redraw from elsewhere (tab focus, a refused press,
  another part of the page) could change rows, buttons or the panel up to 20 s before the box's line explained why.
- Now (src/lib/liveSync.ts): ONE 20-second timer per page. AutoRefresh, LiveTop and JoinWatch ride the clock (the first rider starts it, the last one stops it);
  each beat is the existing "live-tick" event, so the redraw's poll and the box's check run as one tick (the page's other live parts that listen to it too).
  Neither component keeps a timer of its own (LiveTop's `every` prop is gone). Two beats asked in the same moment (a refused press, a page shown again from
  the back/forward cache) are one.
- A redraw brings new data → the box checks at once: LiveTop sees its `seenAt` (the page's server render time) change on every redraw, whoever caused it.
- The box finds a new line → the page redraws at once: LiveTop asks (`askRedraw`) and the page's redraw driver answers once (`onBoxLines`): AutoRefresh
  (not Edit's watch-only one, not while the bank's check is open, not while a hold or suspension is being routed), and JoinWatch on the join page. A redraw the
  poll already asked for in the same beat is not asked twice. While that redraw is on its way the box holds its new lines and shows them (with the flash and
  the pill) the moment it lands, so the rows and the line change together; if the redraw never lands they show after 3 s, and at once when nothing on the
  page redraws (Edit). Lines found by a check during which the page already redrew show at once.
- The join page's JoinBox no longer redraws a second time for listing lines that came with that redraw (it still does for lines from a stop box).
- Steady state (nothing changes): one beat every 20 s and the same requests as each check made before, nothing extra; a change costs one extra box check
  after its redraw.
- The "seen" rule is unchanged (batch 32 §12): lines count as seen only once the top box is in view.
- Pages: the developer's test page (and Edit, watch-only), the tester's session page, the join page, the dashboard (invites box). Tests:
  tests/batch35-sync-checks.test.ts (one timer drives both; a new line redraws and shows as the redraw lands; the poll's redraw isn't doubled; the wiring).

## §38 No "Files and recordings" box under the written answers (owner, Oct 31)
- The box under the tester's written answers is gone (WrittenAttachments: "Attach a file (images, PDF, text or zip; 500 MB each, 5 at most) or a video",
  Choose File, "Record your screen", "With my microphone"). Files go in each answer with 📎 (batch 27 §3), shown in the answer's live preview with × to remove.
- Kept: the limits, checked by the server on 📎's upload as before (5 files, 5 recordings, 500 MB each, with their lines); × in the preview removes a file;
  answers sent with files that were only in that box still show them on every view (the tester's sent view, the developer's piece view, By question, admin
  See the work: those renderers are unchanged); the recorded part's own recorder (with "With my microphone") is untouched.
- What the box carried that 📎 didn't: the per-file "in your answer to “…”" list is dropped (the preview shows each file in its answer). Files in no answer
  (added through the old box, or whose marker was deleted from the text) still go with every Send, so they are listed under the answers: "Files not in an
  answer (they go with your answers when you send them):" with each file's name, size and ×. That line replaces the box's "goes with your answers when you
  send them" note; it shows only when there is such a file.

## §40 Keep your place after a press (owner, Oct 31)
- Before: on the tester's session page (Send on a recording, uploading a recording or a file, Remove, Send for written answers, call requests, Charge, …) and on
  the developer's test page (Pay, call presses, Accept / Decline, Invite, …) a press that went through reloaded the whole page; with a "#…" in the address (a
  bell line, an email link, See it) the reload jumped there ("Your parts"), away from the part pressed in.
- Now a press that goes through redraws the page in place: `finish` (src/lib/usePress.ts `useFinished`) runs the router's refresh, the same redraw as the page's
  live poll (§37). The scroll stays where it was and the "#…" is never jumped to again. The same on the dashboard (No thanks, Dismiss, Cancel call), profiles
  (Block, Unblock, Report, excerpts) and the payment boxes (Pay what you owe, Confirm with your bank, Verify a card).
- Where a full reload is still needed it keeps its place: `reloadKeepingPlace` (src/lib/keepPlace.ts) drops the stale "#…" first, keeps the scroll for this tab
  and HashJump puts it back once on the load that follows (only for the same address, within 15 s). Used by: Switch / Keep the new terms and See the new terms
  (the page's parts are built on the terms), Withdraw on the join page and the Payments subscription buttons (pages that keep their load time), the admin
  console's presses (its lists are read by the page itself), and the backstops (AutoRefresh's last-resort reload and its "This page has updates · Refresh",
  ShellWatch, SessionWatch's empty-page check, a restriction that ended, a page shown again from the back/forward cache).
- Unchanged: SessionWatch's side switch from another tab (the page moves to the other side) and a restriction that just began on the dashboard (to its top).
- Invite no longer sets "#invite" before redrawing. After the redraw a box that stays on the page starts empty (a Pay more, End early's ticks and reasons, the
  call request forms' clash checks use the new rows).

## §41 A finished press stays finished (owner, Oct 31)
- Before: Pay more showed "Done" and then, for about a second before the reload, a live-looking Pay more again (the button enabled, the amount still typed).
- Now one helper for every press (`useFinished`, also inside `usePress`, so every usePress panel's buttons stay busy): from the moment the press went through
  until the page has redrawn, the pressed box's button stays greyed and disabled, its inputs (amount, note, ticks) are hidden and only the result line shows
  (PressDone, green). The line shows at least 0.9 s; the box lets go once the redraw has landed (the router refresh's transition is over). Then a box that's
  still there is empty and live again: Pay more appearing empty after the refresh is right (you can pay more again).
- The lines: Pay "Paid $10.00 to <name>." / Pay more "Paid $10.00 more to <name>." (and the existing "Paid $0.", "Closed at $0.", "Recorded …"); Charge "Charged
  <name> $5.00." / "You let it go."; "Your dispute is sent to the team."; Add your side "Your side is sent to the team."; Rate "Rated <name> 4 of 5.";
  Accept / Decline "Accepted <name>." / "Declined <name>."; Cancel invite "Cancelled <name>'s invite."; Invite keeps its own line; "Sent your answers." /
  "Sent your updated answers."; "Sent your recording(s)."; "Uploaded."; "Removed."; Request a time "Request sent."; "You left this test."; Switch / Keep
  "Switched to the new terms." / "Kept your current terms."; Pay what you owe and Confirm with your bank and Verify a card keep theirs.
- The admin console: Decide, Suspend, Delete account, Pause, Stop, Extend, close-out, Reinstate and the other AdminButton presses, and Approve on a hold lift,
  hide their boxes and keep the button greyed with "Done." / "Approved." until the console has loaded again (keeping its place).
- Tests: tests/batch35-after-press.test.ts.

## §42 Recordings can be scrubbed (owner, Oct 31)
- Before: dragging a recording's time bar (playing or paused) snapped back. Two causes: a WebM recorded in the browser (MediaRecorder, ScreenRecorder) has no
  Duration in its header, and the local file route served the whole file every time, with no byte ranges.
- The recorder now writes the recording's length (from the recorder's start to its stop) into the file's Segment Info (the EBML Duration element) before the
  preview and the upload (src/lib/webmDuration.ts, no new dependency): only the file's first bytes are patched (the Info and, when it has one, the Segment's size),
  the rest of the Blob is kept as it is. A file it doesn't recognise (not a WebM, a SeekHead whose positions would move) goes as it was; a Duration already set
  is kept. No Cues are written: with the Duration and byte ranges the browser seeks (checked in headless Edge/Chromium on a 40 s, 47 MB MediaRecorder WebM
  through this route: seeks to 30 s and 5 s paused and to 35 s while playing land there, seekable 0-40 s, each jump a 206; with the old whole-file route the
  same file snapped back to 0).
- The local file route (src/app/api/recordings/[id]/file/route.ts) answers "Range: bytes=…" (one range: "a-b", "a-", "-n", clamped to the file) with 206 Partial
  Content, Content-Range and that range's length; a range outside the file gets 416 with "bytes */<size>"; several ranges or another unit get the whole file
  (200). Every answer says Accept-Ranges: bytes. Who may watch is unchanged. R2's presigned URLs already answer ranges.
- Recordings uploaded before this keep their missing Duration (nothing is rewritten on the server): the player still shows no length for them, though the
  route now answers their ranges too.

## §43 Admin reasons in the quoted box (owner, Oct 31)
- On the admin pages every reason or note someone typed shows in the same small quoted box testers and developers already read (ReasonQuote,
  src/components/ScrollText.tsx: italic, in quotes, about 4 lines, scrolls): the tester's dispute reason and the developer's note when paying or rejecting (the
  dispute row), "Developer's side:" (Decide's box and a decided dispute), the decision's note (under "Decided … : $10.00 in all:"), report notes and no-show
  notes (the console's Reports and Call reports, a person's Reports box), the reasons on a person's Holds and suspensions box (a suspension's Why, a hold
  lift's note, a $0 close-out's reason) and Disputes box, a test's timeline (the team's pause and stop reasons, a close-out's reason, a dispute's reason),
  "Your actions" (a close-out's reason), and an account's state (each suspended side's Why under its line, a deletion's reason).
- A reason is its own part of the admin line (`quoted(…)` in src/lib/rich.ts; AdminRich draws it as the box, so those lines sit in a <div> or <li>); as plain
  text it still reads in quotes. A long unbroken word wraps (overflow-wrap: anywhere) in ReasonQuote and ScrollText, never widening the page.
- Contact us keeps its 8-line ScrollText.

## §44 The needs pop-up names where a change came from (owner, Oct 31)
- In "What this test needs" (GapDialog), a change is labelled by its source instead of "Just updated (3:20 AM):": the tester's own profile saved in another tab
  or device: "You updated your profile in another tab (3:20 AM):"; the developer changing what the test needs: "<Dev> changed what this test needs (3:20 AM):";
  both: both lines. The time is the save's own.
- When the pop-up closes because the profile now covers the needs, the page's line says the same: "You updated your profile in another tab (3:20 AM): you now
  meet this test's needs. Press Join to join." (or "<Dev> changed what this test needs (…): you now meet …", Apply on an apply test). Pressing Join when the
  page's needs are already covered compares with the page's load time.
- How: the my-gaps answer carries `profileAt` (the profile's last save), `needsSaveAt` (the Save that last changed the needs) and `now`; the pop-up keeps the
  times as it opened (the server's `now` from the check that opened it, or the "needs" refusal's `now`) and the last ones it saw: a newer one is the source.
  Neither newer: the plain "Just updated (…)".

## §45 Admins' own actions in another tab (owner, Oct 31)
- An admin's own change made in another tab or page since this page's time now counts like another admin's, in the second person, with the same pairs as batch
  34 §1. Stop once: "You paused this test in another tab at 3:20 AM." then "Press Pause again to go ahead.". The lines:
  - a test: "You paused this test", "You lifted the pause on this test", "You stopped this test", "You extended this test's closing date", "You closed this
    test", "You allowed 3 more changes of this test's locked fields", "You closed this test's open reviews for $0" (… "in another tab at 3:20 AM.");
  - an account: "You suspended the developer side", "You reinstated the tester side", "You closed 2 open reviews for $0", "You approved lifting the hold";
  - a chargeback hold: "You approved lifting the hold", "You didn't approve lifting the hold (the reservation was released)"; Approve's "nothing is reserved"
    line: "…; you released it in another tab at 3:20 AM".
- A press no longer possible says "You already … in another tab at 3:20 AM." instead of "(by you@… at …)": "You already paused this test", "… stopped this
  test" / "… closed this test", "… lifted the pause on this test", "… deleted this account", "… allowed 3 more changes of this test's locked fields", "…
  approved lifting this hold" (chargeback), "… approved this lift" (payment hold), "… approved / dismissed this possible outage", "… approved this outage",
  "… marked this replied", "… suspended the developer side", "… reinstated the tester side". Suspend / Reinstate's own batch 17 refusal for a still-possible
  press reads "Since this page loaded, you reinstated that account's developer side in another tab at Oct 31, 3:20 AM."
- A press from the same page load never stops itself: every press sends its page load's id (the x-tab header every browser request already carries), and every
  admin press that goes through leaves a marker (an ActionLog row, "test" `admin-tab`, no migration) with that id and the press's start and end; a change made
  within one of this page's presses is never news to it. A press without the id (an API call) counts only other admins, as before. Other admins' wording is
  unchanged.

## §46 Invite search rows with the redraw (owner, Oct 31)
- With a name typed in Invite's "Find testers", the found rows came ~0.4 s after the page's redraw and the pill (InvitePanel asked the search again behind its
  300 ms typing pause). On a redraw (liveSync §37) the search is asked again at once, without the pause, and the rows shown stay until the answer replaces them
  (no "Searching…"); typing keeps its pause.

## §47 The needs pop-up follows the Invite rows' one-or-none rule (owner, Oct 31)
- Per kind (devices, languages) the tester is missing a kind only when they list NONE of the test's needed items of that kind; listing at least one covers it
  (the developer's Invite rows' rule: testerNeedsChangedLines, the "Doesn't list languages" badge).
- The pop-up opens on Join / Apply / Ask to rejoin only when a kind is missing; it names only the missing kinds (with the items that would cover each, batch 20
  section 3's words: "doesn't list a language this test needs (Spanish or French)"). While open it stops or updates (the label, §44; the developer's needs
  lines on the next press) only when a kind flips between covered and missing, whether from the tester's own profile or the developer's needs, never for a
  second item added or dropped within a kind. A missing kind's item list follows the needs silently (no label, no stop).
- The server agrees (`gapsUnseen`, `sameGaps` in src/lib/gaps.ts): Join / Apply / Ask to rejoin anyway stops again only for a kind missing now that the pop-up
  showed as covered.

## §48 Withdraw says why there's nothing to withdraw (owner, Oct 31)
- Withdraw on an application that is no longer pending names why, with the time: accepted: "<Dev> accepted your application at 3:20 AM, so you're in this
  test."; declined: "<Dev> declined your application at 3:20 AM."; withdrawn in another tab: "You withdrew it in another tab at 3:20 AM."; closed by a listing
  change: "It closed when <Dev> changed the listing at 3:20 AM. You can apply again."; never applied (or closed another way): "There's no pending application
  to withdraw." as before. Withdraw's listing-change stop once and the join page's live lines (batch 30 §8) are unchanged.

Tests: tests/batch35-admin-tabs.test.ts.

## §49 Each admin action keeps its own reason (owner, Oct 31)
- The admin test Timeline quoted the test's one `adminNote` on a "paused" line whenever the pause was within 5 s of it, so a Stop right after a Pause made the
  pause line quote the stop's reason. Now every team Pause and Stop keeps its reason with its own event (an ActionLog row, "test" `admin-note`, keyed by the
  event's id; "" when none was given; no migration), and the Timeline quotes that event's own reason. A Pause without a reason never borrows a later Stop's.
- Older events without a stored reason keep today's behaviour (the test's note: a pause within 5 s of the test's pause time, a stop when the test was stopped).

## §50 The device icon in the needs pop-up (owner, Oct 31)
- "A device this test runs on" (GapDialog, devices only) shows the device icon (lucide Monitor, as on the join page's device badge) instead of the language
  icon. "A language this test needs" and "What this test needs" (both kinds) keep the language icon.

## §51 Admins' "same page" is the same page load (owner, Oct 31)
- §45's "a change from this same page never stops its own presses" now means the same PAGE LOAD, not the same browser tab: every browser press sends x-load
  (the tab's id plus a new part for each page drawn in it; src/app/admin/PageLoad.tsx starts a new one whenever an admin page is drawn, Back included), and
  the press markers (ActionLog "admin-tab") and the "own" check key on it. A change made in the same tab before a reload or from another page counts as "in
  another tab" when the pressing page didn't show it: "You suspended the developer side in another tab at 3:20 AM." A press without x-load (an older page)
  falls back to its x-tab; without either (an API call) only other admins count, as before.
- The cases: (a) suspended in window A, window B (loaded before) presses Delete account without redrawing: stops once with "You suspended the developer side in
  another tab at …", the second press goes ahead; (b) window B redrew after the suspension (its page time is later): Delete goes straight through; (c) same
  tab, suspend, reload, Delete: goes through (the reloaded page's time is after the change); (d) a press from the page that made the change never stops itself.
- Note: the tab id (`TAB` in src/lib/client.ts) is made when the page's script loads, so a full reload already gave a new one; it lived on across in-app
  navigation (and Back) inside the tab. The owner's Delete stop was case (a): the page's time was before the suspension (it hadn't redrawn), which is correct.


## §52 One pick-list chip (owner, Oct 31)
- On Post / Edit, Language requirements and Technology requirements (the shared Choices list) were squarer (rounded-lg) with only a green outline when ticked,
  unlike Categories' round pills. Every pick list now uses one chip style, `PICK_CHIP` in src/components/Choices.tsx (Categories' pill: rounded-full, green
  outline and fill when ticked): Categories, Language and Technology requirements, the profile's devices and languages (Choices), Find's state ticks and the
  Invite panel's filter ticks. No other behaviour change.

Tests: tests/batch35-reasons-page-load.test.ts.

## §53 One listing line also covers the terms (owner, Oct 31)

- No "<Dev> changed the terms: questions changed, NDA changed" line anywhere: one save is the one listing line ("<Dev> edited the listing · See it", §34) plus its
  consequences as their own lines ("… your application was closed", "<Dev> changed the NDA: read and accept it again below").
- Root cause: the join page's rejoin reasons (a tester who left, src/lib/server/joining.ts) added a `terms_plain` line with the field list on top of the listing
  line. It is gone: a tester who isn't working has no offer to answer.
- A working tester's session page: the offer is a consequence, field-free: "<Dev> offered you the new terms: Switch or Keep below" (testerGate; was "offered new
  terms: <fields>"). The offer box itself and the Contract changes history still describe the offer.

## §54 Open until's dates agree (owner, Oct 31)

- Root cause: Open until was stored at UTC's end of the chosen day and read back by its UTC date (toForm's `slice(0, 10)`, checkListing, openUntilShortened), while
  the 30-day maximum was counted in the developer's zone; and a pause lift moves Open until by the pause's length (the owner's test: Nov 29 23:59:59 UTC + 7h16m =
  Nov 30), past the maximum, while the hint still said "up to Nov 29".
- Now one day for one stored instant, in the developer's zone (unknown: UTC): a chosen day is stored as the end of that day there (`endOfDayIn`), and the Edit box,
  the server's checks, the red line, the tester days and the maximum all read `openUntilDay(instant, zone)`.
- The hint never names a maximum earlier than the saved date: at or past it, "it can't move later: it's Nov 30 now (30 days after the test opened, plus pauses)".

## §55 No live list by the join button (owner, Oct 31; replaces batch 30 §11)

- The join page's "Changed since you opened this page" list above Join / Apply / Ask to rejoin no longer follows the page live. Live changes show only in the top
  "Updated" box (with its pill), as on the developer's test page and the tester's session page. By the button, changes show only after a press, as the stop box
  ("Your Join didn't go through. …"), like Edit's box above Save. "You now meet this test's needs" stays its own notice. The seen rule stays batch 32 §12.

## §56 The needs pop-up's button names the press (owner, Oct 31)

- "Ask to rejoin anyway" / "Apply anyway" / "Join anyway" (was "Join anyway" in the Ask to rejoin flow), and "Press Ask to rejoin to ask to rejoin." when covered.

## §57 Red mistakes clear with the fix (owner, Oct 31)

- The list under a button (MistakeList) follows the page's own red marks too (data-red-msg / aria-invalid set by the page, e.g. the NDA tick's "Accept the NDA to
  join."): ticking it removes the bullet at once. A server line that belongs to no field goes as soon as anything in that form changes (or with the next press).

Tests (§53-§58): tests/batch35-terms-dates.test.ts, tests/rejoin.test.ts, tests/batch30c-stops.test.ts.

## §58 Draft buttons wait for the main press (owner, Oct 31)

- While a form's main press is going or has finished (the §41 finished state, until the redraw lands), its draft buttons are disabled too: "Start empty", "Use
  saved", "Use saved for all", "Discard", "Discard all" (one `DraftButton` in src/lib/useKept.tsx, used by DraftTag and the top lines). A pressed draft button is
  disabled until what it does has applied (no double press).

## §63 The Alerts menu lists every kind (owner, Oct 31)
On a paused or stopped test the developer's Alerts menu used to list only the kinds that can still happen there, while "(N off)" still counted the hidden ticks.
Now every kind is listed; one that can't happen in the test's state is greyed and can't be changed there (its tick is kept). No extra text.

## §64 Untouched Edit fields change silently again (owner, Oct 31; undoes §26)
On an open Edit page, a field this tab hadn't touched takes another tab's saved value silently, with no "Changed in another tab at …: was …" note. A field this tab
had changed keeps its text with the blue note and "Use theirs", as before. Spots and Open until keep their own notes.

## §59 Leave stops once, like the other tester presses (owner, Oct 31; replaces batch 15 §25 for Leave only)
- Leave (the session page's confirm pop-up) now goes through the tester's one gate (`testerGate`, the one Send, Charge / Let it go, Dispute, call requests
  and Cancel call use). The first press stops once for changes the page hasn't shown, with the tester's Alerts setting respected (Alerts Off: only changes to
  their own contract stop: new terms, their key marked as working; a payment doesn't). The stop box shows under the Leave button ("Your press didn't go
  through."); new terms take the page up to the Switch / Keep offer box, as for every other tester press. The second (confirmed) press leaves.
- A refusal (leaving can't happen: already left, removed, the test ended) is checked first and is unchanged. Block still never stops.
- (Owner's clarification) Leave follows the other tester presses' Alerts rule exactly, through the same gate and the same filter: with Alerts Off, an
  ignorable kind (pay, calls, delayed pay, the dispute, listing changes) doesn't stop it; the exceptions that still stop are the ones that stop every tester
  press: changes to the contract itself (new terms, their key marked as working) and, from §61, what they did themselves in another tab.

Tests: tests/batch35-leave-stops.test.ts (batch 15 §25's assertions updated in tests/batch15-stops.test.ts and tests/batch16-tester-states.test.ts).

## §60 A refusal line goes when the page has moved on (owner, Oct 31)
- The redraw in place (§40, §37's live redraw, AutoRefresh) keeps every box's state, so a refusal under a button stayed after its situation changed (e.g.
  "Answer the new terms first: Switch or Keep." under Send the dispute after the tester left or the test ended). Now a refusal or stop line under a button
  (Err's blue refusals, ChangesBox's stop box or refusal, usePress's error / changes through it, FormMistakes' lines no field shows) goes once the page
  redraws with a NEW version of itself (src/lib/pageVersion.ts): each AutoRefresh publishes the version (`v`) the page was drawn with; when a line appears,
  its baseline is the page's version on the server at that moment (the same poll), so the redraw that brings the line's own change keeps it, and a later
  version clears it. A redraw that brings nothing new keeps it; a box that goes away takes its line with it. The same press refused again shows its line again
  (api() announces every refusal). Red form mistakes stay until the field is fixed. Pages without a fingerprint (Edit) keep their lines as before.
- Applies on every page with AutoRefresh: the session page, the developer's test page, the join page (its invite poll), the dashboard and the admin boxes.

## §61 What you did in another tab always stops once (owner, Oct 31; replaces batch 29 §13's Alerts rule)
- The tester's own actions in another tab ("You sent your written answers in another tab", a Charge, a call request, Apply…) stop a press once even with
  Alerts Off, like the developer's (batch 29 §12): `ALERTS_OFF_KINDS` (src/lib/server/testerGate.ts) = the contract changes plus "own", used by the tester
  gate, the join page's stop (it no longer drops them with Alerts Off) and the live box (never greyed as ignored).
- The Alerts lines: On "Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, and what you did in another
  tab." Off "Stops a press only for: new terms, your key marked as working, and what you did in another tab." The stop box's hint: "New terms from the
  developer, a key marked as working and what you did in another tab still stop." The developer's Alerts menu has no other-tab type (unchanged).

## §62 See it stays at the Listing panel (owner's bug, Oct 31)
- See it scrolled up to the Listing panel and then jumped back down: when the panel was behind, See it redraws the page (§3), the stop box the line was in
  picks up the redraw's lines and brought itself back into view (bringInView). Now a See it press holds bringInView while its jump and redraw are under way
  (until the marked fields are in view, then 1.5 s for the smooth scroll; at most 12 s) and drops any kept place still waiting to be put back (keepPlace).
  The page stays at the panel with the marked fields in view, on the developer's test page and the join page.

Tests: tests/batch35-leave-stops.test.ts (§59–§62), tests/batch29-gates.test.ts (Alerts Off now stops for another tab).

## §65 Only this tab's own edits write the shared draft (owner's repro, Oct 31)
- Tab B (Edit) typed every field; the owner looked at old tab A (Edit, untouched) and then opened a new Edit page C: C showed the saved values, B's draft was
  gone. useKept's save ran on ANY change of the form's value: tab A's redraw on becoming visible changed its value, and A (opened from an earlier draft, untouched,
  so "pristine" with a copy saved) sent null 700 ms later, deleting B's draft (or sent its own older value).
- Now a form writes or forgets the shared draft only because of this tab's own edits: a value change within a moment (800 ms) of a real keystroke, click,
  paste or drop in this tab (typing, ticks, chips, Use saved / Discard). A change from a redraw, the server or another tab's save never writes; a
  restored-but-untouched form never deletes or overwrites the draft. Typing still waiting to be saved is saved even if a redraw lands meanwhile. §16 is
  unchanged and consistent: only what this tab typed since its last save is flushed on leaving or hiding.

Tests: tests/batch35-leave-stops.test.ts (§65).

## §66 The 3-change count starts at the first join (owner, Oct 31; replaces batch 14 §2's start)
- The 3-change count on Edit's limited fields starts only when the first tester joins (a working contract: Join, an Accept or an auto-join that joins), not at
  the first invite or application. Saves before that never count. `stampCounting` is called on a join only (joinTest); invites.ts and joining.ts's Apply no
  longer stamp it. `startedCounting` / `countingState` (src/lib/server/tests.ts) fall back to the first contract only.
- Older tests whose stored "since" came from an invite or an application (earlier than the first join, or with nobody joined) are recomputed when read: the
  count starts at the first join with the counts back at 0 (the saves counted before it can't be told apart, so none of them count); with nobody joined,
  counting hasn't started. Edit's page and its live view read the same state.

Tests: tests/batch35-leave-stops.test.ts (§66), tests/batch14.test.ts (section 2 rewritten).

## §67 Every own other-tab action stops every press once (owner, Oct 31; replaces batch 29 §12's touches rule)
- Developer: ANY action of theirs done in another tab since the page's seen time stops ANY developer press once, on the test page and on Edit, both ways
  (Edit ↔ test page ↔ Edit). Before, only BIG_OWN_ACTS (Pay, Stop, a listing Save, …) stopped every press; the others (a rating, a no-show, the dispute side)
  stopped only a press they touched. devChanges (src/lib/server/live.ts) now keeps every own line for any press; `touches` is no longer used there.
  The live box still lists LIVE_OWN_ACTS only. The wording ("You … in another tab"), the seen rule and Alerts (own lines are never ignorable, §61) are unchanged.
- Tester: already so: ownChanges returns every own action from another tab, on the session page and the join page, and "own" stops even with Alerts Off (§61).

## §68 A Dispute always stops once for a new payment on that piece (owner, Oct 31)
- A payment on the disputed piece since the page loaded (Pay, Pay more, a dispute decision, a Charge, a delayed payment going through) stops the tester's
  Dispute once even with Alerts Off: it changes what's disputed. The tester's payment lines carry the piece (`piece` on the event); testerGate's `piece` option
  (openDispute passes it) keeps those lines when Alerts is Off, like new terms. Payments on other pieces still follow Alerts.

## §69 No "Listing changes" in the developer's Alerts (owner, Oct 31)
- ALERT_TYPES (src/lib/alerts.ts) drops `listing`, so the developer's Alerts menu (AlertsMenu) no longer lists it: their own saves always stop and nobody else edits
  their listing. Listing lines (info, renamed, edited) have no Alerts type for the developer (`alertOf` → null), so a stored "listing" tick is ignored (it no
  longer greys or skips anything, and doesn't count in "(N off)"). Testers keep listing changes in their own Alerts (On/Off), unchanged.

Tests: tests/batch35-all-tabs.test.ts (§67-§69), tests/batch20.test.ts (the always-stop kinds audit now includes "info").

## §70 Decide waits for the developer's bank (owner, Oct 31)
While a payment on the disputed piece is waiting for the developer's bank (their own Pay / Pay more check, up to 15 minutes, or a payment waiting for Confirm),
the admin's Decide is refused: "The developer is confirming a payment for this piece with their bank. Decide again once it's confirmed or fails." Nothing is
charged and the dispute stays open, so the piece is never paid more than decided.

## §71 The Alerts menu: no "Saved.", and an "All" tick (owner, Oct 31)
The developer's Alerts menu no longer shows "Saved." after a tick (the tick itself shows it; "Couldn't save. Try again." still shows on a failure). An "All" tick at
the top ticks or unticks every type that can happen on this test at once; greyed types keep their ticks.

## §72 Reinstatement doesn't move the developer; "active again" shows once (owner, Oct 31)
- Stop / End early pressed on a test page drawn while the developer side was suspended or on a hold sent them to the dashboard ("Done: …", batch 15 §29). Now that
  only happens if the account is still restricted at that moment; reinstated meanwhile, the press goes through and the test page just redraws in place.

## §73 The developer's Alerts belong to each test (owner, Oct 31)
The developer's Alerts ticks are saved on the test, not the account: ticking a type on one test never changes another test. A new test and a Next round start
with every alert on (nothing is carried over). The Alerts menu (test page and Edit) and a stop box's "Don't stop me for" chips save on the page's test, and only
that test's developer can change them. The stop gate, the live box's greyed lines and the page's poll all read the test's own list; the page's shared state is
kept per test. The migration (`20261110090000_test_ignored_alerts`) adds `Test.ignoredAlerts` and fills each existing test with its developer's account list at
that moment, so nothing changes for tests already running; `User.ignoredAlerts` stays (unused). The tester's one-press Alerts is unchanged (per tester).

## §74 The developer's own call-request actions are theirs (owner bug, Oct 31)
The developer withdrew their own call request on the test page, then pressed Pay more on the same page: it stopped with "dev withdrawn a call request for …" and
offered the "Call changes" chip. Now the developer's own withdraw, decline and cancel of a set are recorded in their own voice ("You withdrew a call request for
Sat, Nov 7, 3:35 PM", like their request, booking and call cancel already were), so the same page never stops for them; another tab stops once with the action
log's "You withdrew a call request for Sat, Nov 7, 3:35 PM in another tab" (never in Alerts). The tester's own lines stay third person, with "withdrew"
("fbbb withdrew a call request for …"; "withdrawn" was a typo).

## §75 The top panel's presses each have their own box (owner bug, Oct 31)
Next round, End early and Stop the test share one press state on the test page; a stop under Next round lingered after Stop the test, and End early's box was
named "Your Stop the test didn't go through". Now each top press is its own: its box shows only under its own button and is named after it ("Your End early didn't
go through." under End their work now), another press's box never counts as this press's first stop, and opening another top button (Next round, End early,
Stop the test) clears the earlier box: one box at a time.

- The dashboard's "Your developer account is active again · <time>" keeps showing for 3 days, as before (owner, Oct 31).

## §76 One line per payment, its latest state (owner bug, Oct 31)
A tester's stop box listed "dev's payment for your written answers ($10) is delayed. You'll be told when it arrives. · 3:58 PM" and "dev paid $10.00 for your
written answers · 4:06 PM": the same payment twice. Now a payment shows one line, its latest state: once it went through, the paid line replaces its delayed line
(a failed then paid one shows paid), in the stop boxes and the top Updated box (both lines carry the payment's key, so the live box's paid line replaces the delayed
one it already lists). The developer's lines already showed one per payment ("Payment failed on …" or "Payment went through on …"); they carry the key too.

## §77 A part re-sent with no change isn't "updated" (owner bug, Oct 31)
The owner saw "fbbb sent their recording · 4:19 PM" and "fbbb updated their recording · 4:19 PM" for one recording. A re-send was already refused when nothing was
added or removed; now it is compared by content: the recordings (or the written part's files) by name and size, and the answers with their file markers read by
file name, so a recording or file removed and the same file uploaded again is no change. A re-send with nothing new records no line, sends no email and is refused
with "Nothing has changed since you sent it." (the existing line by Send).

## §78 Your own hold lifting doesn't stop your presses (owner, Oct 31)
An owed payment going through is the developer's own (Pay what you owe, a retry on the saved card, a new card), and it lifts their hold. Like a reinstatement (§72),
its "Payment went through on …" line shows in the test page's top box (and on Payments) but never stops the developer's press. Other payments (a tester's Charge, a
dispute decision, a failed payment) stop as before.

## §79 A press never stops for the change it answers (owner, Oct 31)
The developer pressed Accept on a call request that had just arrived and it stopped with "fbbb requested daily calls (4 days) from …": the one line was the very
request being answered. Now every stop gate drops the change lines about the item the press acts on (one shared helper, `answersIt` in `live.ts`, used by the
developer's gate, the tester's gate and the join gate): matched on the line's item id where it carries one, else on the event's kind and the contract (an
application, which has no contract yet, by its exact line). Other unseen changes still stop as before.
- Developer: Accept / Decline a call request (the tester's "requested …" on that contract); Accept / Decline an application or rejoin ask ("<name> applied to join",
  "<name> asks to rejoin"); Pay, Pay more and Confirm with your bank on written answers or a recording ("sent their …" / "updated their …" on that contract, for that piece: Pay on the written answers still stops for a recording just sent). Add your
  side never stops (batch 15 §27); there is no Reject any more (batch 15 §30).
- Tester: Accept / Decline the developer's call request (that request's line); Switch / Keep never stopped for the terms line (they answer the offer); Join from an
  invite just re-sent on a new listing ("here's a new invite on the updated listing", that invite's line).
- (Same day, small) The developer's call panel no longer repeats the tester's name: a tester's card drops its name heading when every row already starts with
  the name (booked calls, a booked set "fbbb · Daily · Sat 9:46 PM (4 left) · 39 min · …", their requests); it stays when a row reads "You requested …" or there are none.

## §80 Confirm with your bank sits in Needs you (owner, Oct 31)
- On the test page every payment the bank wants confirmed is in **Needs you** (counted there), so the dashboard's "Your bank wants you to confirm" box,
  Payments and the bell all land in Needs you. Under the piece (and under the tester's row for a charge with no part) there's only a small link up to it:
  "Confirm with your bank in Needs you ↑". A paused or held test's page keeps its own "Your bank wants you to confirm" box as before.

## §81 The tester's History lists the tests they're in, with a search (owner, Oct 31)
- A tester's dashboard showed a test only while something waited there, so a test with nothing left to do (e.g. its only call over and paid) had no way back.
  History now starts with every test they're in ("In progress", "by <developer> · joined <date>", Open → the test page), then the ended ones as before, and a
  search box over it filters by test name or developer ("No test matches." when nothing does).

## §82 "Payment may be delayed" says "until the test resumes" only while the test is paused (owner, Oct 31)
- A dispute decision waiting for the developer's bank on a running test read "Payment may be delayed until the test resumes." Now it reads "Payment may be
  delayed." (page and email); the longer line stays when the test is paused (a hold, including one this decision's decline started, a suspension or the team's pause).

## §83 A stopped test has nothing left to Accept (owner, Oct 31)
- The developer's own Stop now closes waiting applications and rejoin asks, like the team's Stop and a paused test closing already did (the applicant reads
  the usual "the test was stopped" line). Ones left over from before are hidden from the dashboard's Needs you and the test page, so there's no Accept that
  can only be refused ("Your Accept didn't go through: this test was stopped").
- (Same day, owner) Also a **"Current tests (N)"** box just above "Tests you left": the tests the tester is still in, newest join first, each opening the test
  page, with its own search box. History keeps every test (the ones you're still in first, then the ended ones).

## §84 Send work for every open test in To do; no Current tests box (owner, Oct 31)
- The "Current tests" box is gone (History still lists every test, the ones you're in first, with its search box).
- To do has Send work for every open test you're in: the parts not sent yet as before, and a test with every part sent gets one row of its own
  ("<title> · Every part sent", Send work → its parts), so a test with nothing waiting is still on the dashboard.

## §85 A kept refusal never follows you to another page (owner, Oct 31)
- The blue "Your <press> didn't go through: …" line kept after a refused press (batch 29 §36, batch 32 §10) belongs to the page it was pressed on: going to
  another page drops it. On the same page it still stays until your next press (in the button's section, or at the top when none is left).

## §87 "You stopped this test." (owner, Oct 31)
- The developer's own stopped test reads "You stopped this test." at the top of its red banner (was "This test is stopped."); the team's Stop still reads
  "The team stopped this test.". (§86 is kept for Codex task 11.)

## §88 "has paid" counts only money that went through (owner, Oct 31)
- The tester's line under a paid part ("<Dev> has paid $X for this. It can be paid more, up to $Y in all.") left out nothing: a dispute decision's $10.00 still
  waiting for the developer's bank read as paid ($50.00 next to "Paid so far $40.00" and "Payment may be delayed."). Now a payment waiting for the bank or owed
  during a hold isn't in "has paid" ($40.00); the "up to … in all" figure is unchanged.

## §89 Pay doesn't stop for the tester joining (owner, Oct 31)
- A tester joined and sent written answers seconds later while the developer's page was open; Pay on those answers skipped the "sent" line (§79) but still
  stopped for "fbbb joined · 9:05 PM". Pay, Pay more and Confirm with your bank on a tester's piece now also skip that tester's own "joined" line (paying their
  work, you know they're in). Other testers' joins still stop as before (Alerts: Joins and applications).

## §90 An update the page has shown counts as seen (owner, Oct 31)
- Replaces batch 32 §12 and batch 16 §38B: an update the page has shown (the 20-second redraw, the blue "new update" pill, or the top box) counts as seen at once,
  call changes too, so no stop notice for it afterwards. A change that happens between two checks (or on another device) still stops a press once, as before.
- Terms of Use, section 8: "Pages update on their own about every 20 seconds. When a blue "new update" pill appears, check the update (tap the pill) before you
  press anything: once the page has shown an update, a press counts as made with it in view." (Terms are still a draft before launch: no version bump.)

## §91 Your agreed scope in a scroll box; Terms history folded (owner, Oct 31)
- The tester's "Your agreed scope" fold shows its contents (the contract, the listing information, the terms history) in one scroll box about 32rem tall.
- "Terms history" is its own fold, shut by default (the Updated tags on the listing lines already show what changed; the history keeps the full record:
  what you joined on, each offer and what you chose, the questions and NDA then and now, stop reasons).

## §92 Confirm with your bank: the card was declined (owner, Oct 31)
- Confirm with your bank on a charge made while away re-tries it with the card on file now. When that card is declined the line reads "Your card was declined,
  so nothing was charged. Change your card and confirm again by <date, time>." (was "Your bank didn't confirm the payment…"); the payment keeps waiting until then.

## §93 The Charge line names the date (owner, Oct 31)
- "<Dev> didn't review your written answers in 7 days: charge $X or let it go" now reads "… didn't review your written answers by <date>: …": the review time
  ends at the later of 7 days after sending and the tester's own deadline, so "in 7 days" was wrong when the deadline came later.

## §94 A tester who rated a test can't be invited to it (owner, Oct 31)
- Rating finishes a tester's part for good (they can't join that test again), but the developer could still tick and invite them. Now their row in Invite testers is
  greyed "Rated this test: can't join it again" (with "Finished (rated this test)" instead of "Left this test"), and an old page's Invite with them ticked is
  refused: "<name> rated this test, so they can't join it again. Untick them to invite the others."

## §96 One Needs you on the developer dashboard (owner, Oct 31)
- The "Needs review" box is gone: its rows ("<test> · N parts to pay · closes …", Review → the test's Needs you) are the first rows of Needs you, in its one
  scroll box, and counted in its number. Ratings to give already scrolls in its own box.

## §98 History rows for ended tests: a tag and Open (owner, Oct 31)
- The tester's History no longer folds open with each ended test's deal history. Each ended test is one row like an "In progress" one: "<title>", "by <dev> ·
  ended <date>" ("left <date>"), a tag for how it ended (Finished, Stopped, Closed, Removed, Ended early, You left, Ended) and Open → its page (where the parts,
  payments and Terms history still are). While the tester side is suspended the rows don't open (as before).

## §99 "Your account is active again" goes once it isn't (owner, Oct 31)
- The green "Your developer account is active again · <time>" line on the dashboard is hidden while that side is suspended again, and (developer) while on a
  payment or chargeback hold. It still shows for 3 days after a reinstatement otherwise.

## §100 The top strip after paying what you owe (owner, Oct 31)
- A payment hold that needs the team's review (more than HOLD_APPROVAL_AFTER holds) stays on after everything owed is paid. The strip at the top of the
  developer's pages said "Your tests are paused until you pay what you owe. Pay what you owe." next to Payments' "You've paid what you owe. The team will
  review your account…". Now the strip is gone in that state (owner: Payments already says the team will review).
