# Batch 19: small fixes found after batches 17–18 (Oct 28 evening)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 18 (c69e68d) and the design doc pass (e341168).

## 1. Close-out reminders stack under a heading
The close-out reminders use the bell group "closeout", which has no title in src/lib/bell.ts, so a stacked entry may show without a heading. Give it one: "Closing soon" (e.g. "Closing soon: 3 tests"), and check every other bell group has a title (add a test that fails if a group has none).

## 2. The paused-test banner mentions Rate
On a test paused by the team, the developer's banner line listing what still works doesn't mention rating, although "Rate your testers" now shows there (batch 17 §14). Add "rate testers" to the line when Rate is available (built from what's actually available, as today).

## 3. The Terms of Use: no "lower the length"
The Terms still say the developer "can only lower it [the call length], with a reason the tester reads", which is no longer true (batches 16 §26 and 18). Reword to: "A call's length is measured by the app while both people have the call page open, up to 150% of the booked length and never past the $1,000 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once." Nothing has launched, so fold this into version 2's text and its "What changed" note (don't bump the version). The Terms stay marked DRAFT for the lawyer.

## 4. Timed jobs every 5 minutes, using the uptime check (owner, Oct 28)
Today timed jobs (the 15-minute call reminder, close-out lines and reminders, Charge opening, nobody-joined call cancels, review reminders, rating reminders, …) run on page loads, page polls and the once-a-day Vercel cron (`/api/cron/daily`, 09:00 UTC). Vercel's free plan allows only daily crons.
- When `/api/health` is called with the right `HEALTH_KEY` (UptimeRobot, every 5 minutes), it also runs the time-sensitive sweep: the same work page loads trigger for calls and timers (call reminders, call ends and nobody-joined, Charge opening, close-out, reminders that are due). Keep it quick: run the sweep after answering if possible (or within a short time budget), never twice at once (a lock), and never let a sweep error change the health answer or create an outage record.
- The daily cron stays for the daily jobs (daily reminders, admin email, paused-test closing, etc.).
- Without `HEALTH_KEY` (status-only calls), nothing runs.
- HANDOVER: note that UptimeRobot's 5-minute check now also drives reminders, so the monitor must stay on.
- Tests: a health call with the key runs due reminders once; two at once don't double-send; without the key nothing runs; a sweep error still answers healthy.

## 5. Bugs found while recording batches 17–18
- **Pay fails after a cancelled bank check (important).** Pressing Pay again on the same piece after cancelling the bank's check gives a 500 ("Something went wrong on our side"): a Prisma unique-key failure on `(kind, payKey)` at src/lib/server/payments.ts ~131, because `pressKeyFor` reuses the cancelled press's key. A cancelled (or failed) check must free the press: the next Pay on that piece starts a new attempt with a new key (the one-time key still stops a double press of the same attempt). Same for Pay more, Pay what you owe, Subscribe and Verify a card. Tests: cancel then Pay again succeeds; a double click still charges once.
- **Developer profile Open tests after Back (§9 of batch 17).** After going Back from the stale-click page, the list kept the paused test for 45+ seconds: the poll returned the new list but the page didn't re-render (likely a back/forward cache restore). Re-render from the poll and refresh on `pageshow` when restored from the back/forward cache.
- **Length box layout.** When the red "At most 40 minutes…" line shows, the Request a time row squeezes the "Length" label (it wraps letter by letter on phones) and splits "min". Keep the label and "min" on one line (no shrinking), and put the red line under the row.
- **Stop box wording.** A tester's Let it go that stops once reads "Your Charge didn't go through". Name the press that was made: "Your Let it go didn't go through."
- Tests for each.

