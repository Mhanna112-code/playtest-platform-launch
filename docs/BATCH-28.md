# Batch 28: leftovers from the batch 25-26 design doc check (Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 27. Lines marked DEFAULT are my proposals; the owner can change them.

## 1. The heartbeat never records an outage on its own (DEFAULT)
`sweepGap` (src/lib/server/outages.ts) records any 15+ minute gap between sweeps as an outage. But the sweep runs from the uptime check itself, so pausing the monitor, a lapsed UptimeRobot plan, or a local server restarted after 15 minutes all record "outages" that move every timer (under 24 hours with no Approve). Fix:
- A heartbeat gap alone is **never applied**. It's listed in the admin console's Outages box as "Possible outage: no checks from 3:10 PM to 3:42 PM (32 min). Nothing has moved." with **Approve: move every timer** and **Dismiss** (any length, not only over 24 hours).
- An outage reported by UptimeRobot (down + up, or an up alert with its duration) is applied as today; when it overlaps a heartbeat gap, the gap is closed as covered by it.
- Any server activity counts as a heartbeat (page loads, API calls, the daily cron, the sweep), so a gap means the server really answered nothing.
- HANDOVER: pausing the monitor no longer moves anything; a gap shows for an admin to decide.
- Tests: a heartbeat gap alone → listed, nothing moved; Approve moves; Dismiss clears; an up alert overlapping the gap → applied once with the alert's span.

## 2. Merging never widens an applied outage by itself
`recordGap` keeps the union of overlapping reports, so an accurate up-alert outage grows to the heartbeat's span, and an extra part can move clocks without Approve even past 24 hours. Fix: when an UptimeRobot report exists, its span wins (no union with a heartbeat gap). Two UptimeRobot reports that overlap merge, and any extension of an outage already applied that brings the total over 24 hours waits for Approve. Tests: up-alert + heartbeat → the alert's span; an applied 20-hour outage extended to 26 → the extra waits for Approve.

## 3. One wording for a team Stop
`sessionRefusal` (tests.ts) and other `testerRefusal` / `endedLine` callers don't pass `teamTime`, so some paths say "This test was stopped on Oct 29, 2026." while others say "This test was stopped at 3:10 PM.". Use the time form everywhere (the reader's zone; the date added after 12 hours, like other stop lines).

## 4. One time zone in a stop box
ChangesBox's `time()` uses the browser clock while stop lines now use the saved zone. Use the reader's saved zone everywhere in the box (the browser's only when none is saved).

## 5. The charge-opens line on the session page
A sent, listed part on the tester's session page doesn't show "If <dev> hasn't paid by <date>, you can charge or let it go then." (only dashboard rows and listed call rows do). Add it under each sent, listed part that's waiting for the developer.

## 6. Leftovers from the old question rule
- `answerSets.ts`: a question it can't find defaults to `required: true` (a "*" on a "Question N" placeholder): default to not required.
- `byQuestion.ts`: remove the unused `notRequired`.

## 7. Admin "Payouts waiting": oldest first
Batch 26 §12 made it newest first; the oldest waiting payouts are the most urgent. Oldest first, with "waiting since <date>", still the scroll box.

## 8. A Charge after the reservation never blocks Approve (owner, Oct 29; replaces batch 23 §6's "Approve is refused while short")
During a chargeback hold, when a tester's Charge (or anything else) is added to what's owed AFTER the developer reserved with Pay what you owe:
- **Approve still goes through:** it takes the reserved amount and lifts the hold, as when nothing was added. No "Not yet: $X is owed but $Y is reserved." refusal any more.
- **What was added after the reservation is charged right after the lift,** on the card the developer verified, as an ordinary charge (receipt naming it: "Receipt: you paid $X for Ana Silva's written answers (charged by them after 7 days)"); the tester is paid when it goes through. If the bank asks to confirm, it waits as "Your bank wants you to confirm" (dashboard box, 3 days); if it's declined, it starts a normal payment hold (not a chargeback hold).
- The admin's chargeback row shows it before Approve: "$X reserved · $Y added since (charged after the hold lifts)".
- Payments, before Approve: "Reserved $X: it's taken when the team approves lifting your hold. $Y added since will be charged right after." **Simpler (owner, Oct 29): Pay what you owe reserves once.** After the reservation its button is disabled with that line; anything added later is only ever charged after the lift (no second reservation for the difference). A new Pay what you owe is only needed if the reservation expired or was released ("Don't approve"), and then it reserves the full amount owed at that time.
- Tests: reserve, a Charge added, Approve → reservation taken, hold lifted, the added amount charged once; declined → payment hold; bank asks → waits for Confirm.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
