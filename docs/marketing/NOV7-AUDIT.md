# November 7 audit and morning test plan

Code reviewed: master `046f4dae` (through §331). This is a bounded code review plus the named automated checks, not a claim that every page and notice has been manually tested. The downloaded Launch Report contains only its title and “Loading the report…”, so its actual contents could not be audited.

## Confirmed differences from the requested behavior

This table describes the reviewed master baseline. The branch's previous-name search and 50-character addition rule are described below and in their own decision notes.

| Area | Current implementation | Implication |
|---|---|---|
| Invite Suggested ranking | Available testers first; then requirements met, **has a revealed tester rating**, Bayesian score, payment count, fit. Top five eligible people not previously worked with. | It does not exactly follow requirements → score → experience → fit. A poorly rated person can precede an unrated person with a better score. Explicitly required by §276; do not silently change it. |
| Worked with you | Availability, your own rating of them, tests together, most recent work. | Deliberately different from Suggested. |
| Invite name search | Filters the ranked list, then moves exact current-name matches first. | An exact name match can override the ranking order. |
| Experience | Counts successful payment rows, including extra payments, rather than distinct completed tests or parts. | Multiple Pay more payments can increase this tie-breaker. This is only reached after score (and rated/unrated) ties. |
| Fit | Number of matching listed devices plus languages. Meeting requirements needs any one listed device and any one listed language, where required. | It does not require every device/language, and does not score categories. |
| Previous names | Find search and Invite search match current names only. | A rename can make someone unfindable by their old name. |
| Email timing | Daily cron is 09:00 UTC. Summaries are not scheduled separately for each recipient's evening. | At the current Chicago offset this is 3 a.m. The old Terms' “same evening” promise was inaccurate. |
| Summary limit | Only the newest 200 eligible lines are included; older lines are marked emailed with a bell link. Weekly/monthly reminders retain only the newest copy. | Some bell details intentionally do not appear individually in email. |
| Payment names | Several payment/owed/confirmation rows use the contract's saved title; newer notices can use the current title. | A renamed test can appear under two titles. Already listed in PENDING. |

The rating formula itself is correct: `(3 × platform average + sum of their revealed tester-rating stars) / (3 + number of those ratings)`. “Their stars” means the sum, not their average. Only ratings received as a tester count. The platform average uses that same side and revealed ratings; with none it defaults to 3.

## Previous-name lookup implemented on this branch

The owner clarified: only existing counterparts should match prior names, in Find tests, Invite testers and Testers on the developer's test page. The branch now implements this. Identity stays tied to the existing user ID; results show `Current name · previously Old name` only when an old name matched. Blocked/deleted-account exclusions remain. The admin directory and public profiles gain no alias list.

The implementation uses actual name-change records from account ActionLog rows. Regular profile renames now record the previous and current name atomically with the update, under the user lock. Older unrecorded names cannot be reconstructed. No new database column or migration is needed.

Eligibility uses the existing worked-together rule: a shared developer/tester contract, not an invite, application or merely being testers on the same test. Email changes are not treated as name changes. See `docs/PREVIOUS-NAME-SEARCH.md`.

## Excerpts and ratings

- A pending excerpt stores its own text and original question. Editing/removing listing questions does not cancel it or change the quote. The developer can still allow it. This preserves permission for the work actually quoted.
- A current NDA prevents new excerpt requests. A request made before an NDA was added can still be allowed, but stays hidden while the NDA exists. Hidden excerpts still count toward the three-item limit; a separate Hidden list remains pending.
- Replacement matching uses contract + question text. Renaming a question can therefore be a different replacement key; this needs a manual check alongside old/current question sets.
- Files are deliberately omitted from new excerpts. File excerpts remain pending, not implemented.
- A tester rating ends their part and closes their open Switch/Keep offer. A new dispute is refused after rating or the piece's close-out. Already-open disputes stay open for the team; the old proposal to close those automatically is not current policy.
- Developer rating opens after the tester rates and the shared work is settled, with a 14-day window. Revealed ratings are side-specific. Test both account sides so developer ratings do not affect tester invitation scores.

## Bell links, blue notices and email coverage

The targeted link suites cover named-person/test links, admin destinations, live-line anchors, bank notice context and scrolling. The excerpt and paused-page paths retain excerpt decisions and dispute-side access while restricted. Passing these checks is evidence for those cases, not proof that every historic bell link still lands correctly.

Immediate exceptions are new chargeback notices, 15-minute call reminders, requested password/email-confirmation links, and direct messages sent through the site's Contact us email path. Chargeback amount changes use the daily email. Most notifications wait for summaries; payment/must-email lines ignore Off. Ordinary notifications (including excerpt requests/decisions) follow the email preference. Alerts control stop-once behavior, separately from email preference.

Daily accounts whose summary is not yet due skip another summary, even with must-email/payment lines waiting. Weekly/monthly accounts can receive the daily required/payment subset between normal summaries. Check this when manually forcing a second email on one day. Local outbox tests do not establish real provider delivery.

One unresolved concern needs explicit reproduction: PENDING mentions §332 cleaning up stale bank-confirmation notices, but this checkout ends at §331. Do not report that fix as landed here. The extra “now waits until your tests resume” notice was declined in this chat and was not added.

## Morning manual session, in priority order

Use local sample data, fake payments and the local outbox. Record account, test, original dates, action, expected result and actual result for each scenario. Move one selected test/session's dates; do not run the global payment sweep to force one reminder.

