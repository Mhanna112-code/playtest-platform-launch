# November 7: minimums, request limits and listing display

## Implemented
- Previously five-character text minimums are ten, including listing names, mature explanations, payment/dispute reasons, reports, call problem notes and Stop/End early reasons. Existing short unchanged listing fields retain their edit exception. Answers remain fifty characters.
- Invitations and applications/rejoin requests allow two attempts per tester/test in a rolling 24 hours. Invitations retain the separate 100-per-test daily total. Cancelled/withdrawn attempts count. Concurrent application presses are serialized. Local TESTING_NO_LIMITS bypasses these quotas; hosted Vercel cannot enable it.
- Session chat displays at most 9 in its unread badge while accessibility retains the actual unread count.
- Find's listing page shows days per tester and spots left immediately below Listing. Removed the duplicate What you get line and misleading review/locked-contract chips. Contract explanation distinguishes agreed prices/parts from other listing edits.

## Audit answers
- Contact the team: five messages per account per rolling 24 hours, with duplicate-message protection.
- Without payout setup, the tester's 80% share waits in recorded payments. It transfers once payout setup is ready; setup reminders repeat every three days for eligible nondeleted accounts.
- Profiles and hover cards do not explicitly show pronoun labels. Hover cards also appear in messaging contexts.
- Voluntarily leaving does not universally hide the test from Find: an otherwise eligible tester can find it and rejoin. Closed/full/paused, invite-only and other eligibility restrictions still apply.

## Validation and release status
Quota and ten-character focused tests: 13 passed; listing/chat display checks: 2 passed. Earlier boundary run: 37 passed with one local invite fixture failure; corrected that fixture and the invite test now passes. Typecheck, lint and production build passed. Full npm run check is not green: broader existing source/markup assertions fail, including batch7 and rejoin/notice assertions. Manual delivery tests remain pending.

The email-queue migration was applied to local public with the user's explicit separate exception. No hosted database was accessed. This branch is not merged: the latest supplied AGENTS.md says never merge into master; Claude reviews and merges. No push was made.


## Final profile change and merge authorization
The owner explicitly authorized merging into master after the prior branch-only handoff. Tester-facing developer profile tiles now omit the disputes-decided count; the developer's own dashboard retains it. The profile-stat suite passes both tests, including a decided dispute whose outcome still correctly affects payment statistics. Typecheck and lint pass; full-check result remains recorded separately.
