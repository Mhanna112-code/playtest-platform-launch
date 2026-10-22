# Playtest Platform, lean launch version: build spec (owner decisions, Oct 22, 2026)

A fresh, simple rebuild of the core of Playtest Platform. The full app (C:/Users/march/Projects/playtest-platform,
branch integration; plain-English feature list in docs/FEATURES-SPEC.md) is the REFERENCE for wording, money rules
and look, but this version deliberately drops most of its complexity.

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
4. **Stop once, only on the top panel.** The test page's top title panel holds the developer's big buttons:
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