1. **Review reminder:** fresh unreviewed BB work for fbbb, review tomorrow. Check exact part, amount/date and destination, once only. BB's two earlier submissions were already reviewed; the attempted fresh join was refused as paused and created no new submission.
2. **Email preference matrix:** Off/Daily/Weekly/Monthly, both account sides. Check review/deadline reminders, hold start/lift, team pause/lift/stop/close, tester suspension/reinstatement, booked calls and last rating reminders. Trigger the summary step early; verify the outbox, no duplicate lines, and correct account headings.
3. **Immediate call reminder:** under 15 minutes, Off included; cancellation, block or pause must prevent inappropriate reminders. Booking must respect the live 24-hour lead and work end.
4. **Pause over a deadline:** start before the tester deadline, resume after it; verify remaining time returned and end-of-day rounding. Compare an already-expired deadline, overlapping causes, and seven-day closure.
5. **Bank check → hold:** cancel an unfinished away-charge bank check, show the deferred amount correctly, ensure no stale confirmation link, and settle once. Also test a check already completed at the bank.
6. **Suspension + debts:** developer suspended with two pending checks, one debt, then a chargeback and changed card. Check each box, tester-safe wording, reserved versus charged money and no double charge. Verify whether the newly changed card bypasses the Verify step (known pending decision).
7. **Charge races:** keep developer Pay/Pay more/End early/call-request boxes open while BB charges. Same tester forces a stop once with Alerts Off; another tester/whole-test action follows the applicable ticks. Repeated press must not charge twice.
8. **End early hang:** first stopped press, then second press, with two tabs and request/server logs. Keep typed reasons and confirm the button recovers on a failed request.
9. **Disputes/rating boundaries:** just before/at close-out, after tester rating, and already-open dispute. Verify both sides' Rate availability, reveal timing and final reminders.
10. **Unpaid calls:** completed measured call appears in Waiting for the developer and Waiting for review total; payment and close-out remove it. This is already implemented, despite the old pending entry.
11. **Excerpt lifecycle:** pending request → question edit/remove → Allow/Deny; NDA added/removed while pending/shown; duplicate/replacement; cap with hidden items; withdrawn request from an old tab; decisions from paused and suspended views.
12. **Bell destination walk:** from each of the above notices open the exact part/request/decision on dashboard, test, session, Payments and admin pages. Repeat with team pause, developer suspension, closed work and an old link whose target has disappeared. No redirect loops or missing refusal lines.
13. **Search and ranking:** 1/2/3-character searches, exact match, renamed users, blocked/deleted users, mixed roles. Rated low versus unrated higher score; equal scores with different experience; exact experience tie with different fit; more than five candidates; filters and Worked with you.
14. **Drafts and marketing:** close/reopen with kept text; two tabs; draft error/offline case. Compare all marketed screens/captions to current behavior and keep the known default Productivity category visible in the QA notes.

## Pending-list reconciliation

Already implemented: unpaid call counts; closing open terms offers after rating; refusing new disputes at close-out/rating; immediate 15-minute call reminder with Off; team pause lift reaching the developer's required email; tester-side-only invite ratings.

Still pending or unresolved: End early hang; re-verifying a changed card during a chargeback hold; consistent current payment titles; hidden/file excerpts; silent-press errors; faster focus/open-box polling; linked-account/data-retention policy; waiting-charge stop rules. Historical-name search is implemented on this branch with the privacy restriction above. The old pending list mixes decisions, suggestions and completed work: it is not an implementation checklist without reconciliation.

## Automated evidence and limits

- Reminder/pause/hold/suspension/Charge groups: 41 passing tests.
- Existing ranking and notification-link groups: 48 passing tests. These explicitly confirm the §276 rated-first rule rather than the score-only order requested in this chat.
- Excerpt/rating/NDA groups and the new rendered Terms checks: 58 passing tests.
- New pending-excerpt/question-edit regression, existing same-part Pay/Add/Send checks and Charge/Pay race group: 15 passing tests on the latest focused run.
- First full check: 3,325 passed, 10 failed. Two assertions still expected the obsolete Terms wording and were updated; seven cases timed out; one simultaneous Charge/Pay case returned stop_once instead of a final refusal. The timeout cases passed in the focused rerun. The payment race reproduced in a second group run, then passed in a smaller run: retain it as an intermittent concern, not a proven fix. Its failure now names which press and the returned notice to aid diagnosis.
- No real emails sent, no hosted database accessed, no live Stripe calls made. The automated checks use isolated local schemas. Manual link clicks, provider delivery and real two-browser calls remain separate launch checks.

The owner manually confirmed the existing Pay/Add stop behavior during this chat: a payment already shown on the tester's page does not stop Add; an unseen same-part payment does. The later requested minimum is a new rule, not a change to that stop behavior.

A second full check hit the database-size measurement's 120-second timeout and further 120/30-second daily-reminder timeouts; it was stopped after those failures rather than reported green. Build/lint/typecheck and the final focused suite are recorded separately in the completion note. These timeouts and the intermittent Charge/Pay race remain validation concerns for the full suite.

Final validation: the ten-file focused suite passed all 67 tests after the implementation changes. Typecheck, lint (existing warnings) and production build passed. The complete `npm run check` remains **not green**, for the full-suite failures above; do not treat the focused suite or build as a substitute for that result.

Changes delivered on this branch: Terms §1/§2/§3/§6/§7/§8 and payment-email timing; 50-character answer additions; private previous-name search; scoped review-reminder generation; refreshed caption-led reels and social copy. No ranking policy was changed. Open product question: keep §276's rated-first override, or adopt the exact score-first order quoted in this chat?


## Follow-up status

See [November 7 request status](../NOV7-REQUEST-STATUS.md) for the implemented fixes and remaining manual checks. The owner subsequently chose to retain the current rated-first Suggested order. Automatic sign-out and password changes are deferred. The extra waiting-for-lift notice and automatic spot reduction were declined.
