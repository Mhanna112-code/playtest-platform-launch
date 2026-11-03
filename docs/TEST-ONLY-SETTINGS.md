# Testing-only settings and behaviours (never on the live site)

None of these should be set in Vercel. The admin page's settings box (`src/lib/configProblems.cjs`) names any that are left there.

## Settings (environment variables)

| Setting | What it does when testing | On the live site |
|---|---|---|
| `STRIPE_FAKE=1` | A stand-in for Stripe for recordings (no real card checks) | Ignored in production; the admin box flags it |
| `ALLOW_DEV_OUTBOX=1` | `/dev/outbox` shows sent emails, including reset links | The page is gone (404); the admin box flags it |
| `SKIP_EMAIL_CONFIRM=1` | Lets unconfirmed accounts post, join and apply | Ignored in production; flagged |
| `ANSWER_MIN_CHARS` | Lowers the 50-character answer minimum (the test suite uses 1) | Ignored in production (Nov 2); flagged |
| `LISTING_MIN_CHARS` | Lowers the 10-character title/steps minimum | Ignored in production (Nov 2); flagged |
| `CALL_MIN_AHEAD_MINUTES` | How far ahead a call can be booked (1 minute by default when testing) | Always 24 hours (batch 35 §132); flagged |
| `DISPUTE_WAIT_MS` | How long a chargeback notice waits for its payment to be recorded (tests use 0) | 8 seconds; flagged |
| `UPLOAD_DIR` | Uploads go to the computer's own disk | Uploads go to R2; flagged |
| `TEST_DATABASE_URL` | The test suite's own database schema | Not used |
| `STRIPE_ALLOW_LIVE` | Not testing-only: the safety switch. With live keys and without `1`, every payment action says "Payments are switched off right now." | Set to `1` only when going live on purpose |

## Behaviours that differ when testing

- **Per-network limits** (sign-ups, failed sign-ins, password resets, card attempts): off on a plain local server with no network address. Note: `next dev` sends `::1`, so locally the per-network caps can still apply.
- **Stripe test mode** locally (`sk_test_`): test cards work (4242…, 3184 asks the bank, 0341 declines on charge, 0259 opens a chargeback). Live keys refuse test cards.
- **Chargebacks locally** can't come from Stripe (its notices can't reach a home computer): they're opened with `scratch/cb.ts`, the same function Stripe's notice calls.
- **Moving dates locally**: `scratch/shift-test.ts <testId> <days>` moves one test's dates (never on the live site; Claude doesn't touch the live database).
- **`/api/dev/hook`**: only works with the fake Stripe on a local address; refused everywhere else.
- **Throwaway accounts** (`@playtest.test`, `*@gmail.com` test names): local only.
