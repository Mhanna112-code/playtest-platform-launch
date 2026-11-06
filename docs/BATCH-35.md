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
  "<name> asks to rejoin"); Pay, Pay more and Confirm with your bank on written answers or a recording ("sent their …" / "updated their …" on that contract, for that piece: Pay on the written answers still stops for a recording just sent) (**narrowed by §155, Nov 3:** these payment presses now stop once for their own piece's unseen lines; the rest of §79 stays). Add your
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

## §152 Call lists and payment lists in draggable panels; each part's payments on the developer's test page (owner, Nov 3)
"Do call requests and booked calls have scrolls (with expand) — have the expand for the payment lists we just mentioned too." Every call list and payment list now
sits in the §139 panel (`ResizeBox`): the content scrolls inside, the grip at the bottom-right corner (finger-sized on touch screens; arrow keys too) drags it shorter
(about 3 lines) or taller (60% of the screen), and the dragged height is kept by the panel's id through live redraws and reloads (this tab).
- **Lists and ids:** Call requests (developer's test page `call-requests-<testId>`, tester's session page `call-requests-<sessionId>`); the developer's booked calls
  per tester (`booked-<contractId>`) inside the testers' calls list (`testers-calls-<testId>`); the paused / restricted view's booked calls
  (`booked-restricted-<testId>`); the developer dashboard's Calls (`dash-calls`) and the tester dashboard's Upcoming calls (`dash-upcoming-calls`); the tester's
  booked calls (`booked-<sessionId>`); past calls (the developer's "Calls (N)" `past-calls-<contractId>`, the tester's Call history `past-calls-<sessionId>`); the
  tester's payment lines under a part (`paylines-<pieceId>`); the developer's new per-part payments (`part-pays-<pieceId>`).
- **Heights:** each starts at its old max-height (`LIST_PANEL` in components/ScrollList.tsx: call requests 20rem, booked 10rem, restricted 18rem, dashboards 14rem,
  past calls 27rem / 16rem, payment lines 7rem; the tester's booked calls had no box: 20rem), never past 60% of the screen, so nothing is bigger at first. The testers'
  calls list was already up to 2 screens (`max-h-[200vh]`): it keeps that height and its grip drags up to it (`tallest` 2) rather than snapping it to 60%.
- **Short lists:** a list that is always a list (call requests, booked, dashboards) keeps its panel and grip even when short, as §139's panels do (a short one is only
  as tall as it is: a max-height, not a fixed height). ResizeBox can't know whether the content overflows before the browser lays it out, and hiding the grip after
  would make the box jump. Lists that were plain until long stay so: past calls are a panel past 3 (`PanelWhen`), payment lines past 4.
- **Each part's payments (developer's test page):** under each part where its paid total shows (written answers and recording in the tester rows, each call in
  "Calls (N)", updates and pieces in Needs you): every Pay, Pay more, team decision and automatic call charge on that part, oldest first, as its line in Payments'
  "What you've paid" (`paidRows`, developer side: "Pay more for …", "The team's dispute decision on …", ", charged automatically after 7 days"), then date ·
  amount · status in the developer's existing words: Payments' ("recorded (payments not set up)", "refunded (your bank's chargeback was reversed)", "your bank
  reversed this (chargeback)" / "… $96.00 of this …"), Pay what you owe's ("card declined", "waiting until your tests resume") and Confirm with your bank's
  ("waiting for your bank"). Not listed: a payment still being sent, a cancelled one (nothing charged). Up to 4: a plain list; more: a panel (about 12rem).
  Built by `lib/server/partPayments.ts` from the page's own payments query. Testers never see it (their lines never name holds).
- **By question:** a "Search questions" box above the list (any case, anywhere in the question, "Other notes" included; "No questions match “…”." when none; clearing
  shows all), Open all / Close all, and the list in a panel (`by-question-<testId>`, about 32rem at first: it had no box). Each question is its own fold, closed at first and kept open or closed through
  the live redraws: closed, the question, "required" and "N answers"; open, its answers (the same rows) in their own panel (`by-question-<testId>-<key>`, the key a
  hash of the question's text, so it stays when other questions come and go). Filtering hides the others without closing them.
- **Tests:** `tests/batch35-list-panels.test.ts` (each list's ResizeBox and id, the heights and limits, past calls / payment lines only when long, the status words
  against Payments' page, the per-part list for a Pay + 2 Pay mores + a decision and its panel from a 5th on the rendered test page, By question's search, folds and
  panels). `batch16-lists`, `batch20`, `batch30d-wave1`, `batch35-call-window` follow.

## §148 Saving a card no longer charges what's owed; waiting charges still move to the new card (owner, Nov 3)

- **The decision.** "Just remove retrying on saving at all … So no more retrying at all", then narrowed by the owner: a new card never charges what's OWED (a debt), but the charges made while away that wait for the bank still move to the new card. This replaces §145's "a new card's charge of what's owed" (the last automatic charge of what's owed) and narrows §117 rule 1's cancel-and-retry to waiting charges.
- **What saving a card does now.** It saves the card (Stripe's default card, the expiry, the change log "Card: Visa ending 1111 → Visa ending 4242"), and Payments reads just "Card saved.". One card in play (§117 rule 1, kept): every bank check still open on the old card is cancelled at Stripe first (one that had already gone through is recorded as paid, never charged again):
  - **Pay what you owe's own check** (the 15-minute press check, or an old 3-day one): cancelled; its debts are payable again and are charged only when the developer presses Pay what you owe (on the new card).
  - **The developer's own Pay, Pay more or a call's Pay** (the 15-minute press check): cancelled, never made again: the piece is free and the developer presses again with the new card (`confirm.release`, cancel first). An old tab finishing the old bank page is refused plainly: "This payment was cancelled: nothing was charged." (Confirm's finish used to say "There's nothing to confirm here.").
  - **Charges made while away waiting for "Confirm with your bank"** (a tester's Charge, a listed call's automatic charge, a dispute decision, the one combined payment for charges): cancelled and made again on the new card at once as ONE payment (§122, `chargeDeferred`); during a hold they wait for the lift instead. Goes through: each charge paid once, each tester's share; the bank asks: one new "Confirm with your bank" for the total (3 days); declined: each charge becomes a debt (a payment hold).
  - A chargeback hold's reservation whose bank check is still open is cancelled too (unchanged).
- **Over $200.** The combined payment made on a new card goes through automatically with no tick, whatever its amount: the over-$200 tick is for presses (Pay, Pay more, Pay what you owe, each Confirm and Confirm all). If the bank asks, the resulting Confirm needs the tick.
- **The rule line** (Payments' owed box during a payment hold, and the Terms): "What you owe is charged when you press Pay what you owe." The Terms version stays 2. The bell line "We charged your card $X for what you owed: …" is gone with the charge (`retriedLine` removed).
- **Code.** `stripe.saveCardFromCheckout` no longer calls `holds.retryOwed`, which is removed. `owedOnce.newCardChecks` (also run by the chargeback steps' Verify a card) first cancels the developer's own open press checks (`needs_action` Pay / Pay more / call Pay) through `confirm.release`; the rest is unchanged. `confirm.ts`: a Confirm finish on a press check that was cancelled says "This payment was cancelled: nothing was charged.". Pay what you owe still leaves out anything under an open check (§117 rule 3). No migration.
- **Tests:** `tests/batch35-one-card-checks.test.ts`: saving a card during a hold (a card that pays, asks or declines) charges nothing and leaves everything owed payable, then Pay what you owe charges the total once on the new card; a check already open (Pay what you owe's own, or an old 3-day one) is cancelled at Stripe and nothing is tried, the old tab's Confirm is refused, then the press pays on the new card; the developer's own Pay check open → cancelled at Stripe, nothing charged, the piece payable again, Pay again pays on the new card; one that had already gone through → recorded as paid. Waiting charges on a new card (goes through, the bank asks, declined, already paid) keep their §117/§122 tests. `batch11`, `batch22`, `batch25`, `choice`, `batch35-payment-proofs`, `batch35-live-stripe`, `batch17-bank-check` follow: tests of how an old away payment for what's owed ends (a 3-day check, a lost answer, a stale card) set one up with `legacyAwayOwed` (tests/helpers.ts), since the app no longer makes one; the "We charged your card" line tests are retired.

## §149 Decide when the developer's Pay more went beyond the decision (owner, Nov 3)

- **The decision.** "Keep the admin deciding on the total and it charging this difference and going through on pay more, but should be stopped if pay more is now more than the amount."
- **Kept (§146):** the decision is the piece's TOTAL pay; Decide charges only the difference from what is paid now. After a Pay more since the admin's page loaded: paid now below the decision → the difference is charged ("raised the pay to $10.00 ($3.00 more)"); paid now equal to it → it goes through, nothing charged ("raised the pay to $10.00, which was already paid: nothing more was charged"). The tick the admin gave for the raise the page showed still counts when a Pay more lowered it (it charges less, never more). A Pay more still at the developer's bank: Decide is refused as in §70, unchanged.
- **New: paid now MORE than the decision** (a Pay more since the admin's page loaded): Decide stops once in the admin console's stop style, naming it: "Ana Silva's pay changed since you opened this: the developer paid $8.00 more, now $12.00 paid, more than your $10.00 decision. A decision can only raise the pay: decide $12.00 or more." Nothing is charged and the dispute stays open. The decision box's range line and its minimum move up to what's paid ("$12.00 paid · can raise up to $X more"; the box's own "$12.00-$Y" hint and its red check). The stop also moves the box's page time on, so it stops once: the same $10.00 again is the plain refusal "A decision can only raise pay: at least the $12.00 paid for this piece.", and $12.00 or more goes through. A Pay more landing between Decide's first read and its claim (under the test's lock) gives the same stop, and the claim rolls back.
- **Code.** `payments.decideDispute` (the Pay mores on the piece after the page's `seenAt`; the stop's data carries `minCents`, `maxCents`, `range`, `seenAt`); `rules.decidePayChangedLine`; `admin/DisputeDecision.tsx` keeps the range, min and max in state and draws the range line (moved from `PagedList.tsx`) so a stop can update them.
- **Tests:** `tests/batch35-decide-paid-above.test.ts`: paid < decided (charges the difference), paid == decided (goes through, nothing charged), paid > decided (stops once, nothing charged, dispute open, range moved; then the plain refusal, then $12.00 goes through), the same stop through the admin route, and Decide while a Pay more waits at the bank (§70's refusal). `races-nov3` and `batch35-decide-tick` keep passing.

## §155 Pay, Pay more and Confirm stop once for their own part's unseen changes (owner, Nov 3)

- **The decision.** "Remove the §79 exception for payments and rely on the page-update (pill) rule instead." This **narrows §79**: Pay, Pay more and Confirm with
  your bank on written answers or a recording no longer count as answering that piece's own work lines. Seen on the Nov 3 recordings: Nora pressed Pay on
  Ana's written answers as Ana pressed "Add to my answers"; Pay went through for what was shown and the addition became "added after you paid" (§146 fix 4),
  without the press ever naming it.
- **Now.** A change to THAT piece by the tester that the page hasn't shown yet ("Ana Silva sent their written answers", "Ana Silva updated their recording",
  "Ana Silva added to their written answers") stops the press once, naming it, like any other unseen change, in the same box as the rest. The second press
  goes through and pays for the piece as it now is: an addition made before the Pay is paid with it; one made after it (or while the Pay was at the bank)
  is still §136/§146's "added after you paid" row with Pay more.
- **Already shown never stops** (the existing seen rule, unchanged): a change the page redrew in place on its live check, or counted in the "N new updates ↑"
  pill, or listed in the top box, is before the press's seen time, so it doesn't stop. Only a change made between two live checks (before the page showed it)
  stops, once.
- **§79 kept for presses that answer a request or offer:** the developer's Accept / Decline of a call request, Accept / Decline of an application or rejoin
  ask; the tester's Accept / Decline of the developer's call request, Switch / Keep, Join from an invite just re-sent. §89 kept too: the tester's own "joined"
  line never stops Pay on their work. §86 kept: a Pay that went through still marks the piece's earlier work lines answered for later presses on any page.
- **Code.** `live.payPressOf` answers only the tester's "joined" line on that contract (it no longer answers the piece's `sent` / `sentpaid` lines by item);
  `devGate` no longer looks up the piece's label (`Answers.submissionId` removed). No migration.
- **Tests:** `tests/batch35-pay-stops-own.test.ts` (an unseen send stops Pay once, then pays; an unseen addition stops Pay once, then pays for the whole piece
  with no "added after you paid"; an addition the live check already showed doesn't stop; Pay more after an unseen addition stops once, a shown one goes
  straight through; Confirm with your bank stops once for an unseen addition; Accept on a call request that just arrived still goes through). §79's and §86's
  tests (`batch35-answering-press`, `batch35-answered-seen`) now expect Pay / Pay more to stop once for their own piece's unseen line.

## §156 Every refused press names itself (owner, Nov 3)

- **The decision.** "It should always name the refused press — any other cases?" (batch 15 §36: every stop-once box and every refusal names the press first,
  "Your Pay didn't go through: …"). §146 fixed Add and Dismiss all; this pass found every other press that didn't, and a guard so a new one can't slip through.
- **What wasn't named, and now is** (route → the button's label; under the button, in the kept line after a redraw, and in the dashboard top's failed line):
  - tests / sessions: `recording-remove` → Remove; `keys-dismiss` → Dismiss selected (Dismiss 2 for two; it showed a bare red line); `key-broken` → “This key
    doesn't work” (was "Report"; its inline refusal was bare); `terms` → Switch to the new terms / Keep my current terms (was "Switch or Keep"; the refusal
    under them was bare); `choose` → Let it go when that was pressed; Join / Apply / Ask to rejoin / Withdraw on the join page (refusals were bare); the
    Post / Save / Delete refusal under the listing form (bare).
  - payments: `/api/payments/confirm` → Confirm with your bank (the kept line after a redraw named nothing); Add a card / Change card and the payout setup
    (Connect a payout account / Continue setup / Update payout details) → the Payments page's refusals ("We couldn't save the card…", too many card attempts,
    payments switched off, confirm your email first) now start "Your Add a card didn't go through: …"; `verify-card` → Verify a card / Verify this card;
    `subscription` → Subscribe for $7/month / Cancel subscription / Keep my subscription; Cancel this check (Pay what you owe's and Confirm all's) and Pay
    what you owe's own refusal (were bare); the bank's "Your bank didn't confirm the payment, so nothing was charged." under Pay, Pay more, Subscribe, Pay
    what you owe, Confirm all and Confirm with your bank now names that press.
  - account: `/api/profile` → Save profile (Continue at first setup); `account/delete` → Delete account; `account/side` → Switch to your … side / Start
    testing too / Start posting tests too; `account/notify` → Save; Alerts ticks and the tester's Alerts button → Alerts (they read "Couldn't save. Try
    again." in green); Resend the link.
  - people and messages: `blocks` → Block / Unblock; `direct/[id]` and chat → Send (the chat line said "Your message on …"); `excerpts` → Ask the developer /
    Allow / Deny (the stop box said "Allow / Deny") / Remove; `reports` and `help` → Send to the team; `invites/[id]` → No thanks (its closed-invite line was
    bare); `visits/[id]` → Remove; `chat/open` → Chat with <name>; `calls/[id]/join` → Join call; Dismiss / Dismiss all; the recording upload, the recorder's
    Upload this recording and Attach a file.
  - sign-in pages: Log in, Sign up, Send the reset link, Save the new password, Continue (Google), Sign out / Sign out of all devices.
  - admin console (§45's labels): every AdminButton refusal (Pause, Lift the pause, Stop (close), Suspend, Reinstate, Delete account, Approve, Extend, Close
    now, Mark replied, Dismiss, Allow 3 more changes…, Clear this list…, Don't approve…), the payment hold's Approve, Decide, the team close and its
    Preview, Preview suspension. They were bare ("You already paused this test in another tab at 3:20 AM."); the stop boxes already named them.
- **The dashboard top's failed line** (`users.failedLine`, a suspended or held account's press) now uses the same table as the page (`pressLabelOf`, with the
  body peeked where one route serves several buttons). It used to say "Save" for every press it had no word for (Block, Send to the team, Save profile, No
  thanks, Remove, Dismiss selected …) and "Stop", "Message", "Rating", "Call request", "Dispute reply", "Open", "Pay" (Pay more), "Post" for buttons that read
  Stop the test, Send, Rate, Request a time, Send your side, Accept testers again, Pay more, Post the test.
- **Code.** `lib/pressLabels.ts`: `pressLabelOf` covers every route (`otherPress`, `ADMIN_PRESS`, body-dependent labels); `refusalLine` leaves a line that already
  names its press anywhere ("…, so your Send didn't go through.") as it is. `Err` takes `press` (FormMistakes passes its own), so a blue refusal names the
  press while a red form mistake, "Answer the new terms first" and a named line read as they are (the confirm-email Resend link and the Subscribe link stay).
  `AdminButton`'s `onRefused` gets the button's label.
- **Not presses** (never name one; listed in the guard with why): the join pop-up's needs check, the invite panel's check and search, a failed upload's clean-up,
  the time-zone sync, marking bell lines read, kept drafts, the call room's updates, Stripe's webhook, the monitor and the dev hook.
- **Tests:** `tests/press-names.test.ts`: reads every route under `src/app/api` and every action of the tests / sessions / admin routes and checks each press
  has a real label (never "press"), with the explicit list of non-presses (which can't go stale); the failed line for every other press; the labels by route
  and body; `refusalLine`, `Err` and `FormMistakes` naming; end to end, a refused Confirm with your bank ("Your Confirm with your bank didn't go through: You
  already confirmed this payment.", kept line too), a refused Block, and a suspended tester's Block / Unblock / Save profile reaching the dashboard top named.

## §157 Presses already done in another tab or at the same moment: the last gaps (owner, Nov 3)

The rule: every press is safe when the same action was already done in another tab, or by someone else at the same moment. Exactly one outcome, never a double
effect, never "Something went wrong", and the press that loses reads what happened ("You already …" for your own other tab, "<name> already … at <time>" for
someone else). The audit found 20 presses that broke it; each now uses one of the app's existing patterns (a claim that only changes a row still in the state
the press read, a row lock, the unique key, or the stop-once gate).

1. **Subscribe while another tab's Subscribe waits for the bank.** Refused: "Your Subscribe is already waiting for your bank: finish that check, or cancel it."
   The bank-check row is made under the developer's row lock (two Subscribes at once: one check; the other's own check is dropped at Stripe unless it is the same
   one). The bank's confirm records the payment once (claimed), so the subscription starts once, with one receipt and one "You're subscribed" line. Two
   Subscribes that go straight through share one charge (the one-time key): recorded and receipted once; the other reads "You're already subscribed."
2. **Contact us sent twice.** The same message (same topic and words) from the same account within 10 minutes goes to the team once; the other press reads
   "You already sent this message." (Checked under the account's row lock, with the day's limit.)
3. **A call request's Accept / Decline / Withdraw at the same moment.** Each is a claim on the request while it is still waiting. Two Accepts book once; the
   other reads "You already accepted this request at 3:20 PM." Accept against Withdraw: one happens; the other reads "This time was booked at …" or "Nora Lane
   withdrew this request at …". A booking that fails after the claim puts the request back.
4. **Verify a card when it's already verified** (chargeback steps). Refused before it uses a card attempt: "Your card is already verified." Two bank checks
   finishing at once: one verifies (claimed); the other is refused and changes nothing. The card it verifies replaces the card on file and is now recorded
   like Change card's ("Card: Visa ending 1111 → Visa ending 4242"), so Payments open in another tab stops once for it.
5. **Add a card in two tabs.** The developer's one Stripe customer is made under their row lock, so two first "Add a card" presses share it (before, the
   earlier tab's return failed). Two checkouts finishing: the card saved first stays; the later return isn't saved and lands on Payments with Change card's box
   naming that change (stop once); Change card again saves on top. Each checkout carries its press's time and tab.
6. **Payout setup.** Pressed once the account is connected: "Your payout account is already connected." (no Stripe call). Stripe's update that connects it
   (the webhook) is recorded like the return's ("Payout account: not connected → connected"), so a Payments page open elsewhere stops once. A first setup in
   two tabs makes one Express account (made under the tester's row lock).
7. **Confirm with your bank finished in a second tab** after the first: "You already confirmed this payment." (it read "There's nothing to confirm here.").
8. **Report a problem with a call at the same moment** (two tabs, or both people): one report is kept; the other reads "A problem with this call was already
   reported." (before, the later one overwrote it).
9. **Dispute at the same moment:** the second reads "You already disputed this payment. A part can be disputed once." (it was an error 500).
10. **Add your side at the same moment:** one side is kept; the other reads "You already added your side." This is now the line everywhere (the design doc's
    wording; it read "You already sent your side."). A decision made meanwhile: "This dispute was already decided."
11. **Rate at the same moment** (either side): one rating; the other reads "You already rated <name>." (it was an error 500).
12. **Delete draft** in another tab, or both at once: "You already deleted this draft." (it read "That test doesn't exist or isn't yours.", or was a 500). Each
    deleted draft is recorded (which draft, by whom) to say so.
13. **Open (a draft) twice:** checked again under the test's lock; opened once (one "opened" line); the other reads "This test is already open."
14. **Block at the same moment:** the block itself is the claim (its unique key): one press ends the sessions and sends the lines; the other reads "You already
    blocked <name>." Two people blocking each other at once end each session once.
15. **Allow / Deny after the tester removed the request:** "Ana Silva withdrew this request." (it read "This request was already decided."); a request a
    developer's deletion closed gives that reason. Removing a pending request is recorded to say so.
16. **The email setting** (How you're notified) now stops once like the other settings: a change saved in another tab or device since the page opened shows
    "Email: Daily → Off" under Save; the second press saves. Each change is recorded for the other tabs.
17. **The tester's Alerts** sends the state the button offers ("on" / "off"), never a flip: a stale page can't turn it back, and pressing for the state it
    already has changes nothing.
18. **Decide on a dispute from the same admin's other tab:** "You already decided this dispute in another tab at 3:20 PM." (like §45; it named the admin's
    own email).
19. **Close open reviews for $0 repeated:** says who settled them and when. All of it by one close-out: "You already closed 1 open review for $0 in another tab
    at 3:20 PM." (or "bo@… already closed …"); otherwise "3 closed; 2 were settled meanwhile: bo@… closed 1 for $0 at 3:20 PM; Nora Lane settled 1 at 3:21 PM".
20. **Cancel this check repeated** (another tab, or both at once): "You already cancelled this check." (it read "There's no bank check waiting here.", and the
    press that lost the race read "Your bank already confirmed this payment: it's paid."). Each cancel is recorded with its claim.

Not changed (by design): Send in chat across tabs (chat never stops), Unblock when already unblocked. No migration: the new records (a deleted draft, a removed
excerpt request, a cancelled check) are ActionLog rows like the account changes.

Tests: `tests/press-races.test.ts` (one race per gap, both presses fired at once; 21 of its 22 tests fail on master; Accept against Withdraw depends on timing
there). `tests/addition.test.ts`, `tests/batch16-dev-states.test.ts`, `tests/batch16-alerts.test.ts` now expect "You already added your side.".

## §158 The bank check finishes by itself even when the return page is blocked (owner, Nov 3)

- **Before.** The inline bank check (§11: the bank's page in a frame) finished only when the frame came back to `/api/payments/bank-return`, whose tiny page
  tells the page around it the check ended. Testing locally with Stripe's test card 4000 0027 6000 3184, Chrome blocked that return ("The connection is
  blocked because it was initiated by a public page to connect to devices or servers on your local network": Private Network Access stops Stripe's public
  page from sending the frame to http://localhost:3400), so the check never closed and the owner had to press Cancel (which then found it had gone through).
  On the live site the return works, but the page must not depend on it.
- **Now.** While the bank's page is open, the page also asks every 3 seconds whether Stripe still waits for the customer: `POST /api/payments/confirm` with
  `{ paymentId, peek: true }` (or `{ setupIntent, peek: true }` for Verify a card) answers `{ status: "waiting" | "done" }`. Once Stripe isn't waiting any
  more (succeeded, requires_capture, processing, canceled, or back to requires_payment_method after a failed attempt), the page runs the same finish the
  return page's message runs; the server decides there as always (paid, or "nothing was charged"). The return message still works; whichever comes first ends
  it, once. Polling stops when the box closes.
- **Read-only.** The peek only reads Stripe's status: it never finishes, cancels, releases, expires or charges anything, and answers only for the signed-in
  developer's own payment, chargeback reservation or card check (someone else's payment or reservation: 404 "There's nothing to confirm here."; someone
  else's card check: 403). A payment that no longer waits (already finished, released or claimed in another tab) answers done, so the finish gives its
  usual answer. A failed peek (offline, a refusal) is quiet: the page just asks again.
- **Covers every inline check:** Pay, Pay more, Subscribe, Confirm with your bank, Pay what you owe (a payment, or a chargeback hold's reservation), Confirm
  all (its one payment) and the chargeback steps' Verify a card (its SetupIntent). The fake Stripe's stand-in (Confirm / Cancel) isn't polled: its answer
  decides.
- **Close.** The button under the bank's frame is now "Close" (was "Cancel"), with the hint "If this doesn't close by itself after you finish with your bank,
  press Close." under the frame. Close still ends the check and the server decides how it ended. The stand-in keeps Confirm / Cancel.
- **Code.** `lib/server/bankPeek.ts` (`peekBankCheck`, `stillWaiting`); the confirm route answers `peek` first; `lib/bankConfirm.ts` `peekBank` / `watchBank`;
  `BankCheckView` takes `peek`, `useBankCheck().check(action, finish?, peek?)` (default: the action's `paymentId`; Verify a card passes its SetupIntent's).
  No migration.
- **Tests:** `tests/batch35-bank-peek.test.ts` (a waiting check stays waiting however often it's peeked, with nothing changed at Stripe or in the database;
  done after the bank confirmed or refused, still unpaid until the finish; someone else's payment, reservation or card check refused; the page peeks every 3
  s, ignores failed peeks, ends the check once on done and stops when closed; Close and its hint under the frame, the stand-in's Confirm / Cancel kept).
  `batch17-bank-check` now expects Close under the bank's frame.

## §159 The payment stop matrix (owner, Nov 3)

Exact rules for every payment press. "Stops once" means the first press shows the box naming what changed and charges nothing; the second press goes ahead. A
change the page already showed (the redraw, the pill, the top box) never stops. Our stops happen at our own button, before the bank's page opens; inside the
bank's page (Stripe's own 3D Secure page, inline under the button) the only button is the bank's Complete.

**Developer side: Pay, Pay more and Confirm with your bank** (the bank button on a waiting charge, and the one on a Pay or Pay more press's own check).

1. **The team's dispute decision about the same tester always stops once**, on any of that tester's parts in this test, even with "Decisions by the team" (and
   "Disputes") ticked off in Alerts: the decision changes what that tester is owed. A decision about another tester follows the Alerts ticks like any other line
   ("Decisions by the team" ticked off: it doesn't stop). This narrows the same day's change, which forced every decision on every part.
2. **The tester's sent, updated or added work on the part being paid always stops once**, whatever the "Work sent" tick (§155 made it stop; now Alerts can't
   switch it off either). Work on that tester's other parts, and other testers' work, follows the "Work sent" tick.
3. **A tester leaving the test** stops once with Alerts "Testers leaving" on; ticked off, it doesn't stop.

**Tester side: Charge and Let it go.**

4. **A developer payment on the part being charged** (Pay, Pay more, an automatic call charge) always stops once, whatever the tester's Alerts On/Off. When
   that payment left nothing to charge, the existing refusal stays ("Nora Lane paid $10.00 for this meanwhile."). **The team's decision on any of that tester's
   disputes** (any part) also always stops once. A developer payment on the tester's other parts follows their Alerts as before (On: stops once; Off: doesn't).

**Payments page.**

5. **Pay what you owe stops once for chargeback changes**: a new chargeback ("Added to what you owe meanwhile: Your bank reversed … New total $50.00.") and the
   bank changing a disputed amount ("What you owe changed: now $46.00."). Already so (§146 fix 3; `holds.payOwed` compares the total and the items the page
   showed); verified, no change.

**Later decisions the same day (owner, Nov 3).**

6. **That tester leaving always stops** Pay, Pay more, Confirm with your bank and Confirm all items on that tester's parts once, whatever the Alerts ticks (a
   suspension or deletion removes a tester the same way: "Ana Silva left the test"). Another tester leaving follows "Testers leaving".
7. **Confirm all stops like each single Confirm.** In the claim's locked step every covered item runs its own pay-press gate (its contract and part, the same Alerts
   filter, the always-stop rules above). Any unseen change on any item stops Confirm all once, listing each change once with the items it is about ("The team decided
   Ana Silva's dispute: … · for Ana Silva's recording on “Harbor Run” $10.00"); the second press (the box's time) goes ahead. The "what's waiting changed" stop and
   the over-$200 tick are unchanged. The page now sends its render time and the box's time.
8. **A suspended developer's payment presses are refused like Pay**: "Your account is suspended: Pay waits until it is lifted." (Pay more: "extra pay"; "Confirm
   with your bank"; "Confirm all"). Each is read under the developer's row lock inside the press's own locked step (Pay and Pay more were checked before it), so a
   suspension at the same moment either lands first (refused) or waits for the press. Pay what you owe and a renewal's Confirm stay open (unchanged).
9. **Suspended while a bank page is open.** The developer's own Pay / Pay more check is cancelled at Stripe at the suspension, like a hold does (one the bank had
   already approved is recorded as paid once): Complete charges nothing ("This payment was cancelled: nothing was charged.") and the part is payable again after the
   lift. A Pay whose check comes back just as the suspension lands is cancelled the same way. A tester's waiting charge being confirmed (Confirm with your bank,
   Confirm all) is NOT cancelled: its Complete goes through and is recorded normally.
10. **Pay and Pay more wait while a payment on that part waits for the bank.** The tester's Charge (or an automatic call charge, a team decision) waiting for
    "Confirm with your bank": the part's box is the greyed Pay more box with "Confirm Ana Silva's $10.00 charge with your bank first."; the developer's own Pay or
    earlier Pay more whose check is open: "Your $5.00 payment for this part is waiting for your bank: finish or cancel it first.". A press from a page that hadn't
    redrawn is refused with the same line (never a stop-once: it can't go ahead), read in the locked step; a charge still on its way to the bank refuses with "A
    payment for this part is being confirmed. Wait for it to finish before paying again.". After the Confirm the box enables ("up to $990 more").
11. **Pay and the tester's Charge on one part at the same moment charge once.** The same-moment test found both charging ($20 on a $10 part): the Charge / Let it go
    now claims the part under the test's row lock, the lock Pay reserves under; a Pay on its way, at the bank or paid wins (the Charge is refused naming it).
12. **Dispute when nothing is left to dispute.** Whether anything is left is decided before the stop-once: a Pay more since the page loaded that took the part to its
    most reads as ONE refusal, "Nora Lane paid $996.00 more meanwhile (3:20 PM): this part is now paid the most it can be ($1,000.00), so there's nothing to
    dispute." (never a stop whose second press could only be refused). The dispute is made under the test's row lock after checking again, so Dispute and Pay more
    at the same moment are decided in one place. (Audit of the tester's other presses: Charge and Let it go already refuse "… paid $X for this meanwhile" before
    their stop; no other tester press stops for something that leaves it nothing to do.)
13. **Already done in another tab.** Pay what you owe pressed on a page from before it was paid: "You already paid what you owe ($27.00) in another tab at 3:20 PM.";
    during a chargeback hold: "You already reserved what you owe ($46.00) on your card in another tab at 3:20 PM.". A bank check completed elsewhere keeps "You
    already confirmed this payment.". A new card saved while a Pay's bank page completes: Complete first → Stripe's answer to the save's cancel is "already
    succeeded", recorded paid once; the page's finish reads §157's "You already confirmed this payment." (never "cancelled"); the save first →
    cancelled, Complete reads "This payment was cancelled: nothing was charged." and the part is payable again.

- **Code.** `live.devChanges`: for a payment press (`payPressOf`: its contract is `stopCheck`, its part is `keys`), a team decision whose `contractId` is the
  press's contract, and a "sent" line whose item is the press's part, pass the Alerts filter. `testerGate`'s `owedPiece` (Charge / Let it go on that part:
  `terms.testerTermsGate`, and the route's stop-moment box for `choose`) keeps, with Alerts Off, a "paid" line on that part and any team decision line
  (`owedChange`). No migration.
- **Tests:** `tests/pay-matrix.test.ts` (one per rule: same vs other tester for decisions on Pay, Pay more and Confirm; work on the same part with "Work sent"
  ticked off vs another part on and off; leaving on and off; Charge / Let it go for a payment on the same part (the refusal) and on another part with Alerts
  Off and On, an automatic call charge, a decision with Alerts Off; Pay what you owe after a new chargeback and a changed amount).
  `tests/decision-stops-pay.test.ts` follows the narrowed rule (same tester: stops; another tester with Decisions ticked off: goes through).
14. **Confirm with your bank in two tabs at the same moment** (found on Stripe test mode): both presses started the bank check at Stripe, both pages then read "Your
    bank didn't confirm the payment, so nothing was charged." while the Complete went through at Stripe, and the charge was left waiting. The start now runs one at a
    time per payment (a lock held while Stripe answers: the second press gets the same bank page), and Stripe's "processing" right after Complete is waited out (the
    page's peek keeps waiting; the finish waits up to 10 s) instead of being read as not confirmed.

- **Code (6–13).** `live.devChanges` (a "left" line on the press's contract always passes); `confirmAll.itemStops` in `claim` (plus the suspension read);
  `payments.refuseSuspendedLocked`, `suspendedAfterCheck`, `bankWaitsLine` (Pay's reviewed branch and Pay more's locked step), `paidMostMeanwhileLine` and the
  locked dispute claim in `openDispute`; `restrictions.suspendAccount` releases the developer's own `needs_action` checks; `confirm.confirmStart` refuses while
  suspended; `holds.claimChoice` (Charge / Let it go under the test lock), `paidBefore` / `reservedBefore`;
  `PayBox` `bankWaits`; `ConfirmAll` sends `seenAt` / `boxAt`. No migration.
- **Code (14).** `confirm.confirmStart` (advisory lock per payment), `confirmFinish` (waits out "processing"), `bankPeek.stillWaiting` ("processing" waits).
- **Tests (6–14):** `tests/pay-matrix-2.test.ts`; `batch35-bank-peek` ("processing" still waits).

## §160b No turn-off offered for stops that ignore Alerts (owner, Nov 3)

Owner: "With forced stops that ignore alerts, don't show the turn-me-off in Alerts."

- **The server marks each stop line that no Alerts tick could switch off** (`forced: true`). Developer side (`devGate`, so Pay, Pay more, Confirm with your bank,
  Confirm all's item lines, every other developer press): a line with no Alerts type (your own other-tab actions, a stop or pause, a listing change, …) and the
  §159 always-stop lines for a payment press (the team's decision about the same tester, that tester leaving or removed, work on the very part being paid).
  Tester side (`testerGate`, and the stop-moment box): new terms, a key marked working, their own other-tab actions, a stop or pause, and the piece rules (Dispute's
  payment on that piece; Charge / Let it go's payment on that part and any team decision on their disputes).
- **The box** (`ChangesBox`): the developer's "You can turn these stops off in Alerts… Don't stop me for: …" chips come only from lines that aren't forced (a box of
  forced lines shows no hint at all; a mixed box offers only the optional lines' types). The tester's "Turn off alerts" / "You can turn these stops off below" shows
  only when a line in the box isn't forced.
- **Code.** `live.alwaysStops` / `devForced`, `tests.devLine` (carries `forced`), `testerGate` (marks before `asLines`), `ChangesBox.optionalAlerts` /
  `testerCanTurnOff`. No migration.
- **Tests:** `tests/forced-stops.test.ts` (forced-only boxes offer no turn-off; a mixed box offers only the optional type; the server marks the same-tester decision
  forced and another tester leaving optional; the tester's decision line with Alerts Off is forced).

## Pay what you owe names the bank's change of a disputed amount (owner, Nov 3; A3 fix)

- **Before.** When the bank changed how much of a payment it took back (Stripe's `charge.dispute.updated`, §133) after the page drew, Pay what you owe stopped
  once with only "What you owe changed: now $35.00", while the line above still read "$12 + $15 chargeback fee" and the button said $35.00.
- **Now.** The stop names the change: "Your bank changed the amount it took back from your $40.00 payment for Ana Silva's written answers on “Harbor Run:…”:
  $12.00 → $20.00 (now $20.00 + $15.00 fee = $35.00). Press again to reserve $35.00 on your card: …" (several changed: joined with "; "). The stop carries
  the box's lines, so the bullets redraw with it ("$20 + $15 chargeback fee") and never disagree with the button; the page's next redraw brings its own.
  The page sends what each line showed (`seenAmounts`); an older page that didn't: its one chargeback line explains the whole difference. Other stops (added
  meanwhile, a won chargeback) are unchanged. The reservation's own re-read (§146 item 3, the bank's change landing during the press) words it the same.
- **Code.** `rules.bankChangedLine`; `holds.owedLines` (a chargeback line's `cb`: the payment, the piece, what was taken back) and `holds.payOwed` (the line,
  `lines` in the stop's data); `chargeback.reserveOwed` (the same on its re-read); `components/OwedBox.tsx` (`linesAfterStop`, `seenAmounts`). No migration.
- **Tests:** `tests/owed-dispute-change.test.ts` (the wording; a page that sent its amounts stops once naming $12.00 → $20.00 with the new lines, then reserves
  $35.00; an older page gets the same line; the box draws the stop's lines). `partial-dispute` and `races-nov3` now expect the named change.

## §161 From the 2nd chargeback the team reviews first; everything that waited for a lift is ONE payment (owner, Nov 3)

**A. The 2nd chargeback: the team's review before paying.**
- **Rule.** From an account's 2nd chargeback (counted over the account's whole life, this one included: every payment the bank ever reversed, open, resolved,
  won or lost), the chargeback hold needs the team's approval BEFORE the developer can pay. The 1st chargeback keeps today's flow (verify a card, Pay what you
  owe reserves, the team's Approve takes it and lifts the hold).
- **Developer.** Pay what you owe is disabled with "Your account has had 2 chargebacks: the team reviews it before you can pay. You'll get an email when you
  can." (the count stated). The server refuses the press with the same line, checked again inside the claim under the developer's row lock (an old page's
  press too, and a press whose approval went away meanwhile charges nothing). The steps box reads: the team's review (with the count), a card verified with 3D
  Secure, what you owe paid.
- **Team.** The admin console's Chargebacks row shows "N chargebacks on this account: the team reviews it before they can pay" with **Approve (to allow
  paying)**. The Approve allows paying only: nothing is taken or lifted; anything still reserved from before is released; the developer gets a bell and an
  email ("The team reviewed your account: you can pay what you owe now", sent whatever the email setting).
- **Then.** Pay what you owe (the card verified first, if it isn't) CHARGES everything owed as one payment (no reservation; the ordinary one-payment press:
  one PaymentIntent, the bank's check inline if the card asks, one receipt). Paying lifts the hold at once: the reversed payments now repaid are resolved
  (liftHoldIfClear) and no second approval is needed.
- **A new chargeback after the approval, before paying,** un-approves it again (chargebackOpened clears the approval, as it clears the card check), with the
  new count.
- **Code.** `rules.CHARGEBACKS_REVIEW_FROM`, `reviewFirstLine`, `REVIEWED_LINE`; `chargeback.chargebackCount`, `chargebackSteps` (`reviewFirst`, `count`),
  `approveChargebackHold` → `allowPaying`, `resolveRepaidAfterReview`; `holds.payOwed` (the refusal; charges instead of reserving) and `liftHoldIfClear`;
  `owedOnce.claimOwed` (`reviewFirst`: re-checked under the lock); `OwedBox` (`reviewFirst` line, button disabled), `ChargebackSteps`, the Payments and test
  pages, `adminLists` / `PagedList` (the row). No migration.

**B. One payment for everything that waited for the lift.**
- **Rule.** Everything that piled up while waiting for the team's approval is charged as ONE payment right after the lift: every chargeback repayment added
  after the reservation (kind "chargeback", "deferred") TOGETHER with the testers' charges that waited (§122's after-lift payment): one PaymentIntent, one bank
  check if the card asks (one "Confirm with your bank" item covering all of it), one receipt naming each. Each chargeback keeps its own $15 fee (only the
  payment is combined). The money for a repayment stays with the platform; each tester's share is sent from that same payment (as the combined payments
  already split shares). Declined: each reversal is owed again (its chargeback reopens: a chargeback hold) and each tester's charge is a debt. A deleted
  developer's repayments still wait (§151); their testers' charges are made.
- **Code.** `holds.chargeDeferredLocked` (no more one-by-one charges); `owedOnce.claimOwed` ("charges" now takes repayment rows), `settleOwed` (their names),
  `chargesDeclined` (a declined repayment reopens its chargeback); `chargeback.settleOwedRow` (a repayment row: no tester share). No migration.
- **Note.** With A, a chargeback that arrives after a 1st chargeback's reservation makes it the account's 2nd: the hold becomes "review first", so the team's
  Approve then allows paying (and releases the reservation) rather than taking it; B applies to repayments already waiting from before.

**Tests:** `tests/chargeback-review-first.test.ts` (the 1st keeps the reserve flow; the 2nd refused with the count, an old page too, the admin row and its
Approve, a bell and email, then ONE charge and the hold lifted; verify still first; a new chargeback un-approves with the new count; the claim re-checks it;
the box disabled with the line; after a lift: one PaymentIntent for a repayment and a tester's charge, shares split; declined: chargeback reopened and a debt;
a card that asks: one confirm item; a deleted developer's repayment waits). `batch35-one-card-checks` (a declined one payment with a repayment in it),
`stripe-descriptions` (a repayment in the one payment's description), and the OwedBox source checks in `batch16-chargeback-order` and `batch28` follow.

## §162 Pronoun and bio at sign-up; pronouns everywhere (owner, Nov 3)

Owner: ask the pronoun and the bio at sign-up, and make every line about a person use that person's recorded pronoun. Later the same day: drop "Both" from
sign-up.

### Sign-up: Developer or Tester only (replaces §134's "both")

- **The choice is Developer or Tester** on the email form and on Google's step (`RoleChoice`, `src/components/RoleChoice.tsx`): two choices, required, red at
  the choice with **"Choose developer or tester."** (`ROLE_MISSING`, was "Choose developer, tester or both."). The hint under it: "One account either way: you
  can add the other side later in Settings."
- **An older page's "both" is refused** with the same line, red at the choice, nothing made (`readRole` reads only developer and tester; `readNewAccount` in
  `src/lib/server/passwords.ts`, used by `signUp` and `finishGoogleSignup`).
- Replaces §134's "both, which lands on the developer side" and §153's "Tester or Both shows the tester's Devices …": only Tester shows them now.
- **Unchanged:** accounts that already have both sides keep them; adding the other side later (Settings' "Start testing too" / "Start posting tests too") works as
  before (§134's shared name and pronoun, the side's own fields empty).

### Pronoun and bio at sign-up

- **Pronoun** (optional), right under Name, on both pages: the profile's own choice (`PRONOUN_OPTIONS` in `src/lib/format.ts`, now shared by the profile and
  sign-up): "Not set (others read “they”)", "she / her", "he / him", "they / them". Saved as the account's pronoun (`User.pronoun`, the same field the profile
  saves; unset reads "they").
- **Bio** (optional), under Pronoun, for the side chosen, with the profile's label, limit and count (`BioBox`, `src/components/BioBox.tsx`, now also the
  profile's box): Developer → **"Bio (shown to testers)"**, saved to `User.devBio`; Tester → **"Bio (shown to developers)"**, saved to `TesterProfile.bio` (with
  the devices and languages, §153). Up to 2,000 characters (`LIMITS.bio`), count "12 / 2,000" under the box. The box follows the choice live (choose Tester, its
  bio box shows; switch, the other one shows); what was typed in each stays while the choice changes back and forth, and only the box shown is sent. No box
  before a choice is made.
- **Order on the form:** I am a… (Tester: devices, languages), Name, Pronoun, Bio, then email and password (email form) and the two ticks.
- **Red at their field, all at once with the others** (as §134 / §153): "Choose a pronoun from the list." (`PRONOUN_BAD`) at Pronoun and "Keep your bio to
  2,000 characters or fewer." (`BIO_TOO_LONG`) at the bio. The page itself can't produce either (the box stops at 2,000 and offers only the four choices), so
  they come only from an older page or a hand-made request. Order of the lines: choice, devices, languages, name, pronoun, bio, Terms, 18 or older.
- **Saved when the account is made** (`sidesOf(role, { devices, languages, bio })`), on the email form and on Google's step alike, and shown on the profile
  afterwards (the Pronoun choice selected, the side's bio in its box): nothing is asked twice.

### Pronouns everywhere

- **`pronouns()`** (`src/lib/format.ts`) now also gives the verbs that agree when the pronoun is the subject: `is` (is / are), `has` (has / have), `was`
  (was / were), `subjIs` (she's / they're), `subjHas` (she's / they've), `subjHad` (she'd / they'd), `v("asks", "ask")` for any other verb, and the
  capitalized forms for the start of a line (`Subj`, `Poss`, `Obj`). Unset (or anything unknown) reads they / them / their.
- **Every line below now reads the person's recorded pronoun** (she / her / her, he / him / his, they / them / their) instead of a fixed "their / they / them".
  Generic text about several people ("testers … their work", End early's ticked testers, "their testers can charge…") and the team ("Their note" from the
  team) is unchanged. The page's own reader is "you" as before (e.g. the tester's own "You left this test.").
  - Payments (`payments.ts`): "Ana already charged $8.00 for her written answers." / "Ana let her written answers go: nothing was charged." (Pay on an older
    page); the tester's email "Her note: “…”" (Pay, Pay more, a $0 Pay more: the developer's note); "Ana disputed the pay for her written answers" (live
    line); the admin's "Decide again once she adds a card." and "The developer is confirming a payment for this piece with her bank. …" (`decideLockedLine`;
    `DECIDE_LOCKED` is the unset one); the admin's stop line "The developer added her side".
  - Charges and holds (`holds.ts`): "Ana let her written answers go: nothing charged", "Ana charged $8.00 for her written answers", "… for her call", "Ana let
    her call on … go" (test-page lines); "Ana can now charge or let go of her written answers"; receipts "Ana Silva's written answers … (charged by her after 7
    days)"; the developer's daily line "… You can still pay until she does" (`unreviewedLine`); the admins' bell "Hold lift waiting: Nora paid what she owes".
  - Joining (`joining.ts`, `tests.ts`): "You blocked Nora: unblock her in Account → Blocked people to join." (both places); "Her note: “…”" (an application's
    and a rejoin ask's email); "Ana withdrew her application" (line and refusal); "Her deal: …" (joined email); "Work she already sent still waits for your
    review." (left email, also for a removed tester in `restrictions.ts`).
  - Invites (`invites.ts`, `rules.ts`): "You ended her work"; "Applied: answer her in Needs you"; "already invited, waiting for her to join" (`whyInvited`;
    `WHY_INVITED` is the unset one) and the Invited list's "waiting for her to join"; "asked to rejoin: answer her in Needs you →" (`whyApplied`); "Ana: you've
    invited her to this test 3 times today. You can invite her again tomorrow."; "Ana's account was closed, so she can't be invited."; "Ana rated this test,
    so she can't join it again. Untick her …" (one tester; several keep "they"); "She already joined." (Cancel invite); "Ana joined this test, so she's no
    longer in your invite list"; "Ana got her first rating: 4.5".
  - Ratings (`rules.ts`, `ratings.ts`, live route): "Ana finished her part (rated you)"; "Ana rated you. You can rate her until …" / "… once everything she sent
    is settled."; "You can rate Ana once she's rated you and everything she sent is settled."; the cancelled calls' "Ana finished her part.".
  - Calls (`rules.ts`, `calls.ts`, `blocks.ts`): the developer's "She left the test." / "His session ended." (call page and Join refusal); "Sharing her screen"
    (call room); "She picks one of these." (the tester's request form, about the developer); "Closed: the tester finished her part" (a request row,
    `requestGoneLine`); "Her terms: $30/h (the listing is now $24/h)" (`devRateLabel`).
  - Keys (`keys.ts`, `accessKeys.ts`, `KeyBox`): "Ben reported his key doesn't work" (live line); the tester's "The developer was told. She can send you another
    key in a message." (after the press and on the key box).
  - Excerpts (`excerpts.ts`): bell "Ana asked to show an excerpt from “Harbor Run” on her profile"; Needs you and the dashboard "… would like to show this on her
    profile"; "Harbor Run's developer deleted her account, so this request was closed".
  - Disputes (`disputes.ts`, the test page): "Ana disputed what you paid for her written answers", "Her reason"; the tester's stop / live line "Nora added her
    side to your dispute about …" (`testerGate.ts`).
  - The developer's test page: "Her written answers" / "Her recording" (the folds), "Her contract: …", "In her contract", "See her profile" (row and avatar
    card), the avatar's "Ana: showing only her", "On her original terms · … (kept her terms) / (closed: her part ended)" (`terms.ts`), "Ana deleted her
    account before setting up payouts, so this can't be paid."; the dashboard's "sent her recording", "added to her written answers"; the developer's own
    action in another tab "You paid Ana $5.00 more for her written answers" (`actionText.ts`).
  - Profiles: the tester profile's "Excerpts of her work" and Block's "Her sessions on your tests end now (work she sent stays payable), … She won't see your
    tests any more."; the developer profile's Block "Your sessions on her tests end now … You won't see her other tests any more." and "You blocked Nora, so her
    tests are hidden."; the hover cards' "See her profile" (Messages, chat, the session page, the dashboard's seats).
  - The join page: "If the developer doesn't review it in time, you choose: charge her, or let it go", "See her profile and other tests"; the tester's "Can't
    be paid: Nora deleted her account".
  - Admin console (`adminLists.ts`, `AdminBoxes`, `AccountActions`): "Payments she made", "Payouts to her", "Reports against her", "Parts she sent, across
    tests"; "$8.00 to Ana … for her written answers"; the timeline's "Nora's tests are paused until she pays what she owes", "Nora's bank reversed her …", "Ana
    disputed the pay for her written answers:", "Ana kept her terms instead of the new terms", "… before her part ended"; "Reinstate waits for the payment
    hold: she pays what she owes first."; the suspension preview "pay for work she sent still reaches her".
  - Stripe descriptions and receipts use names, not pronouns (unchanged), except the "charged by her" receipt above.
- **A pronoun change shows on the next redraw.** The pages' live versions now include the pronouns their lines read: the test page and the session page
  (`testV`: the developer's, each tester's in the test and each applicant's), the dashboard (`dashboardV`: the testers', developers' and applicants'), a profile
  (`publicProfileV`) and the admin's person box (`adminPersonV`). Lines computed live (the live box's "rated you" line, the request rows) read the pronoun as it
  is now. Lines already stored (a bell line, an email sent, a test event's text) keep the words they were written with.
- **Tests:** `tests/batch35-pronouns.test.ts`: sign-up with pronoun and bio for each type on the email form and on Google's step, saved to the right fields and
  shown on the profile; both optional (unset reads they); "both" refused on Google's step; the red lines for an unknown pronoun and a bio over 2,000 (all at
  once, in order) and the page's Pronoun choice and bio box (label, limit, "12 / 2,000", red-line matches); the form's source (no Both, the bio box following
  the choice, the shared choice and box); `pronouns()` for she / he / they and its verbs; representative lines for she, he and they (live and stop box lines,
  Needs you, invite and request rows, bell, email and payment lines) with verb agreement ("she's rated you" / "they've rated you", "until she does" / "until
  they do", "She left the test." / "They left the test."); in the app, a key report's live line and the tester's note, and the test and session pages'
  versions changing with a pronoun. `batch35-signup-bio`, `batch35-signup-devices`, `sides` and `batch26` updated for Developer or Tester only. The suites
  whose people have a pronoun (the fixtures' developer and `joined()` testers are "she") now expect it: `batch5`, `batch7`, `batch11`, `batch13`, `batch14`,
  `batch16-blocks`, `batch16-dev-states`, `batch17-rate`, `batch18-misc`, `batch20`, `batch21-call-room`, `batch22`, `batch26`, `batch28`, `batch29-gates`,
  `batch33`, `batch34-fixes`, `batch34-invite-beats-application`, `batch35-decide-paid-above`, `batch35-decide-tick`, `batch35-name-links`,
  `batch35-tester-folds`, `block`, `choice`, `pay-until-chosen`, `races-nov3`, `ratings`, `stopped`. Unchanged and not done: "See their contract" (the stop
  and top boxes' contract link) still reads "their", as its line carries only the contract id.

## §160 A blue notice under an open bank check (owner, Nov 3)

- **Why.** Once the bank's page is open, Stripe's Complete can't be stopped by us. So while it is open, anything that would have stopped the developer's
  press, or a cancellation of the check underneath it, is said in a blue notice before the developer presses Complete.
- **Where.** INSIDE the bank check's box (the bordered box holding the bank's frame), at its bottom, under the frame and Cancel (owner, Nov 4; it was directly
  above the frame, owner's correction of Nov 3: within the bank window, not below the box). The app's blue "info" style, as the stop boxes use.
- **What it says.**
  - Changes: "While your bank's page was open:" then each line ("Ana Silva disputed the pay for her recording."), then "Complete still pays $10.00 as
    pressed; or press Cancel." ("reserves" for a chargeback hold's Pay what you owe). Plain changes never close the box: the developer decides.
  - Cancelled: "This bank check was cancelled: <reason>. Pressing Complete won't charge anything." Reasons: "your tests were paused (a payment hold
    started)", "you saved a new card", "its 15 minutes ran out", "the 3 days to confirm it ran out", "this payment is paused until your tests resume", "it
    was made in Stripe's other mode (test or live)", otherwise "it was ended elsewhere (in another tab, or by the team)". Verify a card: "… Pressing Complete
    won't verify this card."
  - Lines appear as each poll brings them (every 3 s), never twice, and stay until the box closes.
- **The peek's answer.** `POST /api/payments/confirm { paymentId | setupIntent, peek: true, since }` now answers `{ status, changes?, still?, cancelled? }`.
  `since` is the moment the page's bank box opened (the press); the server never uses a time later than now, nor earlier than the payment row of a fresh press
  (so the stop box a confirmed second press already showed is never repeated). Without `since` (a page from before §160) the answer is §158's.
  - Pay, Pay more, Confirm with your bank (test page and the dashboard box): EXACTLY the stop-once lines that press would get now: the same `devGate` call
    with the same press (`payPressOf` on the payment's piece; a retried chargeback's row checks the reversed payment's piece, as `confirmStart` does), so the
    Alerts ticks and "the team's dispute decision always stops a payment press" apply as for Pay, and this tab's own actions never count (the peek sends the
    page's tab). Only lines after `since`.
  - Pay what you owe (its one payment, or a chargeback hold's reservation): every new debt or charge that arrived after the press, named with its amount and
    what happens to it; none is ever added to the open check. A new chargeback or a declined payment: "<its line, with the amount and fee>: it isn't in this
    payment; pay it with Pay what you owe after this one." (an unpaid hold), or "…: it isn't in this reservation; it's charged right after the team approves
    lifting your hold." (a chargeback hold: the reservation reserves once, batch 28 §8). A tester's Charge or a team decision: "Ben Okafor charged $10.00
    meanwhile: it's charged right after this payment goes through" (or the reservation's tail). A disputed amount the bank changed is said too. Once the check
    ends, the page's live checks run at once, so the redrawn list shows the new line.
  - Confirm all: a new charge made while away it doesn't cover is never added to it: "Ben Okafor charged $10.00 meanwhile: it isn't in this payment; confirm it on its
    own, or with Confirm all after this one."
  - Pay what you owe (owner's §125 rule, unchanged): a charge arriving while its check is open isn't added either: "Ben Okafor charged $10.00 meanwhile: it's charged
    right after this payment goes through."
  - Subscribe, a renewal, Verify a card: only `cancelled`.
- **Cancelled.** A payment whose check no longer waits and wasn't paid (cancelled, paused/"deferred", or ran out to a decline), a reservation cancelled or
  lapsed, a SetupIntent Stripe cancelled. The check was cancelled at Stripe by whatever ended it (never by the peek), so Complete charges nothing; the peek
  then answers "waiting" so the box stays open with its notice, and the bank's return message or Cancel ends it with the usual finish ("nothing was charged").
  A check that had already gone through when it was cancelled was recorded as paid: not cancelled, done as before.
- **Read-only, still.** The peek claims nothing, writes no log (nothing is marked answered or seen), and never finishes, cancels, releases or charges: the
  stop-once lines come from `devGate` run without a press (it only reads, and throws its stop, which the peek catches).
- **Cancel (owner, Nov 3; replaces §158's "Close").** The button under the open bank window is "Cancel" again. Pressed, the server asks Stripe FIRST:
  - went through (succeeded, or processing): recorded as paid, once, and the box just closes ("Paid $10.00 to Ana Silva.");
  - not: the developer's own press (Pay, Pay more, Pay what you owe, Subscribe, Confirm all's one payment) is cancelled at Stripe (nothing charged) and what it
    covered is payable again at once (Confirm all: each charge back to its own "Confirm with your bank" with its ORIGINAL date, a new off-session check each, no
    decline, no hold, as §147 built it). Verify a card: its SetupIntent is cancelled at Stripe (nothing saved);
  - the cancel at Stripe finds it had just gone through: recorded paid once, and said so (never "nothing was charged");
  - EXCEPTION: a single "Confirm with your bank" on a charge made while the developer was away (a tester's Charge, a team decision, a retry, a renewal) is never
    cancelled (that would count as declined and start a hold): the window closes and the charge keeps waiting with its own 3-day date: "Nothing was charged:
    this payment still waits for your bank. Confirm with your bank by Fri, Nov 6, 4:26 PM." (Stripe stays Incomplete).
  Hints under Cancel: "Already finished with your bank? It's recorded as paid; otherwise nothing is charged." (own presses), "…; otherwise nothing is charged and
  it keeps waiting for your bank." (Confirm with your bank), "…; otherwise nothing is charged and each payment keeps waiting for your bank." (Confirm all),
  "Already finished with your bank? Your card is verified; otherwise nothing is saved." (Verify a card). The stand-in (fake Stripe) keeps Confirm / Cancel.
- **Leaving the page.** Closing or reloading the page (or navigating away) with the window open does what Cancel does: on `pagehide` (not
  visibilitychange) the box sends the same finish request with `navigator.sendBeacon` (`POST /api/payments/confirm { paymentId, leave: true }`, or Verify a
  card's `{ finish, setupIntent, cancel }`), which outlives the page.
- **Heartbeat (owner, Nov 3): an open bank check stays open only while the page showing it is open.** Each 3-second peek from the page holding the window
  records that it is still open (a kept row `bankcheck:<id>`, no new column; written by the route, the peek itself stays read-only). A check of the
  developer's OWN press (Pay, Pay more, Pay what you owe and a chargeback hold's reservation, Confirm all, Subscribe, Verify a card) with no heartbeat for
  3 minutes is ended like Cancel: Stripe first (went through: recorded paid; otherwise cancelled at Stripe, nothing charged). 3 minutes, not seconds: on a
  phone the bank's approval can happen in the bank's app while the browser is in the background and sends nothing. The sweep runs on every signed-in page's
  status check (on load and every ~20 s, so another tab opening Payments ends a dead check at once) and in the 5-minute timers sweep
  (`lib/server/bankHeartbeat.ts`). The single "Confirm with your bank" on a tester's charge made while away is never cancelled (closing only).
- **Cancel this check in other tabs.** Every open check shows its Cancel elsewhere: a chargeback hold's reservation's rows now carry its Cancel this check
  (they had none: `owedLines` gave them an empty check id); on a reservation it asks Stripe first (authorized: reserved as usual; otherwise cancelled at
  Stripe). A Pay or Pay more whose window is open in another tab shows "Confirming with your bank" with Cancel this check. Confirm all's open check and Pay
  what you owe's one payment already had theirs.
- **Pay what you owe in flight in another tab (the owner's two-tab screenshot).** While its reservation or its one payment is being made or waits for the
  bank, other tabs hide the button and say "Pay what you owe ($91.00) is waiting for your bank in another tab or window: finish that check, or cancel it."
  (Cancel this check sits on its rows); a press from an older page is REFUSED with the same line (`owed_in_flight`, checked in `payOwed` and inside the
  reservation's locked step), never a stop-once; "already reserved" only once it really is reserved. An away one payment (3 days, a new card's) still locks
  only what it covers.
- **A redraw counts as seen (Owed box).** The box's seen total and ids follow each redraw (they kept the first render's, so a press after a live redraw
  stopped once for a change the page already showed); while a stop box shows, its values still win.
- **The box stays put (bug found while recording).** A redraw while the window was open replaced the box and the bank's page under the developer (the
  Invite panel's availability poll redrew without checking for an open bank check, and a redrawn Pay box turned into "Confirming with your bank"). Now the
  Invite panel waits while a bank check is open, a Pay box keeps its own open check through a redraw, and when the check ends the page's live checks run at
  once (no stale "waiting for your bank" until the next 20-second beat).
- **Code.** `lib/bankNotice.ts` (wording), `lib/server/bankPeek.ts` (`changes`, `cancelled`, `still`), `lib/bankConfirm.ts` (`peekBank(target, since)`,
  `watchBank(…, onNews)`, `leaveBeacon`), `components/BankCheck.tsx` (`BankNotice`, `addNews`; `useBankCheck` sends the box's open time; a custom peek gets it
  too: ChargebackSteps' Verify a card; Cancel and its hint per `BankAction.cancel`; the pagehide beacon), `lib/server/confirm.ts` `confirmFinish` (processing
  counts as paid; paid-at-cancel; the still-waiting line), `api/payments/verify-card` (cancel the SetupIntent), `BankWaiting` / `ConfirmAll` /
  `ChargebackSteps` (their Cancel kinds), `InvitePanel` and `PayBox` (the box stays put), `lib/server/bankHeartbeat.ts` (heartbeat, stale-check sweep,
  the reservation's Cancel), `api/account/status` and `holds.runSweep` (the sweeps), `holds.ts` `owedInFlight` / `refuseOwedInFlight` and the reservation's
  check id on its rows, `chargeback.ts` `reserveOwed` (in flight vs reserved), `owedOnce.cancelOwedCheck` (a reservation id), `OwedBox` (the in-flight line,
  seen values follow redraws), `BankWaiting` (`own`: Cancel this check). No migration.
- **Tests:** `tests/batch35-bank-notice.test.ts` (a change after the press is a line with what Complete still does, one before isn't, asked twice the same;
  Alerts-ignored types aren't lines but the team's dispute decision is, another tab's own action is and this tab's isn't; Confirm all's and Pay what you owe's
  changes; a hold or a new card cancels with its reason and the box stays open; still-open or paid checks are never cancelled; the peek changes nothing (rows,
  action logs, reviews, Stripe calls); the notice renders inside the box at its bottom and never duplicates a line; plain changes never end the watch;
  Cancel on an unfinished Pay cancels at Stripe and the part is payable again; Cancel after the bank finished records it paid once (a second Cancel or the
  beacon charges nothing); a cancel that finds it just succeeded records it paid once; Cancel on a charge made while away never cancels it (same date, no
  hold); Pay what you owe's notice names a charge that waits instead of being added; the page has Cancel with its hint and the pagehide beacon).
  `batch35-bank-peek` follows the new peek answer and watch; `batch17-bank-check` expects Cancel under the frame and the still-waiting line.
- **Tests (later additions):** the heartbeat (a peek records it; 2 minutes stays, 3+ ends like Cancel; a stale one that went through is recorded paid; an
  away charge stays); the reservation's rows carry its Cancel this check and it cancels at Stripe; an older page's Pay what you owe press is refused with the
  in-flight line (and "already reserved" only once reserved); a new chargeback during a reservation is named with what happens to it; the Owed box follows a
  redraw while an undrawn change still stops once. `batch35-payment-proofs` expects the in-flight line where another tab presses during the press's check.
- **Recordings:** halted by the owner (Nov 3) before a final set; none belong to this section yet.

## §166 The name is the green profile link everywhere; no "See her profile" (owner, Nov 3)

Owner, on the developer's test page (Testers, under a tester's fold): "remove see her profile — I've said the name itself should be green everywhere." Then, on
the same fold: remove the "On BB's profile: “…”" lines above Chat, and the "bb: 1.0 ★ (1 rating)" line at the bottom.

- **One helper:** §137's `NameLink` (`src/components/Cut.tsx`), now for a person's name in headings, rows and hover cards as well as sentences. Two options:
  `whole` (a hover card's own heading: the full name, wrapping anywhere, as the card showed it before) and `newTab` (the Invite box's rows, which opened the
  profile in a new tab so the ticks stay).
- **Removed, every separate profile link next to a person:** the tester's fold summary ("See her profile", `data-tester-profile`); the Testers circle's card;
  `PersonHover`'s card (Messages, chat, the session page's developer); the developer dashboard's seats card (`Seats`, `Ui.tsx`); the join page's "See his
  profile and other tests". `PersonHoverInfo.poss` and `Seats`' `pronoun` went with them (nothing else read them).
- **Now the green name link:**
  - the developer's test page: the tester's fold heading (a press on the name opens the profile; a press anywhere else on the heading, the arrow, the badges or
    the space after the name, still opens or closes the fold, since a link inside a `<summary>` doesn't toggle it); Needs you's person panels and update rows
    (were links already, now `NameLink`); Applications; the Invite box's rows, search reasons and Invited list (the rows were `text-inherit`, white or grey);
    the testers' calls (the name heading and the booked call and set rows); Call requests' tester; the paused view's Booked calls; the Access keys notice's
    "Given" list and Edit's "In use" list (`keyBoxes` now gives each key's `testerHref`);
  - hover cards: the trigger name (`PersonHover`: no longer painted white or grey by Messages and chat) and the card's heading;
  - the join page: "by <developer>" and "How <developer> reviews" (new tab, as the removed link did).
  - No link for a deleted account (the cut name alone), as §137.
- **Removed from the tester's fold:** the "On <name>'s profile (hidden while this test has an NDA): “…”" lines (the excerpts stay on the tester's profile, and the
  requests and Allow / Deny in Needs you are unchanged); and the "<name>: 1.0 ★ (1 rating)" line (`rateInfo`'s `avg` is gone; the circle's card keeps the
  rating summary, and the Rate box, "… rated you" and "You rated …" stay).
- **Unchanged:** the paused (restricted) view's "Shown excerpts" card ("On a tester's profile: “…”", no name); "Edit profile", "Your profile", "See it as testers
  do" and "How developers see you" (your own profile); "← Back to the profile"; rows that are one link to their item (the tester's History cards, Find cards,
  Tests visited, the Messages row's last line, "Rate <name> · 14 days left" in Needs you, the testers' calls' "<name> requested …" links to the request); names
  inside a tick box's label (End early's and the call panel's tick lists, the keys warning), where a link would steal the tick; "By question"'s names and the
  "No longer working" list, which link to the tester's row on the page; the admin's chat transcripts; server-built text (bells, emails, live lines).
- **Tests:** `tests/batch35-green-names.test.ts` (no source file draws a "See her / his / their profile" link or `data-tester-profile`; `NameLink`'s `whole` and
  `newTab`; the hover cards, the circle's card and the seats card render the name as the link with no profile line; the join page; every name on the test page
  and its panels is a `NameLink`; in the app, the fold's heading is her green link inside the toggle, Chat stays, and no "See her profile", "On …'s profile" or
  rating line shows, while her profile still lists the excerpt). Updated: `batch35-tester-folds`, `batch35-name-links`, `long-text-cut`,
  `batch35-messages-hover`, `batch35-answering-press`. **Pictures:** `C:/Users/march/Projects/playtest-lite-evidence/green-names/` (desktop and phone: the
  tester fold, the circle's hover card, the whole test page; `checks.json`: the name's colour is the green rgb(216, 252, 82) in the fold and on the card, a press
  on the heading beside the name still opens and closes the fold, and no "See her profile" or "On BB's profile" shows).

## §168 Next round is one tap with an empty name; a closed test has no Edit (owner, Nov 3)

The owner: "Round 2 to be a one tap button that opens a draft each time with no name (name field empty); shouldn't do any weird detection if previous drafts
were open (it is up to [the developer] to take care of naming them differently) but rest filled in with saved edit info — also closed tests to have no edit."

Replaces batch 16 §21's and batch 27 §2's next-round rules and the Oct 28 one-draft rule ("Only one next round per test").

### Next round: one tap, a new draft every press
- Pressing **Next round** makes a new draft at once and opens it in Post a test (`/app/tests/new?draft=<id>`), every time. There is no box ("A copy of this test for
  your next build…"), no **Start the next round**, no stop-once gate, no **Go to the next round**, and no "This test already has a next round." Drafts made
  before (in this tab or another) are never looked for: several drafts from one test are fine, and the developer names them.
- The draft's name is **empty**: Post a test shows the name field empty, and Post refuses it with the form's own line (**Give the test a title.**). Everything
  else is this test's saved details, as before: the listing, questions, devices, languages, parts and prices, deadline, Open until, join mode, NDA and Mature,
  spots capped at 10 (batch 31); `round` is this test's round + 1 and `previousId` this test. Access keys are not copied (they never were): Post asks for them.
- Kept: the subscriber perk (`requirePerk "nextRound"`, "Next round needs a subscription ($7/month).", the Subscribers tag), the hold refusal
  ("… Your tests are paused until then."), the suspended / held / team-paused / team-stopped refusals, and no Next round on a draft or in the restricted view.
- Kept: "Starting a next round never changes this round". Its "Round N was started" event is recorded **once per press** (two drafts: two lines). It no longer
  moves this test's version, so it never stops an Edit Save either.
- Another tab's Next round is no longer one of the developer's own-action lines (`BIG_OWN_ACTS`, the action log's "started the next round"): it stops no
  press and shows no live line, since it never changes this test.
- Removed: `goNextRound`, `NO_NEXT_ROUND`, the "go-next-round" press, its route action and its suspended / team-pause exceptions, its press label, the
  `nextRoundId` lookup on the test page, and the "exists" refusal. A "go-next-round" press from an old page gets "That action doesn't exist."

### Where a draft with no name shows: "Untitled draft (round 2)"
`testTitleOf` / `untitledDraft` (`lib/rules.ts`): the dashboard's test card, Post a test's note ("A draft: Untitled draft (round 2). Give it a name, check the
details, then press Post the test to open it for testers."), the team's test lists and user activity (`testLink`, `testRow`), the team's view of the test
(`/app/find/<id>`), and a refused press's line ("Your Post the test on Untitled draft (round 2) didn't go through"). A draft has no testers, so it is never in
History, Payments, the bell or an email.

### A closed test has no Edit
- A closed test (Open until passed and every tester's work ended) hides Edit like a stopped one: no Edit button, the join-mode badge is plain text (not a link
  to Edit), no "Change in Edit" by the spots, and no "delete a free key in Edit" hint in the Access keys notice. The Invite panel ("Add spots in Edit") was
  already hidden once the work ended.
- `/app/tests/<id>/edit` on a closed test shows **This test is closed, so it can't be edited.** instead of the form, and Save (an older page's too, confirmed or
  not) is refused with the same line (`closed`), never a stop-once.
- Nothing a closed test needed from Edit is lost: a test only closes after its Open until has passed, which §112 already locks, and a test with no Open until
  can't be given one (Open until can only be extended, design doc 5 / §54). What goes is wording-only edits (name, instructions, prices, spots, keys) on a test
  nobody can join any more.

Tests: `tests/batch35-next-round-one-tap.test.ts`, with the older next-round tests updated (flow, batch 7, 8, 16, 27, 29, 30) and the stop-once tests that
used Next round as their press now using Stop (calls, stop-again, batch 4, 30c, 35 numbers-notes, one-rename-line, current-timezone).

## §167 What's added goes under its question, dated; at most 10 additions per part (owner, Nov 3)

Replaces, in §136: "Add more" opens one box for the whole written part (`add:<session>`); "One list per part, 'Added'" (a part is one list, each addition under a
small "Added" label with no time); the live line, bell and email "Ana added to her written answers" for written answers. Also §139's small panel around the
tester's own sent answers (their question folds now hold the boxes, which a 12rem scroll panel would squeeze). The rest of §136 stands.

- **The developer's view** (Needs you, the update row, the tester row's paid part, the admin's "See the work"; `SentWork`):
  - each question is its own fold (the `Fold` component, closed at first), titled with the question (a long one cut to 2 lines, the whole question inside),
    "· 2 added" when it has additions, a small "new question" tag on one that came with changed questions;
  - inside, indented one step: the answer, then each addition to it, oldest first, under "Added · Nov 3, 2026, 11:29 PM" (`fmtStampIn`, the viewer's zone;
    the admin's: `dateZone()`); additions are indented the same as the answer; files placed in them show in place as before;
  - then the notes; a changed-questions send's own notes and loose files, under their dated "Added"; the files sent first not placed in an answer;
  - additions made before §167 (no question) go under one more fold at the end, "Added (not about one question)", each with its date (every addition has had
    its time stored since §136, so all of them are dated);
  - changed questions: a new question gets its own fold (tag "new question") with its answer and its additions; a question kept from before whose answer
    changed gets the new answer as an addition under it; one carried over unchanged adds nothing;
  - a link to the part (`#piece-…`, `#update-…`, `#part-…`) opens the part's folds but not its question folds (`Fold jumpOpen={false}`): the count says which
    changed;
  - "By question": what was added to a question follows its answer there ("*Added · <date>*" and the text); additions with no question stay in "Other notes".
- **Recordings** are not about questions: their list is unchanged, with the date next to each "Added" (the developer's views and the tester's own list).
- **The tester** (`WrittenAddForm`, one per question): after Send, her own page shows the same folds; each current question's fold ends with "Add to this
  answer", which opens the same box as before (Bold, Italic, Code block, 📎, the 50,000 count, the stop-once / windows / paused / ended rules), sent with "Add to
  my answer" ("Added to your answer."). Drafts are per question: `add:<session>:<questionKey>`; a kept draft opens its question's fold. A question no longer
  asked (an earlier set) has no box.
- **Data:** an addition stores `questionKey` (no migration: `Submission.additions` is JSON). The key is a short hash of the question's text
  (`questionKey` in `src/lib/additions.ts`), since answers are matched by question text everywhere (`carryOver`, `restoreDraft`); a repeated question in one set
  gets "-2". Only the uploads placed in the text (by their markers) go with an addition now: another question's box may hold the others.
- **Telling the developer:** "Ana added to her answer to “What did you think of level 2?”" (the live line; "… after you paid", "… (already paid the most)"), the
  bell and email "… for “Harbor Run”", the tester's "Work sent" bell "What you added to your answer to “…” was sent to Nora Lane.", and her line in another
  tab "You added to your answer to “…”". A question longer than 80 characters is cut with "…" in these lines.
- **Refusals:** an older page's general Add more (no question): "Add to one question: open it in your answers and use Add to this answer." (409). A question
  not in the current questions: "That question isn't one of your current questions. Reload the page and add under one of them." An older page's Send my updated
  answers now reads "… Use Add to this answer under a question to add to them."
- **At most 10 additions per written part** (owner, Nov 3): every addition counts, across all questions: old ones with no question, and the answers to changed
  questions (they are stored as additions). The changed-questions Send itself is never refused for it (the new questions must be answerable); only Add is.
  - Before the cap, once there is an addition: "3 of 10 additions left" above the question folds.
  - At 10: every question's box shows a grey note instead of its button: "You've added to this part 10 times, the most it takes."; a kept draft shows read-only.
  - The server counts under the test's lock (the same lock the add takes), so two adds at the 10th give exactly one; the other, and an older page's add past
    10, get the same line as a refusal (409 `add_full`). Recordings keep their 5 (§136).
- **Tests:** `tests/batch35-added-per-question.test.ts` (the folds, count and dates; old additions in the last fold; changed questions; the per-question add, its
  key and draft key; the general Add refused; the live line, bell, email and own line naming the question; reaching 10, the 11th refused from an older page and at
  the same moment; the note and the remaining count). `batch35-sent-locked` and the tests that added to written answers now add under a question.

## §163 "The call can't connect."; one Decide wording; the admin sees Decide's result; Pay refused at once after the tester's choice; other-tab Confirms are own lines; no Charge once the developer paid (owner, Nov 3)

- **The call room (`app/app/calls/[id]/CallRoom.tsx`, `lib/callMeasure.ts`).** When the browsers can't find any usable path (a strict network with no relay, or
  a relay that can't be reached), Chrome never reaches "failed": the connection stays "new" or "connecting", and both people saw "Waiting for <name>…" next to
  a black tile, as if the other hadn't joined.
  - The owner's wording, replacing "Couldn't connect directly (a strict network?). Try another network, or reschedule.": **"The call can't connect."**
    (`CANT_CONNECT_LINE`). It shows when the connection fails, and when both are in the room (the room's polls say the other person is here) and this
    connection hasn't connected within 20 seconds (`CANT_CONNECT_MS`). Each fresh connection (the start, the other person coming back) gets its own 20
    seconds. Connecting later clears it ("Connected").
  - "Waiting for <name>…" shows only while the other person really isn't in the room; in the room but not connected yet reads "Connecting…". "<name> left
    the call" and "<name> lost connection…" are as before. The status line is now made from the room's state (`roomStatusLine`).
  - The other tile says "Connecting…" until media flows (the connection reached "connected"), not just because `ontrack` fired (which set the picture before
    any media came, so the note was skipped). Leave, Rejoin and the fresh connection when either comes back are unchanged.
  - (Owner-approved, Nov 4) A redraw of the call page no longer hangs up the call. The room's effect listed the `iceServers` array prop among its
    dependencies, so any redraw that handed it a new array of the same servers (`router.refresh()`: `TimeZoneSync` refreshes once when the account's saved time
    zone differs from the browser's, and a new account's is empty; a hot reload on the dev server) hung up and rejoined, and the other side rebuilt too (seen
    about 10 seconds after connecting in a baseline run). The page's ICE servers are now held in a ref (`pageIce`); the effect re-runs only for a new call,
    side, name or relay mode. The join's answer still supplies the servers it connects with (§135).
- **One wording when the decision equals what's paid now (`rules.decisionWhat`, `payments.decideDispute`).** It read "raised the pay to $10.00, which was
  already paid: nothing more was charged" after a Pay more, and "kept the pay at $12.00" when $12.00 was decided after §149's "paid more than your decision"
  stop. Every decision that equals what's paid now (those two, and a blank box keeping the pay) now reads **"kept the pay at $12.00, which was already paid:
  nothing more was charged"**: the developer's test page line ("The team decided Ana Silva's dispute: kept the pay at $12.00, which was already paid: nothing
  more was charged"), the stop a later Pay or Pay more shows naming it, the admin's test timeline, both emails' lines and the admin's result. A raise that
  charges is unchanged ("raised the pay to $10.00 ($3.00 more)"); a rejected piece kept at nothing still reads "kept the pay at $0.00 (rejected)". The tester's
  own live line ("The team decided your dispute about your written answers: the pay stays at …" / "was raised to …") and the session page's "The team decided:
  $12.00 in all" don't reuse this line and are unchanged.
- **The admin sees the result, not just "Done." (`admin/DisputeDecision.tsx`, `rules.decideDoneLine`).** Decide's answer carries the server's result line and
  the box shows it in place of "Done.": "Done: raised the pay to $10.00 ($3.00 more charged).", "Done: kept the pay at $12.00, which was already paid: nothing
  more was charged.", or "Done: raised the pay to $10.00 ($3.00 more, not charged yet)." when the charge waits (a payment hold, the developer's bank, a declined
  card). After the console loads again the row has left Open disputes; like the admin's other actions, the result stays in **Your actions**: "<test> · Ana
  Silva (ana@…) · dispute decided by you: raised the pay to $10.00 ($3.00 more charged) · Nov 3, 3:10 PM", opening the dispute's row
  (`/admin?dispute=<id>`). Read from the server's records (the decision's payment row and its line on the test), only for the admin who decided it.
- **Pay on an old page after the tester's Charge or Let it go is refused on the FIRST press (`payments.review`).** The gate ran before those refusals, so with
  the developer's Alerts letting the Charge line through the first press stopped once ("Since you opened this page: Ana Silva charged $10.00…") and the second
  was refused ("Ana Silva already charged $10.00 for her written answers."). The tester's Charge, the tester's Let it go and the team's close-out are now
  refused before the gate, as §159 item 12: a stop is never shown when its second press could only be refused. "Confirm … with your bank first." (a Charge
  waiting for the bank) is still first.
  - Audit of the other payment presses for the same pattern: **Confirm all** stopped once ("what's waiting changed") when nothing was waiting any more, and its
    second press was refused "There's nothing waiting for your bank to confirm."; that is now the first press's refusal (also when the claim finds nothing
    left). **Pay more**: its refusals that can't be fixed (team closed, closed for Pay more, a payment waiting for the bank) already come before the gate.
    **Confirm with your bank**: every final refusal (confirmed, cancelled, ran out, paused, in Confirm all) comes before the gate.
- **The developer's own press in another tab that settled the SAME thing is ONE refusal (owner, Nov 4; replaces batch 16 §21's "another tab's Pay on this
  piece stops this press once, BEFORE it is refused as already done").** A stop is never shown when its second press could only be refused.
  - **Pay** on a part this developer already settled in another tab is refused on the first press, naming the tab and the time (`live.ownOtherTabAction`, the
    part's latest own Pay, Reject or Confirm): "You already paid $10.00 for Ana Silva's written answers in another tab at 3:20 PM.", "You already rejected Ana
    Silva's written answers in another tab at 3:20 PM.", and after a Confirm with your bank there: "You already confirmed Ana Silva's $10.00 charge for her
    written answers with your bank in another tab at 3:20 PM." From the same tab, or a part settled otherwise, the plain refusals as before ("You already paid
    $10.00 for Ana Silva's written answers."). Every refusal of an already settled part now comes without the gate first.
  - **Pay more** on that part still stops once ("You paid Ana Silva $10.00 for the written answers in another tab"), then goes ahead within what's left. More
    than what's left before the most is refused with its usual line on the first press, never after a stop (Pay's over-the-cap refusal likewise).
  - **Confirm with your bank** on a charge already confirmed in another tab: "You already confirmed this payment in another tab at 3:20 PM." (the plain "You
    already confirmed this payment." from the same tab), on the start and on an old bank page's finish.
  - **Confirm all** from an old tab covering a charge confirmed in another tab: it can still go ahead for the rest, so it stops once naming that item ("You
    confirmed Ana Silva's $10.00 charge for her written answers with your bank in another tab", then "Confirm all now covers 1 payment: $30.00.") and the second
    press pays the rest. Every item it covered confirmed in another tab: ONE refusal, "You already confirmed these payments in another tab at 3:20 PM." ("this
    payment" for one).
  - Unchanged: every other own action in another tab (another part, another charge, any other press) stops every press once, whatever the Alerts (§61/§67); a
    Confirm in another tab feeds that too (above). Pay what you owe's §159 item 13 lines ("You already paid what you owe ($27.00) in another tab at 3:20 PM.")
    were already single refusals.
- **A Confirm with your bank or a Confirm all in ANOTHER tab is one of the developer's own other-tab lines (`actionText.logConfirmed`, the confirm and
  confirm-all routes).** Every charge made while the developer was away that they confirm with their bank (a tester's Charge on written answers or a recording, a
  call's charge, the team's decision, a Pay more, a retried chargeback; one by one, in Confirm all, or in Pay what you owe's one payment) writes ONE own line per
  item: "You confirmed Ana Silva's $10.00 charge for her written answers with your bank in another tab" ("… for her live call", "You confirmed the team's $6.00
  dispute decision on Ana Silva's written answers …", "You confirmed your $5.00 Pay more for …", "You confirmed your $10.00 payment again for …" for a retried
  chargeback). The other tabs show it wherever a Pay made there shows: every developer press's stop box (own other-tab actions always stop once) and §160's blue
  notice inside an open bank box; the tab that pressed never does. It touches its piece and answers it (§86) as a Pay does.
  - Before: a call's charge wasn't logged at all (the route needed a written part), and the others read "You paid Ana Silva $10.00 for the written answers in
    another tab", next to a second line for the same item, "Payment went through on Harbor Run: $10.00 to Ana Silva for the written answers" (in every tab,
    the pressing one included). That second line is now left out for a charge the developer confirmed themselves on this test (`devPaymentChanges`), so each
    item is one line. Confirm all lists one line per item, as Pay what you owe's one payment does.
- **Charge and Let it go are gone once the developer paid anything on the part (`rules.chargeAmount`, `holds.chooseOutcome` / `claimChoice` /
  `devPaidRefusal`).** Replaces the owner's Oct 26 rule that Charge offers "the listing minus what was paid": Charge offers the listing, and nothing once a
  developer Pay or Pay more went through on that part. The tester's way to more is Dispute (within the dispute rules). A payment still at the bank or on its way
  keeps "A payment for this is being confirmed right now."; a payment cancelled or declined that left nothing paid doesn't count (Charge as before, for the
  full listing).
  - The tester's page shows no Charge or Let it go on such a part and offers Dispute; the daily job never opens Charge for it, and no "Charge or let go" line,
    "Pay now" line, email or To do item offers it (all read `chargeAmount`).
  - A press from an older page, or at the same moment, gets ONE final refusal, decided under the test's row lock in `claimChoice` (and again before any stop):
    "Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be more." ("paid $6.00 and $2.00 more" after a Pay more; paid in full:
    "Nora Lane paid $10.00 for this meanwhile: you can dispute it …"). It replaces §159 item 4's stop-once for a developer payment on the part being charged and
    §146/§159's "Charge stops once, the next press charges what's left" (a same-moment Pay that landed first read "This was already settled."). The team's
    decision on her disputes still stops Charge once, where Charge still exists.
  - The automatic charge of a listed call (batch 28 §21, the call's stand-in for Charge): it already runs only for calls with no developer Pay (any Pay makes the
    call's review, and the sweep takes only calls without one), so it never tops up a call the developer paid. Its amount reads the same `chargeAmount`, so money
    recorded on the call any other way now closes it with nothing more charged instead of charging the rest.
- **Tests:** `tests/batch35-call-decide-lines.test.ts` (the line and its 20-second timer, failed, cleared on connect, "Waiting…" only while the other isn't
  there, the tile's "Connecting…"; the one wording after a Pay more, after the §149 stop and for a blank box, with Pay more's stop naming it; the route's result
  line and Your actions after the reload; Pay on an old page after a Charge and after a Let it go refused on the first press; Confirm
  all with nothing waiting refused at once; a Confirm in tab B in tab A's open bank box and its next Pay's stop box, for written answers and a call, Confirm
  all naming each item once, the other kinds' wording, nothing in the pressing tab; own other-tab Pay and Reject on the same part refused at once with the tab and time, Pay more stopping once then going ahead and refused at once past the most, another part stopping once then going ahead, an old tab's Confirm and Pay after a Confirm there refused at once, Confirm all naming an item confirmed elsewhere then paying the rest, and one refusal when all were; the ICE servers held in a ref). `tests/batch35-charge-after-pay.test.ts` (no Charge after a partial Pay
  and Dispute offered on the tester's page, the daily job offering nothing, an older page's Charge and Let it go refused once with the line, a Pay more in the
  line, Charge and Pay at the same moment in both orders, a cancelled or declined payment leaving Charge for the full listing). Updated for the new lines:
  `batch21-call-room`, `batch35-decide-paid-above`, `races-nov3`, `batch22`, `batch10`, `batch12`, `batch17-close-out`, `batch35-answered-seen`,
  `batch35-decide-tick`, `pay`, `batch35-admin-drafts`, `choice`, `suspended-and-ask`, `pay-matrix`.

## §169 Alerts "All" ticks everything, and follows a single untick (owner, Nov 4)

Owner: "Ticking All in Alerts doesn't tick everything, and removing one while All is ticked doesn't untick it."

- **Causes (reproduced in the browser on an isolated server).**
  - All sent one save per type, one after another, and each instant tick was made on the list from when the click happened (a stale copy). So the boxes
    showed one tick at a time, moving down the list, with All unticked, until the last answer came back.
  - A poll (`/api/pulse`) or a page redraw asked before a save, and answered after it, put the older list back. The poll reads the ticks first and then
    works out the page's fingerprint, so its answer lands seconds later on a busy machine. With a 1.5 s slow poll, after ticking All the menu showed nothing
    ticked while the server had all 7, until the next poll 20 s later. After unticking Work sent with All ticked, Work sent and All ticked themselves again.
  - The server's per-type save read the list and then wrote it with no lock. 7 saves at the same moment (menu ticks and stop box chips mixed) kept only 3
    or 4 of the 7 types, in each of 5 rounds.
- **One request for All.** `POST /api/account/alerts { testId, keys, off }`: every type that can be changed here, ticked or unticked together. Greyed types
  (a paused or stopped test) and old stored ticks keep theirs.
- **Atomic saves.** Every save goes through `saveTestAlerts`, which locks the test row (`SELECT … FOR UPDATE`), applies the change and adds one to
  `Test.alertsV`. That covers All, one type, the older whole list and the stop box's "Don't stop me for" chip. Saves at the same moment are all kept. Every
  answer carries `{ ignored, v }`.
- **No stale lists.** The version comes with every save answer, the poll's `alerts`, the pages' `AlertsMenu` (`v`) and the other tabs' storage message.
  - A tab never takes a list older than the newest one it has accepted (`ignoredAlertsFresh`).
  - A save on the way (`startIgnoredAlertsSave`) shows its ticks at once, on the ticks shown now. They stay so over any poll, redraw or earlier answer that
    arrives meanwhile. If the save fails, only its own types go back.
- **All's tick.** `allAlertsOn`: ticked exactly while every open type is ticked. Unticking one unticks All at once, and ticking it again ticks All.
- **Migration.** `20261116090000_test_alerts_version` adds `Test.alertsV` (INTEGER, default 0). It is additive and nothing is rewritten.
- **Tests.** `tests/batch35-alerts-all-atomic.test.ts`:
  - All as one request in one version step, and unticking All;
  - greyed and old ticks kept;
  - 7 saves at once all kept, with distinct versions, plus two unticks at once, and All with a chip;
  - the poll's version older than a later save;
  - in the tab: an older poll ignored while a save is on the way and after it, a newer one taken, a failed save going back;
  - All following one untick and re-tick (`allAlertsOn` and the menu as drawn).

  Updated for the new shapes: `batch35-alerts-all` (§71), `batch35-alerts-per-test` and `batch20` §8 (the poll's `v`, the menu's request, `useIgnoredAlerts`
  with the version).
- **Recordings** (`playtest-lite-evidence/alerts-all/`):
  - `alerts-all-before.webm`: one tick at a time;
  - `alerts-all-slow-poll-before.webm` and `alerts-all-slow-poll-fixed.webm`: the stale poll;
  - `alerts-all-fixed.webm`: tick All in two tabs through a poll, untick one, re-tick it, untick All.

## §170 Five small fixes: sign-up all at once, a paid call's amount once, presses named, Cancel this check's line, the bank box's height (owner, Nov 4)

- **(1) Sign-up shows every mistake on the first press (owner decision).** Pressing Sign up with everything empty showed only the name, email and password
  lines; "Choose developer or tester.", the devices and languages lines, Terms and 18+ came a press later, once the email and password were valid. Now the server
  (`signUp` in `src/lib/server/passwords.ts`) reads the email and password without stopping and hands their lines to `readNewAccount` (`credentialMistakes`), so
  every line comes back at once, each red at its own field, in the form's order: choice, devices, languages, name, pronoun, bio, email, password, Terms, 18 or
  older. A valid email already in use ("An account with that email already exists") is the email's line, listed with the others. The page already sent the press
  with boxes red (§153's `allAtOnce`), so nothing changed there. Google's step (no email or password) was already all at once and keeps its order (choice,
  devices, languages, name, pronoun, bio, Terms, 18 or older). **Replaces** §134's and §153's "Email and password mistakes still come first". (The network's
  10-an-hour sign-up limit is checked once every line is fine, as before.)
- **(2) A paid call's row says the amount once.** The developer's Testers panel showed a paid call as "Took place · 30 min · paid $15.00 … paid $15.00": the badge
  (`callOverBadge`) and the row's right-hand amount. The badge now marks the labels that already name what was paid (`paidShown`: "paid $15.00", "Paid $0"), and
  the row's right-hand amount (`data-call-paid`, `src/app/app/tests/[id]/page.tsx`) shows only when the badge doesn't ("not paid yet", Rejected, let go).
- **(3) Refusals name the press, not the button's sentence.** The tester's dispute button reads "Send the dispute" and its refusals read "Your Send the dispute
  didn't go through: …". They now name the press by its route's label (`DISPUTE_PRESS` = `PRESS_VERBS.dispute`): "Your Dispute didn't go through: …", under the
  button and in the "meanwhile" line. `FormMistakes` takes `named` for this (the refusal's name; "press <button> again" keeps the button's words). The same
  problem, found and fixed: the written answers' "Send my answers" / "Send my answers to the new questions" ("Your Send my answers didn't go through") now reads
  "Your Send didn't go through", and "Add to my answer" reads "Your Add didn't go through" (§146's Add), as the server's own lines already named them. A guard
  test keeps any refusal under a button from naming "Send the …" or "… my …". Not changed: the labels §156 settled (Keep my current terms, Confirm with your
  bank, Switch to your … side, Send your side and the rest), which name the button as pressed.
- **(4) Cancel this check in another tab says plainly that it worked.** A Pay or Pay more whose bank window is open in another tab shows "Confirming with your
  bank" with Cancel this check (`BankWaiting own`, §160). Its successful cancel read "Your Confirm with your bank didn't go through: Your bank didn't confirm the
  payment, so nothing was charged." (the wrong press, and a failure for a cancel that worked). Now (`cancelledCheckLine`, `src/lib/bankNotice.ts`):
  - cancelled: "Cancelled: nothing was charged." (Confirm all's one check: "Cancelled: nothing was charged. Each payment is back to its own Confirm with your
    bank.");
  - a charge made while away, which Cancel keeps waiting (§160's exception): "Cancelled: nothing was charged. It still waits for your bank until Fri, Nov 6,
    4:26 PM." (the server's still-waiting refusal now carries its date as `by`);
  - Stripe says it had gone through: "Your bank already confirmed it: paid $10.00." (`alreadyConfirmedLine`). Pay what you owe's and Confirm all's Cancel this
    check (`cancelOwedCheck`) already answered with success lines ("Check cancelled: nothing was charged. …"); their gone-through line now names the amount the
    same way ("Your bank already confirmed it: paid $16.00.", was "Your bank already confirmed this payment: it's paid."; a second Cancel's refusal keeps that
    wording). Read with §160's Cancel rules: nothing about what Cancel does changed, only what the pressing tab says.
- **(5) The bank box fits on laptop screens.** The open bank check (`components/BankCheck.tsx`: title, the bank's frame at 28rem, the hint, Cancel and the blue
  notice at its bottom, about 670px) sat inside panels capped at 60-70% of the screen (Needs you's list and each tester's parts, `ResizeBox`; the `LIST_PANEL`
  caps), so at 1366×768 and 1280×720 Cancel, the notice and the bank's Complete were inside a scroll box. Approach (the simplest robust one): one CSS rule in
  `src/app/globals.css`: a panel (`[data-panel-box]`) or scroll list (`[data-scroll-list]`) holding an open bank check (`:has([data-bank-check])`) drops its
  height and max-height while the check is open, so it grows to fit the whole box; when the check closes, its own height (dragged or default) comes back. No
  script, nothing kept, every panel and every kind of check (the stand-in too) at once. The page itself still scrolls normally (at 1280×720 the notice's last
  line sits at the screen's bottom edge).
- **Tests:** `tests/batch35-small-ui.test.ts`: an all-empty sign-up press returns every line at once (and a tester's, and every kind of line together in order,
  the taken email among them, Google's step); the form's boxes take their lines; the paid call row with its amount once (the developer's page after a call's
  Pay) and the badge's `paidShown`; the Dispute, Send and Add refusals and the guard; Cancel this check's lines from the server's real answers (cancelled, an away
  charge still waiting with its date, already paid with its amount); the panel rule. `auth` (the short-password line with the rest given) and
  `batch35-one-card-checks` (the gone-through line with its amount) updated.
- **Pictures:** `playtest-lite-evidence/small-ui/before-1366x768.png`, `before-1280x720.png` (the box cut inside Needs you's panels) and `after-1366x768.png`,
  `after-1280x720.png` (the whole box: frame, hint, Cancel and the notice).

## §171 Stop rules v2 and four payment fixes (owner, Nov 4)

### A. The owner's new stop rules
1. **Same part always stops.** Pay and Pay more stop once for ANYTHING on the part being paid, whatever the Alerts ticks (forced, so the box offers no turn-off,
   §160b), unless the press can't go ahead at all (then it's §163's refusal). "Anything":
   - work sent, updated or added to that part (§159 rule 2, kept);
   - a dispute raised on it (A2 below covers it);
   - another payment on it: another tab's (an own line, already forced), a tester's Charge, Let it go or Charge opening, an automatic call charge, a team
     decision's charge, a payment going through or failing on it. The holds' "paid" / "rejected" / "choice" events now carry their part as their link
     (`part-<submission>`, `call-<call>`; the live box's line jumps there too), and `devPaymentChanges`' lines carry the payment's part (`piece`);
   - for a call: the tester reporting a problem with it ("Ana Silva reported a problem with the call on Thu, Nov 5, 3:00 PM: Was late") and its measured length
     becoming final ("The length of the call with Ana Silva on Thu, Nov 5, 3:00 PM is final: 30 minutes"). Neither has a test event, so the payment press reads
     them from the call (`live.payCallLines`, kinds `call_problem` / `call_length`, no Alerts type). The length is written once (`measuredAt`), so "changing" and
     "becoming final" are the same moment. The developer's own problem report doesn't stop their Pay (it's their own press, possibly in this same tab).
2. **A dispute by a tester, or the team's decision on it, stops every press about that tester once, whatever the Alerts.**
   - Developer side (`live.alwaysStops` with `pressContracts`: a payment press's contract and every `c:<contract>` the press touches): Pay and Pay more on any of
     their parts, End early including them, call requests with them, answering or cancelling them. Presses about the whole test (Stop, Next round, Edit Save,
     Invite) and about other testers follow the Disputes / Decisions ticks. Developer Rate keeps today's rule (an open dispute refuses it; the decision stops it
     once). **Block** has no stop-once gate and is only on profiles (owner, Oct 27): there is no Block on the test page, so nothing changed.
   - Tester side (`testerGate.disputeChange`): the team's decision on their dispute, or the developer adding their side, stops every press of theirs on that test
     once, even with Alerts Off, forced: Send, Add to this answer, a recording's add, Charge, Let it go, Dispute, Leave, call requests, Rate. Excerpt requests
     keep their own rules (their own route).
   - §159 rule 1 (the same tester's decision always stops payment presses) is kept; the tester's dispute now does the same.
3. **The middle ground.** The blue notice INSIDE an open bank window lists EVERYTHING about the payment's tester, whatever the Alerts ticks (`Press.wholeTester`,
   used only by the peek). Confirm all: each covered charge's tester (each covered charge's part runs its own peek lines; each line once). Lines about other
   testers keep following the ticks. The notice still never closes or stops the window.

### B. Payment fixes
4. **A single Confirm window whose check isn't the live one any more.** The page now sends the window's own PaymentIntent with each peek (`pi`, read from the
   client secret: `bankConfirm.checkPiOf`), and `bankPeek.notThisCheck` answers cancelled when the charge is covered (Confirm all: "This bank check was
   cancelled: it was moved into your Confirm all in another tab. Pressing Complete won't charge anything."; another one payment: "… it was moved into another
   payment in another tab …"), when its live check is a different PaymentIntent ("… a new bank check replaced it (in another tab, or after your Confirm all
   ended) …"), or when it was paid on another check ("… the payment already went through on another bank check …"). The owner's decision stands: Confirm all
   keeps claiming such a charge and cancelling its check. A page that sends no `pi` is still told about a cover.
5. **A hold starting cancels an open Pay more check too.** `holds.startHold` now releases the developer's open `needs_action` checks of kinds review, call AND
   extra: at Stripe first; one the bank already approved is recorded as paid once (`finishExtraPay`). The window reads "This bank check was cancelled: your tests
   were paused (a payment hold started). Pressing Complete won't charge anything."
6. **Pay what you owe while chargebacks change underneath it.**
   - (a) **A new chargeback during an approved review-first payment** (§161): `chargebackOpened`, after clearing the approval, cancels that account's open Pay
     what you owe check (`owedOnce.cancelOpenOwed`: Stripe first; already approved → recorded paid once via `finishConfirmed`; otherwise what it covered is owed
     again and the one payment keeps `failure` = `OWED_REVIEW_AGAIN`). The window: "This bank check was cancelled: a new chargeback arrived, so the team reviews
     your account again before you can pay. Pressing Complete won't charge anything."
   - (b) **A chargeback won while the window is open.** Chosen: cancel the open check at Stripe before anything else in `chargebackWon`, so Complete charges
     nothing and the developer pays the new total. If the bank had already approved it, it is recorded as paid once (its repayment row for the won chargeback is
     made by the normal settle) and that repayment is then refunded by `chargebackWon`'s existing refund step (the reversed amount + the fee to the card), which
     is the Terms' refund rule ("Payments aren't refunded, except when the platform wins a chargeback the developer already paid (the amount and the fee go back
     to their card)"); no credit balance exists in the app, so credit was not an option. A chargeback hold's reservation whose bank check is open
     (`needs_action`) and covers the won chargeback is cancelled at Stripe the same way (nothing reserved; Pay what you owe reserves the new total). A reservation
     already authorized ("reserved") is left alone: the team's Approve captures only what's still owed (`amount_to_capture`), so the won part is never taken.
     The window: "This bank check was cancelled: your bank decided a chargeback in your favour, so what you owe changed. Pressing Complete won't charge anything."
     (the one payment keeps `failure` = `OWED_WON_MEANWHILE`; a reservation's reason is read from its covered payments).
   - (c) **Every change in the stop box.** Pay what you owe's press-time stop now lists every change together (they replaced each other): "Another payment failed
     meanwhile: …" / "Added to what you owe meanwhile: …", "Your bank's chargeback of $10.00 was reversed in your favour: $25.00 taken off" (what the page showed
     for it, else the reversed amount + the fee), and "Your bank changed the amount it took back from your $20.00 payment for …: $12.00 → $20.00 (now $20.00 +
     $15.00 fee = $35.00)", then "New total $44.00." (when something was added or won) and the press-again line with the same total. The stop carries the box's
     lines and the new total as before (the Nov 3 A3 fix), so the bullets and the button agree. An older page without `seenAmounts` no longer guesses a changed amount
     when something was also added.
7. **Not built yet (the owner is deciding the waiting-charge rules):** "Confirm with your bank" on a charge made while away and Confirm all's items keep their
   press-time gate exactly as before (`Press.awayCharge`: §159's forced set only, no call lines). Their windows do get A3 and B4.

### C. Terms of Use (edited in place: TERMS_VERSION stays 2, no What changed entry; nothing has launched)
- New "Changes while you pay" under Paying for work: the approved text, with one sentence added for A2 ("A dispute by a tester, or the team's decision on it,
  also stops once every other press about that tester (End early, call requests and their answers), and the team's decision on a tester's dispute, or the
  developer adding their side to it, stops each of that tester's own presses on the test once."), and the approved example.
- Unreviewed work: "Charge and Let it go are offered only while the developer hasn't paid anything on that part; once they have, Dispute is the way to ask for
  more." ("up to what's left of the listing price" now reads "up to the listing price", §163.)
- Bank checks, declines, holds: "From an account's 2nd chargeback (every payment ever reversed counts), our team reviews the account before the developer can
  pay: once the team allows it, Pay what you owe charges everything owed as one payment and the tests resume; a new chargeback before paying needs the team's
  review again." (§161)
- §167 (10 additions per written part) and §168 (Next round's empty name) aren't described anywhere in the Terms, so nothing was added for them.

- **Code.** `live.ts` (`Press.wholeTester` / `awayCharge`, `alwaysStops`, `pressContracts`, `payCallLines`, `callProblemLine`, `callLengthLine`, `piece` on part
  lines and payment lines), `holds.ts` (event links, `startHold`, `chargebackOpened`, `chargebackWon`, `payOwed`'s stop text), `owedOnce.ts` (`cancelOpenOwed`,
  `OWED_REVIEW_AGAIN`, `OWED_WON_MEANWHILE`), `bankPeek.ts` (`notThisCheck`, `wholeTester`, Confirm all's per-tester lines, the new reasons), `bankNotice.ts`
  (`CANCELLED_WHY`), `bankConfirm.ts` (`checkPiOf`, `PeekTarget.pi`), `BankCheck.tsx` (sends `pi`), `testerGate.ts` (`disputeChange`), `confirm.ts` and
  `confirmAll.ts` (`awayCharge`), `termsOfUse.ts`. No migration.
- **Tests:** `tests/batch35-stop-rules-v2.test.ts` (A1: a payment on the part stops Pay more, forced, and follows the tick on another part; a Charge line on the
  part; the event links; a call's problem report and final length; A2: End early, Pay on another part for a dispute, which presses are about them, Stop follows
  the ticks, the tester's presses with Alerts Off; A3: Pay's window and Confirm all's window; item 7: Confirm keeps its gate; B4: Confirm all took it over,
  replaced, paid on another check; B5: cancelled, and already approved; B6 a and b: cancelled, and already approved (recorded once; refunded for a win), the
  reservation; B6 c: every change in one stop, then the new total paid; C: the Terms). Updated: `batch35-bank-notice` (another tester's ticked-off line isn't a
  line, this tester's is), `batch35-bank-peek` (the peek sends `pi`), `batch19` (the Terms' headings).

## §172 Team pause = developer suspension (owner, Nov 4)

The owner: "Make the team's pause of a test the same exact rules as a developer suspension." This replaces batch 15 sections 1, 23 and 37 (chat and the
pair of presses on a team-paused test), batch 17 §14 ("both sides rate a test the team paused"), batch 19 section 2 (the banner's "rate testers") and the old
split where Pay worked on a team-paused test but Pay more didn't. For the ONE test the team paused, everything follows what a developer suspension does to each
of that developer's tests, for both sides, with the team's wording ("The team paused this test…", never "suspended" or "hold"). The developer's other tests,
their account, their subscription and their Payments page are unaffected.

"Paused by the team" now means `adminPausedAt` is set and the test isn't stopped (`teamPausedNow`, lib/restricted.ts): a stopped or closed test isn't paused
any more (the team can't lift a pause on a stopped test, so nothing may wait for that lift).

### Developer: before → after, per press or item
| Press / item on the team-paused test | Before | After (§172) |
|---|---|---|
| Stop, End early, Cancel call, their side of a dispute | Allowed (stop-once; the pause stops an older page once) | Unchanged (`TEAM_PAUSED_OK_ACTIONS` is now `RESTRICTED_OK_ACTIONS`) |
| Rate | Allowed straight through; Rate box in the restricted view | Hidden; refused `409 inactive` "The team paused this test: you can rate once the pause is lifted." Its 14 days pause while the team's pause is on (as a suspended developer's). Ratings to give and the reminders leave it out |
| Chat: Send | Allowed | Refused, back to the test's banner ("Your Send on … didn't go through: the team paused this test."). That test's chat page sends the developer to the test; "Chat with <name>" for that test's tester: "Unable to chat with this tester." |
| Pay (test page, dashboard) | Went through (`/api/review` had no check) | Refused `409 admin_paused` "The team paused this test: Pay waits until the pause is lifted.", back to the test's banner (`testId` in the refusal; client.ts follows it). Backstop under the test's lock; a Pay whose bank check came back as the pause landed is cancelled and refused (as a suspension's) |
| Pay more | Refused with the old banner line | Refused, the new line; backstops "…extra pay waits until the pause is lifted." |
| Confirm with your bank (that test's waiting charges) | Allowed | Refused under the button: "The team paused this test: Confirm with your bank waits until the pause is lifted." A check already open still finishes (§159 rule 4b) |
| Confirm all | Covered that test's charges | Leaves that test's charges out; one the team paused after the page loaded stops once ("…: the team paused its test") |
| Edit, invites (and their search / check), Accept / Decline an application, call requests and answers, a call set's Cancel, a broken key's dismiss, a no-show report, Next round | Refused | Refused (new line: "The team paused this test: you can stop it, end testers' work early, cancel calls, or add your side of a dispute.") |
| Their own Pay / Pay more whose bank page is open at the pause | Left open | Cancelled at Stripe first (one already approved is recorded as paid once), as §159 rule 9 / §171 B5 do at a suspension; the window says "This bank check was cancelled: the team paused this test. Pressing Complete won't charge anything." |
| Calls on that test | Kept | Within 3 days: cancelled with no fault at the pause (both told, the suspension's line); later ones 3 days before they start if the pause still lasts (the daily job) |
| A listed call's automatic charge (7 days after) | Skipped while paused | Made, then waiting (as under a suspension): "…charged automatically: $15.00, charged when the team lifts the pause on this test"; charged at the lift |
| Waiting charges ("deferred") on that test | Charged by the 5-minute sweep | Wait for the lift (or the test's stop or close), as a suspended developer's wait for the reinstatement |
| Pause email | "For now you can stop it, end testers' work early, or cancel calls." | "For now you can stop it, end testers' work early, cancel calls, or add your side of a dispute. Chat, Pay, Pay more, Confirm with your bank and Rate on this test wait until the team lifts the pause." (+ "2 calls in the next 3 days were cancelled. Later calls are cancelled 3 days before they start if the pause still lasts." when any were) |
| The red banner's last line (any pause) | "…cancel calls, or rate testers." | "…cancel calls, or add your side of a dispute." (when a dispute waits for their side; Rate never shows on a paused test) |
| Lift (Lift the pause) | Clocks moved on; developer told | Also: that test's waiting charges are made now (one payment, `chargeDeferred`; not while a hold or suspension is on) and its working testers are told "“…” is running again. Your deadline moved on by the pause.", as a reinstatement does |

Already identical before (unchanged): requests close at the pause, open invites close (`markPaused`), applications wait, one 7-day closing clock, deadlines and
review clocks move on at the lift, reminders wait, excerpt Allow / Deny, the tester's Charge (charged at once, as under a suspension).

### Tester: before → after
| Item | Before | After (§172) |
|---|---|---|
| Send work, request calls, join | Refused (paused) | Unchanged |
| Chat: Send | Allowed | Turned back: "Messages are paused for now, so this wasn't sent." The chat page shows "Messages are paused for now. You can still read this chat." |
| Rate | Allowed | Unchanged (a developer suspension never stops the tester's Rate) |
| Charge / Let it go, dispute, leave, cancel calls, drafts | Allowed | Unchanged |
| Booked calls | Kept | Cancelled within 3 days (later ones 3 days before), with the neutral "paused" line |
| A listed call's automatic charge | Not made while paused | Made; "Payment for your call may be delayed" until the lift |
| At the lift | No line | "“…” is running again. Your deadline moved on by the pause." |

### Open questions (built as below; the owner may want otherwise)
1. **A stopped or closed test is no longer team-paused.** Before, the route kept refusing presses (Pay more, chat…) on a test the developer stopped while the team
   had paused it. Now a stopped test follows a stopped test's rules, and its waiting charges are made by the next sweep. Related, not changed: the close-out
   (`closeOut.ts testSpans`) still counts a pause recorded on a stopped test as still running, so Pay more and the tester's Rate on such a test never close.
2. **Account-wide parts of a suspension are not applied** (billing pause, Post a test, Block / Report, direct messages, Payments page): the decision is scoped to
   the one test.
3. **Confirm all** leaves the paused test's charges out without a "not in Confirm all" line (a suspension refuses Confirm all outright); each still shows its own
   Confirm with your bank, which is refused with the team's line.
4. **A waiting charge's 3 days to confirm keep running** during the pause, as under a suspension: if they run out it counts as declined (a payment hold). A team
   pause can run longer than a suspension usually does.
5. **The developer's chat page of that test** sends them to the test page (a suspended developer's chat pages send them to the dashboard top).
6. **Pay what you owe** during a hold still includes that test's waiting charges (as it does a suspended and held developer's).
7. **Terms and help:** no text describes a team pause, so nothing was edited (no Terms version bump).

- **Code.** `restricted.ts` (`TEAM_PAUSED_OK_ACTIONS`, `teamPausedNow`, the lines), new `teamPause.ts`, `/api/tests/[id]/[action]` (`adminRefusal`),
  `/api/review`, `payments.ts` (Pay / Pay more backstops, `suspendedAfterCheck`), `confirm.ts`, `confirmAll.ts`, `messages.ts`, the chat page, `ratings.ts`,
  `closeOut.ts` (`teamPauseSpans` exported, ends at a stop), `holds.ts` (`autoChargeCalls`, `chargeDeferredLocked`), `restrictions.ts` (`pauseTest`,
  `unpauseTest`, `cancelCallsNearPause`, `cancelLatePauseCalls`), `bankNotice.ts` / `bankPeek.ts` (the cancelled window's reason), `TestBanner.tsx`, the test page
  (no Rate in the restricted view), `client.ts`, `rules.ts` (comments), `BLUE-NOTICES.md`. No migration.
- **Tests:** `tests/batch35-team-pause-suspension.test.ts` (new). Updated: `batch17-rate` (the developer's Rate waits; the tester rates), `batch19` (the banner
  line), `batch6` and `batch15-sides` (a team pause pauses that test's chat), `batch16-tester-states` (the developer's Pay after the page loaded is made with the pause
  lifted for that moment, since a team pause now refuses it).
## §173 The invite ticks survive a reload in the same tab (owner, Nov 4)
- The developer's Invite testers panel keeps its ticks in the tab's own storage (sessionStorage, `pt-invite-ticks:<account>:<test>`, `src/lib/inviteTicks.ts`), written as
  the ticks change. A reload (or coming back to the test page in that tab) ticks them again. Another tab, another browser or a closed tab starts with nothing ticked.
- On load only the people the panel can still invite right now come back ticked, by the lists' own rules (the server's `inviteRestore`, POST
  `/api/tests/<id>/invite-restore`: not in this test, not already invited, hasn't rated it, hasn't applied or asked to rejoin, not suspended, under 10 tests, not
  blocked either way, account not closed). Someone outside the current lists (ticked from an earlier search) stays selected and counts in "N selected", as before;
  the panel knows their row, so Invite sends what was shown for them and the live re-check (§109) unticks them if that changes.
- Everyone else is dropped, and one line under Invite names them with why, in the search rows' words (batch 30 §7):
  "Not ticked any more: Ana Silva (already in this test), Dee Moss (can't join this test)." Other reasons: "already invited, waiting for her to join",
  "applied: answer him in Needs you", "rated this test: can't join it again", "no longer in your list" (a block, never which side), "account closed". The line goes
  at the next tick or Invite. The panel opens when anything came back or was dropped. A dropped person is never ticked again by a later reload.
- A full, paused or closed test doesn't drop anyone: as before (batch 20 §10) Invite is disabled with its line and the ticks stay.
- Invite going through empties the ticks and the kept copy at once; unticking everyone does too. Nothing is written until the restore has answered, so the panel's
  empty start never wipes the kept ticks; offline at load, nothing comes back. Without storage the panel works as before.
- The search box is not kept (unchanged). Every sign-in and sign-out clears the tab's kept ticks with its other copies (§8 item 4, SessionWatch's `forgetTyped`), so
  after one the ticks start over.
- **Tests:** `tests/batch35-invite-ticks-kept.test.ts` (keeping, emptying, sign-in / sign-out clearing, no storage; the restore merge and the line; the server's keep
  and drop reasons for every case and the route; the panel clears on a successful Invite). `press-names` lists invite-restore as a read. No migration.
## §175 Confirm with your bank grouped under each tester's name on the test page (owner, Nov 4)

- **What changed.** On the developer's test page, the charges waiting for their bank ("Confirm with your bank") were listed flat at the top of Needs you, and
  in the restricted view (a hold or suspension) flat in "Your bank wants you to confirm". Both now list them **one group per tester**, headed by the tester's
  name as the green profile link (`NameLink`, §166), with every waiting charge about that tester under it, each with its own Confirm with your bank as before.
  Groups come in the order of their oldest charge; inside a group the charges are oldest first (`bankWaitingOnTest` already returns them by `createdAt`).
  Each group carries `data-bank-group="<contractId>"` (its heading `data-bank-group-name`); every existing hook (`data-bank-waiting`, `data-restricted-bank`,
  `data-bank-up`, the `bank-<id>` anchors) is unchanged.
- **The line drops the tester's name.** The line is built in one place (`bankWaitingOnTest` in `src/lib/server/confirm.ts`, shown only on this page), so it
  now names the piece by the tester's pronoun (§162; unset reads "their"): "Your bank wants you to confirm a $15.50 payment for her live call on “Harbor Run”
  (Oct 30), made while you were away. Confirm it by …", "… for the team's dispute decision on her written answers on …", "… for a payment your bank had
  reversed (her written answers on …) …". The hover (`full`) is the same line with the test's name uncut. `pieceName` / `pieceWords` take an optional
  `whose` for this; every other line (dashboard box, Payments, bell, emails, stop and notice texts) keeps the tester's name.
- **Links up.** The "Confirm with your bank in Needs you ↑" links under a tester's pieces and row still land on the charge itself, which now sits inside that
  tester's group (the jump centres it, so the name is right above it, and rings that one charge).
- **Not changed.** Confirm's behaviour: the stop-once check, the bank box, the over-$200 tick, notices and refusals. Layout only.
- **Code.** `src/app/app/tests/[id]/page.tsx` (`bankGroups` / `bankGrouped`), `src/lib/server/confirm.ts` (`piecesNamed`'s `theirs`, `bankWaitingOnTest`),
  `src/lib/bankTop.ts` and `src/lib/rules.ts` (`whose`). No migration.
- **Tests:** `tests/batch35-restricted-needs-you.test.ts` (two testers, three charges: Needs you and the held view each show two groups in oldest-charge order,
  each under the tester's green link, charges oldest first, the pronoun lines, the links up still on the charge). Updated: `batch17-bank-check`, `batch25`,
  `payment-piece-names` (the line's pronoun), `batch24` (the page's source check).
## §176 The dashboard's Confirm with your bank stops once for the team's decision after a redraw (owner bug, Nov 4)
- **Seen live (17:49-17:50 UTC).** fbbb's test excerpt, Nina Park; Alerts ticked off: payments, work, leaving, admin. A $5.00 charge made while away waited on
  Nina's written answers. The owner pressed Confirm with your bank on the dashboard (17:34:50), cancelled that check (17:49:53); at 17:49:55 the team decided
  Nina's call dispute ("The team decided Nina Park's dispute: raised the pay to $20.50 ($5.00 more)", Nina's contract) and its $5.00 charge on the call was
  made (17:49:56). The second Confirm press (17:50:15) opened the bank's check with no stop box, though §159 rule 1 (kept by §171 item 7, `awayCharge`) says
  the team's decision about that same tester always stops it once.
- **Cause.** Not the gate: `confirmStart` runs the same `devGate` (`payPressOf` + `awayCharge`) on every press that sends a seen marker, a check opened before
  included, and on the real rows it stops naming the decision (forced) for any seen time before 17:49:55. The seen marker was the problem: the dashboard
  passed its server render time (`now`) as `seenAt`, and the box redraws on its own (`AutoRefresh` "bank=1": the decision's new charge row changed `bankTopV`;
  "fresh=dashboard" too), so the press after the redraw sent a time after the decision. The dashboard has no top box or pill (and no `PageLoaded`), so the
  decision line was never shown there: §90's "an update the page has shown counts as seen" didn't apply, it was a bug.
- **Fix.** The dashboard's bank box keeps its first load's time across redraws (`components/KeepLoadTime.tsx`: the first render's time in state, given to the
  box's presses through context; `BankToConfirm` wraps the box). Confirm with your bank (`BankWaiting`) and Confirm all (`ConfirmAll`) under it send the earlier
  of that and the render time (batch 30's rule for pages whose redraws show no change lines); a row that appears after the load uses the same time; going back
  to the dashboard is a new load. The test page and Payments (no wrapper) are unchanged. A press there may now also stop once for a line the box's own new row
  stands for (a new charge's payment line, when Payments isn't ticked off): the box shows the row, not the line.
- **Tests.** `tests/batch35-dash-confirm-decision.test.ts` (the redraw's time goes ahead, the first load's stops once naming the decision, forced, and the
  second press goes ahead; another tester's charge follows the Decisions tick; Confirm all stops for it too; the wrapper and its readers).

## §174 Pay more on a call: the box greyed above its own bank check (owner bug, Nov 4)

Owner, Nov 4 (17:34 UTC): Pay more $2.00 on Nina Park's live call with a card that asks the bank every time; the bank box opened, Nina disputed that call 17 s
later, and the Pay more box above the open bank box turned grey with "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first.".
The owner also saw no blue notice for the dispute, and the box stay open after Cancel.

- **Cause (the grey box, fixed).** A redraw of the test page that reads the payments while the box's own check is open (a poll or refused-press redraw already on
  its way when the press answered, or one drawn just before the check ended) sends the box its OWN waiting row as `bankWaits` (§159), and PayBox showed every
  `bankWaits`. Reproduced on a local server (port 3471, test schema): a redraw landed about 4 s after the bank box opened and greyed it; after Cancel the line
  stayed until the next redraw (16 s with a slow page). Now the page sends the waiting payment's id with the line (`bankWaitsOf` in payments.ts;
  `bankWaitsLine` is unchanged for the server's refusals) and the box ignores it while its bank box is open, and for the check it just ended
  (`payMoreWaits` in bankNotice.ts). Another payment's wait on the part still greys it, as §159 says; the server still refuses a second Pay more while one waits.
- **The notice and Cancel (not reproduced).** On the real rows, the peek's gate for this call and payment returns "Nina Park disputed the pay for her live call"
  (forced: same tester, §171 A3); a test of the same flow (Pay more on a call open at the bank, then the tester's dispute) gets the line from the peek, and its
  Cancel answers 402 "nothing was charged" at once (the 3400 log has a 402 answered in 255 ms at about that point, most likely this Cancel). On the local server with the stand-in bank page
  the notice showed the dispute within 3 s and Cancel closed the box, with and without a slow redraw landing meanwhile. So the server side is right; what kept the
  owner's box from updating wasn't found. Seen at the same time on that account: another bank window (the $5.00 dispute-decision charge on Nina's written
  answers, "Confirm with your bank") was open and peeking every few seconds for over 20 minutes, and the test page took 12 to 16 s to draw.
- **Tests:** `tests/batch35-bank-box-call.test.ts` (the call's dispute is a peek line and reaches the notice; Cancel answers at once and cancels at Stripe; the
  waiting line names its payment; the box never greys itself for its own check, another payment's wait still does; every Pay more on the page gets the id).

## §177 Change lines name which part and which test (owner, Nov 4)

Seen in the developer's open bank window (blue notice): "Nina Park disputed the pay for her live call." and "The team decided Nina Park's dispute: raised the pay
to $20.50 ($5.00 more)". Nina has three live calls on that test and parts on two tests: the owner couldn't tell which call, which part or which test.

- **Rule.** Every change line the developer or tester reads names WHICH part: a tester has one written answers and one recording on a test (they keep their plain
  name), but many calls, so a call is always named with its date and time, as the call lines already were (`live call on Tue, Oct 27, 8:00 AM`; stored lines in the
  developer's saved zone, else the writer's request zone). A team decision names the part it decided. Shown anywhere but the test's own page, a line also names
  WHICH test: `On “<title, cut at 12>”: …` (rules.ts `onTestLine`; a leading You / Your / The / A lowercased; a line already naming its test, "On Sky Lab: …" or
  "Payment went through on Sky Lab: …", is kept). Bank windows send the page they are on (`page`, bankConfirm.ts `peekBank`), and so does "Confirm with your
  bank" (`BankWaiting`); a request without it counts as the test's own page. Bells and emails named the test already and now name the part too. Wording only:
  nothing changes what stops what. Stored rows keep their old text; new events get the new wording (the admin's "Your actions" and test history read the
  decision's line up to its first ": ", so a call's "8:00 AM" doesn't break them).
- **Also fixed (owner, the dashboard, same day).** "Charges made while you were away $5.00 (the team's dispute decision on Nina Park's live call on
  “excerptexcer…” (⟦t:2026-10-27T19:04:52.652Z:date⟧) $5.00)": a call's day is a time token in a payment's piece name (`paymentPiece`), and a few page paths
  printed it raw. Now written in the developer's saved zone where they leave the server: `owedOnce.coveredNames` (the dashboard's "Your bank wants you to
  confirm" rows, Payments' Confirm items, Pay what you owe's chargeback "covers"), `deferredForBox` (Payments' waiting charges: an automatic call charge's day),
  Confirm all's item names (`nameOf`: its stop lines and "leaves out" line), and the "Booked: you both picked …" message a request press returns. Bells and
  emails already wrote them (notify / renderFor); test events are written by the live box and stop boxes (`asLines` / `devLine`) and the admin pages
  (`renderDateText`).

| Where | Before | After |
| --- | --- | --- |
| Test event: dispute | Nina Park disputed the pay for her live call | Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM |
| Test event: team decision | The team decided Nina Park's dispute: raised the pay to $20.50 ($5.00 more) | The team decided Nina Park's dispute on her live call on Tue, Oct 27, 8:00 AM: raised the pay to $20.50 ($5.00 more) (written answers: "… dispute on her written answers: …") |
| Test event: tester's Charge on a call (also while a hold waits, and when it goes through later) | Ana Silva charged $15.00 for her call | Ana Silva charged $15.00 for her call on Tue, Oct 27, 8:00 AM |
| Test event: Let it go on a call | … let her call on (tester's zone) go: nothing charged | the same, in the developer's zone |
| Test events: automatic call charge | Ana Silva's call was charged automatically: $15.00 [, waiting for your bank to confirm it / , charged when your account is clear / , charged when the team lifts the pause on this test]; Ana Silva's call is waiting to be charged once your tests resume: $15.00; The automatic charge for Ana Silva's call ($15.00) was declined[: it was added to what you owe] | Ana Silva's call on Tue, Oct 27, 8:00 AM was charged automatically: … (each variant); … is waiting to be charged …; The automatic charge for Ana Silva's call on Tue, Oct 27, 8:00 AM ($15.00) was declined… ("closed with nothing to pay" had the time already: now the developer's zone, not UTC) |
| Test events: the developer's Pay / Pay more on a call | You paid Ana Silva $15.00 for the live call / … extra for the live call | … for the live call on Tue, Oct 27, 8:00 AM |
| Test events: chargebacks | You repaid the bank reversal of your $10.00 payment; The team resolved the bank reversal of your $10.00 payment; Your bank's chargeback of $10.00 was reversed: $25.00 … | … of your $10.00 payment for Ana Silva's written answers on “Harbor Run”; Your bank's chargeback of $10.00 for Ana Silva's written answers on “Harbor Run” was reversed: … (pieceName, as the chargeback's opening line) |
| Developer's payment lines (any test) | Payment went through on Harbor Run: $15.00 to Ana Silva for the live call; … for the dispute decision | … for the live call on Tue, Oct 27, 8:00 AM; … for the dispute decision on the live call on Tue, Oct 27, 8:00 AM (the same for "Payment failed on …") |
| Own other-tab lines | You paid Ana Silva $15.00 for the live call in another tab; You paid Ana Silva $5.00 more for her live call …; You confirmed Ana Silva's $15.00 charge for her live call with your bank …; You rejected Ana Silva's live call …; (tester) You charged Nora Lane $15.00 for your live call …; You opened a dispute …; You added your side to a dispute … | each call "live call on Tue, Oct 27, 8:00 AM"; You disputed the pay for your live call on … / your written answers in another tab; You added your side to Nina Park's dispute about her live call on … in another tab |
| Tester's lines (session page) | Nora Lane paid $15.00 for your live call; Nora Lane paid you $5.00 more for your live call; Nora Lane paid $5.00 for your dispute; Nora Lane's payment for your dispute ($5) is delayed | … for your live call on Tue, Oct 27, 8:00 AM; … for your dispute about the recording / the live call on … (lines about another test keep "on <title>") |
| Bank window, Confirm with your bank press, away from the test page | Nina Park disputed the pay for her live call | On “Harbor Run”: Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM (on the test page: no prefix) |
| Confirm all window | Ana Silva charged $5.00 meanwhile: it isn't in this payment; …; The team's dispute decision added $5.00 meanwhile: … | Ana Silva charged $5.00 for her written answers on “Harbor Run” meanwhile: …; Ana Silva charged $15.00 for her live call on “Harbor Run” (Tue, Oct 27, 8:00 AM) meanwhile: …; The team's dispute decision on Ana Silva's recording on “Harbor Run” added $5.00 meanwhile: …; The automatic charge for Ana Silva's live call on “Harbor Run” (…) added $15.00 meanwhile (it read "Ana Silva charged"); Your Pay more for … added $5.00 meanwhile |
| Pay what you owe window | Ana Silva charged $10.00 meanwhile: it's charged right after this payment goes through | the same heads as Confirm all's |
| Pay what you owe / Payments owed lines | Ana Silva's live call on “Harbor Run” $8.00 … | Ana Silva's live call on “Harbor Run” (Oct 27) $8.00 … (pieceName's day, as every other payment line names a call) |
| Bells / emails: disputes | Ana Silva disputed a payment on “Harbor Run”; Your dispute on “Harbor Run” was decided; A dispute on “Harbor Run” was decided | Ana Silva disputed the pay for her live call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST); Your dispute about your live call on “Harbor Run” (…) was decided; Ana Silva's dispute about her written answers on “Harbor Run” was decided |
| Bells: tester payments | Nora Lane paid you $15.00 for your live call on “Harbor Run”; … paid you $5.00 more for your live call on “Harbor Run”; Nora Lane paid $10.00 for your written answers (a delayed payment arriving); Nora Lane's payment for your written answers ($10) is delayed.; Payment for your call on “Harbor Run” may be delayed | … your live call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST); … for your written answers on “Harbor Run”; … for your written answers on “Harbor Run” ($10) is delayed.; Payment for your call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST) may be delayed |
| Bells: developer | Ana Silva's live call on “Harbor Run” ($15.00) is added to what you owe …; a declined Pay: … for Ana Silva's live call on “Harbor Run” | … live call on “Harbor Run” (Oct 27) … |

- **Not changed, and why.** Lines about written answers or a recording (one of each per tester per test: already exact). Call request, booking, cancel and
  call-problem lines (they carry the time already). Lines on the test's own page get no test name (the page is the test); lines about another test keep
  "On <title>: …" as they were. The tester's session-page lines (the page is the test). The admin's test history ("disputed the pay for her live call:") and
  the admins' bells: admin views. Stored rows: not rewritten. bankWaitingOnTest's lines (§175) and the restricted / team-pause lines (§172): they name the
  piece already.
- **Tests.** New `tests/specific-lines-177.test.ts` (the helpers; a dispute and the team's decision on a call with their bells and the admin's result line; a
  tester's Charge on a call; the payment lines' part, the developer's and the tester's; no raw time marker in the dashboard row, Payments' item, or Payments'
  waiting automatic charge). `batch35-bank-notice` (a window on the dashboard or Payments names the test, the test page's doesn't; the meanwhile lines),
  `batch35-dash-confirm-decision` (Confirm with your bank pressed on the dashboard names the test). Updated for the new wording: `batch10`, `batch11`,
  `batch28`, `batch29`, `batch23` (source check), `batch35-call-decide-lines`, `batch35-decide-paid-above`, `races-nov3`, `partial-dispute`, `pay-matrix`,
  `other-tab`, `stopped`, `addition`.

## §178 Chargeback races: a chargeback on the payment lifting the hold, an approval undone, two owed lines alike (owner, Nov 4)

Seen on the local site (developer fbbb, times UTC). (1) 19:44:52 Pay what you owe paid $67.50 on the 0259 card (every payment on it is disputed); its dispute
arrived 19:44:53 (Stripe's `charge.dispute.created`, answered 19:44:55). The chargeback was recorded on that one payment at 19:44:55.155 and the hold lifted at
19:44:55.213: no hold followed, with a chargeback open. (2) 19:47:35.770 a new chargeback hold started; the team approved at 19:47:35.991; a minute later the steps
read "not approved", with no new chargeback. (3) Payments listed "Your bank reversed $15.50 you paid for bb's live call on “excerptexcer…” (Nov 4): $15.50 + $15
chargeback fee" twice: two different calls (Oct 27, a few minutes apart), named by the day they were PAID.

- **Root causes.** (1) `liftHoldIfClear` checked "nothing owed, no chargeback open, approved" and then cleared the hold in a separate write; `chargebackOpened`
  recorded the chargeback in between (on the one payment the lift's own Pay what you owe had just made), found the hold still on (so `startHold` started none)
  and the lift then cleared it. (2) `chargebackOpened` cleared the card check and the approval once more at its very END, after starting the hold, the admins'
  emails and the bells (2 s in that case: Stripe's CLI log shows the webhook answered at 19:47:37), so the team's approval made the moment the hold showed was
  wiped. Only one `charge.dispute.created` came for that dispute; no `updated` in that window. Also: a retried `created` for a chargeback the team had resolved
  (or that was won) reopened it (the claim was "not open", not "never"). (3) `owedLines` named a reversed payment's piece with the payment's date
  (`p.createdAt`), and the other owed / receipt lines named a call by its day only (`T(d, "date")`).
- **Fix.** One lock decides the order: the developer's row lock (`SELECT … FOR UPDATE`, as Pay what you owe's claim takes it). `chargebackOpened` records the
  chargeback under it, and in the same transaction turns a hold that is on into a chargeback hold with no card check and no approval; `liftHoldIfClear` checks
  again under it (hold unchanged, nothing open or owed, steps done) before clearing. A chargeback that lands first stops the lift; one that lands after the lift
  finds no hold and starts a new chargeback hold. The late clear at the end is gone: a new chargeback hold starts with both empty in `startHold`'s own claim
  (reason "chargeback"), so an approval made while the opening is still being processed stands. A dispute is recorded once, ever: a delivery about a
  PaymentIntent that already carries a chargeback (open, resolved, won) changes nothing; if that chargeback is open and no hold is on (the old race left one), its
  chargeback hold starts. The one payment carries a dispute itself unless it covered exactly ONE ordinary item (never a reversed payment it was repaying: that
  one's own chargeback is open until the repayment is recorded, so a dispute arriving then was taken for the old one and dropped). The team's Approve of a 1st
  chargeback resolves only the chargebacks open when it is claimed (read under the lock): one that opens during the press stays open, and the hold stays.
- **Call names.** A call is named by its date AND time everywhere a payment line names it (§177's rule): Payments' owed lines and a reversed call payment's line
  ("… bb's live call on “excerptexcer…” (Tue, Oct 27, 7:15 AM): $15.50 + $15 chargeback fee") in the developer's saved zone, written, never a raw marker; what
  Pay what you owe / Confirm all / a waiting charge covers, the dashboard's and Payments' Confirm with your bank rows the same; receipts, declined-payment bells,
  the chargeback's test event, "charged automatically" lines, the tester's "paid you … for your call on …", and the Pay / Pay more receipts as a time token
  (each reader's zone, the zone named, as other bells). A sent part keeps its plain name (and a reversed one keeps the payment's day). Amounts and format unchanged.
- **Tests.** New `tests/chargeback-races-178.test.ts`: the chargeback after the lift (the owner's case) and before it; both orders at the same moment, forced
  with a held row lock; the open-with-no-hold repair; an approval made while the opening is processed; repeated `created` / `updated` notices and a resolved
  dispute arriving again never clear or reopen anything, a new dispute does; a 1st chargeback's Approve with a chargeback opening during it; two reversed calls'
  lines (date and time, the developer's zone, no marker), a receipt name and a covered item. Updated for the wording: `batch3`, `batch24`, `batch25`,
  `specific-lines-177`.
## §179 The tester's Live call list in a scroll panel past 3 calls (owner, Nov 4)
"Scroll box needed for different charges." On the tester's session page, "Live call: N done" lists every call with its payment box (the call's day and length
with its tag, "Paid $15.50 ($31.00/h): you get $12.40 …", "Charged automatically 7 days after the call.", the team's decision, "… can be paid more, up to …"), and
with several calls it ran very long.
- **The panel.** More than 3 calls (the done calls not yet paid and the paid ones, counted together): the list sits in the §152 draggable panel (`PanelWhen`,
  `live-calls-<sessionId>`), like past calls: the content scrolls inside, the grip drags it shorter or taller (up to 60% of the screen), and the dragged height is
  kept by the session's id through live redraws and reloads (this tab). It starts at `LIST_PANEL.liveTester` = min(27rem, 60vh), about 3 calls with their payment
  lines (the developer's past calls' height, which also carry payment boxes). 3 or fewer: a plain list, as before. The "Live call" heading, its rate line and the
  calls-left warning stay above it, outside the panel; each row keeps its hooks (`data-call-row`, `data-call-length`, `data-auto-charge`; the list itself
  `data-live-calls="N"`, plus `data-live-calls-scroll="N"` when it is a panel) and the part keeps `#part-live`.
- **Developer side.** The tester row's "Calls (N)" (each call with its payments, `part-pays-<callId>`, and its Pay more) was already a panel past 3 (`past-calls-<contractId>`,
  §152), and each call's payments a panel past 4: no change.
- **Jumps inside a panel.** A link's jump (`jumpTo`: `scrollIntoView`) already scrolls the panel and the page to the target. `bringInView` (a notice after a press,
  e.g. a dispute's error under a call in this panel, or a Pay more's in the developer's Calls (N)) moved only the page, so a notice scrolled out of its panel stayed
  hidden: it now scrolls the panel to it first (the least scrolling, at once), then the page as before.
- **Tests.** `tests/batch35-list-panels.test.ts` §179 (the source and height; `bringInView` inside a panel and outside one; the rendered tester page: 3 paid calls
  plain, a 4th makes the panel with all 4 rows and their "Paid $15.50" inside). `batch20`, `batch35-sent-panels`, `batch35-small-ui`, `batch35-leave-stops`,
  `batch35-tester-folds`, `batch16-tester-bugs`, `batch27` follow.
## §180 Confirm with your bank: a drop-down under each tester's name; no test name on its own page (owner, Nov 4; refines §175)

Owner: "i said dropdown under name for all confirms". Seen on the test page: the charge's line ran past the right edge of its panel ("…made while you were
away. C"), and named the test the page is already on ("… for her live call on “excerptexcer…” (Tue, Oct 27, 3:25 PM) …").

- **The drop-down.** On the developer's test page (Needs you, and the restricted view's "Your bank wants you to confirm"), each tester's waiting charges sit in
  one drop-down (`BankGroup`, src/components/BankGroup.tsx; the same `<details>` + `fold-chevron` row as Needs you's per-tester "N parts to pay"). The summary
  row: the tester's name as the green profile link (`NameLink`: clicking it opens the profile, clicking elsewhere on the row, Enter or Space opens or closes),
  then "· 2 charges waiting · $20.50". Inside, each charge's Confirm with your bank box exactly as before (stop-once, bank box, over-$200 tick unchanged).
  Groups and charges keep §175's order.
- **Closed at first; when it opens by itself.** A link that jumps to one of its charges opens it: `#bank-<id>` on load (the bell, the dashboard and Payments
  links) or on a hash change, and a click on an in-page link to one of its charges (the tester row's "Confirm with your bank in Needs you ↑"), before the
  browser scrolls to it (HashJump's `jumpTo` also opens folds above its target, as before). It also opens, and can't be closed, while one of its charges has
  its bank box open, a press under way, a stop box, or a refusal / "still waits" line showing (`useBankGroupHold` in BankWaiting): never closed over an open
  bank check. Not remembered across reloads (owner: keep it simple).
- **Lines name no test on the test's own page.** `bankWaitingOnTest` (shown only on this page) now writes "Your bank wants you to confirm a $15.50 payment
  for her live call (Tue, Oct 27, 3:25 PM), made while you were away. Confirm it by …" (`pieceName`'s `test: null`; the hover is the same line). Every other
  line keeps the test's name: the dashboard, Payments, bells, emails, Stripe descriptions.
- **Wrap.** The charge box is `min-w-0 max-w-full` and its line `[overflow-wrap:anywhere]`; the group's details and its content are `min-w-0`. Checked on a
  local server (port 3481, a throwaway test schema) at 1024 px and at 375 px, active and on a payment hold: no element in the groups is wider than its parent,
  no page-wide horizontal scroll; the lines wrap inside the panel with a bank box open too. (The exact cut in the owner's screenshot wasn't reproduced on this
  build; these rules keep the line inside the panel whatever its container.)
- **Hooks.** `data-bank-group="<contractId>"` (now on the `<details>`), `data-bank-group-name` (the name), new `data-bank-group-toggle` (the summary) and
  `data-bank-group-count`; `data-bank-waiting`, `data-restricted-bank`, `data-bank-up` and the `bank-<id>` anchors unchanged.
- **Tests.** `batch35-restricted-needs-you` (each group a closed `<details>` with the toggle; the summary "· 2 charges waiting · $14.00" after the green name;
  the lines name no test). Updated for the line without the test: `batch17-bank-check`, `batch25`, `payment-piece-names`.

## §181 Needs you: one drop-down per person, everything about them inside (owner, Nov 4; builds on §180)

Owner: "Is it possible in Needs you to have all notifications about the same person under each name" — "expandable"; the summary shows only the name and the
count; then "the parts should have big drop down with their name then part and pay/pay more as own dropdowns".

- **Before.** On the developer's test page Needs you was a run of separate sections: §180's per-tester "Confirm with your bank" drop-downs ("· 2 charges waiting ·
  $20.50"), then Applications, the call requests, the Rate lines, the excerpt requests, the disputes (Add your side), one open "N parts to pay" drop-down per tester
  (each part an open fold with "Pay" and its box under it), then the updates sent after paying (each its own row with the tester's name). The restricted view
  (hold, suspension, the team's pause) had four sections: "Your bank wants you to confirm" (§180's drop-downs), Booked calls, Excerpts, "Disputes: add your side".
- **After.** Needs you (both views) is one drop-down per person, closed at first. The summary: the person's name as the green profile link (`NameLink`: clicking
  it opens the profile; clicking elsewhere on the row, Enter or Space opens or closes), then "· N things" (nothing else: no amounts, no per-kind counts). Inside,
  everything in Needs you about that person, in this order, each kind under a small sub-heading only when the person has more than one kind:
  1. **Pay**: each part to pay is a drop-down of its own (closed), named plainly: "Written answers", "Recording", "Live call on Tue, Oct 27, 3:25 PM". Inside it,
     what the part held before (its "Sent / Updated <date> · In her contract" line, which was the old summary; the Pay-closes note; its payments; the answers or
     recordings panel with the "Added · date" lines), then **Pay** as one more drop-down (closed) holding the Pay box. An update sent after paying is its part's
     drop-down too ("Updated <date>", the update line, payments, the answers) with **Pay more** as its own drop-down.
  2. **Confirm with your bank**: the person's waiting charges, each its Confirm with your bank box, oldest first (as §175).
  3. **Disputes**: each dispute waiting for your side with Add your side (as before).
  4. **Call requests** (active view): one line, "2 call requests ↓", jumping to the person's drop-down in the Call requests box (below). Restricted view:
     **Booked calls**, the person's booked calls with Cancel.
  5. **Application** / **Ask to rejoin**: the request with its Details fold and Accept / Decline. An applicant who hasn't joined is a person of their own (their
     own drop-down, keyed by the application); an ask to rejoin from someone with a contract on this test goes in that person's drop-down.
  6. **Excerpt requests**: each request with Allow / Deny (both views).
  7. **Rate**: "Rate <name> · N days left", linking to their Rate box (active view).
  Nothing in Needs you is about no one, so there is no plain section below the people.
- **Order.** The person whose oldest waiting thing waits longest comes first (a part: when it was sent / the call took place; an update: when it was sent; a
  charge, dispute, request, application, excerpt request or booked call: when it was made; Rate: when the window opened). Inside a person, each kind keeps its
  order (parts by when sent, updates after them; charges oldest first; and so on).
- **When a drop-down opens by itself (person, part, Pay / Pay more).** Exactly as §180, all the way down: a link to anything inside it opens it before the
  browser scrolls (on load, on a hash change, and on a click on an in-page link): `#bank-<id>` (the bell, the dashboard, Payments, the tester row's "Confirm with
  your bank in Needs you ↑"), `#piece-<id>` / `#call-<id>` (the bell, the dashboard's Needs you rows, a tester row's "Pay it in Needs you ↑": these also open the
  part and its Pay drop-down, as §139), `#update-<id>` (the part and its Pay more), `#item-dispute-<id>`, `#item-app-<id>` (the dashboard, the
  Invite box's "had applied" link), `#excerpt-<id>` (the bell); markJump's `jumpTo` also opens every fold above its target, as before. A link to the whole of Needs
  you (`#needs-you`) opens none of them. No drop-down closes while anything inside has a bank box open, a press under way, a stop box or a refusal showing:
  every press (`usePress`) and a Pay box's own bank check (`PayBox`) now hold the drop-downs around them, as BankWaiting did for §180; a hold opens them, and
  every drop-down around them. Not remembered across reloads (owner: no extras).
- **Not changed.** Every button's behaviour: stop-once, the bank boxes, notices, the over-$200 tick, drafts. One layout effect: Accept / Decline on one
  application no longer greys the other applicants' buttons while it is pressed (each application is now in its own drop-down, each with its own press). The
  count on Needs you (`needsCount`, and the restricted view's) is the same as before: it still counts each call request to answer, while a person's "N things"
  counts their call requests line as one thing (owner), so with two or more requests from one person the badge is higher than the sum of the "N things".
- **Call requests: a box of its own (owner).** Call requests are not answered inside Needs you any more. The developer's test page has its own **Call requests**
  box right under Needs you (`CallRequestsBox`, open at first, with the count), replacing both places that listed them: the Live session's "Call requests" list
  (`CallRequestsPanel` inside `DevCallPanel`) and each tester card's "Waiting" list in the Live session ("Nina Park requested Mon, Nov 9, 1:00 PM · 30 min ·
  Contract $31/h", "You requested …", links up to the list). Its content is the same draggable panel (`call-requests-<testId>`, its height rule and memory as
  before), holding one drop-down per person (closed; the green name, then "· 3 requests"), in the order of each person's oldest request (when it was sent); inside,
  their requests oldest first, both kinds together: theirs to answer (Accept, an Accept per time for a "one of" request, Decline) and the ones waiting on them,
  yours included ("asked by you", Withdraw), in a panel of its own (`call-requests-<testId>-<contractId>`) that scrolls when long. The presses, their stop box and
  refusals are unchanged (one press state for the whole box, as before). A drop-down opens by itself on a link to a request in it (`#req-<id>`: the dashboard's and
  the bell's links, a refusal's "already requested" link) or to it, and stays open while a press on one of its requests, its stop box or refusal shows. In Needs
  you, a person with requests to answer has ONE line, "2 call requests ↓" (or "1 call request ↓"), jumping (`jumpTo`) to their drop-down in the box: it opens the
  box and the drop-down before it scrolls (inside the panels too). The Live session keeps the request form and the booked calls; a tester card there shows only
  their calls ("No calls" when ticked with none). The tester's own session page is unchanged (its Call requests list, one list, no people).
- **The Live session's list of testers' calls is shorter at first (owner).** The panel `testers-calls-<testId>` (DevCallPanel) started at 200vh (about two screens,
  so many testers at once); it now starts at `min(28rem, 70vh)` (`LIST_PANEL.testersCalls`), about 3–4 tester cards, the rest scrolling inside. The grip still
  drags it up to two screens (`TESTERS_CALLS_TALLEST`), and a height already dragged is kept as before (by the panel's id).
- **Hooks.** New: `data-needs-person="<contractId, or the application id for an applicant who hasn't joined>"` on each person's `<details>` (it used to be on the
  parts drop-down, with the name), `data-needs-person-toggle` on its summary, `data-needs-person-name`, `data-needs-person-count`, `data-needs-kinds="<kind>"` on
  each kind's block and `data-needs-kind` on its sub-heading, `data-hold-fold` on every such drop-down, `data-part-when` on a part's line, `data-fold="needs-pay-<id>"`
  / `"update-pay-<id>"` on the Pay / Pay more drop-downs (`needs-part-<id>` / `update-part-<id>` kept on the parts), `data-needs-requests="<contractId>"` on the
  call requests line; in the box `data-call-requests-box`, `data-call-requests-count`, `data-call-requests-people`, `data-call-requests-person="<contractId>"`
  (id `call-requests-person-<contractId>`) and `data-call-requests-person-toggle`. `data-bank-group="<contractId>"` is now on the person's charges block (no longer
  a drop-down of its own; §180's `data-bank-group-toggle` / `-name` / `-count` went with it); `data-restricted-bank`, `-disputes`, `-excerpts`, `-calls` are on
  each person's block of that kind. The anchors `bank-`, `piece-`, `call-`, `update-`, `item-dispute-`, `item-app-`, `excerpt-`, `req-`, `call-requests` are
  unchanged; `needs-req-<id>` (Needs you's old request rows) is gone (nothing linked to it). The restricted view's `#calls` lands on the list of people.
- **Code.** `src/components/HoldFold.tsx` (§180's `BankGroup` generalised: `HoldFold`, `useFoldHold` / `useBankGroupHold`, `useHoldOpen`, `defaultOpen`; holds
  pass up to every drop-down around), `src/app/app/tests/[id]/page.tsx` (`needsPeople`, `bankKind` / `disputeKind` / `excerptKind`, `partNode`, `updateNode`,
  `needsEntries`, `callRequests`), `CallRequestsBox.tsx` (new), `components/CallRequestsPanel.tsx` (`byPerson`, `callRequestsAnchor`, `at`), `NeedsRequests.tsx`
  (now the one line), `DevCallPanel.tsx` (no requests list, no "Waiting"), `components/ScrollList.tsx` (`testersCalls`), `Applications.tsx` (`embedded`),
  `RestrictedCalls.tsx` (`person`), `PayBox.tsx` and `lib/usePress.ts` (the hold), `lib/server/confirm.ts` and `lib/server/excerpts.ts` (`at`). No migration.
- **Tests.** `tests/batch35-restricted-needs-you.test.ts`: §175 / §180's test now checks the charges inside each person's drop-down (closed, the green name then
  "· 4 things" / "· 2 things", the sub-heading only with more than one kind; held: "· 1 thing"); new §181 test (Alex: charge, dispute, excerpt request; Bea: her
  written answers to pay and a call request; Cara: an application, not joined): three drop-downs in oldest-first order, the badge still 6, each thing in its
  person's drop-down, the part and its Pay drop-down named plainly, Bea's "1 call request ↓" line, the Call requests box open with Bea's closed drop-down
  ("· 1 request", Accept / Decline), every other drop-down closed. Updated source checks: `batch35-sent-panels`, `batch35-sent-locked`, `batch35-tester-folds`,
  `batch20` (the Rate line), `batch17-bank-check`, `batch35-list-panels`, `batch35-green-names`, `batch35-name-links`, `batch16-calls-live`,
  `batch35-answering-press`.
## §182 The tester's parts fold; one long-text fold on both sides (owner, Nov 4)

- **Your recording** (the tester's session page). The recordings (sent first, then each "Added · <date>", then the ones not sent yet) sit in a fold, "Your
  recording" ("Your recordings (N)" with more than one), open at first and kept open or closed like every fold; inside, the list is in the list panel
  (`own-recordings-list-<session>`, `LIST_PANEL.ownRecordings`, about one and a half recordings: scrolls inside, the grip drags it, the height is kept). The
  count, Add more, the upload tools and Send stay under the fold.
- **Your written answers.** What was sent sits in a fold, "Your written answers"; every question (§167's fold per question: the answer, then each addition,
  dated) is in ONE panel (`own-answers-list-<submission>`, `LIST_PANEL.ownAnswers`). The "Add to this answer" buttons sit BELOW the panel, one per current
  question, each followed by its question's first line. Pressed, the box opens IN the panel, directly under the latest part of that question (the original
  answer or its last addition): it is drawn into the slot at the end of that question's fold (`data-add-slot`), the question's fold opens and the box is
  brought into view with the typing in it. The box is itself a fold ("Add to this answer", open) whose editor scrolls inside when long; Add to my answer and
  Close stay under it. A restored draft opens its box there the same way (every fold around it opens). Unchanged: the per-question keys and drafts
  (`add:<session>:<questionKey>`), the 10 additions (at 10 the grey note in place of each button; a draft stays read-only), stop-once and the refusals.
- **Long text, both sides: one fold** (`components/LongText.tsx`; FieldNote's FoldText is now this component). Wherever a tester's question, answer or
  addition shows: the tester's own page (the sent answers, the previous sets, the answer form's questions), the developer's tester rows, Needs you's parts and
  the update row (all through SentWork), By question, and the team's "See the work". A question shows its first 2 lines, an answer, an addition or the notes
  their first 3. Text that fits shows whole with no button; longer text ends with "Show more", which opens the whole text in a scroll box about 8 lines tall
  (the draggable panel, kept per panel id), and "Show less" folds it back. Whether it is long is measured on the page (the width, a picture loading), so
  attachment markers, pictures and formatting inside an answer fold the same way; the text stays selectable. A question fold's title already shows the
  question's first 2 lines: inside, only "Show more" (when the title cut it) opens the whole question. Payments show no answers (only "Written answers"), so
  nothing changes there. Excerpts keep their own 2/3-line ClampText.
- **Jumps.** A link to something inside a folded text opens it first (markJump's jumpTo), as it opens the details folds around it.
- **Not changed.** The layout of Needs you and the test page (another branch is restructuring it): only the components that draw the text changed.
- **Tests.** New `tests/batch35-parts-fold.test.ts`. Updated for the form's question fold: `batch20`, `batch26`.
## §183 Adding to a part always stops once for the developer's payment on it (owner, Nov 4)
- **The rule.** A tester's press that sends more to a part already sent (Add to this answer; a Send of the answers to changed questions, after a switch; adding
  recordings, `recording-send` on a sent recording) stops once, whatever her Alerts, when the developer made a payment on THAT part since her page loaded: Pay,
  Pay more, a team dispute decision (already forced by §171 A2), the developer's $0 answer to her update, a delayed payment going through (and its delayed line).
  The owner's reason: "Your new payment can change whether they still want to add anything"; it mirrors the developer side's "anything on the same part always
  stops" (§171 A1). The lines are `forced: true` in the box (no turn-off, §160b); the second press goes ahead. Payments on her other part keep following her
  Alerts. A first Send (nothing sent on that part yet) has no piece: nothing changes for it. No other press's rules changed (an automatic call charge is n/a).
- **How.** `testerSendGate(contractId, body, piece)` passes the part's submission id as `testerGate`'s new `sendPiece`, which uses §68's piece rule (lines whose
  `piece` matches are kept with Alerts Off and marked forced). `skipTerms` only drops the terms lines (an open offer already blocks Send), so it needs nothing.
  `sendWritten`, `addWritten` and `sendRecording` read the sent part before the gate and pass its id.
- **The $0 answer to an update** had no tester line anywhere (only the bell and the part's grey line). `testerGate.zeroUpdateLines` reads it for these presses
  only (`Submission.paidUpdateZeroAt` since the page loaded): "Nora Lane paid $0 more for what you added to your written answers" (the bell's words), kind
  `paid`, forced. The tester's live box and her other presses are unchanged (an open question for the owner: should it also be a live-box line and follow
  Alerts on her other presses, like a Pay more?).
- **A single refusal, never a stop first** (owner's standing rule). Everything that could only refuse these presses is now checked before the gate as well as
  under the lock: Add to this answer (`addRefusal`: not sent, the team's $0 closure or an old rejection, changed questions, the question gone, 10 additions, too
  long); Send (`sendRefusal`: the closure or rejection, answers already sent for the same questions); a recording add (the closure or rejection, nothing new to
  add; a recording still uploading keeps its own refusal under the lock).
- **Terms** (edited in place, TERMS_VERSION stays 2): "Changes while you pay" adds "A payment by the developer on a part the tester is sending more to (Send,
  Add to this answer, adding recordings) since the tester's page showed it also stops that press once, whatever the tester's Alerts."
- **Code.** `testerGate.ts` (`sendPiece`, `zeroUpdateLines`), `terms.ts` (`testerSendGate`'s `piece`), `tests.ts` (`sendRefusal`, `addRefusal`, the pieces),
  `recordings.ts` (the piece, the early refusals), `termsOfUse.ts`. No migration.
- **Tests:** new `tests/tester-send-paid-stop-183.test.ts` (Pay more on the written answers after the page loaded: Add stops once, forced, Alerts Off, then goes;
  the $0 answer to an update stops the next Add, forced; a payment on the recording doesn't stop an Add on the written answers with Alerts Off, and stops it
  unforced with Alerts on; a locked Send and the team's $0 closure are single refusals; a recording add after a Pay more on the recording stops once, forced, then
  goes; a payment on the written answers doesn't stop a recording add with Alerts Off; nothing new to add is refused at once; the Terms). Updated: `batch20`
  (§12's list of tester presses had a second Send of the same answers, which used to stop and then be refused; it is now a single refusal, so the list uses Add
  to this answer).
## §184 A booked call drops the other waiting requests that overlap it (owner, Nov 4)

Before: sending refused a time overlapping a booked call or a waiting request between the same two people, and Accept refused a time overlapping any booked call
of either person; but when a call got booked, the other waiting requests at an overlapping time stayed open and only failed when someone pressed Accept ("This
time is no longer free.").

- **Rule.** The moment a call is booked, every OTHER waiting call request that involves either person in it (the developer or the tester, as the developer or the
  tester of that request: an account can be both), sent by either side, on any test, whose time overlaps the call is dropped, in the booking's own transaction
  (`dropOverlapping`, `src/lib/server/requests.ts`):
  - a single time (or a daily / weekly set: accepting it would refuse the whole set) **closes**, with a reason saying which of its two people is no longer free
    (`DROP_DEV_BUSY` / `DROP_TESTER_BUSY` / `DROP_BOTH`, `src/lib/requestDrop.ts`), never who the call is with;
  - a "choose one" request **loses only the overlapping times** (rows, times and first time rewritten as a request sent with only those would be); none left:
    it closes;
  - requests between the same two people that overlap it close too (they'd be refused anyway).
- **Every booking path** goes through `bookAt`, so all of them drop: the other side's Accept (single call and each call of a daily / weekly / Forever set),
  the developer's auto-match ("Booked: you both picked …", `devRequestTime`), the tester's auto-match (`testerRequestTime`), and the daily job's Forever top-up
  (`topUpForeverSets`). Not dropped: the request the booking answers (an auto-match's is still waiting at that moment) and the other copies of a developer
  request sent to several testers (they close as before: "Another tester took this time at …").
- **Two bookings at once.** Each booking takes both people's locks first (in the same order: no deadlock), then the test's, then books and drops: a second booking
  sharing a person waits, and its drop sees the first one's call and requests. An Accept that loses to a drop reads the closed request (one refusal).
- **Who is told, and how** (each line on the dropped request's test; times in the reader's zone; the other person by pronoun, §162):

| Reader | Line | Kind |
| --- | --- | --- |
| Tester, the developer got the call (her request to him) | `Your request to Nora Lane for Thu, Nov 5, 3:00 PM closed: she is no longer free at that time` | Call change (stops once; Alerts Off greys it) |
| Tester, the developer got the call (his request to her) | `Nora Lane's request for Thu, Nov 5, 3:00 PM closed: she is no longer free at that time` | Call change |
| Developer, the tester got the call (her request to him) | `Ana Silva's request for Thu, Nov 5, 3:00 PM closed: she is no longer free at that time` | Call change (`req_closed`, Alerts: Call changes) |
| Developer, the tester got the call (his request to her) | `Your request to Ana Silva for Thu, Nov 5, 3:00 PM closed: she is no longer free at that time` | Call change (`req_closed`) |
| The person with the call (their own booking, or the one they were told about) | `Your request to Ben Carter for … closed: you have another call at that time` / `Ben Carter's request for … closed: you have another call at that time` | Quiet live-box line, never a stop (`req_dropped`; the tester's: marked quiet on the session page) |
| Both people, a request between the same two | `Your request to Ana Silva for … closed: you have a call with her at that time` / `Nora Lane's request for … closed: you have a call with her at that time` | Quiet (both know about the call) |
| A "choose one" request that only lost times | `Your request to Nora Lane no longer offers Thu, Nov 5, 3:00 PM: she is no longer free at that time` (and the same heads for the other readers, `… no longer offers …`) | As above, by reader |

  Call requests are still not bell lines (owner rule): no bell, no email. Not specified by the owner, read this way (check): the person with the call who
  didn't press (the requester of the booked call) gets the same quiet line for their dropped requests, since they're told about the booking itself.
- **Accept on a dropped request** is a single refusal, as for any closed request, never a stop first (the developer's gate is skipped for it):
  `This request closed: Nora Lane is no longer free at that time.` (the other person has the call), `This request closed: you have another call at that time.`
  (the reader has it), `This request closed: you have a call with Nora Lane at that time.` (both). The open Call requests panel's row reads the same reason:
  `Closed: Nora Lane is no longer free at that time` (pulse route, in the reader's words). A stale page's Accept of a time taken out of a "choose one" request
  reads "Pick one of the times." as before (the panel redraws without it).
- **Kinds.** Developer: `req_closed` (DEV_STOP_KINDS, Alerts "Call changes"), `req_dropped` (DEV_QUIET_KINDS). Tester: `t_req_closed` / `t_req_dropped`, read
  by `testerChanges` for that session only (shown as `requested` / quiet). The tester's older line "The call time with … is no longer available" is no longer
  written for a dropped request (it has its own).
- **Unchanged.** Sending still allows a time overlapping the other person's call with someone else (only the same two are checked); Accept's clash checks stay
  (a request sent after the booking is still refused at Accept: "This time is no longer free."). No schema change. Terms: they don't describe call requests
  closing, so no edit.
- **Tests.** New `tests/drop-overlapping-requests.test.ts`: single time (the developer's request to another tester; the tester's line never names who; the
  developer's own quiet line; Accept a single refusal; the panel row in both readers' words; the tester's next press stops once, the developer's never for her
  quiet line), "choose one" with one time taken out (both told; the time left still books), "choose one" fully overlapping (closes; the developer's Accept a
  single refusal with no stop first), a tester's requests on another developer's tests both ways (that developer told without naming the other developer; the
  tester's quiet lines; both Accepts single refusals), the developer's auto-match plus a request between the same two on another test, the Forever top-up, and
  a batch's copies still "taken" with a non-overlapping request left alone. Updated: `request-kinds` (Ben's Accept now reads "This request closed: Nora Lane is
  no longer free at that time." instead of "This time is no longer free.").
## §185 Calls with one person: 3 in total, 3 sends a day, two request boxes, withdrawals never stop (owner, Nov 4)

- **The limit: 3 in total per developer–tester pair on a test.** Booked times + waiting requests, both sides together, at most 3 (`MAX_CALLS`,
  `src/lib/callClash.ts`). A daily / weekly set is one booked time (a Forever set too, while it runs, even with none of its calls ahead); a "one of" request is
  one request. It replaces "up to 3 booked + up to 3 requests" (`MAX_BOOKED` / `MAX_REQUESTS` are gone). The same for both sides. Refused on the first press
  (checked before the stop-once gate: a single refusal, never a stop first) with one line naming the pair:
  `You already have 3 calls booked or requested with Nina Park. Wait until one is answered, over or cancelled, or withdraw a request.` (the developer; the
  tester's names the developer: `… with Nora Lane. …`). Every path:
  - **Send** (`devRequestTime`, `testerRequestTime`): refused at 3. Re-checked under the test's lock when the request is created (`createRequest`), so two sends
    at once never pass 3. The developer ticking several testers: every one at the limit → refused at once (`… with Ana Silva and Ben Carter. …`); only some →
    the existing "Press again to send to the others" box, now reading `You already have 3 calls booked or requested with Ana Silva.`
  - **Auto-match** (a send at exactly the other side's waiting single time) books THEIR request: one request becomes one booked time, so it goes at 3. It is
    refused (same line) only for a pair already over 3 from before the limit.
  - **Accept**: the same (a request becomes a booked time: the count doesn't move); refused only for a pair over 3 from before (checked before the gate, and
    again once claimed: the other bookings must leave room for it).
  - **Daily / weekly sets**: one booked time, as before.
  - **Forever top-up** (the daily job): no check needed and none added: a running Forever set already counts as one booked time (`bookedTimes`), so adding its
    next calls never goes past 3.
  - The forms (both sides) show the same line in red while filled (`clashNotes`, booked + waiting from the page), except when a row is an exact match with the
    other side's request (the press books it). The developer's tick row reads "N of 3 booked or requested".
- **Sends a day: at most 3 call requests a day to the same person on a test, each side** (owner, later the same day). Developer → that tester, tester → that
  developer (`MAX_SENT_PER_DAY`, `sentToday`). Every request sent counts, whatever became of it (withdrawn, declined, dropped, closed: "requesting after
  cancelling counts"); an auto-match that books directly counts as one (the request it books is marked `matched`, now on both sides' auto-matches); a "one of"
  request is one; a developer request to several testers is one per tester. Withdrawing (and cancelling) is never limited and never counts. "Per day" is the
  sender's calendar day in their saved zone (it resets at their midnight). The 4th send that day is refused on the first press:
  `You've sent 3 call requests to Nina Park today. You can send more tomorrow.` (the tester's: `… to Nora Lane today. …`). With several ticked testers it works
  like the limit (all of them: refused; some: named in the "Press again to send to the others" box, `You've sent 3 call requests to Ana Silva today.`).
  Re-checked under the test's lock. No schema change: counted from the rows' `createdAt` (and `decidedAt` for `matched`).
- **Two request boxes on the developer's test page** (`CallRequestsBox`, replacing §181's single box), right under Needs you, each open at first, shown when it
  has something:
  - **Requests to you (N)**: the testers' requests waiting for your answer (Accept, an Accept per time for a "one of" request, Decline). Panel
    `call-requests-<testId>`; section `#call-requests`; a person's drop-down `call-requests-person-<contractId>` (Needs you's "N call requests ↓" lands here).
  - **Your requests (N)**: your own waiting requests (Withdraw). Panel `your-requests-<testId>`; section `#your-requests`; a person's drop-down
    `your-requests-person-<contractId>`.
  - Each as §181: one drop-down per person (closed; the green name, then "· N requests"), people ordered by their oldest request, requests oldest first in a
    panel of their own (`<panel>-<contractId>`). A **name search** sits above each box's people (inside the box, above its scroll panel): as you type, only the
    people whose name (as shown) contains it, any case; nobody: `No one matches “zed”`. Filtered people are hidden, not removed (an open drop-down stays open);
    a person with a press under way, its stop box or refusal is never hidden; a link to someone the search hides (Needs you's line, `#req-<id>`) clears the
    search and shows them before the jump scrolls. Not remembered. Auto-open on jumps, presses, stop boxes and refusals as §181.
  - Hooks: `data-requests-to-you` / `data-your-requests` on the boxes (both keep `data-call-requests-box` and `data-call-requests-count`),
    `data-request-search="to-you"` / `"yours"` on the inputs, `data-request-search-empty` on the no-match line; the people keep `data-call-requests-person`.
- **The tester's session page had one combined list** (the Live session's Requests: the developer's requests to answer and her own, together). It is split the
  same way: "Requests to you (N)" (`#call-requests`, panel `call-requests-<session>`) and "Your requests (N)" (`#your-requests`, panel
  `your-requests-<session>`), each shown when it has something ("No call requests waiting." when neither). No name search there: only one person (the
  developer).
- **Withdrawals** (both sides). The other side withdrawing a request is never a stop-once for the other person (whatever their Alerts; a bell too, below): a quiet live-box line
  (like §184's quiet lines): the developer's `Ana Silva withdrew a call request for …` (kind `withdrew_req`, moved from DEV_STOP_KINDS to DEV_QUIET_KINDS), the
  tester's `Nora Lane withdrew the request for …` (§184's quiet kind). It matters only when they try to answer it: ONE refusal, never a stop first (the
  developer's gate is skipped for it): `Ana Silva withdrew this request.` / `Nora Lane withdrew this request.` (no time in it any more). Your own withdrawal
  in another tab still stops as before (the action log, reason E).
- **Unchanged: a new request, an answer to yours (Accept / Decline) and cancelling a booked call** still follow the Alerts / stop rules (Call changes; the
  tester's call kinds unchanged).
- **Join or Cancel on a call already cancelled**, from an old page: refused once. Join and the tester's Cancel already were; the developer's Cancel stopped
  first for the tester's cancellation (batch 16 §21) and then refused: now a single refusal (`The call with Ana Silva was already cancelled.`). Every 409
  refusal redraws the page (client.ts, batch 28 §9; the line kept where the button was, KeptRefusal), so the row then leaves the booked list; the call is in
  Call history with its Cancelled badge.
- **Terms**: they don't state the call limits, so no edit.
- **Code.** `src/lib/callClash.ts` (`MAX_CALLS`, `callLimitLine`, `MAX_SENT_PER_DAY`, `sentTodayLine`, the form's line), `src/lib/server/requests.ts`
  (`bookedTimes` with Forever sets, `callsTaken`, `sentToday`, `autoMatchOf`, the checks on every path, `createRequest`'s locked re-check, `refusalFor`, the
  tester's auto-match marked `matched`; the tester's Length is now checked before her gate, as the developer's already was), `src/lib/server/testerGate.ts`
  (quiet withdrawal), `src/lib/rules.ts` (kinds), `src/lib/server/calls.ts` (Cancel on a cancelled call), `CallRequestsBox.tsx`,
  `components/CallRequestsPanel.tsx` (`title`, `sectionId`, `anchor`, `search`, `showCount`, `matchesName`, `noMatchLine`, `yourRequestsAnchor`),
  `components/CallRequests.tsx` (the tester's split), `DevCallPanel.tsx` ("of 3 booked or requested"), both pages' booked counts. No migration.
- **Tests.** New `tests/call-limit-request-boxes-185.test.ts` (2 booked + 2 requests: the first goes, the second refused, both sides, no stop first; auto-match
  and Accept at 3; a pair over 3 refused at Accept; a Forever set counts one; the form's line; 3 sends incl. a withdrawn one then the 4th refused, withdrawals
  unlimited, the next day allowed; the developer's 4th incl. a declined one and an auto-match, another tester unaffected, the several-testers box; the
  sender's own day in their zone; withdrawals both sides: no stop, one refusal, quiet line; a new request / a decline / a cancel still stop, Alerts "Call
  changes" ticked doesn't; Join / Cancel on a cancelled call refused once, Call history; the two boxes and the tester's split rendered). Updated:
  `request-kinds` (the limit), `batch16-calls-live` (the form's line), `requests` and `press-races` (the withdrawal line), `batch35-list-panels` (panel ids),
  `batch14` (DEV_QUIET_KINDS, which already missed §184's `req_dropped`), `batch18-misc` (Ben had 3 with the developer: its request is withdrawn first).
- **Withdrawn and closed requests, withdrawn applications: a bell, never a stop** (owner, later the same day; part of §185).
  - **A call request the other side withdrew** (either side) and **a call request a booking closed** (§184's `req_closed` / `t_req_closed`, the request's other
    person, the one without the call): a quiet live-box line for that person (never a stop, whatever the Alerts: `req_closed` moved to DEV_QUIET_KINDS, the
    tester's `t_req_closed` read as quiet), plus a **bell** (and its email per their notification settings) in the words of the line (`Ana Silva withdrew a call
    request for …`, `Nora Lane's request for … closed: she is no longer free at that time`, `Your request to Ana Silva for … closed: …`), linking to the test
    page / the session. The bells stack per test and day: group `reqclosed:<testId>`, titled `Call requests · 3 closed today` (`lib/bell.ts`: a group key may
    name its test after a colon, `groupBase`). The person with the call keeps §184's quiet line and gets no bell. A booking's bells go out after its transaction
    (never for a booking that rolled back). Acting on such a request from an older page (Accept / Decline / Withdraw) is one refusal naming what happened, no
    stop first (as above and §184).
  - **A tester withdrawing her application** (`withdrawApplication`): no live line and no stop at all any more (it wrote a Joins-type `applied` line,
    "<name> withdrew their application"; no event is written now): a bell to the developer, `Ana Silva withdrew her application to “Harbor Run”`, stacked per
    test and day (group `appwithdrawn:<testId>`, `Applications · 2 withdrawn today`). Accept / Decline on it: the existing single refusal (`Ana Silva withdrew
    her application.`).
  - **A developer cancelling an invite**: unchanged (the tester's bell; the join refused on an invite-only test; on an apply test they can still apply).
  - New requests, answers to your requests and cancelling a booked call keep following the Alerts / stop rules as before.
  - Code: `requests.ts` (`dropOverlapping`'s bells, `bookAt` sends them; the withdrawal's bell), `testerGate.ts`, `rules.ts`, `joining.ts`, `lib/bell.ts`
    (`reqclosed`, `appwithdrawn`, `groupBase`), the Notifications page (counted titles by base). Tests: the §185 file (both sides' withdrawal bells, the stack's
    key and titles, the application: no event, no live line, the bell, one refusal); `drop-overlapping-requests` (the other person's line is quiet now, with
    one bell; Ben's next press goes; Omar's bells on each test).
- **Not ours, failing on master already** (left as they are): `batch35-fixes` §7 and `batch24` section 1 check source strings of the test page that §181 /
  §175 changed (`id={x.kind === "sub" ? …}`, `{rows.map((b) => <BankWaiting …`).

## §186 Text limits 20,000; an addition has an answer's limit; call history as Booked / Cancelled on both sides (owner, Nov 4)

### A. Every 50,000-character limit is 20,000

| Limit | Before | After | Where |
| --- | --- | --- | --- |
| A written part (all its answers and "Anything else" together): `WRITTEN_MAX_CHARS` | 50,000 | 20,000 | `src/lib/rules.ts`; the form's "N / 20,000" counter, Send greyed and refused over it, the typing limit (`answerRule`), the server's `checkWrittenLength` ("Your written answers can be at most 20,000 characters in all (now 20,001).") |
| Contact us: `LIMITS.contact.max` | 50,000 | 20,000 | `src/lib/limits.ts`; the form's maxLength and "N / 20,000" counter, the server (`readText`, refused never cut) |
| One addition ("Add to this answer", §167) | the part's 50,000 shared with the answers and every earlier addition | 20,000 of its own | below |

Nothing else in `src` was 50,000 (the other mentions were comments: the admin's Contact us scroll box, the request size notes of `/api/kept`, `/api/sessions/…`
and `server/kept.ts`, `additions.ts`, `answerAttachments.ts`: reworded in place; the byte limits of those requests are unchanged, they only had room to spare).
The Terms and the help page don't state the number. DESIGN-DOC.md, HANDOVER.md and CODEX-TASKS.md now say 20,000 (edited in place; no version bump).

**An addition has the same limit as an original answer.** Before, `addRefusal` checked the latest answers + the notes + every addition + the new text against
the one 50,000, so a long first send left little room for additions. Now each addition is limited like one send of answers: at most 20,000 characters of its own
text (file markers not counted, as everywhere), whatever the answers sent before and the other additions hold (`checkAdditionLength`, `rules.ts`). It is refused
on the first press, before any stop box (addRefusal runs before the stop-once): **"Your addition can be at most 20,000 characters (now 20,001)."** (`additionTooLongLine`,
the same words on the page and from the server). The add form's counter counts only the addition ("N / 20,000"), its box stops typing at 20,000 (`additionRule`;
a cut paste says "Cut to the 20,000-character limit for this addition."), and the `used` prop (the part's characters so far) is gone.

**Text already stored stays as it is.** A sent part, an addition or a Contact us message longer than 20,000 is never cut or refused after the fact; only new
presses are limited. An old **draft** over the limit (kept from before): the box shows it whole (the browser never cuts a value already longer than maxLength,
and our limiter only lets it shrink), the counter is red ("25,000 / 20,000"), Send / Add to my answer is greyed and a press is refused with the line above
until it fits; a read-only draft at 10 additions (maxLength 20,000) still shows it whole.

**At 10 additions the grey note shows once** (owner's fix on §167 / §182). Before: "You've added to this part 10 times, the most it takes." showed in each
question's "Add to this answer" row under the answers panel (twice with 2 questions). After: once, directly under the answers panel (`data-additions-full`),
in place of the rows: no Add buttons and no per-question note (a kept draft still opens read-only in its question). Same words. The developer's side never
showed it.

### B. Call history, developer side: each tester's row in the TESTERS panel

| Before | After |
| --- | --- |
| One fold "Calls (N)": every call that's over (took place, cancelled, nobody joined, missed …), newest first; the calls ahead only in the Live session | Two drop-downs, both closed at first: **"Booked (N)"** and **"Cancelled (N)"** (`data-calls-booked="N"`, `data-calls-cancelled="N"`, ids `calls-booked-<contractId>` / `calls-cancelled-<contractId>`, both inside the old `data-calls-fold` wrapper) |

- **Booked (N):** every call booked and not cancelled. First the ones still ahead (or running), soonest first: time · length · rate, "Upcoming" (or the
  measuring / in-progress tag), with the Live session row's own buttons and rules (Join call while it can be joined, Add to calendar, Cancel with a reason
  within 24 hours, Report a problem once started; `BookedAhead.tsx`, rows `booked-call-<id>`, the same `/cancel-call` press and stop-once). Then the ones that
  took place, newest first, exactly as before: each call its own fold with its badge ("Took place · 30 min · paid $15.50", the amount once, §170), its length,
  its payments (`part-pays-<id>`), Pay more / "paid the most", the waiting bank check. Empty: "No booked calls."
- **Cancelled (N):** the calls actually cancelled, by either side or by the app (Nobody joined, Couldn't connect, Missed: the site was down / the test was
  paused), newest first: time · the length it was booked for · the existing badge ("Cancelled by you · 3:05 PM", "Cancelled by Ana Silva · …") and the reason
  quoted under it. Call requests (waiting, withdrawn, declined, closed) never show here. Empty: "No cancelled calls."
- **Panels (§152 rules):** past 3 rows each list is the draggable panel: Booked `booked-calls-<contractId>` at `LIST_PANEL.pastDeveloper` (27rem, rows carry
  payments), Cancelled `cancelled-calls-<contractId>` at `LIST_PANEL.pastTester` (16rem, short rows). 3 or fewer: a plain list.
- **Jumps:** `#call-<id>` of a call that's over lands on its row and opens the drop-down it is in (jumpTo opens every enclosing fold); a call's charge waiting
  for the bank opens its drop-down by itself, as before. A call still ahead keeps `#call-<id>` in the Live session (with its timer), so the Live session is
  unchanged; its copy in Booked is `booked-call-<id>`. (Read this way, check: the developer's Live session panel spans all testers and holds the request form,
  so its booked list stays; the calls ahead therefore show there and in the tester's row.)

### C. Call history, tester side: under the call requests

| Before | After |
| --- | --- |
| Live session: "Booked" (calls ahead, Join call / Cancel, panel `booked-<sessionId>`), then Requests. "Live call: N done" (part list, §179) listed every done call with its payment box (panel `live-calls-<sessionId>` past 3). A closed card "Call history (N)" with every call that's over and its badge | Live session: the rate, warnings, Requests, and the line "Your booked calls (Join call, Cancel): Call history, Booked ↓" when any. "Live call: N done" keeps its count, rate, "Paid so far" and warning, with "Each call and what it was paid: Call history, Booked ↓". A card **"Call history"** right under the Live session (where the call requests are) with **"Booked (N)"** and **"Cancelled (N)"** |

- **Booked (N):** the calls ahead first, soonest first, with Join call / Add to calendar / Cancel / Report a problem as before (the Live session's rows moved
  here: `TesterCallPanel`, rows `call-<id>`, sets with Show calls / Cancel the remaining calls). The drop-down opens by itself while a call can be joined or is
  running, so Join is never hidden. Then the calls that took place, newest first, each with its time, "Took place · 30 min", its payment tag (Paid / Waiting
  for review / Payment delayed / …), its length line, "Charged automatically …" for an unpaid listed call, and its payment box as in "Live call" (Paid $15.50
  ($31.00/h): you get …, extras, the dispute and Pay more lines, Dispute the pay).
- **Cancelled (N):** as on the developer side, in the tester's words ("Cancelled by Nora Lane", "Cancelled by you", "Nobody joined" …). A blocked pair's calls
  read "Cancelled: not available" as before, except a call that took place: it stays in Booked with its payments.
- **Merged, so nothing shows twice:** the Live session's "Booked" list and §179's per-call list in "Live call" are gone; both are now the Call history's Booked
  (§179's panel became Booked's panel: `booked-calls-<sessionId>` at `LIST_PANEL.liveTester`, 27rem, past 3 rows; Cancelled `cancelled-calls-<sessionId>` at
  16rem). The old Call history badge no longer repeats the amount ("Took place · 30 min", the tag and the paid line say it). Hooks kept: `data-call-row` +
  `data-call-length` (each row's line), `data-auto-charge`, `data-over-call`, `data-call-badge`, `data-live-calls="N"` (the calls that took place),
  `data-call-history`, `id="part-live"`, `id="calls"`; new `data-calls-booked`, `data-calls-cancelled`, `data-calls-ahead`, `data-booked-below`,
  `data-live-calls-below`. Gone: the panel ids `booked-<sessionId>` and `live-calls-<sessionId>`.
- **Links:** the tester dashboard's Upcoming calls open `…#calls-booked-<sessionId>` (was `#live`); a payment bell or email about a call (paid, Pay more,
  delayed, a dispute decided, the team's $0 closure, a payment arriving after a hold) opens that call's own row `#call-<id>` (was `#part-live`; `pieceAnchor`,
  `src/lib/links.ts`). Written answers and recordings keep `#part-written` / `#part-recording`.
- **Not touched:** call request logic and the request boxes (another branch); the request section stays where it is, the Call history card follows it.

### Tests
New `tests/limits-call-history.test.ts`: the 20,000 limits (rules, Contact us 20,001 refused), an addition at 20,000 accepted and 20,001 refused on the first
press with no stop box while the part already holds 20,000 (and a second 20,000 one after that), the typing rule and an older over-limit draft that may only
shrink; both sides rendered: only cancelled calls with closed requests (Booked (0), Cancelled (2) newest first, the badges and reasons, no request), and 2 ahead +
2 that took place + 1 cancelled (the order, the buttons, the payments in Booked, each call once on the tester's page, the panels). Updated: `batch11`,
`batch14` (20,000), `batch20`, `batch35-list-panels` (§152 ids, §179 now in Booked), `batch35-payment-tags`, `batch35-pending-pay-state` (a call's tag is in the
Call history), `batch35-added-per-question`, `batch35-parts-fold` (no `used`; the 10-additions note no longer in each form). New: 2 questions at 10 additions
render the note exactly once, under the panel, with no Add button.

## §187 Layout fixes from the Nov 4 screenshot run; the tester's Charge refusals; a "one of" request as one row per time (owner, Nov 4)

Found by the screenshot run (`playtest-lite-evidence/new-ui-nov4`); the after pictures are in `playtest-lite-evidence/layout-fixes-nov4` (captions.json names
each one's before picture).

1. **Expanded answers squeezed.** Before: Show more (LongText, §182) opened an 8-line scroll box even inside other scroll panels (the answers panel, in the
   person, in Needs you), so about 4 lines showed on a desktop and 2.5 on a phone. After: inside a scroll panel (`useInPanel`: a ResizeBox, or a list that says
   so with `InsidePanel`, e.g. ScrollList) the open text is drawn inline (`data-fold-open="inline"`, no box of its own) and the outer panel scrolls it.
   Outside any panel it keeps the 8-line box. (`components/LongText.tsx`, `components/Panel.tsx`)
2. **Nested scroll panels.** Before: Needs you stacked 3–5 panels, each with its own scroll and grip, each level indented further. After: only the OUTERMOST
   panel in a stack scrolls and resizes; a ResizeBox inside another panel is plain (`data-panel-flat`: no scroll box, no grip, no border or padding); the
   folds above it still open and close it. This is the rule at every width (the squeeze of item 1 was on desktops too): Needs you, the call request boxes'
   person panels, the testers' calls cards' booked lists, the parts' payment lines. Per-level indent on phones at most 8px: the part / update / dispute /
   excerpt boxes `p-2 sm:p-3` (was `p-3`), a question's body `pl-2 sm:pl-3` (was `pl-3`). (`Panel.tsx`, `ScrollList.tsx`, the test page, `SentWork.tsx`)
3. **Names cut too short.** Before: names were cut at 12 characters (NAME_CUT) even with room. After: `NameLink fit` / `Cut fit` draws the whole name and cuts
   it with "…" only when the row is actually full (CSS truncate on the width it has, rows `min-w-0`); the tooltip and the phone tap pop-up only when it is cut
   right now. Used in Needs you's people (and their dispute / excerpt lines), both call request boxes (people and rows), the testers' calls cards (rows,
   heading, the tick list; its fieldset `min-w-0`: a fieldset is otherwise never narrower than its content) and the held view's booked calls. Elsewhere the
   12-character cut is unchanged. (`components/Cut.tsx`, the test page, `CallRequestsPanel.tsx`, `DevCallPanel.tsx`, `RestrictedCalls.tsx`)
4. **Testers' calls panel** (`testers-calls-<testId>`). Before: `min(28rem, 70vh)`, about 2.5 tester cards. After: `min(37rem, 80vh)`, about 3.5 cards with 2
   booked calls each on a desktop (a card is about 154px); on a phone 80% of the screen is the limit (its cards are about 314px, so about 2). (`ScrollList.tsx`)
5. **Held view repeated the name.** Before: every booked-call row inside a person's Needs you drop-down read "<time> · <name> · 30 min". After: inside their own
   drop-down "<time> · 30 min" (the name is on the drop-down, once); the standalone list keeps the name. (`RestrictedCalls.tsx`)
6. **A question's Show more alone on a line.** Before: a long question's Show more sat on its own line between the question's title and the answer (§182's
   `bare` fold). After: `QuestionTitle` (the question fold's summary) cuts the question at 2 lines with Show more floated at the right end of its 2nd line, the
   words running up to it; pressed, the whole question shows in the title with Show less right after its last word. The buttons show only while that
   question's fold is open; closing it goes back to 2 lines. Both sides (SentWork: Needs you, the tester rows, the tester's own page; By question). A question
   shown above its answer (the earlier sets, the tester's answer form) uses `LongText inline`: Show more beside its last line, Show less after its last word.
   `bare` is gone. (`LongText.tsx`, `SentWork.tsx`, `ByQuestion.tsx`, `AnswerSets.tsx`, `SessionActions.tsx`, `globals.css`)
7. **Sideways scroll at 375px on the tester's session page.** Before: the hidden hover card on the developer's name (`invisible absolute … w-80`) still took
   room past the screen's edge (2px). After: hover cards (PersonHover, Testers joined, the dashboard's tester circles; `data-hover-card`) are `display: none`
   until hover or focus, and a shown card that would pass the right edge moves left to fit (8px from the edge, never past the left one: `HoverFit`, mounted
   once in the root layout, `hoverShift`). (`PersonHover.tsx`, `TestersJoined.tsx`, `Ui.tsx`, `HoverFit.tsx`, `app/layout.tsx`)
8. **Phone header 171px.** Before: on a phone the links wrapped to 3 rows. After: below 640px the side's links fold into ONE "Menu" button (`NavMenu`: a
   disclosure with `aria-expanded` / `aria-controls`, the same links in a drop-down; it closes on a link, on navigation, on Escape (focus back on Menu) and on
   a press outside). A dot on Menu while Messages has unread chats (its label says how many); the bell keeps its own number in the header, with the account
   and sign-out. The header is one row (59px). From 640px up nothing changes. The header is now `z-30`: the test page's top panel (`z-20`) painted over it,
   and over the drop-down, when scrolled under it. (`components/NavMenu.tsx`, `app/app/layout.tsx`)
9. **The tester's Charge refusals** (`chooseOutcome` / `chooseCallOutcome`, `src/lib/server/holds.ts`, `chargeRefusals`). Before: a Charge on a part whose own
   tester Charge was waiting for the developer's bank read "A payment for this is being confirmed right now.", and that "being confirmed" check ran before
   "the developer paid", so a developer payment at the bank hid §163's final refusal. After, in this order:
   (a) her own Charge at the bank: `You already charged $10.00 for your written answers. It's waiting for Nora Lane's bank.` (a recording: "for your
   recording"; a call: "for your call on <date/time>", in her zone) (`ownChargeWaitingLine`, `src/lib/rules.ts`);
   (b) the developer paid anything on the part: §163's final refusal (`Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be
   more.`), even while another payment of theirs on it is being confirmed (paid-anything wins; also under the lock in `claimChoice`);
   (c) "A payment for this is being confirmed right now." only when nothing was paid yet and the developer's first Pay is at the bank.
   The same for Let it go. Read this way (check): the owner's quote of the final refusal had no "meanwhile"; §163's line is kept as it is.
10. **"One of" call requests (option A).** Before: one row "one of: Thu 4:22 PM · Thu 4:22 PM · … · asked by Ana Silva" with "Accept Thu 4:22 PM" twice (two
    Thursdays). After, in both boxes on both sides (Requests to you / Your requests; the tester's page too): ONE ROW PER TIME, in time order, each
    `Thu, Nov 12, 4:22 PM · 30 min · Contract $31/h [Accept] [Decline]` (yours: `[Withdraw]`); no "one of:" and no "asked by" anywhere in these boxes. The
    press names its time (`time`). It stays ONE request for the limits (3 in total, 3 sends a day) and for the counts ("Requests to you (N)", "· N requests").
    - **Accept** on a row books that time; the request's other times close with it (their rows go on the redraw). Live, before the redraw, the booked time's
      row reads "Booked" and the other times' rows `Another time of this request was booked` (the pulse returns the booked call's time, `bookedAt`;
      `goneLineFor`). A press on one of those other times from an older page: `Another time of this request was booked.` (the requester; the accepter's other
      tab: `You already accepted another time of this request at <time>.`).
    - **Decline** on a row takes out just that time (stored as §184's drop rewrites a request: `keptRowsData`); the last time declined declines the request.
      **Withdraw** the same for your own (the other person's bell names the time); the last one withdraws it. The live lines name the time as before ("You
      declined Ana Silva's call request for …"). Taking out a time only goes through over the times as read (a booking, a drop or another press meanwhile wins).
    - A Decline / Withdraw of a time no longer in the request: `That time is no longer in this request.`; an Accept of one: "Pick one of the times." (as
      before; now also when a single time is left and the page named another, so it never books the other time).
    - Labels: Accept never names a time now (one row per time; a repeating row keeps "Accept all N"); `acceptChoices`, where a label still names a time, names
      its date (`Accept Thu, Nov 12, 4:22 PM`). The overlap, limit and refusal rules are unchanged.
    (`requests.ts` `answerRequest` and `timeAnswered`, `components/CallRequestsPanel.tsx` `timeRows`, `RequestRows.tsx`, `api/pulse/route.ts`)

No schema change.

### Tests
New `tests/layout-fixes-187.test.ts`: nested panels flat (one box, one grip), ScrollList / InsidePanel as the outer panel, LongText's inline branch, the phone
indents; `NameLink fit` drawn whole and its uses; `LIST_PANEL.testersCalls`; the held view's calls without the name in the person's drop-down; the question's
Show more in the summary (none under the title; CSS shows it only when open), a short question with none, `LongText inline`; hover cards `display: none` until
shown, and `hoverShift`; NavMenu (the button, aria, the dot, the links' container, the layout's use, Escape / navigation / outside / link close); Charge (a)
written and call, (b) paid plus another payment at the bank, (c) the first Pay at the bank; one row per time (3 rows, no "one of" / "asked by", Accept without a
time, labels with dates), `goneLineFor`, Decline per time down to the declined request (one request for the limit; a removed time: TIME_GONE / "Pick one of the
times."), Withdraw per time with the bell, Accept on a row then OTHER_TIME_BOOKED, Accept of a removed time with one time left refused. Updated (old structure):
`batch16-calls-live` (no "asked by"; the anchor on the first row), `batch26` and `batch35-parts-fold` (`LongText inline` for the form's question; the
QuestionTitle structure; `el` not `clone`), `batch35-added-per-question` (`pl-2 sm:pl-3`; the title's clamp attribute), `batch35-green-names` and
`batch35-name-links` (`NameLink fit`), `call-limit-request-boxes-185` (the fitted name; 4 rows for 3 requests), `long-text-cut` (the fitted pop-up check).

## §188 "Anything else" on every written part; Cancel from the Pay more box when your own check is open elsewhere (owner, Nov 4)

### A. One fixed "Anything else" spot after the last question

| Before (§167) | After |
| --- | --- |
| Additions made before §167 (no question) sat in a last fold "Added (not about one question)", shown only when there were some, with no way to add there. The sending-time notes sat under the questions as a plain "Notes" block, a changed-questions send's notes and loose files under their own dated "Added", then the files sent first not placed in an answer. New additions had to go under a question. | Every written part ends with ONE fold **"Anything else"**, after the last question, always there (closed at first, "· N added" when it has additions; empty: "(nothing)"). Inside, indented like a question: its original (the notes sent with the answers, and the files sent first not placed in an answer), then oldest first each addition made there, the old additions with no question (they moved here; the "Added (not about one question)" fold is gone) and each changed-questions send's own notes and loose files, each under "Added · <date time>". It has its own **Add to this answer**. |

- **The tester** (her session page): the "Add to this answer" rows below the answers panel end with Anything else's row ("Anything else" beside the button); pressed, its box opens in the panel under Anything else's latest part (its `data-add-slot`, §182), with "What you sent stays as it is. This is added under Anything else.". The same rules as a question's: counts toward the part's 10 (ADDITIONS_MAX; at 10 no button, the one note under the panel), 20,000 characters of its own (`checkAdditionLength`, refused on the first press), the stop-once for the developer's payment on the part (§183, forced whatever her Alerts), the single refusals (`addRefusal`), files placed in it by their markers, the paused / ended / changed-questions rules, and its draft kept under `add:<session>:else`.
- **Stored** in the existing additions with `questionKey: "else"` (`ANYTHING_ELSE_KEY`; a question's key is always "q…", so they never meet). An addition with no key (made before §167) is read as Anything else's too. No schema change, no migration.
- **The developer's side** reads it the same way wherever SentWork draws a written part: Needs you's part drop-downs and the update row, the tester rows, and the team's See the work / DisputeWork; every text in it folds with the shared long-text fold (LongText, §182 / §187). **By question:** its last entry "Other notes" is now **"Anything else"**: the notes, then what was added there, each under "*Added · <date>*" like a question's additions (was undated).
- **Lines:** "Ana Silva added to “Anything else” in her written answers" (the live line; "… after you paid", "… (already paid the most)"), the bell and email "… for “Harbor Run”", the tester's "Work sent" body "What you added to “Anything else” in your written answers was sent to Nora Lane.", and her own line in another tab "You added to “Anything else” in your written answers" (`addedToWhat`, `src/lib/additions.ts`).
- **Read this way (check):** a changed-questions send's own notes and loose files are that send's "anything else", so they moved into the fold too (dated, in order). Excerpts (Show an excerpt on your profile) are unchanged.
- **Code:** `additions.ts` (`ANYTHING_ELSE_TITLE`, `ANYTHING_ELSE_KEY`, `isElseKey`, `addedToWhat`, `writtenThreads().other`, `answersByQuestion`), `SentWork.tsx`, the tester's `page.tsx` and `SessionActions.tsx` (WrittenAddForm unchanged but for its note), `tests.ts` (`addRefusal`, `addWritten`, the "Work sent" body), `moneyLines.ts` (`addedWhat`), `actionText.ts`, `byQuestion.ts`, `ByQuestion.tsx`.

### B. Cancel this check in the Pay more box

| Before | After |
| --- | --- |
| A Pay more box greyed with "Your $30.00 payment for this part is waiting for your bank: finish or cancel it first." when the developer's OWN press on that part (Pay / Pay more, needs_action) was open at the bank in another tab or left open; this tab offered no way to cancel it. A charge made while away on the part greyed it with "Confirm Ana Silva's $10.00 charge with your bank first." and no button. | Own press: **Cancel this check** right next to the line. It is BankWaiting's own-press cancel (one shared function, `cancelOwnCheck`): Stripe first, so a check that already went through is recorded as paid once ("Your bank already confirmed it: paid $30.00."), else it is cancelled: "Cancelled: nothing was charged." (§170's words; the owner's "This check was cancelled: nothing was charged." read as that line). The box un-greys at once, without waiting for a redraw (a redraw drawn before the cancel that still names it doesn't grey it again: `payMoreWaits`'s `cancelled`); the other tab's open bank window shows its cancelled line through its peek, as before. A charge made while away / a team decision's charge (needs_confirmation): **Confirm with your bank** for it in the box (BankWaiting, with the over-$200 tick when needed; no Cancel, it can only be confirmed; no second `bank-<id>` anchor, Needs you's row keeps it). |

- The greyed box dims everything but the waiting row (`data-pay-greyed`, one CSS rule in globals.css), so its button is never dimmed. Pay more stays disabled while it waits (§159); the server still refuses a second Pay more while one waits.
- §174 kept: the box never greys over its own open check (nor for the check it just ended).
- `bankWaitsOf` (`payments.ts`) now says which it is (`kind`: own / away / pending, and the amount); the test page passes it to every Pay more box (`bankWaitsKind`). A first Pay whose own check is open elsewhere was already its "Confirming with your bank" box with Cancel this check (§160): unchanged.
- **Own presses are never in the Confirm with your bank lists** (owner, Nov 4, adding to B). Checked: every such list reads `waitingConfirmation` (needs_confirmation, failed and owed charges with a bank check: made while away, a team decision, an automatic retry): the test page's Needs you / person groups and the rows under a part (`bankWaitingOnTest`), the dashboard's "Your bank wants you to confirm" (`bankToConfirm`), Payments' Confirm list (`confirmItems`) and the one bell line with its totals (`tellBankWaiting`); Needs you's count is those rows plus the other things waiting. None reads an own press (needs_action), so nothing had to be removed; a regression test now holds it. The own press's Cancel this check lives in its part's Pay / Pay more box (this section), Pay what you owe's in its own box (OwedBox, unchanged). Confirm all's own open check stays the dashboard box's row with its Cancel this check (§147: that box is where it was pressed). An own check left open with no page showing its Pay box still ends on its own, as today: cancelled after 3 minutes without its window's heartbeat, or when its 15 minutes run out (§160).

### Tests
New `tests/anything-else-cancel-188.test.ts`. A: the fold drawn last with the notes as its original, the old untied and the new additions dated and in order, on an empty part too; the threads and keys; By question's last entry dated; the tester's row and slot, at 10 no button; adding there (stored key, live line, bell, own line, drawing, its kept draft); counts toward 10 (the 11th refused there and under a question); 20,001 refused on the first press, 20,000 goes; the stop-once for the developer's Pay more on the part (forced, Alerts Off), then goes. B: the waiting row names the own press and the box shows Cancel this check next to the line; the cancel (Stripe first, cancelled, §170's line, the box un-greyed, nothing waiting); one that already went through is paid once; a charge made while away shows Confirm with your bank and no Cancel; the own check is in none of the Confirm lists. Updated: `batch35-added-per-question` (Anything else instead of the general fold; By question dated; the "Work sent" body), `batch35-parts-fold` (the slot), `by-question`, `batch35-bank-box-call` (`kind`, the greying), `batch35-small-ui` and `batch24` (the shared cancel; the anchor prop).

## §189 One counter in the add box; the Pay more Note fits a phone; the page never wider than the screen (owner, Nov 4)

- **"Add to this answer" counted twice.** Before: the open box (a question's, and Anything else's: the same form) showed "0 / 20,000" twice: the editor's own
  counter and a second line of the form's. After: once, the editor's own (right under the box; red over the limit as before). It counts the addition alone
  (§186) and carries the `data-written-count` hook; the answers form keeps its own total counter. (`SessionActions.tsx`: AnswerBox `alone`, WrittenAddForm)
- **The Note in a Pay more box ran past the box on a phone.** Before: the Note's block had a 14rem minimum, wider than a Pay more box nested in a tester's row
  at 375px (6px past the box's edge). After: it fills the box and never more (`w-full min-w-0 max-w-full`, `data-pay-note`); a long name in "Note to <name>"
  wraps. Checked at 375px: the textarea inside the box, no sideways scroll. (`PayBox.tsx`)
- **A long name made the whole page scroll sideways (a §187 regression).** §187's fitted names (whole, cut only when the row is full) are one unbroken line,
  and the app's `<main>` (a flex column item, `mx-auto`) took the width of its widest unbreakable content: with a long tester name, the test page at 375px was
  714px wide (Needs you and Requests to you are open at first). After: main is capped at the screen (`max-w-[min(72rem,100%)]`, `data-app-main`; 72rem as
  before on wide screens), so the rows get the screen's width and the names are cut there ("Maximilianaalexandrab… · 2 things"). Checked at 375px with every
  drop-down open: nothing past the screen. long-text-layout's old rule ("long names wrap") follows §187 #3 now (cut when full), with this cap.
- **Merge check (no behaviour change):** four tests read source that §187 changed: `batch17-find` (the request's anchor is on its first time row, §187 #10;
  the bell's `#req-<id>` still lands in Requests to you, inside the tester's drop-down: now rendered and checked), `batch20` §28 (`LongText inline`, §187 #6),
  `batch35-answering-press` (`NameLink fit`, §187 #3), `long-text-layout` (above).
- Tests: new `tests/ui-fixes-189.test.ts`; updated the four above, `batch35-added-per-question` and `batch20` §1 (the counter's hook).
## §190 The team sees each person's Payments lists as they do (owner, Nov 4)

"If it's not too much, build it." Before, the team saw a person's payments only as raw lines ("review $10.00 to Ana Silva · charged · pi_…") in the profile's admin box (Payments she made / Payouts to her) and a test's history, plus the holds, chargebacks and decisions lists.

| Before | After |
| --- | --- |
| No way for the team to see what a developer or tester reads on their own Payments page. | On every profile's admin box (the developer's or tester's page an admin opens from Developers / Testers / Accounts: "For the team (only admins see this)"), right under the account's Suspend / Reinstate, **"Payments as <name> sees them"**: their own Payments lists, read-only. A developer: **"What you've paid"** with its total (and, during a hold with something in it, **"What you owe"**: Pay what you owe's lines and the amount its button pays). A tester: **"Your earnings"** with its total. Someone both: both. |

- **The same lines.** One component draws each list for both readers (`src/components/PaymentLists.tsx`: `DevPaidList`, `TesterEarnedList`), from the same reads (`src/lib/server/paymentLists.ts`: `developerPaid`, `testerEarned`; each line by `paidRows`, the total by `paidOutTotal`). So the team reads exactly the person's words: "confirmed with your bank", "confirmed with Confirm all", "paid through Pay what you owe", "charged by … after 7 days without a review", "Repaid the reversed $10.00 payment for … ($10.00 + $15.00 chargeback fee)", "· refunded (your bank's chargeback was reversed)" (out of the total), "· your bank reversed this (chargeback)", the tester's "You get $9.00 from Nora Lane for your written answers on “Harbor Run”" and "· delayed until your payout account is ready". The wording stays in the person's voice ("you", "your bank"). Payments now draws its two lists through the same component (no change to what the person sees).
- **What you owe** (`OwedReadOnly`): the lines of the developer's Pay what you owe box (`owedForBox`), "Waiting for your bank", what a reversed one payment covered; total = what the button pays. No Pay what you owe, no Cancel this check.
- **Dates in the admin's time zone** (the lines otherwise as the person reads them). The note under the heading says so: "Their Payments page's lists, read-only: each line as they read it, dates in your time zone."
- **Stripe:** each line with a PaymentIntent ends with " · Stripe", opening it in the Stripe Dashboard in a new tab: test keys → `https://dashboard.stripe.com/test/payments/<pi_…>`, live → `https://dashboard.stripe.com/payments/<pi_…>`. The mode comes from the key's prefix as every admin Stripe link (`stripeDashboardUrl`, `src/lib/server/adminLinks.ts`; the same reading as the mode switch's `keyMode`). A payment without one (recorded with payments not set up) has no link. A payment covered by Confirm all's or Pay what you owe's one payment links that one payment's PaymentIntent (the charge that paid it).
- **Links:** a line's test opens its team page (`/app/find/<id>`) rather than the developer's own test page.
- **Read-only, admins only:** no button of any kind. `accountPaymentsForAdmin` reads nothing for anyone who isn't an admin (a suspended admin included); the box is drawn only for an admin on someone else's profile, as before. Nothing else of the account is shown (no other admin's notes).
- **Long lists:** as on Payments: 8 lines, then "Show N more" opening a scroll box; at most the newest 500.
- No schema change.

### Tests
New `tests/admin-payments-190.test.ts`: a developer with a Pay, a Pay more, Confirm all, one confirmed with the bank, a Pay what you owe bundle, a chargeback won after it was repaid (refunded), and one recorded with payments not set up: the admin's list is the developer's own Payments list (same markup but for the Stripe links and the test links), the labels and the total; a Stripe link in test mode on every payment with a PaymentIntent and none without; no button. Dates in the admin's zone; live keys link to the live Dashboard. A tester's Your earnings matches hers (delayed share marked). What you owe during a hold: the box's lines, read-only, with the failed charge's Stripe link. Non-admins (and a suspended admin) get nothing. Updated (moved source checks): `batch8`, `batch10`, `batch35-list-panels`, `long-text-layout`, `paid-list`, `tester-hides-repay`.

## §191 What you've paid: one line for each charge that paid several items (owner, Nov 4)

"Items paid by ONE charge that covered several are shown as ONE expandable group line instead of each covered item on its own line." Correction (same day): every item inside a group names exactly what it was; a repayment is never "Repaid: the $1.00 your bank reversed + $15.00 chargeback fee".

| Before | After |
| --- | --- |
| Each item a Pay what you owe payment or a Confirm all paid was its own line in "What you've paid", ending "paid through Pay what you owe" / "confirmed with Confirm all"; nothing showed which items one charge paid together, or that charge's amount. | **One line per charge**, closed by default: "▸ Pay what you owe · $36.00 · Tue, Oct 20, 9:00 PM" ("Confirm all · …" for Confirm all's), at the charge's date in the reader's zone (the admin's in the team's copy, §190), with " · Stripe" to that ONE PaymentIntent in the team's copy. Open, each item it paid, only there (never also on a line of its own), named exactly, without the now-redundant "paid through Pay what you owe" / "confirmed with Confirm all". |

- **What is grouped:** the items whose `coveredById` is a one payment (kind "owed") that went through (`bundled`): Pay what you owe's (press, away, charges made while away) and Confirm all's (note "press:all"). Everything paid on its own keeps its line as before: Pay, Pay more, a single Confirm with your bank, a tester's Charge or a team decision confirmed singly, a debt settled before one payments existed. Not grouped: a chargeback hold's reservation (note "reserve"): its items get a one payment only once disputed, so they keep their lines. A group sits in the list at its charge's date (newest first) and counts as one line for the long-list rule (8, then "Show N more").
- **Items, named exactly** (`paymentRows.ts` `groupLine`, the tester, the part, a call by its date AND time in the reader's zone as §177/§178, the test, and what kind of payment): "Ana Silva's written answers on “Harbor Run”", "Pay more for …", "The team's dispute decision on Dee Park's written answers on “Second Run”", "Cid Moreau charged for his written answers on “Harbor Run”, after 7 days without a review", "The automatic charge for Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM), after 7 days without a review". Each with its amount.
- **Repayments inside a group** name the payment the bank reversed and what kind it was, then what was repaid: "Repaid: your $1.00 Pay more for Ben Okafor's written answers on “Harbor Run” that your bank reversed · $1.00 + $15.00 chargeback fee"; "Repaid: the team's $5.00 dispute decision on Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM) that your bank reversed"; "Repaid: the $12.00 Cid Moreau charged for his …"; "Repaid: the automatic $15.50 charge for … (Tue, Oct 27, 3:25 PM) …"; "Repaid: your $10.00 Pay for …"; "Repaid: your $7.00 Pay what you owe payment on Tue, Oct 20, 1:00 PM that your bank reversed" (a Confirm all payment the same); part of one: "Repaid: $96.00 of your $444.67 Pay for …".
- **Reversals.** The reversed ORIGINAL payment keeps its own line, "· your bank reversed this (chargeback)" (or "$96.00 of this"), and its repayment (+ fee) is inside the group that paid it. A chargeback won after it was repaid: the repayment inside the group reads "· refunded (your bank's chargeback was reversed)" and isn't counted. A one payment the bank reversed (§178): its group line reads "· your bank reversed this (chargeback)" (part: "$X of this"), as the rule for Pay what you owe's reversed one payments.
- **The total is unchanged:** the same rows, the same `paidOutTotal` (grouping only changes where a row is drawn; every listed payment is drawn exactly once). The group's line shows the charge's amount; it is not added again.
- **Finding a covered item:** Payments has no search box; a closed group is a `<details>`, which the browser's find-in-page opens on a match.
- **The team's copy** (§190) is drawn by the same component: the same groups, the group's Stripe link on its line (the items inside have none: they were paid by that PaymentIntent). **Testers** are unchanged: their earnings list each covered item on its own (they were paid per item).
- **Hooks:** `data-paid-group="<one payment id>"` on the group's `<li>`, `data-paid-group-item="<payment id>"` on each item (which keeps `data-paid-what`), `data-paid-group-what` / `data-paid-group-amount` on the summary, `data-paid-group-item-amount`.
- **Code:** `paymentLists.ts` (`developerPaid` → `entries`: `PaidEntry` = a payment or a `PaidGroup`), `paymentRows.ts` (`PaidRow.group`, `groupLine`, call starts in `lineContext`), `PaymentLists.tsx` (`PaidGroupLine`). No schema change.

### Tests
New `tests/grouped-payments-191.test.ts`: a seeded developer with a Pay and a single Confirm with the bank (own lines), Pay what you owe covering 3 items (written answers, an automatic call charge with the call's date and time, a Pay more's repayment + fee), Confirm all covering 2 testers on 2 tests (a tester's Charge, the team's decision), a chargeback won after it was repaid (refunded inside its group, not counted), a reversed Pay what you owe payment (its group marked; its repayment inside a later group), repayments of a tester's Charge, a team decision, an automatic call charge and part of a Pay. Each listed payment drawn exactly once; the total equal to `paidOutTotal` for the same rows and to the sum of the drawn lines; every item's exact wording; groups closed; the team's copy the same markup but for the Stripe links, one per group to its PaymentIntent; a tester's earnings unchanged. Updated: `admin-payments-190` (the covered items' "how" words now read on their group's line).

## §192 Refunds as their own lines; the bank's amount followed after the repayment (owner, Nov 4)

Two decisions. (1) Every refund the developer received is its own negative line in "What you've paid" (and the team's copy, §190), right under the payment it refunds. (2) When the bank changes what it took back (Stripe's `charge.dispute.updated`) AFTER the reversed payment was repaid, the difference is settled at once: refunded when lowered, charged when raised. Partial reversals (§133) work the same way throughout, since every amount is read with `reversedOf`.

| Before | After |
| --- | --- |
| A chargeback won after it was repaid: the repayment line read "· refunded (your bank's chargeback was reversed)" and was left out of the total. No line showed the refund itself. | The repayment line stays positive and keeps that mark. Right under it, a line of its own: "Refunded: your bank's chargeback on your $10.00 Pay more for Ana Silva's written answers on “Harbor Run” was reversed in your favour · −$25.00 · Thu, Nov 5, 9:00 AM". The team's copy adds " · Stripe" to the PaymentIntent the money was refunded from. Inside a Pay what you owe / Confirm all group, it's a row of that group, under the repayment. |
| "What you've paid"'s total = the payments that went through, minus refunded repayments, minus each reversal that wasn't won (`paidOutTotal`). | The total is the plain signed sum of the lines: every payment that went through (a refunded repayment too), minus every refund line, minus each reversal that wasn't won (as in §133) (`paidLinesTotal`). For the same history it's the same figure, and the tests assert that equality. |
| The bank changed the amount after the repayment: nothing changed for the developer. Every admin got an email ("Playtest: a chargeback's amount changed ($20.00 to $12.00)"), and the Chargebacks box read "…: not followed, because it was already repaid. Check it in Stripe." | **Followed at once**, relative to the last FOLLOWED amount (lowered: refunded; raised: charged). See the rules below. Admins are emailed only when a refund or a charge fails. |
| The bank changed the amount while the repayment was being charged, waiting for the bank, or reserved on the card: "…: not followed, because it's being repaid right now / it's reserved on the developer's card. Check it in Stripe." (plus an email). | **It waits** and is settled right after that ends: after the repayment if it went through, in what is owed if it didn't (§133's rule). No email. |

### The rules
- **Lowered** (e.g. $20 → $12): the $8 difference is refunded to the developer's card at once. It's a Stripe partial refund of the PaymentIntent that paid the repayment, for exactly that amount. When the repayment was part of a Pay what you owe / Confirm all one payment (or a captured reservation), that one PaymentIntent is refunded for exactly that amount, and the refund is recorded against the repayment row. The refund never exceeds what is still repaid for that reversal minus the $15 fee: the fee stays unless the chargeback is won. The money comes from the repayment first, then from each charge of an earlier raise (oldest first). Each refund is its own line.
- **Raised** (e.g. $12 → $20): the $8 difference is a payment of its own (kind "chargeback", `repaysId` = the reversed payment, note `raise:<from>:<to>`). It's charged like a charge made while away: off-session on the saved card through the waiting-charges path (`chargeDeferred`), so it sits in its "Pay what you owe" group like other charges made while away.
  - If the bank asks: it waits for "Confirm with your bank" (the usual 3 days).
  - Declined: the usual decline handling (it's owed, and a payment hold starts). The reversal itself stays repaid; the chargeback isn't reopened.
  - During a hold, a suspension or the team's pause of its test: it waits for the lift, like every charge made while away.
- **Several changes** each settle relative to the last followed amount (`Payment.reversedCents` is now the last followed amount). For example, $20 → $12 → $16 → $10 on a $20 payment:
  - $20 → $12: $8 refunded.
  - $12 → $16: $4 charged.
  - $16 → $10: $6 refunded.
  - Result: $35 − $8 − $6 + $4 = $25 still repaid, which is $10 + the fee.
- **Won later:** everything still repaid for that reversal is refunded (the repayment less its partial refunds, plus each raise that was charged), fee included. Each payment is refunded on its own PaymentIntent, and each is its own minus line. In the example above: $21 from the repayment and $4 from the raise. The developer gets ONE notice for the total, as before. A raise still owed (declined) is cancelled, and a change still waiting is dropped.
- **Lost later:** nothing more. Everything is already settled at the last followed amount. A `charge.dispute.updated` that says the dispute is decided is still not followed (it's logged, with the email).
- **Before the repayment** (owed, not paid yet): unchanged. §133 follows the change in what is owed, and the press stops once on Pay what you owe.
- **Once per change:**
  - It runs under the developer's row lock, as `disputeAmountChanged` did.
  - The amount is followed in the same transaction that records the refund or creates the raise. A retried delivery (or the same event forgotten after a failure and sent again) finds the amount already followed ("same").
  - Each refund has a unique key (`lowered:<event id>:<payment id>`, `won:<payment id>`). Stripe gets an idempotency key per refund.
  - A refund left "pending" by a run that stopped before Stripe answered is sent again by the 5-minute sweep and the daily job, with the same key.
- **A change waiting for a repayment in progress** is kept per reversed payment: the newest one, in AppState `cb-amount-pending:<payment id>`. It's settled when:
  - the repayment is recorded (`settleOwedRow`);
  - Pay what you owe's one payment holding it is released (`releaseOwed`), or its repayment is declined (`chargesDeclined`);
  - otherwise (a reservation that lapsed or was cancelled), by the 5-minute sweep and the daily job.
- The open bank window's blue notice (§160) no longer lists a change that was followed after the repayment. That change isn't about the check that's open.

### Every message
- **Developer, bell + email:**
  - Lowered: "Your bank lowered what it took back from your $20.00 payment for Ana Silva's written answers on “Harbor Run”: $8.00 refunded to your card." When payments aren't set up, the email adds "Payments aren't set up yet, so this was recorded and nothing was refunded."
  - Raised: "Your bank raised what it took back from your $20.00 payment for Ana Silva's written answers on “Harbor Run”: $8.00 more is charged."
  - A payment for several items (a reversed one payment) has no "for …": "…from your $35.00 payment: …".
  - Won (unchanged words, one notice): "Refund: your bank's chargeback of $10.00 was reversed". The email reads "Refund: your bank's chargeback of $10.00 was reversed: $25.00 refunded." and "Refunded to your saved card.". The amount is now everything still repaid.
- **What you've paid** (developer and the team's copy). The payment is named as §191 names it in a group: "your $20.00 Pay for …", "your $1.00 Pay more for …", "the team's $5.00 dispute decision on …", "the $12.00 Cid Moreau charged for his …", "the automatic $15.50 charge for … (Tue, Oct 27, 3:25 PM)", "your $35.00 Pay what you owe payment on Wed, Nov 4, 12:30 PM", "your $35.00 Confirm all payment on …", "your $35.00 payment reserved on your card on …".
  - Lowered: "Refunded: your bank lowered what it took back from your $20.00 Pay for Ana Silva's written answers on “Harbor Run”: $20.00 → $12.00 · −$8.00 · <date and time>".
  - Won: "Refunded: your bank's chargeback on your $10.00 Pay more for Ana Silva's written answers on “Harbor Run” was reversed in your favour · −$25.00 · <date and time>". When the bank reversed only part of it: "Refunded: your bank's chargeback on $50.00 of your $444.67 Pay for … was reversed in your favour · −$65.00 · …". A refund made before §192 (recorded only by its refunded repayment) has the same line with no date, since its date isn't known.
  - Raised: "Your bank raised what it took back from your $20.00 Pay for Ana Silva's written answers on “Harbor Run”: $12.00 → $20.00 · $8.00" (positive).
  - The repayment line still names what it repaid ("Repaid the reversed $20.00 payment for … ($20.00 + $15.00 chargeback fee)"), whatever was followed since. The reversed payment's own mark shows what the bank holds now ("· your bank reversed $12.00 of this (chargeback)").
  - The team's copy: " · Stripe" on each refund line (the PaymentIntent refunded) and on the raise (its charge, on its group's line).
- **The raise's name** in its receipt, the "Confirm with your bank" item, a decline, the waiting box during a hold, and the owed box: "the rise in what your bank took back from your $20.00 payment for Ana Silva's written answers on “Harbor Run” ($12.00 → $20.00)".
  - The owed box line after a decline: "The rise in what your bank took back from your $20.00 payment for … ($12.00 → $20.00) $8.00 · card declined Nov 5".
  - Its Stripe description: "Playtest: Charges made while you were away (Your bank raised what it took back from your $20.00 Pay for …: $12.00 → $20.00 $8.00)".
- **Admins, the developer's Chargebacks box** (admin console):
  - "Stripe changed the disputed amount of the $20.00 payment (pi_…) from $20.00 to $12.00: followed after repayment: refunded $8.00."
  - "… from $12.00 to $20.00: followed after repayment: charged $8.00 more."
  - "…: followed after repayment: nothing left to refund (only the chargeback fee is still repaid)."
  - "…: followed after repayment: refunded $8.00 (refunding $8.00 failed: check it in Stripe)."
  - "… from $96.00 to $50.00: waiting, because it's reserved on the developer's card; followed once that ends." (or "… because it's being repaid right now; …"), then the followed line when it ends.
  - Unchanged: "…: followed (the developer now owes $12.00 + $15.00 chargeback fee).", and "…: not followed, because the dispute is already decided (lost). Check it in Stripe." (also "the chargeback was already won", "the team already resolved it"), each still with the email "Playtest: a chargeback's amount changed ($20.00 to $12.00)".
  - Gone: "…not followed, because it was already repaid / it's being repaid right now / it's reserved on the developer's card…" and their emails.
- **Admins, emails only on failure:**
  - "Playtest: a chargeback refund failed ($8.00)": "Refunding $8.00 to the developer failed (<Stripe's message>): Stripe changed the disputed amount of the $20.00 payment (pi_…) from $20.00 to $12.00 after it was repaid. Refund it in Stripe.". A retry by the sweep that fails: "Refunding $8.00 to the developer failed (<Stripe's message>). Refund it in Stripe."
  - "Playtest: a chargeback's raised amount couldn't be charged ($8.00)": "Charging the developer $8.00 more failed (card declined): the bank raised what it took back from the $20.00 payment (pi_…) from $12.00 to $20.00 after it was repaid. It's owed now (a payment hold)."
- **Terms** (edited in place, no version bump), Payments and holds: "If the bank changes the amount it reversed after the developer repaid it, the difference is settled at once: a lower amount is refunded to their card, a higher one is charged to it like a charge made while they aren't there." Taxes and refunds: "Payments aren't refunded, except when the platform wins a chargeback the developer already paid (the amount and the fee go back to their card), or when the bank lowers the amount it reversed after the developer repaid it (the difference goes back to their card)."

### Schema
New table `PaymentRefund` (migration `20261117090000_payment_refunds`, additive only). Each row is one refund to the developer for a reversed payment they had repaid:
- `paymentId`: the repayment, or a raise charge, whose PaymentIntent was refunded;
- `reversalId`: the reversed payment;
- `developerId`, `amountCents`;
- `reason`: "lowered" | "won";
- `fromCents` / `toCents`: a lowered change's amounts;
- `status`: "pending" | "refunded" | "recorded" (no PaymentIntent: payments not set up) | "failed" (not a line; the admins were emailed);
- `stripeRefundId`;
- a unique `key`.

Refunds made before §192 aren't copied: their refunded repayment is read as one refund line. Raise charges are ordinary `Payment` rows (above).

### Code
- `holds.ts`: `disputeAmountChanged` (now with the event id) → `followAmount` (lowered / raised / waiting / followed / logged), `repaidFor`, `sendRefunds`, `followPendingAmount` / `followPendingSafely`, `settleDisputeAmounts` (the sweep and the daily job), `chargebackWon`'s refunds (what is still repaid, recorded per payment), `raiseWhat` (the raise's name in `owedItemName`, `deferredWhat`, `declinedWhat`, `owedLines`).
- `owedOnce.ts`: a declined raise is a debt, and the admins are told; waiting changes are settled on release.
- `chargeback.ts` `settleOwedRow`: a waiting change is settled once the repayment is recorded.
- `paymentRows.ts`: `paidLinesTotal`, `refundLines`, `paidPhrase`, the raise's line, and a repayment named by what it repaid.
- `paymentLists.ts` / `PaymentLists.tsx`: `refunds`, `RefundItem` (`data-paid-refund`, `data-refund-of`, `data-paid-refund-what`, `data-paid-refund-amount`).
- `pageFreshness.ts` `paymentsV`: refunds redraw Payments.
- `bankPeek.ts`: skips changes that were followed after the repayment.
- `rules.ts`: `bankLoweredLine`, `bankRaisedLine`, `raiseNote` / `raiseOf`, `raiseName`.
- The webhook passes the event id.

### Tests
New `tests/chargeback-refunds-192.test.ts`:
- refund lines: won after repaid (a minus line under the repayment; the total equal to `paidOutTotal` for the same history), and a refund made before §192;
- lowered after repaid: $20 → $12 (the fake Stripe refund of $8 on the repayment's PaymentIntent, the line, the bell, the Chargebacks line, no email), part of a payment ($96 of $444.67 → $50, then won: $46 and $65), and a repayment inside a Pay what you owe payment (a partial refund of that one PaymentIntent, its line inside the group);
- raised after repaid: $12 → $20 (one $8 off-session charge, its line and description, the bell), during a hold (it waits, is named in the waiting box, and is charged on the lift), and declined (owed, a payment hold, the admins' email, the reversal still repaid);
- 20 → 12 → 16 → 10 (refund $8, charge $4, refund $6; final state), then won (the $21 and $4 still repaid refunded, the total equal to the old figure, a later change logged), or lost (nothing more);
- a retried webhook (a duplicate, a forgotten event retried, two at once) never refunds twice;
- a raise during a reservation, settled right after the team's Approve; a reservation that lapses (the change is followed in what is owed);
- the team's copy is the same markup but for the Stripe links, with one on each refund line.

Updated: `partial-dispute` (a change while reserved now waits and is refunded after the Approve; emails only for what isn't followed), `paid-list`, `admin-payments-190` and `grouped-payments-191` (the refund line, and its Stripe link in the team's copy).

## §193 A charge about a tester stops every press about that tester once (owner, Nov 4)
- **The rule.** A CHARGE about a tester (her Charge on any of her parts, an automatic call charge on one of her calls, the team's dispute-decision charge) now
  stops once, whatever the Alerts ticks (forced, §160b), exactly the presses a dispute does (§171 A2). Presses about the whole test and about other testers keep
  following the Payments tick. The developer's own payments (Pay, Pay more, Confirm: "You paid …" and their own other-tab lines) are not charges.

| Press | Before | After |
| --- | --- | --- |
| Pay / Pay more on the part she charged | Forced (§171 A1: anything on the part); Pay itself is one refusal ("Ana Silva already charged $10.00 for her recording.") | Unchanged |
| Pay / Pay more on her OTHER part | Her Charge followed Payments (ticked off: no stop) | Stops once, forced |
| End early including her | Followed Payments | Stops once, forced |
| A call request with her; answering, withdrawing or cancelling one | Followed Payments | Stops once, forced |
| Confirm with your bank on a waiting charge of hers (`awayCharge`, §171 item 7) | §159's forced set only; her charge on another part followed Payments | Her charge on another part stops once, forced. The line of the charge it confirms (its own part) never stops it; Confirm all: a charge on any part it covers never does |
| Stop, Next round, Edit Save, Invite (the whole test) | Followed Payments | Unchanged |
| Any press about ANOTHER tester | Followed Payments | Unchanged |
| The blue notice in an open bank window | Everything about that tester, whatever the ticks (§171 A3) | Unchanged (the notice lists plain lines) |

- **What counts as a charge** (`TestEventLike.charge`). Test events: a `paid` line on a part (`part-<id>` / `call-<id>`) with a contract (the tester's Charge,
  an automatic call charge, also one waiting for a lift); "… closed with nothing to pay" charged nothing and isn't one. Payment lines (`devPaymentChanges`:
  went through / failed): a `dispute` payment (the team's decision), or a `review` / `call` payment with no press key (the tester's Charge, an automatic call
  charge; the developer's own Pay always keeps its press key, Pay more is `extra`). The decision's own line (`The team decided …`) was already forced (§171 A2).
- **Confirm with your bank while away** (§171 item 7 kept, widened): a charge about the same tester forces, except one on a part the press itself confirms. Without
  that exception the dashboard's Confirm (which keeps its first load's time, §176) would stop for the very charge it confirms, and Confirm all for the other
  charges it pays (`Press.confirms`: the covered parts, passed by `confirmAll.itemStops`).
- **Never a stop whose second press can only be refused.** Pay on the very part she charged stays one refusal before the gate (§163). The new forced presses
  (Pay more on another part, End early, call presses) are not settled by a charge, so their second press goes ahead.
- **Checked, no change:** an automatic call charge never happens while the developer's own Pay on that call is at the bank (`autoChargeCalls` → `pieceLocked`):
  it waits; once that Pay completes the call has its review and is skipped for good; when the Pay is cancelled (or fails), the next sweep charges it.
- **Terms** (edited in place, TERMS_VERSION stays 2): "Changes while you pay" lists "a charge about that tester (their Charge, an automatic charge for one of
  their calls, or the charge of the team's decision on their dispute; your own payments aren't charges)" among what always stops, and "… and so does a charge
  about that tester; presses about the whole test and about other testers follow your Alerts."
- **Code.** `rules.ts` (`TestEventLike.charge`), `live.ts` (`devChanges` tags charge lines, `devPaymentChanges` tags charge payments, `alwaysStops`,
  `Press.confirms`), `confirmAll.ts` (`confirms`), `confirm.ts` (comment), `termsOfUse.ts`, `docs/BLUE-NOTICES.md`. No migration.
- **Tests:** new `tests/charge-forces-tester-stops-193.test.ts` (her Charge on part A with Payments ticked off: Pay more on part B, a call request to her, End
  early including her, answering her request each stop once, forced, then go; Pay on the charged part is one refusal; another tester's Charge follows the tick
  (off: goes; on: stops unforced); Stop follows the tick; own payments aren't charges; a real automatic call charge and a decision charge's payment line force;
  which presses a charge is about; Confirm while away: her Charge on another part forces, its own charge's line and Ben's don't; the auto charge waits for the
  developer's Pay at the bank, skipped once it completes, charged after it is cancelled; the Terms). Updated: `batch35-stop-rules-v2` (a decision charge on her
  written answers now also stops Pay on her recording, forced; Ben's part still follows the tick).

## §193b Bank-change and reversal lines name a one payment's items (owner wording rule, Nov 4)
- **The rule.** Every line about a dispute, a team decision or the bank changing or reversing a charge names exactly which charge and which part. The gap left by
  §192: a reversed Pay what you owe / Confirm all one payment (it paid several items) read "your $35.00 payment" with no "for …". It now reads "your $35.00 Pay
  what you owe payment on Wed, Nov 4, 12:30 PM (Ana Silva's written answers on “Harbor Run”, Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM))"
  ("Confirm all payment on …"; a reservation "payment reserved on your card on …"). Full names in bells, emails and the team's lines; page lines keep their cut
  names (with the full line as the hover where the page has one).
- **Helpers.** `rules.paymentWords(paid, piece, one, whose)` ("your $X payment for <part>" / "your $X <one>"); `holds.onePaymentName` (the kind, when, and
  every item by `owedItemName`) and `holds.reversedNaming` (the part, a team decision named as one, or `one`). `paymentRows.oneName` builds the same words for
  What you've paid from the page's own context (§191's item lines).

| Line | Before (a one payment) | After |
| --- | --- | --- |
| Owed box (`chargebackOwedLine`) | "Your bank reversed a $11 payment: …" / "$96 of your $444.67 payment: …" | "Your bank reversed your $11 Pay what you owe payment on … (…): …" / "$96 of your $444.67 Pay what you owe payment on … (…): …" (the covered items stay listed under it) |
| Pay what you owe's stop (`bankChangedLine`) | "… took back from your $40.00 payment: …" | "… took back from your $40.00 Pay what you owe payment on … (…): …" |
| Bells / emails: lowered, raised (§192), a new chargeback, won, refund | "… your $35.00 payment …"; "Your bank's chargeback of $10.00 was reversed in your favour." | The one payment with its items; the win and refund lines now name the payment for EVERY chargeback: "Your bank's chargeback of $10.00 on your $10.00 payment for Ana Silva's written answers on “Harbor Run” was reversed in your favour." |
| A raise's name (receipts, bank check items, waiting lines) | "the rise in what your bank took back from your $35.00 payment (…)" | "… from your $35.00 Pay what you owe payment on … (…) (…)" |
| What you've paid: a repayment of a one payment | "Repaid $96 reversed from your $444.67 payment (…)"; a whole one kept the plain label "A reversed payment, paid again" | "Repaid $96 reversed from your $444.67 Pay what you owe payment on … (…) (…)"; "Repaid the reversed $11.00 Pay what you owe payment on … (…) (…)"; §191's group line "Repaid: your $7.00 Pay what you owe payment on … (…) that your bank reversed" |
| Bank window notice (`bankPeek.owedChanges`) | "Your bank changed the disputed amount of your $X payment from …" | Names the payment (part, or one payment and items) from the payment itself, in the developer's zone |
| The team: new-chargeback email, Chargebacks box, the person's Chargebacks rows, "Stripe changed the disputed amount …" notes | "a $10.00 payment (pi_…)"; "Chargeback open: $10.00 · pi_…" | The part or the one payment too, PaymentIntent kept: "a $10.00 payment for Ana Silva's written answers on “Harbor Run” (pi_…)", "Chargeback open: $10.00 for … · pi_…", "Chargeback open: $96.00 of a $444.67 payment on the Pay what you owe payment on … (…) · pi_…", "… of the $22.00 Pay what you owe payment on … (…) (pi_…) …" |

- Test-page change lines ("Your bank reversed …", "The team resolved …", "You repaid …") exist only for a payment with a contract (one part), so they already named it.
- **Code.** `rules.ts`, `holds.ts` (`onePaymentName`, `reversedNaming`, `raiseWhat`, `owedLines`' `cb.one`, `chargebackOpened`, `chargebackWon`,
  `disputeAmountChanged`), `chargeback.ts` (the reservation's stop), `paymentRows.ts` (`oneName`, the context's covered items), `bankPeek.ts`, `adminLists.ts`.
  No migration.
- **Tests:** new `tests/one-payment-names-193b.test.ts` (every helper with a one payment; `onePaymentName` / `reversedNaming` for Pay what you owe and Confirm
  all; the team's note on a one payment's changed amount). Updated: `partial-dispute` (the admin email and rows name the part; a one payment's owed line, its
  repayment lines and admin row name its items; the won and refund bells; the notes), `confirm-all` (the Confirm all one's owed line), `chargeback-refunds-192`
  (the notes; the refund bell), `grouped-payments-191` (the repayment's group line), `batch10` (the won and refund bells).
## §194 The bank notice's change lines scroll inside the bank box (owner, Nov 4)

**Before:** the blue notice at the bottom of an open bank check (`BankNotice`, §160) listed every change line as it arrived, without limit: with 10+ lines it pushed the bank box very tall (and, in Needs you, the bank's frame and Cancel far up the panel).

**After:**
- **Up to 4 change lines:** unchanged (the heading, the plain list, then the final line).
- **More than 4:** the list sits in a scroll box about 4–5 lines tall (8rem at first: about 5 one-line changes on a desktop, about 4 wrapped ones on a phone), with a small **"N changes"** count above it ("12 changes"; "1 change"). It is the app's own list panel (`ResizeBox`): the grip drags it taller or shorter (up to 60% of the screen), and a dragged height is kept for that check (`bank-notice-<payment id>`, this tab's sessionStorage).
- **The newest line stays in view:** the box opens at its bottom; a line that arrives scrolls it to the bottom only if the reader was already there (within 8px). Someone who scrolled up to read isn't moved.
- **The final line stays outside the box, always in view:** "Complete still pays … as pressed; or press Cancel." or "This bank check was cancelled: …".
- **§187 (only the outermost panel scrolls):** the bank box usually sits inside Needs you's panel (and a person's panel), where §187 would draw an inner panel flat, with no scroll, which is exactly the growth the owner asked to stop. The bank box is its own element there (the bank's fixed-height frame and Cancel, drawn under the press and brought into view on open), so the notice's list keeps its own scroll box: a new `OwnPanel` wrapper (Panel.tsx) resets "inside a panel" for it. It is the only use; every other nested panel stays flat.
- Unchanged: `role="status"` / `aria-live="polite"` on the whole notice; the hooks `data-bank-notice`, `data-bank-notice-line`, `data-bank-notice-still`, `data-bank-notice-cancelled`. New: `data-bank-notice-scroll` (around the scroll box) and `data-bank-notice-count`.

### Code
- `BankCheck.tsx`: `BankNotice` takes the check's `id`; `NOTICE_LINES_SHOWN` (4), `NOTICE_SCROLL_MAX` ("8rem"), `noticeCount`, `isAtBottom`; the reader's place is read from their own scrolling, and a new line scrolls to the bottom only from there.
- `Panel.tsx`: `OwnPanel`.

### Tests
New `tests/batch35-bank-notice-scroll-194.test.ts`: 3 and 4 lines (a plain list, no scroll box, no count); 12 lines (the count, then the panel with its grip and kept id holding all 12, then the final line outside it); a cancelled check's line outside it too; inside a panel (`InsidePanel`) the list still scrolls (not `data-panel-flat`); the count's wording; `isAtBottom`, and that a new line follows only a reader at the bottom. `batch35-bank-notice` needed no change (its one-line render is the same markup).

### Evidence
`playtest-lite-evidence/bank-notice-scroll-nov4/` (captions.json): desktop 1280×900 and phone 375×812 with 12 lines inside Needs you's panel; a reader scrolled up stays put when a 13th line arrives; a reader at the bottom follows the 14th.
## §196 The excerpt box is delete-only, with the answer shown above it (owner, Nov 4)

**Before:** "Show an excerpt on your profile" pre-filled a free textarea with the answer cut to its first 500 characters; the tester could type anything, and the
server refused added words ("Trim the excerpt from your answer: it can only leave words out, not add any.") only after Ask the developer. The excerpt had to be one
stretch of the answer (a contiguous substring).

**After** (`ExcerptPicker`, `src/components/Excerpts.tsx`; the shared rules in the new `src/lib/excerptTrim.ts`):
- **The answer, read-only, above the box** ("Your answer"): §182's long-text fold (`LongText`), 3 lines, then Show more opens the whole answer in the 8-line
  scroll box (the draggable panel, kept per `excerpt-original-<submission>`). Answers up to 20,000 characters.
- **The box starts with the WHOLE answer** (its plain text, as before: no formatting, no files) and is **delete-only**. What's kept is a per-character mask over
  the answer. Each change is compared with the box's previous text (common prefix and suffix, the caret placing the cut when the text alone can't tell): it's
  accepted only when it removed one stretch; anything else (typing, Enter, pasting, dropping, an input method's or autocorrect's insertion or replacement, undo)
  is put back at once with the caret where the change began. Deleting works however it's done: Backspace, Delete, word deletes, cut, a selection deleted, a
  phone's keyboard. Desktop browsers also refuse insertions before they happen (`beforeinput`); phones are covered by the comparison. The box has no spell
  check, autocorrect or autocapitalize, and is its own limiter (`data-typing-limit`: it never grows, so the paste note "Cut to the N-character limit." never shows).
- **The box is about 5 lines and scrolls inside**; its corner drags it taller (up to 60% of the screen). (Owner, Nov 5) No "Open the box taller" button. It never makes the page wider (checked at 375px: page width 375).
- **What's deleted is struck through in the answer above, live**, highlighted (a `<del>`, `data-excerpt-left-out`); the label reads "Your answer (struck through:
  what you're leaving out)" once anything is.
- **"Use original answer"** puts the whole answer back (greyed while nothing is left out). Picking another answer starts again from its whole text.
- **Deleting from the middle**: where a part of the middle was left out (words kept on both sides), the excerpt reads " … " there. Nothing marks a cut at the very
  start or end, and leaving out only spaces or line breaks keeps one space (words are never glued together). Line breaks and runs of spaces read as one space,
  as before. Under the buttons, "Shown as:" shows exactly what will be sent and stored, each " … " in amber, in a small box (about 4 lines, scrolling inside;
  not a fold, so no fold "…" can be mistaken for a gap). It shows only when that differs from the box's text.
- **The counter** counts the excerpt as it will be stored, ellipses included: "N / 500 (at least 10)", red outside 10–500; Ask the developer is greyed outside it.

**The server** (`requestExcerpt`, `fromAnswer`): the text is accepted when its "…"-separated pieces each appear in the answer, in order (whitespace tidied, after
`excerptPlain` as before). A text with no "…" is the old rule (one stretch of the answer). Anything added, a piece not in the answer or pieces out of order: the
same refusal, "Trim the excerpt from your answer: it can only leave words out, not add any." The 10–500 check counts the stored text with its ellipses. Every
other refusal (NDA, not paid, one pending per part / per question, duplicates, at most 3) is unchanged. The stored text is what was sent (squashed), so the
developer's Allow / Deny row, the bell and the profile show it with its " … " as they show any excerpt today.

- **Code.** `src/lib/excerptTrim.ts` (new: `allKept`, `keptChars`, `runsOf`, `excerptOf`, `deletedRange`, `deleteFrom`, `fromAnswer`, `squash`, `GAP`),
  `src/components/Excerpts.tsx` (`ExcerptPicker`; `defaultOpen` draws it open, for tests), `src/lib/server/excerpts.ts` (`squash` moved to excerptTrim; the
  check). No migration.
- **Tests:** new `tests/excerpt-delete-only-196.test.ts` (a change accepted only as one removed stretch, the caret placing it; deletions mapped back onto the
  answer; the stored text's " … " only in the middle, none at the start or end, a space for spaces; the server's piece check; requests: middle cuts accepted
  and stored with the ellipsis, added words / pieces out of order refused with the same line, 9 and 502 characters with ellipses refused, 497 accepted, the
  developer's row shows it; the box's own result at start, middle and end accepted; the render: the answer folded above the box, the box with the whole
  answer (not cut to 500), Use original answer, the red counter). The existing excerpt tests needed no change (none relied on the 500-character prefill).
- **Evidence:** `playtest-lite-evidence/excerpt-nov4/` (captions.json): desktop 1280×900 and phone 375×812 with a 3,241-character answer: opened, Show more,
  cuts at the start, middle and end (red counter, then in range), Use original answer. Checked in the same run: typing, Enter, a paste
  and an inserted text left the box unchanged; Ctrl+Backspace deleted; a request with a middle gap sent from the page went through ("Your excerpt request is
  waiting for Nora Lane.").
## §195 What you've paid a tester, once, by their name; not in each Pay box (owner, Nov 4)

Owner: each Pay box's "You've paid <tester> $15.00 so far on this test." is confusing inside one part's box. Show the total paid to that tester on this test
once, next to their name at the top, on the right of the name row, wherever their name heads a group. Pay more's own line of what the part was paid stays.

- **Before.** Every first Pay box (not Pay more) read "Listing: … · You've paid Ana Silva $15.00 so far on this test." (`paidSoFar`: every charged / not-set-up
  payment on the contract, a chargeback repayment and its $15 fee included, a reversal not taken off). The tester's row in the Testers panel had "Paid in all: $X
  · Calls: …" under the row (the same sum). Needs you's person summary (§181) was the green name and "· N things" only.
- **After.** The Pay box reads "Listing: …" only. "paid $15.00 so far" (grey, never cut, right-aligned) sits on the right of:
  1. **Needs you's person summary** (both views): "Maximiliana A… · 3 things            paid $15.00 so far". An applicant who hasn't joined has no figure.
  2. **The tester's row in the Testers panel**: on the name row (the fold's heading), after the status badges. The "Paid in all: $X" part of the line under the
     row is gone (the figure is shown once); its "Calls: 1 booked ahead, 1 done" stays, on its own ("Calls: …", only when there are calls).
  3. **The Call requests boxes' person drop-downs** (§185's "Requests to you" / "Your requests"): "· 2 requests   paid $15.00 so far" (trivial: the page passes it
     with each request).
  On a phone (below the `sm` width) the figure reads "paid $15.00" (no "so far"), so the name keeps room; the name is cut with "…" first; "· N things" and the
  figure are never cut. The Testers row's heading wraps on a phone as before (name, badges, then the figure).
- **What it counts** (`paymentRows.paidForWork` / `workPaidCents`): what the developer paid for THAT tester's work on this test: Pay (the tester's Charge and a
  call's automatic charge are recorded as Pay: kinds "review" / "call"), Pay more ("extra") and the team's decision charges ("dispute"), each charged or recorded
  with payments not set up. Never: a repayment of a reversed payment or its chargeback fee, a raise charge (kind "chargeback"), subscriptions, Pay what you owe's
  own record, a charge still waiting (for the bank, a hold, a retry). A payment the bank reversed (not won) counts less what was reversed and not paid back
  (`reversedOf`, §133; paid back = its repayment and raises that went through, less refunds of them, less the one fee: `repaidPrincipal`, holds.repaidFor's rule;
  §192's lowered / raised amounts follow). Not attributed: a bank reversal of Pay what you owe's ONE payment (it is on that payment, not on each tester's item).
- **Not changed.** `paidSoFar` (payments.ts) keeps its meaning where it is still used: the Pay API's response (`paidSoFarCents`) and the stop-once refusal's
  payload (payments.ts `review`, confirm.ts's away charge); no screen shows either. Pay more's paid line, every press, the counts.
- **Live redraws.** The figure is drawn with the page, so every live redraw (a Pay, a Charge, a bank confirmation, a chargeback) shows the new total.
- **Hooks.** New `data-paid-so-far="<cents>"` on the figure (`src/components/PaidSoFar.tsx`) in all three places; `data-tester-calls` on the calls line under a
  tester's row. Every other hook unchanged.
- **Code.** `src/lib/server/paymentRows.ts` (`WORK_KINDS`, `workPaidCents`, `repaidPrincipal`, `paidForWork`), `src/components/PaidSoFar.tsx` (new),
  `src/app/app/tests/[id]/page.tsx` (`paidWork`; `NeedsWho.paidCents`; the row heading; the calls line; `callRequests[].paidCents`), `PayBox.tsx` (sentence and
  `paidSoFarCents` prop removed), `src/components/CallRequestsPanel.tsx` (`PanelReq.paidCents`). No migration.
- **Tests.** New `tests/paid-total-195.test.ts`: the sum (Pay, Pay more, decision charge, the tester's Charge, an automatic call charge counted; waiting, failed and
  deferred charges, a repayment and its fee not; a part-reversal not repaid taken off; a repaid one and a won one whole; `paidSoFar` unchanged); a lowered amount
  refunded / a raise charged or waiting after a repayment; the page: the long-named tester's Needs you summary, Testers row heading and Call requests person each
  show `data-paid-so-far="1500"` "paid $15.00 so far" (" so far" hidden below `sm`; a $6 charge waiting for the bank not counted), no "Paid in all", the Pay box with its listing and no "so far
  on this test". Updated: `batch35-restricted-needs-you` (summaries end with "paid $0.00 so far"), `batch35-tester-folds` (the summary's calls line, the heading's
  figure), `layout-fixes-187` / `long-text-layout` (the row is `flex-1`), `anything-else-cancel-188` / `ui-fixes-189` (no `paidSoFarCents` prop).

## §199 Needs you: each kind its own drop-down; Confirm with your bank only in Needs you; one Applications drop-down; whole names in the Testers list (owner, Nov 4)

Owner: each kind under a person in Needs you should be its own drop-down with its count; "Confirm with your bank" only in Needs you, never as a working box in
the Testers list; an "Applications" drop-down above all the names. Coordinator, same day: the Testers list heading still cut a name at 12 characters with room
to spare, against §187's rule.

| Before | After |
| --- | --- |
| Inside a person's drop-down (§181), each kind was a small `h3` sub-heading (only when the person had more than one kind) with its items always showing under it. | **Each kind is its own drop-down**, closed at first, labelled with the kind and how many items it holds: "Pay (2)", "Confirm with your bank (1)", "Disputes (1)", "Excerpt requests (1)", "Call requests (1)" (restricted: "Booked calls (N)"). Also when it is the person's only kind. **Rate is the exception**: its line ("Rate Dan Reyes · 14 days left") stays plain under the name, no drop-down. Both views. |
| Each application and ask to rejoin sat in its person's drop-down; an applicant who hasn't joined was a person of their own. | **"Applications (N)"**, one drop-down above all the names (closed), every pending application and ask to rejoin on this test, oldest first, each with its Details and its own Accept / Decline exactly as before. They left the people: an applicant who hasn't joined is no longer a name; a rejoiner with other things keeps those under their name. The restricted view shows no applications (as before), so no group there. |
| The Testers list's code drew a working Confirm with your bank box under a part (`bankAt`) and for a charge on no listed part when `restricted`; a part's greyed Pay more box in a tester row held a working Confirm with your bank for a charge made while away (§188 B). | **Only the link up** "Confirm with your bank in Needs you ↑" (`bankUp`), in every view. The greyed Pay more box in a tester row shows the line only ("Confirm Alex Morgan's $6.00 charge with your bank first."; `PayBox awayInNeeds`), with the link right under it. Needs you's own Pay more (an update after paying) keeps §188 B's working copy (it is in Needs you). |
| The Testers row heading cut a name at 12 characters ("Maximiliana…") even on a wide screen. | **`NameLink fit`** (§187): the whole name, cut with "…" only when the row is actually full; the heading `min-w-0`, never wider than the row less the arrow (so the arrow stays beside the name on a phone). The status badges (`shrink-0 whitespace-nowrap`) and §195's paid figure are never cut; on a phone they wrap below the name as before. |

- **Kind drop-downs.** A `HoldFold` like the person's: a link to anything inside (`#bank-<id>`, `#piece-<id>`, `#call-<id>`, `#update-<id>`, `#item-dispute-<id>`,
  `#excerpt-<id>`, `#item-app-<id>`) opens it and every drop-down around it before the browser scrolls; it stays open while a bank box, a press, a stop box
  or a refusal shows inside. Not remembered across reloads. No border or padding of its own (no extra indent on a phone, §187) and no panel of its own (only
  Needs you's panel scrolls). Inside Pay, each part, its Pay / Pay more drop-downs are unchanged (§175 / §180 / §181).
- **Counts.** A kind's count is how many items it holds. The person's "· N things" is unchanged (§181: their call requests line counts as one thing), so with two
  requests from one person "Call requests (2)" sits under "· N things" counting it as 1. Needs you's badge is unchanged (it still counts every application).
- **The restricted view and the Testers list.** The restricted view (hold, suspension, the team's pause) returns before the Testers list (batch 15 §29), so its
  tester rows never existed: the `restricted ?` branches that drew BankWaiting there were unreachable and are gone. Its charges are confirmed in its Needs you,
  inside the person's "Confirm with your bank (N)" drop-down (`data-restricted-bank`).
- **The jump, checked in a browser** (3494, desktop and phone): the tester row's link opened Alex's person drop-down and his Confirm with your bank drop-down
  (both closed before) and landed on the charge, ringed, in view; nothing else opened; no page-wide sideways scroll.
- **Hooks.** New: `data-needs-kind-fold="<kind>"` on each kind's `<details>` (which also carries `data-needs-kinds` and the kind's own hooks:
  `data-bank-group`, `data-restricted-*`); `data-needs-kind` is now on the label in its summary (was the `h3`); `data-needs-applications="<N>"` on the group,
  `data-needs-applications-toggle` on its summary, `data-needs-application="<id>"` on each request's box. Rate's block keeps `data-needs-kinds="rate"` (a
  `<div>`). Every other hook and anchor unchanged.
- **Code.** `src/app/app/tests/[id]/page.tsx` (`needsPeople`, `needsApplications`, `needsEntries` without applications, `bankUp` / `bankAt`, the Testers row
  heading), `PayBox.tsx` (`awayInNeeds`). No migration.
- **Screenshots.** `playtest-lite-evidence/needs-folds-nov4` (captions.json): Needs you closed with Applications on top; a person's kinds closed, then Pay and
  Confirm with your bank open; Rate plain beside a Call requests drop-down; Applications open (an application, an ask to rejoin, an application); the tester
  row's link up and where it lands; the restricted view's kinds; the Testers headings and the long name at 1280 and 375.

### Tests
New `tests/needs-kind-folds-199.test.ts`: each kind a closed drop-down with its count (Alex: bank, disputes, excerpts; Eve's only kind, Pay, still a drop-down
with her part and Pay drop-downs inside), no `h3` sub-headings; Rate plain (with a Call requests drop-down, and alone); the Applications group inside Needs you
above every name, closed, "Applications (3)", oldest first (Fay, Eve's ask to rejoin, Cara) each with Accept / Decline, no applicant as a person, nothing
of theirs under a name, the badge unchanged (9); one working bank box on the page, inside the person's and the kind's drop-downs, the tester row's link to it,
the row's greyed Pay more with the line only; the restricted view (the charge in its Needs you, no Applications, the kinds as drop-downs; in the code
BankWaiting only in `bankKind`); the Testers heading with `NameLink fit`, the long name whole in the markup, badges and the paid figure uncut. Updated:
`batch35-restricted-needs-you` (labels with counts on drop-downs; Cara in Applications; 12 drop-downs), `batch35-green-names`, `long-text-cut`,
`batch35-tester-folds` (the fitted heading).

## §200 Change payout details (owner, Nov 5)

**Before:** Payments' "Where your money goes" offered a button only until setup was finished ("Connect a payout account" / "Continue setup"). Once connected there was no way to change the bank account. The payout problem's banner button "Update payout details" posted to setup, which refuses a connected account (§157: "Your payout account is already connected."), so a failed payout on a connected account (the usual case) could not be fixed from here.

**After:**
- **Connected** (`payoutsReady`): under "Your payout account is connected. Each payment is sent to it." a **"Change payout details"** button, then "Opens Stripe, where you change the bank account payments go to. Payments already sent stay where they went." It opens Stripe's own **Express dashboard** for the tester's SAME account (`stripe.accounts.createLoginLink`), where the bank account is changed. Bank details never touch this site; no new account is made.
- **Which Stripe page** (`payoutDashboardUrl`, `src/lib/server/stripe.ts`), from the account Stripe returns:
  - onboarding finished (`details_submitted`) and nothing currently or past due → the Express dashboard (login link);
  - onboarding not finished, or anything currently / past due → Stripe's **onboarding** for the same account (`account_onboarding` link, back through `/api/payments/payout-return`, which refreshes the status as setup's does). Stripe's rules: a login link only works for an Express account that finished onboarding, and `account_update` links are only for accounts whose platform collects the requirements (Custom), never Express.
- **The payout problem** (`payoutProblemAt`, design doc 9): the banner's "Update payout details" (dashboard and Payments) now posts to the same route, so it follows the same rule: the dashboard for a connected account (fixing the bank account there), onboarding when Stripe still needs details. Payments' own setup button is unchanged (Connect / Continue setup while not connected).
- **The route** `POST /api/payments/payout-dashboard`, built like setup's: this site's own form only (`sameOriginForm`, else 403), `requireUser`, `stripeOn()` (else `?error=off`), the stop-once for a payout change in another tab (`formGate(..., "payout", ...)`: the box under this button), payouts only to a confirmed email (as setup), payments switched off → `?error=paused` (§130). Open to suspended and held accounts (a suspended tester is still paid). A GET goes back to `/app/payments#payout`. Every refusal comes back to Payments with `press=change|update`, so the line names the button pressed (§156): "Your Change payout details didn't go through: We couldn't open Stripe. Try again." / "… Update payout details …".
- **Account unknown to Stripe (§130):** cleared (`forgetPayout`; a Payments page open elsewhere stops once, as with `refreshPayoutStatus`), and Payments shows "Connect a payout account" again with "Your Change payout details didn't go through: Stripe doesn't know your payout account any more, so it was removed here. Connect a payout account to be paid." `forgetPayout` now also clears `payoutProblemAt` / `payoutRemindedAt`: the problem belonged to that account, so its banner and 3-day reminders stop. No account at all (cleared meanwhile): "Your payout account isn't connected. Connect a payout account to be paid."
- **Same tab**, as Connect a payout account (no `target=_blank`). Stripe's Express dashboard has no return link to us; going back to Payments reads the current status (the page is dynamic). A change Stripe reports (`account.updated`) is recorded as before, so an open Payments page reloads (AccountRefresh), and a fixed payout clears the banner (`payoutFixed`).
- **Press names:** "Change payout details" added to `PAYOUT_PRESSES`; `CHANGE_PAYOUT`, `PAYOUT_CHANGE_PRESSES` and the route's name in `pressLabelOf` (`src/lib/pressLabels.ts`). Payments' payout refusal label for a connected tester is "Change payout details" (was "Continue setup").
- **The team's read-only view of a person (§190):** lists only, no payout box; unchanged (checked in the test).
- **Local fake Stripe** (`STRIPE_FAKE=1`): `accounts.retrieve` (a finished account, or one that still needs details for ids starting `acct_fake_due`), `accounts.createLoginLink` (`https://connect.stripe.test/express/<acct>`), `accountLinks.create` (`https://connect.stripe.test/setup/<acct>`).
- No schema change.

### Code
`src/app/api/payments/payout-dashboard/route.ts` (new), `src/lib/server/stripe.ts` (`payoutDashboardUrl`, the fake's accounts and account links, `forgetPayout` clears the payout problem), `src/app/app/payments/page.tsx` (the button and its line, the three new lines, the press names), `src/components/PayoutBanner.tsx`, `src/lib/pressLabels.ts`.

### Tests
New `tests/change-payout-200.test.ts`: the button only when connected (not with setup unfinished, no account, or Stripe off), under the connected line, with its line; the team's view has none; the press names. The route: a connected account → the login link of the tester's own account (same account kept); onboarding not finished, or details due → `account_onboarding` for the same account; unknown to Stripe → cleared (problem too), Payments offers Connect with the named line; no account; another tester's cookie gets only their own link, another site's form 403, signed out never reaches Stripe; GET; payments switched off (named paused line, nothing cleared); Stripe not set up; a Stripe error's line; the stop once for a change in another tab, then going on; a suspended tester; an unconfirmed email. The banner posts here naming its press; a connected account with a payout problem reaches the dashboard (setup refused it); one that needs details goes to onboarding, and its refusal names Update payout details. The fake Stripe's login link and onboarding link. Related suites pass unchanged: press-names, press-races, batch35-live-stripe, batch16-account-tabs, batch15-security, batch15-stripe, batch35-webhook, batch32-payout-wait, admin-payments-190, long-text-layout, batch16, design-misc.

### Evidence
`playtest-lite-evidence/payout-nov5/` (captions.json): the connected box with the button, desktop 1280×900 and phone 375×812 (page and box alone), and the press answered with a 303 to the account's Express dashboard login link (fake Stripe).

## §201 The developer's payments: "You paid …", stacked under one "Paid" entry a day (owner, Nov 5)
- **No "Receipt:" prefix.** Every payment that went through gives the developer one line (bell and email) in ONE form, whoever pressed:
  "You paid $10.00 for Ana Silva's written answers on “Harbor Run”". The rest of each line is unchanged, as specific as before:
  - Pay more: "You paid $5.00 for extra pay for Ana Silva's written answers on “Harbor Run”";
  - the team's dispute decision: "You paid $6.00 for the team's dispute decision on Ana Silva's written answers on “Harbor Run”";
  - the tester's Charge: "You paid $10.00 for Ben Okafor's written answers on “Sky Lab” (charged by him after 7 days)";
  - an automatic call charge: "You paid $15.00 for Cara Diaz's live call on “Sky Lab” (Tue, Oct 27, 3:25 PM EST, charged automatically after 7 days)";
  - Pay what you owe / owed payments: "You paid $35.00 for what you owed: …"; a reservation taken on the team's approval: "You paid $8.00 for what you owed (reserved on your card, taken on the team's approval)";
  - a subscription charge: "You paid $7.00 for your subscription ($7/month)".
  - **Choice:** "You paid" for every one, including charges the developer didn't press (decision, the tester's Charge, the automatic call charge): it is their card
    and their money either way, and the existing "(charged by … after 7 days)", "(…, charged automatically after 7 days)" and "the team's dispute decision on …"
    words already say who started it. A neutral "Paid $10.00 for …" was the alternative; it would also be the stack's heading word, so "You paid" reads clearer.
- **Confirm all's combined line** takes the same form: "You paid $42.00 for: Ana Silva's written answers on “Harbor Run” $10.00, Ben Okafor's recording on “Sky
  Lab” $32.00" (it was "We charged your card $42.00 for: …", and "Receipt: you paid … for: …" with payments not set up). The email body still says "Charged to your
  saved card." or "Payments aren't set up yet, so this was recorded and nothing was charged."
- **One stack a day, across tests.** Every one of these lines is in the new `devpaid` group (`PAID_GROUP`, lib/bell.ts): one entry a day across all tests,
  "Paid · 3 payments today" (`GROUP_COUNT_TITLES.devpaid`, counting lines: each line is one payment on the card; a Confirm all line is one payment). A day with
  one payment shows that line alone, like every stack. Unread count, mark read (expanding the stack reads all its lines; clicking one reads it), the Notifications
  page and the live redraw follow the existing groups unchanged (`bellKeyIn`, `unreadEntryCount`, `BellList`).
- **Only successful payments.** Failures ("Another payment was declined …", a hold starting), bank-confirmation lines, chargebacks, refunds, owed lines and
  everything else keep their lines and groups exactly as before (the "Payments and holds" stack, or their own line).
- **Subscription receipts stack too** (no rule says otherwise: BATCH-8 §8.5 put the subscription's *notices* (renewal declined, ended, free launch ending) in
  "Payments and holds", and those stay there; the subscription's receipt was always a receipt line).
- **The end-of-day email stacks them the same way** (`emailLines` in notify.ts now stacks `EMAIL_STACKED`: "deadlines" and "devpaid"): "• Paid · 4 payments" with
  each "• You paid …" line under it; one line of a kind stays a plain line.
- **Rules this supersedes** (doc agent, DESIGN-DOC.md "The bell"): "Receipts, a pause being lifted or extended, and outages are always their own line." now reads
  that receipts stack in "Paid" (pauses lifted and outages unchanged); the "Every bell line" row for receipts reads "You paid $X for <what>" and stacks in "Paid";
  the receipt examples drop "Receipt:". "One line for the same money" is unchanged: still one line per payment.

### The team's Approve of a hold lift (owner, Nov 5)
- It was "A note from the team about your hold" (the note only in the email) beside "Your tests are running again", or with no note only the latter, which never
  said the team approved it. Now ONE line in "The team decided" says what happened, with the team's note in it (the owner asked for the note IN the bell line: an
  exception to batch 15's "notes never in bell lines", for the team's notes on its own decisions only; Pay notes, stop and End early reasons stay out):
  - lifted: "The team approved lifting your hold: your tests are running again. Their note: “…”";
  - lifted, a suspension still on: "The team approved lifting your hold. Your tests stay paused while your account is suspended. Their note: “…”";
  - lifted, then a payment charged right after it declined: "The team approved lifting your hold. A waiting payment was declined, so your tests are paused again.";
  - not lifted yet (money still owed): "The team approved lifting your hold: it lifts once you have paid what you owe. Their note: “…”".
  No note: the same lines without "Their note". No separate "Your tests are running again" line any more for this lift (`liftHoldIfClear(…, { quietDev })`,
  as the chargeback hold's Approve already did).
- The other "The team decided" lines: the chargeback hold's Don't approve now carries the team's note too ("The team didn't approve lifting your hold: the $8.00
  reserved on your card was released, and nothing was taken. Their note: “…”"). The others already say what was decided and have no note for the developer
  (the chargeback Approve's lines, "The team reviewed your account: you can pay what you owe now", "Your developer account is paused / active again": a
  suspension's reason is never sent to the person).

### Code
- `moneyLines.ts`: `paidLine`, `paidAllLine`. `bell.ts`: `PAID_GROUP`, `GROUP_TITLES.devpaid`, `GROUP_COUNT_TITLES.devpaid`. `payments.ts` `receipt` and
  `confirmAll.ts` `allReceipt`: the new words and the group (every caller goes through these two). `notify.ts`: `EMAIL_STACKED`, `emailLines` (exported).
- `holds.ts`: `approveHoldLift`'s one line, `approvedWaitingLine`, `theirNote`. `chargeback.ts`: Don't approve's note in the line. No migration.

### Tests
New `tests/paid-stack-201.test.ts`: a Pay and a decision charge on “Harbor Run”, the tester's Charge and an automatic call charge on “Sky Lab”, one day: four
"You paid …" lines, none with "Receipt", one group and one bell key across both tests; the Notifications page shows ONE "Paid · 4 payments" entry (counted) with
the four lines; a declined Pay's lines stay outside it; the bell's number counts the stack once and reading it takes it off; the end-of-day email stacks them
under "• Paid · 4 payments". Confirm all's line and a subscription charge stack too; `emailLines` (one line stays plain, two kinds stack side by side). The
hold-lift Approve: one line with the note, one without, one before the money is paid. Updated for the words: `addition`, `batch8`, `batch11`, `batch18`,
`batch24`, `batch25`, `batch28`, `batch35-one-card-checks`, `batch35-payment-proofs`, `chargeback-review-first`, `choice`, `codex8-separate-sides`,
`confirm-all`, `press-races`; `batch23` (Don't approve's note in the line).

## §202 Bell lines: the first 30 characters, then the whole line on its arrow (owner, Nov 5)
- **Each bell line** (alone, or inside an opened stack) shows its first 30 characters then "…" when it is longer (`bellShort`, lib/bell.ts; `BELL_LINE_SHOWN`
  = 30). The cut never lands inside a word or an amount: if the 30th character is inside one ("$1,000.00" has no space), it goes back to the space before it
  ("Charged by the tester: $1,000.00 for …" → "Charged by the tester…"; a trailing ":" or "," goes with the cut); a single word longer than 30 is cut as is, by
  character (an emoji is never split). Lines of 30 characters or fewer show whole, with no arrow.
- **The arrow** beside a cut line (a button: `aria-expanded`, "Show the whole line" / "Hide the whole line", `data-bell-toggle`) opens the WHOLE line under it,
  names uncut, in a small scroll box (`max-h-32`, `data-bell-full`), amounts kept whole (`keepAmounts`). The words still follow the line's link. Opening the
  whole line marks it read, like clicking it; nothing else about reading changes (a stack is read when expanded).
- **Stack headings are unchanged** ("Paid · 3 payments today", "Disputes decided · 2 updates today", a test's cut name "· 3 updates"); the closed stack's preview
  of its newest line is cut at 30 the same way.
- **The whole line, names uncut.** A few bell lines were built with the cut names (12, now 20, characters): a declined charge ("Another payment was declined:
  $5.00 for Alexandria M…'s recording on “chargecharge…” …"), the tester's Charge and an automatic call charge added to what is owed during a hold. They now name
  the tester and the test in full (`pieceName({ full: true })`): every other bell line (receipts, disputes, decisions, joins, leaves, call requests, chargebacks
  since §193b) already did. So the stored line IS the full version: **no new column or migration** (the bell cuts it for display, and the emails, which use
  the same text, get the full names too). (A `full` column was considered: the worktree's node_modules is shared with the 3400 site, so a `prisma generate`
  there would hand the running site a client expecting a column its database lacks; and with the bell cutting at 30 it would only duplicate the text.)
- **Where:** the bell list is the Notifications page (`BellList`; the header's bell is a link to it with the count, there is no separate dropdown), desktop and
  phone alike.

### Tests
New `tests/bell-lines-202.test.ts`: `bellShort` (short lines whole; an amount at the cut; exactly at a space; an emoji word); the list's markup (the cut words in
the link, one arrow per long line with `aria-expanded="false"`, none on a short line, the heading unchanged; the whole line opened by the arrow reads it, in a
scroll box). Updated: `payment-piece-names` (the decline's bell line in full).

## §203 Listed names cut at 20 characters (owner, Nov 5; was 12)
- `NAME_CUT` (lib/rules.ts) is 20: every listed person, test and product name cut with "…" (`cutTo`, `cut10`, `<Cut>`, `pieceName` without `full`, `onTestLine`,
  `partAway`), and an email's part before "@" (`cutEmail`: its first 20 characters then "…" when it is longer than 21; the domain rule, 14, is unchanged).
  "Alexandria Montgomery" → "Alexandria Montgomer…"; "maximiliana.alexandrina@playtest.test" → "maximiliana.alexandr…@playtest.test". Nothing else was
  hard-coded at 12 for names (the comments in `Cut.tsx`, `AdminRich.tsx`, `BellList.tsx` and `rules.ts` now say 20). Places drawn with `NameLink fit` (cut only
  when the row is full, §187) are unchanged.
- **Tests** updated for 20: `long-text-cut`, `chargeback-line-names`, `partial-dispute`, `payment-piece-names`, `specific-lines-177`; `bell-lines-202` checks
  `NAME_CUT`, `cutTo`, `cutEmail` and `pieceName` at 20.
## §204 Searching the dashboards: Your tests (developer) and Search by developer or test (tester) (owner, Nov 5)

Owner: a search box on the developer's "Your tests" (test name or product name) and on the tester's "To do" (test name or developer name), any part, any case,
as they type. Coordinator, same day: the tester dashboard already has "Search by developer" right above To do: no second box; that box now searches the
developer's name OR the test's name, says so, and filters To do by either; everything else about it stays.

| Before | After |
| --- | --- |
| "Your tests" had no search; the category chips were the only filter. | **A search box above the cards** ("Search by test or product", label "Search your tests by test or product name", `maxLength` `FIND_SEARCH_MAX` = 100 as the Call requests and By question boxes, `type="search"` with the browser's own ×). As you type, only the tests whose name (as the card shows it, "Untitled draft (round 2)" included) or product name contains it, any case, trimmed (`yourTestMatches`, the same rule as §185's `matchesName`). Nothing matches: "No tests match “zzz”." and the cards box goes until the search is cleared. Works inside the category chip in use. |
| The tester's "Search by developer" matched only the developer's name ("No tests with a developer named “nora”."); typing replaced every section below it with the results. | **"Search by developer or test"** (placeholder and label): the developer's name OR the test's name, by the same name-search rule as before (batch 20 §9: 1–2 characters the start of a word or the whole name, 3+ any part), an exact developer or test name first, then most recently joined. No match: "No tests match “zed”.". The results box is unchanged. **To do now stays** under the results while the box is typed in, showing only its rows for the matching tests (the answers to give, each unsent part, "Every part sent"); none: "No tests in To do match “zed”.". The other sections still give way to the results, and clearing the box brings everything back. |

- **One list on the page, so no paging to worry about.** Your tests draws every card (the batch 16 §14 scroll box, no Show more); To do is every row. The
  searches filter what is drawn, so they cover every test, not just the ones in view; the scroll boxes are unchanged.
- **When the box shows.** As the Call requests boxes (§185: whenever the list has anyone, even one): Your tests' box shows whenever the developer has a test
  (not on "No tests yet"); the tester's box was always there and still is.
- **Live redraws keep what was typed** (each box's own state): checked in a browser, "sky" stayed in the box while a new test posted from the page arrived by
  the dashboard's poll, and the new card showed filtered with it.
- **Limits.** Your tests' box stops at 100 characters (the brief, as §185). The tester's box keeps §140's "Not limited" rule for "Search by developer"
  (unchanged: no `maxLength`, no counter).
- **Hooks.** New: `data-your-tests` (the wrapper), `data-your-tests-search` (the box), `data-your-tests-none` (the no-match line); `data-todo-search-none`
  (To do's no-match line). Every other hook unchanged (`#devSearch`, `data-dev-search`, `data-dev-search-row`, `data-dev-search-none`, `#to-do`,
  `data-todo-part`, `data-todo-sent`, `data-test-card`).
- **Code.** `src/lib/yourTestsSearch.ts` (new: `YOUR_TESTS_SEARCH_LABEL`, `yourTestMatches`, `noYourTestsLine`), `src/app/app/YourTestsSearch.tsx` (new: the box
  and the cards box, each card drawn on the server and passed in), `src/lib/devSearch.ts` (`devOrTestMatches`, `DEV_SEARCH_LABEL`, `noTodoMatchLine`;
  `searchByDeveloper` and `noDevMatchLine` on either name), `src/app/app/DevSearch.tsx` (the `todo` prop, `DevSearchHit`, `DevSearchList`),
  `src/app/app/page.tsx` (Your tests through `YourTestsSearch`; To do passed as `todo`, each row in `DevSearchHit`). No migration.
- **Screenshots.** `playtest-lite-evidence/dash-search-nov5` (captions.json): Your tests empty, "sea" (product), "lantern", no match, and after a live redraw;
  the tester's box empty, "ben" (a developer), "harbor" and "forge" (test names), desktop 1280×900 and phone 375×812.

### Tests
New `tests/dash-search-204.test.ts`: `yourTestMatches` (name or product, any part, any case, trimmed, blank keeps all) and its line; the box rendered with
`maxLength="100"`, its label and placeholder, above the cards box; the developer dashboard rendering the box over both tests and none with no tests;
`searchByDeveloper` / `devOrTestMatches` by developer or test name (the 1–2 character rule, exact first) and the lines; one DevSearch on the page, To do
passed as `todo` with its three kinds of rows wrapped; the tester dashboard rendering the box above To do with the part's row. Updated:
`batch16-dashboard-search` (the no-match line, the `todo` prop, the placeholder constant), `batch16-lists` (the cards box is in `YourTestsSearch.tsx`).
## §114 A deleted account's email can sign up again when it was clean (owner, Nov 1; wording Nov 5)

Owner: a deleted account kept its email, so signing up with it said "An account with that email already exists", which misled (signing in fails too). A CLEAN
deleted account's email signs up again as a brand-new account; one that isn't clean is refused with "This account was closed." and Contact us, no details. The
open question is decided: an admin's deletion is not clean. Google sign-in follows the same rules.

| Before | After |
| --- | --- |
| Sign-up with a deleted account's email: "An account with that email already exists" (red at Email). | **Clean** (at the moment of sign-up): the sign-up goes through as a **new account**, separate from the old one (new id, nothing carried over: no tests, payments, ratings, card, Stripe ids, hold count or bio). **Not clean**: red at Email, exactly **"This account was closed."** followed by a **Contact us** link (to Contact us, `/app/help`, as RestrictedBox's refusals link it); listed with the other mistakes on the first press (§170); the bullet under Sign up reads the line alone. |
| Continue with Google with a deleted account's email signed into nothing (a session the app never accepted, back to Log in). | Google never signs into a deleted account. **Clean**: Google's short sign-up step (§134), and Continue makes the new account. **Not clean**: the login page shows "This account was closed." with Contact us (`/login?error=google_closed`). Clean when Google answered but not by Continue: the step refuses with the same line and link (blue, not named after the press). |
| An active account's email: "An account with that email already exists". | Unchanged. |

- **Clean** (`notCleanWhy`, `isClean`; checked when the email is read and again inside the commit that makes the account): deleted by its owner (`deletedBy` "self";
  an admin's deletion is never clean), no payment or chargeback hold (`holdStartedAt`), no suspension on either side, no open chargeback, and nothing owed: no
  payment of the old account's that failed and isn't settled (`owedUntil`), is "owed" (a Charge or decision during a hold), "deferred" and unsettled (waiting for a
  lift), "needs_confirmation" (waiting for the bank) or "paying" (a Pay what you owe in flight). The reason is for the code and tests only; the person reads the one line.
- **Where the original email is kept (no migration, no schema change).** The old row's email becomes a tombstone that keeps the original inside it:
  `ana@example.com (deleted <old id>)`. The unique email index takes the new sign-up; the tombstone has a space, so no typed email can ever be it (`isEmail` refuses
  it); the admin's console still finds the old account by the original email (Accounts search matches any part of the email from 3 characters) and every admin line
  shows it. The account's state line (Accounts list and the profile's admin view) ends "· Its email was freed for a new sign-up", and its Holds and suspensions box has
  "Email freed for a new sign-up: ana@example.com" (an AccountEvent `email-freed`, note: the original email, at the moment of the sign-up).
- **Freed in the same commit as the new account** (`freeDeletedEmail`): the old account checked clean again, its email renamed (only while it still holds that email),
  its unused email links (reset, confirm) used up and moved to the tombstone, the event recorded, then the new account created. Two tabs signing up with the freed
  email at once: one account; the other tab reads "An account with that email already exists" (the races rule, Nov 3); two Google steps sign both into the one account.
- **Nothing else of the old account changes**: still deleted, every test, payment, rating, chat, dispute and excerpt stays under it (design doc "Deleted accounts":
  history stays); holds, chargebacks and money owed are never cleared (a not-clean account keeps its email). Emails still about the old account (a receipt for a
  charge on its saved card after a delete, §151; a summary) go to the original address, as any deleted account's do (`sendEmail` reads the address back out of the
  tombstone), never to the tombstone.
- **Every lookup by email, checked:**
  - Sign-in (`logIn`): finds the new account only; the old account's password never signs in (the old row isn't found by the email, and is deleted). The one
    "Wrong email or password" rule (batch 15 §7) is unchanged.
  - Forgot password / reset (`requestReset`, `resetPassword`): the email goes to the address for the new account only; the old account's earlier reset links are
    used up ("This link has expired or was already used.").
  - Email confirmation (`confirmEmail`): a deleted account's link confirms nothing ("That link didn't work") and never the new account; the new account's own
    3-an-hour limit doesn't count the old account's links.
  - Google (`finishGoogle`, `finishGoogleSignup`): as in the table; an unconfirmed active account's pre-hijack clearing (batch 15 §41 H2) is unchanged.
  - Sign-up (`signUp`): as in the table.
  - Notifications by email (`notify`): the tombstone finds the old account (its bell), the original email the new one.
  - Admin search (Accounts, Find tests by a developer's email): finds both by the original email; the exact match (the new account) first.
  - Invites: by account id, never by email (nothing to change). Stripe: customers and Connect accounts are found by their stored ids, never by email; the new
    account makes its own customer when it saves a card (the old one keeps its own ids, unique, untouched). Sign-in and sign-up attempt limits stay per typed email.
- **Not changed.** Deleting an account (batch 12 §1, §119, §151), what a deleted account shows to others ("Deleted account"), "This account no longer exists".
- **Hooks.** `data-account-closed` on the blue line (login page, Google's step); `data-contact-us` on its link and on the link after the red line at Email. The
  sign-up page's Email box matches the line (`data-match="email|account was closed"`), so it is red there and not only listed under the button.
- **Screenshots.** `playtest-lite-evidence/reuse-email-nov5` (captions.json), desktop 1280x900 and phone 375x812 (own server on 3498, a throwaway schema): the
  refusal at Email with Contact us; the list under Sign up (one bullet, the line alone); the Google refusal on Log in. Contact us, pressed while signed out,
  goes to Log in (`/login?next=/app/help`): Contact us needs an account (see the owner's choices).
- **Code.** `src/lib/server/reuseEmail.ts` (new: `notCleanWhy`, `isClean`, `freeDeletedEmail`, `tombstoneOf`, `isTombstone`, `originalEmail`),
  `src/lib/accountClosed.ts` (new: `ACCOUNT_CLOSED`, `CONTACT_US_HREF`), `passwords.ts` (`signUp`, `confirmEmail`), `google.ts` (`finishGoogle`,
  `finishGoogleSignup`, `google_closed`), `email.ts` (`sendEmail`), `accountState.ts`, `adminLists.ts` (the event's label), `FieldChecks.tsx` (the link after the
  red line; the bullet keeps the line), `Err.tsx`, `src/app/login/page.tsx`, `src/app/signup/page.tsx` (the Email box's match). No migration.

### Tests
New `tests/batch35-reuse-deleted-email.test.ts`: a clean deleted developer's email signs up again (a separate account with nothing of the old one's; the old one keeps
its test, payment and rating; the tombstone; the event; the admin's search finds both, the new one first; the state line and the box line); the old account can't be
signed into (old password wrong, the new one signs into the new account, the tombstone is "Enter a valid email", the old session stays dead); Forgot password goes to
the new account only (the old reset and confirm links do nothing; the new link sets the new account's password, not the old one's); an email to the tombstone goes to
the original address; a deleted tester too; refused with "This account was closed." for a failed unpaid charge, an "owed" charge, a deferred charge, a charge waiting
for the bank, an open chargeback, a payment hold, a chargeback hold, a developer-side suspension, a tester-side suspension and an admin's deletion (nothing changes;
with other mistakes, every line at once); an active account still "already exists"; Google: clean (no sign-in to the old account, the step makes the new one and frees
the email, Google again signs into the new one), not clean (`google_closed`, the login page's line and link), not clean by Continue (refused, no account made), a fresh
email and an active account unchanged; the page's sources (the link after the red line, the Err and login lines).

## §205 Confirm with your bank also stops for a dispute by that tester (owner, Nov 5)

- Confirm with your bank on a charge made while away (`awayCharge`) already stopped once, forced, for the team's decision about that tester, that tester leaving and a charge about them (§193). A dispute by that same tester now forces it too (`live.alwaysStops`); before, it followed the Disputes tick. Another tester's dispute still follows the tick. Test: `tests/charge-forces-tester-stops-193.test.ts`.

## §206 Pay what you owe's stop: one bullet per change (owner, Nov 5)

- Pay what you owe's stop-once (`payOwed` in `src/lib/server/holds.ts`) sent ONE line joining every change since the page drew ("Added to what you owe meanwhile: A, B. Your bank's chargeback … was reversed in your favour … Your bank changed the amount … New total $45.00. Press again to pay $45.00."). Each change is now its own bullet, like every other stop box: one per item added ("Added to what you owe meanwhile: <item>") or failed ("Another payment failed meanwhile: <item>", chosen per item, no longer only when every new item failed), one per chargeback won, one per amount the bank changed; then a last bullet "New total $X. <press-again line>" (the tick's or the reservation's wording as before). With nothing itemised it stays the single "What you owe changed: now $X. <press-again line>".
- The total bullet (and the single "What you owe changed" line) carries `key: "owed-total"`, so a second stop's `mergeChanges` (OwedBox) replaces the earlier total instead of showing two; the new total stays the last bullet.
- "New total $X." now also shows when only the bank's amount changed (it read just the press-again line before).
- The chargeback hold's reservation stop (`reserveOwed` in `src/lib/server/chargeback.ts`: the bank changed the amount while the reservation was being made) has the same shape: one bullet per amount the bank changed, then "New total $X. <press-again line>" keyed `owed-total` (they were joined with "; " before).
- Tests updated: `batch10`, `batch3`, `batch35-payment-proofs`, `batch35-stop-rules-v2` (§171 B6c), `owed-over200` (three cases), `pay-matrix` (§159 rule 5: the total bullet on both stops), `owed-dispute-change` (two cases), `partial-dispute` (§133 dispute.updated), `races-nov3` (race 3, the reservation's stop). Also in `batch35-stop-rules-v2`, §171 item 7 follows §205: her dispute now stops Confirm with your bank once, forced (the payment line on her part still doesn't); the press after it goes through and the window's notice still lists both.
## §207 Fixes from the Nov 5 recordings (owner, Nov 5)

Five bugs from the night's recordings (captions: `playtest-lite-evidence/recordings-nov5/captions.json` and `recordings-nov4/captions.json`). No settled rule
changed: each fix makes the app do what its section already says.

1. **The Alerts menu opens inside the screen (R5, P1, P2, P5, P6).** On the developer's test page the menu (`absolute right-0 … w-72`) hung past the LEFT edge
   when its button sat near the left (the header's buttons wrapped under the title), so its ticks couldn't be pressed. It is now placed from where its button is
   when it opens (and again when the window changes size): right edges together when there's room on the left, as before; otherwise left edges together; and
   when neither fits, slid in from the edge it would cross, 8 px from it (`menuLeft`). Phones keep it in the page under the button (static, full width).
   Measured at 1280, 1024, 768 and 375: all of it on the screen, its ticks pressable (at 768 its left edge was at x = -78 before).
2. **The team lifting its pause is named like the pause (R4b).** A press from a page drawn before the lift stops once with "The team lifted its pause on this
   test at 3:08 AM." (`devLiftSince`, from the lift's own event), as the pause stops once with "The team paused this test at 3:08 AM."; a page from before both
   names both, oldest first. The tester side had the same gap: "This test resumed at 3:08 AM." (`testerLiftSince`; testers still never read why; not while the
   developer's own hold or suspension keeps the test paused for them). It is a forced stop line like the pause's (no "turn off" for it); the second press goes
   ahead. Developer: every press with the pause line (devGate). Tester: the presses that name the pause (Charge / Let it go, Dispute, call presses, terms, Rate).
   A hold's lift (the developer's own Pay what you owe) and a suspension's reinstatement are unchanged.
3. **Accept on a withdrawn call request from an older page shows its refusal (R8c, Nov 4; §185).** The server's single refusal ("409 gone: Ana Silva withdrew
   this request.") was shown under the button, but the refusal's own redraw took the row away and the line with it, and the kept line (§116) went too: on the
   recording's older page the page's version couldn't be read at the refusal, so the version the page still showed (from before the withdrawal) became the
   baseline and the refusal's own redraw counted as a newer version. Now (a) when the version can't be read, the first version shown after the refusal is its own
   redraw (the baseline) and only a later one clears the line (`watchNewPageVersion`, `serverVersionOrNull`; §116 unchanged otherwise); (b) the request boxes
   (both sides) keep the named line above their people once the row is gone: "Your Accept didn't go through: Ana Silva withdrew this request."
   (`lostRefusal`, `[data-request-refusal]`). When the box itself goes (it was the only request), the kept line shows at the top of the page (§116).
4. **Verify a card's own Cancel reads as a cancel (R1e, Nov 4).** Cancel under the card check's bank window (the check not finished) now reads "Cancelled: your
   card wasn't changed." (a plain line, as Pay's "Cancelled: nothing was charged."), never "Your Verify this card didn't go through: The card wasn't
   verified…". The window's Cancel tells the finish it was the developer's (`pressedCancel`); the server cancels the card check at Stripe as before and answers
   `{ verified: false, cancelled: true }` (no 409, so no refusal is kept and the page doesn't redraw for it). The bank refusing the card, the peek ending it
   and leaving the page still read as before; a check that had gone through still verifies the card.
5. **A bank window whose check is cancelled underneath it stays open with its notice (R10b and R1c, Nov 4; §160, §171 B6 b).** Whatever ends a check cancels it
   at Stripe FIRST, then lets go of it in the app and (Pay what you owe's one payment) marks it cancelled. A 3-second peek landing in between read Stripe's
   "canceled" while the app still held the check (or the check let go of but not yet marked) and answered "done": the page ran its finish at once and the window
   closed by itself with "Your Pay what you owe didn't go through: This payment was cancelled: nothing was charged." Now such a peek waits (up to 2.5 s,
   `SETTLE_MS`) for the app to finish ending it and answers from that: "This bank check was cancelled: your bank decided a chargeback in your favour, so what you
   owe changed. Pressing Complete won't charge anything." (or the cancel's own reason), the window open until Complete or Cancel. The same for Pay, Pay more,
   Confirm and a chargeback hold's reservation. A check Stripe shows cancelled that the app never lets go of still keeps the window open ("…it was ended
   elsewhere…"). The one payment's reason is now written with its cancel (`releaseOwed(id, failure)`), so no peek reads it cancelled without its reason.

- **Code.** `AlertsMenu.tsx` (`menuLeft`, `MENU_EDGE`, placed on open and resize), `rules.ts` (`liftMomentLine`), `stopMoment.ts` (`devLiftSince`,
  `testerLiftSince`, `TEAM_PAUSED_EVENT`, `TEAM_LIFTED_EVENT`), `tests.ts` (devGate), `api/sessions/[id]/[action]` (stateMoment), `ratings.ts` (the tester's
  Rate), `pageVersion.ts` (`serverVersionOrNull`, `watchNewPageVersion`), `CallRequestsPanel.tsx` (`requestOfPress`, `lostRefusal`), `BankCheck.tsx`
  (`BankFinish`: the box's Cancel says so), `ChargebackSteps.tsx` (`CardCheckCancelled`, the plain line), `api/payments/verify-card` (`pressedCancel`),
  `bankNotice.ts` (`CARD_CHECK_CANCELLED`), `bankPeek.ts` (`piState`, `settled`, `SETTLE_MS`), `owedOnce.ts` (`releaseOwed`'s failure). No migration.
- **Tests.** New `tests/rec-findings-nov5.test.ts` (1: the placement at the four widths' button spots, the edges, the phone; 2: the lines, the developer's Stop
  after the lift (R4b), a page from before both, the tester's press after the lift and from before both; 3: the server's single named refusal, the panel's
  kept line, the kept refusal surviving its own redraw when the version can't be read, and the read case as before; 4: the pressed Cancel's answer, the bank's
  refusal still a refusal, a Cancel after it went through verifies; the window's Cancel and the steps box). `tests/batch35-stop-rules-v2.test.ts` "§207":
  the peek between Stripe's cancel and the app's (a chargeback won), between the let-go and the mark (Pay what you owe's release; Cancel this check), a check
  never let go of, a Pay cancelled by a hold starting.
- **Screenshots.** `playtest-lite-evidence/rec-fixes-nov5` (captions.json; own server on 3499, a throwaway schema): the Alerts menu open on the test page at
  1280 and 375; the refusal line kept in "Requests to you" after Accept on Ana Silva's withdrawn request from an older page.

## §208 "+ Another time" sends separate requests (owner, Nov 5)

**This replaces the "Choose one" part of NEXT-UI 7 and of this batch's rules** (§132's "the other side picks one", §184's "a choose one request loses only the
overlapping times" for new requests, §185's "a 'one of' request is one request", §187 item 10's "it stays ONE request for the limits"). Those rules still describe
the older "choose one" requests already waiting, which keep working as they are (not migrated); no new one is ever made.

| | Before | After |
| --- | --- | --- |
| A press with 2–3 rows ("+ Another time") | ONE request; the other side accepted one time, which booked it and closed the others | **One request per row** (each keeps its own Once / Daily / Weekly; a daily / weekly row is one request as before) |
| Limits (§185) | 1 toward the 3 in total and 1 of the 3 sends a day | Each request counts: N rows = N toward the total and N sends today (an auto-matched row: 1 send, nothing new toward the total) |
| Over a limit | refused at 3 | The whole press refused on the first press (never a stop first), nothing made, with how many more can go: `You already have 2 calls or requests with Ana Silva: you can send 1 more.` / `You can send 1 more request to Ana Silva today.` (none left: §185's lines unchanged). Both limits short: the tighter one is named (a tie: today's). |
| The form's note under 2–3 rows | `They pick one of these.` (§162: `She picks …`) | `Each time is sent as its own request.` (`SEPARATE_TIMES_NOTE`, `data-separate-times`) |
| The form's red limit line (`clashNotes`) | at 3 taken | when taken + the rows that aren't an exact match pass 3, in the words above |
| Two rows of one press overlapping | red "Overlaps time 1 in this request (…)" | the same, worded `Overlaps time 1 in this form (…)`, still refused by the server at the row |
| Accept on one | closed the request's other times | never closes the others (only §184's drop when a booking overlaps them, unchanged) |
| The press's done line | `Request sent.` | `Request sent.` / `3 requests sent.` (`sentLine`) |

- **Server** (`src/lib/server/requests.ts`): `readKind` returns the rows and `each` (one request per row, `kindOfRow` / `kindData`); "Offer up to 3 times to choose
  from." is now `Send up to 3 times at once.`. `devRequestTime` / `testerRequestTime` check the whole press, then book the auto-matches, then create every
  request together (`createRequests`: one transaction under the test's lock, re-checking the limits for the whole press, so two tabs at once never pass 3 and a
  press is never half made by the limits). `roomOf` / `roomLine` make the refusal; `callRoomLine` / `sentRoomLine` (`src/lib/callClash.ts`) the words.
- **Auto-match per row**: a "once" row exactly at one of the other side's waiting single times (same length) books it, as before; now the press's other rows are
  still sent as requests (before, the auto-match ended the press). A request is matched by one row at most; `sendClash` skips the requests the press books.
- **The developer with several ticked testers**: each row is one batch (its own `batchId`) sent to every ticked tester; the first tester to accept a row's request
  takes it and that row's other copies close as taken ("Another tester took this time at …"), as before; the other rows stay with every tester. A row that
  auto-matches one tester's request books it and is sent to nobody else. A tester the press doesn't fit (in their own count; their auto-match passes to the next
  ticked tester) is named in the existing "Press again to send to the others" box with the lines above (§185's short lines when nothing more can go); all of
  them: refused. Read this way (check): a tester refused there (or blocked by a clash) gets nothing from the press, their auto-match included.
- **Clashes** per time as before (`sendClash`: a row overlapping a call or a waiting request between the two is refused with today's line); rows of one press
  overlapping each other refused (`ownCallClash` / `clashNotes`). The $1,000 check: each request as it would be accepted (the most calls any one row books).
- **Lines**: one "requested" live line per request (the tester's links `req-<id>`), one developer bell per request (`<name> asked for a call: <time>`, linking to
  its own `#req-<id>`, stacked with the day's other request bells as before). The "in another tab" line names every time: `You requested 3 calls with Nora Lane:
  …, … and … in another tab` (`actionText.ts`; one time: unchanged).
- **The boxes** (§185, §187): each request is its own row in "Requests to you" / "Your requests" and counts 1 in "(N)" / "· N requests". Older "one of" requests
  keep one row per time.
- **Wording removed**: the form's "They pick one of these." (and its `picker` / `otherPronoun` props); comments describing new requests as "choose one"
  (`requests.ts`, `callRows.ts`, `CallRequests.tsx`, `RequestRows.tsx`). Kept for the older requests: "Pick one of the times.", "Another time of this request
  was booked", §184's "… no longer offers …". The terms and help pages never described "choose one": no edit.
- **Tests.** New `tests/separate-times-208.test.ts`: 3 rows → 3 requests (one line and one bell each, the developer's box counting 3), each accepted / declined on
  its own, the developer's 3 rows to 2 testers (a batch per row, first to accept takes it), the total and the day refused as a whole press with the room lines
  (nothing made; one row then goes), the several-testers box and its second press, rows overlapping each other (and a weekly row's 2nd call) refused, a row
  auto-matching while the other is sent, an older "choose one" request still booking one time and closing the rest, the form's note and limit line. Updated
  (they made "choose one" requests through the press; they now start from an older one, `oldChooseOne` in `tests/fixtures.ts`): `request-kinds`,
  `call-sets`, `drop-overlapping-requests` (two cases), `layout-fixes-187` (item 10), `call-limit-request-boxes-185` (her "one of" request); `batch16-calls-live`
  ("in this form"), `batch20` (the response names every request). No schema change.
## §209 Calls: Had and Cancelled under each tester; upcoming calls in Live session; no Call history panel (owner, Nov 5)

**Replaces** §186 parts B and C's layout (the "Booked (N)" drop-down that listed the calls ahead together with the ones that took place, on both sides, and the
tester's "Call history" card holding Booked / Cancelled) and the queued §197 ("one Call history box", never built: not built now either). §186 part A (the
20,000 limits), §179's panel height, §187's nesting rule (only the outermost panel scrolls) and §152's panels are unchanged.

| Before (§186) | After (§209) |
| --- | --- |
| Developer, each tester's row: "Booked (N)" (calls ahead with Join / Cancel, `booked-call-<id>`, then the calls that took place) and "Cancelled (N)" | **"Had (N)"** (`calls-had-<contractId>`, `data-calls-had="N"`): the calls that took place, newest first, each its own fold with its badge, length, payment lines (`part-pays-<id>`), Pay more / "paid the most", the waiting bank check; and **"Cancelled (N)"** as before. Both closed at first (a jump into one, or a call's charge waiting for your bank, opens it). The calls ahead are **not** in the row: only in the Live session's Booked (Join call, Add to calendar, Cancel, Report a problem), as before §186. `BookedAhead.tsx` is gone. |
| Tester, session page: a card "Call history" (`id="call-history"`, `data-call-history`) under the Live session with "Booked (N)" (calls ahead with Join / Cancel, then the ones that took place) and "Cancelled (N)"; the Live session only linked down ("Your booked calls (Join call, Cancel): Call history, Booked ↓") | **No Call history card.** The Live session holds, in order: the rate line and warnings; **Booked** (the calls ahead or running: Join call / Add to calendar / Cancel / Report a problem, sets with Show calls / Cancel the remaining calls; the §152 panel `booked-<sessionId>` at `LIST_PANEL.testerBooked`, as before §186; the late-booking note); then **"Had (N)"** (`calls-had-<sessionId>`: each call that took place with its time, "Took place · 30 min", its payment tag, its length line, "If … doesn't pay by …, it's charged automatically.", and its payment box: Paid $… ($…/h): you get …, extras, the Pay more line, **Dispute the pay**) and **"Cancelled (N)"** (`calls-cancelled-<sessionId>`), both closed; then Requests. |

- **What goes where (both sides; batch 15 §42 / §186's classification and badges kept).** Had = every call that's over and not cancelled: it took place in a
  form that can be paid or disputed. That includes a call with a **no-show report** (one side never came): measuring ends it at 0 minutes, still booked, so it
  reads "Took place · 0 min · not paid yet" and can be paid (or $0) and disputed like any call. Cancelled = status cancelled: by either side ("Cancelled by Ana
  Silva · 3:05 PM", the reason quoted), or by the app: **"Nobody joined"**, **"Couldn't connect"** (both in the room, never connected), **"Missed: the site was
  down"**, **"Missed: the test was paused"**, a stop or end's "Cancelled: <why>". Nothing is ever charged for those, so they can't be paid or disputed. A blocked
  pair's calls on the tester's page read "Cancelled: not available", except one that took place (it stays in Had with its payments), as before. Call requests
  (waiting, withdrawn, declined, closed) never show in either.
- **Calls waiting to connect / in progress** stay in the Live session (the developer's "Waiting to connect" / "Call in progress" badge, the tester's measuring
  line). A tester whose work ended during a call keeps the developer's one-line "in progress" row above Had, as before (the Live session lists working testers
  only; their calls ahead were cancelled with the end).
- **Panels (§152, §179, §187).** Past 3 rows each list is the draggable panel; only that outer panel scrolls, the payment lines' panels inside it are flat.
  Developer: Had `had-calls-<contractId>` at `LIST_PANEL.pastDeveloper` (27rem), Cancelled `cancelled-calls-<contractId>` at `pastTester` (16rem). Tester: Had
  `had-calls-<sessionId>` at `LIST_PANEL.liveTester` (§179's 27rem), Cancelled `cancelled-calls-<sessionId>` at 16rem. Empty: "No calls took place yet." /
  "No cancelled calls.". Gone ids: `booked-calls-<id>`, `calls-booked-<id>`, `booked-call-<id>`, `call-history`.
- **Shown even when nothing else works.** The tester's Live session now also shows (with only Had and Cancelled) when their tester side is closed (`limited`:
  suspended after their work ended), since the Call history card that held these calls there is gone.
- **Links.**
  - The tester dashboard's Upcoming calls row opens that call's own row, `/app/sessions/<id>#call-<callId>` (was `#calls-booked-<id>`). A call that belongs to a
    set opens its set's calls first (`TesterCallPanel` reads the hash on load and on `hashchange`), so the jump finds the row.
  - The dashboard's "Waiting for the developer" call, payment bells and emails (paid, Pay more, delayed, a dispute decided, the team's $0 closure) and the
    Nobody joined bells keep `#call-<callId>`: the row in Had / Cancelled; `jumpTo` opens every drop-down around it and marks it.
  - **Fixed on the way (found by the screenshot run):** `HashJump` sits in the app layout, so a Link from another page of the app (the dashboard rows above)
    neither mounted it again nor fired `hashchange`: the session page opened without the jump, the call's drop-down closed. It now also jumps when the page
    (pathname) changes.
  - The Live call part's line reads "Each call and what it was paid: Live session, Had ↓" (`#calls-had-<sessionId>`); the Live session's "Your booked calls …:
    Call history, Booked ↓" line is gone (the calls are right there).
  - An older link to the retired places (`#call-history`, `#calls-booked-<id>`, e.g. a tab kept from before) lands on the Live session (`hashTargets`).
- **Code.** `app/app/tests/[id]/page.tsx` (the row's Had / Cancelled; `BookedAhead.tsx` deleted), `app/app/sessions/[id]/page.tsx` (the Live session holds
  Booked, Had, Cancelled, Requests; no Call history), `TesterCallPanel.tsx` (back in the Live session's Booked section and panel; a hashed call opens its set),
  `app/app/page.tsx` (the upcoming call's link), `components/HashJump.tsx` (jumps on a page change), `lib/markJump.ts` (`hashTargets` for the retired ids);
  comments in `links.ts`, `calls.ts`, `teamClose.ts`, `callMeasure.ts`. DESIGN-DOC.md's call history lines now say Had / Cancelled (edited in place). No schema
  change, no migration.
- **Tests.** New `tests/calls-had-cancelled-209.test.ts`: the developer's row with only cancelled calls (Had (0), Cancelled (3) closed, newest first, who / why,
  the app's Nobody joined, no request, no "Booked (" or Call history anywhere); the row with 2 ahead + 4 that took place (one a 0-minute no-show) + a cancel +
  "Missed: the site was down" (Had (4) newest first with payments, the no-show in Had, the ahead calls absent from the row and once each in the Live session
  with Add to calendar / Cancel, the Had panel at 27rem); the tester's page with only cancelled calls (inside the Live session, no Call history) and with 2
  ahead + 4 that took place + 1 cancel (Booked first with its panel, then Had / Cancelled before Requests, Paid $15.50, Dispute the pay, the automatic charge
  line, every call once, the Live call part's link, the panel); a blocked pair; the links (dashboard, bells, `hashTargets`, HashJump's page change) and `jumpTo`
  opening Had and the tester fold around a call. Updated (§186's structure): `limits-call-history` (its call history tests moved here), `batch20`,
  `batch35-list-panels` (§152 ids, §179 in Had), `batch35-payment-tags` and `batch35-pending-pay-state` (a call's tag is in Had), `call-limit-request-boxes-185`
  (a cancelled call in the Live session's Cancelled).
- **Screenshots.** `playtest-lite-evidence/calls-had-nov5` (captions.json; own server on 3491, a throwaway schema dropped after): the developer's row with Had
  (2) and Cancelled (1) closed and open, the Live session with the upcoming call; the tester's Live session with Booked + Had + Cancelled open; desktop
  1280×900 and phone 375×812; a bell link, the dashboard's upcoming call and its waiting call landing on the call with its drop-down open.
## §210 Your own bank check reads as paid even when something else recorded it first (owner, Nov 5)

- **Before (recording R10c, Nov 4).** The bank approved Pay what you owe's $52.00 just before a chargeback in it was won. The win's handler (§171 B6 b) recorded
  the payment and refunded the won part ($25.00) before the window's own finish reached the app; that finish then got `409 confirmed` and the page read "Your Pay
  what you owe didn't go through: You already confirmed this payment." although THIS press had paid. The same wrong line came whenever something else recorded the
  payment a moment before the window's finish: a chargeback won or a new one opened (§171 B6), a hold starting (B5), the team's pause (§172), a new card (§148),
  the clocks or the heartbeat (§160). (This app has no `payment_intent.succeeded` webhook and the peek is read-only, so those two never record a payment; the rule
  covers whatever records it.)
- **Now.** Every finish of an inline bank check sends the window's own PaymentIntent (`pi`, read from its client secret with `checkPiOf`, as the peek does since
  §171 B4; `finishPayment(paymentId, simulate, pi)`, passed by `useBankCheck`). When the payment is already recorded as paid (`charged`, `not_set_up`, `bundled`)
  and the PaymentIntent that paid it is that `pi`, the finish answers as a success (`{ done, paid, status, amountCents, ownCheck }`), and the page shows its normal
  success line: "Paid $52.00, thank you" (Pay what you owe), "Paid $10.00 to Ana Silva." / "Paid $1.00 more to Ana Silva." (Pay, Pay more), "Your bank confirmed
  it: the payment went through." (Confirm with your bank), Confirm all's confirmed line.
  - When a chargeback the payment repaid was won and refunded straight away, the answer carries one more line, shown under the success line
    (`refundLine`, `[data-own-check-refund]`): "Your bank's chargeback on your $10.00 Pay for Ana Silva's written answers on “Harbor Run” was reversed: $25.00
    refunded." The part is named exactly as What you've paid's refund line names it (§192, `paymentRows.wonRefundSaid`; "$50.00 of your $444.67 Pay for …" for a
    partial reversal). Only refunds that reached the card (`refunded`) are said.
  - A finish landing while the recorder is half way (the check let go of, the payment not recorded yet) waits for it (up to `SETTLE_MS`, as the peek does since
    §207) and answers from it: paid, or cancelled.
- **The refusal stays** (unchanged lines) when:
  - the check was finished in ANOTHER tab: "You already confirmed this payment in another tab at 3:20 PM." (§163). The finish that records a payment keeps which tab
    it came from (AppState `check-finished:<payment id>`, `{ tab, at }`, first one wins: the finish route's own claim, its Cancel finding it had gone through, or
    the first window answered paid by this rule). Any finish from another tab reads that line, with or without the same `pi`;
  - the payment was paid by a DIFFERENT PaymentIntent (e.g. an item's own old window after Confirm all paid it), or the finish sends no `pi` (a leave beacon, an
    old page): "You already confirmed this payment." (§157 item 7);
  - the check was cancelled before it went through: "This payment was cancelled: nothing was charged." (CONFIRM_CANCELLED).
  - A subscription's first payment is left as it was.
- **Nothing twice.** The success answer records and charges nothing (the payment was already recorded once by whatever recorded it) and is marked `repeated`, so
  the finish route writes no other-tab line for it. A second finish from the same window answers the same.
- **Code.** `confirm.ts` (`own`: the window's `pi`, `midEnd` wait, `PAID_STATES`, `finishedBy` / `markFinished`, `otherTabLine`, `wonRefundLines`; `confirmFinish`
  records the finishing tab), `paymentRows.ts` (`wonRefundSaid`), `bankConfirm.ts` (`finishPayment`'s `pi`, `refundLineOf`), `BankCheck.tsx` (sends `pi`),
  `OwedBox.tsx`, `ConfirmAll.tsx`, `BankWaiting.tsx` (the refund line). No migration.
- **Tests.** New `tests/own-check-paid-210.test.ts`: (a) Pay what you owe recorded first (a recorder's claim and finish; a new chargeback; the recorder half way)
  → paid, recorded and charged once, no line written; (b) R10c: won after the bank approved it → paid with the refund line, the part named as the refund line's;
  won before → still cancelled; (c) after the window answered paid, another tab's finish (no `pi`, the same `pi`, another `pi`) → "… in another tab at …"; nobody's
  window finished it → the plain line without this check's `pi`; the normal path then another tab → "… in another tab …"; (d) Pay (a hold starting), Pay more and
  Confirm with your bank (a new card), Confirm all (a new card) → paid; an item's own old window after Confirm all paid it → the plain line; the page sends `pi`.
  Updated `tests/pay-matrix-2.test.ts` §159 R10 (a): the page's own finish with its `pi` reads as paid (without it, the plain line).

## §211 Long names never widen the page (owner, Nov 5)
The long-name sweep (evidence `long-names-nov5`) found names with no spaces widening pages on a phone. Fixed: Report / Block / Unblock and the Block dialog's
confirm button break the name anywhere (buttons keep `break-word`, which can't break one word); Find's test header wraps (the price box drops below, the title keeps
12rem) and its "<developer> approves each tester" badge breaks; the profile headings keep 12rem beside the avatar; email lines break long words (the summary email
was 717px wide on a 375px phone); the Blocked people list uses Cut (full name on press); the session page's "Chat with <developer>" wraps; the tester's To-do row
wraps instead of hiding the part name; the header's hover reads "<name> · <email>"; the admin header's name is cut at 12rem with its title; the call room's name pill
is capped and cut. Test: `tests/upload-alive-nov5.test.ts`.

## §212 A cut-off upload no longer holds Send (owner, Nov 5)
An upload cut off by a reload or a closed tab left its row unfinished, and Send read "A recording is still uploading" for up to 3 hours. Now the uploading page
says it's still going every 20 s (`recording-alive`, `Recording.aliveAt`) and an unfinished upload holds Send (recording and written parts) only while it was heard
from in the last 2 minutes; leaving the page mid-upload drops it at once (`pagehide`, a keepalive `recording-abandon`). The daily clean-up still removes leftovers
after 3 hours. Migration `20261118090000_recording_alive`. Test: `tests/upload-alive-nov5.test.ts`.

## §213 A Send refused during a pause says so (owner, Nov 5)
From recording R4b: Hal's Send during the team's pause was refused (409) but the page only redrew to "Your answers are kept as a draft". Now a refused Send (written
answers) or Add (an addition) shows a blue notice above the draft line: "Your Send didn't go through: This test is paused right now. You can send this once it
resumes." It is kept for the tab (sessionStorage) through the page's redraw for the pause and goes once Send is back.

## §214 A decided dispute names whose pay it was (owner, Nov 5)
The tester's live line reads "The team decided your dispute with Omar Reyes about your written answers: the pay stays at $4.00" (and "… was raised to …").

## §215 Direct messages ring only within a shared test, stacked a day (owner, Nov 5)
Replaces §105's "no shared-test reach filter": a direct message makes a bell (and its summary-email line) only when the two share a test: one is or was in the
other's open test (`inReach`, as test chat). The message itself always arrives (Messages, unread). Its bell lines stack across tests, one entry a day: "Direct
messages · 3 today" (group "dms"), in the email too. Test chat messages are unchanged (a line in that test's day stack).

## §216 Payment rows open their whole text with an arrow (owner, Nov 5)
A payment row whose tester or test name is cut (NAME_CUT, 20) gets the bell's arrow (§202); it opens the whole row, names uncut, in a small scroll box under it.
No hover (phones couldn't reach it). A row with nothing cut has no arrow. On the Payments page (What you've paid, refunds, what you owe and what each payment
covered, charges waiting), a part's payments, and Pay what you owe's box (`components/WholeLine.tsx`).

## Join popup scroll (owner, Nov 5)
The join page's "Check what this test needs now" popup is at most a screen tall (it scrolls), and its list of changes shows 3, then "Show N more" in a scroll box,
like every other notice. Test: `tests/nov5-batch2.test.ts`.

## §217 A check cancelled underneath reads as a cancel (owner, Nov 5; recording R4a re-take)
A bank check already cancelled underneath it (the team's pause, a new card, a chargeback won) read "Your Confirm with your bank didn't go through: This payment was
cancelled: nothing was charged." from Cancel this check (the wrong press, and as a failure), and the same from Complete in its window. Now whichever press reaches it
reads "Cancelled: nothing was charged." (`refusalLine` and the kept line `keptRefusalLine`, `CHECK_CANCELLED_UNDERNEATH`), and Cancel this check on it is a cancel that worked.

## §218 A won chargeback's payment says how it ended (owner, Nov 5; recording R10b re-take)
What you've paid marked a payment whose chargeback the bank then decided in the developer's favour "· your bank reversed this (chargeback)". It now reads "· your bank
reversed this, then decided in your favour (chargeback won)"; a one payment's group line drops its "reversed" mark once won. The total was already right.

## §219 Confirm all's window names a new charge once (owner, Nov 5; recording F)
The window's notice listed a charge made meanwhile twice: as "Dee Park charged $9.00 … meanwhile: it isn't in this payment …" and again from its test's updates ("On
“Harbor Run”: Dee Park charged $9.00 for their written answers."). The test's line is skipped when the charge is already named. Test: `tests/nov5-batch2.test.ts`.

## §220 Cut rows open in place, and each name on its own (owner, Nov 5; replaces §216's copy under the row)
A payment row (Payments, Pay what you owe's box, a part's payments, the charges waiting) or a bell line whose names are cut now opens IN PLACE: the arrow turns the
row itself into the whole line, every name whole, in the draggable panel (ResizeBox: it starts small and the grip drags it taller, to half the screen; inside another
panel it keeps its own scroll, OwnPanel); the arrow again closes it. No copy under the row. Closed, each "…" in the row is a button that opens just that name in
place (`cutPieces` lines the cut text up with the whole line). A row with nothing cut is plain, with no arrow. Test: `tests/nov5-batch2.test.ts`.

## §221 The questions changed: one block per question (owner, Nov 5)
The new-terms box's "The questions changed: before and after" listed all the Before questions, then all the After ones, then "Your answers so far: a / b / c" run
together. Now one block per question number: "Question 1", its Before, its After and your answer so far, each in its own box that scrolls and drags taller
(ResizeBox); a question only one side has reads "(new)" or "(removed)", and an unanswered one "(no answer yet)". Test: `tests/nov5-batch2.test.ts`.

## §224 No "added to this after you paid" line on the part (owner, Nov 5)
The developer's update row (a part a tester added to after it was paid) no longer shows "bb added to this after you paid ($19.00 paid · up to $981.00 more)" under
"Updated …": the part's payments and its Pay more say it. The bell and the email that tell the developer of the addition keep the line.

## §225 A part's individual payments only in the Testers list (owner, Nov 5)
Replaces §152's payments list under a part in Needs you: a part's (or a call's) individual payments ("Payments for this part": each Pay, Pay more, charge and
decision, with its date, amount and marks) are listed only in the Testers list's drop-downs, never in Needs you's part rows or its "added after you paid" rows. Each
line keeps §220's pattern (names cut at 20, "…" opens one name, the arrow opens the whole line in place).

## §228 A request that's no longer waiting leaves the list (owner, Nov 5)
Building on batch 26 §10 (a closed request says so in its row at once, its buttons gone): the row says what happened ("Booked", "Another tester took this time at
12:47 PM", "… withdrew this request") for 6 seconds (GONE_SHOWN_MS), then leaves the list on its own, without waiting for a reload. A press refused on it keeps its
named refusal at the top of the box (lostRefusal, §207).

## §229 Call requests under the Live session panel (owner, Nov 5)
Replaces §181's place ("right under Needs you"): the Call requests box ("Requests to you" and "Your requests") sits right under the Live session panel on the
developer's test page. Needs you's "2 call requests ↓" lines still jump to it.

## §230 The confirm lists open like payment rows (owner, Nov 5)
"Your bank wants you to confirm" (Payments' list, the dashboard's box, a charge's Confirm with your bank on the test page) named its payment with the names cut and the
whole line only as a mouse hover. Now each line opens like a payment row (§220): each "…" opens its name, the arrow opens the whole line in place in the draggable
box; quoted test names still link to their tests. No hover.
## §222 Additions: 5 per question, replacing the part's 10 (owner, Nov 5)
Replaces §167's "at most 10 additions per written part" and §186's one grey note under the answers panel.
- **The cap:** each current question takes at most **5 additions**, and "Anything else" its own 5 (`ADDITIONS_MAX = 5`, `addsCounted` in `src/lib/additions.ts`).
  Only what Add to this answer made counts (`addsTo`): the answers to changed questions and their send's notes never count (that Send is never refused for
  it). Additions made before §167 (no question) are Anything else's, so they count toward its 5.
- **The rows** (below "Your written answers", `WrittenAddForm`): each row counts its own question: "3 of 5 additions left" once it has one (the part-wide line
  is gone). At 5 only that row closes: no button, the question's name and under it the grey note "You've added to this answer 5 times, the most it takes."
  (Anything else: "You've added to Anything else 5 times, the most it takes."). The other rows stay open. A kept draft still shows read-only.
- **A question with no answer yet** (`noAnswerYet`: its latest answer is blank and nothing was added to it; typically a "new question" the tester left empty)
  gets an **"Answer this question"** row in place of Add to this answer (the box's note: "This is your answer to this question."; done: "Your answer was sent.").
  That first answer is stored with `first: true` and is not one of its 5; it is offered after any cap. Once answered, the question follows the normal 5.
  Anything else is never "unanswered". The developer reads it like any addition (its "(no answer)" line goes once something was added).
- **The press** is named "Answer this question" in its refusals (`FormMistakes named`, the paused line) and in the failed-press lines (`pressLabelOf`: the form
  sends `first: true`). The server decides what is free from the stored part, never from that flag.
- **Server** (`addRefusal` / `addWritten` in `src/lib/server/tests.ts`): the same per-question count, before the stop-once and again under the test's lock (two
  adds at a question's 4 give exactly one 5th), 409 `add_full` with the lines above; the free first answer is never refused for the cap.
- No migration: `first` is a field of the JSON additions.
- **Tests:** new `tests/batch35-added-per-question-222.test.ts` (the counts and lines; old untied ones on Anything else; the 6th refused per question and on
  Anything else while other rows stay open; the race at the 4th; the free first answer after every other cap, then its 5; `first` from a page never makes an
  answered question free; the press name; the rows; the session page). Updated: `batch35-added-per-question` (its 10-cap block moved here),
  `anything-else-cancel-188` (its own 5), `limits-call-history` (one row closed), `batch35-parts-fold`, `press-names`.

## §223 Questions and answers in draggable scroll boxes, in one look everywhere (owner, Nov 5)
Replaces §182 / §187's long-text fold (3 lines, Show more) and the question title's own Show more wherever a question is shown with its answer.
- **One shared component** (`src/components/QA.tsx`): `QuestionText`: a small label "Question N" (a "Required" tag beside it), the question's whole text in a
  quieter tone (italic, medium, slate) on a faint background; `AnswerText`: a label "Answer" (or "Added · <date>" for an addition), the text in the normal bright
  tone with a volt left accent border; "(no answer)" in grey for an empty one. Each text is its own box that scrolls and drags taller (ResizeBox, 6rem at first,
  the grip to 60% of the screen) inside `OwnPanel` (they always sit inside another panel, where a nested ResizeBox is flat otherwise, §187). One scroll per text:
  no Show more inside a box. Long words wrap anywhere, so a 375 px phone never scrolls sideways.
- **Where:** the tester's "Your written answers" and the developer's Needs you, update rows and Testers list drop-downs and the team's "See the work" (all
  `SentWork`: inside each question's fold, the question box, the answer box, then each addition's box; Anything else's notes and additions too); the previous
  sets on both sides (`SetView` / `PrevSetFolds`, with their own ids; the 24rem scroll around a set is gone, so no two scrolls are stacked); "By question"
  (the question box above its answers panel, each answer in its own box; the tester's name above the answer on a phone, beside it from `sm`); the new terms'
  "The questions changed" blocks (§221: Before and After as questions, "Your answer so far" as an answer).
- A question fold's title is the question cut at 2 lines by CSS (no Show more: its box inside holds it whole). The answer form's question labels keep their
  inline Show more (they are not shown answers). A recording's notes keep the long-text fold.
- **Tests:** `tests/batch35-added-per-question-222.test.ts` (each text its own box, not flat, 6rem, the grips; no Show more inside; the look's classes; the
  previous sets, By question, the new terms and every SentWork view use it; the phone layout of By question). Updated: `batch35-parts-fold`,
  `layout-fixes-187`, `batch26`, `anything-else-cancel-188`, `nov5-batch2`, `batch35-added-per-question`.

## §226 The Testers list shows what was paid for; Needs you only what's new, with "Pay" (owner, Nov 5)
The developer's test page (`src/app/app/tests/[id]/page.tsx`).
- **The cut-off** (`lastPaidAt`, `src/lib/paidCut.ts`): the review's last payment time, the latest of: each Pay or Pay more on the part that went through (a
  Payment of kind "review" or "extra" with status charged, not_set_up or bundled), at its `createdAt` (the press, the same moment that decides whether an
  addition came "after you paid": reviewDraft's addedWhilePaying and a Pay more's answerUpdate); the review itself when it charged nothing (a $0 Pay, an old
  rejection, the team's $0 closure, or a Pay whose payment hasn't gone through); a $0 Pay more closing an update (`paidUpdateZeroAt`). Null before the first
  payment. A dispute decided by the team doesn't move it. An addition (or a changed-questions send) at or before the cut-off is paid for; after it, it is new.
- **Testers list** (each part's drop-down): the part as it was when last paid: `SentWork until={cut}` leaves out the additions after it, their files and the
  questions first answered after it (they read "(no answer)" there). Before the first payment it shows what was sent (the drop-down now shows the answers before
  any payment too). It keeps **Pay more**.
- **Needs you** (a part's row and an "added after you paid" update row): only what's new since the cut-off (`SentWork newOnly={{ since: cut }}`): the questions
  answered or added to since then, each with only its new answer (a question that came with changed questions since) or its new additions; unchanged answers,
  still-unanswered questions, the notes and the files sent first are left out; Anything else only when something new is in it; "Nothing new since you paid."
  if nothing is. Never paid: every answered question (not the unanswered ones). So an addition the developer pays for moves into the Testers list, and the next
  one shows only in Needs you until it is paid.
- **"Pay" in Needs you:** the update row's drop-down and button read **Pay** (`PayBox moreLabel="Pay"`): Pay more's route (`pay-extra`) and every check it has
  (the cap and its tick, paid in another tab, the stop-once and §183's stops, the bank's check, $0 closing an update); the request says `press: "Pay"`, so its
  refusals, stops and failed-press line name Pay (`pressLabelOf`); done: "Paid $2.00 to Ana Silva.". The Testers list keeps "Pay more".
- Each question and answer in Needs you is in the §223 boxes (SentWork).
- **Tests:** new `tests/paid-cut-226-227.test.ts` (the cut-off rule; until and newOnly; the page: an addition after a Pay only in Needs you with Pay, the
  Testers list as paid with Pay more; paid with Pay, it moves there and the next one waits in Needs you; the press names). Updated: `press-names`,
  `batch35-after-press` (the done line), `needs-kind-folds-199` (`moreLabel`), `batch35-attachment-once` (the unpaid part now shows in the Testers list too).

## §227 Pay what you owe never on the developer's test page (owner, Nov 5)
- The test page no longer draws **OwedBox** (Pay what you owe). Payments, the dashboard and the bell keep it as they are. The chargeback steps
  (ChargebackSteps) stay: they have no Pay what you owe button of their own.
- Wherever the test page says something is owed it links to Payments: **"Pay what you owe on Payments"** → `/app/payments#owed` (OwedBox's own anchor there;
  `PAY_OWED_HREF`, `PAY_OWED_LINK` in `src/lib/rules.ts`, `components/PayOwedLink.tsx`): the paused banner for a payment hold ("Your tests are paused until you
  pay what you owe."), the Pay and Pay more boxes' "Pay what you owe first." (was "Pay what you owe ↑" to the box on the page), and any refusal about what's
  owed ("Pay what you owe first." from Request a time, and the like: `Err` adds the link). Owing a failed payment before any pause, the page shows one line in
  place of the box: "A payment didn't go through, so you owe it. Pay what you owe on Payments".
- **Tests:** `tests/paid-cut-226-227.test.ts` (no OwedBox on the page; the banner, the boxes' line and the refusals link to Payments; the anchor exists there;
  the one line when owing before a pause). The tests that read OwedBox itself are unchanged.

## §231 Contract and listing texts in the same draggable scroll boxes (owner, Nov 5)
Every text from the contract or the listing that can be long now sits in the same box as §223's questions and answers: ResizeBox inside OwnPanel (6rem at first,
the grip drags it to 60% of the screen, its own scroll inside any outer scroll), one look (`src/components/QA.tsx`).
- **New in QA.tsx:** `ValueText` (a listing or contract value: bright text on a faint background, wraps anywhere; a link inside stays a clickable link),
  `QuestionTexts` (a contract's or listing's questions, each its own question box: "Question N", "Required" a small tag) and `NDA_BOX_MAX` (12rem: the NDA starts
  taller). `NdaBox` is now that box (it takes an `id`), wherever an NDA shows (the agreed scope, the terms history, the new-terms box, the join page, the Listing panel).
- **The tester's "Your agreed scope"** (session page): the contract's questions (QuestionTexts) and its NDA; the listing information's title, product, what to do,
  build link (a link in its box) and Mature reason in ValueText; devices and languages (short) stay plain lines. Each "Updated" tag's Before and Now (`UpdatedTag`,
  which takes an `id`) are two ValueText boxes. The terms history's questions then and now, NDA then and now, and listing before / after use the same boxes. The
  fold's 32rem scroll stays the one outer scroll; the boxes inside keep their own (OwnPanel), each short at first. The header's "What to do" too.
- **The new-terms box** (TesterTop): the NDA's Before and Offered in the same box; the question blocks were §223's. The changes line ("written $10 → $12, questions
  changed, NDA changed") holds only short values (prices, days, Required, a word for the questions or the NDA), so it stays a line.
- **The developer's Listing panel** (`ListingPanel`, also drawn on the tester's join page): Name, Product, What to do, the build link, the Mature reason and the NDA in
  ValueText / NdaBox, the questions in QuestionTexts; prices, the call rate, days, dates, who can join, spots, devices, languages and categories stay plain lines.
  The developer has no separate terms history; the panel's Updated Before / Now is it, in the same boxes.
- Phones at 375 px: every box wraps anywhere and a link breaks anywhere, so nothing scrolls sideways.
- **Which questions the tester reads where (checked in the code):** the contract part of "Your agreed scope" shows the CONTRACT's questions (`writtenQuestions(c)`,
  `Contract.questions`: the ones they joined with, or switched to). "The listing information" has no questions line at all (`INFO_LINES`: title, product, what to
  do, build link, devices, languages, Mature). A newer question set on the listing reaches the tester only as a new-terms offer: the open offer's "The questions
  changed" blocks (TesterTop) and, once offered, the terms history's "Questions then and now"; switching makes it the contract's. (Before joining, the join page's
  Listing panel shows the listing's current questions.)
- **Tests:** new `tests/contract-listing-boxes-231.test.ts`. Updated: `batch13`, `batch15-stops` (§223's PrevSetFolds id), `batch20`, `batch30-session-info`,
  `batch34-listing-panel`, `batch35-numbers-notes`, `batch35-panel-labels`.

## §233 The questions changed: the whole list in a scroll panel (owner, Nov 5)
In the new-terms box, "The questions changed" puts all its question blocks (Question N: Before, After, your answer so far) in one draggable scroll panel (about
26rem, or 55% of the screen; the grip drags it taller), so many questions never stretch the box. Each Before / After / answer keeps its own box inside.
## §232 Rate and Leave stop once for open new terms, even when shown (owner, Nov 5)
Narrows §90 for these two presses: rating and leaving end the tester's part, which closes an open new-terms offer unanswered. So while an offer is open, the first
Rate or Leave press always stops once (a forced line, whatever the Alerts): "Nora Lane offered you new terms: Switch or Keep in the box above, or rating (leaving)
closes them unanswered", even when the page already shows the offer's box. The second press goes ahead. An unseen offer keeps its usual line instead (never both).
Test: `tests/rate-leave-open-terms-232.test.ts`; `tests/batch35-rate-all-stops.test.ts` (§90's shown-terms case now stops once).

## §234 "Past questions": everything past of a written part in one box (owner, Nov 5)
- **What it holds:** every question no longer in the tester's contract (`isPastQuestion`: matched by its words against the contract's questions now), read-only,
  each with what was sent to it and its additions, in the QA look (each in its box): `SentWork part="past"`. Then the earlier "Previous questions and answers
  (until <date>)" folds (PrevSetFolds), moved inside, as they were. No Add / Answer row there. `components/PastQuestions.tsx`: a draggable panel (ResizeBox; the
  boxes inside keep their own scroll) headed **"Past questions (N)"**, drawn only when N > 0; N counts each past question once (its threads, and the earlier sets'
  questions no longer asked).
- **Where:** the tester's session page, directly under the "Your written answers" panel (before anything was sent, where the earlier sets' folds were); the
  developer's Testers list, at the bottom of each written part's drop-down, under its answers panel (as paid for, §226: `until` applies, and the earlier sets'
  folds moved here from under the tester's parts).
- **The answers panel** (`SentWork part="current"`) now shows only the contract's current questions and Anything else, on both sides.
- **Needs you** never shows a past question (`part="current"` there too, with §226's only-new): if something sent to one would have shown, one line says
  "Answers to past questions are in the Testers list, under Past questions."
- **Server (checked):** an addition to a past question is refused on the server, not only hidden: `addRefusal` takes only a key of the latest set, which must
  be the contract's current questions (else "Your questions changed: …"), so a removed question's key gets "That question isn't one of your current questions…".
- **Tests:** new `tests/written-form-234-235.test.ts` (the split in SentWork; both pages: the panel without the past question, the box with it and its addition,
  read-only; Needs you without it; the server's refusal). Updated: `batch10`, `batch13`, `batch35-added-per-question(-222)`, `batch35-sent-locked`,
  `batch35-attachment-once` (a question not in the contract is past: shown once, in the box).

## §235 The tester's written part: Add under each answer; one form for the unanswered; "Send Answers" (owner, Nov 5)
Replaces §182's "Add to this answer" rows under the panel (and their portal into the panel), §222's "Answer this question" rows, and the form's "update" mode
that refilled every question after a switch.
- **Add to this answer sits under each answer**, in that question's fold, right below its answer and additions (and in Anything else's fold), drawn in place
  (`addUnder` on the session page, `WrittenAddForm` with no slot). Each question keeps its 5, "N of 5 additions left" and its full note (§222).
- **Questions in the boxes:** every question in the panel is in its QA question box (§223); the fold's title is the question cut at 2 lines (no Show more), so
  the two never fight.
- **One form below the answers** for the current questions with no answer yet, and only those (`carriedAnswers`: a question answered by its words in the latest
  set, or added to, is answered; a past question is never in it). Its heading: "Questions you haven't answered yet"; no notes box (Anything else has its Add). An
  unanswered question's fold says "Answer it in the form below." The Send carries `for` (the form's questions); the server fills every answered question with
  exactly what it has (whatever the page sent), checks only the form's answers (Required, the 50 characters, at least one; not "at least one" after a switch to
  changed questions, whose Send moves the part onto them), and adds the set under what was sent. The first answers are free (a set is never one of the 5). After a
  switch where every question already has its answer, the form is just "Your answers carry over to the changed questions. Send Answers moves them onto these
  questions." and the button. Before the first send, the form is as before (every question and the notes).
- **The button always reads "Send Answers"** (`SEND_ANSWERS`), the first Send and every later one, and so does the press its refusals name (`PRESS_VERBS.written`,
  `failedLine`). Every gate and stop is unchanged. An older page's Send (no `for`) works as before.
- The developer's side is unchanged (§226 and §234 apply).
- **Tests:** `tests/written-form-234-235.test.ts` (the label and press; the page: Add in the answered fold, the unanswered one only in the form, no rows; the
  server: only the open questions, the answered ones kept, the first answer free, a Send with nothing open refused; after a switch, the carry-over Send). Updated:
  `anything-else-cancel-188`, `batch10`, `batch27`, `batch35-added-per-question` (the rows), `batch35-parts-fold`, `batch35-small-ui`, `limits-call-history` (one
  question's 5 in its fold), `batch35-added-per-question-222` (its page test moved).

## §236 The tester's Terms history: one draggable panel, names cut with their expansions (owner, Nov 5)
- **The whole history list** (session page, "Your agreed scope" → Terms history, `data-terms-history`) sits in its own draggable scroll panel (ResizeBox
  `terms-history-<contract>`); the boxes inside (the questions then and now, the NDA then and now, the listing's before / after, an opened line) keep their own
  scroll (QA / OwnPanel).
- **Names cut at 20, everywhere in it** (§220's pattern): each line with a name is a `NameLine` (WholeLine): names cut at NAME_CUT (20) with "…", each "…" opens
  that name in place, and the arrow opens the whole line in place (its own small box). `cutNamesIn` (`src/lib/cutNames.ts`) builds the cut and the whole version
  of a line whose names are baked into its text: the developer's name, the tester's own, the test's titles (as joined and now) wherever they appear, and any
  quoted “…” longer than 20 (a test or product name, a renamed test's old and new names). It covers the offer lines ("<developer> offered new terms (…) · …"),
  the contract notes (server text, after `renderTimes`), and "<developer> updated the listing information (…)". The developer's whole name still links to their
  profile (where it shows whole). Long before → after values stay in their §231 boxes. A line with nothing long is plain, with no arrow.
- The earlier-sets line now points to “Past questions” (§234).
- **Tests:** new `tests/terms-history-236.test.ts` (the cut and whole versions line up; NameLine's … and arrow, the link when nothing is cut; the page: the panel,
  a contract note with a long developer name and a long quoted test name cut with two … and the arrow). Also fixed here: `batch15-stops` and `restrictions` (the
  press "Send Answers", §235) and `batch32-fixes` (§231's boxes).

## §238 Names cut at 20 on the remaining rows, with "…" and the arrow (owner, Nov 5)
§220's pattern (names cut at NAME_CUT, 20, with "…"; each "…" opens its name in place, the arrow opens the whole line in place in the draggable box) on the rows
that still drew a long name whole or only as a `truncate` + `title` hover:
- **Tester dashboard, To do:** "<developer> offered new terms: <diff>" is a WholeLine: the developer's name cut at 20 and a long diff at DIFF_CUT (40), each with
  its "…" (`offerLine`, `src/lib/cutNames.ts`); "<developer> asked for a live call" cuts the name the same way (`cutNamesIn`). The row now opens through a link
  laid over the card (as Messages' rows, §124), so the line's "…" and arrow and the test's name (its own link) sit above it; the rest of the card opens the row as
  before. The test's name lost its `truncate` + `title`.
- **Waiting for the developer:** the "Application waiting" / "Ask to rejoin waiting" card and the invite-only card cut the test's name with `Cut` (kind "test"),
  in place of `truncate` (+ `title` on the first; the invite-only card had none).
- **Ratings to give:** each "Rate <name> on “<test>”" row is a WholeLine of its names (the row carries `names`), no hover; the row's link lies over it.
- **Join page:** "<developer> approves each tester" (the badge, no link inside it) and "<developer> invited you" (the name linked to the profile when whole) cut the
  developer's name with "…" opening it in place and the arrow (NameLine).
- **Admin console:** the Reports rows cut the reporter's and the reported person's names (still links to their profiles) and their emails in the middle (Cut,
  kind "email"); the "Reported more than 3 times" label follows the email. Checked the other lists (developers, testers, the account's admin box, disputes,
  payments, holds, lifts, no-shows, contact): their names and emails were already cut (AdminRich). Also cut here: the failed emails' "To <email>" (Settings), the
  admin box's "Payments as <name> sees them" heading and the dispute decision's tick "Charge <developer> $… more".
- Phones (375px): the rows wrap (`overflow-wrap:anywhere`), never scroll sideways.
- **Tests:** new `tests/names-sweep-238.test.ts` (offerLine; the dashboard's offer row rendered with a long developer name and diff: two "…", the arrow, the
  overlay link; the waiting cards; Ratings to give; the join page; the Reports row rendered: names and emails cut, links and label kept). Fixed: the stale
  NameLink count in `batch35-name-links` (§236 moved the Terms history lines to NameLine).

## §239 No notes on recordings (owner, Nov 5)
Replaces §182's notes block on a recording. Testers no longer add a note when sending recordings: the recording's Send has no notes box and sends none, and the
server ignores a `notes` field on `recording-send` and stores nothing (`sendRecording`). Stored notes on old recordings are never shown (no migration): SentWork's
recording view drops its "Notes" block, which covers the tester's and the developer's views (Needs you, the updates, the Testers list) and the admin's See the
work in a dispute. No email or bell named them. The written part's notes and "Anything else" are not affected. **Tests:** new
`tests/recording-notes-239.test.ts` (an old note not shown, the written part's still shown; a Send with notes stores none; no notes in RecordingUpload); updated
`batch35-listing-paid-parts` (the paid recording's row shows its file above Pay more, not its old note).

## §240 Pay what you owe: a charge from before the hold waiting for the bank says so (owner, Nov 5; from the recordings)
A charge made before the hold (status "deferred", made before `holdStartedAt`) read "… · waiting until your tests resume" in Pay what you owe's box even while its
bank check was open (Pay what you owe's one payment covering it waiting for the bank). When its check is really open (its own `actionPi`, the one payment covering
it in needs_action / needs_confirmation with a check, or the chargeback hold's reservation's check) it now reads "… · waiting for your bank (Confirm with your
bank)" (`OWED_BANK_WAIT_TAIL`, `owedLines` in `src/lib/server/holds.ts`). A charge truly waiting for the lift keeps "waiting until your tests resume" (and goes
back to it when the check ends with nothing charged). The rule is one helper, `bankCheckOpen` (holds.ts), and a part's payments on the developer's test page
(`partPayStatus` / `partPaymentLines`, `src/lib/server/partPayments.ts`) use it too: a waiting charge reads "waiting for your bank (Confirm with your bank)" only
while its check is open, else "waiting until your tests resume". **Tests:** `tests/payment-piece-names.test.ts` (§240: the lift line, the one payment's open
check, the check cancelled, its own check; a part's payments, the same three cases).
## §237 Long text in draggable boxes (owner, Nov 5)
Every long free text sits in the shared draggable box: `ResizeBox` (components/Panel.tsx), in `OwnPanel` when it sits inside another panel, as QA.tsx's boxes.
No Show more inside a box; long words wrap anywhere, so a 375px phone never scrolls sideways.
- **Reasons and notes (`ReasonQuote`, components/ScrollText.tsx):** the box itself (6rem at first, the grip drags it to 60% of the screen), keeping the quote
  look (italic, “…”, a left rule). Every caller follows: dispute reasons, the developer's side, the team's decision and pause notes, stop and end-early reasons,
  call cancel / no-show / length notes, the admin's suspend, delete, report and q-reason notes. Its id is the caller's, or one made from the text (`textId`,
  QA.tsx). An admin line that jumps on click (MineLine) ignores a click on the box's grip. The old fixed `ScrollText` box is gone (its last uses are boxes now).
- **List panels (`ScrollList`):** the draggable panel, at its old height until dragged (per screen width, through `--list-max`); kept by `id`, by default
  `list-<label>` (the dashboards' lists now pass their labels). The cards drag up to 1.2 screens. Its panels inside are plain (§187), its boxes keep theirs.
- **"See the work" (`AnswersBox`):** the draggable panel, 20rem at first, kept by the piece (`answers-<piece>`).
- **Excerpts:** the question in its question box (QA's `QuestionText`, "Question"), the quote in the value box (`ExcerptQuote`: ValueText in “…”), and "Replaces
  the excerpt shown now" each in a box: the dashboard's and the test page's requests, the restricted view's shown excerpts, Your excerpts, Excerpts of her work.
  The excerpt picker's answer (with what's struck through) and "Shown as" are boxes (9rem and 6rem at first; Shown as was fixed at 4 lines).
- **Application notes:** a reason box ("Their note"). **Bios** (both profiles): the value box, 9rem at first (`BIO_BOX_MAX`); "No bio yet." stays a line.
- **Rating comments:** the session page's "You rated …: 4 ★" and "… rated you: 4 ★" and the test page's "… rated you" keep their line; the comment is in a reason
  box under it. The profile's "Your ratings": each comment in a reason box, all of them in a list panel (`rating-comments`, no "Show N more").
- **The join page's questions:** QA's `QuestionTexts` ("Question N", "Required" a tag); more than 3 sit in the draggable panel (PanelWhen).
- **Edit's notes (FieldNote):** what it replaced, "What you typed (not saved)" (its Copy stays) and the old NDA in value boxes (`FoldText` is now ValueText);
  the questions list is `QuestionTexts`, every question (no "+N more").
- **The answer preview before Send:** a box (18rem at first, its own even inside the questions' box). **Contact us messages** (admin): a value box, 12rem.
- **No double scrolls:** the test page's dispute reason in Needs you is the reason box itself (no panel around it); the tester rows (`RowsBox`, 36rem), the
  Listing panel (32rem) and "Your agreed scope" (32rem) are draggable panels (up to 80% of the screen, `BIG_PANEL_TALLEST`) keeping the boxes inside; past calls
  in their panel have no inner max-h-72 box.
- **Calls made:** the tester rows' panel keeps the panels inside it as they were (`OwnPanel`: a part's sent work with its Pay box §139, the Had calls §209), and
  the scope panel keeps §236's Terms history its own panel, so only the outer fixed box changed. An open bank check still lifts the height of the panel holding it
  (globals.css), now the whole tester rows panel.
- Not changed: the chat thread, the add-to-answer box, recording notes.
- **Tests:** new `tests/boxes-237.test.ts`. Updated: `batch16-dashboard-search`, `batch16-edit-tabs`, `batch16-excerpt-question`, `batch16-lists`,
  `batch17-stop-reason`, `batch20`, `batch23`, `batch35-admin-tabs`, `batch35-excerpt-live`, `batch35-numbers-notes`, `batch35-parts-fold`,
  `excerpt-delete-only-196`, `layout-fixes-187`.

## §241 Every other-tab change note in its box (owner, Nov 5)
Edit's "Changed in another tab or device at …" notes (FieldNote) put every change in the shared draggable box, not only long text: the access keys' lines ("Added:
…", "Removed: …"), short changes ("Categories: a → b", devices, languages, spots and the other selections), the replaced long text and "What you typed (not saved)".

## §242 The questions changed: only the changed ones, each a drop-down (owner, Nov 5)
The new-terms box's "The questions changed" lists only questions that actually changed, matched by their words (and Required), so removing one never makes the ones
after it look changed: an edited question (Before and After), a new one ("Before: (new)") and a removed one ("After: (removed: after Switch it moves to Past
questions)"). Unchanged questions aren't listed. Each is its own drop-down, closed: "Question N · Changed / New / Removed" and the start of its words; inside, Before,
After and your answer so far in their boxes (the list keeps §233's panel). `questionChanges` in TesterTop.tsx. Test: `tests/question-changes-242.test.ts`.

## §243 Other-tab notes: only Open until, categories, languages and devices stay plain (owner, Nov 5)
Refines §241: in Edit's notes ("Changed in another tab or device at …", "Saved in another tab or device at … · Use theirs", "Changed in another tab at …: was …"
and the keys' "Updated at …" lines), Open until, categories, languages and the tech requirements (devices) stay plain lines; every other field's value, and the
keys' lines, is in the draggable box however short (`plainField` in FieldNote.tsx).

## §244 Every cut name or email opens on a click, in its box; hovers kept (owner, Nov 5)
A name or email cut at 20 (Cut / NameLink, admin side included) now opens on a click on every device (was a touch screen only): the pop-up holds the whole name or
email in the draggable box (it scrolls, the grip drags it taller), with its link and Copy. A name of 20 characters or fewer never opens it, even when a tight row
cuts it by width. A mouse hover still shows the whole name or email everywhere (Cut's title, the cut payment rows' and confirm rows' title, a cut bell line's title).

## §245 Names, test titles and product names at most 20 characters; nothing cut; test names green (owner, Nov 5)
The owner: person names and test titles are limited to 20 characters, so nothing is ever cut ("…") or needs expanding; test names show green. Then: product names
20 too (were 60), treated like test titles (no green link: a product isn't a page).
- **Limits** (`src/lib/limits.ts`): `personName: 20` (new), `testName: 20` (was 60), `productName: 20` (was 60). `NAME_TOO_LONG` = "Keep your name to 20
  characters."; `fitName` cuts a name to its first 20 characters (never splitting an emoji), right-trimmed.
- **Person names:** sign-up (email form and Google's step, `readNewAccount`, which cut at 80 before) and the profile's Save (`saveProfile`, cut at 80 before) refuse
  over 20 with that line, red at Name (its data-match "your name"); never cut silently. The Name boxes (sign-up, Google's step, the profile) count to 20 (their
  counters were there; maxLength 20). **Google:** when Google sends a name (the sign-in asks "openid email", so today it doesn't), it is cut with `fitName` and
  fills the step's Name box, editable there and on the profile later. Admin-made and test-fixture accounts are written straight to the database (no limit there),
  so they stay valid.
- **Test titles and product names:** Post, Edit and Next round (all through `checkListing`) refuse over 20 with the existing "Keep the title to 20 characters." /
  "Keep the product name to 20 characters." and the existing counters. Edit checks a field only when it changes, as before.
- **Existing data:** migration `20261119090000_names_twenty` shortens `User.name`, `Test.title` and `Test.productName` longer than 20 to their first 20
  characters, right-trimmed, and the copies shown as names: `Contract.title`, the `title` / `productName` in `Application.listing` (so a pending application doesn't
  read as "changed since you applied" only because of this) and in `TestChange.before` / `after` (the listing's before and now). Left as they were (historic free
  text, written once): notification, event and contract-note texts, emails, chat, Stripe descriptions and kept drafts. Not run on the owner's databases yet.
- **Never cut:** `Cut` / `cutText` / `NameLink` draw a person's, a test's or a product's name whole (`neverCut`); only an email is still cut (in the middle). `fit`
  (§187: cut by the width with CSS `truncate`) now wraps these names instead (`[overflow-wrap:anywhere]`, no pop-up). Rows that drew a name or a title with
  `truncate` (+ `title`) wrap now: the tester dashboard's cards, Needs you's pay rows, the History, Find's cards and "by <developer>", Tests visited, Messages,
  the calls boxes, the developer's profile, Search, the Invite box's names, the Joined list, the product kickers. Server lines (pieceName, cutNamesIn, offerLine)
  keep their 20-character cut, which finds nothing to cut once the data is 20 or less.
- **Removed (dead after this):** AdminRich's `linkWords` (it only ran Cut on a name or a quoted title).
- **Kept:** emails (cut in the middle, the click-to-open box), long free text, the bell's 30-character line (and §246's rows), a new-terms diff (DIFF_CUT), and
  cutNamesIn's cut of any quoted “…” longer than 20 (historic contract notes may still quote an old long name, or a question). The Listing panel keeps §231's
  boxes for the title and the product (nothing cuts them there).
- **Test names green:** `TestName` (`src/components/Cut.tsx`): with a link, `NameLink` kind "test" (a green link, as people's names, §166); where a link would
  steal the press (a card or row that is itself one link, a toggle, a deleted test), the same green words (`text-volt-300`). Used on: Needs you's pay rows and its
  sentences (already NameLink), the developer's test cards, the tester dashboard (To do → the session page, Every part sent, the waiting and invite-only cards,
  Charge or cancel, Upcoming calls, removed / left cards, New tests, History), Find, Messages, the calls box, Search, Tests visited, the developer's profile, the
  tester's tests on a profile, Payments' sent-work headings (→ the session), excerpts ("From …"), the join page's "is full right now" line, the bell (a stack's test
  heading and the test's name inside each line, `bellWords`), and the admin's lines (their test links were green already; MineLine's unlinked title too). Payment
  rows link their whole "what" to the test, and confirm rows link their quoted test names (green links). Headings stay: the test page's and the join page's h1.
- **Tests:** new `tests/twenty-chars-245.test.ts` (the limits; the sign-up, profile and Google rules; the counters; the migration's statements and a run on its own
  rows; nothing cut, `fit` wraps; TestName and the green spots; bellWords). Updated for the new limits or the uncut names: `rules`, `post-edit`, `batch10`,
  `batch34-fixes` and `batch35-one-rename-line` (their titles were over 20), `batch35-hard-limits`, `batch35-green-names`, `batch35-name-links`,
  `batch35-next-round-one-tap`, `layout-fixes-187`, `long-text-cut`, `long-text-layout`, `names-sweep-238`, `needs-kind-folds-199`, `terms-history-236`.

## §246 Payment, confirm and bell rows: the "what" cut at 30, opened in place (owner, Nov 5)
Every payment row, confirm row and bell line shows its "what" text cut at 30 characters and opens IN PLACE as plain text.
- **`WhatLine`** (`src/components/WholeLine.tsx`): closed, the first 30 characters (`bellShort`: never inside a word or an amount), "…" and the arrow; the hover
  (title) the whole "what" (§244). The arrow shows the whole "what" inline, wrapped, with no box; only a line over `LINE_BOX_OVER` (200 characters,
  `src/lib/bell.ts`, the one place it is set: typed notes such as the team's hold note, dispute or pause reasons) opens in the draggable box (ResizeBox in
  OwnPanel). 30 characters or fewer: whole, no arrow. No per-name "…" toggles (names and titles are 20 or less).
- **Outside the cut, always shown:** the amount, the dates ("confirm by …", the payment's date), the marks ("your bank reversed this…", "refunded…") and every
  button (Confirm with your bank, Cancel this check, Pay, the Stripe links). Where: What you've paid (each payment and each group item, its "how" after it),
  refunds, Your earnings ("You get $X" before it), Pay what you owe's lines (the server now splits each into `what` and `rest`: the amount, status and date, or the
  chargeback's ": $10 + $15 chargeback fee", `owedSplit`), "That payment covered", a part's payments, the charges waiting, ConfirmList (`confirmItems` also gives
  `what`, `amount`, `by`), BankToConfirm (its lead split at its amount, `splitLead`) and BankWaiting (`before` holds the amount). Group headers ("Pay what you
  owe · $X", "Confirm all · $X") aren't cut.
- **Call:** BankWaiting's sentence on a test page ("Your bank wants you to confirm a $10.00 payment for her written answers, … Confirm it by …") carries its amount
  and date inside it, so it shows whole rather than hide them.
- **Bell:** BELL_LINE_SHOWN stays 30; an opened line follows the same rule (inline; the box only over 200).
- WholeLine itself stays for rows that aren't payment, confirm or bell rows (the Terms history's NameLine, the tester's offer row with its DIFF_CUT diff, Ratings to
  give, "asked for a live call").
- **Tests:** in `tests/twenty-chars-245.test.ts` (the 30 cut, amounts and buttons outside, an owed line, a confirm row, the lead split, inline open, the box over
  200, no arrow at 30 or fewer); `openWhats` (tests/helpers.ts) reads whole rows from the markup. Updated: `admin-payments-190`, `batch17-bank-check`, `batch24`,
  `bell-lines-202`, `chargeback-refunds-192`, `grouped-payments-191`, `nov5-batch2` (§216, §220), `payment-piece-names`.

## §247 A chargeback won names its payment in Pay what you owe's stop (owner, Nov 5)
The stop's bullet "Your bank's chargeback of $10.00 was reversed in your favour: $25.00 taken off" now names which payment it was on, as the bell and the refund line
do: "Your bank's chargeback of $10.00 on your $10.00 payment for Ana Silva's written answers on “Harbor Run” was reversed in your favour: $25.00 taken off".

## §248 Google sign-in is off (owner, Nov 5)
The owner wants email and password as the only sign-in for now: "Continue with Google" is gone from Log in and Sign up, and the Google routes answer as switched off,
even when the Google keys are set. `googleConfigured()` needs GOOGLE_SIGNIN=on as well as the keys (not set anywhere), so it can come back later by the owner's call.

## §249 Every list of questions: one drop-down, a scroll panel, each question a drop-down (owner, Nov 5)
As the new-terms "questions changed" (§233, §242): every list of questions (the tester's contract terms in "Your agreed scope", the listing information on the
developer's and the join page's panels, the join page's "<dev> wants to know" (open there), Terms history's then and now, Edit's other-tab notes) is the shared
`QuestionTexts`: a drop-down "Questions (N)", its list in the draggable scroll panel, and each question its own closed drop-down ("Question 3 · Required · <its first
words>") with its words in the question box when opened.

## §250 An update listed in any stop box on a page is seen for every button there (owner, Nov 5)
Seen in recording G (the R5 re-take): Stop stopped with a box listing Ben left, the team decided Gus's dispute, Fay disputed…; End early then stopped AGAIN with the
same updates, and Stop's box came back with the same list. Each press only counted its own box as seen (its second press's `boxAt`); another press counted from the
page load or what the live top box showed (§90).
- Once a stop box has LISTED an update on a page, no other press on that page stops for that same update. Per update, not by time: a box lists only what applies
  to its press (Stop leaves a payment out when Payments is ticked; Pay on that part is forced to stop for it, §171), so only what a box actually listed counts. An
  update that arrived before the box but wasn't in it still stops the presses it applies to, by their usual rules; a newer update stops as usual.
- Identity (`sid`, lib/server/shownLines.ts): the test event's row id when the line is one, otherwise its kind, time and raw text; hashed short. Every line of the
  developer's gate (devGate, its `devLine`), the tester's gate (testerGate, `asLines`), the stop / pause / lift moments (`stopBox`, the session route's moment box)
  and Edit's version lines carries it; the live box's lines carry it too, so a live line added to an open stop box counts once the box shows it.
- The page: every ChangesBox that renders lines records their identities page-wide (`markShownInBox` → `noteListed`, lib/live.ts); every press with a seen marker
  sends the newest 200 (`shownIds`, lib/client.ts; the server reads at most 300). Per page load: a reload starts fresh, and so does another page in the tab.
- The server: devGate and testerGate (and the moments with them, the developer's Rate gate, Edit Save's own lines from devChanges and its version lines) drop a
  line whose identity is in the list before deciding to stop. Pages: the developer's test page (Stop, End early, Pay, Pay more, call presses, Invite, Edit's Save on
  its own page), the tester's session page (Send, Add, Rate, Leave, Dispute, call presses, Charge / Let it go), the dashboards (Confirm, Confirm all) and Payments
  (Confirm).
- Forced lines (§171 A2/A3: a dispute or decision about the press's tester, a payment on that part, a stop or pause moment) are seen too once a box listed them.
- Exceptions, named in code (`everyPress`, shownLines.ts):
  - Rate / Leave's open-terms line (§232, `openOfferMoment`) is never marked seen: it stops each of those presses once while the offer is open, whatever a box
    listed (an offer line a box already listed no longer stands in for it).
  - Edit Save's per-field lines ("Instructions: your version will replace the one saved in another tab", the keys' Added / Removed, a given key it deletes) compare
    what THIS Save holds with what's saved: they are the Save's consequences, not updates, and always show.
  - Lines without an identity never count: Pay what you owe keeps its own seenIds / seenAmounts (holds.ts), and the bank window's notice (§171 A3, a peek, not a
    press) lists everything as before.

## §251 All line cuts at 50 characters (owner, Nov 5)
Every bell, payment, confirm and owed line shows its first 50 characters (was 30, §202/§246); everything else as before.
## §252 A dispute in Needs you is one drop-down (owner, Nov 5)
The dispute's line ("Nina Park disputed what you paid for the call on … · waiting for the team") is the summary of ONE drop-down for the whole dispute; inside, the
tester's reason sits right under the line in its box (no drop-down of its own), then "Add your side". Open at first, as before.

## §253 Disputes: add your side, one drop-down per person (owner, Nov 5)
On the dashboard, "Disputes: add your side" has one drop-down per tester (their name, "· N disputes"); inside, each dispute is its own drop-down as in §252: its line
("Disputed what you paid for … on “<test>”") the summary, the reason right under it in its box, then "Add your side". All open at first.

## §254 Past questions without the earlier sets' "Previous questions and answers" folds (owner, Nov 5)
The "Past questions (N)" box ends with the part's past questions only (SentWork part="past"), on both sides: the tester's session page and the developer's Testers
list. The earlier sets' folds (PrevSetFolds) are gone; it had no other use (the team's "See the work" uses SentWork), so it is deleted.
- Nothing sent is lost. Since §136 a Send after a switch is ADDED under what was sent (`Submission.additions`), so every sent answer is one of the part's threads;
  the contract's earlier sets (`Contract.prevSets`) only copy them (their "Sent" version), plus the tester's unsent draft. Before §136 a Send after a switch
  REPLACED the sent set and kept the old one only in `Submission.prevSets`: those answers are in no thread. They are now drawn after the past questions as more
  read-only past questions in the same boxes (`earlierSent`, lib/additions.ts): each non-blank answer of an earlier set whose question's thread holds neither it
  nor an addition with its words, once. The developer's come from the piece's own earlier sets; the tester's from those and the contract's "Sent" versions.
- An earlier set's unsent draft (the tester's "Draft (not sent)") is no longer shown: it was never sent. With nothing sent there is no Past questions box.
- `pastCount` counts exactly the folds the box draws (`pastThreads` with the same earlier sets), no longer the questions' words.

## §255 No "new question" tag on the developer's side (owner, Nov 5)
SentWork's `newQuestionTag={false}` on every developer view (the Testers list, its Past questions, Needs you and the update row); By question never had it. The
tester's own page keeps the tag on a question that came with changed questions; the team's "See the work" is unchanged.

## §256 Questions and answers told apart at a glance (owner, Nov 5)
In QA.tsx (every question and answer box): a question is a sky-tinted box (sky tint, a sky border and a sky left accent, its text sky-pale and italic) under a
sky label ("Question 1"); an answer keeps the normal dark box with the volt left accent, under a volt label ("Answer", "Notes"). "Added · <date>" keeps its green
label. Sky, not indigo: this app's indigo is remapped to volt. The ResizeBox / OwnPanel behaviour is unchanged. The excerpt picker's "Your answer" was a box
drawn by hand; it is QA's AnswerText now (at its own first height, keeping its line breaks).
## §257 Invite testers: "Find testers" above the search box; list headings stay put (owner, Nov 5)
"Find testers" now heads the Search by name box (always shown); its results stay right under the box, above "People you've worked with". In the lists' scroll box,
"People you've worked with" and "Suggested" stick to the top of the box while their rows scroll under them (before, a scrolled box lost its heading, and a row's
open "Worked with you on 1 test" could sit at the top with no name or heading over it).

## §258 The questions changed: no "(before)" on a removed question (owner, Nov 5)
A removed question reads "Question 1 · Removed · <its words>" (it was "Question 1 (before)"): the Removed tag already says it.

## §259 No label over a question (owner, Nov 5)
A question box has no "Question 1" label over it any more: the sky-tinted box (§256) says it is a question. The label stays for screen readers (`sr-only`); a
Required question keeps its small Required tag above the box; the questions changed' "Before" / "After" labels still show (`showLabel`). Answers keep "Answer" /
"Added · <date>".
## §260 No "What you sent is for the questions until …" line (owner, Nov 5)
The tester's answer form no longer starts with "What you sent is for the questions until <date>. Send your answers to these questions: they're added under what you
sent." (`data-set-until-form`); "Questions you haven't answered yet" and the boxes follow straight on.

## §261 Text boxes locked while their Send is going through (owner, Nov 5)
"Disable typing in boxes while their send is going through." From the press until it ends (the server's answer, any bank check it opens, and after it went
through until the page's redraw or next page), every box whose text that press sends is read-only (`readOnly`, never `disabled`: the text stays selectable and
readable), dimmed with a not-allowed pointer (`[data-send-locked]`, globals.css). The same form's file pickers, formatting buttons (Bold, Italic, Code block, 📎),
a file's × in the answer preview, "Use theirs" and the call request's repeat choices, Remove and + Another time are disabled (Discard / Use saved keep §58's
rule). Refused, failed, stopped once or not confirmed by the bank, the boxes are exactly as before, with the draft. No press, stop-once rule, draft saving or
wording changed.
- One rule, lib/sendLock.ts: `lockText(sending)` / `lockPick(sending)` spreads on the boxes a form draws; `useSending()` covers a whole press (its request, then
  its bank check or draft clearing) so the boxes never open for a moment in between; PressButton tells its caller with `onSending`; the written answers'
  AnswerBox reads its form's `SendingScope`; `useLockInside(form, busy)`
  locks a form whose boxes are drawn by many parts (AuthForm's sign-in / sign-up / forgot / reset, Post a test / Edit with KeyBoxes and FieldNote's Use theirs)
  and puts back exactly the boxes it locked.
- Where: the written answers (Send Answers: every answer, Anything else), Add to this answer / Answer this question; Dispute the pay; Add your side; chat and
  direct messages; Request a time (times, Length) and each Cancel's Why (only the menu pressed: the panel's busy is every button's); Report a problem / Report a
  person; the excerpt (and its answer picks, Use original answer); Pay / Pay more (rate, amount, note); Rate's note; the join / application note; Charge's
  amount; Stop's and End early's Why? (each only while its own press goes); profile name and bio; Contact us; every admin button with a box (once, in
  AdminButton), the dispute decision's total and note, the team's close reason, the hold's note to the developer.
- Not locked: search and filter boxes (nothing is sent), Invite (no typed text goes), ticks and choices that aren't text (except the request rows' and
  the excerpt's, which change the typed text on its way). The recording part has no text box (§239), its file picker was already disabled while sending.
## Hotfix of §230: the dashboard failed while a charge waited for the bank (recording B4x, Nov 5)
"Your bank wants you to confirm" on the developer's dashboard is drawn by a server component (BankToConfirm) that handed the client BankWaiting a function
(`render`, for the green test links), which a server component can't do: the dashboard showed "Application error" whenever a charge waited for the bank. It now
hands the links as data (`tests`) and BankWaiting builds them itself. The quoted test names in payment lines (withTestLinks) are green, as every test link (§245).

## Fix of §228: a closed call request shows what happened for 6 s from any cause (recording B6, Nov 5)
The line came only from the box's own /api/pulse check every 8 s, and the page's redraw dropped a closed request at once: the developer's Accept showed no line
(gone 1.0 s after the press), the tester's Withdraw in their own tab showed none (gone at the redraw, 12.7 s), and a Withdraw seen while live updates were held
back showed "Withdrawn" for 0.2 s. Now the box's owner (CallRequestsBox on the test page, CallRequests on the tester's session page) holds the list
(`useClosingRequests`, CallRequestsPanel.tsx): a request the redraw drops stays in its row (as last drawn, no buttons) and the box checks the pulse at once; your own
press checks at once too. The line is the pulse's own ("Booked", "Declined", "Withdrawn", "Another tester took this time at …", "Closed: …"; never a guessed one) and
shows GONE_SHOWN_MS (6 s) from when the page first shows it, then the row leaves. A time that passed reads "Closed: its time passed" (the pulse now says so for a
waiting request whose time is past, which the page already leaves out). A dropped request the server says is still waiting leaves at once with no line; with no
answer at all (offline) after 6 s. The test page now always draws CallRequestsBox (nothing with no request), so a box whose last request closed stays for the
line. A refused press's line still goes to the top of the box at once (§207); the row then says what happened for its 6 s. Not covered: the tester's whole
"Requests" section is drawn by the server only while they can request or have one waiting, so when a block closes their last request it goes with no line.
## §262 Excerpt trim: a character deleted by accident can be typed back (owner, Nov 5)
The trim box stays delete-only (§196), with one exception: typing, at the caret, the very next character of the answer that was left out there restores it (and
the next, in order). Any other typing, pasting or dropping is still refused, so the excerpt is always the answer's own words (the server's check is unchanged).
The hint reads "… you can only leave words out (deleted something by accident? Type it back where it was)." `insertedRange` / `restoreAt` in lib/excerptTrim.ts.

## §263 Old questions live in Terms history (owner, Nov 5; final; replaces §234's Past questions box, §254's earlier-set answers in it, and the earlier §263 drafts)
The bug: bb added to question "3" after the developer's last payment; the developer changed "3" and bb switched. The addition vanished from Needs you (it never
showed a past question) and from the Testers list's Past questions box (drawn as paid), so an unpaid answer was invisible to the developer.
- One rule, by the question's words: a question is current for a tester when it is in their contract's questions now (`currentQuestionsFor` in lib/additions.ts,
  the one place that says it; lib/server/tests.ts `writtenQuestions` is it), otherwise it is old (`isPastQuestion`).
- The answer lists show the current questions only, on both sides: the tester's "Your written answers" and the form; the developer's Testers list (as paid,
  §226) and By question (`answersByQuestion(…, current)`: an old question's additions stay out of Anything else too). PastQuestions.tsx, `pastCount`,
  `pastThreads`, `earlierSent` and SentWork's `part` / `earlier` are gone.
- Terms history has an entry for every change of the questions: "Questions changed <date/time>", then a "Then and now" drop-down: Then is the questions as they
  were, each its own drop-down (QA.tsx QuestionTexts: "Questions (N)" in a draggable scroll panel, the question box and the answer boxes resizable), with what
  this tester had for it at that moment: the sent answer and each addition up to the change; otherwise the unsent draft, "Draft (not sent)"; otherwise
  "(no answer)". Now is the questions after it. Built by `questionChanges` (lib/questionHistory.ts) from the contract's earlier sets (`Contract.prevSets`), which
  a change already writes: the questions then, the "sent" version and the "draft" version (the draft snapshot). A change now always keeps its set (it was kept
  only when something was answered) and records `to` (the questions after). At most 8 sets are kept (was 3). No migration.
- Attachments: answers are drawn with SentWork's renderer (`SentAnswer`: file markers inline from the part's uploads by id), so a file still opens from the
  entry after its question changed (the files are kept while an earlier set names them, recordings.ts). On the tester's side the files also include their
  uploaded, unsent ones (a draft's).
- The developer: the same entries under each tester's written answers in the Testers list ("Terms history" drop-down), built without drafts: never a draft's
  text or files.
- Needs you: a new, unpaid answer or addition to a question that has since changed still shows (after the current ones, read-only), with a small "Old" tag
  beside the question, the developer's only "old" marker. Pay / Pay more covers it as before (the paid cut and the update row are times, never questions); once
  paid it is only in Terms history.
- A question changed back to earlier words is simply current again: answered, its thread is back in the list with its answer and additions, and Add to this
  answer works (after the Send that moves the part onto the current questions, §235); never answered, it is a box in the form, and a draft snapshotted for it at
  an earlier change is put back into the kept draft (terms.ts, on the change). `carriedAnswers` reads each question's last sent answer by its words over
  everything sent (a thread's `latest`), so a question that comes back is never asked again. The history entries stay as they were.
- The switch's offer entry in Terms history drops its own "Questions then and now" when the change has its "Questions changed" entry (the same moment).

## §264 "Your agreed scope": four listing lines under "Your contract" (owner, Nov 5)
What to do (the description), the Build link, Languages and Devices moved from "The listing information" into "Your contract", below Due, in that order. They keep
their live behaviour (the current listing value, "Updated <time>" with before → now, the shared ValueText boxes for long text) and their `data-info-line`, so the
top box's See it still opens #scope and marks them (it looks inside the whole box). One helper draws a listing line in both places (`infoItem` on the session
page). The sentence under them reads "Agreed <date>. Your contract stays as it is: if <dev> changes these terms later, you choose Switch or Keep. What to do, the
build link, languages and devices are the exception: they follow <dev>'s changes, marked Updated." The other listing lines (title, product, Mature) stay below.
The developer's own Listing panel is one list and is unchanged.

## §265 Questions follow the listing; old means not in the listing (owner, Nov 5; replaces the questions part of Switch / Keep: batch 13's previous sets on a switch, batch 18 §8's switching wording, §221 / §233 / §242 / §258's questions-changed block)
- `Contract.questions` stays "this tester's questions" (read through `currentQuestionsFor`, §263), but a Save that changes the questions now writes the listing's
  questions into every working contract of the test, in the Save's own transaction (`followQuestions` in lib/server/terms.ts, called from the Save in
  lib/server/tests.ts). That is the one place that keeps them in step, so "old" (not in the contract) means "not in the listing" for the tester and the developer
  alike. A contract that already differs from the listing (an offer kept before §265) is brought in line on the next Save that changes the questions. No
  migration rewrites data.
- Each change keeps the earlier set (§263's Terms history entry, with `to` and the "sent" / "draft" versions: the draft snapshot) and fixes the kept draft: boxes
  typed for questions still asked stay, a returning question's snapshotted draft comes back. A Required tick alone is written into the contract with no entry.
  No "Sent for the questions until" mark any more (a part marked before §265 keeps its note and its Send).
- No offer carries questions: they're not in `termsDiff` or the Save's terms, so a Save that changes only the questions makes no Switch / Keep offer; an
  offer for other terms (prices, parts, NDA, deadline) is made as before, its `questions` the contract's own. Switch never writes `Contract.questions` (an older
  open offer can't put stale questions back). TesterTop's questions-changed block, `switchQuestionsLine` and `ANSWER_NEW_QUESTIONS` are gone; the
  per-field limit of 3 question changes is unchanged.
- The tester is told as for listing information: the questions in "Your contract" carry "Updated <time>" (before → now, the latest change since joining) and
  `data-info-line="questions"` (the top box's See it marks them); the top box's line names "questions" (they're in INFO_FIELDS now); and a bell line in the
  listing's words, "<developer> updated the listing: questions", linking to #scope.
- Adding to an answered current question works straight away, by its words, whatever set it was sent in (`addRefusal` / `addWritten` read the contract's
  questions and `carriedAnswers`, not the latest set sent); an old question is refused (QUESTION_GONE). Needs you's "Old" tag (§263) is the only old marker.
- Required: a new required question is a box under "Questions you haven't answered yet" and required at the tester's next Send only (`answersMissing` checks the
  form's own questions). It never touches what was sent: Pay, Pay more, Charge and reviews never check questions.
- Price: answers sent to a question that is now old stay payable at the part's agreed price, `Submission.agreedCents` (set at the first Send; while unpaid each
  later Send re-prices it to the contract's written price; after a Pay it stays). (The "sent at $X" beside an old-question tag was dropped with §263's final
  form, which removed the tag from the answer lists.)

## §266 Terms history shows only the limited fields (owner, Nov 5)
Terms history keeps only changes to the fields limited to 3 changes (CRITICAL_FIELDS in lib/limits.ts: what to do, questions, languages, devices, build link,
parts and prices), on the tester's session page and on the developer's per-tester history (§263, which only ever holds questions entries).
- Kept: the joined line ("<date>: you joined on …", its "and accepted the NDA" tail too: it isn't an NDA change line); "Test stopped" with its reason; §263's
  "Questions changed" entries; the listing-information entries limited to what to do, the build link, devices and languages (`limitedHistoryRows`); offers,
  each listing only its limited changes (`limitedTermsDiff`: parts, prices and Required ticks; "questions changed" on an offer made before §265); the payment
  lines (not a field change, left as they were).
- Left out: title and product name (the "Renamed" contract notes), categories, Mature and its reason, Open until, spots, the deadline, and the NDA (the offers'
  "NDA then and now" and any NDA part of an offer's diff). An offer that changed only fields left out (e.g. only the NDA) gets no entry.

## §267 The NDA is a listing change with its own notice; adding or removing one blocks until seen (owner, Nov 5)
- Like the questions (§265): a Save that adds, removes or changes the NDA copies it into every working contract in the Save's transaction (`followNda` in
  lib/server/terms.ts), recording the change's kind and time on the contract (`ndaChangeKind`, `ndaChangedAt`). The NDA is no longer a term: a Save that
  changes only it makes no Switch / Keep offer (an offer carries the contract's own NDA), and Switch never writes the NDA (or its acceptance) back, so an older
  open offer can't either. The offer box's NDA Before / Offered is gone. Terms history already leaves NDA lines out (§266).
- Its own notice, apart from "updated the listing": the bell line "<developer> changed the NDA" (emailed as bell lines are), linking to
  `/app/sessions/<id>?nda=open#info-nda`; at the top of the session page "<developer> changed the NDA" with "changed the NDA" as the link (NdaNotice); and an
  ordinary stop-once line for presses whose page hadn't shown it (testerChanges, kind "nda": Alerts on only). The link (here, the bell's, a refusal's) records
  `Contract.ndaNoticeSeenAt` (action "nda-seen"), brings the NDA line into view and marks it. An added NDA opened this way counts as read: "Accepted <date>" on
  its line and the developer's "NDA accepted" badge.
- The NDA line moved from "Your contract" into "The listing information" (`id="info-nda"`, `data-info-line="nda"`, with "Updated <time>" when it changed since
  joining, the text in its NdaBox, or "None").
- The block (`ndaBlocked`, lib/ndaNotice.ts): an ADDED or REMOVED NDA whose notice wasn't opened refuses every press of the tester's on that test (the session
  route's presses: Send Answers, Add to this answer, recordings, calls and requests, Charge / Let it go, disputes, Switch / Keep, messages; and calls through
  `answerTermsFirst`) with one line in the blue notice (§213's look) whose link opens the notice: "<developer> added an NDA to this test: read it before you go
  on" / "<developer> removed the NDA from this test: see the change before you go on". The page shows the same line as a banner at the top. Rate and Leave are
  never blocked (§268), nor an upload already under way. Opening the notice lifts it. A changed text only notifies (the owner's rule; adding "changed" to
  `BLOCKING_KINDS` would extend it). A tester who joins after the change accepts the NDA at join as before and is never blocked (their contract records no change).
- The developer's side is unchanged apart from no offer being made for an NDA change. Migration 20261120090000_nda_notice_terms_pill (hand-written, columns only).

## §268 Rate and Leave follow the ordinary stop-once rule; the contract box's "New terms" pill (owner, Nov 5; replaces §232)
- §232's special stop for Rate and Leave (`openOfferMoment`, `everyPress`: "…, or rating / leaving closes them unanswered", even when shown) is gone. Rate and
  Leave follow the ordinary testerGate rule for new terms and an NDA change (`ordinaryTerms`): they stop once only with Alerts on, and only when the change came
  before what the page (or its live pill) showed; with Alerts Off an offer never stops them. The NDA block (§267) never applies to them.
- Their pop-ups show a small blue notice while new terms are open, information only: "<developer> offered new terms you haven't answered: rating (leaving)
  closes them unanswered." with "See the new terms" (to the offer box). No notice without an open offer.
- While an offer is open, "Your agreed scope" carries a "New terms" pill (the look of the other update pills) that stays across reloads until pressed; pressing
  it records it on the offer (`TermsOffer.pillPressedAt`) and brings the new terms into view. A newer offer brings it back. It's separate from the live pill.

## §273 Invite testers: "no matches" says when the filters are why (owner, Nov 5)
A name search that finds nobody only because of the ticked devices / languages reads "No testers match “mha” with Korean ticked: 1 tester matches without the
filters." (`filteredOut` from invitePanel; blocked and deleted accounts are never counted). Nobody of that name at all keeps "No testers match “mha”.".
## §269 Question order doesn't matter; a stale page's Send stops once, then takes the new questions (owner, Nov 5)
1. Order doesn't matter. Question lists compare as sets of their words and Required ticks (`sameQuestionSet` / `sameQuestionWords` in lib/questions.ts).
- A Save that only reorders the questions (or leaves the same words and Required ticks) is not a questions change: Edit's changed fields leave "questions" out
  (`sameListingValue` in rules.ts: the Save's fields, `changedTerms`, `editNews`), so it uses none of the 3 question changes (criticalCounts; Edit's own lock
  check `countedKeys` too, so a reorder works at 0 changes left), writes no listing / listing_save / listing_values / listing_saved record (no "Updated" mark,
  top-box line, Listing panel tag or bell), no Terms history set (`followQuestions` compares words as sets) and no stop-once reason. The new order is saved on
  the test and on every working contract with the same questions (`saveQuestionOrder`), so the question numbers follow it. Answers stay with their questions by
  their words (they always did: carriedAnswers, questionKey).
- A Save that reorders AND changes words counts once as before; its Terms history entry shows the real change: Now lists the questions that stayed in Then's
  order, then the new ones (`inThenOrder`, lib/questionHistory.ts), and an older entry that was only a reorder is no longer listed. An old offer's "Questions then
  and now" compares as a set too.
2. Stop on press, then update the questions.
- Send Answers and Add to this answer list a questions change question by question, in the stop lines' words: "Nora Lane removed the question “…”", "… added the
  question “…”", "… made the question “…” required / not required" (`questionChangeTexts`, `questionChangeLines` from the listing Saves since the page). They
  follow the ordinary rule (changed after the page loaded, not shown by the live pill or a stop box: Alerts on); a box that listed the listing's own line for
  those Saves showed them.
- The page always sends its form's questions with Send (`for`); the server reads the answers by their words, never by place. A form that holds a question the
  contract no longer has (or lacks one a change since the page added) never sends: the press stops once whatever the Alerts, a confirmed press or the live pill
  (`staleQuestions`, forced lines). What was typed is kept: a current question's text in the written draft, a removed question's text in the draft snapshot of
  the Terms history entry that removed it ("Draft (not sent)"; `keepStaleTyped`). The Send's lock checks the questions again ("Your questions changed just now:
  nothing was sent…").
- Add to this answer on a question removed after the page loaded stops once the same way (its typed text stays kept under the question); once those lines were
  listed, the plain refusal (QUESTION_GONE).
- A stop that lists a questions change (`questions` in its reply) redraws the page at once; the written form is one form now (no remount per question set) and
  switches in place: each box keeps its text by the question's words, a new question is an empty box (a draft the server kept for it, e.g. a question that came
  back, is put back: `keep.reload`), a removed question's box goes. The next press sends normally.
- Comes back (§263, unchanged and covered): answered, its answer and additions return and Add to this answer works; unanswered, it is a box in the form and its
  snapshotted draft (now including what a stale page's Send held for it) is put back.

## §270 Green links on every name and test; rows link to the exact part (owner, Nov 5)
1. Every person and test a line names is its own green link (`text-volt-300`, the same for both): a person opens their profile (a tester `/app/testers/<id>`,
   a developer `/app/developers/<id>`); a test opens the developer's test page, a tester's session page for it, else its public page (`/app/find/<id>`). A deleted
   account and "You" / "your" are never links.
- No new data: the server sends `links: { text, href, kind: "person" | "test" }[]` with each line (lib/lineLinks.ts: `personLink`, `testLink`, `linksIn`,
  `splitLinks`), and the client turns those exact substrings into links (components/LineLinks.tsx `withLineLinks`, which generalizes `withTestLinks`). The lists
  come from the reader's link pool (lib/server/lineLinks.ts `linkPool`: their tests as developer and as tester, the people on them, applicants and invitees, the
  people they message), matched where each line is built; payment rows build theirs from the contracts the row already loads (paymentRows `ctxPool`).
- A name the 50 cut ended ("on “Harbor…", "Alexandra…") keeps its visible start linked (the "…" is not part of it), closed and opened.
- Where: bell lines alone and in stacks, the stack title naming a test, and the stack's preview; What you've paid (and its group items and refund lines), Your
  earnings, the Testers list's part payments, Payments' charges waiting for the lift; the confirm rows (the dashboard's "Your bank wants you to confirm", Payments'
  ConfirmList, Needs you's bank rows); Pay what you owe lines (and what a reversed payment covered, and the lines a stop hands back); stop-box bullets; refusals
  (Err, the stop box's refusal, the kept refusal), the NDA notice and its block line; the top box's live lines; the bank window's notice lines (a plain check's
  and Confirm all's). A refused or stopped press's reply carries its links (`handle()` adds them for the request's reader on 403 / 409 / 422: `links`,
  `changes[i].links`, `lines[i].links`), as does a bank check's peek; the page keeps them for the lines it draws from those replies (lib/lineLinkRegistry.ts).
2. A row that was one whole link now links its other words to the most specific place, beside the name links (never nested): a bell line's words keep its own
  link (already the exact place: `#piece-<id>`, `#call-<id>`, `#tester-<id>`, the session's `#part-…`); a developer's payment row (What you've paid, a group
  item) and a charge waiting for the lift open the exact part on the test page: `#piece-<submission>` (Needs you, else its row: HashJump's fallback),
  `#call-<call>`, else `#tester-<contract>`. The team's copy keeps its own test pages. A stop line that opens its place (`link`) and a top-box line about a row do
  the same. Pressing any piece of a bell line marks it read; a stack's heading is a `role="button"` so its test name can be a link (pressing it reads the stack).
- Bell lines are matched when the bell is read (the notifications page), never stored, so lines written before §270 ("Receipt: you paid $15.50 for bb's live
  call on “excerptexcer…” …") get their links too: the pool holds the line's test, its developer and its contracts' testers (the people a bell's `about` can be),
  matched exactly as written; a test name an older cut ended with "…" matches by its visible start (`linksIn`). A name nobody in the pool has stays plain.
3. Unchanged: the 50 cut and its arrow, hovers, amounts and buttons outside the cut, the stop-once rules, all wording. The tester's earnings rows had no link and
  get only the name links.
## §272 Verify a card turns off on every open page once verified (owner, Nov 5)
- The owner's finding: a developer on a chargeback hold with Payments open in two tabs verified the card in one; the other tab's Verify a card stayed enabled
  until a press was refused ("Your card is already verified.").
- Rule: once the card is verified, every open page's Verify a card turns off on its next update (the page's poll redraw), without a press.
- The Payments page's own version (`paymentsV`, `fresh=payments`) now reads the account's chargeback state (`chargebackStateV`: the hold's start, the card
  verified, the team's approval), as `owedV` (`owed=1`) already did; the dashboard's version includes `paymentsV`, so its restricted box's steps line follows;
  the test page's version (`testV`, which shows the developer's own chargeback steps) reads it too.
- On the redraw the card step shows ticked in the same done style as the other steps, Verify a card is gone, and an open card form's Verify this card goes too
  (kept only while its own press is in flight).
- A press that lands before the update keeps its refusal (CARD_ALREADY_VERIFIED, §157). Test: tests/verify-card-turns-off-272.test.ts.
## §271 A pause or hold since the page loaded stops every press once, except Decide dispute (owner, Nov 5)
- A pause is the team's pause of the test, the developer's payment or chargeback hold, or a developer suspension. A pause since the page loaded, and the team's
  lift of its pause (§207), stop every press on that test ONCE, both sides, whatever the Alerts (forced lines); the second press goes ahead. Testers read only
  "This test was paused at …" / "This test resumed at …"; the developer reads their own words ("Your tests were paused at …", "Your developer account was
  suspended at …", "The team paused this test at …", "The team lifted its pause on this test at …").
- Tester side, one shared place: testerGate adds the pause moments itself (`testerPauseMoments`), so every press through it has them: Send Answers, Add to this
  answer, a recording's Send and add, Charge / Let it go, Dispute, Rate, Leave, Switch / Keep, Request a time, Accept / Decline / Withdraw, Cancel call and Cancel
  the remaining calls. The session route's stateMoment keeps only the stop. Presses outside the gate stop with `pauseStopOnce`: Join call, a message, an excerpt
  request, and Block / Report on a developer's profile (her working tests of that developer). Their pages send the load time (`useStopOnce`: the page's seenAt or
  PageLoaded's; the developer profile and chat pages now note it).
- A press refused while paused gets ONLY its refusal (it already says paused), never a stop first: Send / Add / a recording's Send (§213's notice), Request a
  time, Accept (its paused refusal now comes before the gate), Join call, a message, Rate on a team pause. After the lift those presses stop once for the
  lift (and the pause it ended, when that came after the load).
- Developer side: devGate already had the pause and lift moments (Pay, Pay more, Confirm with your bank, Confirm all, Stop, End early, Invite, call presses);
  added to Edit Save (the timed lines replace the raw "The team paused this test" records), Rate, Add your side, excerpt Allow / Deny, Join call and messages.
  A team pause or hold still refuses most developer presses first (the banner, requireActive), so those show only the refusal. Pay what you owe keeps its own
  seenIds stop (a hold since the page loaded comes with the new debt it lists).
- The team's Decide dispute never stops for a pause or hold.
- Once a stop box on the page listed a pause or lift line, no other button there stops for it again (§250's `shownIds` / `sid`).
- Tests: tests/pause-stops-every-press-271.test.ts. batch15-paused's "the developer's side never stops" now stops once for the suspension since the page
  loaded; other-tab's declined-Pay gate now lists "This test was paused at …" after the delayed line (the hold the decline started).
## §274 Tester search bars in Needs you and the Testers list; Suggested its own section; the invite search applies to every section (owner, Nov 5)
- Needs you: a "Search testers" box at its top keeps only the people (§181's drop-downs) whose name matches as you type, with the invite search's name match
  (`nameMatches`), on the page only. Nobody matching: "No testers match “x”.". Hidden when Needs you holds only one person (the Applications drop-down, §199, is not
  a person and is never filtered). Both views (the restricted one too). `data-needs-who` on each person carries the name.
- Testers list: the same box right below the row of avatars (TesterListSearch, TesterSearch.tsx); the tester rows follow it, with the avatar filter (§140) as
  before. It replaces RowsBox's "Find a tester by name" box (shown from 7 testers). Hidden with only one tester row.
- Invite testers: Suggested is its own section below People you've worked with, with its own heading and scroll box (the same style; §257's sticky heading in
  each). The "Tick at least one tester" red ring and its line stay on the two lists together (`data-invite-lists`, following `none`).
- The Find testers search applies to all three sections: a typed name keeps only the matching people in Find testers, People you've worked with and Suggested (a
  person shows in every section they belong to, one tick); the device / language ticks now narrow People you've worked with too (invitePanel: `passes()` and the
  name on `worked`). Suggested's top 5 is taken after the filters. An emptied section says "Nobody you've worked with matches." / "No suggestions match.";
  §273's line for Find testers stays. While the server's answer is on its way, the rows shown narrow to the typed name at once.
- Tests: tests/tester-search-bars-274.test.ts. batch35-tester-folds' RowsBox check follows the new filter call; batch35-hard-limits lists TesterSearch.tsx with
  the page's other search filters (no character limit).

## §275 The Save's note: at the top, "Saved.", fades (owner, Nov 5)
After a Save the test page's note sat under Invite and stayed until the page was left (a live redraw kept it), reading "Saved. New testers join on the new listing;
testers already in keep their contract." (no longer true since §264/§265/§267). It now sits at the top (above the Listing panel) and reads "Saved.", followed only by
what else the Save did (new terms offered to N testers, applications closed, invites re-sent, not re-invited); it fades after 8 seconds (SAVED_NOTE_MS) or closes
with ×.

## §276 Invite testers: only tester-side ratings; unrated testers after rated ones (owner, Nov 5)
- A tester row shows only the ratings they got as a tester (Rating rows with side "developer": a developer rated them). Someone who is also a developer showed
  "3.0 ★ (1 rating)" from their own tester's rating of them as a developer; they now read "No ratings yet". `ratingSummary(userId, as)` takes the role they were
  rated in ("tester" / "developer", `RatedAs`; omitted, both as before), with the same reveal rules (revealedWhere and stillHidden). In Invite testers: the rating
  line, "No ratings yet", `ratingAvg`, the row's figures and changedAt (rankedTesters' full rows, testerRowInfo for application and invited rows, the Invite and
  Cancel invite rating-changed stops, and the application answer's stop in joining.ts, so the shown and current ratings compare the same side).
- The other one-sided places now use their side: the tester's hover on the developer's test page, TesterTiles / the tester dashboard's Rating tile ("tester");
  Find tests' "by <dev> · 4.0 ★", the join page's "by <dev> · 1.0 ★" and its Rating line, the session page's developer hover, DeveloperTiles ("developer"); the
  Messages / chat hover follows the profile it links to; your own profile's "Your ratings" follows the side the page is on.
- Ranking (rankedTesters, testers not worked with): meets, then rated before unrated (rated = at least one revealed tester-side rating, the ones the score
  counts), then score, accepted, matches. The score's formula (platform average) is unchanged. This orders Suggested (its top 5 after §274's filters) and Find
  testers; People you've worked with keeps its order; grey last and invitable first as before.
- Tests: tests/invite-rank-276.test.ts (own fixtures; the seeded "Rankdemo" testers are untouched). batch35-green-names and profile-stats follow the side argument.

## §275 revised: Save stays on Edit and shows "Saved." there (owner, Nov 5; replaces §275)
- A Save that goes through no longer opens the test page: Edit loads again in place (`window.location.replace(savedHref(...))`, so Back still leads where Edit was
  opened from), as a fresh load of Edit (the saved values, the counters and "Changes left"; the drafts this Save sent were already cleared, as before).
- At the top of the form (under Edit's line about new testers): "Saved.", followed only by what else the Save did (new terms offered to N working testers,
  applications closed, invites re-sent, not re-invited), from `savedNoteText` (lib/savedNote.ts). Just "Saved." fades after 8 s (SAVED_NOTE_MS); a note that lists
  any of those stays until ×. The address's saved/offered/closed/resent/skipped go at once, so a reload never replays it.
- Edit's "← Back to the test" link stays. The test page no longer shows a note or reads those params (only `failed` stays); spotclosed/spots, read nowhere, are
  no longer sent. Post a test still opens the new test page, which never showed this note.
- Tests: tests/saved-note-275.test.ts rewritten for the Edit placement.

## §277 Admin bells and console lines: green links on every person and test; chargebacks newest first in one drop-down; the dispute chat in a panel (owner, Nov 5)
1. Every person and test named in the team's bell lines and the admin console's lines is a green link to their place for the team: a person opens their profile
   with its admin box (`profileHref`: `/app/developers/<id>` for a developer, else `/app/testers/<id>`, as the console's names already did); a test opens its
   page with the test's admin box (`testHref`: `/app/find/<id>`). These are the console's existing targets (the console has no per-user or per-test row of its
   own outside the Accounts lists and `?user=`), so a name in a bell and the same name in a row open the same place. A deleted account stays plain.
- Bells (notifications page): an admin's team lines (their link opens `/admin…`) take their links from the line's own data, not the reader's tests
  (lib/server/adminLinks.ts `adminBellLinks`): the bell's test, and the row it opens: a dispute's test (its names, its developer and testers; the disputing
  tester first), the developer of a hold lift, the reporter and the reported person of a report, the developers on a chargeback hold and their tests. Worked
  out when the bell is read (never stored), so lines written before §277 link too, a name an older cut ended with "…" by its visible start (§270's `linksIn`).
  The admin's other lines keep §270's pool. A line naming no one (the suspended reminder, the email and storage alerts) gets none.
- Console: `linkRich` matches the plain words of a row's line against a pool built from the row's own data (`adminPool`) and turns the names into links beside
  the ones the line already had (Stripe ids and typed reasons untouched): the Chargeback holds lines (the testers and tests of the developer's tests: "Chargeback
  open: $12.50 for Ana Silva's live call on “Harbor Run: first 3” (…)"), Your actions (what a decision did), a person's boxes (Chargebacks, Holds and
  suspensions, payments, …) and a test's boxes (Timeline, Contract changes, Payments). The paused-tests list's rows now carry the test and developer links.
  Dispute rows, reports, suspensions, lifts and the hold row's developer already linked every name and the test. All are the console's `a` green.
2. Chargeback holds: each developer's open chargebacks are newest first (`chargebackHolds`: by `chargebackAt`, then the payment's time); the holds stay oldest hold
   first. (§277 revised) They sit in ONE drop-down under the hold row, "Chargebacks (N)", each "Chargeback open: …" line (with its links) in the shared draggable,
   resizable scroll panel (ResizeBox in OwnPanel, as QA's QuestionTexts).
3. (§277 revised) Dropped: the daily "N suspended account sides to review" reminder stays exactly as it was.
4. (§277 revised) Dispute rows: "Their chat on this test (N)" keeps its drop-down; its messages sit in the same shared panel (ResizeBox in OwnPanel, about 18rem at
   first, replacing the fixed max-h-72 box). Each sender's name opens their place for the team (`whoHref`), and the dispute's tester and developer named in a
   message's words are green links (`parts`).
- Tests: tests/admin-links-277.test.ts. batch33's person-box Chargebacks line now lists the tester and test links before its Stripe ids; name-test-links-270's
  notifications-page check follows `team.get(n.id) ?? lineLinks(…)`.
## §278 End early: a tester gone meanwhile is refused alone, the rest go on; no "Refresh to see the latest" (owner, Nov 5)
- End early with a ticked tester whose part already ended (left, ended, rated, removed…) and others still working: that tester gets a refusal line of their own
  ("Your End early didn't go through for mhann: mhann already left the test.", `gone` in the reply, `endEarlyGoneLine`) and the press goes on for the others by
  the ordinary rules (devGate / alwaysStops, keyed on the testers still in; the gone tester's own "left" line is what the refusal line says, so it doesn't stop).
  Something new: one stop, its box with the refusal line(s) above it; the page unticks the gone tester and the second press ends the others. Nothing new: their
  work ends at once, the refusal line beside the done line ("You ended Ben Okafor's work early."). Every ticked tester out: one refusal naming them, as before.
- The same for the other presses on a list of people: Request a time with several ticked testers (one whose session ended: "Your Request a time didn't go through
  for mhann: mhann's session has ended.", the others' requests go; all out: the refusal as before) and Invite with some ticked testers who rated the test (a line
  each, the others invited; all raters: one refusal, without "Untick … to invite the others"). Invite already skipped testers who joined or were invited meanwhile
  (a stop line, then skipped); Cancel the remaining calls acts on one set (no list): unchanged.
- Stale hidden ticks: a ticked tester whose row left the list (left, ended…) was still sent by every later press. End early (TopPanel), Request a time
  (DevCallPanel) and the broken-key Dismiss (KeysWarning) now drop ticks whose rows are gone on each redraw (`useDropGoneTicks`), and send, count and "Select
  all" only the ticks still in the list (`liveTicks`, lib/liveTicks.ts). Invite's ticks are kept on purpose for people outside the current lists (§173; greyed rows
  are already unticked); Pay what you owe, Confirm all and call cancels have no per-person ticks.
- "Refresh to see the latest." is gone from every notice and refusal (`staleNote` removed; "This page is out of date." stays where it was the start; the live
  route's bad `since` reads "This page is out of date."): the page's live updates already redraw. BLUE-NOTICES.md follows.
- Tests: tests/end-early-gone-278.test.ts; flow.test.ts and group-c.test.ts follow the new rule and wording.
## §279 Find tests shows the tests you're in, tagged "Joined", opening your session (owner, Nov 6)
- `findTests` left out every test the tester had a contract on (except left ones). It now also lists the tests they're working in (a working contract), with the
  search applied as to any other test, even when the test is closed to new joiners (full, joining closed, invite only, paused). Ordering is unchanged (device
  rank, then newest). The dashboard's "more tests" already skipped working ones, so it's unchanged.
- The card: a green "Joined" badge (the Invited / Open tone, `data-find-joined`), no "N spots open to you" or needs lines, and the card (title included) opens
  /app/sessions/<contractId> instead of the join page (`joinedContract` in lib/server/tests.ts). The category counts and "All N" include these tests, since
  they're shown.
- Unchanged: a tester who left, was ended or rated (today's rules: rejoin, "You left this test", out of Find after rating); an admin's Find.
- Tests: tests/find-joined-279.test.ts; batch17-find's source check follows the card's new href.

## §281 Payment and dispute notes in the draggable reason box everywhere (owner, Nov 6)
- The short typed notes around a payment or a dispute are never inline: each sits in the shared draggable reason box (ReasonQuote, §237: its own scroll, drags
  taller, OwnPanel when nested) under its line, which is the box's label line (`LabeledReason` in components/ScrollText.tsx). Short notes go in the same box (it
  starts small, the ReasonQuote default); no note, just the line. Long words wrap anywhere, in the line too.
- The tester's session page (each part's and call's payment card, `TesterReview`): "Paid $0 · <when>" (PAID_ZERO_LABEL) with the developer's note; "Paid $X …"
  with the note at Pay; each "Extra $X: you get …" (Pay more) and a $0 update's "… paid $0 more for what you added." with their notes; "Rejected (<when>)";
  "The team closed this for $0 (<when>)" (TEAM_CLOSED_LABEL); "The team decided: $X in all" (teamDecidedLabel; a full stop only with no note) with the
  team's note; "The developer's side" (DEV_SIDE_LABEL). Charge / Let it go have no typed note (their review reason is the app's own words): unchanged.
- The developer's test page, Testers list: a part's "Paid $0 · <when>" and the team's $0 close-out (parts and calls) in the box under the line. Already boxed
  and unchanged: Needs you's dispute rows (the tester's reason), the dashboard's dispute box, the team's dispute rows (the tester's reason, the developer's note
  when paying, the developer's side, the decision note), the admin person and test boxes (dispute reasons, close-out and hold notes). The payment lists show no
  typed notes; Needs you's update rows have none.
- paidZeroLine / teamClosedLine keep their text (built from the labels). Tests: tests/notes-in-boxes-281.test.ts; batch9, batch30-money, batch30-money-fixes and
  batch35-admin-tabs follow the new markup.

## §282 Written answers: all questions in one "Questions (N)" drop-down; every part is a content panel, then a pay panel (owner, Nov 6)
- SentWork's `questionsFold` (`{ open }`): a written part's question folds, and Anything else (the list's fixed last fold), sit inside ONE drop-down
  "Questions (N)" (N: the questions shown, Anything else not counted), its list in the draggable scroll panel (ResizeBox in OwnPanel, as §249's QuestionTexts:
  min(24rem, 55vh) at first, QUESTIONS_LIST_MAX). Each question's drop-down is unchanged inside (the Old tag in Needs you, "· N added", the boxes, attachments,
  §226's new-only parts). The drop-down is a Fold (`<id>-questions`), so its open state is kept per part. Nothing to show (Needs you after paying): no
  drop-down, "Nothing new since you paid." as before.
- Where: Needs you's part and update rows (open at first), the Testers list's written part (closed at first), the team's "See the work" (open at first: the
  fold above it was just opened; its AnswersBox stays for recordings only). Not the tester's own "Your written answers": that is already one drop-down with
  every question in one panel (§182), so a second one inside it would only nest.
- Two panels per part, in Needs you and the Testers list, for written answers, recordings and calls (PART_PANEL, the bordered panel look): first the content
  (the Questions drop-down; the recordings in their panel; a call's length and notes), then right under it, its own panel, the paying (Needs you: the Pay
  drop-down with its box; the Testers list: the part's payments (§225), closed-unpaid, Pay more and its box, at-cap, $0 / team-closed notes, the bank), hidden
  when empty. A written part has no outer panel around the Questions drop-down any more (its own panel is the one that scrolls); a recording's panel is as
  before (flat inside Needs you's person panel, §187). The Testers list's Terms history stays in the content panel, under the Questions drop-down.
- Tests: tests/questions-dropdown-282.test.ts; batch10, batch35-sent-panels, old-questions-263-264 and written-form-234-235 follow the new markup.

## §283 Written answers: only answered current questions everywhere, the new-question tag in the form, every contract follows the questions, and more (owner, Nov 6)
- The "new question" tag (NEW_QUESTION_TAG) moved: never in an answers list (SentWork's `newQuestionTag` prop is gone, the developer never saw it, §255);
  it sits in the tester's form ("Questions you haven't answered yet") beside the words of an unanswered question that came after their sends (not among any
  send's questions, by its words: WrittenForm's `newQs`). Once answered it leaves the form, and the tag with it.
- Every answers list (the tester's "Your written answers", Needs you, the update rows, the Testers list, the team's See the work) lists only answered questions:
  a non-blank answer, or at least one addition, as drawn. An unanswered current question is only its box in the tester's form.
- Questions follow the listing into EVERY contract on the test on a Save (left and ended too, not only working), with the same Terms history entry
  (followQuestions); only the working testers are told in the bell. The NDA text follows into the non-working contracts too, with no notice (followNda).
  Existing data: a non-working contract no Save reached is brought onto the listing's questions when the developer's test page or the tester's session page is
  read (`syncEndedQuestions` in lib/server/terms.ts: followQuestions, its Terms history entry dated then; nothing deleted; an in-line contract costs one
  comparison). A tester who rejoins gets the same entry first, then the listing's questions (the rejoin snapshot). Old answers come back into the lists only
  if their question becomes current again.
- The Testers list's avatars and "Search testers" clear each other: choosing a circle clears the box, typing a name clears the circle (TesterListSearch's
  `searchTyped` / `onCircleChosen`, TesterFilter's `clearTesterFilter`). Needs you has no circles, so its own box is unchanged.
- Anything else counts a changed-questions send ("N added", its "Added · <date>" entry) only when it brought notes or loose files: files no answer of that send
  places with its marker (SetExtra's new `answers`). A file placed in an answer shows there only; the owner's case (a 9-answer send, notes "", one video placed
  in an answer) no longer draws "· 1 added" and an empty dated entry. Every SentWork surface.
- The Testers list: each tester's Terms history drop-down (§263) moved from under the written answers to the very bottom of the tester's drop-down, below all
  their part panels (written answers, recording, calls and their Pay panels).
- The tester's written form never lists ("Files not in an answer …") or sends a file already sent (submissionId set): its files are the unsent uploads only. An
  unsent file placed in a draft answer to a question that changed went with that draft into the Terms history snapshot (§263 / §269): not listed as loose,
  not taken by the next Send; it comes back with the draft if the question becomes current again (`snapshotOnlyFiles` in lib/answerSets.ts, used by the
  session page and the written Send). The owner's case: bb's video, sent in an answer whose question changed, no longer shows under the form.
- Tests: tests/written-answers-283.test.ts; qa-look-254-256 (the tag), batch35-added-per-question(-222), paid-cut-226-227, written-form-234-235,
  old-questions-263-264 and questions-dropdown-282 follow.
## §280 Calls: no booking check against the $1,000; the call still ends itself at the limit (owner, Nov 6)
- Booking is never checked against the $1,000 for all of a tester's calls on a test (batch 15 section 34, batch 18 section 6): Request a time (both sides, a single
  time or a daily / weekly / Forever set), the auto-match, Accept and a Forever set's daily top-up never refuse, skip or cut a call for it. Gone: callsCeilingLine
  ("Calls with Ana on this test can come to at most $1,000; $X is left, so this call can't be booked.") and its red line in the form (callClash), the Length box's
  cap (bookableMinutes, lengthCap, its "10–95 min (the $1,000 for calls with Ana)" hint and "At most 95 minutes: …" line; the box is 10–180 again on both forms),
  the server's lengthOverCap / ceilingRefusal / checkCeiling, and the top-up's "… was skipped: calls on this test can come to at most $1,000." The other limits stay
  (10–180 minutes, 3 calls or requests per tester, 3 sends a day, overlaps, the call window).
- The call room's end stays: a call ends for both when its pay at the call's rate reaches what's left (callCapMinutes / callEndState). Listed: the contract rate
  stored on the call (`rateCents`); unlisted (`rateCents` null): $200/h (UNLISTED_CALL_RATE_CENTS). Both pages say why with the existing line, "Call ended: the
  $1,000 for calls with <other person> on this test is reached.", after the 2-minute "This call ends at 3:42 PM." warning; Join is refused after.
- What's left, for that end only, now counts what's paid plus the unpaid reference of the calls that started BEFORE this one (callsLeftCents' new `before`):
  calls booked after it no longer count, since booking may now pass $1,000 (three 180-minute unlisted calls reserve $1,800, which would have ended the first
  one at once). Pay, Pay more, the dispute range and a listed call's automatic charge are unchanged (they still count every booked call not paid yet).
- Terms of Use, section 4 Calls (folded into version 2: nothing has launched): "… Booking isn't limited by it: a call ends by itself, for both people, when its pay
  at the call's rate ($200 an hour for a call that isn't listed) reaches what's left." DESIGN-DOC's booking lines follow.
- Tests: tests/calls-no-booking-cap-280.test.ts (unlisted daily and weekly 180-minute sets past $1,000 requested and accepted on both sides; a request with $5 left
  booked both ways, then that call ends at 10 minutes for both with the line; an unlisted call ending at $200/h, later calls not counted). batch11, batch15-calls,
  batch16-calls-live, batch18-misc (section 6 reversed) and batch30-money-fixes follow §280; batch18-call-cap's other calls took place before the one in progress.
## §285 Terms history: Then / Now (owner, Nov 6)

- The tester's Terms history: an older offer's "Questions then and now" drop-down labels its two lists "Then" and "Now" (was "Offered"), matching the summary.
  The developer's per-tester copy (§263, QuestionsChangedEntry) already said "Then" / "Now". No other Then / Offered pair is drawn there (the NDA left Terms
  history in §266). Test: tests/batch35-numbers-notes.test.ts.

## §284 Every top-box line opens what it's about, ignored ones too (owner, Nov 6)

- Seen: the tester's top box had "fbbb requested a call for Sat, Nov 21, 1:20 AM" greyed (her Alerts ignore calls); only "fbbb" was a link (§270), the rest
  opened nothing: the tester-side line had no place. Now every line about something with a place on the page opens it (jumps and marks, as other row links
  do). Ignored lines keep their grey and their title; their other words open the row in the line's own colour. §270's name and test links stay.
- The places are the rows' own ids (lib/lineAnchors.ts). Tester side (testerGate's lines, built from the rows at read time, so older changes work too): the
  developer's call request, and it withdrawn, taken or closed: its row in her Call requests box (`req-<id>`), once it has left the box (`requests`, the Live
  session's Requests section; then `call-requests` / `your-requests` / `live`); her own request declined: the same; booked: the call's row; a call cancelled:
  the call's row; a payment, Pay more, a $0 close, a rejection, a delayed payment, the team's decision or the developer's side on a dispute: that part
  (`part-written`, `part-recording`, a call's `call-<id>`); new terms: the new-terms box (§268's pill target; the contract card once decided); the NDA:
  `#info-nda` (§267); her key marked working: the key box; a request dropped by a booking: its row, else the box; her own actions in another tab: what they
  touched. A key given keeps its See it.
- Developer side: a tester's call request (already linked), withdrawn, declined or dropped: its row (the box once it has left); joined, left, rated, switched
  terms, a key reported, a bank reversal: the tester's row in Testers (`tester-<contract>`); an application: its Needs you row (`item-app-<id>`, already
  linked); work sent, a Charge, Let it go, an automatic call charge, a dispute: their part or Needs you row (already linked); a tester booking or cancelling a
  call: the call's row; the team's dispute decision: the part decided; a payment that went through or failed on this test: its part; the developer's own
  actions in another tab: what they touched.
- Stored when the event is recorded (recordEvent / logEvent's `link`: requests, calls, joins, leaving, ratings, keys, terms, decisions); an older event with
  none gets it at read time (lib/server/liveLinks.ts: by kind, contract, and the row changed within a minute of it). Only the kinds that stored a place before
  read their item or part from it: the new places never change what a press stops for.
- Tests: tests/live-line-links-284.test.ts; batch15-gaps follows the jump with fallback.

## §287 Call requests' headings start with "Call" (owner, Nov 6)
"Requests to you" reads "Call requests to you" and "Your requests" reads "Call requests you sent", on the developer's test page and the tester's session page.
## §286 A bell for every update a person's top box can show (owner, Nov 6)
- The owner's rule: every kind of update that can show as a blue top-box line for a person also gives them a bell line (and its summary email, as their email
  setting says), on both sides, in the top box's words, linking to the exact place. Old events get no bells afterwards. The developer's own presses (any tab)
  never ring themselves.
- New tester bells: the developer's call request, one per request (each row of a press is its own), "Nora Lane requested a call for …" linking to its row
  (`/app/sessions/<id>#req-<request>`; an auto-matched row rings "Booked: …" instead); "Nora Lane declined your call request for …"; "The call time with Nora Lane
  on … is no longer available: another tester took it" (closeBatch); "The call time with Nora Lane on … is no longer available" for the developer's requests
  closed for a reason her top box shows, e.g. a pause (`testerSeesClosed` in testerGate.ts; never her own Leave or rating, the stop / end / early end, or §184's
  drops); "Nora Lane added her side to your dispute about …" (to that part); "Nora Lane marked your key as working" (to her key box; never the key, as batch 30
  §17; replaces batch 15 §45's "no bell"); "Nora Lane edited the listing" to each working tester when a Save changed the title or the listing information (to
  "Your agreed scope"; a tester told of the same Save's questions by §265's bell gets only that one); "“Harbor Run” ended" when the test's time runs out
  (finishWorkIfDue, in "Tests stopped or ended").
- New developer bells: "Ana Silva declined a call request for …"; "Ana Silva reported her key doesn't work" (replaces batch 14 §6's "no bell"); "Ana Silva switched
  to the new terms"; "Ana Silva said no thanks to your invite" (to the Invite testers panel); "Ana Silva let her written answers go: nothing charged" (and a
  call's); "Ana Silva's call on … closed with nothing to pay".
- Stacks (owner's addition): call requests on either side (received, withdrawn, declined, taken, closed, §185's drops) are ONE entry a day across tests,
  "Call requests · 3 today" (group "callrequests"; §185's per-test "reqclosed:<test>" stays only for lines already written); booked calls ("Booked: …", both
  sides) likewise, "Booked calls · 2 today" (group "booked"). Both stack in the email too (EMAIL_STACKED). Excerpt lines now stack in "Excerpts" on both sides
  (the developer's "asked to show an excerpt" and the closed-on-deletion line joined the tester's decisions). The developer's side added to a dispute stacks in
  "Sides added to your disputes" (group "disputeside").
- Left out, with the reason: the person's own other-tab actions ("You … in another tab", their own "You requested / booked / withdrew …"); §184's quiet lines
  about the person's own booking (t_req_dropped / req_dropped: their own booking, or the "Booked: …" line that already rang); "X is full" (a consequence of a
  join that rang "joined", or of their own Save; the closed applicants get their own bells); "X can now charge or let go of …" (the developer's daily "Pay now"
  line says it); a rating from a tester whose part had ended (the "You can rate her" bell, when the developer's window opens; ratings stay blind); the
  subscription ending after their own cancel, or the free launch ending (told 30 and 7 days before); the old slot kinds (confirmed / offered / removed: no longer
  written).
- Tests: tests/bell-parity-286.test.ts; call-limit-request-boxes-185 and drop-overlapping-requests follow the one-a-day "Call requests" stack; batch15-keys
  expects the key-marked-working bell.

## §288 A tester's disputes close (owner, Nov 6)

- Before, a tester could open a dispute at any time. Now their disputes close in two cases:
  1. When they rate the test (rating ends their part). After that, no new dispute on any of their parts on that test. That includes a payment the developer makes
     after the rating; there's no exception. Refusal: "You rated this test, so its disputes are closed." (rules.ts RATED_NO_DISPUTE).
  2. At the part's closing date (closeOut.ts pieceCloseOut, tester side: the same date its Charge, Let it go and Pay end). Refusal: "This part closed on
     <date>, so it can't be disputed any more." (disputeClosedLine).
- One place decides it: closeOut.ts disputesClosed / disputeClosedFor. canDispute takes it as `closedLine`. The order is the tester's own Charge or Let it go,
  then an existing dispute ("You already disputed this payment"), then closed, then nothing left to award.
- openDispute decides "closed" first: before the open-terms block and before the payment stop-once. A press from an older page gets the one refusal, never a
  stop-once whose second press could only be refused (§159). It checks again under the lock, so a Rate in another tab closes it too.
- Session page: on a closed part, the "Dispute the pay" form is gone. In its place is the greyed button with the line (`data-dispute-closed`). The paused
  banner and the work-over line no longer list "dispute" for it. The Rate pop-up adds "Rating also closes your disputes on this test: …".
- A dispute that's already open stays open: the developer can still add their side, and the team can still decide it.
- Lines that told someone a dispute was possible say nothing about disputing once it's closed:
  - The developer's line under Pay (payUnderLine) for a tester who rated: a listed part shows no line; an unlisted part keeps "pay any amount, $0 included".
  - The tester's Charge refusal "… paid $6.00 for this meanwhile." drops ": you can dispute it …" (paidMeanwhileLine).
  - The Terms of Use's "Paying for work" says when disputes close.
- Tests: tests/dispute-closes-288.test.ts. Updated: ratings (Dispute after rating is now refused), batch17-rate (the developer's Rate disabled by a dispute still
  open, created directly), batch17-close-out (wording), batch10 and batch20 (sources).

## §289 Needs you: Questions without its own scroll (owner, Nov 6)

- In Needs you (a part's row and an update row), the "Questions (N)" list (§282) is a plain drop-down with no ResizeBox, so the person's panel is the only
  scroll (§187). Each question's and answer's own box keeps its scroll, as before (QA.tsx). The Testers list and the team's "See the work" keep the
  draggable scroll panel. SentWork's `questionsFold.ownScroll: false`.
- Tests: tests/needs-questions-289.test.ts; questions-dropdown-282 follows.

## §290 Three wording fixes from the Nov 6 recordings (owner, Nov 6)
- The bell stacks counting lines no longer say "today" themselves: the bell page adds the day ("today" / "on Nov 5"), so "Booked calls · 2 today today" reads
  "Booked calls · 2 today" (also Call requests, Direct messages, Call requests closed, Applications withdrawn). The summary email reads "• Call requests · 4".
- A "Booked:" bell names who the call is with: "Booked: a call with Ana Silva, Wed, Nov 11, 4:00 PM" / "Booked: a call with Omar Reyes: you both picked …".
- The tester's stop boxes (Send Answers, Add, Leave, Dispute) always name their press: "Your Send Answers didn't go through." (it could read "Your press …").

## §291 Booked: its own section at the bottom of the Live session (owner, Nov 6)
- The developer's test page: the booked calls leave the per-tester cards under the request form. They are now the Live session's LAST section, "Booked (N)"
  (N: every booked call ahead or running, each call of a set too; "Booked (0)" with "No calls booked yet." while calls can be requested).
- Under the heading, the draggable scroll panel (`testers-calls-<testId>`, OwnPanel: its own scroll). Inside it, one drop-down per tester with a call (HoldFold
  `booked-person-<contractId>`): the green name, then "· N calls"; testers by their soonest call. Closed at first, open while one of their calls can be joined; a
  link to `#call-<id>` opens it (the §284 anchors stay the jump target); a Cancel under way or its stop box keeps it open.
- Each drop-down holds that tester's calls and daily / weekly sets soonest first, in a scroll box of its own (`booked-<contractId>`, OwnPanel). Every row keeps
  Join call, Add to calendar, Cancel and its Why, Report a problem, Check your call setup and its `call-<id>` anchor. As in §187 item 5, the rows don't repeat the
  name (it's on the drop-down); the Cancel rule still names who is told.
- The tester's session page: "Booked (N)" moves to the bottom of the Live session, under Had / Cancelled and the Requests, in its scroll panel (`booked-<session>`,
  OwnPanel), calls and sets soonest first. No per-name drop-down (one developer).
- Tests: tests/booked-section-291.test.ts. Updated: calls-had-cancelled-209 (the order; the one "Booked (" is the Live session's), batch35-list-panels,
  layout-fixes-187, batch35-green-names, batch35-answering-press (the name is on the drop-down).

## §292 No call request at a time the other person already has booked (owner, Nov 6)
- Seen: Dee Moss's call with fbbb was booked for Wed, Nov 11, 12:00 PM; tester bb could still send fbbb a request for 12:03 PM, and fbbb's Accept was then refused.
- Now a request can't be SENT for a time overlapping a call the RECIPIENT already has booked with someone else, on this test or any other (requests.ts
  recipientBusyClash, the overlap Accept uses). Both directions: a tester to the developer (testerRequestTime), the developer to a tester (devRequestTime: with
  several ticked, that tester is left out after the usual stop, the others go).
- The refusal names the time, never who that call is with: "fbbb already has a call booked at Wed, Nov 11, 12:00 PM: pick another time." (callClash.ts busyLine).
  A daily / weekly row is refused for its clashing call: "The 2nd call (Wed, Nov 11): fbbb already has a call booked at …".
- The form shows the same line red at the row (clashNotes, a target's `busy`). The pages pass bare time ranges only (`busyTimes`: start and length, no names): the
  tester's page the developer's calls with other testers, the developer's page each tester's calls elsewhere.
- Requests already waiting when a call is booked are still dropped (§184 / §185).
- Tests: tests/no-clash-requests-292.test.ts.

## §293 Cancel's reason field says it's optional until 24 hours before (owner, Nov 6)
Under the Why field of a call's Cancel (both sides, a set's "Cancel the remaining calls" too), in small grey: "Optional until 24 hours before the call", while
the call is 24 hours or more away. Within 24 hours the field is required as before (no hint). The rule itself is unchanged (cancel any time until it starts).

## §294 Chargeback emails go out at once, every one (owner, Nov 6)
- Every chargeback the developer gets is now emailed at once, whatever their email setting (`always: true`, as the admins' "Playtest: new chargeback of $X"
  email already was):
  - the one that starts the hold ("Your tests are paused after a chargeback", unchanged);
  - the one that turns a payment hold into a chargeback hold ("Your bank reversed …: your payment hold is now a chargeback hold", unchanged);
  - a further one during a chargeback hold ("Your bank reversed …: it was added to what you owe"): before, a bell line only. Its email adds "To resume: verify a
    card with 3D Secure, pay what you owe, and wait for the team's approval." (the new chargeback clears the card check and approval);
  - the bank changing its amount after the repayment (§192's "Your bank lowered what it took back …" / "Your bank raised what it took back …"): before, payment
    lines in the end-of-day payment email only.
- The bell is unchanged: the hold lines and the chargeback lines stay in the day's "Payments and holds" (`payhold`) entry; the lowered / raised lines stay their
  own entries. No new stacks (an earlier draft of §294 with "Chargebacks" and "Payments declined" stacks was dropped by the owner).
- Unchanged: a won chargeback's line (payhold, the end-of-day payment email); a decline during a hold, "Another payment was declined: $X for … was added to what
  you owe" (payhold, bell and the end-of-day payment email); the admins' chargeback emails.
- Tests: tests/chargeback-emails-294.test.ts. Updated: batch18 (the list of emails that ignore Off: two more in holds.ts).

### §294, second decision: sent immediately; the amount changing before the repayment is told too (owner, Nov 6)
- **Immediately, not at the end of the day.** `always` alone only puts a line in the end-of-day email (whatever the setting). Every chargeback email to the
  developer above (the one that starts the hold, a payment hold turning into a chargeback hold, a further one during a chargeback hold, lowered, raised, and the
  new line below) is now sent at once through `sendEmail`, the path the admins' chargeback emails take. It's a new `now` option of `notify` (notify.ts): the bell
  line is written as usual and marked already emailed (`summarizedAt`), then the email (the line, its lines, the link, "Open Playtest") is sent to that one
  person. The summary and the end-of-day email never repeat it. A failed send waits for the email sweep as every email does.
- **The bank changing a chargeback's amount BEFORE the repayment** (§192's "followed": what is owed changes) now tells the developer, in the words Pay what
  you owe's stop already uses for it (`bankChangedLine`): "Your bank changed the amount it took back from your $40.00 payment for Ana Silva's written answers on
  “Harbor Run”: $40.00 → $25.00 (now $25.00 + $15.00 fee = $40.00)". A Pay what you owe payment is named with its items (§193b). A bell line in the day's
  `payhold` entry, linking to the chargeback steps (`/app/payments#chargeback-steps`; Pay what you owe's `#owed` outside a chargeback hold), and an immediate
  email ("Open Payments to see what you owe."). Each change is its own line from the last followed amount; the same amount again says nothing. A change that
  waited for a repayment in progress (§192) and is then followed in what is owed (the repayment didn't go through) is told the same way.
- Unchanged: the bell entries; a won chargeback (end-of-day payment email); declined payments (wording and email rule); the admins' emails.
- Tests: tests/chargeback-emails-294.test.ts (each email is in the outbox right after the event and the summary doesn't repeat it; the before-repayment change
  rings in payhold and emails; a decline is still not sent immediately). Updated: batch18 (one more in holds.ts).

## §295 Emails and bells: pauses for testers, additions, summary heading, deadline reminders, amount changes at end of day (owner, Nov 6)
From the Nov 6 recording of every email and bell (playtest-lite-evidence/emails-nov6).
- **Testers are told when a test pauses.** Every working tester of each test that pauses reads "“Harbor Run” is paused" (bell; email "“Harbor Run” is paused.
  Your deadline moves on by the pause once it runs again."), at the moment the pause starts, whatever the cause: the team's pause of the test, the developer's
  payment or chargeback hold, the developer's suspension. Never why (`tellTestersPaused`, holds.ts). The mirror of "running again": a test another cause was
  already pausing says nothing (one clock, batch 9), as "running again" says nothing while another cause still pauses it. Not `always`: it follows the tester's
  email setting. "Paused" and "running again" are one tester stack, "Pauses · N" (group `paused`, counting lines; one entry a day across tests, the bell page adds
  the day), and stack the same way in the email (EMAIL_STACKED).
- **Point 2 (stale reminders) was dropped by the owner**: reminders stay in the summary and the bell as they are, a log of what happened.
- **An addition reads as one.** The tester's own line for an addition is "You added to your answer to “<question, cut at 80>” on “Harbor Run”", "You added to
  your notes on “Harbor Run”" (Anything else), "You added to your written answers on …" (no question), "You added a recording on …" (`youAddedLine`); it was
  "Work sent: your written answers for …" again. A first send keeps "Work sent: …". The developer's "Ana Silva added to her answer to …" was already right.
- **Summary emails open with a heading** (the body's first line, larger and bold in the HTML), above the sections or the lines, in the account's time zone, from
  the email's real window (the last summary, or its oldest line, to now): Daily and every end-of-day email (email Off; a Weekly / Monthly account's payment lines)
  "Your Playtest updates for Fri, Nov 6"; Weekly "Your Playtest updates for Nov 1 – Nov 7"; Monthly "Your Playtest updates for October" when it covers exactly
  one calendar month (the 1st to its last day, or to the next month's 1st), else its days as Weekly's (`summaryHeading`, notify.ts).
- **Tester deadline reminders.** Cause: a tester's deadline marks (deadlineMarksFor) left out every mark within 24 hours of joining, the 1-day mark too, so a
  tester whose deadline was within a day of joining (the recording: Ana joined minutes before, deadline 20 hours away; or 1 tester day) got no reminder at all,
  while the developer's Open until heads-up has no such rule. The 1-day mark is now always kept. Also: after a deadline moved (a pause moves it to the end of a
  later day), the daily job's first look at the new deadline recorded every passed mark without sending, so a 1-day mark that came due between the move and that
  run was swallowed: now the latest passed mark is sent unless that mark was already sent for an earlier deadline of hers. Exactly one line (`deadlines`,
  `always`), in the bell and the summary.
- **A chargeback's amount changing goes in the end-of-day email** (`always`, no longer `now`): before the repayment ("Your bank changed the amount it took back
  …") and after it ("Your bank lowered / raised what it took back …"). Still immediate: the chargeback that starts the hold, and a further chargeback during a
  hold (including a payment hold turning into a chargeback hold).
- Tests: tests/email-fixes-295.test.ts. Updated: chargeback-emails-294 (the amount changes are end-of-day).

## §296 Ratings in the Invite testers panel show from 5; below that a tester is unrated and treated alike (owner, Nov 6)
Narrowed by the owner the same day: only the developer's Invite testers panel.
- **In the panel** (People you've worked with, Suggested, Find testers, the Invited rows, the Invite anyway box and a press's redraw of the rows), a tester with
  fewer than 5 revealed tester-side ratings (side "developer": a developer rated them) reads exactly as one with none: "No ratings yet", no stars, no average,
  no count, and no "rating went from …" line about them. No new text. One constant, `RATINGS_SHOWN_FROM` (ratings.ts); `inviteRatingSummary` is
  `ratingSummary(id, "tester")` as the panel shows it; `testerRowInfo(…, { invitePanel: true })` for the panel's rows.
- **Ranking** (rankedTesters, Suggested and Find testers): RATED now means at least 5 such ratings. Unrated testers are treated alike: their score never orders
  them among themselves. Order: meets, rated first, (rated only) score, accepted parts (experience), matches (fit). The score's formula (the platform average)
  is unchanged.
- **Unchanged**: profile tiles, hovers, Find tests' "by <dev> · ★", the join page, the dashboard Rating tile, the application rows in Needs you (and their
  stop lines): ratings from the first one, as before; a person's own ratings on their own page; the team's view; the rating rules (blind until both rate, 14
  days). The developer's own rating of a tester ("you rated", People you've worked with's order) is theirs and stays.
- Tests: tests/ratings-from-five-296.test.ts. Updated: invite-rank-276 (the rated tester has 5 ratings), codex5-needs-stops (Invite and Cancel invite compare
  the panel's rows; the rating moves use 5 or more ratings).

## §297 The summary heading's range starts the day after the last summary (owner, Nov 6)
- The heading's range (§295) starts the calendar day AFTER the last summary was sent, in the account's time zone: last sent Oct 31, the weekly email reads "Your
  Playtest updates for Nov 1 – Nov 7" (was "Oct 31 – Nov 7"); monthly, last sent Sep 30, "… for October" when the window is that month (to Oct 31, or to Nov 1
  when the daily job sends it that morning). Daily keeps "for Fri, Nov 6". With no earlier summary it starts at the oldest line's day, as before
  (`summaryHeading(…, afterLast)`, notify.ts).
- Tests: tests/summary-heading-297.test.ts. Updated: email-fixes-295 (the sent weekly heading starts the day after its last summary).

## §298 Emails stack exactly as the bell does; testers' pause lines reach them with email Off (owner, Nov 6)
- **Every bell stack also stacks in the email**, the same way. One grouping function, `bellStacks` (lib/bell.ts), now drives both the Notifications page and
  the summary / end-of-day emails (`emailLines`, notify.ts), so they can't drift apart: the same key (`own` lines alone; a `groupKey` across tests; else the
  same test), one stack per day in the account's zone, the same titles. A stack of 2+ lines is one heading line, the bell's title without its day ("Disputes
  filed · 2 updates", "Disputes · 3 new", "Harbor Run · 4 updates"; `stackHeading`, which BellList uses too), with its lines under it; a line alone in the bell
  (own, or a single line) stays a single line. `EMAIL_STACKED` is gone. The "Your account" / "As a developer" / "As a tester" sections stay, each stacked.
  Per-test stack titles come from `testTitlesOf` (notify.ts), shared with the page.
- **Testers' "“X” is paused" and "“X” is running again" go out even with email Off** (`always: true`, the end-of-day email), like the developer's hold and
  pause lines; still in the "Pauses · N" stack, still never saying why (holds.ts, restrictions.ts).
- Tests: tests/email-stacks-298.test.ts. Updated: email-fixes-295 (the pause lines are `mustEmail`; with Off they reach the end-of-day email), batch18 (the
  always list: two more in holds.ts, two more in restrictions.ts), paid-stack-201 and nov5-batch2 (emailLines takes whole lines; EMAIL_STACKED removed),
  bell-parity-286.

## §299 Pay more on finished tests reaches the tester; the 15-minute call reminder at once; the team's lift like its pause; Contact us to every admin (owner, Nov 6)
From the email catalog (playtest-lite-evidence/email-catalog-nov6), four of its findings.
- **Payment lines always reach.** The bell-reach rule (`inReach`, notify.ts: a line `about` a counterpart arrives only while a test between them is open) no
  longer applies to payment lines (`payment: true`), in notify() and bell() alike. So "Nora Lane paid you $5.00 more …" and "… paid $0 more …" (payments.ts,
  the only tester payment lines that carried `about`) reach the tester, bell and email, on a stopped or closed test too. Other lines keep the rule.
- **The 15-minute call reminder is emailed at once** (calls.ts, notify's `now`, §294), to both people, so it arrives before the call. The bell line stays and
  is written as already emailed, so no summary repeats it. It is not `always`: with email Off, only the bell line (`now` without `always` or `payment` now
  follows the email setting; the chargeback lines, `always`, are unchanged).
- **The team lifting its pause and moving a paused test's closing date are `always`**, in the pause's "Payments and holds" stack (were own lines that followed
  the email setting). The lift's email text says "it is running again" only when nothing else pauses the test; with the developer's hold or suspension still
  on, "it stays paused until you pay what you owe / your account is cleared". Kept: one "Your tests are running again" per hold or suspension lift (not per
  test); a team-paused test stays paused when a hold lifts and its testers hear nothing; STILL_SUSPENDED_LINE while a suspension is on; never a second
  "running again" for one moment.
- **Contact us and the team's chargeback emails go to every admin account** (`teamEmails`, notify.ts): every admin account's confirmed email (adminUsers(): not
  deleted, not suspended), plus every ADMIN_EMAILS address (kept, so nothing set on a deploy is lost), each address once in any case. The team@playtest.local
  placeholder is gone: with neither, nothing is emailed and it is logged (Contact us messages stay in the admin console's list).
- Stale comments fixed: holds.ts (the admin email follows each admin's setting; the Open until heads-ups are in the summary; closeRequests rings the tester's
  bell), notify.ts's bell() description, and "the longer text is emailed" in calls.ts, restrictions.ts and payments.ts (it is emailed only to an address with
  no account).
- Tests: tests/email-catalog-fixes-299.test.ts. Updated: batch18 (the always list: one more in restrictions.ts, one more in pauseClosure.ts), bell-admin (the
  lift and the moved date are `always` in "Payments and holds", no longer own lines).

## §300 A cancelled call's time names its day (owner, Nov 6)
"Cancelled (N)"'s badge read "Cancelled by fbbb · 8:48 AM" whatever the day. It now shows the time alone when the cancel was today, and the date and time on any other
day ("Cancelled by fbbb · Fri, Nov 6, 8:48 AM"), in the viewer's timezone (`fmtWhen` on the test page and the session page).

## §301 The Testers list: payments in a Payments (N) drop-down under the part; Pay more its own drop-down (owner, Nov 6)
The owner: the payments weren't under Written answers, and Pay more had no drop-down of its own. Each part in a tester's drop-down (written answers, a
recording, each call in Had / Cancelled) now reads, top to bottom:
- **its heading line**, as before ("Written answers · Required · Updated … · paid $X of $Y"; a call's time and badge);
- **"Payments (N)"**, right under the heading and above the content (owner's correction, Nov 6): the part's payments list (§225, §152) in a drop-down, N its
  lines, closed at first, kept per part (Fold's keptFold, `row-pays-<id>`); its list keeps the draggable panel above 4 lines. It replaces the plain "Payments
  for this part" label, and is left out when there are no payments (PartPayments).
- **the content panel**: a written part's "Questions (N)", a recording's recordings, a call's length and notes (as §282);
- **a separate "Pay more" drop-down** ("Pay" before anything was paid on the part) right under the content (`payFold`, page.tsx): closed at first, kept per part
  (`row-pay-<id>`), opened by a jump into it (markJump's jumpTo opens every fold above its target) and, as §139, by a link to its part. Inside: the Pay more box
  (its plain "Pay more" heading is now the summary) and the lines that sat with it: closed unpaid, at its cap (with the "updated at its cap" badge), paid $0
  and closed by the team (their reason boxes), and a call's "Pay it in Needs you ↑". With nothing inside, no drop-down.
- **The bank line on the summary.** "Confirm with your bank in Needs you ↑" (a charge waiting for the bank) must be seen without opening the drop-down, so it
  sits on its summary line; while the box itself is greyed for a check (bankWaits) and there is no such link, the summary says "· waiting for your bank". A
  waiting charge on a part with nothing else to pay keeps the link alone under the content, without a drop-down.
- **Needs you** already had content first, then the Pay drop-down (§282), and shows no payments (§225): unchanged.
- **The "Calls: …" line under Chat is gone** ("Calls: 3 cancelled", also "N booked ahead" and "N done"): the Live call part's "N done" and Had (N) /
  Cancelled (N) say it, and the calls ahead are in the Live session (§209). It was the only line there repeating a part (the paid line went with §195).
- Kept: §187's nesting, the anchors (piece-, part-, call-), Pay's behaviour, stop-once and the bank checks. Fold takes `data` (data-part-panel="pay").
- Tests: tests/pay-panels-301.test.ts. Updated: questions-dropdown-282 (the Testers list's payments above the content; the call's payFold; four pay panels in
  the source), nov5-batch2 (§225's PartPayments line), batch35-tester-folds (no calls line in the summary), batch17-bank-check and needs-kind-folds-199 (the
  link up on the Pay more drop-down's summary), written-answers-283 (no empty pay panel after the content).

## §305 A local testing switch for the limits (owner, Nov 6)
`NEXT_PUBLIC_TESTING_NO_LIMITS=1` in a LOCAL .env lifts the 3 changes per limited field after testers join, the 3 calls or waiting requests per tester and the
3 call requests a day (src/lib/testingLimits.ts `limitOr`). Ignored on Vercel (VERCEL=1). Without it every limit is unchanged.

## §306 One daily email per admin, with a "For the team" section (owner, Nov 6)
An admin on Daily got two emails a day with the same items: the team's admin email ("Playtest admin: N items for the team", adminDaily.ts) and their own
summary, whose "Disputes · N new" and "Hold lifts waiting" bell lines repeated its disputes and lifts (email catalog, note 13). Now each admin gets ONE email:
- **Their own updates first** (stacked as the bell, §298), then a **"For the team"** section holding exactly what the admin email held: new disputes since
  the last one, hold lifts and chargeback holds waiting for an Approve, call reports (once), the accounts this admin suspended and the tests this admin paused,
  with closing dates. Subject "Your Playtest summary: 2 updates, 3 items for the team" (either part alone); with the section, the button is "Open the admin
  console". sendSummaries (notify.ts) sends it; adminDaily.ts only builds the section (`teamSections`, `teamSent`); the daily job no longer sends a separate
  admin email.
- **No repeats.** A dispute or hold lift listed in "For the team" is left out of that email's own lines; its bell line stays in the bell and is marked as
  emailed (no later email repeats it). A dispute bell line whose dispute is no longer in the section (decided since) stays among the own lines.
- **The email setting, as the admin email did:** Daily / Weekly / Monthly carry the section when that summary is due, with everything since this admin's last
  section (the same `adminDaily:<id>` mark); a due admin with nothing anywhere gets no email (the mark still moves on, as before). **Off: no section**, as the
  admin email sent nothing with Off; the Off end-of-day email (payment and must-send lines) is unchanged. A Weekly / Monthly admin's short end-of-day email
  (forced lines only) has no section, as the admin email went only when due. The team's items still always reach the team: every admin's bell and the console
  show them, and every admin on Daily / Weekly / Monthly gets them by email. The chargeback email to every admin at once is unchanged.
- **Non-admins unchanged.** Checked in the code: sendSummaries is the only end-of-day email to an account, ONE per account per run, and every line it sends is
  marked `summarizedAt` (only unmarked lines are read). Testers and developers on Daily get one email whose lines include the forced ones (`always` /
  `payment`). Off: one end-of-day email with only the forced lines. Weekly / Monthly: on other days a short end-of-day email with only the forced lines,
  which are marked and so not repeated in the weekly / monthly. `now` lines (§294, §299) are written already marked.
- Tests: tests/admin-one-email-306.test.ts. Updated: batch3, batch29-bell, schedule and batch30-emails (they find the admin's items by the "For the team"
  section instead of the "Playtest admin:" subject; adminDaily.ts no longer calls sendEmail).
