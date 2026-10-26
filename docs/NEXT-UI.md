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
4. [DONE 3da9c7c] Group C controls: End early ticks + confirm popup; Stop the test confirm popup; Cancel dropdown; Chat as its own page
   with unread badge; Block in the hover card; Leave in its own "Can't finish?" card.
4b. [DONE c68cff4] Join anyway / Apply anyway: use the full app's popup and its behaviour
   (integration src/app/playtests/[id]/claim-form.tsx), replacing the lean in-page warning; lists every unmet need
   (devices and languages), same lean rules (warn, never refuse).
5. [DONE 4e5e6de] Join page (listing), dashboard and Find tests formatted EXACTLY like the full app's equivalents
   (app/playtests/[id], app/dev/page.tsx + app/tester/page.tsx, app/playtests/page.tsx).
6. [DONE] Developer/tester side switch like the full app (header switch, per-side nav/dashboard/pages, /switch links,
   each tab labelled by its page's side) - OWNER APPROVED Oct 23.
7. [DONE 790f802] CALL REQUEST FORM (owner, final):
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
10. [DONE af6ed41] KEPT FORMS (owner chose b): typed-but-unsent text is saved (server-side, per user and form, any device) and comes
   back after reload / sign-in with the full app's "Not sent yet" tag, as in the full app (integration
   components/use-kept-form + change-lock). ONLY on: written answers, chat messages, dispute text, rating comments,
   reject reasons, and the Post/Edit form. NOT on login/sign-up. Sending clears it.
11. [DONE f1e3be4] TESTER SESSION PAGE exactly like the full app's (integration src/app/tester/claims/[id]/page.tsx), lean behaviour:
   - "Your parts" card (full app :686-716) showing, per part (written / recording / live calls): Required / Not required, sent or not sent yet,
     "You asked $X" if they asked, and "Paid so far $Y" (plus the listing price / "Not in your contract").
   - Every other section in the full app's layout and order; the live-call area is the lean "Live session" panel
     (same component as the developer side). Nothing the lean app doesn't do.
12. [DONE] STOP RULE FIX (owner, high priority, do right after item 0): the second press goes ahead ONLY if nothing new
   happened since its stop box last updated (send the box's newest line time; anything newer stops again with the new
   lines added). Applies to every button EXCEPT the tester's Leave and Block, which still stop only once. Tests.
13. [DONE 6403fe8] NOTICE IN VIEW (owner): when a stop box or refusal appears after a press, scroll just enough to bring the button and
   its notice into view (block "nearest"); never jump to the top box because of a press.
14. [DONE 9c297bd] INVITE PANEL labels: a tester who left this test shows "Left this test", one you ended shows "You ended their work",
   to the right of their name (still tickable: a re-invite is how an ended tester can come back).
12b. [DONE 7832eb5] Finish item 12's gaps: the "What's missing changed" stop inside the Invite anyway box, the owed-total check
   behind "Pay what you owe", and the call-request limit confirm must also stop again for anything newer.
15. EVERY OTHER PAGE EXACTLY LIKE THE FULL APP (owner, Oct 23): everything except the developer test page, the tester
   session page and Post/Edit, which keep their agreed lean layouts. The JOIN (listing) page IS included: pretty much
   exactly the full app's (re-check item 5 against it section by section; adapt only where lean behaviour differs). That includes the
   header/nav (per side), both dashboards, Find, profile pages (keep the agreed stat tiles: developer Pays on average /
   Typical review / Rating + developer-only capacity card; tester Accepted parts / Rating), payments, notifications,
   messages/chat, account settings, admin, landing, login/sign-up/reset/verify. Copy the full app's markup and
   wording, adapting only where lean behaviour differs; list each adaptation.
16. ASK TO REJOIN like the full app (owner, Oct 23; integration RejoinAsk / wrapUp kind REJOIN): a tester who LEFT
   no longer rejoins directly; "Join again" becomes "Ask to rejoin" (optional note). The developer sees it where the
   full app shows rejoin asks (with applications / Needs you) with Accept / Decline. Accept restores their session on
   the CURRENT listing (time-left deadline, as specced); Decline tells them. The ask closes like an application
   (test full, stopped, Open until passed, listing change that closes applications) and follows the stop-once and
   refusal rules. Ended testers still need a new invite. Testers who rated can't ask.
   - INVITED AFTER LEAVING / BEING ENDED: their old session page shows the invite with a Join button (Join anyway popup
     if a need is missing) in place of "Ask to rejoin" / "You can't join this test again"; joining restores the session.
   - AUTO-MATCH: a pending ask to rejoin (or a pending application) + an invite from the developer, in either order, =
     joined at once (the developer chose them; no Join anyway popup), unless a final refusal applies (full, stopped,
     blocked, paused, 10 tests). Both told: "You're back in Harbor Run" / "Ana Silva rejoined (you'd invited her and she'd
     asked)". Covered by tests.
