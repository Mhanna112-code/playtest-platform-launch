# Batch 23: emails never get lost, and the owner hears when sending fails (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 22.

Today `sendEmail` (src/lib/server/email.ts) posts to Resend and throws on any error, so an email that fails (Resend down, the free plan's 100-a-day cap, a bad key) is lost, and nobody is told.

## 1. Failed emails wait and retry
- Every email is first stored (reuse `OutboxEmail` or a new `EmailQueue`: to, subject, text, html, status pending/sent/failed, attempts, lastError, nextTryAt, sentAt). Sending marks it sent; a failure keeps it pending with the error and a next try.
- The 5-minute sweep (batch 19 §4) retries pending emails: after 5, 15, 30 minutes, then hourly, for 48 hours; then it's marked failed for good (kept, never deleted). Each email is sent at most once (idempotent: Resend's Idempotency-Key header with the email's id).
- A daily-cap error (HTTP 429 / quota) waits until the next day's first sweep instead of burning tries.
- In development without a key, the dev outbox stays as today.

## 2. The owner is told, even when Resend itself is down
- **Admin console:** a red box at the top while any email is waiting or failed: "Emails aren't sending: 12 waiting since 3:10 PM. Resend says: <short error>." and a "failed for good" count with a list; it goes when everything is sent.
- **Admin bell** once per incident: "Emails aren't sending (since 3:10 PM)". (Bell lines are in-app, so they don't depend on Resend.)
- **Outside the app, independent of Resend:** `/api/health` (with HEALTH_KEY) answers "degraded: emails" (still HTTP 200 for the site, plus a keyword the uptime monitor can watch) when emails have been failing for 15+ minutes. Set up a second UptimeRobot "keyword" monitor on that URL that alerts when the keyword appears: UptimeRobot then emails / texts the owner through its own system, so the owner hears even when Resend is down. Document this in HANDOVER (launch steps) and AT-HOME (test: a bad RESEND_API_KEY on staging → the keyword appears → UptimeRobot alerts).
- A daily-cap error says so plainly in the red box: "Resend's daily limit was reached (free plan: 100 a day). Emails will go out tomorrow, or upgrade the plan."

## 3. Tests
Resend failing then recovering (sent once), a 429 waiting to the next day, 48 hours of failures → failed for good, the red box and bell, the health keyword after 15 minutes, no duplicate sends on overlapping sweeps.

## 4. (Dropped by the owner: Post keeps its Open until hint and line as they are.)

## 5. Field-note headings say who changed it (owner, Oct 29)
"Changed in another tab or device at <time>:" only heads changes the developer made elsewhere (their own saves). Changes caused by other people (a tester joining and being given a key, "Ben Okafor joined and was given K-2, which you had deleted here.") sit under "Updated at <time>:". A note with both shows both headings. **Edit keeps what you typed; it shows what the other tab saved (owner, final; replaces batch 16 §19's "box takes the other tab's value"):** for every field, like access keys already do.
  - **A field you haven't touched** takes the other tab's saved value silently (no note), so your Save never undoes it.
  - **A field you typed in keeps your text.** Under it, a blue note shows what the other tab saved: "Saved in another tab or device at 3:54 PM:" and their value (long text folded 3 lines, Show more; short fields inline, e.g. "Spots: 5"), with a small "Use theirs" button that replaces your text with it (and removes the note). Further saves elsewhere update the note's value.
  - **On Save,** for each field where your text differs from what's saved now, the stop-once box says so: "Instructions: your version will replace the one saved in another tab at 3:54 PM." The second press saves yours on top (as today's "Press Save again to save your changes on top").
  - If you make your text match theirs, the note goes.
  - **Tester spots and Open until** keep today's behaviour (owner): they take the other tab's value even if you typed in them, with today's note.
  - **Access keys:** unchanged (the other tab's adds/removes are applied to the Free box, your edits kept on top, and the "Added / Removed" note always shows).
  - "Changed in another tab or device" heads your own saves elsewhere; other people's changes (a tester joining and given a key) sit under "Updated at <time>:".
- Tests: an untouched field updates silently; a typed field keeps your text with the note and "Use theirs"; Save's stop line and second press; matching text removes the note; keys unchanged.

## 6. Chargeback hold: Pay what you owe reserves the money; Approve takes it (owner, Oct 29)
During a **chargeback hold**, Pay what you owe (after the card is verified, batch 17 §41) no longer charges at once: it **authorizes** the owed total on the card (a Stripe PaymentIntent with `capture_method: manual`, with the bank's check inline if asked). Payments shows "Reserved $X: it's taken when the team approves lifting your hold." Stripe shows it "Uncaptured".
- **Admin Approve** captures it and lifts the hold in one step ("The team approved lifting your hold"); the testers waiting on that money are paid then.
- **Not approved / declined by the team:** the authorization is cancelled (nothing taken), the hold stays.
- **Authorizations expire after about 7 days:** if Approve hasn't happened by then, the reservation is released and Payments asks the developer to press Pay what you owe again ("Your reservation expired: press Pay what you owe again so the team can approve it."); the admin's chargeback row shows "Reservation expired".
- Anything added to what's owed after the reservation (a tester's Charge meanwhile) needs a new Pay what you owe for the difference; Approve is refused until the reserved total covers what's owed ("Not yet: $X is owed but $Y is reserved.").
- Payment holds (not chargebacks) keep charging at once on Pay what you owe and their automatic retries.
- The fake Stripe supports authorize / capture / cancel / expire for tests and recordings.
- Tests: reserve then approve (captured once), reserve then expire, a Charge after reserving, Approve refused while short.

## 7. Keep Suspend's Preview, laid out above the boxes (owner, Oct 29; replaces "remove Preview")
Keep the Preview step. Today it sits oddly to the side of the Suspend controls. Lay it out top to bottom: the Preview's effects (which tests pause, which calls get cancelled, who's affected, money waiting) shown first, full width, ABOVE the reason box and the Suspend / side choice, then the reason box, then the button. Same on the profile's admin view and the Accounts list (phones: stacked). The "Since your Preview, …" race check stays.

## 8. (Dropped by the owner: Edit keeps its live box and the "N new updates ↑" pill.)

## 9. "Confirm with your bank" stops once like Pay (owner, Oct 29)
Today the confirm route (src/app/api/payments/confirm, `confirmStart` / `confirmFinish`) runs no stop-once check. On the developer test page (and the Payments link to it), pressing "Confirm with your bank" runs the developer's stop-once gate first, exactly like Pay on that piece: any change the page hasn't shown (a stop / close / End early per batch 17 §12, a dispute, the tester's Charge or Let it go, a Pay or Pay more in another tab, a call change, …, Alerts types apply) stops it once in the blue box under the button; the second press opens the bank's check. Refusals stay plain: already confirmed in another tab ("You already confirmed this payment."), expired ("This confirmation expired: nothing was charged."), cancelled. Pay what you owe's and Subscribe's inline checks keep their own rules (batch 17 §25 exception: Pay what you owe stops when the total changed).
Tests: a tester disputes / the test is stopped / another tab pays, then Confirm stops once and the second press opens the check; already confirmed elsewhere → refused.

## 10. Launch steps and at-home checks
- Add to HANDOVER's launch steps and docs/media/proof/AT-HOME.md: right after going live, **one small real payment ($1) with the owner's own card** between two of their own accounts (a developer paying a tester), checking the real bank's confirmation (if the bank asks), the charge in Stripe live, the tester's transfer, and a refund of it afterwards from the Stripe dashboard.
- AT-HOME, Stripe test mode: the test cards that always ask for the bank's check, always decline, and create a dispute, with what the app and the Stripe dashboard should show for each (incl. a reserved chargeback payment shown "Uncaptured" until Approve).

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- Migration if needed: hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
