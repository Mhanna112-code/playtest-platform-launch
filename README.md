# Playtest (lean launch version)

Developers post a test of their game; testers join on a fixed contract, send written answers, a screen recording,
and/or do a booked live call; the developer pays each piece with one Pay box (or rejects it) and the tester gets 80%.
The rules this build follows are in [LEAN-SPEC.md](LEAN-SPEC.md) (owner decisions, newest sections first).

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, Prisma 6 + Postgres, Stripe (test mode), Resend
(with a dev outbox fallback), Cloudflare R2 for recordings (local disk in dev).

## Run it locally

```bash
npm install
cp .env.example .env          # local Postgres on port 5499; leave keys empty for dev mode
npx prisma migrate deploy     # or: npm run db:migrate
npm run dev                   # http://localhost:3400
```

- Sign up at `/signup` (email + password) and log in at `/login`; Forgot password emails a reset link. With no `RESEND_API_KEY`, emails (confirmation, reset) go to the dev outbox at `/dev/outbox`. Accounts made with the old email links set a password through Forgot password.
- Admin: put your email in `ADMIN_EMAILS` and open `/admin` (disputes, no-show reports, payouts, users, tests, waitlist).
- Without `STRIPE_SECRET_KEY`, Pay presses are recorded as "payments not set up" so the whole flow still works.
- `npm run check` = typecheck + lint + tests + production build. Tests use the `test` schema of the local database
  (`TEST_DATABASE_URL`), never the dev data, and fake Stripe.

## How it works (where to look)

| Area | Code |
| --- | --- |
| All shared rules: fee (20%), Pay box, disputes, call charge, 24-hour cancel, late work, contract snapshot, stop-once, Edit version check, join check | `src/lib/rules.ts` (tests: `tests/rules.test.ts`) |
| Post / edit / stop / end early / next round / join / leave / written answers | `src/lib/server/tests.ts` |
| Pay / Reject, disputes, admin decisions | `src/lib/server/payments.ts`, `src/lib/server/stripe.ts` |
| Live calls (offer, remove, book, cancel, no-show) | `src/lib/server/calls.ts` |
| Recordings (R2 presigned or local disk; 500 MB, 5 per session) | `src/lib/server/recordings.ts`, `src/lib/server/storage.ts` |
| Auth (passwords like the full app: sign up, log in, reset, confirm email; Google if configured), sessions, admin list | `src/lib/server/passwords.ts`, `google.ts`, `session.ts` |
| Developer test page (top panel, live-call panel, Pay boxes, chat) | `src/app/app/tests/[id]/` |
| Tester session page (call panel, answers, recording, chat, disputes) | `src/app/app/sessions/[id]/` |

### Stop once

Every developer button (top panel: Stop the test, End early, Next round; live-call panel: offer/remove times, cancel a
call; Pay / Reject on each piece) sends the time its page loaded. If since then any tester joined, left or sent work, a
call was booked/cancelled, times were offered/removed, or a payment/rejection was made, the first press is refused with
the list, shown directly under that panel; the second press goes ahead. One server gate does this (`devGate`). The
tester's Book / Cancel stop once for call changes they can see. Everything else is simply re-checked on the server and
refused with a plain sentence if it can't happen any more.

### Money

- Testers get 80% of each charge; the platform keeps 20% (Stripe Connect destination charge with an application fee).
- Developers save a card (Stripe Checkout, setup mode) and are charged off-session only when they press Pay, for the
  amount named in the ticked "charged now: $X" box. One charge per press (idempotency key per press).
- A tester without a finished payout account: the charge still happens and their share waits; an admin sends it from
  `/admin` once their account is ready. Stripe card disputes (chargebacks) are handled by hand in the Stripe dashboard.

### Invites, payment hold, auto-pay, Open until

- Invite panel on the test page (filter, Select all, Invite; Cancel invite). Invites expire when the test fills, stops
  or passes Open until; the tester joins with the normal Join. Wording and refusals: `inviteTestRefusal` /
  `inviteTesterRefusal` in `src/lib/rules.ts`; server in `src/lib/server/invites.ts`.
- Payment hold (`src/lib/server/holds.ts`): starts when a failed charge isn't paid within 3 days, or when a chargeback
  opens (Stripe webhook `charge.dispute.created` at `/api/stripe/webhook`, secret `STRIPE_WEBHOOK_SECRET`). All the
  developer's tests pause; sending still works; Pay/Reject, posting, joining, invites, Next round and bookings wait;
  calls in the hold are cancelled. "Pay what you owe" lifts a plain hold, and deadlines, Open until and the 14-day review
  clocks move on by the pause. A chargeback hold has extra steps (`src/lib/server/chargeback.ts`): a card re-verified with
  3D Secure (a Stripe SetupIntent requesting 3DS; simulated without Stripe; set `STRIPE_PUBLISHABLE_KEY` for Stripe's card
  form), what is owed paid, and the admin's Approve. A test paused for 7 days (any cause) is closed by the daily job
  (`src/lib/server/pauseClosure.ts`); the admin can Extend or Close now.
- Daily job `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET` (`vercel.json` schedules it): pays sent
  work unreviewed for 14 days (listing amount; extra work $0, which the tester can flag), starts holds for charges owed
  over 3 days, closes tests paused for 7 days, and sends the Open until heads-ups 3 days and 1 day before.

## Deploying

Set the variables from `.env.example` (DATABASE_URL + DIRECT_URL, APP_URL, RESEND_API_KEY + EMAIL_FROM, STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, CRON_SECRET, R2_*, GOOGLE_* optionally, ADMIN_EMAILS), run `npm run db:deploy`, then `npm run build && npm start`.
For Google sign-in, the redirect URI is `APP_URL/api/auth/google/callback`.

## Outage checks

When the site is online, set up an outside uptime checker so outages are detected automatically (timers move and
missed calls are cancelled without blame):

1. Set a long random `HEALTH_KEY` and `OUTAGE_CHECKS=1` in the production environment.
2. In UptimeRobot (free), add an HTTP(s) monitor with a 5-minute interval for
   `https://<your-site>/api/health?key=<HEALTH_KEY>`.

Only those keyed pings write heartbeats; a gap of more than 15 minutes between two of them is recorded as an outage.
Without `OUTAGE_CHECKS=1` nothing is detected.