## 6. The Terms of Use: one clear "Payments" section (owner, Oct 28)
Rewrite the Terms' money rules as one plain section, "How payments work", taken from the design doc's Rules tab (the app's rules, not new ones; where they differ, the code wins and you report it). Short headed paragraphs, each with a one-line example:
- **Prices and the split:** parts and prices are set by the developer on the listing; the tester gets 80%, the platform keeps 20%.
- **Days per tester:** each tester gets the same number of days, counted from when the test opened to its Open until (example: opened Nov 6, Open until Nov 20 = 14 days); a tester's deadline is the day they join plus those days.
- **Paying for work:** the developer pays any amount from $0 up for each piece; under the listing (or $0) needs a reason the tester reads; the tester can dispute a payment once; the team's decision is final and can only raise pay.
- **Pay more:** extra pay on a paid piece, within its cap; it closes with the test's last Pay / Charge.
- **Unreviewed work: Charge or Let it go:** if a piece isn't paid within 7 days of sending, and not before the tester's deadline, the tester may charge the developer's card up to what's left of the listing price, or let it go (example with dates). Charge needs a tick over $200. Each piece gets at least 14 days of Charge.
- **Close-out:** 14 days after the last tester's deadline (later for a piece whose Charge opened late), Pay, Pay more, Charge and Let it go end; unpaid work stays unpaid; testers can no longer rate.
- **Calls:** paid at the call's rate for the measured time both people were on the call page, up to 150% of the booked length; all of one tester's calls on a test can come to at most $1,000 together; unlisted calls at most $200 an hour; a call ends when the $1,000 is reached.
- **Unlisted work:** any amount, $0 included; no Charge.
- **Bank checks, declines, holds:** when a payment needs the bank's confirmation or is declined, the tester's pay is delayed; the developer's tests pause until they pay what they owe; chargebacks add a $15 fee and need a verified card and the team's approval to lift.
- **Payouts:** testers are paid through Stripe once payouts are set up; shares can be held during a tester-side suspension and released after.
- **Subscriptions:** $7/month for the extras, free during launch until the announced date; cancelling keeps them until the end of the paid month.
- **Taxes and refunds:** testers are independent, not employees, and handle their own taxes; refunds only through the team's dispute decisions or a reversed chargeback.
Keep it DRAFT for the lawyer and the version at 2 (nothing has launched), and list "Payments section rewritten" in What changed.

## 7. A required tick about Charge on Post and Edit (owner, Oct 28; replaces the Charge-box line, which is dropped)
- **Post a test** (and posting a draft): a required tick just above the Post button: "I understand that a tester can charge my card, up to the listing price, for work I haven't paid once 7 days have passed since they sent it and their own deadline has passed. How payments work" ("How payments work" links to the Terms' payments section, §6, in a new tab). Post stays refused until it's ticked: red "Tick to confirm you understand how payments work." (the §10 mistake rules from batch 16).
- **Edit:** the same tick appears above Save only while Save is enabled (the form has changes), and is required for that Save; it unticks after each Save. It never shows on an unchanged form.
- The server refuses an unticked Post or Save with the same red line.
- No extra line under the tester's Charge box (dropped by the owner).
- Tests: Post and draft-post refused unticked, Edit tick only with changes, server refusal.

## 8. Post and Edit say that work can arrive after Open until (owner, Oct 28)
The Open until hint today ("Each tester gets the same time from when they join: today to this date (14 days).") doesn't say that late joiners work past Open until. Replace it, live as the date changes:
- **Post:** "Testers can join until this date. Each gets 14 days from when they join, so someone joining on Nov 20 has until Dec 4 to send work. You pay each piece within 7 days of it arriving, or the tester can charge you." (the dates and days computed live: the latest possible deadline = Open until + days per tester).
- **Edit:** the same, with the real days per tester after the change (batch 16 §16: "14 now + 5"): "…Each gets 19 days from when they join, so someone joining on Nov 25 has until Dec 14 to send work. …"
- The Charge tick (§7) stays as written; this line is the explanation above it.
- Tests: the hint's numbers on Post and Edit.

## Check and report
- Tests for each item. Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
