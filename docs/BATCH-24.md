# Batch 24: bank confirmations on the developer dashboard (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 23.

## 1. "Your bank wants you to confirm" at the top of the developer dashboard
Today a charge made while the developer was away (a tester's Charge, a dispute decision, an automatic retry) that their bank wants confirmed is only reachable from the bell line, the email, Payments' "Waiting for your confirmation" list and the piece on the test page. If it isn't confirmed within 3 days it counts as declined and starts a payment hold, so it belongs at the top of the dashboard.
- **Where:** the very top of the developer dashboard, above everything else (above the blue box on the restricted dashboard during a hold or suspension too). Hidden when there's nothing to confirm.
- **What:** heading "Your bank wants you to confirm (N)", then a plain scroll box (batch 17 §7 style: about 3 rows tall, everything in it, no "Show N more"), soonest deadline first. Each row: "$12.50 on “Harbor Run” · Ana Silva's written answers · confirm by Nov 2, 3:10 PM" (call: "Ana Silva's call on Oct 30"; an automatic retry of what's owed: "what you owe"), with **Confirm with your bank →**.
  - A charge on a test opens that piece's Confirm with your bank on the test page (the paused view during a hold or suspension), highlighted for a few seconds, exactly like the bell line.
  - A subscription renewal (no test) opens Payments at its row: "$X for your plan · confirm by <date>".
  - Under 24 hours left, the "confirm by" part is red: "confirm by today, 3:10 PM".
- **Live:** rows follow the dashboard's poll: a new one appears, a row leaves when it's confirmed (here, in another tab, or on the test page), when it expires (counted as declined) or when it's cancelled. No full reload.
- Phones: the same box, stacked, full width.
- Tests: a waiting charge shows with its deadline and link; a renewal links to Payments; confirming elsewhere removes the row live; expiry removes it; shown on the restricted dashboard during a hold; hidden when empty.

## 2. Closed call requests say why in the tester's terms
A tester who rates (finishing their part) closes their waiting call requests with the reason "the tester left" (src/lib/server/ratings.ts ~265). Use "the tester finished their part" there. Keep "the tester left" for Leave (tests.ts) and the suspension removal (restrictions.ts). Add the new reason to `CLOSED_BY_TESTER` in testerGate.ts so it stays a closure caused by the tester. Tests: rate with a waiting request → the developer's request reads "Closed: the tester finished their part".

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected (if one is needed: hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
