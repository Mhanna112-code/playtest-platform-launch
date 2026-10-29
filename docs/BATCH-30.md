# Batch 30: after launch (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after launch.

## 35. Storage running out: tell the admins, inside and outside the app (owner, Oct 29)
- Once a day (the daily timed run) the app measures the database's size (pg_database_size) and the total size of stored uploads (from its own records of R2 files). Limits come from settings: `DB_STORAGE_LIMIT_GB` (e.g. 0.5 on Neon's free plan, the plan's size on a paid one) and `UPLOADS_LIMIT_GB` (the R2 budget); unset = not checked.
- At 80% or more of either: a red box at the top of the admin console ("Storage is 82% full: database 410 MB of 500 MB." / "Uploads are 85% full: 8.5 GB of 10 GB."), one admin bell line per crossing ("Storage is filling up (database 82%)"), and the keyed /api/health answers "degraded: storage" (HTTP 200, alongside the emails keyword), so the UptimeRobot keyword monitor alerts the owner outside the app. Under 80% again: the box goes.
- HANDOVER: set the two limits; add "degraded: storage" to the keyword monitor; also turn on Neon's usage alerts (Neon console) and Cloudflare's billing notifications for R2.
- Tests: 79% → nothing; 81% → box, one bell line, health keyword; back under → gone; limits unset → no check.

## 2. Sending a part again after it's paid (owner, Oct 29)
Today a paid part is locked ("Your written answers were already paid for, so they can't be changed. Send anything new in the chat."). New:
- After a part is paid, the tester can send an updated version (written answers or a recording; attachments included). Above Send: "<dev> has paid $X for this. An update can be paid more, up to $Y in all." (or, at the cap, "This part is already paid the most it can be ($X): <dev> can't pay more for an update.").
- **Below the cap:** the update appears in the developer's Needs you as its own row, "Ana sent an updated version after you paid ($10.00 paid · up to $990.00 more)", with the piece's **Pay more** box right there (any amount up to the piece's cap, $0 closes the row with an optional note; the usual ticks). Pay more pays the same piece (no new piece, no Charge, no countdown reminders: the part was already reviewed). The row leaves Needs you once Pay more is pressed (any amount, $0 included) or Pay more closes.
- **At the cap:** the update doesn't go into Needs you (nothing more can be paid). The developer sees it on the tester's row ("Updated after you paid · already paid the most") and as a quiet live-box line, "Ana sent an updated version of their written answers (already paid the most)"; no bell stop beyond the usual Work sent alert.
- Disputes: an update doesn't reopen a dispute; the existing rules apply to the piece's total.
- Tests: update below the cap → Needs you row with Pay more; $0 closes it; at the cap → no Needs you row, the quiet line; Pay more closed → the row leaves.

## 3. Late work: no Charge (owner, Oct 29)
A listed part (written answers or a recording) sent after the tester's own deadline never opens Charge or Let it go: only the developer's own Pay settles it, like unlisted work.
- **Developer:** the piece sits in Needs you with its Pay box (starting at the listing), labelled "Sent late (deadline was <date>)"; any amount, $0 included (below the listing still needs the reason the tester reads). Review reminders count down to its review date (7 days after sending) like other work, then stop; it isn't in the daily "Pay now" line (§31 of batch 29) since the tester can't charge. If still unpaid at the piece's closing date it closes "Closed on <date>: not paid." as other pieces do.
- **Tester, before sending after their deadline:** a grey line above Send: "Your deadline passed on <date>. You can still send this: <dev> decides what to pay for late work, and you can't charge for it." After sending: "Sent late (deadline was <date>): <dev> decides what to pay. You can't charge for late work." Dispute still works on whatever is paid (once, up to the cap).
- An update of a late piece stays late; an update sent before the deadline of a piece first sent on time stays on time.
- Listed calls are unchanged (a call is booked by both sides; it's still charged automatically after 7 days).
- Post's Charge tick, the Terms and the design doc: Charge applies to listed work sent by the tester's deadline (doc agent for the doc).
- Tests: on-time listed work → Charge opens as today; late listed work → no Charge / Let it go anywhere (UI and server: "You can't charge for work sent after your deadline."), Pay works, closes unpaid at its closing date; the tester's lines before and after sending.

## Decided, no change (owner, Oct 29)
- **Late sending stays** (a tester can still send after their own deadline, "Sent late (deadline was <date>)"); work isn't closed at the deadline. What changes for late work is §3.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
