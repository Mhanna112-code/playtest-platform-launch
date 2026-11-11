# BlockTestBlockTest evidence — Nov 8, 2026

The live rehearsal used localhost:3400 and the existing BlockTestBlockTest fixture. Automated evidence used separate Postgres schemas and the fake Stripe and email outbox. Times in the live table are Central. The two-day fixture table uses UTC so the exact timestamp differences are reproducible.

## Live rehearsal

| Check | Evidence | Result |
|---|---|---|
| Existing bank confirmation during a team pause | Pause event at 6:46:01 PM. The old Confirm tab briefly showed a refusal-style heading, and the next press opened the bank check. The payment row records one $5.00 charge at 6:48:24 PM. The lift event is at 7:14:09 PM. | Settled once while paused. The wording of the transient first notice was not captured. This occurred before D10's retry removal. |
| Restricted NDA edit and past session | fb saved the NDA during the pause. DMTEst saw the new NDA notice on the ended session and reported the Dispute refusal before acknowledgement. After acknowledging, DMTEst filed the dispute at 6:59:46 PM. | Observed in the browser and corroborated by the dispute row. |
| Team decides a call dispute during the pause | Second Admin kept the existing $5.00. The dispute was decided at 7:01:59 PM. DMTEst reported that the bell link opened the correct decision. | Decision and navigation passed. |
| Lift and tester deadlines | Open until stayed Nov 29 at 11:59 PM. Nina Park and Comparison Tester moved from Nov 30 at 11:59 PM to Dec 1 at 11:59 PM. DMTEst and d kept Nov 29 at 11:59 PM because their sessions had already ended. | Matches rounding to the nearest day-end for Open until and rounding up for working tester deadlines. |
| Tester can rate after lift | DMTEst's rating is saved at 7:17:13 PM. | Rating passed. The old tab did not show a resume retry. |
| Pause and resume recipients | Nina Park and Comparison Tester both have two required bell entries, one for each event. DMTEst's ended session was outside the recipients for these notices. | Generation and Off override verified. This fixture's inbox delivery was not verified. |
| Review reminder on BlockTestBlockTest | Off Settings Tester's unpaid answers generated one simulated day-before bell reminder with the exact submission anchor. A repeated sweep did not duplicate it. A bell read was recorded. | The original copy said “by tomorrow” when the simulated clock and due date were both Nov 29. This exposed the need to include the calendar date. |
| DMTEst's separate review reminder | On Manual checks, the normal submission path produced an unpaid Dec 1 review deadline. A scoped simulated sweep generated “within 3 weeks (Dec 1)” with the exact piece link, marked required for email. A repeated sweep did not duplicate it. | Bell wording and generation verified. The bell-to-piece click and end-to-end email for this particular item were not observed. |
| D04 group call request | Off Settings Tester has a 30-minute booking on another local test on Nov 12 at 2 PM. Setup found no group request. A later database check found exactly one pending developer request at that time on BlockTestBlockTest, for Comparison Tester, created at 9:23:49 PM Central. | Recipient result verified. The first browser notice was not captured. A fresh form can catch the conflict in red before submitting. The separate-times integration suite exercised the partial-send retry through the request route. |

