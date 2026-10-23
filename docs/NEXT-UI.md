# Queued UI work (owner, Oct 23) - do in this order

Rule for all of it: match the full app (integration folder, localhost:3200) exactly; keep lean behaviour (LEAN-SPEC.md);
add nothing the owner didn't ask for; list any non-exact pattern for approval.

1. [DONE 6fcfbd9] Remove the "Reports reviewed" developer tile and its footnote sentence.
2. [DONE] Testers joined near the top of the developer test page: Seats avatar circles with hover/tap profile cards
   (rating, accepted parts, profile link, Block inside), "N spots still open / All spots are filled", "Change in Edit",
   "No longer working (N)" fold.
3. Invite panel: Find testers search results must be ticked to invite (nothing auto-ticked; greyed rows untickable;
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
