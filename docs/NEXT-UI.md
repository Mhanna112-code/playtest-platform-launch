# Queued UI work (owner, Oct 23) - do in this order

Rule for all of it: match the full app (integration folder, localhost:3200) exactly; keep lean behaviour (LEAN-SPEC.md);
add nothing the owner didn't ask for; list any non-exact pattern for approval.

0. [DONE] EVERY input with a min and/or max (call length 10-180 min, rates $10-$200/h, prices, spots up to the tester limit,
   repeat counts 2-8, comment lengths, Ask $, Charge amount up to the cap, etc.) shows its range briefly next to it
   ("10-180 min", "up to $14.00"), and shows the red error AS SOON AS the field loses focus with a bad value (and on
   submit), not only after pressing the button. Clears when fixed.
   DATES/TIMES too: every date or time box (call request times, Open until, Charge/other deadlines) refuses the past:
   the picker's min is set to now (+5 min for calls) and a past or too-soon value is RED AT THE FIELD on blur and on
   submit ("Pick a time in the future."), never only a message under the button. VERIFY EACH FIELD IN THE BROWSER
   (type a bad value, click away, see red; fix it, see it clear) and list every field checked in the report.
1. [DONE 6fcfbd9] Remove the "Reports reviewed" developer tile and its footnote sentence.
2. [DONE] Testers joined near the top of the developer test page: Seats avatar circles with hover/tap profile cards
   (rating, accepted parts, profile link, Block inside), "N spots still open / All spots are filled", "Change in Edit",
   "No longer working (N)" fold.
3. [DONE] Invite panel: Find testers search results must be ticked to invite (nothing auto-ticked; greyed rows untickable;
   ticks survive search changes; count by Invite; "Tick at least one tester." red if none). Rows in the full app's
   format (amber "Doesn't list X" pill; "you rated 5.0/5 · 1 test with you"). Verify the Invite anyway box in the
   browser exactly per LEAN-SPEC.
4. Group C controls: End early ticks + confirm popup; Stop the test confirm popup; Cancel dropdown; Chat as its own page
   with unread badge; Block in the hover card; Leave in its own "Can't finish?" card.
4b. Join anyway / Apply anyway: use the full app's popup and its behaviour
   (integration src/app/playtests/[id]/claim-form.tsx), replacing the lean in-page warning; lists every unmet need
   (devices and languages), same lean rules (warn, never refuse).
5. Join page (listing), dashboard and Find tests formatted EXACTLY like the full app's equivalents
   (app/playtests/[id], app/dev/page.tsx + app/tester/page.tsx, app/playtests/page.tsx).
6. Developer/tester side switch like the full app (header switch, per-side nav/dashboard/pages, /switch links) -
   owner to confirm.
7. CALL REQUEST FORM (owner, final):
   - Remove the "Choose one / Daily / Weekly" radios. Each time row has its own "Once / Daily / Weekly" picker (Once
     default) and, when it repeats, a calls dropdown: 2-8 and "Forever" at the bottom. Up to 3 rows; with more than
     one row the other side picks ONE (a repeating pick books the whole set). Length and Ask $/h stay per request.
   - Forever = until the set is cancelled or the tester's part ends (leave / rate / ended / test stopped). Book the
     next 4 ahead; the daily job adds the next as each passes (clash-checked; a clashing one is skipped and both told).
     A set (counted or forever) counts as 1 of the 3 booked times.
   - Booked set line: "Weekly · Mon 3:00 PM (3 left)" or, for Forever, just "Weekly · Mon 3:00 PM". Short text under
     it: "Cancel to stop the remaining calls." CANCEL on the set line is the only way to stop it: it cancels all its
     future calls (reason required if the next one is within 24 h). No separate "Stop repeating" button.
8. [DONE] INVITED list (owner): show ONLY invites still waiting (joined people are already in Testers joined; drop "· joined"
   rows; closed/declined invites aren't listed). When long it becomes a scroll box like the full app's invite lists
   (about 5 rows tall, then scroll).
9. [DONE] POST/EDIT "Parts and prices" exactly like the full app's block (integration src/app/dev/test-form.tsx): one card per
   part (Written report / Recorded session / Live session) with its tick, title, one-line description, price box
   ("$ 7.50", live "up to $ 25 /h"), and "Free" tick; ticked cards highlighted. INCLUDE the "Required" tick (owner, Oct 23):
   it is a LABEL only (no new blocking): it's part of the terms (snapshotted at join; changing it is a terms change
   like prices: offer to working testers / closes applications), shown to the developer under Testers per tester as
   which required and not-required parts are sent (full app's pattern), and to the tester in "Your parts" as
   "Required" / "Not required" (full app's pattern). Rating rule unchanged; the rating warning's unsent-parts line
   marks required ones "(required)". No part requests/extra parts/drops. Range hints and red-on-blur per item 0.
10. KEPT FORMS (owner chose b): typed-but-unsent text is saved (server-side, per user and form, any device) and comes
   back after reload / sign-in with the full app's "Not sent yet" tag, as in the full app (integration
   components/use-kept-form + change-lock). ONLY on: written answers, chat messages, dispute text, rating comments,
   reject reasons, and the Post/Edit form. NOT on login/sign-up. Sending clears it.
11. TESTER SESSION PAGE exactly like the full app's (integration src/app/tester/claims/[id]/page.tsx), lean behaviour:
   - "Your parts" card (full app :686-716) showing, per part (written / recording / live calls): Required / Not required, sent or not sent yet,
     "You asked $X" if they asked, and "Paid so far $Y" (plus the listing price / "Not in your contract").
   - Every other section in the full app's layout and order; the live-call area is the lean "Live session" panel
     (same component as the developer side). Nothing the lean app doesn't do.
12. [DONE] STOP RULE FIX (owner, high priority, do right after item 0): the second press goes ahead ONLY if nothing new
   happened since its stop box last updated (send the box's newest line time; anything newer stops again with the new
   lines added). Applies to every button EXCEPT the tester's Leave and Block, which still stop only once. Tests.
13. NOTICE IN VIEW (owner): when a stop box or refusal appears after a press, scroll just enough to bring the button and
   its notice into view (block "nearest"); never jump to the top box because of a press.
14. INVITE PANEL labels: a tester who left this test shows "Left this test", one you ended shows "You ended their work",
   to the right of their name (still tickable: a re-invite is how an ended tester can come back).
12b. Finish item 12's gaps: the "What's missing changed" stop inside the Invite anyway box, the owed-total check
   behind "Pay what you owe", and the call-request limit confirm must also stop again for anything newer.
