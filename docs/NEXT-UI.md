# Queued UI work (owner, Oct 23) - do in this order

Rule for all of it: match the full app (integration folder, localhost:3200) exactly; keep lean behaviour (LEAN-SPEC.md);
add nothing the owner didn't ask for; list any non-exact pattern for approval.

0. EVERY input with a min and/or max (call length 10-180 min, rates $10-$200/h, prices, spots up to the tester limit,
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
