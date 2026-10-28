# Batch 15 §41: security fixes from the pre-launch audit

Each finding, the fix, and the test that proves it. The tests are in `tests/batch15-security.test.ts`; the captured output of each
group is beside this file (`security-<id>.txt`). References are to the code after the fix.

| Finding | Fix | Test (output file) |
| --- | --- | --- |
| **C1** payKey namespace collision: a client key could be `choice-<id>` or `dispute-<id>` | The page sends a UUID; the server wraps it as `press:<userId>:<uuid>` (`src/lib/server/pressKeys.ts`). Every server key has its own prefix and a colon (`choice:`, `dispute:`, `owed:`, `cbowed:`, `deferred:`, `sub:`, `subrenew:`, `extra:`, `cbwon:`), which a wrapped key can't produce. Recovery reads `choice:`. Pay, Pay more and chat ids accept UUIDs only (Pay what you owe and Charge never took a client key). | `C1` (security-c1.txt) |
| **H1** admin by email alone | `ADMIN_EMAILS` counts only with a confirmed email (`adminAccount` in `session.ts`); `adminUsers()` likewise. The build stops on a placeholder `ADMIN_EMAILS`. A suspended admin (either side) has no admin access: "Your account is paused." | `H1` (security-h1.txt), and `batch15-config.test.ts` |
| **H2** pre-hijack through Google | Google into an unconfirmed account clears its password, ends every session, drops any payout account, then confirms the email. Payout setup needs a confirmed email. | `H2` (security-h2.txt) |
| **M1** every Stripe error counted as a decline | Only a card error is a decline. Connection / Stripe API errors leave the payment pending for the §9 check; anything else fails the press with "Payments are having a problem right now. Nothing was charged; try again shortly." with no hold and nothing owed. Raw Stripe text is only logged (also L4: "Pay what you owe" names failures in plain words). Renewals that fail for a non-card reason are tried again the next day. | `M1` (security-m1.txt) |
| **M2** Pay more race | The repeat check, the room check and the reservation run in one transaction under the test's row lock; `Payment (kind, payKey)` and `(kind, pressKey)` are unique (migration `20261031130000_security_keys`). | `M2` (security-m2.txt) |
| **M3** fail-open production settings | The build stops in production without `STRIPE_SECRET_KEY`, without R2, with `ALLOW_DEV_OUTBOX=1`, with `STRIPE_FAKE=1`, with a placeholder `HEALTH_KEY` / `ADMIN_EMAILS` / `EMAIL_FROM`, or without `APP_URL`. `fakeOn()` is off in production; `/dev/outbox` is admin-only everywhere; `appUrl()` never falls back to the Host header in production. | `M3` (security-m3.txt), and `batch15-config.test.ts` |
| **M4** fake outages | Down and up run on the server's clock (when each alert arrived); an alert more than 10 minutes off is refused; an outage over 24 hours is stored as "needs approval" and moves nothing until an admin approves it in the console; the key is compared in constant time and accepted in the `x-health-key` header too. | `M4` (security-m4.txt) |
| **M5** stored type ≠ declared type on R2 | The PUT signs `content-type`; the GET carries `response-content-type` and `response-content-disposition` (inline only for images and videos). | `M5 and M6` (security-m5-m6.txt) |
| **M6** R2 grows without limit | Removing a recording deletes its file; the daily job deletes uploads not finished within 3 hours and stored files with no row; 3 GB of uploads per account a day ("You've uploaded a lot today. Try again tomorrow."). | `M5 and M6` (security-m5-m6.txt) |
| **L1** headers | `poweredByHeader: false`, HSTS, Permissions-Policy and the CSP in `next.config.ts` (Jitsi `meet.jit.si` for the call room; Stripe.js; the R2 host). | `L1` (security-l1.txt) |
| **L2** rate limits | Forgot password 10 per network an hour; chat 30 messages a minute per person; waitlist 5 per network an hour; at most 50 kept forms per person (the oldest dropped); `clientIp` uses `x-real-ip`, else the LAST `x-forwarded-for` hop. | `L2` (security-l2.txt) |
| **L3** duplicates | Stripe event ids are stored (`StripeEvent`) and a repeat delivery is skipped; a doubled Confirm claims the payment once. | `L3` (security-l3.txt) |
| **L5** state changes on GET | `/app/switch` changes sides only on a POST from this site (a link answers with a small form that sends itself from our own pages); card and payout setup make Stripe objects only on POST. | `L5 and L6` (security-l5-l6.txt) |
| **L6** sign out everywhere | "Sign out of all devices" in Settings. | `L5 and L6` (security-l5-l6.txt) |
| Dependencies | The Next.js and Prisma major upgrades are left for after launch (noted in HANDOVER section 10). | n/a |

Check the CSP in a browser after deploying (call room, Stripe pop-ups, recordings): a developer's own meeting link (not Jitsi) can't be framed under it, so its
"Open the room in a new tab" link is the way in.