[BlockTestBlockTest](http://localhost:3400/app/tests/cmw88zhss000g7kmkqouyr2gl) · [BlockTest review piece](http://localhost:3400/app/tests/cmw88zhss000g7kmkqouyr2gl#piece-cmw8kqsd800087khwpgwes81i) · [DMTEst review piece on Manual checks](http://localhost:3400/app/tests/cmw7ltfaf003a7k042yo7b4hx#piece-cmw8kwvj6000c7kl8wk04byvx)

## Controlled proof of the pause windows

The integration fixture called the real team Pause and Lift functions with a controlled clock from Nov 8 at 12:00 UTC to Nov 10 at 12:00 UTC. It used a working test and a test whose work had already ended so the running settlement windows could be checked separately. The stored pause and resume event times were aligned to the test clock. [Executable evidence](../tests/block-test-pause-evidence.test.ts)

| Clock | Before UTC | After UTC |
|---|---|---|
| Open until, still open at pause start | Nov 10 23:59:59 | Nov 12 23:59:59 |
| Working tester deadline that fell during the pause | Nov 9 23:59:59 | Nov 11 23:59:59 |
| Deadline already past at pause start | Nov 7 23:59:59 | Nov 7 23:59:59 |
| Written review date | Nov 13 17:00 | Nov 15 17:00 |
| Stored Charge or Let it go choice deadline | Nov 20 17:00 | Nov 22 17:00 |
| Measured call's review date | Nov 13 17:00 | Nov 15 17:00 |
| Test close-out | Nov 21 23:59:59 | Nov 23 23:59:59 |
| Tester rating close | Nov 21 23:59:59 | Nov 23 23:59:59 |
| Developer rating close, separate settled tester | Nov 21 23:59:59 | Nov 23 23:59:59 |
| Written part Pay, Charge and new-dispute close-out | Nov 27 17:00 | Nov 29 17:00 |
| Measured call close-out and latest Pay more close | Nov 27 17:00 | Nov 29 17:00 |

The fixture also checked that a new dispute was still allowed just after the old close-out and was refused at the new close-out. The already-ended test did not reopen, and the measured call's historical measurement time stayed fixed. The bank-confirmation tests separately compare the exact saved three-day deadline before and after a lift and check that confirmation is unavailable after it expires. An open dispute has its own tester-rating extension, and overlapping disputes count once. [Bank confirmation tests](../tests/confirm-during-pauses.test.ts) · [Dispute and rating tests](../tests/dispute-rating-extension-terms.test.ts)

## Email proof

An outbox row proves the app rendered and handed off the message to its configured local transport. It does not prove a real provider accepted it or a mailbox received it. No real-address sends were made for this report.

| Email route | Evidence |
|---|---|
| Developer review reminder with Off | A selected unreviewed submission generated one bell entry, the correct piece link and date, and an actual local summary outbox message containing the reminder. Repeating generation and summary did not duplicate it. |
| Tester Send work deadline | The deadline tests produced the bell line and a local summary, including a tester who joined less than a day before the deadline. The reminder is required for Off. |
| Team pause and lift, payment hold and lift, tester suspension and reinstatement | Real actions generated required notifications on Off accounts. Before summary there was no outbox email. After summary each account had one outbox email containing its required lines. |
| Booking confirmation with Off | A booking produces a required bell line. The outbox test checks that the booking confirmation appears in the summary and the immediate reminder wording does not repeat there. |
| Immediate 24-hour call reminder with Off | The call-reminder tests check that neither account gets one before the 24-hour threshold and both get local immediate emails at the threshold. They check cancellation and legacy-key deduplication. |
| Immediate bank chargeback notices with Off | The first chargeback and another during the hold produced immediate local outbox emails. Subsequent changes to the bank's disputed amount appeared in morning mail. |
| Final rating reminders | The developer and tester reminder tests read the dated final reminder in the local outbox with Off. The developer's earlier, ordinary reminder was absent from Off mail. The open-dispute test checks that a late decision restores rating time and the final reminder. |
| Bank confirmation, payout setup, Closing soon, Pay now and Charge or let go | The focused tests generated each notification and found it in an Off account's morning outbox. The bank and payout tests separately checked that no email appeared before the summary ran. Closing soon and Pay now were grouped into the same payment email. |
| Deleted accounts | Generation and already-queued reminders are suppressed or removed from mixed emails. Payment records and applicable receipts are preserved. |

[Review and restricted-account mail](../tests/reminder-audit.test.ts) · [24-hour and booking proof](../tests/call-reminder-24-hours.test.ts) · [Email catalog](../tests/email-catalog-fixes-299.test.ts) · [Deadline reminders](../tests/email-fixes-295.test.ts) · [Immediate chargeback mail](../tests/chargeback-emails-294.test.ts) · [Deletion and queued mail](../tests/deleted-account-reminders.test.ts)

The source audit finds two immediate account-notice families in this flow, the 24-hour booked-call reminder and chargeback events that start or add to a hold. The summary includes notices marked required or payment-related even when ordinary email is Off. The evidence above covers the reminder families in this run. It does not claim fresh inbox delivery or independently run every variant in each family. [Immediate and summary selection](../src/lib/server/notify.ts)

Selected actual outbox lines from the isolated fixtures, with fixture links omitted:

- Review: “Harbor Run”: review Reminder Tester's written answers by tomorrow (Nov 9) (after that Reminder Tester can charge or let it go).
- Bank confirmation: Your bank wants you to confirm a $10.00 payment on “Harbor Run” by Nov 12
- Tester final rating: Reminder: rate Nora Lane on “Harbor Run”: rating closes on Nov 11
- Developer final rating: Reminder: rate Ana Silva for “Harbor Run” (until Nov 11)
- Payout setup: $8.00 is waiting for you: finish your payout setup to receive it.
- Immediate chargeback subject: Your tests are paused after a chargeback: “Harbor Run” closes on Nov 16 unless you finish the steps

## Other tabs

The developer's test page and tester's session page both query the live endpoint with a tab identifier. The endpoint reads recorded actions on that test, excludes actions from the viewing tab itself, and shows applicable lines from the other tab. In the focused route test, a developer's Pay appears in their other tab and a tester's Send Answers appears in theirs. The source index also lists examples of tester additions, call request and answer actions, cancellations, Switch or Keep, Charge or Let it go, Leave, and Dispute. [Live route](../src/app/api/live/route.ts) · [Tester actions recorded](../src/lib/server/actionText.ts#L51) · [Other-tab tests](../tests/other-tab.test.ts)

A visible live line is different from a stop-once result. A logged own-tab action can force an unseen retry on an eligible tester button using the shared gate. A retry does not apply if the change was already accounted for, the button has a separate gate, or the action is refused first. Rate has no logged own-tab stop line of its own. A duplicate Rate is a refusal. The narrower developer Rate check and the special bank, NDA, and dispute eligibility rules still apply.

## Remaining manual checks

| Check | What remains |
|---|---|
| D02 restricted Edit | Old Edit tab, Pause in another tab, then Save. The restricted-editor suite passed. Capture the actual old-tab refusal from the browser if it has not been recorded. |
| D04 partial group request | The prepared time now has a request for Comparison Tester only. Reproduce on a new time if a screenshot or exact first-press browser notice is needed. |
| B15–B17 | One old-tab check each for Settings email preference, Profile name, and Payments Change card in Stripe test mode. |
| Reminder delivery | Verify the DMTEst bell jump and the mail in a configured inbox, plus a real scheduler cycle for Send work, Review, and the call reminder if required. |
| Pay race and Alerts | Finish the full stale-tab matrix for Pay, Pay more, End early, call actions, and another tester's buttons, with Alerts on and off. Include the Pay what you owe total race and blocked Pay versus Pay more. |
| Disputes and ratings | Capture the exact stale refusal after rating and at the piece deadline, and the inbox final reminders. The $5 call's disputed-while-paused path and old session decision link passed. |
| Unpaid calls and calls | Verify a measured unpaid call in both waiting locations before payment and its removal from both after payment. Confirm booking mail, 24-hour mail and cancelled booking behavior in the manual fixture if inbox evidence is needed. |
| Terms and participation | Finish the browser Switch/Keep and Terms history comparison, verify the ended session and rejoin behavior in two tabs, and verify the proposed regular Edit layout with only NDA enabled if that layout is implemented. The current app uses the dedicated NDA-only editor. |

The broad notice matrix is a reference. The earlier selected manual run was narrowed to D02, D04 and B15–B17. [Notice matrix](NOTICE-TEST-MATRIX.md)

## Changes from Nov 8

- Participation and dashboards. Old sessions refresh on rejoin, unblocking permits eligible rejoin requests, and eligible disputes remain available on past sessions. Departures release assigned keys for explicit reuse and preserve assignment history. The tester's Charge decisions appear above To do.
- Payments and ratings. Ordinary work and developer payments follow Alerts even on the same part. Pending bank confirmations can complete during a team pause or developer suspension. Open disputes preserve the tester's rating time. This follow-up removes T12, T13 and D10 from the matrix and the corresponding retries from the app. Developer Confirm all and tester profile Block and Report still use their separate state checks.
- Reminder and Terms copy. The call reminder is 24 hours and immediate. Deadline reminders show the calendar date. The Terms explain Switch or Keep and the saved prices of prior work. Changes while you pay distinguishes forced stops from Alerts. The Switch or Keep notice links to the Terms explanation.
- Editing and reference. A restricted test can save NDA-only edits. Edit's live links open the test page. Stop-once and refusal references, the button-by-button matrix, and its separate newly added cases are recorded in this worktree.

At the time of this report, localhost's master was at `0c32fd48` and the newer commits were on `codex/reminder-audit`. The browser bank payment proves the already-merged pause behavior. The focused route tests prove the first-press confirmation change in this branch. The earlier broad `npm run check` had 106 failures before this follow-up. The evidence runs below cover selected flows and are not a green full-suite run.

| Evidence run | Result |
|---|---|
| Exact pause windows, last deadline, bank confirmation, two live-notice tests, call reminders, and Stop/End early regressions | 17 passed across 6 files. |
| Email catalog, reminder-date changes, final developer rating reminder, call history, Pay what you owe race, and exact pause windows | 50 passed across 8 files. |
| Off outbox for bank confirmation, payout setup, Pay now, Closing soon, Charge or let go, and both final rating reminders | 6 passed across 5 files after aligning two outdated test link assertions with the current Needs you anchor. |
| Additional BlockTest-related suites | Restricted NDA editing, partial group requests, account-page other-tab checks, required account mail, chargeback email, deleted-account suppression, and rejoin tests passed in the broader runs. The older developer Edit/End early race assertion also failed on the earlier baseline. |
