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

## §101 No Payment holds panel in the admin console (owner, Oct 31)
- The console's "Payment holds (N)" list is gone. A held developer shows on their profile (opened from anywhere their name is a link); a hold from the 4th
  onward still waits in Lifts for an Approve; chargeback holds stay in Chargeback holds. The admins' summary line about a payment hold now opens the
  developer's profile (a chargeback hold: Chargeback holds).

## §102 Needs you and Ratings to give are one box each (owner, Oct 31)
- On the developer dashboard, Needs you is ONE box (a card) whose rows (the parts-to-pay rows first, then the rest) are plain bordered lines inside its scroll box,
  not a card each. Ratings to give (both sides) is the same: one box, plain rows, scrolling. The tester's New tests for you and History keep their cards.

## §103 The call request form only with someone to request (owner, Nov 1)
- With nobody working on the test, the developer's Live session shows only "Nobody is working on this test right now…" (no times, length or Request a time).
- A tick for a tester whose session ended while the page was open is dropped from the request (it used to send it: "Your Request a time didn't go
  through: fbbb's session has ended.").
## §97 Payment tags on the tester's parts (owner, Oct 31)
- Written answers, screen recordings and each completed live call show their payment state in the existing small badge style: Paid, Payment delayed,
  Waiting for review, Not paid (closed on <date>) or Rejected. Let go and the team's closure keep their own state; a deleted developer's unpaid work keeps
  "Can't be paid". The same review, close-out and outstanding-payment facts drive the tags.
- A payment waiting for the developer's bank, owed or deferred is Payment delayed, including a dispute raise above an already paid base. Money still waiting
  is never added to "has paid" or Paid so far (§88). The blue payment-state paragraphs inside the parts are gone: their tag says it once. Payment amounts,
  reasons, notes, dispute decisions and what can still be paid more stay in their existing plain text.
- Charge / Let it go keep their own blue refusals through Err / useGoneOnNewVersion (§60) and the page-scoped, in-memory kept refusal (§85): a redraw may
  keep the reason where its button was, but a fresh page load or navigation never restores an old refusal. The developer's pages are unchanged.

Tests: tests/batch35-payment-tags.test.ts (§97), with the older page-wiring expectations updated to the tags.
## §95 A refusal line never flashes (owner, Oct 31)
- Charge after its window closed could flash its blue refusal every 200 ms. The kept notice excluded its own element from "shown elsewhere", but its parent
  part (<li>) still contained that notice's words. It hid itself, then the words vanished, so it showed again. The check now reads only text OUTSIDE every kept
  notice / host subtree, including when reading an ancestor. Another real refusal line still hides the kept copy: one steady reason, never two.
- An empty portal host is hidden until its line mounts, and a blank reason is never shown, so no empty bullet. Mistake lists continue to drop blank lines.
- Placement and lifetime stay the same: under the button while it remains; after the redraw removes it, in its nearest surviving section, or at the top if no
  section remains. It stays until the next press, never follows another page (§85), and is not stored across a page reload. Applies to Charge, Let it go, Pay
  and the other refused presses through the same kept-refusal path.

Tests: tests/batch35-refusal-flash.test.ts (§95); tests/batch29-refuse.test.ts (the duplicate-line check excludes kept descendants too).

## §108 Edit never blocks on an unchanged Open until (owner, Nov 1)
- On Edit, the Open until date box's minimum is the saved date when that's earlier than tomorrow, so a test whose Open until is under a day away (or past) can
  still save other fields; the server already checks the date only when it changes. Moving it still needs a date from tomorrow on.
## §86 A change you've answered never stops a later press (owner, Oct 31)
Once a person answers a change, its lines never stop a later press, on that page or in another tab or device. Every gate drops lines about an item they answered
AFTER the change happened, using the same `answersIt` matching as §79 and the person's ActionLog (the answer's item id is kept in its existing metadata; no new
table). An update made after the answer is new and still stops once, as does any unrelated unanswered change. Their own action in another tab stays its own line (§67).
- Answers: Accept / Decline a call request, application or rejoin ask; Pay / Pay more / Confirm with your bank on a piece (its sent / updated lines); Switch / Keep
  on the terms offer; Join from an invite; the developer's side of a dispute; the admin's Decide. Decide answers that dispute's own lines, including a side just added.
- Applies to the developer's gates (test page and Edit), the tester's gate, Join, both Rate gates and the admin's stops. The live top box and the existing seen / second-press
  machinery keep their rules. Exact ids distinguish requests, applications and pieces; older event lines keep §79's kind / contract / piece-name or exact-text fallback.

Tests: tests/batch35-answered-seen.test.ts (§86); tests/batch15-paused.test.ts (Decide's own dispute line now answered).
## §93 The tester's Rate stops for every blue notice (owner, Oct 31)
- The tester's Rate uses the shared tester gate: every unseen change that stops another tester press also stops Rate once, with the same Alerts rules.
  New terms and a key marked working still stop with Alerts Off; their own action in another tab always stops. On a running test, Rate finishes their part,
  closes requests and cancels calls ahead, so an unseen terms offer or listing edit must be shown before it goes through.
- A stop, closure, early end or pause joins every other change in ONE blue box, oldest first. The second press uses the same boxAt rule; a newer change stops
  it again. An update the page already showed never stops (§90), including terms, calls and stop/pause lines. RateBox already uses usePress and api(), which
  send seenAt, boxAt, loadedAt and the page load (x-load); no separate client markers are needed.
- The developer's Rate keeps its existing narrow list. Rating's availability and its close-out refusal ("Rating closed on <date>.") are unchanged.

Tests: tests/batch35-rate-all-stops.test.ts (§93); tests/batch17-rate.test.ts, tests/batch5.test.ts and tests/ratings.test.ts (the older listing-edit expectations now follow §93).


## §107 A Pay waiting for the bank isn't paid yet (owner, Nov 1)

A developer's Pay on written answers, a recording or a call can wait up to 15 minutes for their bank. While it waits, the tester's part stays **Waiting for review**: no Paid tag, received amount, Dispute or paid bell/email. Rate, close-out and both dashboards still count the piece as unreviewed. The developer's piece in Needs you shows **Confirming with your bank**, with the same inline bank check. Charge and Let it go are refused while that payment locks the piece.

The reservation is now a `Payment.reviewDraft`, not a completed Review. This changes the single source of truth instead of teaching every Review reader a second meaning of “reviewed”. The draft preserves the amount, agreed price, note, call rate and press key. Successful payment or bank confirmation records the Review and payment together, then sends the existing paid notices. A card decline still records the owed review and follows the existing payment-hold rules. A lost Stripe answer keeps the Payment reservation for recovery, without displaying a completed review; recovery records it only after finding a successful charge.

A refused, closed or expired bank check cancels the reservation, leaving no Review to undo and making Pay available again. Page loads and a later Pay release expired checks without waiting for the daily sweep; the existing page fingerprint watches each bank deadline crossing on the normal beat. A check already started can finish even if the ordinary Pay window closes meanwhile. Pending payments also lock the piece while Stripe's answer is in flight, and a second Pay cannot reserve it again. Older reservations with an existing Review remain supported when released or recovered. Away payments (`needs_confirmation`, including Charge and dispute decisions) keep their Payment delayed state and existing confirmation rules.

Tests: `tests/batch35-pending-pay-state.test.ts` exercises written work and calls through successful confirmation, failure, cancellation and timeout, the tester's rendered payment tags and absent Dispute, the developer's inline confirming row, paid amounts and bell, Rate, and Charge / Let it go / duplicate Pay locks. The recovery test now checks the Payment draft reservation rather than an unfinished Review. The additive migration adds only the draft column.


## §109 Invite rows update on the beat (owner, Nov 1)

Invite testers follows the eligibility of the people the panel actually shows, plus selected people kept from a previous search. On the page's existing twenty-second beat, a cheap version checks whether each person is a tester, blocked in either direction, suspended, at the ten-test limit, already invited, already in this test or finished/rated here. Counts below ten do not cause a redraw. Changes to people outside the watched rows do not change this version. The first check compares with the version rendered in each row, not with a newly adopted first-poll baseline.

A changed version redraws the panel in place and repeats its current name search. Search text, device/language filters and available selections stay. A selected person who became unavailable is removed from the selection; their row uses its existing grey reason, or disappears under the existing block/deletion rule. Row details also follow profile/name changes, the developer's own ratings and their other shared tests. Both invite availability and Invite anyway now use the shared beat, replacing their separate eight- and fifteen-second timers.

The follow-up audit in Task 15's `docs/BLUE-NOTICES.md` (commits `abbac5b2` and `40bb7bf6`) identified these other missing dependencies; all now use fingerprints on the same beat:

- Find tests and the tester dashboard's recommendations: new, changed, full, paused or closed tests, matching-profile changes and current search results. URL filters stay in place. This adds no Find testers page.
- Join / Apply / Ask to rejoin: the tester reaching or dropping below ten working tests elsewhere, profile changes, blocks and current listing availability.
- Call request clash notes: booked calls on the viewer's other tests, including cancellation and the displayed person's name. Typed request rows stay.
- Both dashboards: current work, review counts, terms offers, applications, invitations, requests, disputes (including calls), excerpts, payment state, keys and messages across their tests.
- Messages: the current side's conversation membership, last-message versions and read markers.
- Public developer/tester profile details: profile text, revealed ratings and displayed names, stats, excerpts, shared work, reports and block controls. The unavailable view watches too, so unblocking restores it. A blocked viewer receives one neutral opaque version, with no fingerprint of hidden changes.
- Payments history and totals: new payments and existing payments settling or changing status, their displayed people/test names and bank deadlines. Existing card/subscription/payout account changes still use AccountRefresh.
- Notifications: the current side's actual rows/read state, stack titles and email preference. Expanded stacks stay open. A changed email preference follows only while the settings form has no unsaved edit.
- Account → Blocked people: additions/removals and displayed names/deletion state.

Versions are computed before the page reads the state it displays, so a change between render and the first beat is not adopted silently. Deadline phases change versions at relevant clock boundaries without another timer. Only opaque versions leave the server for the general page fingerprints. AccountRefresh now rides the shared clock too. Existing intentionally protected forms (new/edit test, Settings and profile editor), account restrictions, bank checks, Ratings to give, Tests visited, admin pages and live call-room signaling retain their existing rules; this does not overwrite drafts or replace their authorization/refusal checks. No real missing-dependency item from the audit is left unfixed.

Tests: `tests/batch35-invite-rows-live.test.ts` covers capacity crossing in both directions, suspension/block/deletion, invited/in/rated states, unrelated changes, the first-poll baseline, row details, access checks, the shared clock, and each additional page fingerprint and clock boundary. Existing presses still use their existing stop-once and final-refusal rules.

## §111 Deadlines and Open until use the same day (owner, Nov 1)
- A joiner's deadline is the end of their joining day plus the listing's tester days, in the developer's saved time zone, like Open until. The day is counted as a calendar date first, then converted to its actual end in that zone; it is no longer returned as a UTC day end. Clock changes keep the deadline at the end of the correct local day. An unknown zone still uses UTC.
- Nov 1 to Nov 27 is 26 days in that zone. Stored tester days retain that allowance; older listings without stored days now use the developer's zone in the join page, developer Listing panel, Find badges and Most time to finish ordering. Find's join-by date uses that zone too.
- Join, accepted applications and invite joins share the corrected contract snapshot. Rejoining still restores exactly the time left on the original deadline. Switch keeps the deadline when Open until exists; legacy tests without Open until keep their existing elapsed-time rule. Edit moving Open until later by D days still adds D days to working deadlines and the tester allowance. Existing stored deadlines are not rewritten by this change.

Tests: `tests/batch35-deadline-zone.test.ts` (11 cases), with the earlier listing-helper wiring assertions updated.

## §112 Open until is locked once it has passed (owner, Nov 1)
- In Edit, once the saved Open until day is before today in the developer's saved zone, changing it is refused: **Open until has passed, so it can't be changed.** The date box is disabled in the app's greyed style and shows that same line as its hint. A date that is still today is not locked just because UTC has moved into tomorrow.
- An unchanged date still allows other fields to save (§108). Comparing calendar dates also leaves a pause-shifted timestamp intact instead of silently resetting its time to the end of that day. A genuinely changed date on a still-open joining window keeps the existing extension rules and deadline shift.
- The lock belongs to Edit; automatic pause and outage shifts keep working. No old deadlines are revived by reopening an expired joining window.

Tests: `tests/batch35-open-until-locked.test.ts`, with the older Open until refusal wording updated.

## §116 A kept refusal never outlives its situation or floats (owner, Nov 1)

- A kept refusal uses the same page-version signal as the line under its button (§60): its baseline is the server version at refusal time. Its own redraw keeps the explanation; the next shown version drops it. The next press and another page still drop it (§85).
- It stays in the nearest surviving section. If none remains, it goes first inside the page’s main content, scrolling with the page in the info style; it never floats over the header.
- The same-word check excludes the kept subtree (§95), so there is only one steady copy, with no empty bullet.


## Notice wording follow-up (owner, Nov 1)
- A tester's cancelled call says **Your call with <developer> on <date/time> was cancelled**, in the live top box and its shared stop-once lines. A system cancellation uses the same passive wording: it never falsely says the developer cancelled it. A repeated Cancel refusal names the developer and time too.
- An unavailable requested time says **The call time with <developer> on <date/time> is no longer available**, keeping the existing “another tester took it” explanation where known. A key update names the developer instead of “The developer”.
- A dispute decision identifies the written answers, recording or dated live call: **The team decided your dispute about your <part>: the pay was raised to $X** / **…the pay stays at $X**. The developer adding their side identifies that part too.
- New action-log entries for the tester's requests, accept/decline/withdraw, matched booking, cancellation and call-problem report name the other person. Existing stored entries are left intact.
- Pay's final already-paid/rejected/charged/let-go refusals identify the tester and part instead of “this”; live-call refusals include the call date/time. The existing gate order, Alerts choices, refusal lifetime and payment rules stay the same.

Tests: `tests/batch35-notice-context.test.ts`, with the existing exact-wording expectations updated.

## Current saved card in Payments (owner, Nov 1)
The Your card box identifies the account’s current saved card by brand, last four digits and expiry. It reads the saved payment method from Stripe without creating or charging anything; a missing card says No card yet. Link is identified as Link instead of inventing card digits. If details cannot be read, Payments still opens with the saved-card/known-expiry fallback and Change card. Full card numbers and security codes are never displayed or stored here. Existing card-change live updates remain in use. Tests: `tests/batch35-current-card.test.ts`.

## An accepted rejoin opens the session (owner, Nov 1)
When the join page’s existing watcher finds that an application or ask to rejoin was accepted, it opens the session automatically, just like Join. A focused field, a saved note or a stop box no longer strands the page on “You’re back in … Go to your session”. Accepted sessions also navigate when their fingerprint was already seen. The watcher stays on the shared page beat and focus check; a response arriving after leaving the page cannot navigate it. Waiting, declined and closed applications keep their existing redraw behavior. Tests: `tests/batch35-rejoin-refresh.test.ts`, plus the existing batch30 acceptance fixtures.

## Remove the page Refresh prompt (owner, Nov 1)

- Remove “This page has updates · Refresh”. The list’s new-update pills remain.
- Background refresh still works. A fallback reload waits quietly while someone is typing or has a confirmation or stop box open, then retries once it is safe.

## Listing folds and paid work stay readable (owner, Nov 1)

- Listing opens as a dropdown on both the developer’s test page and the tester’s join page. Its fields scroll inside it; the title and reviews remain outside the fold. See it still opens the listing at its matching field.
- Paid written answers and recordings stay visible in the tester panel, in the existing scroll box above Pay more, including sent parts no longer listed. The same question snapshots, notes and attachments remain readable.
- Sent parts no longer carry a “Sent late” badge. Work sent after its deadline still has the dated payment explanation and the same payment rules; removing a label does not open Charge for it.
- Clock reproduction: first send Nov 2; extend Open until from Nov 10 to Nov 15 on Nov 3; resend Nov 12. No Charge before Nov 19 at the resend time; the daily job opens Charge / Let it go after that time, without paying automatically.

## A paused session does not claim Open until ended the test (owner, Nov 1)

- While the team’s pause, a payment or chargeback hold, or the developer’s suspension is still pausing the test, a working tester does not see “This test closed on …” merely because the stored Open until passed. The pause explanation stays; an actual ended or left session still says so.
- The deadline explanation no longer promises a “late” badge after those badges were removed. Sending and payment eligibility keep their existing rules.

## §105 Message anyone from their profile (owner, Nov 1)

Developer and tester profiles have **Message** for another regular account, whether or not they share a test. The link opens a direct conversation between the two accounts. Opening it creates nothing: only the first successful Send creates the conversation. There is one conversation for the pair, shared across both sides of either account, as the owner requested. Existing test chats between the same people stay separate.

Messages lists direct conversations alongside test chats, with the other person's name and **Direct message**, newest activity first. The conversation reuses Chat, its 4,000-character limit, message press IDs and saved drafts. A direct draft is keyed by the other account, so it is the same draft from either side. The latest 300 messages are shown in chronological order. Direct reads and unread counts belong to the account too; opening the page advances its read marker only to the newest loaded message's timestamp, and an older tab cannot move it backwards.

A block either way removes Message from a freshly rendered profile. An old page's Send is refused with the existing neutral Unable to chat with this developer/tester line. Deleted accounts and self-messaging cannot start a conversation. Admin views keep their existing tools. Each sender's current-side restriction uses the existing refusals and dashboard routing. The other person's current-side restriction pauses sending with the same neutral message as test chat; history remains readable and the input follows the existing page beat when that restriction lifts. A restriction on an inactive side stays on that side. Tester-facing lines never explain a developer's restriction.

A sender can start at most 20 new conversations in a rolling 24 hours: **You've started 20 new conversations in the last 24 hours. Try again later.** Existing conversations and replies do not consume another start. A per-sender row lock serializes starts, and the canonical unique account pair handles simultaneous first messages. Test and direct messages share the existing 30-per-minute sending limit. Blank or overlong messages create no conversation. A retry of the same message ID returns the same message and sends no second bell.

The bell says **New message from <name>**, linking to the direct conversation, on both sides. It follows the existing account email settings and summaries. The message and bell commit together, using the known recipient account ID; an email address changing cannot turn that notification into a non-account email. Messages list and direct pages use AutoRefresh on the existing beat. The global Messages count uses SessionWatch's existing status check beside the bell; no new timer is added. Raw conversation/read timestamp writes explicitly use UTC, matching Prisma even when the database's local time zone differs.

The additive migration introduces DirectConversation, DirectMessage and DirectRead with foreign keys and indexes. No test ID belongs to a direct conversation. Tests in `tests/batch35-profile-messages.test.ts` cover people who never worked together, both profile types, blocks both ways, restrictions/deletion/self/admin rules, the daily limit and expiry, simultaneous first messages and lost-answer retries, mixed and same-side accounts, shared drafts/reads, separate test chats, combined rate/length limits, email Off, unread/bell/list updates, live fingerprints and UTC timestamps.


## §106 The same action boxes below the developer's name (owner, Nov 1)

Bank confirmations, disputes waiting for the developer's side, and excerpt requests each have their own box below the developer's name. These are the same three boxes whether the developer is active, suspended, on a payment hold or on a chargeback hold. Each uses the Needs you style: a plain card, amber dot, heading and count, plain bordered rows, and one ScrollList. Empty boxes disappear.

The bank rows remain soonest deadline first, with the last day in red, and keep the `bank=1` fingerprint. Confirm with your bank now opens the existing BankWaiting check inline in the dashboard row for both active and restricted developers. Disputes keep the existing optional DisputeSide form. Excerpts keep their question, quote, NDA note and inline Allow / Deny. Their presses keep their normal current-state refusals and stop-once rules; restricted actions retain their existing exceptions.

Dispute and excerpt actions appear once in their respective boxes, including in the active view. Other Needs you items remain in the normal Needs you box, with its count reflecting those remaining items. Ratings to give stays separate where allowed. The account's restriction explanation still describes how to resume; the three action boxes follow the name, where they can be used in either state.

Tests: `tests/batch35-restricted-needs-you.test.ts` renders the full developer dashboard for all four account states, checks the three separate boxes below the name and their counts/style/inline controls, exercises Confirm, Add your side and Allow, checks empty boxes disappear, and checks deadline ordering/red last-day text. Earlier bank-position and restricted-only source assertions now follow this owner revision.

On the paused test page, the existing Needs you fold now holds bank confirmations, booked-call cancellations, excerpt requests and available ratings in that order, with optional dispute replies retained inside the same fold. The red banner stays above it; the normal test page is unchanged. Its one scroll area replaces the nested action cards.

Owner follow-up (Nov 1): **Your excerpts** is never on the dashboard, including for a suspended tester. The tester’s own profile shows accepted excerpts only, with Remove; pending, denied and closed requests are absent. No accepted excerpts means no excerpt box. Public profiles retain their accepted-only and NDA rules. The developer’s Excerpt requests action box still handles waiting Allow / Deny decisions.
## A test’s work ends at the last tester deadline (owner, Nov 1)

- Open until closes joining. The last tester’s deadline, no earlier than Open until, closes the whole test to new work and call activity. This replaces the old indefinite late-work rule: an earlier tester can still send after their own deadline while another tester has time, but nothing new is sent or requested once the last deadline passes. Such late work still cannot be charged.
- Normal completion is recorded separately from a developer or team Stop. Working sessions end at the actual deadline, pending call requests close, future booked calls are cancelled, and an ongoing call’s measured time ends at that deadline. Old pages are checked again on the server, including inside the send and booking locks. Pages and the live/daily check use the same closure.
- Pauses protect remaining work time. No deadline closure occurs while paused; lifting it moves the dates before closure is checked. A later pause of an already-finished test moves its financial windows without reviving or moving the ended work window.
- Leave is hidden once work ends; a stale Leave is refused without changing an ended session to Left.
- Pay, Pay more, automatic call payments, Charge / Let it go, disputes, and ratings keep their existing windows. Normal work completion does not pay or discard a submitted part, and does not replace its review date or close-out date.

## §115 An inline attachment shows once (owner, Nov 1)

- A file placed in a sent answer or its notes stays where its paperclip marker was placed. The attachments list below the piece shows only files that were not placed in that text; with none left, there is no list.
- The developer’s Needs you, updated work and paid work, the tester’s sent view and the team’s See the work all follow the same rule. Previous answer sets keep their inline files. Both the short paperclip marker and the older attachment marker resolve as before, and inline files still open or download as before.
## Character counts at every limited text box (owner, Nov 1)

- Every text box with a character limit shows the current count and its limit, including admin notes, Contact us, profile fields, chat, rating notes, reports, disputes, call cancellation and written answers. A count is red above the maximum or below an applicable minimum. An optional empty box stays neutral; the minimum applies once they type. Attachment markers do not count toward written work’s limits. Access keys show the count for each key, not a misleading limit on the whole list.
- Post and Edit use the same rule for title, steps, mature-content explanation and NDA. An unchanged older title or steps keeps its existing minimum exception; an unchanged older NDA still saves as before. Contact us uses the server’s existing 50,000-character limit.
- The suspended tester’s dashboard says they can still dispute payments for work they sent, by opening the test from their dashboard. The limited session view and each dispute’s eligibility rules stay the same. The box also follows §22’s existing rule that suspended testers are paid normally, without claiming the payment waits for reinstatement.

## A paid hold names the approval it still needs (owner, Nov 2)

- From the fourth payment hold onward, paying the balance still leaves the hold waiting for the team’s approval. The developer’s dashboard says “Your balance is paid. This hold is waiting for the team’s approval.” It no longer directs them to Pay what you owe when nothing is left to pay.
- An outstanding owed payment, a bank confirmation or an unresolved charge keeps the payment instructions. This changes the dashboard wording; paying, approval and lifting the hold keep their existing rules.
- A tester-only suspension also shows the tester explanation and dispute reminder: it does not depend on a developer-side suspension being present.
- A successful password change resets the password fields and their live counts together; a refused change keeps what they typed.

## §113 New charges during a hold wait until it lifts (owner, Nov 1)

- During a payment or chargeback hold, a tester’s Charge, an automatic listed-call charge and a team decision’s raise wait as deferred payments. They do not grow Pay what you owe or a chargeback reservation. Existing owed money and bank reversals keep their own handling.
- When the hold lifts, waiting charges run oldest first as away payments. The bank can ask for confirmation for three days; a decline starts a new hold, and later items stay waiting. No running-again notice is sent when a waiting charge immediately starts a new hold. A suspension that remains on keeps its waiting charges deferred.
- The tester sees Payment delayed. Developer Payments lists waiting amounts under “Charged once your tests resume”, separately from Pay what you owe. The developer-row lock prevents a simultaneous hold lift from missing a newly waiting item, and the per-developer drain lock prevents duplicate or out-of-order drains.
## §118 Nov 2 fixes A
- When a tester's part ends (they rate the test, leave, are removed, the test is stopped or blocked, the developer ends their work early, or the test's work window ends), every open new-terms offer for that part closes (status "closed").
- The tester no longer sees Switch / Keep or "Switch or keep your terms" for an ended part. An old page's Switch or Keep is refused with: **Your part on this test has ended, so these terms no longer apply.** This replaces the batch 16 §24 stopped line for Switch / Keep only; the other presses keep it.
- An ended part whose offer row was still open from before this fix is treated the same way, and a press closes it.
- The developer's tester row says "(closed: their part ended)" after "offered new terms <date>". The tester's terms history says "closed when your part ended". The admin test timeline says the tester did not answer before their part ended.
- The tester dashboard's "Waiting for the developer" box lists each call that took place and waits for the developer's Pay (measured, still booked, no review, Pay not closed): "Live call on <date> · <N> min: waiting for review". It opens that call in the session page's Call history.
- A listed call adds the tester's share of its rate × measured minutes to the "Waiting for review" number and shows that amount on its row. An unlisted call shows no amount. "N parts" counts these calls too.
- In the admin console, a "Your actions" line jumps to that action's row on the same page, scrolled to and marked like See it. A test this admin still has paused goes to its row in Tests you paused. An account still suspended, or a test whose developer still is, goes to its row in Suspensions.
- A line opens the test's or the person's page only when that row isn't on the console. That covers stops, deletions, close-outs, pauses or suspensions lifted since, and a row not loaded in its list yet.

