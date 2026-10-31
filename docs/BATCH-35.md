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
