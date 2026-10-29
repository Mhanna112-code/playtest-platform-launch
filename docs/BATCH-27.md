# Batch 27: answer new terms before sending or calls (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 26.

## 1. An open new-terms offer blocks Send and calls until the tester answers it
Today a new-terms offer stops the tester's next press once ("<dev> offered new terms: <changes>", "Press again to send under your current terms, or switch first.") and the second press goes through under their current terms. Replace that, for these presses only:
- **Blocked while an offer is open:** Send my answers / Send my updated answers, Send my recording / updated recording, and every call press (Request a time, Accept, Decline, Withdraw, Cancel call, Join call).
- **On press:** nothing happens to the work or call; the page scrolls up to the Switch / Keep box, highlighted for a few seconds, and a blue line under the pressed button says "Answer the new terms first: Switch or Keep." Every further press does the same until the tester answers (no second press gets through). The server refuses the same way ("Answer the new terms first: Switch or Keep."), also for an old page that hasn't seen the offer yet.
- **Answering:** Switch or Keep both unlock (Keep stays on the old terms). After answering, the presses work as usual (Switch keeps today's "Switching means answering the new questions: send your updated answers." rule).
- **Not blocked by an offer** (they keep today's stop-once): Charge, Let it go, Dispute, Rate, Leave, Block, Alerts, chat, drafts' Save, attachments and Record (recording to a draft isn't sending).
- With Alerts Off the block still applies (an offer is about the tester's own contract).
- A developer withdrawing / replacing the offer (a newer Save) keeps it blocked until the newest offer is answered; an offer that closes (test stopped, their work ended) unblocks.
- Tests: each blocked press refused with the line and scrolls to the offer; second press still refused; Keep and Switch both unlock; Charge / Dispute / Leave not blocked; old page refused on the server.

## 2. "Go to the next round" stops once too (owner, Oct 29)
Once a test has its next-round draft, the button "Go to the next round" (TopPanel.tsx ~97) is a plain link, so it never stops. Make it a press that runs the developer's stop-once gate first (same changes and Alerts types as Next round): any change on this test the page hasn't shown (a tester sent or updated work, left, a call change, a payment…) stops it once in the blue box under the button; the second press opens the draft. On a stopped, closed or paused test it opens at once, as other presses there. Tests: updated answers after the page loaded → first press stops with "fbbb updated their written answers", second opens the draft; nothing new → opens at once.

## 3. Files placed at the cursor in written answers (owner, Oct 29; brings back batch 16 §34 before launch)
Each answer box's toolbar (B, I, </>) gets 📎 (attach a file) and ⏺ (record the screen). The file or recording is placed in the answer where the cursor is, so the answer reads in order ("the map breaks here: [screenshot] then …").
- **📎** opens the file picker; ⏺ starts the same screen recorder as today's Record (with the microphone tick). While uploading, a placeholder "Uploading map.png… 40%" sits at the cursor; when done it becomes the attachment.
- **In the answer:** images show as a thumbnail (click opens full size), videos as a small player, other files (PDF, text, zip) as a chip with the name and size. Each has × to remove it from the answer (and from the uploads if it isn't used anywhere else). Moving text around keeps them in place (they're tokens in the answer text, e.g. a marker the renderer turns into the attachment).
- **Limits stay the same, counted across the whole written part:** 5 files of 25 MB (images, PDF, plain text, zip) and 5 recordings (500 MB each). Over a limit: refused at the button with the usual red line.
- **The "Files and recordings" box stays** under the answers, listing everything attached, with each item's place ("in your answer to “aaaa”" or "not in an answer"), and its Add file / Record for files that don't belong to one question.
- **Developer and admin views** (the piece view, By question, previous question sets, admin "See the work", the email) render the attachments in place, same thumbnails / players / chips, downloadable. The 50,000-character counter doesn't count the markers.
- **Drafts and Send:** unchanged rules (a draft keeps its placed files; Send waits while one is uploading; Send waits until something changed, batch 19). An updated answer that removes a file no longer shows it in that answer; the earlier sent set keeps its own.
- **Excerpts** quote text only; an excerpt that crosses a placed file shows "[file]".
- Phones: the toolbar wraps; thumbnails full width.
- Tests: placing a file and a recording mid-answer, removing one, the limits, the developer's view in order, drafts keep them, excerpts skip them, old answers (with the box only) still show as today.

## 4. The update pill, always, pointing at the updates (owner, Oct 29; replaces batch 15 §28's first-update scroll)
- **No automatic scroll any more.** Every live update that arrives while its box is out of view raises the pill ("1 new update", counting up), whether or not anything is being typed. Pressing the pill scrolls to the updates and the pill goes; it also goes once the box comes into view. Nothing moves on its own. (Applies to every page with the live box: developer test page, Edit, tester session page, join page, dashboards.)
- **The arrow points where the updates are:** "↑" when they're above the screen, "↓" when below. On Edit the updates also show under the Save button, so when that spot is below the screen the pill reads "1 new update ↓" and scrolls down to it.
- The flash on the new line stays. Reduced motion: a jump, no animation.
- Tests: an update with nothing focused raises the pill (no scroll); typing too; the arrow ↑ / ↓ by position; pressing it scrolls there and clears it; scrolling the box into view clears it.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