Tests: `tests/batch35-nov2-a.test.ts`; the Switch / Keep expectations in `tests/session-end.test.ts` and `tests/batch16-tester-stopped.test.ts` follow the new line.

## §117 One card in play; bank checks never double-charge (owner, Nov 2)

- **Pay what you owe is ONE payment.** A press, the daily retry and a new card's retry charge the total of what's owed (the debts not waiting for the bank) as one PaymentIntent: one charge, one bank check if the card asks, one "Confirm with your bank" item. That payment is a Payment row of kind `owed` (status `paying`, then `needs_action` for a press's inline check or `needs_confirmation` for a retry's 3-day check, `bundled` once it went through, `cancelled` otherwise). Each debt it covers points to it (`Payment.coveredById`, additive migration `20261112090000_owed_one_payment`): while it is being charged or waits for the bank the debts are locked; once it went through every covered debt is marked paid by it (status `charged`, its PaymentIntent, the link kept for the admin's views and refunds) and each tester's share is sent from that one charge (`source_transaction`, as a chargeback reservation's capture does). The box, the confirm item ("What you owe $16.00 (Ana Silva's written answers $8.00, …)"), the receipt and the retry's bell line still name each item. Approved: everything is paid together and the hold lifts as before. The chargeback hold's reservation is unchanged.
- **A waiting debt is locked.** Its box line says "Waiting for your bank", with **Cancel this check** next to the first line of that check. A press, the daily retry and the reservation (chargeback hold) leave it out; other debts are paid. A press with only waiting debts says what to do and charges nothing. Cancel this check cancels the PaymentIntent at Stripe and the debts are payable at once. The claim (`owed → covered` in one update, under the developer's row lock) re-checks that each debt is still unpaid, has no check of its own and isn't covered by another payment; if anything changed, nothing is charged.
- **Never an orphan check.** Whenever the app stops tracking a check (the 3 days or 15 minutes ran out, a refused check, Cancel this check, a new card), it cancels the PaymentIntent at Stripe first. If Stripe says it already went through, it's recorded as paid (the normal Confirm path) and nothing is charged again. If Stripe's answer is unclear, the check stays tracked and is tried again later. A renewal's check belongs to its invoice, so its lapse ends it as before.
- **One card in play.** Saving a new card (Payments' card setup, or a chargeback hold's card check) cancels every waiting check at Stripe. Each charge made while away is then tried again on the new card: goes through → paid; the bank asks → a new 3-day "Confirm with your bank" item on the new card; declined → a debt (a hold, or added to it). What's owed is retried as one payment on the new card (not during a chargeback hold, as before). Confirm with your bank always approves on the current card: a check made on another card is confirmed again with the current one.
- **A declined Confirm keeps today's wait** (owner): the item waits until its date; then a new charge becomes a debt and a debt stays owed (with the check cancelled at Stripe first).
- **A lost answer never charges twice.** If Stripe's answer to the one payment is lost, its debts stay locked. After 10 minutes the next press or retry asks again with the same idempotency key and finishes it however it actually ended.
- **With §113 (merged Nov 2).** During a hold new charges wait for the lift. That includes a check made while away before the hold: when it runs out during the hold, or a new card cancels it, it is cancelled at Stripe and waits as "deferred" (never added to Pay what you owe). The lift charges it on the card in use then. What is owed is still paid as the one payment.
- **A bank dispute on the one payment.** The dispute is on the one payment as a whole: its WHOLE amount is owed again once, with one chargeback fee, on one chargeback hold. The debts it paid stay paid. When it paid a single debt, that debt carries the chargeback as before. A dispute delivered twice opens it once.
- Testers' wording is unchanged ("Payment delayed" / "Paid"); nothing new mentions a hold, a failure or a chargeback.

Tests: `tests/batch35-one-card-checks.test.ts` (fake Stripe that remembers each PaymentIntent and refuses to cancel one that succeeded) covers:
- three debts as one charge and one check, listed and all paid on approval;
- a retry's one confirm item listing all three;
- a new card in each outcome (paid, asked again on the new card, declined into a debt, an old check already paid), plus waiting debts recharged as one payment;
- Confirm on another card;
- a declined Confirm waiting until its date;
- press, retry and reservation skipping a waiting debt, and Cancel this check (including one already paid);
- an expired check cancelled at Stripe, and one that had succeeded recorded as paid with no second charge;
- press + Confirm and clock + Confirm at the same moment charging once, and the claim's re-check.

Earlier tests that expected one charge per debt or a check on the debt itself now follow this rule: batch3, batch5, batch10, batch11, batch17-bank-check, batch19, batch25 and choice.
## §120 Per-field drafts (owner, Nov 2)
Until now a form's draft was the WHOLE form from the tab typed in last: answer 1 typed in tab A and answer 2 in tab B kept only tab B's version. Now Post / Edit
and the written answers keep their draft **per field** (`useKeptUnits` in src/lib/useKept.tsx, the units in src/lib/draftUnits.ts, the server's merge `patchKept`
in src/lib/server/kept.ts; `/api/kept` takes `{ key, units }`).
- **Units.** Related fields are ONE unit, saved and restored together: Parts and prices (all three parts: written / recording / live, their prices, Required
  ticks and the call length), Mature + Why it's mature, Questions + which are required, the access keys. Every other Post / Edit field is its own unit. Written
  answers: one unit per question, and one for Anything else.
- **Writing.** A tab writes only the units IT changed by its own edits (§65: a keystroke, click, paste a moment before), each with its value, or "no draft" where
  the unit is back to its saved value. A unit the tab never touched never writes, so it never overwrites or forgets another tab's draft of it; an untouched field
  that simply takes another tab's Save is never written either. A flush (leaving, hiding, Log out, the side switch) sends only units still unsent (§16).
- **The server** keeps the latest value of each unit on its own (one person's writes to one form wait for each other, so two tabs writing at the same moment both
  survive): tab A's description and tab B's price both stay; the same unit in two tabs: the later one. The stored shapes stay as before (Post / Edit
  `{ f, touched, keysText }` holding only the drafted units' fields; written `{ answers, questions, notes? }` listing only the drafted questions), so the sign-in
  mark and trim (§8), recordings and the terms switch read them as before (the switch now counts a question with no draft as what was sent).
- **Restoring.** A reload, a new tab or a sign-in brings back every unit's latest draft (a unit this tab already changed itself is never replaced).
- **Draft tags.** A field shows "Draft" only while its unit holds a draft value different from the saved value. A field with no draft never shows Draft: typing
  in a different field in a new tab marks only the field typed in (as before, the marks show on a form that opened from a draft). Mature and its reason share one
  mark at the tick. "Use saved" / "Discard" on one field puts that unit back and drops only its draft; the others stay. "Use saved for all" / "Start empty"
  drop every unit this tab knows of. Edit's Save drops only the units it saved (another tab's draft of a field this Save didn't touch stays); Post drops the whole draft.
- Unchanged: the "Started from your unsent draft (time) · Use saved for all / Start empty" line, buttons greyed while a press runs (§58), untouched Edit fields
  changing silently when the saved listing changes (§64), and every other form's whole-form draft (`useKept`).

Evidence (worktree dev server on 3470, a throwaway developer): docs/media/drafts-1-tab-a-description.png (tab A types the description),
drafts-2-tab-b-price.png (tab B, opened before A typed, types the written price), drafts-3-tab-c-top.png and drafts-4-tab-c-price.png (a new tab C: both marked
Draft), drafts-5-tab-c-title.png (C types the title: only the title gains Draft), drafts-6-tab-c-use-saved-description.png (Use saved on the description: its mark
goes, the title and the price stay), drafts-7-tab-d-after-discard.png (a new tab D: the title and price drafts only), and the clip drafts-tab-c.webm (tab C).

Tests: tests/batch35-per-field-drafts.test.ts.

## §121 No "What testers said" on the join page (owner, Nov 2)
- The fold of testers' rating comments about the developer is gone from the join page; the developer's rating ("3.0 ★ (1 rating)") stays under their name and
  links to their profile, where the ratings are.
## §119 Nov 2 fixes B
- Two admins pressing Lift the pause at the same instant: the test row is now locked (`SELECT … FOR UPDATE`) around the check and the lift, the lift's record (who, when) commits in the same transaction, and the press that waited on the lock reads that record inside the same transaction (`liftRefusal(…, tx)`). The refusal always names the admin who lifted it, with that lift's time ("That test's pause was already lifted (by bo@… at 3:20 AM).").
- The old "two admins at once" flake (tests/batch22.test.ts) was mostly the test itself: its last line pressed as admin b whoever had won, so when b had won it correctly read "You already lifted the pause on this test at …" (batch 35 §45) and the test failed. The test now presses as the loser (named winner, exact time) and as the winner ("You already …"). 20 runs in a row: 20/20 pass (docs/media/nov2-a-two-admins-20runs.txt; before the fix about 1 in 3 failed).
- Audit of every "already done by <name> at <time>" refusal for the same pattern (who did it read outside the lock, or before the winner's record exists):
  - Fixed: Lift the pause (above).
  - Fixed: Allow 3 more changes of the locked fields: its record is written inside the test lock, and the refusal reads it there.
  - Fixed: Delete account: the deletion is now one claim (`deletedAt` still empty) with the admin's record in the same commit; two Deletes at once (two admins, or an admin and the owner) can no longer both run, and the second names the first with the deletion's time.
  - Fixed: Approve on a chargeback hold: the claim and its record commit together (the record is removed again if the reservation can't be taken); before, a second admin's refusal could miss the name.
  - Fixed: Approve / Dismiss on a possible outage (heartbeat gap): taken off the list together with the decision's record; a second admin always reads who decided it and how.
  - Fixed: Approve a payment-hold lift: the claim and its "hold-approved" history row commit together; when the approval lifted the hold at once, the refusal names the approver from that row (before: no name or time).
  - Fixed: Close now (closing a paused test): locks the test like Stop, so two Close nows (or a Close now and a Stop) can't both close it; the second names who closed it.
  - Fixed: Decide on a dispute: a decision undone by a payment error no longer keeps the undone decider's name.
  - Fixed: Invites: Cancel invite and the tester's No thanks only change an invite that is still open; the one that loses is refused saying what happened (before, the later one overwrote the first: a joined tester's invite could turn "cancelled").
  - Fixed: Applications: Decline only changes a pending application and Accept claims it inside the join's lock; a Withdraw at the same moment is never overwritten, and the developer reads "Ana Silva withdrew their application." (the tester's Withdraw keeps its "<Dev> declined your application at …" line).
  - Checked, already safe: Pause (test lock, `adminPausedById` on the row), Stop (test lock, `adminStoppedById`), Suspend (one claim with `…SuspendedById`), Reinstate (claim and history row in one transaction), Mark replied (one claim with `repliedById`), outage Approve (one claim with `approvedById`), Decide (one claim with `decidedById`), the team's $0 close-out (per-piece lock; its result names no one), the tester's Withdraw (reads the application after its own claim), Extend (no refusal naming anyone).
  - The route now writes the admin record afterwards only for actions that don't record it inside their own claim (`RECORDED_INSIDE` in adminRace.ts).
- §49 (each Pause and Stop keeps its own reason) and §50 (the device icon) were already on master when the Oct 31 screenshot run noted them (PENDING was written before §49–§52 landed). Rechecked with new tests and screenshots (master and this branch): the Timeline quotes each event's own reason; "A device this test runs on" shows the device (monitor) icon.
- Delete account after the same admin's Suspend in another tab (§51), rechecked: a page loaded before the Suspend (not redrawn) stops once with "You suspended the developer side in another tab at …", also from an older page that sends only its tab; a page that redrew after the Suspend (it shows it) deletes straight away. No change needed: the Delete that "went straight through" most likely came from a page that had redrawn and showed the suspension (case (b) of §51).
- Recordings uploaded before Oct 31 have no length in the file, so the player said Infinity and dragging the time bar snapped back to 0:00. Every recording player (the session's rows, sent attachments, files in written answers, the recorder's preview) is now `RecordingVideo`: when the length is missing it asks the browser for a time past the end (which reads the file's last part through the byte-range route), learns the real length and goes back to the start. Old recordings then show their length ("0:39 · 1.5 MB") and can be dragged; new ones are unchanged. No backfill or migration.
- Tests: tests/nov2-fixes-b.test.ts (race refusals for Lift ×10, Delete, Close now, outage Approve/Dismiss, Decline vs Withdraw, Accept after Withdraw, Cancel invite vs No thanks; each event's own reason; the device icon rendered; Delete after Suspend in another tab; the missing-length player), tests/batch22.test.ts (the corrected race test), tests/batch13.test.ts (the length line).
- Screenshots: docs/media/nov2-b1-timeline-reasons-master.png / -after.png, nov2-b2-device-icon-master.png / -after.png, nov2-b4-old-recording-seek-before.png / -after.png.

## §122 After a lift, a card that asks the bank gives a confirm, not a debt (owner, Nov 2)

- **The bug.** On a card that always asks the bank (Stripe test card 3184), Stripe answered the first charge made after a lift (off-session) with `payment_intent_payment_attempt_failed`, leaving the PaymentIntent in `requires_payment_method`. That answer is a card error, so the app treated it as a decline: the charge became a debt and a new hold started.
- **One classifier for every charge** (`wantsAuth` in `stripe.ts`). Charges made at the developer's press and while they're away all use it: a tester's Charge, a team decision, an automatic call charge, Pay what you owe and its retries, charges after a lift, and a new card's retry. The bank asking the cardholder to authenticate always becomes a "Confirm with your bank" item (3 days, `awayAction`), never a debt. That covers `authentication_required`, `payment_intent_authentication_failure`, `payment_intent_payment_attempt_failed`, and a PaymentIntent left in `requires_payment_method` after such an attempt. If there is no PaymentIntent to confirm, it keeps waiting and is tried again. Only a real decline (a decline code other than `authentication_required`, e.g. insufficient funds) becomes a debt. `isCardError` follows the same rule, and a renewal whose invoice waits like this isn't marked past due. The fake Stripe has `pm_card_authenticationAttemptFailed` for this case.
- **Waiting charges are made together as ONE payment** (owner). Charges made while the developer was away that are retried together are charged as one payment, like Pay what you owe's (§117): testers' Charges, team decisions, automatic call charges, and Pay presses that waited for the lift. This happens when a hold lifts (§113) and when a new card is saved.
  - **One payment:** one charge on the card in use then, one bank check if the card asks, and one "Confirm with your bank" item listing each charge and its amount ("Charges made while you were away $33.00 (…)"). The charges stay "Payment delayed" for testers and are locked under it.
  - **Approved:** every charge is paid by it, each tester's share is sent from that one payment, and one receipt names them all.
  - **Declined:** each charge becomes a debt (a new hold). Its check running out counts as a decline, but during a hold they keep waiting instead.
  - **Any other error:** they all keep waiting and are made on a later sweep.
  - **Disputed:** the whole amount is owed once, with ONE chargeback fee, on one chargeback hold.
  - A reversed payment owed again after a reservation is still charged on its own first.
  - A single charge made at its own moment (a tester's Charge with no hold on) is still its own payment.
- **A hold starting pauses checks still waiting** (owner). Some charges made while away may still be waiting for the bank when a payment hold or chargeback hold starts. These are "Confirm with your bank" items made before the hold, or the one combined payment for such charges.
  - **Paused:** each check is cancelled at Stripe first (rule 4); one that had already gone through is recorded as paid.
  - **Waiting for the lift:** each charge moves to "deferred" (§113) and shows under "Charged once your tests resume", no longer as a confirm.
  - **Old tabs:** Confirm with your bank on one is refused with "This payment is paused until your tests resume." and nothing is charged.
  - **After the lift:** they are made with the other waiting charges as the one combined payment. Testers keep "Payment delayed".
- **A hold restarting mid-run.** The one payment is claimed under the developer's row lock, which re-checks for a hold or a suspension. If one started (e.g. a declined reversed payment ahead of it), every charge not yet made keeps waiting.
- **Tests:** `tests/batch35-one-card-checks.test.ts` §122 covers:
  - the classifier;
  - a 3184-like card after a lift giving one confirm item and no debt;
  - a real decline making debts;
  - a Stripe error leaving the charges waiting, then making them later;
  - a hold restarting mid-run leaving the rest waiting;
  - a new card with three waiting charges giving one payment, one confirm item listing all three, and when disputed, the amount owed once plus one fee.

  - a hold starting with three confirms up: one becomes a debt, the other two are cancelled at Stripe and wait, an old tab's Confirm is refused, and the lift makes them as one payment;
  - a paused check that had already gone through, recorded as paid.

  `batch28`, `batch29` and `batch35-charges-after-lift` follow the one-payment rule.

## §123 Dates use the current time zone (owner, Nov 2)
- The developer's test header and Listing, the tester's join preview and Listing, and the session's Due and agreed scope show calendar dates in the viewer's saved browser zone. A Chicago end of Nov 9 is Nov 9 there, even though its stored UTC timestamp is on Nov 10. The Listing's Before / Now uses that same zone.
- This applies to dashboard dates, profiles, payment and subscription dates, notification day groups and the bell count, admin lists and action times, sent-work history and previous question sets too. A server-rendered page carries its viewer's zone through its server helpers; API presses send their current browser zone, falling back to the account's saved zone when absent or invalid. The zone belongs to one request, never a global setting another person's request can overwrite. When the existing browser-zone sync changes the saved zone, it refreshes the page.
- Post and Edit keep a date-only selection as that calendar date. They already send the browser zone when saving, and Open until and deadlines are still computed in the developer's zone (§111). UTC storage, ISO values, calendar-date arithmetic, card expiry months and diagnostic timestamps stay as they are. New call event and own-action lines keep the existing time markers until they are read, so they follow the reader's zone too; older historical prose is not parsed or rewritten.
- Rejoining still restores the time saved when they left. Extending Open until moves working testers' deadlines; it does not add time to a session while they are away. This display fix changes no deadlines, review windows or Charge eligibility.
- Tests: `tests/batch35-current-timezone.test.ts` covers Chicago/UTC/Tokyo, concurrent and nested request isolation, API browser-zone overrides and saved-zone fallbacks, the actual developer header and both Listing sides, Post/Edit calendar dates, notification grouping across UTC midnight, and the same stored call notice read in Chicago and Tokyo. The existing §111 deadline tests stay green.
## §124 Profile hovers in Messages and chats (owner, Nov 2)

- **What.** The other person's name now has the same profile hover the session page's developer name uses (`PersonHover`: their rating line or "No ratings yet", and "See their profile"). It shows:
  - on the Messages page, for test chats and "Direct message" rows;
  - in a chat's header, for test chats and direct conversations;
  - on each of their messages in that chat.
- **Never on your own name** ("You" stays plain).
- **The profile it links to** is the one for the side in use: a developer's profile from the tester side, a tester's from the developer side. If they have only the other one, it links to that.
- **Blocks and deleted accounts** follow the profile pages:
  - someone who blocked you shows a plain name (their profile isn't available to you);
  - a deleted account shows a plain name;
  - someone you blocked keeps the hover (their profile shows as usual, with Unblock).
- **Messages rows.** A row still opens the chat, through a link laid over the card, so the name's own link and hover sit above it.
- **Code.** `personHoverFor` in `src/lib/server/personHover.ts` builds the hover's name, link and summary, or none. No new hover component.
- **Tests:** `tests/batch35-messages-hover.test.ts` covers:
  - a direct conversation's list row, header and messages;
  - a test chat from both sides;
  - a block either way, and a deleted account.
## §125 Pay what you owe also pays the charges waiting for the lift (owner, Nov 2)

- **One payment for everything.** During a PAYMENT hold, Pay what you owe (the press, the daily retry and a new card's retry) charges the debts AND every charge waiting for the lift (testers' Charges, team decisions, automatic call charges made during the hold) together as ONE payment: one charge, one bank check if the card asks, one "Confirm with your bank" item listing every debt and every waiting charge with its amount. The box lists the waiting charges with the debts ("… charged by the tester while your tests were paused") and its total includes them; the separate "Charged once your tests resume" list shows only while a charge waits outside a hold (e.g. a suspension still on). Waiting charges ride along only with a debt paid at the same time (`holds.payable`, `holds.withDebt`).
- **Approved:** every debt and every waiting charge is paid by it, each tester's share sent from that one payment, the hold lifts with nothing left to charge (no after-lift payment). **Declined or cancelled:** the debts stay owed and the waiting charges keep waiting (never debts, no second hold). **A dispute on it:** the whole amount once, with one chargeback fee, on one chargeback hold.
- **Chargeback hold.** The chargeback steps' one reservation covers what's owed plus the waiting charges, so the team's Approve settles everything in one. Charges added after the reservation are charged right after the lift (batch 28 §8).
- **The after-lift combined payment (§122)** now runs only when a hold lifts another way (the team's lift, a reinstatement, a chargeback won), or for a charge that arrived while Pay what you owe's one payment was in flight.
- **In flight.** A charge that comes in while the one payment is being charged or its bank check is open (a press: 15 minutes; a retry: 3 days) is NOT added to it: its amount is fixed at the claim. Its box line says "Charged right after the payment above goes through"; when the one payment goes through and the hold lifts, it is made right after as one combined payment. This short window is the only way a second payment follows Pay what you owe.
- **The whole box is locked** while the one payment's check is open: every line in it says "Waiting for your bank" with "Cancel this check"; another tab's press and the daily retry charge nothing. A new card (Payments' card setup, or the chargeback steps' Verify a card) cancels the open check at Stripe first, a press's 15-minute check as well as a retry's 3-day one, and what's owed is charged once on the new card (during a payment hold; during a chargeback hold only Pay what you owe's reservation takes it). If the bank had already approved it, it's recorded as paid and nothing is charged on the new card. Cancel this check cancels it at Stripe and unlocks the box at once.
- **A check that runs out.** When the one payment's 3-day check runs out it is cancelled at Stripe and nothing is charged; the debts stay owed, the waiting charges keep waiting, the box unlocks and says "Your bank check ran out on Nov 5: nothing was charged. Pay again or change your card." (never "declined").
- **Bug found while proving it (fixed):** two Pay what you owe presses at the same moment during a chargeback hold each made a reservation for the full amount (the money was taken once on Approve, but the card was held twice). The reservation is now made under the developer's row lock, only when none is open; the second press is refused with "There's nothing more to reserve".
- **A decline and a chargeback at the same moment:** one hold (a chargeback hold), the declined charge and the reversed payment (with its one fee) each owed once, reserved once.
- **A hold starting cancels every waiting check at that moment** (§122): their PaymentIntents read Canceled at Stripe right after. During a chargeback hold, Verify a card therefore normally finds nothing left to cancel; its cancel is a safety net, e.g. for Pay what you owe's reservation check left open on the old card (cancelled at Stripe; Pay what you owe reserves again on the verified card).
- **A chargeback on an older payment while Pay what you owe's check is open** (payment hold): the hold becomes a chargeback hold; approving the open check pays exactly what it covered (fixed at the press) and the hold stays; the box then shows the reversed amount + fee under the chargeback steps. A press from a page that hadn't shown the chargeback stops once naming it ("Your bank reversed a $7 payment: $7 + $15 chargeback fee") — the stop-once check now runs before "Verify your card first."
- **An open bank check is never cut off** (bug seen on video, fixed): when a chargeback turned the payment hold into a chargeback hold while Pay what you owe's 3D Secure page was open, the tab reloaded (SessionWatch's restriction change) and the check could no longer be approved (it would only run out after 15 minutes, nothing charged). SessionWatch now waits while a bank check is open on the page, as AutoRefresh already did.
- **Shown once** (bug seen on video, fixed): charges covered by a combined payment waiting for the bank are listed only in its "Confirm with your bank" item, no longer also under "Charged once your tests resume".
- Bells for charges made during a hold now say "it's added to what you owe and paid with it, as one payment" (link: Pay what you owe).
- Tests: `tests/batch35-payment-proofs.test.ts` (scenarios A–E of the payments proof, and every §125 case above); `batch35-one-card-checks` and `batch35-charges-after-lift` follow §125 (their after-lift cases lift the hold another way).

## §126 Excerpt requests update live; no duplicates; the same question replaces (owner, Nov 2)

- **The report.** BB asked to show an excerpt; it didn't appear on fbbb's test page until a refresh, and after fbbb allowed it, BB's side didn't show it as accepted until a refresh. BB also asked for the SAME answer three times, and all three are now shown (their rows are left as they are).
- **Live.** Excerpt presses only send a bell and record no test event, so the beat had nothing to redraw on. The test page's and session page's poll fingerprint (`testV` in `src/lib/server/pulseV.ts`) now includes the excerpts of that test (developer) or that session (tester), each id with its status. So:
  - a new request shows in the developer's Needs you (and the restricted overview's Excerpts) without a refresh;
  - Allow, Deny and the tester's Remove redraw the developer's Shown excerpts and the tester's session page (its "waiting for" note, and Show an excerpt again).
  - The developer's dashboard box (`dashboardV`) and the tester's own profile, where their excerpts are listed (`publicProfileV`'s shown excerpts), were already fingerprinted. Tests confirm both change on a request and on Allow / Remove.
  - It's a silent redraw: no live line, no stop-once (excerpt decisions are never lines, per BIG_OWN_ACTS).
- **No duplicates.** A request is refused when its text (after squash) equals one of that tester's excerpts for the same session (contract) and question. This covers every submission of the session, so it also holds when the text is trimmed from a newer answer:
  - if that excerpt is still pending: "You already asked to show this excerpt.";
  - if it is shown: "This excerpt is already on your profile."
- **The same question replaces.** A request with a different text, for a session + question that already has a shown excerpt (from any submission of the session), is a replacement.
  - The developer's request row (test page Needs you, the restricted overview and the dashboard box) says "Replaces the excerpt shown now:" with the shown text(s).
  - On Allow, the new one is shown and every shown one for that session + question is removed, in one transaction. On Deny, they stay.
  - The 3-excerpt limit doesn't count the shown ones a request would replace.
- **Pending rules.** One pending request per part stays. There's now also one pending request per session + question: "You already asked to show an excerpt for this question. Wait for the developer's answer."
- **Excerpts leave files out** (owner, Nov 2). The trim box and the stored excerpt text hold no file markers and no "[file]" placeholder: each marker goes with the spaces before it ("great [📎 map.png #k3f9] but" reads "great but"), and a request whose text still holds a marker (an older page) is stored without it (`withoutFiles` / `excerptPlain` in `src/lib/server/excerpts.ts`). A "[file]" typed in is no longer part of the answer, so it's refused like any added word. Excerpts stored earlier stay as they are. (The files-in-excerpts idea, §127, was dropped.)
- **Tests:** `tests/batch35-excerpt-live.test.ts` covers the fingerprints, files left out of the trim box and the stored text (and earlier excerpts kept), both duplicate refusals (including one from another submission of the session), the per-question pending rule, the replacement line, Allow replacing and Deny keeping, and a replacement at the limit. `batch13`'s one-pending check now uses a different text.

## §127 Card attempts are limited (owner, Nov 2)

Against card testing (someone running stolen cards through "save a card" one after another). (The number was free: the earlier files-in-excerpts idea under §127 was dropped.)

- **The limits.** At most 5 card attempts per account and 15 per network in a rolling 24 hours (`cardAttempt` in `src/lib/server/cardLimits.ts`). On a local dev server there's no network (`clientIp`'s ""), so the network cap is skipped there, as for sign-in; the account limit still applies.
- **What counts as an attempt:**
  - starting a card save: Add a card / Change card on the Payments page (`POST /api/payments/card`, before the Stripe Checkout setup session is made);
  - starting Verify a card in the chargeback steps, and each card typed into it (`POST /api/payments/verify-card` without `finish`).
- **What doesn't:** paying with the saved card, Pay what you owe, the end of a check (the bank's answer, or the stand-in's Cancel this check: `finish`), and a press that stopped once for a change in another tab.
- **Over the limit:** refused with HTTP 429 and "Too many card attempts today. Try again tomorrow, or contact us." Nothing goes to Stripe.
  - Verify a card shows the line under its button (the steps' own error line).
  - Add a card / Change card is a form post, so it goes back to Payments (`?error=card_limit#card`) with the line under that button, not in the line at the top.
- **Storage.** No migration: each attempt is a `LoginAttempt` row with kind "card", the account's id in its `email` field and the network in `ip`. The daily job's clean-up of attempts older than a day keeps the table small.
- **Tests:** `tests/card-limits.test.ts` covers 5 allowed and the 6th refused (Add a card, and Verify a card's start and typed card), another account on the same network stopped by the network cap, a day later working again, paying not counted, and no network cap on a local dev server.

## §128 Invites are limited (owner, Nov 2)

- **100 a day per developer**, across all their tests, in a rolling 24 hours (`INVITES_PER_DAY` in `src/lib/server/invites.ts`), counted from the Invite rows' `createdAt`. Every invite sent counts: inviting the same tester again after a cancel, each of the per-test 3 below, and the re-sends a listing change makes (`reinviteAfterEdit`; those are never refused, a Save always re-sends).
  - A press that would go over is refused whole (HTTP 429), with nothing sent, under Invite: "You can send up to 100 invites a day. You have N left today." When none are left: "You've sent 100 invites today. You can invite more tomorrow."
  - Only the testers the press would really invite count toward it (not the ones skipped for another reason).
- **3 a day to the same tester on the same test** (`INVITES_PER_TESTER_PER_TEST`; a cancel and re-invite counts each time; another test has its own 3). Over it, only that tester is skipped, with a line in the press's result like the other skip reasons: "<name>: you've invited them to this test 3 times today. You can invite them again tomorrow." The others in the press are invited.
- **Cancel invite is never limited**: it works at 100.
- **Tests:** `tests/invite-limits.test.ts` covers 100 then refused (and a day later working), a press of 3 with 2 left refused whole and naming 2, cancel and re-invite counting (the per-test 3 counted toward the 100), the skip line with the others invited, another test's own 3, cancel at the limit, and another developer unaffected.

## §129 Two gaps from the proof recordings (Nov 2)

- **An NDA redraws excerpts live.** Adding or removing an NDA on a test didn't redraw an open profile until a reload: the excerpt stayed (or stayed hidden). The profile's fingerprint (`publicProfileV` in `src/lib/server/pageFreshness.ts`) now includes each shown excerpt with whether its test has an NDA now. So, within the normal poll:
  - another person viewing the tester's profile (a developer, another tester) sees the excerpt go when the NDA is added and come back when it's removed;
  - the tester's own profile, where their accepted excerpts are listed, redraws to "Allowed · hidden while <test> has an NDA" and back to "Shown on your profile".
  - The developer's dashboard (`dashboardV`) had the same gap for a pending request's note ("<test> has an NDA now: if you allow this, it stays hidden…"): its excerpts now carry the NDA state too. The test page and session page already redraw on the listing Save's event.
- **The stop-once line says what the second press does.** During a chargeback hold, Pay what you owe's second press doesn't pay: it asks to verify the card (step 1) if that isn't done yet, then reserves the amount, and the team's Approve takes it. The stop-once line used to end "Press again to pay $22.00." It now ends (`pressAgainLine` in `src/lib/rules.ts`, used by `payOwed` in `src/lib/server/holds.ts`):
  - card not verified yet: "Press again to verify your card, then reserve $22.00 on it: it's taken when the team approves lifting your hold."
  - card verified: "Press again to reserve $22.00 on your card: it's taken when the team approves lifting your hold."
  - outside a chargeback hold, unchanged: "Press again to pay $22.00."
  - The wording follows the reservation line the chargeback steps already show ("Reserved $X: it's taken when the team approves lifting your hold.").
- **Tests:** `tests/batch35-excerpt-live.test.ts` (§129) covers the tester's own profile, the developer's and another viewer's view changing on an NDA added and removed (the test's updatedAt kept, so only the NDA moves it), the excerpt hidden and back, and the dashboard's pending request. `tests/batch35-payment-proofs.test.ts` (the press from a page that hadn't shown the chargeback) checks both chargeback-hold endings, that the next press asks to verify first and, once verified, reserves with nothing taken, and that outside a hold the line still reads "Press again to pay $22.00."
## §130 Stripe ids from the other mode, and the mode switch (owner, Nov 2)

The owner put LIVE Stripe keys on the hosted site, and wants to switch between test and live at any time. Stripe ids are per mode: live Stripe doesn't know a test-mode id (or the other way round) and answers `resource_missing` ("No such customer / payment_method / account / payment_intent"). A stale id must never put anyone on a hold, charge twice, or lose a record.

- **Runtime safety (the backstop, both directions).** `isMissing` / `missingAccount` / `forgetCard` / `forgetPayout` / `cardGone` in `src/lib/server/stripe.ts`.
  - **Customer or card unknown:** the developer's customer, card and expiry are cleared, and it's "no card saved" WITHOUT a decline: its own code `no_card` with the existing line "Add a card in Payments first, then press Pay again." (no hold, no debt, a daily retry isn't counted). Covers Pay, Pay more, a tester's Charge (the tester reads the plain "Payments are having a problem" line), an automatic call charge (tried again next sweep), a dispute decision (the team reads why; the dispute stays open), Pay what you owe and its retries (`notTried`), a chargeback hold's reservation, Subscribe ("Add a card first, then subscribe."), Confirm with your bank on the current card, the Payments card line (reads "No card yet." and offers Add a card on the same page) and the card expiry reminders. `chargeError` no longer maps resource_missing to a decline.
  - **Card setup / Verify a card with a stale customer** makes a new customer.
  - **Payout account unknown:** stripeAccountId and payoutsReady are cleared (Payments: "Connect a payout account", shares wait as before setup); a charge whose destination is unknown is made again without it on its own key (`pay-<key>-nodest`, the same on a repeat); onboarding makes a new account; a waiting share's transfer stops and waits.
  - **A PaymentIntent / SetupIntent unknown:** as good as cancelled, never paid. `dropCheck` returns "missing"; a clock reaching such a check closes it with nothing charged (`closeStaleCheck` in confirm.ts), never counting it as declined; Confirm with your bank says "This payment was cancelled: nothing was charged."; Verify a card's check is "not verified, try again".
  - **Subscription unknown:** ended the way Stripe deleting one ends it (past due lapses; otherwise ended as cancelled), id cleared, nothing charged (`subscriptionGone`). An unknown subscription product id is forgotten (made again on the next Subscribe).
- **Payments switched off** (a live key without `STRIPE_ALLOW_LIVE=1`: getStripe's `payments_off`, "Payments are switched off right now. Try again later."): Add a card / Change card, payout setup and the returns from Stripe go back to Payments with that line (`?error=paused`); Verify a card, Pay, Pay what you owe and Charge show it too. Never a decline, a hold, a debt, a counted retry or a counted card attempt (checked before counting).
- **The mode switch** (`scripts/stripe-mode-switch.mjs`, run by `vercel-build` after `prisma migrate deploy`, and by `npm start`). The key's mode (`sk_`/`rk_` + `live_` or `test_`; STRIPE_ALLOW_LIVE doesn't matter) is compared with the mode stored in AppState `stripeMode` (`{"mode","switchedAt"}`; none stored = test). Different: in one transaction it clears every user's customer, card, expiry, payout account and payoutsReady, re-opens a chargeback hold's "Verify a card" step, ends Stripe subscriptions as a deletion does and clears their ids (and the stored product), closes every open bank check as cancelled with nothing charged (the same rules as `closeStaleCheck`: a press's check is a cancelled press; Pay what you owe's one payment is cancelled and what it covered is owed again; a retried chargeback's row goes; a charge made while away is cancelled and its part is unpaid again, its keys freed; a debt with a check of its own stays owed), cancels open reservations, closes testers' shares still waiting on the old mode's charges (`transferStatus` "closed"), then stores the new mode. Same mode, or no key: nothing. It logs counts only. Idempotent; a failed run changes nothing and stops the build.
- **Tests:** `tests/batch35-live-stripe.test.ts`; `codex9-card-to-post`'s resource_missing case now expects "no card saved" (the old decline rule is replaced).

## §131 Every payment line names which test and which part (owner, Nov 2)

The bank-confirm box showed "Charges made while you were away $416.00 (the team's decision on Marc Hanna's dispute $320.00, the team's decision on Marc Hanna's dispute $96.00)": the developer couldn't tell the two apart. Every developer-facing line that names a payment now says WHICH tester, WHICH part and WHICH test.

- **One helper:** `pieceName({ tester, part, test, when?, full? })` in `src/lib/rules.ts` → "Marc Hanna's written answers on “chargechar…”". The tester's and the test's names are each cut at 10 characters with "…" (`cut10`, now exported; the same cut as the reversed-payment line). Part is "written answers", "recording" or "live call" (`partOf`; "work" only for a row naming no part). A call adds its day in brackets: "Ana Silva's live call on “Harbor Run” (Oct 30)". A team decision is `disputeDecisionName(piece)`: "the team's dispute decision on Marc Hanna's recording on “chargechar…”". `chargebackOwedLine` uses it too. bankTop's `pieceWords` and holds' `paymentPiece` (a payment's piece from the database) are built on it.
- **Where:** the bank-confirm items (Payments' list, the dashboard's "Your bank wants you to confirm" rows, the test page's rows), the owed box (failed, charged-while-paused, the dispute decision, the reversed payment), receipts (Pay, a tester's Charge, an automatic call charge, a dispute decision, extra pay, what you owed), the retry's "We charged your card…" line, the declined-payment bells ("Another payment was declined: $5.00 for … was added to what you owe", including "not confirmed with your bank"), the "added to what you owe" bells for a tester's Charge, an automatic call charge and a dispute decision during a hold, the chargeback event and bell, the charges paid after a pause, and Payments' paid list (developer side).
- **Several items in one payment** (Pay what you owe's one payment, charges made while away) keep listing each item, each in the new form: "Charges made while you were away $416.00 (the team's dispute decision on Marc Hanna's written answers on “chargechar…” $320.00, the team's dispute decision on Marc Hanna's recording on “chargechar…” $96.00)".
- **The test isn't said twice:** a dashboard row naming a piece drops its own "on “Harbor Run”" ("$12.50 · Ana Silva's written answers on “Harbor Run”"); "what you owe" on a test keeps it ("$10.00 on “Harbor Run” · what you owe"). Payments' Confirm list reads "A payment for Ana Silva's written answers on “Harbor Run” $12.50 · confirm by …".
- **Hover shows the full names.** On a page, each of these lines also carries its uncut version (`full`), shown as its hover (`title`): the owed box's lines (`owedLines` → OwedBox's `<li>`), the Confirm list (`confirmItems`), the dashboard's rows (`bankToConfirm` → BankToConfirm), the test page's rows (`bankWaitingOnTest` → BankWaiting), Payments' waiting charges (`deferredForBox`) and its paid list (`paidRows`). Bells and emails are plain text and stay cut.
- **Unchanged on purpose:** testers' own lines (they already name the test; no "hold" or "chargeback" words added); admin lines (adminLists, the team-close preview, the admin chargeback email: they show the test, full names); the test page's own event lines ("Ana Silva charged $5.00 for their written answers": they sit on that test); the review reminders ("“Harbor Run”: review Ana's written answers…", "Pay now: …", "Closing soon: …": they already name the test and the part); the one bell summing every charge waiting for the bank ("Your bank wants you to confirm a $16.00 payment on “Harbor Run” by …": a total per test, no piece); the reservation receipt after the team's Approve ("what you owed (reserved on your card, taken on the team's approval)": it names no item).
- **Tests:** `tests/payment-piece-names.test.ts` (the helper, the cut, the uncut version; a dispute decision waiting for the bank on Payments, the dashboard and the test page; the owner's example of one payment listing two decisions; the owed box's lines; each hover rendered as `title`; a bell staying cut). The suites asserting the old wording are updated (addition, batch3, batch10, batch11, batch17-bank-check, batch23, batch24, batch25, batch28, batch29, batch35-one-card-checks, batch35-payment-proofs, choice, hold).

## §132 Calls: at least 24 hours ahead, and no later than when testers' work ends (owner, Nov 2)

Replaces the earlier rule: a call could be booked any time 5 minutes or more ahead, even after a tester's deadline (labelled "Booked after X's deadline").

- **At least 24 hours ahead** on the live site: `CALL_MIN_AHEAD_MINUTES` (`src/lib/callLead.ts`) is 1440 in production, whatever the setting says (`LIVE_CALL_LEAD_MINUTES`, `leadMinutesFor`). Local testing keeps 1 minute by default, or the `CALL_MIN_AHEAD_MINUTES` setting, so local tests stay quick. The words come from the minutes (`leadLine` in `src/lib/callWindow.ts`): "Pick a time at least 24 hours from now." on the live site, "Pick a time at least 1 minute from now." locally (no lead: "Pick a time in the future."). They replace "Pick a time in the future." at the time box and from the server.
- **No later than when testers' work on the test ends**: the test's latest deadline, `workDeadlineOf` (every tester's deadline, no earlier than Open until; `workEndOf` in `src/lib/server/workWindow.ts`). A later time is refused: "Pick a time before Thu, Dec 3, 11:59 PM (when testers' work on this test ends)." (the date and time in the reader's zone, with the existing fmt helpers). The end's own minute is taken.
- **Daily and Weekly sets run up to the end** (`cutRow` in `src/lib/callRows.ts`). Their calls after it are dropped, not refused, and the request covers what's left: a weekly ×8 that fits 3 is stored as 3, reads "3 calls from …" on both pages, and its button is "Accept all 3". With only its first call before the end it's a single call. A first time already after the end is refused as above.
  - A **Forever** row runs until the end. In the form it reads "Until testers' work ends (Dec 3)"; a waiting request says how many calls that is ("weekly calls: Thu 3:00 PM · 5 calls from Thu, Nov 5, 3:00 PM until testers' work ends (Dec 3)"); a booked set's line reads "Weekly · Thu 3:00 PM (until testers' work ends)".
- **Everywhere call times are made:**
  - the tester's and the developer's requests (`readRows` / `readKind` in `src/lib/server/requests.ts`). An exact match with the other side's waiting request books at once, as before: both times were checked when sent. There are no separately offered times (a call slot is only made when a call is booked).
  - **Accept** checks the chosen time again. Less than 24 hours away now: "Thu, Nov 5, 3:00 PM is less than 24 hours from now, so it can't be booked any more. Request a later time instead." (409 `too_soon`). After the end (a request sent before this rule): "Thu, Dec 10, 3:00 PM is after testers' work on this test ends (Thu, Dec 3, 11:59 PM), so it can't be booked." (409 `after_end`). An older set that runs past the end books only its calls before it.
  - In the Call requests panel, a waiting time less than the lead away loses its Accept (Decline and Withdraw stay) and reads "Less than 24 hours away now: it can't be booked any more." It's checked every half minute while the page is open.
  - The **Forever top-up** (`topUpForeverSets`) adds no call after the end. The set waits there and goes on if the end moves later (Open until extended, a pause lifted, a later tester deadline); it still ends with the work.
  - Calls already booked are left as they are.
- **The forms offer only what's valid** (`src/components/RequestRows.tsx`). Both pages (the tester's session page and the developer's test page) pass the server's lead (`leadMinutes`, as before) and the end (`callEndProps`: the moment and its words in the reader's zone).
  - The time box's earliest time is now + the lead, rounded up to the next minute and moving on with the clock while the page is open. Its latest time is the end's minute. Each has its red line, the same text as the server's.
  - The calls drop-down lists only the counts that fit before the end (only 3 weekly calls fit: 2 and 3), and its last choice reads "Until testers' work ends (Dec 3)".
  - A Daily or Weekly that can't fit 2 calls is greyed in the Repeat drop-down, with a short line under the row: "Weekly isn't offered: only one call fits before testers' work ends (Dec 3)." (or "Daily and Weekly aren't offered: …").
  - What was typed is kept: a count or repeat that no longer fits is shown and sent as the most that does (`fitRow`), and comes back if the time moves earlier.
  - With less than the lead left before the end (the last 24 hours of a test on the live site), no time fits: both forms show "No more calls can be requested: testers' work on this test ends Thu, Dec 3, 11:59 PM, less than 24 hours from now." instead of the time boxes (the developer keeps the tick list), and the server refuses an older page's press with the same line. Waiting requests and booked calls show as before.
  - **Live:** the end is in the test page's and the session page's poll fingerprint (`testV` in `src/lib/server/pulseV.ts`), so an Open until extension, a tester joining with a later deadline or a pause lift redraws the forms' limits on the normal poll, with no reload. The redraw is the page's in-place refresh, so a half-filled form keeps what was typed (the typed times and length are also kept as a draft, as before).
- **"Booked after <name>'s deadline" stays.** A tester's own deadline is still a guide while the test's work goes on (another tester's later deadline, or Open until), so a call can still be booked after it.
- **Terms of Use** (still version 2: nothing has launched). Section 7 now says: "A call can be booked at least 24 hours ahead, and no later than when testers' work on the test ends (the latest tester's deadline, or Open until if later); daily and weekly calls stop there." (`CALL_WINDOW_TERMS` in `src/lib/termsOfUse.ts`), and version 2's What changed lists it. No sentence said calls could be booked after a deadline.
- **Wording:** a running set's "Forever" / "until cancelled" now reads "until testers' work ends" (the event lines, the Booked bell, the tester's stop box). A count outside 2–8: "Daily calls repeat 2 to 8 times, or until testers' work ends." The design doc, HANDOVER and TEST-ONLY-SETTINGS now say 24 hours for the live site.
- **Tests:** `tests/batch35-call-window.test.ts` covers the lead (24 hours in production whatever the setting, through the real endpoints and with its line; 1 minute locally with the override), a time after the end refused on both sides with the end in the reader's zone (the end's own minute taken), a weekly ×8 cut to the calls that fit with the count on both pages and Accept booking them, a set left with one call becoming a single call, the closed window (the server and both forms), Forever stopping at the end and going on when Open until moves later, Accept refused for a time now too soon or after the end (and an older set past the end booking only what fits), the forms' earliest and latest times and their lines, the calls drop-down's counts, Forever's words and the greyed repeats with their line, both pages passing the lead and the end, the fingerprint changing when the end moves, the panel's Accept going for a time too soon, and the Terms text. Updated for the new rule: `batch27` and `batch29-misc` (the lead's words; 24 hours in production), `call-sets` (the count line; the Forever test's work runs 60 days so the weekly set has room), `request-kinds` (4 weekly calls need Open until 29 days ahead; a time inside the window).
## §133 A bank can dispute PART of a payment (owner, Nov 3)

- **The report.** A bank can dispute part of a card payment (e.g. $96 of a $444.67 "Pay what you owe" payment). Stripe's `charge.dispute.created` carries the disputed `amount` (cents), and Stripe takes back only that amount (+ its $15 dispute fee). The webhook ignored the amount and treated the WHOLE payment as reversed, so the developer was asked for too much.
- **What's stored.** The payment carrying the chargeback keeps what the bank reversed: `Payment.reversedCents` (nullable; migration `20261113090000_payment_reversed_cents`; null = the whole payment, which is how every chargeback recorded before §133 reads). It is the dispute's amount, at most the payment's amount (a larger amount counts as the whole payment). An event with no usable amount counts as the whole payment, as before. The webhook passes the amount to `chargebackOpened(paymentIntentId, amount)`; the claim writes `chargeback: "open"` and `reversedCents` together. Helpers in `src/lib/rules.ts`: `reversedOf`, `reversedPart`, `disputedCentsOf`, `reversedWords`, `repaidReversedLine`.
- **A full dispute behaves exactly as today:** the same amounts and the same lines.
- **A partial one:** the developer owes the disputed amount + ONE $15 fee. The rest of that payment stays paid, and testers' shares are untouched (the payment row, its share and its transfer don't change).
- **The lines** (whole-payment lines unchanged):
  - **Owed box, Pay what you owe's one payment:** "Your bank reversed $96 of your $444.67 payment: $96 + $15 chargeback fee". It paid for several items and the bank gives only an amount, so what that payment covered is listed under the line ("That payment covered:" then each item with its amount, named as the confirm items name them). None of the items is named as the disputed one.
  - **Owed box, a payment for one piece:** "Your bank reversed $96 of the $444.67 you paid for Ana Silva's written answers on “Harbor Run” (Nov 2): $96 + $15 chargeback fee". The names are cut with `cut10` (`pieceName`), and the hover shows them uncut.
  - **The developer's test page and bell:** "Your bank reversed $96.00 of your $444.67 payment for …" (the event), "…: it was added to what you owe" (the bell when a hold was already on), and "The team resolved the bank reversal of $96.00 of your $444.67 payment".
  - **Won:** "Your bank's chargeback of $96.00 was reversed in your favour.", "Refund: your bank's chargeback of $96.00 was reversed: $111.00 refunded.", and on the test page "Your bank's chargeback of $96.00 was reversed: $111.00 refunded to your card." (or "… taken off what you owe.").
  - **Admins:**
    - the chargeback email: "Playtest: new chargeback of $96.00" and "A developer's bank reversed $96.00 of a $444.67 payment (pi_…)…";
    - the hold row: "Chargeback open: $96.00 of a $444.67 payment · pi_…";
    - the person's Chargebacks box: "Chargeback $96.00 of a $444.67 payment (open)";
    - payment rows: "· chargeback open ($96.00 reversed)";
    - the needs-the-team list: "Open chargeback: $96.00 of a $444.67 payment".
- **Every total follows it.** That covers what's owed and payable, Pay what you owe's one payment and the chargeback reservation (so the team's Approve captures $96 + $15), the chargeback steps, the admin's owed line, the owed box's stop-once, and the confirm items' covered amounts.
- **What you've paid** (`paidOutTotal` in `src/lib/server/paymentRows.ts`):
  - The reversed payment counts minus the disputed part. Its row says "· your bank reversed $96.00 of this (chargeback)".
  - The repayment row: "Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)". A payment for one piece adds "for <piece>" before the brackets. A whole one still reads "Repaid the reversed $39.00 … ($39.00 + $15.00 chargeback fee)".
  - Pay what you owe's one payments the bank reversed aren't listed themselves (their items are), so they take what was reversed off the total too. This also fixes a combined payment's whole reversal being counted twice (its items and its repayment).
- **Won:**
  - Already repaid: exactly what was repaid is refunded ($96 + $15 = $111) at the repayment's PaymentIntent.
  - Not repaid yet: the $96 + $15 leaves what's owed.
  - A repayment still waiting for the lift ("deferred": e.g. a suspension still on) is dropped, so it's never charged after a win. This was a gap found while building §133.
- **A second delivery changes nothing.**
  - The same event id is a duplicate (StripeEvent).
  - The same dispute under another event id (even with another amount) finds the chargeback open and changes nothing: one chargeback, one fee, one hold, one email.
  - Two deliveries at the same moment open it once.
- **`charge.dispute.updated`.** A bank can change the disputed amount before it's decided (`disputeAmountChanged` in `src/lib/server/holds.ts`).
  - **Followed** only when all of these hold (checked under the developer's row lock):
    - the chargeback is open;
    - nothing of it is repaid or being repaid: no repayment paid or waiting, no Pay what you owe payment holding it, no reservation covering it;
    - Stripe hasn't decided it (won, lost, warning_closed, charge_refunded, prevented).
  - **When followed,** what's owed and every total follow at once. The owed box redraws (`owedV`; `paymentsV` and the admin console's fingerprint include `reversedCents`). A press from an older page stops once: "What you owe changed: now $135.00. Press again …".
  - **Otherwise,** nothing changes and it's logged for the admins:
    - every admin gets "Playtest: a chargeback's amount changed ($96.00 to $120.00)";
    - the developer's Chargebacks box (admin console) lists "Stripe changed the disputed amount of the $444.67 payment (pi_…) from $96.00 to $120.00: not followed, because it's reserved on the developer's card. Check it in Stripe.";
    - followed changes are listed there too, with no email.
  - An update for a dispute not recorded yet answers 503, so Stripe retries it.
- **Never charged at an old amount.** Pay what you owe's one-payment claim re-reads a reversed payment's amount under the row lock. If it changed after the total was read, nothing is claimed and the press stops once.
- **Tests:** `tests/partial-dispute.test.ts` covers:
  - a full dispute unchanged (Stripe's amount, none, more than the payment; on one payment and on Pay what you owe's one payment);
  - part of a single payment, with every line and total, the reservation, Approve and the repayment row;
  - part of a combined Pay what you owe payment, with its covered list and the repayment row;
  - the repayment and won refund amounts, won before repaid, and a waiting repayment dropped;
  - duplicate deliveries;
  - amount updates: followed, an older page's stop-once, the same amount, and not followed (decided, reserved, resolved, won), each logged with the admins' email;
  - an update before the dispute is recorded, and the claim refusing a changed amount.
  - `paid-list` follows the moved helpers.
- **Proof:** `docs/media/partial-dispute/README.md`: real Stripe test-mode payments, a real full dispute (card 0259), and a partial dispute event signed like Stripe's.

## §133 addition: every Stripe description reads like its Payments line (owner, Nov 3)

- **The rule.** A Stripe PaymentIntent's `description` reads the same as the payment's line on the developer's Payments page ("What you've paid"), with the names in FULL (no 10-character cut; Stripe has room), after "Playtest: ". One shared builder makes it from what is being paid: `stripeDescription` in `src/lib/server/paymentRows.ts`. It is built on the page's own line (`devLine`: `pieceName` with `full: true`, `disputeDecisionName`, `repaidReversedLine`), so the page and Stripe can't drift.
- **What it reads:**
  - a Pay: "Playtest: Marc Hanna's written answers on “chargechargecharge”" (a recording or a live call names that part);
  - a Pay more: "Playtest: Pay more for Marc Hanna's written answers on “chargechargecharge”";
  - a team decision: "Playtest: The team's dispute decision on Marc Hanna's recording on “chargechargecharge”";
  - a tester's Charge: "Playtest: JJJJ's written answers on “…”, charged by JJJJ after 7 days without a review";
  - an automatic call charge: "Playtest: Marc Hanna's live call on “…”, charged automatically after 7 days";
  - a repayment of a reversed payment: "Playtest: Repaid the reversed $39.00 Pay more for … ($39.00 + $15.00 chargeback fee)", or for part of one (§133) "Playtest: Repaid $96 reversed from your $444.67 payment … ($96 + $15 chargeback fee)".
  - It follows the page word for word: the "how" comes after a comma ("…, charged by …"), as the page shows it. The examples in the request had it in brackets.
- **Pay what you owe's one payment** lists each item as the page names it, with its amount: "Playtest: What you owe (Ana Silva's written answers on “Harbor Run” $244.67, Dee Lin's written answers on “Harbor Run” $200.00)". The one payment for charges made while away reads "Playtest: Charges made while you were away (…)". A reversed payment owed again is listed as its repayment will read.
- **A chargeback hold's reservation:** "Playtest: Reserved for the team's review: <items>".
- **A subscription keeps its own:** "Playtest subscription ($7/month)".
- **Stripe's 1,000-character limit:** a list that would pass it ends "… and N more" (`listWithin`). There is a last safety cut in `stripe.ts`.
- **Call sites.** Every charge and reservation in `src/lib/server` passes it:
  - Pay, Pay more and the team decision in `payments.ts`;
  - the tester's Charge (a part and a call), the automatic call charge and the repayment after the lift in `holds.ts`;
  - Pay what you owe's one payment and the combined payment for charges made while away in `owedOnce.ts`;
  - the reservation in `chargeback.ts` (`authorize` now takes the description).
  - `confirm.ts` makes no PaymentIntents: it confirms existing ones, which keep the description they were made with.
- **Fixed at the first charge.** `Payment.stripeDescription` (nullable; migration `20261113100000_payment_stripe_description`) keeps the description a payment was first charged with (`describedOnce`). A charge asked again with the same idempotency key always sends the same description, even if a tester renamed meanwhile, because Stripe refuses a key reused with other details. Without this, the one payment's resume (`resumeStaleOwed`) and the repayment after the lift could stay stuck.
- **A page fix found on the way.** A Pay more or a team decision on a piece that the tester charged, or that was charged automatically, no longer repeats that piece's "charged by …" / "charged automatically …" in its own line: only the piece's own payment says how it was charged.
- **Tests:** `tests/stripe-descriptions.test.ts` covers:
  - each kind equal to its page line with the names uncut;
  - the one payment, charges made while away, the reservation, and a reversed payment owed again;
  - the 1,000-character end;
  - the descriptions actually sent at Stripe (Pay, Pay more, the tester's Charge, Pay what you owe, the reservation, the repayment after the lift);
  - the description kept on a retry after a rename;
  - a scan that every call site uses the builder.
## §135 Calls relay through Cloudflare Realtime TURN (owner, Nov 3)

Calls are browser to browser (WebRTC): on a strict network (some offices, mobile carriers, VPNs) the two browsers can't reach each other and need a TURN relay. The owner chose Cloudflare Realtime TURN. It has no fixed password: the server makes short-lived credentials from a TURN key each time they're needed.

- **Settings:** `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` (server only; live settings, not testing ones). Set up in docs/HANDOVER.md "Call relay (TURN)".
- **When credentials are made** (`callIceServers` in `src/lib/server/turn.ts`): when one of the call's two people opens the call page, and when their room joins (each room start posts its `join`, and its answer now carries the ICE servers, so a Rejoin, or a Join pressed long after the page opened, connects with credentials from that moment).
  - The request (Cloudflare's docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/): `POST https://rtc.live.cloudflare.com/v1/turn/keys/<CLOUDFLARE_TURN_KEY_ID>/credentials/generate-ice-servers`, headers `Authorization: Bearer <CLOUDFLARE_TURN_API_TOKEN>` and `Content-Type: application/json`, body `{"ttl": <seconds>}`; Cloudflare answers 201 with `{"iceServers": [...]}` (its STUN, and its TURN URLs with the short-lived `username` and `credential`).
  - **ttl** (`turnTtlSeconds`): the call's remaining measurable time, until its measuring deadline (the booked start + 150% of its length + 30 minutes: the room can't be used after it), plus 1 hour; at most 24 hours. Expired credentials cut a relayed call, so they outlast the room.
  - **What the room gets:** Cloudflare's `iceServers`, kept to `urls` / `username` / `credential`, without port 53 URLs (browsers block that port, Cloudflare's docs say). Google's STUN is added only when Cloudflare's answer has no STUN of its own.
  - **Cache:** in memory, per call and person, for 5 minutes (`TURN_CACHE_MS`): a reload, or the room's join right after the page, reuses the same credentials. The other person gets their own. Failures aren't cached.
  - **Fallback:** an error answer, a network error, an answer without TURN credentials, or no answer within 2.5 seconds (`TURN_TIMEOUT_MS`): the fixed `TURN_URL` relay when it's set, else Google's STUN only (`iceServers()`, unchanged). One log line, with no key, token or answer in it: `[turn] Cloudflare TURN credentials failed (HTTP 401): this call uses STUN only.` (or "(the request failed)", "(no TURN credentials in the answer)", "(an answer that isn't JSON)", "(no answer within 2.5 seconds)"; "the TURN_URL relay" when it's set).
  - Without both settings: unchanged (Google's STUN, plus `TURN_URL` when set); Cloudflare isn't asked.
- **Who gets them:** only the call's tester and developer. The API token is never sent to a browser: it's only in the server's request to Cloudflare. The page makes credentials only after its checks (anyone else reads "This call isn't available." and nothing is asked of Cloudflare), and not when it shows a line instead of the room (cancelled, over, closed). The room's join is refused to anyone else, as before.
- **Settings box** (`src/lib/configProblems.cjs`, `turnRelaySetUp`): the relay is set up with the Cloudflare pair or `TURN_URL`.
  - Live site with neither (replaces the TURN_URL line): "No TURN relay is set up: calls can't connect on some strict networks (some offices, mobile carriers, VPNs). Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (a Cloudflare Realtime TURN key), or TURN_URL, TURN_USERNAME and TURN_CREDENTIAL from another TURN provider."
  - Only one of the pair (anywhere): "CLOUDFLARE_TURN_KEY_ID is set without CLOUDFLARE_TURN_API_TOKEN: set both (from the same Cloudflare TURN key), or calls don't use the Cloudflare relay." (and the other way round). On the live site without `TURN_URL` the "No TURN relay" line shows too.
  - Both only warn; neither stops the build.
- **`?relay=1`:** "Relay-only check: no TURN relay is set up (CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN, or TURN_URL), so this call can't connect this way." only when neither is set; otherwise the usual "this call goes only through the TURN relay…" line.
- **Tests:** `tests/batch35-cloudflare-turn.test.ts` (a mocked fetch): the request's URL, method, headers and ttl, and Cloudflare's servers handed to the room (port 53 dropped, Google's STUN only without Cloudflare's); the 24-hour cap; the cache (a reload and the join reuse, the other person gets their own, a rejoin 6 minutes later asks again with a shorter ttl); each failure falling back (TURN_URL or STUN only), the log lines without the key or token, nothing failed kept; the token in no page prop and no join answer; a stranger and a cancelled call asking nothing; the settings box lines and the `?relay=1` note. `batch15-config` follows the new settings line and the room's `iceServers: ice`.

## §134 Who you are is asked at sign-up; each side has its own bio (owner, Nov 3)

- **Developer, tester or both is required when the account is made**, on the email form and on Google's sign-up step alike (`readNewAccount` in `src/lib/server/passwords.ts`, used by `signUp` and `finishGoogleSignup`). With the name, the Terms and "I'm 18 or older.", every missing part is red at its own field at once (one line each, as §11 of batch 26): "Choose developer, tester or both." at the choice (`RoleChoice`, `src/components/RoleChoice.tsx`, on both pages), "Enter your name", "Agree to the Terms of Use to sign up", "You must be 18 or older to use Playtest." Nothing is made until all of them are given. Email and password mistakes still come first, one at a time.
- **Google's step** (`/signup/google`) asks the same "I am a…" and a Name box above the two ticks. Google gives only the email, and the name used to come from the old Welcome step, which normal accounts no longer see.
- **The sides it makes** (`sidesOf`): developer; tester (with its empty tester profile); both, which lands on the developer side (`side` "developer"), whose Get started asks for a card before posting. The tester side's own gate (a saved tester profile before Join, Apply, an invite's Join and Ask to rejoin) applies once they switch to it, and its Get started asks for the profile.
- **No Welcome step for normal accounts.** The dashboard's "Welcome to Playtest · Tell us who you are" is the admin's setup only (Name and Pronoun, then the admin console, as §16 of batch 20). An account with no side (only an older one) is sent from the dashboard to Profile, which reads "Your profile · Tell us who you are." with the required "I'm here to" choice (ticking tester adds the tester's devices, languages and bio); Continue opens the dashboard.
- **Each side has its own bio** (the owner's change the same day: per side, not shared). Each is optional, up to 2,000 characters (`LIMITS.bio`, was 1,000), with its count under the box ("12 / 2,000").
  - The tester's stays on `TesterProfile.bio`: "Bio (shown to developers)" on the tester profile, shown in About on their tester profile, as before.
  - The developer's is new, `User.devBio` (migration `20261114090000_developer_bio`: the column is added empty for everyone; nothing is copied between the two): "Bio (shown to testers)" on the developer profile, shown in a new About box on their developer profile ("No bio yet." when empty), for testers and admins. Settings' "Developer profile" line reads "Your name and bio, as testers see them".
  - Neither is on a hover card (those keep their ratings, devices and languages lines), as before for the tester's.
- **The name and pronoun are the account's**: saved on either side's profile, both sides show them. A side opened later (Start testing too, Start posting tests too, or the first switch after signing up as both) shows them already filled in on its profile, with its own fields (bio, and the tester's devices and languages) empty. Nothing asks for them a second time.
- **A Save changes only its own side.** The profile form sends its side (`side`), and `saveProfile` saves the name and pronoun with that side's own fields only: the developer's bio, or the tester's devices, languages and bio. So the developer side's Save of an account with both sides no longer asks for the tester's devices ("Pick at least one device you play on." blocked it until the tester profile was filled) and never saves the tester's fields again from that page. Without `side` (an older page), the side in use decides, and the developer's bio is left as it is.
  - Changed in another tab or device: each change to a side's own field records its side, and the other side's don't stop this side's Save (`accountChangesSince`'s `side`). The name, pronoun and sides stop both, as before. Each side's page reads its own bio's change as "Bio: … → …" ("Bio changed" when long).
- **Deleting an account clears both bios** (the Privacy page: "Deleting an account removes your profile and content"); the profile then reads "No bio yet." Before, the tester's bio stayed.
- **Live:** an open developer profile redraws when their bio changes (`publicProfileV` includes `devBio`; the tester's was already in its profile row).
- **Tests:** `tests/batch35-signup-bio.test.ts` covers the email sign-up refused without a role (and with every part missing at once), the page's choice red for its line; each role's sides, both landing on the developer side (its Get started) and the tester side's gate after the switch (Get started, Join refused with "Save your tester profile first…"); Google's step refused without a role or a name, its page with the choice and the Name box, then made with its sides (both on the developer side); an older account with no side sent to Profile, where the side is required, and the admin's own setup; a developer adding the tester side (name and pronoun shown, its bio and fields empty, a pronoun changed there shown on the developer side, the two bios apart) and a tester adding the developer side; both bios cut at 2,000 with "x / 2,000"; the developer-side Save without the tester's devices, and another tab's changes stopping only their own side; each profile showing only its side's bio (testers, developers and admins), the live redraw and "No bio yet."; deletion clearing both; the migration (the column empty for everyone, nothing copied, the tester's bio where it was). The suites that signed up without a role now give one and a name (auth, batch15-signin, sides, batch20, batch26: Google's step refusals list the role and name lines first).


## §136 Sent work is locked: only added to (owner, Nov 3)

Once a part (written answers, a recording) has been sent, what was sent can't be removed or replaced. The tester can only ADD.

Replaces: batch 13 §7 ("until the developer pays, the tester can still remove or add recordings and send again") and §8 ("sending sends the current set and
replaces the sent version"); batch 20 §26 ("Send my updated answers / recording" waiting until something changed: there is no update to send any more);
batch 30 §2 ("a paid part can be sent again: an updated version") becomes adding to a paid part; batch 35 §77 (a re-sent file counted by content) is moot; the
design doc's "Recordings can be removed or added and sent again. Written answers … replace the sent version" and the recording row's Remove on sent ones.

- **Written answers.** After Send, the answers show read-only (the same list the developer reads). "Add more" opens one box (Bold, Italic, Code block, 📎 files)
  and "Add to my answers" sends it: the text, with any files placed in it, is added under what was sent. A box with nothing in it can't be sent ("Write something
  or attach a file to add."). The 50,000 characters count everything. What's typed is kept as a draft (`add:<session>`, "Draft" + "Discard" after a sign-in),
  editable until it's sent.
  - An older page's "Send my updated answers" is refused: "Your answers were already sent, so they can't be changed. Use Add more to add to them." (409).
  - A file sent with the answers is never deleted (the server keeps it whatever an older page asks); a file not sent yet can still be removed.
  - **Changed questions** (the tester switched to new terms whose questions changed): the form for the new questions shows ("Send my answers to the new
    questions"), and the answers are ADDED under what was sent, as one more block, never a separate "previous set". The piece is still priced at the current
    written price while unpaid (batch 13 §8). Add more waits until then: "Your questions changed: send your answers to the new questions, and they're added
    under what you sent."
- **Recordings.** Sent recordings have no Remove (an older page's Remove: "Recordings you sent can't be removed. You can add more."). "Add more" opens the
  upload / record tools; new ones show "not sent yet" with Remove, and "Add my recording(s)" adds them under the sent ones. Within the 5: with all 5 sent, the
  6th reads "You've sent 5 recordings, the most this part takes." Nothing new: "Upload or record a recording to add first."
- **One list per part, "Added".** Everywhere sent work is read (Needs you, the update row, the tester row, the admin's "See the work", the tester's own page),
  a part is one list: what was sent first, then each addition under a small "Added" label (no time). The part's header line carries the time: "updated <time
  of the latest addition>" in Needs you, "Updated <date>" on the tester row and the tester's part line. No old-and-new pair anywhere: the tester's
  "Previous questions and answers" keeps only unsent drafts (what was sent shows once, in the list).
- **The same windows as Send:** never after the tester's work ends (an older page's Add: "…, so your Add didn't go through."), never while the test is paused
  (the box and its draft stay, the button is hidden: "What you add is kept as a draft. Adding comes back when the test resumes."), not while an offer of new
  terms is open, and the same stop-once.
- **Telling the developer, as a send does:** the live line "Ana added to her written answers" / "Ana added a recording" ("added 2 recordings"), the bell and email
  "Ana added to her written answers for “Harbor Run”", and their Needs you shows it on the next poll (the panel keeps its height, scroll and folds). The
  tester's own line in another tab: "You added to your written answers".
- **Payments and reviews already made don't change.** Before a Pay, the piece's review clock and late rule work as an update's did (batch 30 §3: added after the
  deadline, the piece is late). After a Pay, the addition gets batch 30 §2's Needs you row with Pay more: "Ana added to this after you paid ($5.00 paid · up to
  $995.00 more)"; at the cap a quiet line "… (already paid the most)". The tester's line above Add: "Nora Lane has paid $10.00 for this. What you add can be
  paid more, up to $1,000.00 in all."
- **Storage:** `Submission.additions` (JSON, oldest first: `{ at, text?, items?, notes?, files }`), migration `20261115090000_sent_locked`; recordings an
  earlier page had marked for removal at the next send stay with their piece. `src/lib/additions.ts`, `src/components/SentWork.tsx`.
- **Tests:** `tests/batch35-sent-locked.test.ts`.

## §137 Names in sentences link, through Cut (owner, Nov 3)

Replaces the Nov 3 cut rule's "sentences about a person stay whole" (docs/media/long-text/README.md): a person's or a test's name inside a sentence is now cut
like a listed name and links to their profile or to the test.

- **One helper:** `NameLink` in `src/components/Cut.tsx`: `<a href><Cut/></a>` (the hover / title, the tap pop-up with "Open profile →" / "Open test →" and
  Copy). With no profile to link (a deleted account) it's the cut name alone.
- **Where:**
  - the developer dashboard's Excerpt requests ("fbbb would like to show this from “<test>” on their profile": the tester → their profile, the test → the test)
    and Disputes ("… disputed what you paid for … on “<test>”");
  - the dashboard's Needs you rows (who → profile, the test → the test). Each row was one big link; its link now lies over the card (as Messages rows, §124), so
    the names' own links sit above it and the rest of the row still opens the item;
  - the test page's Needs you: excerpt requests, disputes, call requests (the row still jumps to the request);
  - the tester rows' sentences: "<name>: 1.0 ★ (1 rating)", "<name> rated you …", "You rated <name> …", "You blocked <name>. …", "On <name>'s profile …";
  - the tester's invitations ("<dev> invited you to “<test>”": the developer's profile and the test's page; the card no longer is one link);
  - the session page's lines naming the developer ("You rated …", "… rated you", "if <dev> changes these terms later", "it follows <dev>'s changes",
    "<dev> offered new terms", "Your excerpt request is waiting for <dev>").
- **Unchanged:** server-built plain text (bells, emails, the live box's and stop boxes' lines, which come from the server as text); buttons that carry a name
  ("Charge <dev> $X", "Chat with <name>": a link can't sit inside a button); rows that are one link to their item (History, To do, Find cards), where the name is
  already cut with its hover.
- **Tests:** `tests/batch35-name-links.test.ts`; `long-text-cut` follows the dashboard row. **Pictures:** `docs/media/sent-locked/names-*`.

## §138 Text boxes stop growing at 60% of the screen (owner, Nov 3)

- Every text box that can be dragged taller (written answers and Add more, the steps, questions, notes, reasons, the bio, chat…) stops at
  `min(60vh, 32rem)`; past that its text scrolls inside it. One rule in `src/app/globals.css` (`textarea { max-height: …; overflow-y: auto; }`), after the
  utilities, so no box's own classes lift it. Nothing changed before this: a box could be dragged as tall as the page.
- Checked in Chrome: a box dragged to 3,000 px stays 512 px (32rem) on a 900 px desktop and 506 px (60vh) on an 844 px phone, scrolling inside.
- **Tests:** `tests/batch35-textarea-cap.test.ts` (the rule, its place after the utilities, no box opting out). **Pictures:** `docs/media/sent-locked/textarea-cap-*`.

## §139 Sent work in small panels, with folds for the body and Pay (owner, Nov 3)

Replaces batch 10's 16-line scroll box (`AnswersBox`, `max-h-[20rem]`) for the developer's view of sent work on the test page. (The admin's "See the work" keeps it.)

- **Where:** a piece in Needs you (written answers, a recording), an update row in Needs you (sent after the piece was paid), and a paid part on the tester's row (Testers joined).
- **Two folds under each part, each with its own toggle, both open at first:**
  - the body ("Their written answers" / "Their recording"): the answers, notes, files and recordings, in a panel;
  - the Pay box ("Pay" in Needs you, "Pay more" on an update row and on a paid part; a call's Pay box in Needs you and its Pay more under the tester's Calls fold too).
  - Opened or closed, a fold stays that way while the page redraws (live refresh), and in the tab's sessionStorage (`fold:<id>`, wrapped in try/catch).
  - A link straight to a part (a bell or email link to `#piece-…`, `#update-…`, `#part-…`) opens the folds it lands in and the folds under it (`jumpTo` in `src/lib/markJump.ts`).
- **The panel** (`ResizeBox` in `src/components/Panel.tsx`):
  - starts small: at most `min(12rem, 40vh)` (6–8 lines, never more than 40% of a phone's screen), so the Pay / Pay more box under a long written answer is in view without dragging; a shorter piece is only as tall as it is;
  - a grip at its bottom-right corner drags it taller or shorter: at least 5rem (about 3 lines), at most 60% of the screen; the grip is also a keyboard control (arrow keys, Home / End);
  - the content scrolls inside at any height;
  - a dragged height stays while the page redraws, and in the tab's sessionStorage (`panel-h:<id>`).
  - A custom grip rather than CSS `resize`, so the panel can always be dragged shorter than where it starts and stays within its limits.
- **Tests:** `tests/batch35-sent-panels.test.ts` (the small default, dragging below it, the limits, the kept height and fold state with storage blocked too, both folds in each place with the body in the panel and the Pay box after it, a link opening the folds). `batch10`'s scroll-box check now looks for the panel.
- **Pictures:** `docs/media/sent-locked/panel-*` (README there).

## §140 The tester list and Needs you fold (owner, Nov 3)

- **The circles filter the list.** On the test page's Testers card, each tester's circle is now a button (`aria-pressed`): pressing it shows only that tester's
  row in the list below (the circle is ringed, "All testers" appears); pressing it again or "All testers" shows everyone. It works with the name search and
  stays through the live redraws (sessionStorage). The circle's hover card keeps "See their profile" and "Chat with …" (the circle used to open the profile).
- **Each tester folds by their name.** Closed: the name (with the status and NDA badges), then the summary block, always shown: Chat, "See their profile",
  "Paid in all: … · Calls: …", the rating line, "… rated you", "You rated …" and the Rate box. Open: their contract line and all their parts (written answers,
  recording, calls with their Pay more, waiting bank checks, earlier question sets, excerpts), each part's body and Pay more in the folds and panels of §139.
  Closed at first when the test has more than one tester (open with one); open or closed stays through the live redraws (sessionStorage). A link into a closed
  tester (`#part-…`, `#call-…`, a bell link) opens it first (HashJump opens the folds around its target).
- **Each Needs you request is its own fold.** A piece: its line, then its body fold and its Pay fold (§139). An excerpt request and a dispute: the one-line
  summary as the toggle, the full content (the question, the quote, the NDA note, what it replaces; the tester's reason) in a panel, and the buttons (Allow /
  Deny; the developer's side) under the fold, so they work when it's closed. An application: its details (tag, devices, note) in a fold above Accept / Decline.
  Call requests and bank checks are already one line with their button.
- The update row's line under Pay more reads "…or $0 to close this row".
- **Tests:** `tests/batch35-tester-folds.test.ts` (the filter, the closed and open tester, buttons outside the folds, a hash opening a closed tester); `long-text-cut`
  follows the new heading. **Pictures:** `docs/media/sent-locked/e-*`.


## §142 Typing stops at every box's limit (was numbered §140 on its branch) (owner, Nov 3)

"Lock all things in text boxes when you go over the character limit, like the limit for each key (still allowing to go to the next line when it hits the limit)."

- **Every text box with a limit stops taking characters at it**, typing and pasting alike. Most use the browser's own `maxLength`: it counts JS string length (UTF-16 units), exactly as the counters (`CharacterCount`: `value.length`) and the server (`readText`, `str`, `.length`) count, so the three always agree. Nothing counts code points; an emoji counts 2, as before.
- **A saved value already longer than its limit is never cut** (an older 1,000+ character NDA, a long older key or question): it loads whole, nothing more can be added, deleting works. Once it's under the limit it fills up to the limit again.
- **A paste longer than the room left** is cut at the limit, and a short grey line shows under the box (after its counter) for 4 seconds: "Cut to the 2,000-character limit." One shared place: the paste listener in `FieldChecks` (every `maxLength` box), and `showCutNote` in `src/lib/typingLimit.ts` (the boxes with their own limiter, below).
- **Counters** keep showing x / max. Since typing can't go past a limit, their red "over" state now appears only for older data. The server's checks and refusals are unchanged (defence in depth); What to do's `str(…, LIMITS.whatToDo + 5000)` still keeps over-limit text so the server's own line can say so.
- **Spaces around a value:** the server trims before it checks (`readText`), the box counts what is typed, so a box is at most a few spaces stricter than the server, never looser. Keys and questions are counted trimmed, as the server counts them (below).

### The boxes

| Where | Box | Limit | How |
|---|---|---|---|
| Post / Edit a test (and a draft's Post) | Product | 60 | maxLength |
| | Name of this test | 60 | maxLength |
| | What should testers do? | 20,000 | maxLength |
| | Link to the product or build | 2,048 | maxLength |
| | Why is this test mature? | 500 | maxLength |
| | Your questions (one per line) | 20,000 per question, 20 questions | per-line limiter (`QUESTION_RULE`) + `capQuestions` |
| | NDA | 1,000 | maxLength (**new**; an older, longer NDA stays) |
| | Access keys (Post, one per line) | 200 per key | per-line limiter (`KEY_RULE`) (**new**) |
| | Free keys (Edit, one per line) | 200 per key | per-line limiter (`KEY_RULE`) (**new**) |
| Written answers | Each answer and "Anything else" | 50,000 for all of them together, file markers not counted | whole-box limiter (`answerRule`) (**new**) |
| Session | Dispute the pay | 2,000 | maxLength |
| | Rate: a note | 500 | maxLength |
| | Report a problem with a recording | 1,000 | maxLength |
| | Cancel a call: Why | 300 | maxLength |
| Test page (developer) | Pay / Pay more: Note | 1,000 | maxLength (**new**) |
| | Add your side (dispute) | 2,000 | maxLength (**new**) |
| | End early: Why / Stop the test: Why | 10,000 | maxLength (**new**, `WhyBox`) |
| Join a test | A note to the developer (Apply, Ask to rejoin) | 1,000 | maxLength + a counter (**new**; `LIMITS.joinNote`, the server cut there before) |
| Messages | Chat message | 4,000 | maxLength (**new**) |
| Profiles | Report a person | 2,000 | maxLength (**new**) |
| | Name | 80 | maxLength (**new**) |
| | Bio (each side) | 2,000 | maxLength |
| | Excerpt text | 500 | maxLength |
| Account | Sign-up name (email and Google) | 80 | maxLength (`CountedInput`) |
| | Email (sign-up, sign-in, forgot) | 254 | maxLength (`CountedInput`) |
| | New password (sign-up, reset, change) | 200 | maxLength (**new**: the counter said 200, the box took more) |
| | Contact us | 50,000 | maxLength |
| Search | Find tests | 100 | maxLength |
| | Admin list searches | 200 | maxLength |
| Admin | Suspend / Delete account / Pause / Stop / Decline chargeback: Why | 1,000 | maxLength (**new**) |
| | Dispute decision: Note to both | 1,000 | maxLength (**new**) |
| | Approve (hold lift): Note to the developer | 1,000 | maxLength (**new**) |
| | Team close: Why | 1,000 | maxLength (**new**) |

Not limited (no counter, nothing checked): the page's own name filters (Search by developer, Search your tests, Find testers on Invite, Find a tester by name). Number, money, date and time boxes keep their own rules (`src/lib/numberInput.ts`).

### Boxes limited per line (access keys, questions)

- Each line has its own limit (a key 200, a question 20,000), counted trimmed as the server counts it. When the line the cursor is on is full, further characters on it are ignored, **but Enter still starts a new line**, so the next key or question can be typed. A full line elsewhere never stops another line.
- Typing into the middle of a full line is ignored too; the cursor stays where it was.
- **Pasting several lines:** each line is cut at the limit (the first pasted line joins the line it's pasted into, the last joins the rest of its line). Windows line breaks in the clipboard are plain line breaks in the box. A cut paste shows the grey note ("Cut to the 200-character limit for each key.", "Cut to the 20,000-character limit for each question.").
- A line already over its limit takes nothing more; deleting works, and Enter splits it.
- The questions box still takes no 21st question (`capQuestions`, §12).
- The written answers share 50,000 characters: each box takes what the others leave (counted without the file markers, as the counter and Send count). Bold / italic from the toolbar is held to it too.
- One shared limiter, `limitEdit` / `limitedChange` in `src/lib/typingLimit.ts`: it compares the box before and after the edit (the cursor says where the insertion ended), keeps what fits, puts the box's value back with the cursor at the end of what was kept (so React's redraw never moves it), and shows the note for a cut paste. While an IME is composing nothing is cut (the counter and the server still check). A cut never leaves half an emoji.

## §143 Keys listed under their box (was §141 on its branch); a click goes to its line (owner, Nov 3)

"For access keys show what each one on the line is as you type them, like the questions, and when you click on the keys or questions under the box it can redirect you to the line where it is." Then: "follow the same logic for Edit."

- **One shared list, `LineList`** (`src/components/LineList.tsx`), in the questions' style: one item per filled-in line, live as it's typed, each with its name and count ("Key 2 · 15 / 200", "Question 1 · 18 / 20,000"), red with the server's line when it's over, and "Typed twice" on a key or question typed more than once. Long ones scroll in their own box.
- **Where:** under the questions box (Post and Edit, with each question's Required tick as before), under Post's access keys box, and under Edit's **Free** keys box (only the free keys are in that box, one per line, so the list is those lines). The keys already given to testers stay in their own **In use** list beside it (with each tester's name, "(left)" / "(finished)", "not working"), not clickable: they aren't in the box.
- **A click on an item** (or Enter / Space on it) puts the cursor in the box at the end of that line (nothing is selected, so typing never replaces it), scrolls the box so the line is in view (wrapped lines counted), and the box into the page's view. One helper, `focusLine(textarea, lineIndex)`; `lineRange` finds the line, blank lines and "\r\n" included.
- The keys list replaces the old per-key counter rows (`KeyCounts` now renders the list).

### Tests and pictures

- `tests/batch35-hard-limits.test.ts`: the per-line limiter (blocked at the line's limit, Enter allowed, typing in the middle, pasted lines cut one by one, trimmed counting, an older over-long line kept, no half emoji, the cursor's place, the 21st question), the whole-box limiter (the answers' shared 50,000 without markers, an over-long value only shrinking), `lineRange` / `linesOf` with blank lines and "\r\n", both lists rendered (lines, counts, "Typed twice", Required ticks), a source check that the questions and both key boxes (Post and Edit) use `LineList` and with it `focusLine`, a source scan that every text box in `src` has `maxLength` or the shared limiter (and every counter's max is its box's maxLength), and the paste note in `FieldChecks`.
- Checked in Edge against a separate server and database (port 3471, a throwaway schema): on Post, a key stops at 200 and Enter starts the next; a pasted block is cut line by line with the grey note; Product's paste is cut at 60 with its note; clicking key 2 / question 2 (after a blank line) puts the cursor at the end of that line. On Edit: the Free box holds only the free keys and lists them, a key stops at 200, Enter works, clicking key 1 goes to line 1, In use is its own list (not clickable), a pasted question is cut at 20,000, clicking question 3 goes to line 3; an older 1,500-character NDA loads whole, typing adds nothing, Backspace works.
- **Pictures:** `docs/media/hard-limits/` (`post-keys-list.png`, `post-questions-list.png`, `post-product-cut-note.png`, `edit-keys-lists.png`, `edit-questions-list.png`).

## §144 Find: tick-box filters; Matching my profile ticks your devices and languages (owner, Nov 3)

"Make devices, parts and (add) languages tick based filters instead? And matching my profile auto ticks languages and devices (anything ticked differently with tech + languages will change matching my profile to everything) and ... let the categories stay selectable too (so it's all filters that match tests with all the categories selected? Keeping the All one)."

### The filters (`src/lib/findFilters.ts`, `src/app/app/find/FindFilters.tsx`)

- **Categories:** the chips above the filters tick on and off, several at once; **All** clears them. With several ticked, a test shows only if it has **every** ticked category (AND). Each chip keeps its count (open tests in that category). The chips are links, so they work without JavaScript, and keep the other filters, the sort and the search.
- **Devices:** a tick box for every device the profile and Post / Edit know (`DEVICES`). A test shows if it needs no device or needs **one** of the ticked devices (the same rule as `needsLines`). None ticked = no device filter.
- **Languages (new):** the same with the profile's languages (`LANGUAGES`): a test that needs no language, or one of the ticked ones.
- **Parts:** Written answers / Screen recording / Live call. A test shows if it offers **any** ticked part. None ticked = all.
- **Across the groups: AND.** A test must pass the categories, the devices, the languages and the parts. One pure helper decides: `passesTicks(test, ticks)`.
- The ticks, Sort by and Show are one GET form with **Apply** (works without JavaScript). The address repeats a param per tick: `?category=Game&category=Education&device=Mac&device=iPhone&lang=English&part=written&sort=pay`. Old links with one `category=` or `device=` still work; unknown values are ignored (a device that isn't in the list never filters).
- Every tick is the one pick-list chip (§52, `PICK_CHIP`); the groups wrap on a phone (no sideways scroll).

### Show: Matching my profile / Everything

- **Matching my profile** ticks exactly the profile's devices and languages (and unticks the others). **Everything** clears the device and language ticks. Show never touches the categories or the parts.
- Ticking a device or language so the ticks are no longer exactly the profile's turns Show to **Everything** at once (before Apply); ticking them back to exactly the profile's turns it to **Matching my profile** again (`showFor`). An empty profile never reads "Matching my profile" by itself.
- On the server, `mine=1` means the profile's devices and languages **are** the device and language filter, whatever device / language params the link carries (so an old `?mine=1` link works). Without `mine=1` the ticks in the address are used. "Everything" stays the default.
- A link that changes the ticks (a chip, Clear filters, Show them) starts the form afresh; typing in the search box keeps unapplied ticks.

### Empty states (the profile never hides tests by itself; it only orders them)

- **Dashboard, New tests for you, nothing to show:** "No open tests to join right now. New ones show up here as soon as developers post them." with a **See all tests** link to Find. No mention of devices or languages.
- **Find, nothing open to this account:** "No open tests right now" / "New tests show up here as soon as developers post them."
- **Find, the filters hid them:** "No open tests match your filters" / "N open tests don't match." (singular "1 open test doesn't match.") and **Clear filters** (keeps the search and the sort; Show goes back to Everything).
- **Find, Matching my profile alone hid them** (the categories and parts on their own leave N tests): "No open tests match your profile" / "N open tests need a device or language that isn't on your profile." (singular "1 open test needs …") and **Show them** (Everything, keeping the categories, parts, sort and search). One helper picks the state: `findEmpty(open, ticks, mine)`.
- **A typed search that finds nothing:** unchanged ("No open tests match “…”."). When the search finds tests but the ticks hide them, the filters' or profile's state shows instead (its link keeps the search).
- **Admin's Find:** unchanged (the state tick boxes, "No tests match these ticks"); an admin gets the same category, device, language and part ticks, without Show.

### Tests and pictures

- `tests/find-ticks.test.ts`: the rules (AND for categories, OR within devices / languages / parts, AND across, the profile's ticks equal `needsLines`), the address (repeated params, old single params, unknown values, `mine=1` overriding), Show following the ticks (`showFor`, any order, an empty profile), the form rendered from the address (Show, ticks, parts, hidden search and categories; no Show for an admin), the chips' links and counts, `findEmpty` and its counts, singular / plural lines, and source checks for every empty state and the dashboard's line. `tests/batch17-find.test.ts`, `tests/batch16-oct28.test.ts` and `tests/batch35-reasons-page-load.test.ts` follow the move.
- Checked in a separate server (port 3480, a throwaway schema, `@playtest.test` accounts) at 1280 and 390 wide. **Pictures:** `docs/media/find-ticks/`.

## §145 No daily retries: only a new card retries what's owed (owner, Nov 3)

- **The decision.** During a payment hold, what's owed is no longer retried automatically once a day (it was: once a day, at most 7 tries a hold). "The only one to keep is changing the card": saving a new card still charges what's owed on it at once. This settles the Nov 3 open question about a card that always asks the bank (it got a new 3-day "Confirm with your bank" every day).
- **The one rule, stated wherever the daily retries were:** "What you owe is charged when you press Pay what you owe, or as soon as you save a new card." It shows under the owed box's first line on Payments (payment holds only; a chargeback hold only reserves, so not there) and in the Terms (payments section). The old Payments line ("Last try: … · next try: …" / "No more automatic tries: press Pay what you owe.") and the Terms' "it's retried once a day meanwhile, at most 7 times" are gone. DESIGN-DOC: Payments, Rules (Money: "No daily retries during a payment hold"), the timed jobs, the hold table, the tests list and the decisions follow.
- **Code.** `holds.runDaily` no longer calls `retryOwed` (the loop over held developers is gone). `retryOwed(devId)` is now only the new-card retry, called by `stripe.saveCardFromCheckout` after `owedOnce.newCardChecks` has cancelled every open check at Stripe (one card in play, §117/§125). `HOLD_RETRY_MAX` and `retryStatusLine` are removed from `rules.ts`; `OWED_HOW` holds the rule line. The test-only dev hook loses its `"retry"` action. The `holdRetries` / `holdRetryAt` columns stay in the schema (no migration) and are no longer written by the retry.
- **Kept unchanged:** Pay what you owe (one payment for the total), the 3-day bank checks and their "ran out" line, Cancel this check, cancel-at-Stripe-first on a new card, the chargeback steps (no charge of what's owed on a new card during a chargeback hold), the one bell line "We charged your card $X for what you owed: …" (now only for a new card).
- **Not changed:** the Terms version stays 2 (earlier Terms wording changes didn't bump it either).
- **Tests:** `tests/batch35-one-card-checks.test.ts` §145: the daily job (today and a day later) never charges what's owed; a new card that pays (one charge, hold lifts, one line), declines (one try, still owed, no line) or asks the bank (one 3-day confirm for the total, approved → paid once); a check already open (Pay what you owe's 15-minute check, or a new card's 3-day check) and then a card that pays / asks / declines: the old check is cancelled at Stripe BEFORE the new card is charged. `batch11` (item 4), `batch22`, `batch35-live-stripe` and `batch35-payment-proofs` follow (the daily-limit and next-try checks are retired).

## §146 Race fixes from the Nov 3 recordings (owner, Nov 3)

The race recordings (two presses at the same moment, on a throwaway server) found seven bugs. Each is fixed so exactly one outcome happens:

1. **The team's Decide and the developer's Pay more on the same piece no longer both charge.** Decide now claims the dispute, reads what the piece is paid and writes its line on the test together, under the test's lock (the one Pay more takes). If Pay more came first and is still at the bank, Decide is refused as in §70 ("Decide again once it's confirmed or fails"); if it went through first, the decision charges only what is still due (never more than decided minus what's paid; nothing when it's already paid: "raised the pay to $10.00, which was already paid: nothing more was charged"). A Pay more pressed after the decision stops once naming it ("The team decided Ana Silva's dispute: raised the pay to $10.00 ($6.00 more)"). Nothing is refunded.
2. **Join never goes through on a listing its page didn't show.** Join's "changed since your page loaded" check runs again under the test's lock, so an Edit saved between the first check and the join stops the press once naming the change ("Nora Lane edited the listing"); the second press joins on the current listing.
3. **Pay what you owe never reserves an old amount.** During a chargeback hold, the reservation reads again (under the developer's lock, which the bank's change takes too) what the rows come to; if the bank changed the disputed part meanwhile, nothing is reserved and the press stops once on the new total ("What you owe changed: now $35.00. Press again to reserve $35.00 on your card: …").
4. **An addition made while a Pay is in flight ends as one made after the Pay.** Once the Pay is recorded, an addition saved after its reservation marks the piece "added to this after you paid", so Needs you shows the update row, as §136 does for an addition after a Pay.
5. **The same email signing up in two tabs:** the second tab reads "An account with that email already exists" (not "Something went wrong"). Google's step in two tabs signs both into the one account.
6. **Add names its press when it's refused** like Send: "Your Add didn't go through: Nora Lane stopped the test on Nov 3, …" (the recording part's Add too).
7. **Dismiss all names itself:** a suspended tester's refused Dismiss all reads "Your Dismiss all didn't go through" (no single test); Dismiss reads "Your Dismiss on Harbor Run didn't go through", Add "Your Add on Harbor Run didn't go through" (both read "Save" before).

Tests: `tests/races-nov3.test.ts` (each race fired at once, or with the second press landing while the first is at the bank; each failed before its fix).

## §150 Pay what you owe over $200 needs the tick (owner, Nov 3)

Owner: "Tick for when Pay what you owe is over $200 (and stop for when it does, with the tick appearing)."

- **The tick.** Like Pay and Pay more, when the amount on Pay what you owe is over $200 the tick "I confirm this payment is over $200." shows next to the button and the button stays disabled until it's ticked. The same for a chargeback hold's reserve press (same button); not once a reservation is in place (the button is disabled anyway). The box is the one on Payments and on the test page (the restricted dashboard only links to Payments).
- **Live redraws.** The tick stays ticked while the amount stays over $200 (it confirms an amount over $200, not a particular amount); it clears when the amount drops to $200 or less.
- **The server** refuses a press without `over200: true` when what it would pay or reserve is over $200: the press stops once, nothing is charged, message "Tick “I confirm this payment is over $200.” to pay." (Pay's words), stop line "Tick “I confirm this payment is over $200.” and press again to pay $230.00." (an older page that never showed the tick gets the same).
- **The stop.** When the total changed since the page drew and the new total is over $200 while the press didn't carry the tick (the page showed $200 or less), the existing stop-once line ends with the tick: "Added to what you owe meanwhile: … New total $230.00. Tick “I confirm this payment is over $200.” and press again to pay $230.00." (during a chargeback hold: "… and press again to reserve $230.00 on your card: …"). The box redraws with the new amount and the tick showing, unticked; the stop box's last line reads "Tick “I confirm this payment is over $200.” and press again to go ahead." The second press needs the tick. A page that was already ticked gets the ordinary "Press again to pay $X." line.
- **A tester's Charge that came in after the page drew** is still left out of the press (Nov 2 rule: it never stops it, and is charged right after the lift), so it never counts toward the $200: the tick depends only on what the press actually pays.
- **Not covered:** the rare race where a chargeback hold's reservation re-reads the rows and the bank changed the disputed part meanwhile (§146 item 3) still stops with "Press again to reserve $X"; if that new total is over $200 without the tick, the next press stops once more naming the tick.
- **Code.** `rules.pressAgainLine(cents, chargeback, tick)` (the tick's wording), `rules.OWED_OVER_TICK`; `holds.payOwed` checks `total > PAY_TICK_CENTS && body.over200 !== true` after leaving out a late tester's Charge; `components/OwedBox.tsx` shows the tick, disables the button and sends `over200`.
- **Tests:** `tests/owed-over200.test.ts`: $200.00 needs no tick; $230 refused without the tick (nothing charged), paid with it; the total crossing $200 since the page drew stops once naming the tick, the press again without the tick is refused, with it pays $230 once; an already-ticked page gets the plain line; a late tester's Charge doesn't count; a chargeback hold's reservation the same (direct and crossing); the box renders the tick and the disabled button over $200, none at $200.00 or once reserved. `batch16-chargeback-order`, `batch17-bank-check`, `batch28` (the button's source) and `partial-dispute` (its $444.67 press now carries the tick) follow.

## §151 A deleted developer's charges never wait for a hold (owner, Nov 3)
A deleted account's payment hold (or suspension) can never lift, so nothing waits for it: a tester's Charge and the team's dispute decision are charged to the deleted
developer's saved card at once, hold or not (deferIfHeld never defers for a deleted developer), as a listed call's automatic charge already was. Charges already
waiting for the lift when they delete are made at the delete, as one payment (chargeDeferred; the daily drain also picks up deleted accounts). Declined, or a bank
check nobody can approve running out after 3 days: no hold (there's no account), the payment stays delayed for the tester and is listed for the admins. Repayments of
reversed payments (chargebacks) still wait.

## §153 Devices and languages at sign-up for testers (owner, Nov 3)

Owner: ask testers for their devices and languages at sign-up, and drop the tester's "Save your profile (needed to join a test)" step from the dashboard's Get started.

- **The sign-up form and Google's step** (`RoleChoice`, `src/components/RoleChoice.tsx`, on both pages): choosing **Tester** or **Both** shows the tester's
  **Devices you use** and **Languages you can test in** right under "I am a…", the profile's own lists (`DEVICES`, `LANGUAGES`, the ones Post / Edit and Find
  use) as the same tick pills (`Choices`, `PICK_CHIP`), both required. **Developer** shows neither (and sends neither). The ticks stay while the choice
  changes back and forth; under the pickers: "You can change these on your profile any time." On a phone the pills wrap (no sideways scroll).
- **Required: at least one device and one language**, with the profile's own lines, red at each picker: "Pick at least one device you play on." and "Pick at
  least one language you can test in." (`DEVICES_MISSING` / `LANGUAGES_MISSING` in `src/lib/options.ts`, now also used by `saveProfile`). As §134, every
  missing part is red at once, in the form's order: the choice, devices, languages, name, Terms, 18 or older (with no choice made the pickers aren't shown, so
  only the choice is asked for). Only known values count (`pickFrom`); anything sent for a developer is ignored. Email and password mistakes still come first.
  - **All at once on the first press.** Before, an empty Name (checked in the browser) stopped the press before the server saw it, so only Name went red
    and the choice, Terms and age lines came a press later. Both sign-up pages now send the press even while a box is red there (`AuthForm allAtOnce`, the
    form's `data-red-and-blue`, as Edit's Save), so Continue with nothing ticked shows every line at once. Nothing is made while any is missing.
- **Saved when the account is made** (`readNewAccount` returns them; `sidesOf(role, { devices, languages })` creates the tester profile with them), on the email
  form (`signUp`) and on Google's step (`finishGoogleSignup`) alike. So a new tester's (or both's) profile is saved at once (`profileSaved` is true): Join,
  Apply and an invite's Join go through without visiting Profile. The bio stays on the profile (optional, as §134). No migration (the profile row already had
  the columns). The form sends every tick as a list: `AuthForm` reads a `data-list` group with `FormData.getAll` (none ticked: an empty list).
- **Get started** (dashboard, tester side): "Save your profile (needed to join a test)" shows **only while the tester profile isn't saved**, and goes once it
  is (it no longer stays as a ticked line). "Set up payouts (to receive your pay)" is kept. A new tester never sees the profile step. It still shows, with the
  Join gate ("Save your tester profile first: …"), for an account whose profile was never saved: an older tester account from before this change, and a
  developer who adds the tester side with Start testing too (its tester profile starts empty, and the profile page asks for devices and languages before Join,
  as before). Decided this way because one rule (saved or not) covers both without telling new and old accounts apart.
- Replaces §134's "a tester side gets its profile row, empty" and "both … the tester side's own gate … applies once they switch to it": both's tester side is
  saved at sign-up, so after the switch it joins at once.
- **Tests:** `tests/batch35-signup-devices.test.ts`: tester and both refused without a device or a language (each line, all missing at once in order, unknown
  values not counted, nothing made), the ticks saved (`profileSaved` at once), Join without visiting Profile, no profile step in Get started (payouts kept);
  developer-only unaffected (nothing asked, anything sent ignored, no tester profile); Google's step the same; an old tester with an empty profile keeps the
  step and the gate until Profile is saved (then the step goes and Join works); a developer adding the tester side keeps them; the pickers' source (shown for
  tester or both only, the profile's lists and red-line matches, sent as lists). `batch35-signup-bio` (its both / tester sign-ups now tick a device and a
  language; the gate after the switch moved to an older account), `auth`, `batch15-signin`, `batch18-terms`, `batch20`, `batch26`, `races-nov3` and `sides`
  give a device and a language where they sign up as a tester or both.
- **Pictures:** desktop 1280 and phone 390 of the sign-up form for Developer, Tester and Both, the all-red state, filled in, Google's step for Tester, and a new
  tester's Get started; a short video of a tester signing up through to Find tests (sent with the change).

## §147 Confirm all: one payment, one bank check (owner, Nov 3)

- **Where.** "Confirm all (3) · $42.00" sits at the top of the dashboard's "Your bank wants you to confirm" box and of Payments' confirm list whenever 2 or more charges made while the developer was away wait for "Confirm with your bank" (a tester's Charge, an automatic call charge, a team decision, on any tests and testers). It confirms them all as ONE payment, so the bank asks ONCE.
- **Left out.** A renewal keeps its own Confirm (Stripe ties its check to its invoice), and so do Pay what you owe's own one payment and a repaid chargeback (each is confirmed on its own, as before). They're not in the total; a small line under the button says so: "Your plan's renewal $9.00 isn't in Confirm all: confirm it on its own."
- **The press.**
  - It stops once, like Pay what you owe, when what's waiting or the total differs from what the page showed. Each change is named ("Also waiting for your bank now: Ben Okafor's written answers on “Sky Lab” $12.00", "Ana Silva's written answers on “Harbor Run” $10.00: confirmed meanwhile", then "Confirm all now covers 3 payments: $42.00."); the second press goes ahead on what's waiting now.
  - Every charge is claimed at once under the developer's row lock (its own check unclaimed), so a single Confirm, an old tab's Confirm ("This payment is in your Confirm all, waiting for your bank: finish that check, or cancel it.") or a second Confirm all ("Your Confirm all is already waiting for your bank: finish that check, or cancel it.") can't run on it meanwhile.
  - Each charge's own check is then cancelled at Stripe FIRST (§117 rule 4). One Stripe says already went through is recorded as paid on its own (its own receipt) and left out of the total ("Already confirmed with your bank, so recorded as paid: …"). One whose answer is unclear keeps its own check and is left out.
  - ONE PaymentIntent is made for the rest, on the current card, at the press (on-session). Its Stripe description lists them: "Playtest: Confirm all (Ana Silva's written answers on “Harbor Run” $10.00, …)". The bank's check opens inline under the button, like Pay what you owe's.
- **Over $200: the tick (owner, Nov 3).** "Tick for confirms over $200, including individual and Confirm all." Every "Confirm with your bank" on a charge made while away (the dashboard box, Payments' list for a renewal, the test page's Needs you and the marked piece) and Confirm all show the existing tick "I confirm this payment is over $200." (as Pay's) when the amount it would confirm is over $200; the button stays off until it's ticked, and the server refuses a press without it ("Tick “I confirm this payment is over $200.” to pay."). A press's own check (a Pay or Pay more waiting for the bank) was ticked on that press and asks nothing more. When Confirm all's total crosses $200 since the page drew, its stop-once ends "Confirm all now covers 3 payments: $210.00. Tick “I confirm this payment is over $200.” and press again to go ahead." and the tick appears under the button; the press after it needs the tick. (Pay what you owe's own tick is built separately.)
- **Approved.** Every covered charge is paid once by it. Each tester's share is sent from that one charge (`source_transaction`), as for Pay what you owe's one payment, and each tester gets their usual "Nora Lane paid $10.00 for your written answers" (no hold words). ONE receipt names every item: "We charged your card $42.00 for: Ana Silva's written answers on “Harbor Run” $10.00, Ben Okafor's written answers on “Sky Lab” $12.00, Ana Silva's written answers on “Sky Lab” $20.00." Each sent part is answered on its test as a single Confirm answers it.
- **Its deadline** is the EARLIEST of the covered charges' own dates (when that comes before a press check's 15 minutes). Run out there: every covered charge counts as not confirmed, exactly as if each had run out on its own (cancelled at Stripe first; the first one declined starts a payment hold, and the rest then wait for the lift, §113).
- **Refused, declined, cancelled or left.** The bank refuses it, the card is declined at the one payment, "Cancel this check" is pressed, or the inline check is left for 15 minutes: nothing is charged and each charge goes back to its own "Confirm with your bank" with its ORIGINAL date. Each gets a new off-session PaymentIntent, made the way a charge made while away is (`awayAction`'s way): the bank asks → its own Confirm again; it goes through at once → paid; declined outright → the usual decline rules (a payment hold, or added to it; during a hold the rest wait for the lift). A date already past counts as not confirmed. The line: "Your bank didn't confirm the payment, so nothing was charged. Each payment is back to its own Confirm with your bank." They show again as new confirms in the dashboard box, Payments and their test pages, and the one bell line "Your bank wants you to confirm 3 payments ($32.00 in all): …" is sent again (the day's line updated in place, unread).
  - A new card saved while the one check is open cancels it at Stripe (one card in play); the charges wait and are made together on the new card (§122), as other waiting checks are.
  - A Stripe error (or no card) while putting one back leaves it waiting under the cancelled check; the clock tries again (its own date still counts).
- **While it's open**, the box (and Payments) show "Confirm all: $42.00 for 3 payments is waiting for your bank." with "Cancel this check" (another tab, or one left open). In the dashboard box it counts as a row, so the box's number and its live poll follow it. Testers keep reading "Payment may be delayed" and the pieces stay locked, as for any check.
- **A bank dispute on it.** The one payment is a Pay what you owe-style one payment (kind `owed`, note `press:all`, `bundled` once paid), so §117/§133 apply unchanged: its WHOLE amount is owed once plus ONE $15 fee, on one chargeback hold; the items it paid stay paid. The reversed line lists every item it covered ("That payment covered: …"), for a whole reversal too (a partial one already did).
- **No migration.** It reuses `Payment.coveredById` and the one payment's kind. The covered charges keep their own `actionBy` (their original dates) while their `actionPi` is cleared.
- **Code.** `src/lib/server/confirmAll.ts` (state, press, claim, put-back, clocks), `src/app/api/payments/confirm-all/route.ts` (the press and `cancel`), `src/components/ConfirmAll.tsx`, `src/lib/confirmAllText.ts` (the words). `owedOnce.ts`: `releaseOwed`, `settleOwed`, `resumeStaleOwed`, `newCardChecks` and `owedLocks` know Confirm all's one payment; `confirm.ts`: `finish` sends its one receipt, a covered charge's own Confirm is refused plainly, the clocks run it (`notConfirmed` is the shared "not confirmed by its date" rule).
- **Proof:** Stripe test-mode recordings (`scripts/confirm-all/run.cjs`, port 3460, the app beside a viewer of Stripe's side): approved, declined (card 3178), a full and a partial dispute on it, left open past the earliest date, and the button on the box and Payments (desktop and phone).
- **Tests:** `tests/confirm-all.test.ts`: one PaymentIntent for three items across two testers and two tests, old checks cancelled first; one already approved recorded as paid and left out; approved → all paid once, three transfers from the one charge, one receipt, each tester's paid line; refused, cancelled and left → each back with a new check and its original date; declined at the press (back) and declined everywhere (the usual decline); ran out at the earliest date; a single Confirm at the same moment (one charge per item); two Confirm all at once (one payment, and an old tab's own Confirm refused); the stop-once; a renewal left out; a dispute on it (whole amount once + one fee, each item listed). The over-$200 tick: a single Confirm at $200 and over $200 (refused without it), and Confirm all crossing $200 (the stop line, refused without the tick, then one payment).

## §154 Moved deadlines round up to the end of the day (owner, Nov 3)
Owner: "make testers' deadline and that call thing round up to end of day." A tester's deadline is the end of a day (11:59 PM in the developer's saved zone, where
`dueFromJoin` counts it, §111), but a pause moved it by the pause's exact length, so a 7 h 23 min pause turned "Thu, Nov 5, 11:59 PM" into "Fri, Nov 6, 7:22 AM", and
the call form's limit read "Pick a time before Fri, Nov 6, 7:22 AM (when testers' work on this test ends)."

- **Every move of a working tester's deadline now lands on 11:59 PM of the day it moves to, rounded UP, never down** (`rules.dayEndAtOrAfter`, in the developer's
  zone like `dueFromJoin`; unknown zone: UTC):
  - **a pause lifted** (a payment hold paid off, a suspension lifted, the team's pause lifted: `holds.shiftAfterPause`): the deadline + the pause's length
    (`pauseShiftMs`, unchanged), then up to that day's end (`rules.movedDue`). 11:59 PM + 7 h 23 min = Fri 7:22 AM → **Fri, Nov 6, 11:59 PM**. A pause of exactly
    whole days keeps 11:59 PM, whole days later. Only deadlines that hadn't passed when the pause started move (as before); one that passed during it comes back the
    same way.
  - **an outage** (recorded, or approved: "move every timer", `outages.applyOutage`): the same, per tester in their test's developer's zone (it was a raw SQL
    shift).
  - **a rejoin** (`tests.rejoinDue`): now + the time left when they left, up to that day's end. A deadline that had passed when they left stays passed (exactly as
    before). The developer's "asks to rejoin" line names the same deadline (`joining.rejoinAskLine`, with the developer's zone).
  - **Edit moving Open until later by D days** (batch 15 §18): D calendar days in the developer's zone, at 11:59 PM (`rules.dueAfterDays`; it was D × 24 hours in
    SQL, which read 10:59 PM after the clock change on Nov 1). An older odd deadline lands on 11:59 PM too.
- **Open until** keeps the owner's Nov 2 rule for pauses: the nearest end of a day in the developer's zone (2 days and 1 minute move "Nov 1, 11:59 PM" to
  "Nov 3, 11:59 PM", never "Nov 4"); now one helper (`rules.nearestDayEnd`), and outages use it too (an outage used to leave it at an odd time).
- **The call window follows**: its end (`workDeadlineOf`, the latest deadline, no earlier than Open until) is always an end of a day, so the form's red line and the
  server's refusal read "Pick a time before Fri, Nov 6, 11:59 PM (when testers' work on this test ends).", and the repeat counts ("2 days (to Nov 5)", "3 days (to
  Nov 6)") fit that end. Charge opening, close-out, the developer's last day to pay and reminders read the stored deadline, so they follow without a second shift
  (review clocks still move by the pause's exact length, as before).
- **Existing odd deadlines** (moved before this): nothing has launched, so no migration. `scripts/round-deadlines-eod.ts` rounds working, not-yet-passed deadlines
  up to their day's end on a local database (dry run by default; `--apply` writes; it refuses a non-localhost DATABASE_URL). Legacy tests without Open until
  (deadline = joining + N × 24 h) are left as they are, as is Switch's `newDueAt` for them.
- **Tests:** `tests/batch35-deadline-eod.test.ts`: 7 h 23 min turns 11:59 PM into 11:59 PM the next day (not 7:22 AM), through a pause lift, an outage and the
  helpers; a whole-day pause and Edit's +2 days keep 11:59 PM (also across the clock change); a far zone (Tokyo) rounds in that zone; a rejoin lands on 11:59 PM and
  a passed one stays passed; the call window's end and both sides' refusal read 11:59 PM; the repeat counts fit the new end. `batch16-open-until` (deadlines
  after a pause land on 11:59 PM) follows.
