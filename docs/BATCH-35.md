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