17. [DONE] TERMS OF USE, PRIVACY, HELP pages copied from the full app (owner said yes), adapted to lean rules, linked in
   the footer and at sign-up. Mark them "Draft - owner to review wording" in the report.
18. NDA like the full app (owner, Oct 23): Post/Edit has the full app's NDA option with its text (incl. its sample NDA,
   src/lib/sample-nda.ts); testers must accept it to join/apply/accept an invite/rejoin (the full app's accept step);
   acceptance time stored on the contract and shown to both sides. Replaces lean's optional "keep it private" tick and
   its badge. NDA text is part of the terms (a change = terms change: offer / closes applications).
19. ACCESS KEYS like the full app (owner, Oct 23): Edit/Post "Access keys" (one per line); each joining tester gets the
   next unused key, shown on their session page; "N keys left" badge; every open spot needs an unused key (Save/Post
   refused red otherwise, wording from src/lib/key-needs.ts); a tester who left and comes back gets their key back;
   "This key doesn't work" report and the developer's replacement flow as in the full app. Port its rules
   (key-needs.ts, key-diff.ts, keyRoom) adapted to lean.
20. [DROPPED by owner Oct 23 - do not build] STOP ACCEPTING TESTERS / ACCEPT TESTERS AGAIN on open tests like the full app (page.tsx:487-498): hides the test from
   new testers (Join/Apply/Ask to rejoin/invite accept refused "This test isn't taking new testers right now."), joined
   testers keep working, it CLOSES waiting invitations and applications and says how many next to the button (stops
   once if that number changed), and is undone with "Accept testers again". Stop-once/refusal rules as usual.
21. DEVELOPER TEST PAGE structure (owner, Oct 23), following the full app's sections:
   - "NEEDS YOU" section near the top (full app page.tsx:518 pattern): everything waiting for the developer, INCLUDING
     paying for parts (each piece's Pay / Reject box lives here, not inside tester cards), applications, asks to rejoin,
     call requests waiting for them, calls waiting for a length / Pay, disputes waiting for their side.
   - "TESTERS JOINED": the avatar row, then one row per tester showing only: their parts sent (Required / Not required,
     sent / not sent), how much paid per part and in total, call summary; and a "History (N)" fold at the bottom of each
     tester's row (full app testers-section.tsx "History" pattern) with their past events. No Pay boxes here.
   - The panel's title on top is "Testers" (owner). With many testers: the avatar row shows the first ~12 circles
     then "+N"; the tester rows sit in a scroll box about 6 rows tall, with the full app's search box above them
     (testers-section.tsx search) to find a tester by name; the "No longer working (N)" fold stays below.
22. BELL STACKING (owner, Oct 24; LAST, only if usage allows): in the bell list, notifications about the SAME test on the
   SAME day stack into one entry ("Harbor Run · 4 updates today", newest line shown, unread count); clicking it expands
   to show every one of that day's lines for that test, each still linking to its place. Other days and other tests
   stay separate. Unread state per line; opening the stack marks them read. Emails unchanged.
   BELL and CALLS (owner correction): call REQUESTS (requested / withdrawn / declined / closed) are NOT bell lines (they
   show in Needs you, the Live session panel and the live top box). Call BOOKED (incl. auto-booked) and CANCELLED (by
   whom, "nobody joined", "the site was down") ARE bell lines for the other side and stack. All of them appear in each
   tester's History fold (item 21).
23. ALERTS MENU on the developer test page and Edit page like the full app (owner, Oct 24; integration
   components/press-notice.tsx AlertsMenu + src/lib/alerts.ts): an "Alerts" menu at the top where the developer ticks
   alert types to IGNORE; ignored types no longer stop presses and show greyed in the live top box; the blue stop box
   adds "You can turn these stops off in Alerts, at the top of the page." and a "Don't stop me for:" quick option.
   Lean types (adapt the full app's list to what lean has): Joins and applications, Testers leaving, Work sent, Call
   changes, Payments (card payments going through / failing), Disputes, Admin decisions, Your saves somewhere else,
   Ratings given, Listing changes. NEVER ignorable (always stop, not in the menu): payment hold / pause, a tester
   account closed, the test stopped, final refusals. Saved per developer. Tests.
24. TESTER SESSION PAGE part panels (owner, Oct 24): like the Live session panel's "Live call: $40/h" line, the Written
   answers panel and the Recording panel each show the tester's contract term for that part at the top: "Written
   answers: $8 · Required" / "Recording: $12 · Not required" / "Not in your contract" (+ "You asked $X" and "Paid so far
   $Y" if any, matching Your parts). Same wording in all three panels.
25. CROSS-TAB SIGN-IN / SIGN-OUT like the full app (owner, Oct 24; integration components/signed-in-page.tsx,
   signed-out.ts, page-restore.ts): signing out in one tab sends the other open tabs to the login page; signing in
   (in any tab) brings other tabs that were on the login page back to the page they were on, signed in; signing in as a
   DIFFERENT account hides pages of the old account (they show the "wrong account" step like the full app); Back /
   Forward restore the page and bring it up to date; signed out meanwhile -> login. Port it, adapt to lean auth.
26. SUSPENSIONS - follow LEAN-SPEC NEWEST+13 exactly (it supersedes the text below; work was IN PROGRESS, uncommitted, when
   the spend limit stopped the builder). SUSPENDED DEVELOPER (owner, Oct 24): can sign in; Dashboard, Payments and Profile stay open; on their test pages
   the ONLY allowed actions are Pay (in Needs you) and, during a payment hold, "Pay what you owe". Everything else
   (chat, invites, Edit, calls, End early, Reject, Next round, ratings...) is refused blue under the button ("Your
   account is paused: you can still pay for work testers sent."). They can VIEW tester profiles (read-only). Each of
   their test pages shows a line at the top "This test is paused while your account is paused." Testers see only the
   existing neutral wording (never "suspended").
27. PAYMENTS PAGE panel (owner, Oct 24; for ALL developers): under "Your card", a "Waiting for your review" panel listing
   every test with unreviewed parts (test name, how many pieces, oldest waiting / 14-day date) with a "Pay" button
   linking to that test's Needs you panel (#needs-you). Empty -> "Nothing waiting for review."
28. ADMIN DISPUTE DECISION (owner, Oct 24) - fix + layout:
   - MAX = the part's listing minus what was already paid for that part on OTHER pieces (same rule as the Charge cap);
     MIN = what this piece was paid. Server-enforced (checkDisputeDecision) + tests (incl. paid $5 earlier + this piece
     rejected, listing $8 -> max $3).
   - Admin row layout:
       Ana Silva vs Nora Lane · Harbor Run · Written answers (sent Oct 20)
       Listing $8.00 · Paid for this piece $0.00 (rejected) · Paid for this part so far $5.00
       Tester: "..."   Developer's note when rejecting: "..."   Developer's side: "..."
       Total pay for this piece  $[      ]  $0.00-$3.00 · leave blank to keep it as it is
       Note to both [                    ]   [Decide]
   - Blank = keep the pay unchanged ("The team kept the pay at $0.00 (rejected)."); range hint + red on blur per item 0.
29. SUSPENDED TESTERS + REJOIN RULES per LEAN-SPEC NEWEST+14 (do with item 26 and update item 16's ask-to-rejoin rules).
30. PAYOUT PROBLEMS banner + 3-day bell reminder for testers per NEWEST+14 - ONLY after everything else, if usage remains.
31. NUMBER FORMAT (owner, Oct 26):
   - Everywhere: money and counts use thousands separators ("$12,403.50", "1,240"); money you act on (Pay, Charge,
     disputes, payments, receipts, owed) is always exact.
   - BIG STAT TILES ONLY (dashboards, profiles): under 10,000 -> full with commas; 10,000-999,999 -> one decimal + "k"
     ("$12.4k"); millions "M" ("$1.2M"); billions "B"; trillions "T"; 10^15 and up -> scientific "$1.2 × 10^15".
     Drop a trailing ".0" ("$12k", "$1M"). No hover/tooltip. Percentages and days unchanged. One shared formatter + tests.
