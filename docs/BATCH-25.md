# Batch 25: bank-confirmation leftovers (Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 24 and its recordings. Small fixes found by the design doc check after batch 24.

## 1. "Confirm by" times in the developer's own time zone
The dashboard's "Your bank wants you to confirm" rows (src/lib/bankTop.ts / `confirmByText` in confirm.ts) and Payments' list (`fmtDateTime`) build the time and the "today" / "tomorrow" choice on the server's clock. On a server running in UTC, "today" and the time can be wrong for the developer. Use the developer's time zone the way the rest of the app does (the user's saved `timeZone` / `renderTimes`, as the admin outage lines and the test page do), for the time, "today" / "tomorrow" and the red under-24-hours check. Check the test page's "Confirm it by" line too and fix it the same way if it has the same problem. Tests: a developer in a time zone far from the server's sees the right day and time near midnight.

## 2. One wording for a retried chargeback
The dashboard row says "what you owe" for a retried chargeback, while the test page says "a payment your bank had reversed (<piece>)". Use the test page's wording on the dashboard too: "$X on “<test>” · a payment your bank had reversed (Ana Silva's written answers) · confirm by …". Keep "what you owe" for an automatic retry of what's owed during a payment hold.

## 3. The renewal bell line opens its row
The renewal's bell line ("…Confirm it in Payments by <date>.") links to `/app/payments#confirm` (the whole list, no highlight). Link it to the renewal's own row (`#bank-<id>`), highlighted, like the dashboard's link.

## 4. Small
- The `bank=1` branch of /api/pulse answers only for a developer (anyone else gets the plain pulse).
- BATCH-24.md's wording is history; nothing to change there.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
