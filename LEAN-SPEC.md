# Playtest Platform, lean launch version: build spec (owner decisions, Oct 22, 2026)

A fresh, simple rebuild of the core of Playtest Platform. The full app (C:/Users/march/Projects/playtest-platform,
branch integration; plain-English feature list in docs/FEATURES-SPEC.md) is the REFERENCE for wording, money rules
and look, but this version deliberately drops most of its complexity.

## (Owner, Oct 22, latest batch: wins over the sections below)
- **Leaving:** testers can leave any time; there are no "marks" in this version, so no "with no mark" wording
  anywhere. Sent work stays payable after leaving. Tester hold line: "This test is paused. Payment for your work may
  be delayed."
- **Admin daily digest:** once a day ONE email to the owner/admins listing every case that needs them (disputes,
  flagged extra work, no-show reports, open chargebacks, holds at 30 days, failed payouts), each with a link. The admin
  page shows the same list. No per-event admin emails.
- **Heads-up notices** (Open until in 3 days / 1 day) are in-app bell notifications only, not emailed.
- **Email settings** (per user, in Settings): "Email me each update" (default) / "One daily summary" / "Don't
  email me" (sign-in links and payment receipts always send). The bell keeps everything.
- **Live calls are blocked during a payment hold and on stopped/closed tests, both sides:** no offering, booking or
  joining; booked calls are cancelled with no fault (tester told: "Your call on Thu, Nov 5 was cancelled because the
  test is paused." / "…because the test was stopped."). Stop the test and End early also cancel that tester's booked
  calls. (There are no call requests in this version: booking is the only way to get a call.)
- **Call length:** after a call, the developer can enter the actual length in minutes on that call ("How long was the
  call? 25 min"); the Pay box's reference then reads "Listing: $40/h × 25 min = $16.67" and starts at that amount.
  Without it, the reference uses the booked length.
- **Payment problems on a call:** a declined Pay shows under that Pay button ("Your card was declined, so Ana Silva
  wasn't paid $16.67 for the call. Update your card in Payments, then press Pay again.") and the tester sees "Payment
  for this call may be delayed." A chargeback on a paid call starts the hold with the stop-once line "Your bank
  reversed your $16.67 payment for Ana Silva's live call".

## (Owner, Oct 22) Invites, chargebacks, payment hold, Open until

### Invite panel (test page only, never in Edit). No moves at all.
- Filterable list of testers (devices, languages, categories), "Select all", Invite; sent invites listed with
  Cancel invite; invites expire when the test fills, stops or passes Open until. The tester joins with the normal Join.
  A developer may invite a tester who works on their other test (separate contract; the other one is untouched).
- Invite stops once for the developer stop-once reasons below PLUS: a ticked tester's profile changed in a way the
  test needs ("Ben Carter removed English, which this test needs · 3:20 PM"); a ticked tester joined meanwhile
  ("Cara Diaz joined this test, so she's no longer in your invite list · 3:22 PM"); already invited in another tab
  ("You also did this in another tab: invited Dee Moss · 3:24 PM").
- Refused for good (tick cleared): full ("This test is full (6 of 6 spots), so nobody can be invited. Add spots in
  Edit to invite more."); stopped ("This test was stopped on Oct 22, so nobody can be invited."); past Open until
  ("Joining closed on Oct 20 (Open until), so nobody can be invited."); tester blocked you OR suspended ("Ben Carter
  can't be invited right now." — never reveal a block or suspension); account deleted ("Ben Carter's account was
  closed, so they can't be invited."); tester in 10 tests ("Cara Diaz can't join more tests right now.").
- Several ticked: invite those who can be invited; the box lists only the others with reasons
  ("Invited Ana Silva and Dee Moss. Ben Carter can't be invited right now.").
- Where: live lines in a blue box at the bottom of the invite panel (and in the box under the top title panel);
  on press, the blue box directly under the Invite button.

### Chargebacks are a developer stop-once reason
- The developer's bank reversing a payment (Stripe dispute webhook) is added to the reason set: "Your bank reversed
  your $8.00 payment for Ana Silva's written answers · 2:14 PM". Testers never see "chargeback"; at most "Payment for
  your work may be delayed." A chargeback also starts the payment hold below.

### Payment hold (owner rule + agreed details)
- Starts when a failed charge isn't paid within 3 days (the developer sees the cut-off), or when a chargeback opens.
  Paying everything owed lifts it at once (chargebacks: when the admin resolves it).
- During a hold: ALL the developer's tests are paused: no new joiners, invites, Next round, new call bookings; booked
  calls in the hold are cancelled with no fault to the tester; no new tests can be posted in any way; Pay and Reject
  wait ("Pay what you owe first."). Testers CAN still send work. Every working tester's deadline, and the test's Open
  until, shift by the length of the pause.
- Testers read only: "This test is paused. Payment for your work may be delayed." They may leave with no mark. Chat
  keeps working.
- After 30 days on hold the admin is alerted to close the tests; testers are told the test ended.
- Review time limit: if sent work isn't paid or rejected within 14 days, the listing amount is paid automatically
  (extra work: $0, which the tester can flag to the admin). The clock pauses during a hold.

### Open until
- Open until can be moved later only BEFORE it passes. Once it passes, joining and sending are over for good and it
  can't be extended. Heads-up notifications (in-app and email) to the developer and working testers 3 days and 1 day
  before ("Harbor Run closes on Oct 25: send your work before then.").

## (Owner, Oct 22) One set of stop-once reasons for the developer
- **The reasons (test-wide, since the page loaded):** any tester **left**, **joined**, **sent work** (new or updated),
  a live call was **booked, confirmed or cancelled** (either side), call times **offered or removed**, or a **payment
  or rejection** was made (e.g. in another tab).
- **The developer's buttons that stop once for ALL of these:** the top panel (Stop the test, End early, Next round),
  the live-call panel (offer/remove times, confirm/cancel a call), and **Pay / Reject** on each piece of work or call.
- **Where the box shows:** directly under the pressed button's area: under the top title panel, under the live-call
  panel, or under that Pay/Reject. Pressing again goes ahead; a final refusal (can't happen any more) shows there too.
- **Reject:** next to Pay on each piece of work/call. A reason is required; nothing is charged; for a contract part
  the tester may dispute once (an admin can only raise the pay); for extra work it's final. Pay and Reject on the same
  piece are mutually exclusive: the second one pressed (other tab) is refused for good ("You already paid $8 for this.").
- **Tester side** stays as before: Book / Cancel in their live-call panel stop once for call changes, with the box
  under their live-call panel.

## (Owner update, Oct 22) Extra work and one Pay box: these override rules 2–3 and the "can only send parts in
## the contract" line in rule 4
- **Testers may send written answers, send a recording, and book live calls even when that part is not in their
  contract** (the listing). Parts in the contract are labelled "In your contract"; others "Extra (not in the listing):
  the developer decides what to pay". Developers see the same labels.
- **Review = one Pay button with an amount box next to it**, per piece of sent work (and per held call). No Accept /
  pay-in-full / pay-different buttons. Beside it:
  - "Listing: $X for written answers" (or recording, or "$Y/h × N min booked"), or "Not in the listing" for extra work;
  - "You've paid Ana Silva $Z so far on this test."
  - The box starts at the listing amount (or empty for extra work). Any amount from $0 up; a reason is required when
    the amount is below the listing amount. A "charged now: $X" tick naming the exact amount must be ticked to press Pay.
  - Pay charges the developer that amount (Stripe, test mode) and pays the tester minus the platform fee; one charge per
    press, never twice (idempotent).
- **Live calls:** any tester in the test may book offered times (contract or not). After the call the developer pays
  with the same Pay box (reference: the listing rate × length, or "Not in the listing").
- **Disputes:** only for parts in the contract paid below the listing amount; once per part; an admin can only raise
  the pay. Extra work: the developer's amount is final.
- **(Owner, Oct 22) Late work:** testers can still send work (and book calls) after their own deadline; it's marked
  "Sent late (deadline was Oct 20)" for both sides. They can't send or book after the test's **Open until** date, nor
  after the developer stopped the test or ended them early (refused with the reason).
- **(Owner, Oct 22) Pay stops once too.** Pay re-checks what the developer saw: if since the page loaded that tester
  sent new or updated work, left, booked or cancelled a call, or another payment to them was made (e.g. in another
  tab), Pay does NOT go through: a box directly **under that Pay button** lists what changed and shows the updated
  "paid so far"; pressing again pays the amount in the box. A payment that can't happen any more (already paid for that
  same piece of work, tester account closed) is refused for good in the same place.

## The loop
Developer posts a test → testers join (their contract is fixed at join) → testers send written answers and an
optional screen recording, and/or do a booked live call → developer reviews sent work and **chooses how much to pay**
(from $0 up to the agreed price) → Stripe charges the developer, tester is paid (Stripe Connect) minus the platform fee.

## Owner rules for this version
1. **No requests at all.** No price asks, drop asks, more-time asks, change/deal offers, counter-offers, moves.
   Every term is listed in the contract from the start: price for written answers, price for a recording, live-call
   rate and length, the tester's deadline (days from joining), questions, device/category needs. **Neither side can
   change a contract after joining.** Edit changes the listing for NEW joiners only.
2. **The developer chooses how much to pay for sent work** at review: Accept in full, or Pay a different amount
   ($0 up to the agreed price for that part) with a reason (required when less than full). The tester can dispute
   once if paid less than agreed; an admin decides (can only raise pay). Charge only on that press, with a
   "charged now: $X" tick naming the amount.
3. **Live calls stay:** developer offers times (and who can book); tester books or cancels (24-hour rule as in the
   full app); join call (simple room or a link); developer enters the call length; charge = rate × length; no-show
   report. Keep it simple: no proposals/counter-proposals, no extra calls.
4. **(Updated Oct 22, owner) Stop once: the only checks, both sides, shown directly under the pressed button's panel.**
   - Triggers (since the page loaded): a tester **left**, a tester **joined**, a tester **sent work**, a live call was
     **booked, its booking accepted/confirmed, or cancelled** (by either side), or call times were offered/removed.
   - Developer: the top-panel buttons (Stop the test, End early, Next round) show their box **under the top title
     panel**; the live-call panel's buttons (offer times, cancel/confirm a call) show theirs **under the live-call panel**.
   - Tester: the live-call panel's buttons (Book, Cancel) stop once for the call triggers above (a time taken, moved,
     removed or cancelled since the page loaded) with the box **under the live-call panel**.
   - Pressing again goes ahead (unless it can't happen any more: then a final refusal in the same place).
   - Testers are never stopped for term changes: contracts can't change after joining. If the developer stops the
     test or ends a tester early, the tester's page shows one line at the top of their session page ("Nora Lane ended
     your session early on Oct 22. Work you sent is still reviewed.") and any later press is refused with that reason.
   - A tester can only send the parts in their contract (written answers, recording, live call as agreed); the server
     refuses anything else.
   Earlier wording of this rule, kept for reference:
   **Stop once, only on the top panel.** The test page's top title panel holds the developer's big buttons:
   **Offer call times / book**, **Stop the test**, **End early** (for a tester), **Next round**. If since the page
   loaded a tester **booked a live call** (or cancelled one), a tester **left**, a **new tester joined**, or a tester
   **sent work**, the press does NOT go through: a box
   directly under the top title panel lists exactly what changed ("Ana Silva sent her written answers · 3:12 PM";
   "Ben Carter left the test"; "Cara Diaz joined") and says "Press again to go ahead." The second press goes ahead.
   That box is the only live-update box on the page. Nothing else stops once.
5. **Everywhere else, the server is the safety net:** every action re-checks on the server; if it can't happen any
   more it is refused with a plain sentence where the button was ("Ana Silva already left the test."). If the page
   is out of date the message adds "Refresh to see the latest."
6. Wording rules from the full app still apply: "they" unless a pronoun is on record; a red * for required, never
   "(optional)"; never tell testers about holds, suspensions or chargebacks (they read "paused" or "delayed").

## Edit and two tabs (the only multi-tab handling)
- The test has a `version` number. Edit's Save sends the version it loaded. If the test changed since (another tab,
  a join that used a spot, Next round, Stop), Save stops once and lists what changed under Save; the second press
  saves the typed values on top (fields the user didn't touch take the newer values).
- Joining sends the listing version the tester saw. If the listing changed since, the join stops once and shows the
  new terms; the second press joins on the new terms. A test that closed/filled/stopped refuses the join for good.
- Spots can't go below the testers already in; Save refuses with the count.
- Deleting or closing the test in one tab: any later press in another tab is refused ("This test was stopped.").
- Contracts are snapshots at join, so Edit never changes working testers' questions, prices, deadline or call terms.

## Keep
Accounts (developer, tester, both; email sign-in links + Google), tester profile (devices, categories, languages),
post/edit a test, find and join, written answers + recording upload (Cloudflare R2 when configured, local disk in
dev; 500 MB, 5 per session), review with pay amount, Stripe charge + Connect payouts + platform fee, live calls as
above, simple per-test chat between developer and each tester, emails for key events (joined, sent, reviewed, paid,
call booked/cancelled), admin (disputes, suspensions, users, tests, payouts, waitlist), waitlist landing page.

## Cut for launch
Several parts per test with per-part requests, extra parts, drops, the change panel, Already completed, invites,
moves, access keys, NDA (a "keep it private" tick on joining instead), excerpts, AI themes/transcripts, ratings,
per-panel live boxes, chargeback automation (handle Stripe disputes manually in admin), outages logic.

## Stack and quality
Next.js 15 + React 19 + TypeScript + Tailwind, Prisma 6 + Postgres (local: postgresql://postgres@localhost:5499/playtest_lite;
tests in schema `test`), Stripe (test mode), Resend (dev outbox fallback), same patterns as C:/Users/march/Projects/rackscout
(auth, outbox, admin, check script, evidence script). Tests for every money rule, the stop-once rule, the version
check, contract snapshots, data isolation. `npm run check` green. Commits with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>".
