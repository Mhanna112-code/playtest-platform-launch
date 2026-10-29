# Playtest (lean): developer handover

This file says how the app is **built**. How it **behaves** (every page, button, notice and rule) is in
[DESIGN-DOC.md](DESIGN-DOC.md), the product guide. Where a behaviour matters here, this file links to the guide's
section rather than repeating it.

Decision history, in the order it was written (a later file wins where they differ):
[LEAN-SPEC.md](../LEAN-SPEC.md) (newest sections first), [NEXT-UI.md](NEXT-UI.md), then
[BATCH-4.md](BATCH-4.md) through [BATCH-14.md](BATCH-14.md). The guide was written alongside them and can lag the
latest batch in places (for example the review window is 7 days since batch 12). When the guide and a later batch
disagree, the batch and the code win. [README.md](../README.md) has a short quick start.

Written Oct 27, 2026, from a read of the code at commit `5f057a3` (batch 14).

---

## 1. Overview

### Stack

| Layer | What | Notes |
| --- | --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind 3.4 | Pages are server components; interactive parts are small `"use client"` components next to them |
| Data | Prisma 6.19, PostgreSQL | One schema file, `prisma/schema.prisma`. Money is always whole cents (`Int`) |
| Payments | Stripe (cards via Checkout setup mode, Connect Express payouts, Billing for the subscription) | Optional in dev: without a key, presses are recorded as "payments not set up" |
| Email | Resend over plain `fetch` | Batch 23: every email is stored first (`EmailQueue`) and retried by the 5-minute sweep until sent (48 hours, then failed for good). Without a key (development), emails go to the dev outbox table (`/dev/outbox`) |
| Files | Cloudflare R2 through presigned URLs (hand-rolled SigV4 in `storage.ts`) | Without R2, files go to `./uploads` on local disk (dev only) |
| Sign-in | Email + password (bcryptjs), optional Google | Sessions are random tokens; only the SHA-256 hash is stored |
| Tests | Vitest against a separate Postgres schema | Route handlers are called directly with `Request` objects |
| Hosting (planned) | Vercel + Neon | `vercel.json` schedules the daily job |

### Folder layout

| Path | What lives there |
| --- | --- |
| `src/app/` | Pages and API routes (App Router). `page.tsx` files are server components |
| `src/app/app/` | Every signed-in page (`/app/...`). `layout.tsx` is the signed-in shell (header, side switch, restricted links, `SessionWatch`) |
| `src/app/admin/` | The administrator console (`/admin`) |
| `src/app/api/` | JSON API routes. Most mutations go through a few action routes: `tests/[id]/[action]`, `sessions/[id]/[action]`, `admin/[action]` |
| `src/components/` | Shared client components (press buttons, stop-once box, live notices, pop-ups, long lists) |
| `src/lib/` | Pure, shared rules and helpers that run on both server and client (`rules.ts`, `limits.ts`, `subscription.ts`, `pause.ts`, `bell.ts` ...) and browser helpers (`client.ts`, `usePress.ts`, `live.ts`) |
| `src/lib/server/` | Server-only logic: one module per area (payments, holds, tests, joining ...). Routes are thin and call these |
| `src/middleware.ts` | Redirects signed-out visitors away from `/app/*` and `/admin` (cookie presence only; pages and APIs re-check the session) |
| `prisma/` | `schema.prisma` and hand-written migrations (see section 7) |
| `tests/` | Vitest suites, `helpers.ts` (`makeUser`, `req`, `params`, `json`), `fixtures.ts`, `global-setup.ts` |
| `scripts/` | `evidence.cjs` and `media.cjs`: Playwright scripts that drive a running app and save screenshots and videos |
| `docs/` | The guide, the decision batches, `media/` (screenshots for the guide), `evidence/` |

### How a request flows

1. **Page load.** `src/middleware.ts` checks the `pt_session` cookie exists and passes the path in an `x-path` header.
   `src/app/app/layout.tsx` loads the user (`requirePageUser` in `src/lib/server/page-auth.ts`), decides the side
   (`sideFor` in `src/lib/sides.ts`) and redirects a restricted account away from closed pages (`closedForSuspended`).
   The page itself reads the database through Prisma (`src/lib/db.ts`) and renders. Pages that a restricted account
   must never see call `requireOpenPage` / `requireOpenDevPage` before rendering anything.
2. **A press.** Client components call `api()` in `src/lib/client.ts`. It sends JSON with an `x-tab` header (this page
   load's id) and an `x-uid` header (the account the page belongs to), and adds the page's "seen" marker to the body.
3. **The route.** Each route wraps its body in `handle()` (`src/lib/server/http.ts`), reads the body with `readJson()`
   (JSON only, size-limited, same-origin check), checks the user with `requireUser` / `requireActive`, then calls one
   function in `src/lib/server/`.
4. **Server logic.** The area module re-checks everything against the database (usually in a `db.$transaction` with a
   `SELECT ... FOR UPDATE` row lock via `lockTest`), runs the stop-once gate (`devGate` / `testerGate`), writes the
   change, records a `TestEvent` and/or `ActionLog` row, and creates bell lines (`notify` / `bell`). A Pay press, for
   example, reserves the `Review` and a `pending` `Payment` in a transaction and calls Stripe after it commits
   (`review` in server/payments).
5. **Errors.** Any `HttpError(status, code, message, data)` becomes `{ error: { code, message, ...data } }`. The client
   turns 400/413 into red field errors and everything else into a blue notice under the button
   (`ChangesBox`). Codes such as `suspended`, `held`, `admin_stopped` and `account_changed` also move the tab
   (see `api()` in `src/lib/client.ts`).
6. **Shared rules.** Anything that both the page and the server must agree on (amounts, caps, limits, wording,
   deadlines) is a pure function or constant in `src/lib/` (mostly `rules.ts` and `limits.ts`), so the UI and the
   server can't drift.

---

## 2. Code map

"Rules" means `src/lib/rules.ts`; "server/x" means `src/lib/server/x.ts`.

| Area | What it does | Files | Key functions |
| --- | --- | --- | --- |
| **Auth and sessions** | Email + password sign-up and log-in, reset and confirm links, optional Google, 30-day sessions, admin check, the side switch | server/passwords, server/session, server/google, server/page-auth, server/users, `src/middleware.ts`, `src/lib/sides.ts`, `api/auth/*`, `app/login`, `signup`, `forgot`, `reset/[token]`, `verify/[token]`, `app/app/switch/route.ts` | `signUp`, `logIn`, `requestReset`, `resetPassword`, `changePassword`, `sendVerification`, `confirmEmail`, `createSession`, `getUserFromRequest`, `requireUser`, `isAdmin`, `startGoogle`, `finishGoogle` (batch 20 §5: a new Google account goes to `/signup/google` first: `startGoogleSignup`, `pendingGoogleSignup`, `finishGoogleSignup`, `api/auth/google/finish`), `requireConfirmed`, `confirmSkipped`, `sideFor`; batch 20 §16: an admin account is admin only (no side; `adminAway` in server/adminPages moves it off developer and tester pages to /admin) |
| **Tests and Edit** | Post, edit (with the per-field 3-change limit), drafts and Next round, stop, end early; the contract snapshot; Switch / Keep offers; question sets | server/tests, server/terms, `src/lib/limits.ts`, `src/lib/answerSets.ts`, `src/lib/questions.ts`, `src/lib/byQuestion.ts`, `app/app/tests/TestForm.tsx`, `tests/new`, `tests/[id]/edit`, `api/tests/route.ts`, `api/tests/[id]/[action]` | `createTest`, `editTest` (batch 23 §5: Edit keeps what you typed, the shared rule in `src/lib/editMerge.ts`: `mergeElsewhere`, `replaceLine`; the notes `TheirsNote`, `GroupNote` in `components/FieldNote.tsx`), `postDraft`, `openDraft`, `deleteDraft`, `stopTest`, `endEarly`, `nextRound`, `parseListing`, `stampCounting`, `startedCounting`, `CLOSING_FIELDS`, `INFO_FIELDS`; limits: `CRITICAL_FIELDS`, `PART_FIELDS`, `countsOf`, `countersOf`, `lockedFields`, `countingSince`, `criticalLine`; rules: `checkListing`, `contractSnapshot`, `editCheck`, `termsDiff`; terms: `offerNewTerms`, `decideTerms`, `testerTermsGate`; answer sets: `itemsOf`, `prevSetsOf`, `carryOver`, `pushPrev` |
| **Joining, invites, applications** | Join, Apply, invite-only, Ask to rejoin, Leave, test capacity, invites and their re-send after an edit | server/joining, server/invites, server/tests (`joinTest`, `leaveTest`), server/capacity, `src/lib/capacity.ts`, `src/lib/gaps.ts`, `app/app/find/[id]/JoinBox.tsx`, `tests/[id]/Applications.tsx`, `InvitePanel.tsx`, `api/invites/[id]` | `join`, `apply`, `withdrawApplication`, `decideApplication`, `askToRejoin`, `joinRefusal`, `listingGate`, `closeApplicationsAfterEdit`, `joinTest`, `closeOnFull`, `leaveTest`, `invitable`, `inviteTesters`, `cancelInvite`, `reinviteAfterEdit`; rules: `joinCheck`, `inviteTestRefusal`, `inviteTesterRefusal`, `canAskToRejoin` |
| **Access keys** | Keys typed in Edit; the oldest free key is given at join; testers report a broken key; the read-only Access keys notice | server/accessKeys, `src/lib/keys.ts`, `tests/KeyBoxes.tsx`, `tests/[id]/KeysNotice.tsx`, `sessions/[id]/KeyBox.tsx` | `assignKeyAtJoin`, `keyBoxes`, `reportKeyBroken`, `planKeyChange`, `applyKeyChange`, `checkTypedKeys`, `openSpotsOf`; `parseKeys`, `keyRefusal` |
| **Calls and requests** | Call requests from either side (once, daily, weekly, Forever), booking, cancelling, joining the room, measured call length, no-shows, `.ics` files | server/requests, server/calls, server/blocks (`joinCall`, `callStatus`), `src/lib/callRows.ts`, `src/lib/ics.ts`, `tests/[id]/DevCallPanel.tsx`, `sessions/[id]/TesterCallPanel.tsx`, `components/CallRequests.tsx`, `app/app/calls/[id]/CallRoom.tsx`, `api/calls/[id]/*` | `devRequestTime`, `testerRequestTime`, `answerRequest`, `closeRequests`, `cancelCallSet`, `topUpForeverSets`, `devCancelCall`, `testerCancelCall`, `heartbeat`, `finishMeasuring`, `reportNoShow`, `sweepNobodyJoined`, `joinCall`; `src/lib/callMeasure.ts`: `measureOverlap`, `measureIsFinal`, `callMinutesOf`, `callLengthLine`, `callOverBadge`, `callIsOver`, `CALLS_TOTAL_CENTS`; server/callMoney: `callsUsedCents`, `callsLeftCents`, `ceilingRefusal`; rules: `canCancelCall`, `checkCancel`, `joinCallRefusal`, `callJoinable` (batch 15 §15, §34, §40, §42: the app measures each call; nobody enters a length). Batch 21: the built-in call room (WebRTC between the two browsers, adapted from the full app) replaces Jitsi: `app/app/calls/[id]/CallRoom.tsx`, the relay `api/calls/[id]/room` (`roomPoll`, `roomSend`, `roomLeave`, `iceServers`), the length measured from the time both browsers were connected, the server ending calls (`callEndState`, `endCall`: 150%, the $1,000, or a block / pause / suspension / leave / End early / Stop), `components/CallCheck.tsx` (the camera and microphone check) |
| **Submissions, recordings, attachments** | Written answers (formatted, up to 50,000 characters, stored as question sets), the Recording part (up to 5 recordings sent together), files and recordings attached to written parts, kept drafts | server/tests (`sendWritten`), server/recordings, server/storage, server/kept, `src/lib/upload.ts`, `src/lib/markdown.ts`, `src/lib/useKept.tsx`, `components/Formatted.tsx`, `ScreenRecorder.tsx`, `sessions/[id]/RecordingUpload.tsx`, `WrittenAttachments.tsx`, `api/recordings/[id]/upload`, `api/recordings/[id]/file`, `api/kept` | `sendWritten`, `startRecording`, `finishRecording`, `removeRecording`, `sendRecording`, `canView`, `uploadTarget`, `viewUrl`, `saveLocal`, `readLocal`, `r2On`, `uploadToSession`, `parseFormatted`, `getKept`, `setKept`; rules: `checkWrittenLength`, `WRITTEN_MAX_CHARS` |
| **Review, Pay and caps** | One Pay box per piece (Pay and Pay more; batch 15 §30: no Reject, $0 needs a reason), the ticks, notes, call rate and amount filling each other, "Lower the length", per-piece caps and the $1,000 for a tester's calls, the 20% fee | server/payments, server/callMoney, server/stripe (`charge`), rules, `tests/[id]/NeedsYou.tsx`, `PayBox.tsx`, `api/review/route.ts`, `api/tests/[id]/[action]` (`pay-extra`, `lower-length`) | `review`, `finishReviewPay`, `payExtra`, `finishExtraPay`, `pieceRoom`, `overRoomLine`, `paidSoFar`; rules: `checkPay`, `REASON_WHEN_UNDER_LISTING`, `ZERO_PAY_REASON`, `payUnderLine`, `paidZeroLine`, `payTicks`, `checkExtraPay`, `pieceMaxCents`, `extraCapCents`, `splitFee`, `NO_LISTING_WORK_CAP_CENTS`, `NO_LISTING_CALL_RATE_CAP_CENTS`, `EXTRA_PAY_CAP_PERCENT`; callMeasure: `amountFromRate`, `rateFromAmount`, `overCeilingLine` |
| **Charge and disputes** | The tester's Charge / Let it go once the review date passes (written answers, recordings and, batch 15 §15, listed calls); disputes on any reviewed part; the developer's side (optional, never stopped, works while restricted: batch 15 §27); the admin's decision (stops once for a side that arrived after the admin's page loaded) | server/holds (`chooseOutcome`), server/payments, rules, `sessions/[id]/ChoiceBox.tsx`, `tests/[id]/DisputeSide.tsx`, `app/admin/DisputeDecision.tsx` | `chooseOutcome`, `openDispute`, `addDevSide`, `decideDispute`, `disputeBounds`; rules: `chargeOpensAt`, `chargeIsOpen`, `chargeAmount`, `canDispute`, `checkDisputeDecision`, `checkDevSide`, `REVIEW_DAYS` |
| **Holds, chargebacks, retries, bank confirmation** | A declined charge starts a payment hold at once; chargebacks (with the $15 fee) start a chargeback hold; Pay what you owe; daily retries (max 7); the 3D Secure card check; "your bank wants to confirm" (press and away); won chargebacks | server/holds, server/chargeback, server/confirm, server/stripe, `src/lib/bankConfirm.ts`, `src/lib/pause.ts`, `components/OwedBox.tsx`, `ChargebackSteps.tsx`, `app/app/payments/ConfirmList.tsx`, `api/payments/owed`, `api/payments/confirm`, `api/payments/verify-card`, `api/stripe/webhook` | `declinedPayment`, `startHold`, `owed`, `owedLines`, `payOwed`, `retryOwed`, `liftHoldIfClear`, `approveHoldLift`, `chargeDeferred`, `chargebackOpened`, `chargebackWon`, `shiftAfterPause`, `resumeTests`; `chargebackSteps`, `startCardVerification`, `finishCardVerification`, `approveChargebackHold` (batch 23: captures the reservation), `reserveOwed`, `reserveState`, `expireReservations`, `releaseReservations`, `declineChargebackReserve`, `authorize` (server/stripe); `pressAction`, `awayAction`, `confirmStart`, `confirmFinish`, `release`, `expireActions`, `pieceLocked`; `chargePlatform`, `refundPayment`, `sendWaitingTransfer` |
| **Suspensions and restricted pages** | Admin suspension and reinstatement; a held or suspended developer is "restricted" (pages closed, presses refused except a short list); team pause and stop of one test; 7-day close of paused tests; testers' paused rules | server/restrictions, server/users (`requireActive`), server/pauseClosure, server/page-auth, `src/lib/restricted.ts`, `src/lib/closedPages.ts`, `src/lib/pause.ts`, `components/RestrictedBox.tsx`, `app/app/CallsBox.tsx` | `suspendAccount`, `reinstateAccount`, `previewSuspension`, `pauseTest`, `unpauseTest`, `adminStopTest`, `cancelCallsNearPause`, `cancelLatePauseCalls`, `releaseHeldShares`, `requireActive`, `failedLine`, `closePausedTest`, `closePausedTests`, `extendPauseClosure`, `pausedReminders`; `restrictionOf`, `devRestricted`, `RESTRICTED_OK_ACTIONS`, `OPEN_FOR_RESTRICTED`, `closedForSuspended`, `restrictedOn`, `requireOpenPage`; rules: `pausedForTesters`, `testerPaused`, `PAUSE_DEFAULTS` |
| **Deletion** | Self or admin deletion: leaves tests, cancels calls, invites and applications, ends the subscription, closes excerpt requests; the warnings with real numbers | server/restrictions (`deleteAccount`), server/deletion, server/excerpts (`excerptsOnDelete`), server/subscription (`endOnDelete`), `app/app/account/DeleteAccount.tsx`, `api/account/delete` | `deleteAccount`, `devDeleteLines`, `testerDeleteFacts`, `testerDeleteLines`, `excerptsOnDelete`, `endOnDelete`; rules: `testerPayable`, `PAYABLE_TESTER`, `devDeletedLine`, `deletedNoPayoutsLine` |
| **The subscription** | $7/month perks, free plan limit (1 open test; 10 for subscribers), Stripe Billing or "manual" billing, pause and resume with holds, lapse after declined renewals, free during launch (`FREE_UNTIL`) | `src/lib/subscription.ts`, server/subscription, `app/app/payments/SubscriptionBox.tsx`, `components/SubscribeLink.tsx`, `api/payments/subscription` | `SUBSCRIPTION_CENTS`, `PERKS`, `MAX_OPEN_TESTS`, `launchFrom`, `subscribed`, `subState`, `periodEnd`; `launchState`, `hasPerks`, `requirePerk`, `canOpenAnother`, `subscribe`, `cancelSubscription`, `keepSubscription`, `pauseBilling`, `resumeBilling`, `renewalFailed`, `lapse`, `renewSubscriptions`, `subscriptionWebhook`, `freeLaunchNotices` |
| **Excerpts** | A tester asks to show a short quote of paid written work on their profile; the developer allows or denies; hidden while the test has an NDA | server/excerpts, `components/Excerpts.tsx`, `ExcerptList.tsx`, `api/excerpts` | `requestExcerpt`, `decideExcerpt`, `removeExcerpt`, `excerptChoices`, `excerptSource`, `shownExcerpts`, `myExcerpts`, `pendingForDeveloper` |
| **Notifications, bell stacking, emails** | Every update is a bell line; lines stack per test per day or per kind per day; emails are summaries sent by the daily job; a few lines ignore email Off; admin daily email | server/notify, server/email, server/adminDaily, `src/lib/bell.ts`, `src/lib/alerts.ts`, `app/app/notifications/BellList.tsx`, `AlertSettings.tsx`, `components/AlertsMenu.tsx`, `api/notifications/read`, `api/account/notify`, `api/account/alerts`, `app/dev/outbox` | `notify`, `bell`, `inReach`, `sendSummaries`, `adminUsers`, `sendEmail`, `outboxEnabled`, batch 23: `retryEmails`, `emailHealth`, `emailsDegraded`, `clearFailedEmails`, `adminDailyEmails`, `bellKey`, `GROUP_TITLES`, `groupTitle`, `ALERT_TYPES`, `alertOf`; rules: `summaryDue` |
| **Live updates and stop-once** | Open pages poll a fingerprint and refresh; a live top box lists changes; every press sends a "seen" marker and is stopped once if something it hadn't shown changed; tabs stay signed in as the same account | `api/pulse`, `api/live`, `components/AutoRefresh.tsx`, `LiveTop.tsx`, `LiveNotices.tsx`, `SessionWatch.tsx`, `ShellWatch.tsx`, `ChangesBox.tsx`, `src/lib/live.ts`, `src/lib/usePress.ts`, `src/lib/topStop.ts`, server/live, server/testerGate, server/actionText, server/tests (`devGate`) | `devGate`, `devGateIfSeen`, `testerGate`, `testerChanges`, `devChanges`, `ownChanges`, `logAction`, `logEvent`, `recordEvent`, `withRenamed`, `asLines`, `logTestAction`, `logTesterAction`, `joinPageChanges`; rules: `stopOnce`, `DEV_STOP_KINDS`, `DEV_QUIET_KINDS`, `DEV_EXEMPT_KINDS`, `TESTER_EXEMPT_KINDS`; client: `usePress`, `seenNow`, `useLiveAppend`, `announceAuth` |
| **Outages** | Off unless `OUTAGE_CHECKS=1`. Batch 15 §10: outages come from the uptime service's own alerts (`POST /api/health/alert`, a down then an up on the server's clock). Batch 26 §1: a real full stop is always recorded: an up alert with no stored down records the outage from its `alertDuration` (start = up minus the duration), and the sweep's own heartbeat (`sweep-last` in AppState, checked by every sweep and at server start) records a gap of 15 minutes or more; overlapping ones merge (never twice). One over 24 hours waits for an admin's Approve | server/outages, `api/health`, `api/health/alert`, `instrumentation-node.ts`, the admin console's Outages | `recordAlert`, `recordGap`, `sweepGap`, `SWEEP_LAST_KEY`, `parseAlert`, `alertRefusal`, `recordOutage`, `approveOutage`, `adminOutages`, `outageLines`, `outageChecksOn`, `healthKeyOk`, `healthKeyOf` |
| **The admin console** | Disputes, decided, my actions, users, tests, no-shows, payments, reports, holds and chargebacks, paused tests; suspend, pause, stop, approve, Allow 3 more (batch 22: no held shares; waiting payouts are a read-only list, sent on their own when the tester's payout setup is done) | `app/admin/page.tsx`, `AdminBoxes.tsx`, `AdminButton.tsx`, `DisputeDecision.tsx`, `PagedList.tsx`, `PreviewButton.tsx`, `api/admin/[action]`, `api/admin/more`, server/adminLists, server/reports | `adminPage`, `disputeRow` (with "See the work", batch 15 §8), `testRow`, `adminEmails` (batch 15 §21: every admin action is an `AdminAction` row and admin views name the admin by email), `userTotals`, `KINDS` (with `contact`), `adminCases` (holds.ts), `reportPerson`, `reportCounts`, `accountEvent`. Actions in `api/admin/[action]`: `decide`, `suspend`, `unsuspend`, `preview-suspension`, `delete-account`, `pause-test`, `unpause-test`, `stop-test`, `allow-critical-changes`, `approve-hold`, `approve-chargeback`, `approve-outage`, `extend-pause`, `close-paused`, `contact-replied` (batch 22 §5: `unpause-test` records its own `AdminAction` with the lift, so a second admin's press names the first) |
| **The daily jobs** | One cron route runs the daily jobs; the uptime check's keyed `/api/health` runs the time-sensitive sweep every 5 minutes (section 5) | `api/cron/daily/route.ts`, `api/health/route.ts`, server/holds (`runDaily`, `runSweep`), server/timers | `runDaily`, `runSweep`, `withTimersLock`, `healthSweep` |
| Other | Ratings, chat, blocks, reports, profiles, Contact us | server/ratings, server/messages, server/blocks, server/reports, server/profileStats, `api/help` | `testerRate`, `devRate`, `rateBlocker`, `ratingReminders`, `sendChat`, `chatAccess`, `unreadCount`, `blockUser`, `reportPerson`, `developerStats`, `testerStats` |

Behaviour for each area is in the guide: [Edit test](DESIGN-DOC.md#edit-test),
[Join page](DESIGN-DOC.md#join-page), [Developer test page](DESIGN-DOC.md#developer-test-page),
[Tester session page](DESIGN-DOC.md#tester-session-page), [Payments](DESIGN-DOC.md#payments),
[Money](DESIGN-DOC.md#money), [Holds and suspensions](DESIGN-DOC.md#holds-and-suspensions),
[Deletion](DESIGN-DOC.md#deletion), [Plans and the subscription](DESIGN-DOC.md#plans-and-the-subscription),
[The bell](DESIGN-DOC.md#the-bell), [Emails](DESIGN-DOC.md#emails),
[How state stays consistent](DESIGN-DOC.md#how-state-stays-consistent),
[Administrator console](DESIGN-DOC.md#administrator-console). Later batches that changed these: Edit limit
(batch 14 §1-2), excerpts (batch 13), deletion (batch 12 §1), call caps (batch 12 §2), bank confirmation and retries
(batch 11 §3-4, batch 12 §5), access keys (batch 14 §6).

### Where the stop-once pieces sit

- **Server.** `devGate` (server/tests) is the one developer gate; `testerGate` (server/testerGate) the one tester gate.
  Each collects changes since the press's `seenAt` (or the stop box's `boxAt` on a second press), throws
  `HttpError(409, "stop_once", ..., { changes })` the first time, and lets a `confirmed: true` press through if nothing
  newer happened. Reason E ("you did this in another tab") comes from `ActionLog` rows, filtered by the `x-tab` id.
- **Kinds.** `DEV_STOP_KINDS` lists what stops a developer; `DEV_QUIET_KINDS` (`terms`, `key`) are live-box lines that
  never stop (batch 14 §4, §6); `DEV_EXEMPT_KINDS` and `TESTER_EXEMPT_KINDS` document every other event kind and why it
  doesn't stop. Add a new event kind to one of these lists.
- **Client.** `usePress` keeps the box state and the `boxAt` marker; `ChangesBox` renders the blue box under the button (batch 15 §36: "Your <button> didn't go through.", "Since you opened this page:", the Alerts lines, bold "Press <button> again to go ahead."; the label comes from `src/lib/pressLabels.ts`, refusals read "Your <button> didn't go through: <reason>");
  `LiveTop` shows the live top box and advances the "seen" marker (`seenNow`), so a press only stops for what the page
  hadn't shown.
- **Exceptions.** Excerpt requests ignore stop-once (batch 13 §3). A drop in the open-test count never stops (batch 12 §4). Batch 15: Leave and Block never stop (§25); the developer's side of a dispute never stops (§27); Stop and End early go through silently while a test is paused for any cause (§29, §37); a tester with Alerts Off (`User.testerAlertsOff`, §26) is stopped only by changes to their contract (`CONTRACT_KINDS`: a terms offer, their key marked working).

---

## 3. Data model

All in `prisma/schema.prisma`. Status fields are plain strings; the values below are the ones the code writes.

| Model | What it is | Important status fields and values |
| --- | --- | --- |
| `User` | One account: developer, tester or both; Stripe ids; hold, suspension and subscription state | `side` `"developer"\|"tester"\|""`; `suspendedAt`, `reinstatedAt`, `deletedAt` + `deletedBy` `"self"\|"admin"`; `holdStartedAt` + `holdReason` (`"chargeback"`, `"unpaid"`, ...), `holdCount`, `holdApprovedAt`, `holdRetries`; `chargebackCardVerifiedAt`, `chargebackApprovedAt`; `subscriptionStatus` `"none"\|"active"\|"past_due"\|"ended"`, `subscriptionEndReason` `"cancelled"\|"lapsed"\|"deleted"`, `subscriptionId` (Stripe id or `"manual"`), `subscriptionPausedAt`; `emailPref` `"off"\|"daily"\|"weekly"\|"monthly"`; `payoutsReady`; `testerLimit`; `ignoredAlerts` |
| `LoginToken` | One-use reset and confirm links (hash only) | `kind` `"reset"\|"verify"\|"login"` (old) ; `usedAt`, `expiresAt` |
| `Session` | A signed-in browser (hash only) | `expiresAt` |
| `TesterProfile` | A tester's devices, languages, categories, bio | |
| `Test` | A listing | `status` `"draft"\|"open"\|"closed"\|"stopped"` ("Full" and "Paused" are derived); `joinMode` `"anyone"\|"apply"\|"invite"`; `adminPausedAt`, `adminStoppedAt`; `pausedSince`, `pauseCloseAt`, `pauseClosedAt`; `criticalCounts` (JSON: one count per limited field plus `since`); `version` (any change, checked by Edit) and `listingVersion` (terms, checked by Join); `openUntil` (every tester's deadline since batch 12) |
| `TestEvent` | What happened on a test: feeds stop-once boxes and the live top box | `kind`: see `DEV_STOP_KINDS` / `DEV_EXEMPT_KINDS` in rules; `link` (batch 15 §35: the row a live line opens, e.g. a new dispute's) |
| `Contract` | A tester's place in a test; a snapshot of the terms at join | `status` `"working"\|"left"\|"ended"`; `endKind` `"early"\|"stopped"\|"closed"`; `termsSwitchedAt`; `prevSets` (JSON, earlier question sets) |
| `Submission` | Sent (or drafted) written answers or the Recording part; one per contract and kind | `kind` `"written"\|"recording"`; `answers` (JSON set `[{question, required, answer}]`); `agreedCents` (null = not listed); `payBy`, `choiceOfferedAt`, `choiceBy`; `setUntil` |
| `Recording` | One uploaded file (video or attachment) | `part` `"recording"\|"written"`; `uploadedAt` (null while uploading); `submissionId` |
| `Review` | The developer's one Pay on a piece (submission or call; batch 15: $0 with a reason, no Reject; old rows may still be `rejected`) | `rejected`, `auto`, `payKey` (unique: one charge per press), `rateCents` |
| `Payment` | Every charge or attempted charge | `kind` `"review"\|"call"\|"extra"\|"dispute"\|"chargeback"\|"subscription"`; `status` `"pending"\|"charged"\|"not_set_up"\|"failed"\|"owed"\|"paying"\|"needs_action"\|"needs_confirmation"\|"refunded"` (code also reads `"deferred"`); `transferStatus` `"none"\|"sent"\|"waiting"\|"sending"\|"refunded"` (batch 22: no `"held"`; `"waiting"` shares go out on their own, `sendWaitingShares`, when the payout setup is done); `chargeback` `""\|"open"\|"resolved"\|"won"`; `repaysId`; `actionPi`, `actionBy` |
| `Dispute` | A tester's dispute of one reviewed piece | `status` `"open"\|"decided"\|"withdrawn"`; `devSide`; `decidedCents` |
| `CallSlot` | The time slot behind a call (created when a request is booked) | `status` `"open"\|"booked"\|"removed"` |
| `Call` | One booked call | `status` `"booked"\|"cancelled"`; `cancelledBy` (`"tester"`, `"system"`, ...); batch 15 §40: `measuredMinutes`, `measuredFrom`, `measuredTo`, `measuredAt` (null = in progress / measuring), `actualMinutes` + `lengthNote` (a length lowered with its reason, or one logged before measuring); §15: `payBy`, `choiceOfferedAt`, `choiceBy`, `devMarks`, `remindedAt`, `devRemindedAt`; `noShowBy` `"developer"\|"tester"`; `setId` |
| `CallPresence` | Batch 15 §40: one stretch a person had the call page open (heartbeats every ~10 s; a gap of 5 minutes starts a new one) | `side` `"developer"\|"tester"`; `startAt`, `endAt` |
| `TestChange` | Batch 15 §43: one Save that changed the terms or the names (the developer's Contract changes) | `fields`, `before`, `after`, `effects`; offers it made carry `TermsOffer.changeId` |
| `ContractNote` | Batch 15 §24: a non-offer entry in one tester's contract changes | `kind` `"renamed"` |
| `AdminAction` | Batch 15 §21: every admin action with the admin who did it | `action` (the admin route's action), `targetId` |
| `CallRequest` | "Request a time" from either side | `fromSide` `"developer"\|"tester"`; `status` `"pending"\|"booked"\|"declined"\|"withdrawn"\|"closed"\|"taken"`; `rows` (JSON) |
| `CallSet` | A daily or weekly run of calls | `repeat` `"daily"\|"weekly"`; `count` (0 = Forever); `status` `"active"\|"cancelled"\|"ended"` |
| `Message` | Per-test chat between the developer and one tester | |
| `ChatRead` | When each person last opened a chat (unread badges) | |
| `KeptForm` | Typed-but-not-sent form text, per person and form | |
| `OutboxEmail` | Emails written instead of sent when `RESEND_API_KEY` is empty | |
| `EmailQueue` | Batch 23 §1: every email sent through Resend, stored first | `status` `"pending"\|"sent"\|"failed"` (failed for good, kept); `attempts`, `lastError`, `errorKind` (`"cap"`: Resend's daily limit), `nextTryAt` (also a try's claim), `giveUpAt` (48 hours of tries), `clearedAt` (cleared from the admin's failed list) |
| `Reservation` | Batch 23 §6: a chargeback hold's Pay what you owe, authorized on the card (manual capture) | `status` `"pending"\|"needs_action"\|"reserved"\|"captured"\|"cancelled"\|"expired"\|"failed"`; `covers` (the owed Payment ids); `expiresAt` (7 days) |
| `Invite` | The developer invites a tester | `status` `"sent"\|"cancelled"\|"joined"\|"declined"\|"replaced"` |
| `Notification` | One bell line | `own`, `groupKey`, `payment`, `mustEmail`, `reminderKey`, `readAt`, `summarizedAt` |
| `AppState` | Small app-wide key/values | keys such as `stripe-sub-product`, `free-told-30`, `free-told-7`, `free-ended` |
| `TermsOffer` | New terms offered to a working tester after an Edit | `status` `"open"\|"switched"\|"kept"\|"superseded"` |
| `Block` | One person blocked another (never shown to the blocked person) | |
| `Application` | Apply to join, or Ask to rejoin | `kind` `"apply"\|"rejoin"`; `status` `"pending"\|"accepted"\|"declined"\|"withdrawn"\|"joined"`; `closedReason` `"listing"\|"invite_only"` |
| `ActionLog` | Everything a person did on a test, with the tab that did it (reason E) | `tab` |
| `Rating` | One rating per side per contract | `side` `"tester"\|"developer"`; `revealedAt` |
| `Heartbeat` | A keyed `/api/health` ping | |
| `Outage` | A recorded gap of over 15 minutes | `startAt` (unique), `ms` |
| `AccessKey` | One access key of a test | `status` `"free"\|"inuse"\|"broken"\|"held"\|"retired"`; batch 15 §44-45: `reusedFrom`, `reusedBroken` (typed back from a tester who left or finished), `brokenDismissedAt` (the developer's Dismiss, per report), `fixedAt` (marked working) |
| `Report` | "Report <name>", one per pair | |
| `AccountEvent` | Admin history of holds and suspensions | `kind` `"hold"\|"hold-lifted"\|"hold-approved"\|"suspended"\|"reinstated"` |
| `ContactMessage` | A Contact us message (up to 50,000 characters; the admin list) | `repliedById`, `repliedAt` |
| `Excerpt` | A tester's excerpt request or shown excerpt | `status` `"pending"\|"shown"\|"denied"\|"closed"`; `hideProduct` |

Some schema comments are older than the code (for example `criticalCounts` still says prices and the build link are not
limited, `Review.auto` says 14 days, `Test.deadlineDays` is no longer used for new joins). The code and the batches win.

---

## 4. Settings and environment variables

The template is [.env.example](../.env.example). Never commit `.env*` files (the `.gitignore` already excludes them).
"Required" means required for the live site.

| Variable | What it does | Required | Safe default |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma connection (pooled URL in production) | Yes | local `postgresql://postgres@localhost:5499/playtest_lite` |
| `DIRECT_URL` | Prisma `directUrl`, used by migrations (Neon's direct, unpooled URL) | Yes (Prisma reads it from the schema) | same as `DATABASE_URL` locally |
| `TEST_DATABASE_URL` | Vitest's database. Must name a schema other than `public`; must be localhost unless `CI` is set | Tests only | `...playtest_lite?schema=test` |
| `CI` | Lets Vitest use a non-local test database | No | unset |
| `APP_URL` | The site's address in email links, Stripe return URLs and the Google redirect | Yes | `http://localhost:3400` |
| `VERCEL_PROJECT_PRODUCTION_URL` | Set by Vercel; used for links only when `APP_URL` is empty | No | (Vercel) |
| `NODE_ENV` | Set by Next. `production` makes cookies `Secure`, hides `/dev/outbox` and ignores `SKIP_EMAIL_CONFIRM` | (automatic) | |
| `RESEND_API_KEY` | Sends email through Resend (batch 23: stored in `EmailQueue` first; a failure waits and is retried). Empty in development: every email is written to the `OutboxEmail` table instead; empty in production: emails wait, with the missing key as their error | Yes | empty (outbox) |
| `EMAIL_FROM` | Sender address (must be on the verified Resend domain) | Yes | `Playtest <onboarding@resend.dev>` in code |
| `ALLOW_DEV_OUTBOX` | `1` shows `/dev/outbox` in production. Staging only | No | empty |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google; the button shows only when both are set. Redirect URI `APP_URL/api/auth/google/callback` | No | empty |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | (Batch 21 §4) An optional TURN relay for the built-in call room (for example a free-tier TURN service; `TURN_URL` may list several comma-separated `turn:`/`turns:` URLs). Without it the two browsers connect directly through Google's free STUN servers, which fails on a few strict networks (some offices, some mobile carriers): the room then says "Couldn't connect directly (a strict network?). Try another network, or reschedule." and nothing is measured. With it, those calls go through the relay | No | empty |
| `STRIPE_SECRET_KEY` | Stripe API key. Empty: presses are recorded as `not_set_up`, nothing is charged | Yes | empty |
| `STRIPE_ALLOW_LIVE` | `1` allows an `sk_live_` key; without it a live key is refused ("Payments are switched off") | Yes for live | empty |
| `STRIPE_PUBLISHABLE_KEY` | `pk_...` for Stripe.js pop-ups (3D Secure card check, bank confirmations). Empty: the page simulates the pop-up, so with real Stripe the bank's confirmation can't be completed in the page | Yes with Stripe | empty |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the platform endpoint `APP_URL/api/stripe/webhook`. With neither webhook secret set the route answers 503 | Yes with Stripe | empty |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | (Batch 15 §5) Signing secret of the Connect endpoint ("events on connected accounts"), same URL. The route accepts either secret | Yes with Stripe | empty |
| `OWNER_EMAIL` | (Batch 15 §12) Only this admin sees the red "Settings to fix" box; unset, every admin sees it | No | empty |
| `STRIPE_FAKE` | `1` uses an in-process fake Stripe, only with no secret key and a localhost `APP_URL` (evidence and media runs) | Never in production | empty |
| `FREE_UNTIL` | ISO date when "free during launch" ends. Unset or unparsable: free with no end. Set it at least 30 days ahead (developers are told 30 and 7 days before) | Decide at launch | empty |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 for uploads, only when all four are set | Yes (local disk doesn't work on Vercel) | empty (local disk) |
| `UPLOAD_DIR` | Local-disk upload folder when R2 is off | No | `./uploads` (tests use `.test-uploads`) |
| `CRON_SECRET` | Bearer token for `GET /api/cron/daily`. Empty: the route answers 503 | Yes | empty |
| `ADMIN_EMAILS` | Comma-separated admin emails (in addition to `User.isAdmin`) | Yes | `owner@example.com` in the template |
| `OUTAGE_CHECKS` | `1` turns outage recording on (from the uptime service's alerts, batch 15 §10) | Decide at launch | `0` |
| `HEALTH_KEY` | Secret the uptime service sends as `?key=` on its ping and on its alert webhook `POST /api/health/alert`. The keyed ping runs the 5-minute sweep of reminders and timers (batch 19 §4) and, with `OUTAGE_CHECKS=1`, writes heartbeats | Yes (the sweep needs it) | a long random value |
| `SKIP_EMAIL_CONFIRM` | `1` skips the email-confirmation requirement (a strip says so). Ignored in production | Must be off | `0` |
| `CALL_MIN_AHEAD_MINUTES` | How many minutes ahead a call request's time must be when not in production (batch 27 §6, `src/lib/callLead.ts`). Production always uses 5, whatever this says | No (ignored in production) | `1` |
| `NEXT_DIST_DIR` | Build output folder, so a check or second server doesn't overwrite the running dev server's `.next` | No | `.next` |
| `BASE`, `FAKE_BASE`, `ONLY`, `ADMIN`, `PLAYWRIGHT_BROWSERS_PATH` | Read by `scripts/evidence.cjs` / `scripts/media.cjs` only | No | see the script headers |

Numbers that are not environment variables live in code: `LIMITS` in `src/lib/limits.ts` (every length, count and
range), money and timer constants in `src/lib/rules.ts` (`PLATFORM_FEE_PERCENT`, `REVIEW_DAYS`, `HOLD_RETRY_MAX`,
`CHARGEBACK_FEE_CENTS`, the caps), `src/lib/subscription.ts` (`SUBSCRIPTION_CENTS`, `MAX_OPEN_TESTS`, `RETRY_DAYS`),
`src/lib/pause.ts` (`PAUSE_CLOSE_DAYS`) and `src/lib/server/storage.ts` (upload limits).

### Stripe webhook events

`src/app/api/stripe/webhook/route.ts` verifies the signature with `STRIPE_WEBHOOK_SECRET`, then with `STRIPE_CONNECT_WEBHOOK_SECRET` (batch 15 §5:
either is accepted; a bad signature with both is a 400) and handles:

| Event | Handler | Effect |
| --- | --- | --- |
| `charge.dispute.created` | `chargebackOpened` | Chargeback: amount plus fee added to what is owed; chargeback hold |
| `charge.dispute.closed` (status `won`) | `chargebackWon` | Amount and fee leave what is owed, or are refunded if already paid |
| `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.deleted` | `subscriptionWebhook` | Stripe Billing renewals, declines, bank confirmation, end |
| `payout.failed`, `payout.paid`, `account.updated` (connected accounts) | `payoutProblem`, `payoutFixed` | The tester's payout banner and reminders |

Two endpoints at the same URL (both listed in `.env.example`):

- **Platform endpoint** (events on your account): `charge.dispute.created`, `charge.dispute.closed`, `invoice.paid`,
  `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.deleted`. Secret: `STRIPE_WEBHOOK_SECRET`.
- **Connect endpoint** ("events on connected accounts"): `account.updated`, `payout.failed`, `payout.paid`. Secret:
  `STRIPE_CONNECT_WEBHOOK_SECRET`. A tester's payout account is ready when `payouts_enabled` and the `transfers` capability is
  `active` (batch 15 §4; `charges_enabled` doesn't matter for these receive-only accounts).

**API version (batch 28 §10).** The installed stripe-node 23 speaks API `2026-09-30.endive`; every call and webhook field was checked against it
(and against Stripe test mode). Create both endpoints with that API version. On it, PaymentIntents take `allowed_payment_method_types` (the old
`payment_method_types` is refused), an invoice has no `payment_intent` or `subscription` (`subscriptionWebhook` reads
`parent.subscription_details.subscription` and asks Stripe for `invoice.payments`; the old fields are still read for an endpoint on an older version),
Subscribe confirms the first invoice's PaymentIntent itself with `return_url` (a `default_incomplete` subscription leaves it unconfirmed), and a
cancelled Subscribe check cancels the subscription (Stripe refuses to cancel an invoice's PaymentIntent). (Batch 28 §17) A tester's share sent after
the charge (a share that waited for payout setup, a payment taken from a chargeback hold's reservation) is a transfer with `source_transaction` set to
that charge: it needs no available platform balance and arrives when that charge's money does; the daily job sends again any share still waiting for a
tester whose setup is done.

### Settings checked loudly (batch 15 §12)

`configProblems()` (`src/lib/configProblems.cjs`) lists every settings problem with a plain fix. `npm run build` runs
`scripts/check-config.cjs` first: a `FREE_UNTIL` that isn't a date, a live Stripe key without the publishable key or a
webhook secret, only some R2 settings, or production without `RESEND_API_KEY` fail the build (on Vercel the old version stays
live). The rest only warn: they are logged once at server start (`src/instrumentation.ts`) and shown in a red box at the top
of the admin dashboard to `OWNER_EMAIL` (every admin when unset). In production without `RESEND_API_KEY`, `sendEmail` throws
and logs; it writes to the outbox only with `ALLOW_DEV_OUTBOX=1`.

---

## 5. Background and daily jobs

**Batch 19 §4: the 5-minute sweep.** Vercel's free plan only runs crons daily, so the time-sensitive work runs from the
uptime check: every `GET /api/health?key=HEALTH_KEY` (UptimeRobot, every 5 minutes) runs `runSweep()` after answering
(Next's `after`; where that isn't available it waits at most 8 seconds). The sweep is the 15-minute call reminders, calls
ending at the $1,000, nobody-joined cancels and final call lengths (`sweepNobodyJoined`), Charge opening for sent parts and
listed calls with their "pay it" and Charge reminders (`openCharges`, `callCharges`), the close-out reminders
(`closeOutReminders`), the developer's review reminders (`reviewReminders`) and the rating reminders (`ratingReminders`).
It runs under one lock (`AppState` key `timers-lock`, taken over after 4 minutes if a run died), shared with the daily job,
so two never run at once; a sweep error is logged and never changes the health answer or records an outage. Without the key
nothing runs. **HANDOVER: UptimeRobot's 5-minute check now also drives reminders and timers, so the monitor must stay on**
(and keep `HEALTH_KEY` set); if it stops, those wait for page loads, polls and the daily job.

**Batch 23 §1-2: emails never get lost.** `sendEmail` (server/email) stores every email in `EmailQueue` first, then posts it to Resend with the
row id as Resend's `Idempotency-Key`. A failure (Resend down, a bad key) keeps it pending with the error; the sweep (`retryEmails`, first step of
`runSweep` and `runDaily`) tries it again after 5, 15 and 30 minutes, then hourly, for 48 hours, then marks it failed for good (kept, never deleted). Each try
claims the row first (its `nextTryAt` moves 10 minutes on), so overlapping sweeps send it once. Resend's daily limit (HTTP 429 naming a quota) makes every
email wait until the next UTC day's first sweep without counting against the 48 hours (`AppState` `email-cap-until`). The owner hears three ways: a red box at the
top of the admin console ("Emails aren't sending: 12 waiting since 3:10 PM. Resend says: …", or the daily limit in plain words, plus the failed-for-good list
with "Clear this list"), one admin bell line per incident ("Emails aren't sending (since 3:10 PM)", `AppState` `email-incident`), and the keyed
`/api/health`, which answers `{"ok":true,"emails":"degraded: emails"}` (still HTTP 200) once the oldest waiting email is 15 minutes old (otherwise
`"emails":"sending"`). A second UptimeRobot **keyword** monitor on that URL alerts through UptimeRobot's own emails and texts, so it works while Resend is down
(launch checklist). In development without a key, emails still go to the dev outbox.

**Batch 23 §6: a chargeback hold's Pay what you owe reserves.** During a chargeback hold, Pay what you owe (after the card check) authorizes what is owed and
not yet reserved as one PaymentIntent with `capture_method: manual` (`reserveOwed` / `authorize`; the bank's check inline if asked; a `Reservation` row).
Nothing is taken: Stripe shows it "Uncaptured" and Payments says "Reserved $X: it's taken when the team approves lifting your hold." The admin's **Approve**
(`approveChargebackHold`) captures it (once: the first press claims the approval), pays the owed payments it covers (the testers' shares are transferred, or
wait for their payout setup) and lifts the hold in one step; it is refused while what is reserved doesn't cover what is owed ("Not yet: $X is owed but $Y is
reserved."), for example after a tester's Charge (which needs its own Pay what you owe for the difference). **Don't approve** (`declineChargebackReserve`)
cancels it (nothing taken; the hold stays). An authorization lapses after 7 days (`RESERVE_DAYS`; `expireReservations` in the sweep): it is released, Payments
says "Your reservation expired: press Pay what you owe again so the team can approve it." and the admin's row "Reservation expired". Payment holds (not
chargebacks) still charge at once.

**Trigger.** `vercel.json` schedules `GET /api/cron/daily` at `0 9 * * *` (09:00 UTC). Vercel sends
`Authorization: Bearer $CRON_SECRET`; any other scheduler must do the same. The route calls `runDaily()` in
`src/lib/server/holds.ts`, which returns a small JSON of counts (only some of the counters are filled in). Each step
records what it already did (marks such as `notifiedMarks` / `devMarks`, `remindedAt`, `AppState` keys), so a second run
on the same day should not repeat notices, but test that before scheduling it more often.

**What `runDaily` does, in order:**

| # | Step | Function |
| --- | --- | --- |
| 1 | Cancel calls nobody joined | `sweepNobodyJoined` (server/calls) |
| 2 | Expire bank confirmations that timed out (15 minutes for a press, 3 days for an away charge) | `expireActions` (server/confirm) |
| 3 | Retry what is owed for developers on a payment hold with a saved card (Stripe on only; max 7 per hold; never during a chargeback hold, batch 22 §1) | `retryOwed` |
| 4 | Sent work past its review window: daily developer reminders; open Charge / Let it go for the tester; tester reminders | inline, using `chargeIsOpen`, `choiceLine` |
| 5 | The admins' daily email | `adminDailyEmails` (server/adminDaily) |
| 6 | Paused-test reminders, then close tests paused for 7 days | `pausedReminders`, `closePausedTests` (server/pauseClosure) |
| 4b | Batch 15 §15: a listed call past its review date: daily developer reminders; Charge / Let it go for the tester (measured length × rate, within the $1,000) | `callCharges` |
| 7 | Open until countdown notices to the developer (batch 15 §18: when the test closes to new testers) | inline, `countdownDue`, `joinClosingLine` |
| 7b | Batch 16 §1: each working tester's own deadline reminders (1 month, 1 week, 3 days, 1 day before THEIR deadline; only marks still ahead when they joined). Sent marks are kept per contract and per deadline in `Test.notifiedMarks` as `due:<contractId>:<deadline ms>:<mark>` (no migration); a moved deadline sends only the marks still ahead of it | inline, `deadlineMarksFor`, `ownDeadlineMarkDue`, `ownDeadlineLine` |
| 8 | Batch 15 §2: the developer's review reminders, the same for listed and unlisted parts and listed calls (1 month if it was over a month away, 3, 2 and 1 weeks, 3 days, 1 day before the review date) | inline, `reviewMarksFor`, `reviewMarkDue` |
| 9 | Batch 15 §15/§40: unlisted calls: one weekly "Pay your calls" line per developer, stacked across tests, until paid | `payYourCalls` |
| 10 | Daily invite reminders | inline, `INVITE_REMIND_DAYS` |
| 11 | Book the next calls of Forever sets | `topUpForeverSets` (server/requests) |
| 12 | Cancel a restricted developer's calls 3 days ahead; payout-problem reminders; the suspended-accounts review reminder | `cancelLatePauseCalls`, `payoutReminders`, `suspendedAccountsReminder` (server/restrictions) |
| 13 | Manual subscription renewals; free-during-launch notices | `renewSubscriptions`, `freeLaunchNotices` (server/subscription) |
| 14 | Application reminders, rating reminders | `dailyReminders` (internal to holds.ts), `ratingReminders` (server/ratings) |
| 14b | Batch 15: payments stuck in progress (§9), unfinished uploads and orphan files (§41 M6), old sign-in attempts (§7), applications and invites after Open until (§18) | `checkStuck`, `purgeUploads`, `cleanLoginAttempts`, `closeJoiningAfterOpenUntil` |
| 15 | Send every pending email (summaries, end-of-day payment and must-send emails) | `sendSummaries` (server/notify) |
| 0 | Batch 23: before the rest, emails that failed are tried again when due, and chargeback reservations past their 7 days are released (also every 5 minutes, in the sweep) | `retryEmails` (server/email), `expireReservations` (server/chargeback) |

**Not in the cron:**

- `GET /api/pulse` (polled about every 20 s by pages with `AutoRefresh`) also runs `sweepNobodyJoined`, so calls
  nobody joined are cancelled, and (batch 15 §40) measured lengths become final, within a minute or so while anyone has such a page open.
- `GET /api/health?key=HEALTH_KEY` runs the 5-minute sweep (above) and writes heartbeats for information; outages come from `POST /api/health/alert` and (batch 26 §1) from a gap of 15 minutes or more between sweeps (only with `OUTAGE_CHECKS=1`).
- Stripe webhooks drive chargebacks, Billing renewals and payout status.
- Bell lines are written at the moment of the action. **Emails are only sent by step 15**, so "end-of-day email" in the
  guide means "when the daily job runs". The exceptions are sent at once: reset and confirmation links, Contact us
  messages to the team (`api/help`), and notices to an email that has no account.

---

## 6. Running, testing and checking

### Local development

```bash
npm install                 # postinstall runs prisma generate
cp .env.example .env        # local Postgres on port 5499; keys empty = dev mode
npx prisma migrate deploy
npm run dev                 # http://localhost:3400
```

With no `RESEND_API_KEY`, read emails at `/dev/outbox`. Put your email in `ADMIN_EMAILS` to open `/admin`.

For testing calls locally, a call request may start 1 minute from now (production keeps 5 minutes; set `CALL_MIN_AHEAD_MINUTES`
to change the local lead). The call room still opens 10 minutes before the start.

### The full check

```bash
NEXT_DIST_DIR=.next-build npm run check
```

`check` runs, in order: `tsc --noEmit` (typecheck), `next lint`, `vitest run` (all tests) and `next build`.
`NEXT_DIST_DIR=.next-build` sends the build to `.next-build/` so it doesn't overwrite a running dev server's `.next/`
(`next.config.ts` reads it; `tsconfig.json` includes `.next-build/types`). In PowerShell:
`$env:NEXT_DIST_DIR=".next-build"; npm run check`.

### Tests

- `vitest.config.ts` points `DATABASE_URL` and `DIRECT_URL` at `TEST_DATABASE_URL` (default: the `test` schema of the
  local database), refuses the `public` schema and non-local hosts (unless `CI`), and blanks every outside service:
  no Resend, Stripe, Google or R2; uploads go to `.test-uploads/`.
- `tests/global-setup.ts` runs `npx prisma migrate deploy` against the test schema before every run (it creates the
  schema the first time). Nothing is wiped: each test makes its own users with unique emails (`makeUser` in
  `tests/helpers.ts`), so the test schema grows over time; drop the `test` schema to start clean.
- Tests call the route handlers directly (`import { POST } from "@/app/api/..."`) with `req()` from `tests/helpers.ts`.
  Stripe is replaced per test with `setStripeForTests` (server/stripe).
- Files run one at a time (`fileParallelism: false`). Many files are named after the batch or spec section they cover
  (`batch4.test.ts` ... `batch14.test.ts`, plus older ones); `rules.test.ts` covers the pure rules.

### Checking with a dev server running (`.prisma-verify`)

`prisma generate` rewrites `node_modules/.prisma`, which a running `next dev` holds open (on Windows the engine file is
locked). To check a schema change without stopping the dev server, this machine uses a second Prisma client:

- `prisma/schema.verify.prisma`: a copy of `schema.prisma` whose generator adds `output = "../.prisma-verify/client"`.
  Re-copy it after every schema change.
- `npx prisma generate --schema prisma/schema.verify.prisma` writes the client to `.prisma-verify/client`.
- `npx tsc --noEmit -p tsconfig.verify.json` typechecks with `@prisma/client` mapped to that client.
- `npx vitest run --config vitest.verify.config.ts` runs the same tests with the same mapping.

These three files and `.prisma-verify/` are **local only**: they are listed in `.git/info/exclude`, not committed. A
new machine must recreate them from the description above, or simply stop the dev server and run the normal check.

### Screenshots and videos (`scripts/media.cjs`)

- Records the guide's screenshots and videos into `docs/media/` (captions in `docs/media/captions.json`). It drives a
  running app at `BASE` (default `http://localhost:3400`) with the dev outbox on.
- It uses Playwright from the sibling full-app repo (`C:/Users/march/Projects/playtest-platform/node_modules/playwright`)
  and launches **Microsoft Edge** (`chromium.launch({ channel: "msedge" })`). Video uses that repo's `ffmpeg-static`.
- On this machine, run it from **PowerShell**, for example `$env:ONLY="dash,edit"; node scripts/media.cjs`. The script's
  own setup examples use PowerShell syntax.
- `ONLY` picks groups (the `group("...")` calls). At commit `5f057a3` the groups are `every`, `dash`, `post`, `edit`,
  `testpage`, `tpvideo`, `tpstop` and `check`. The working copy was being extended when this was written (phone and
  desktop sizes via `SIZES`, and money, outage and plan groups against a second server on `FAKE_BASE`, port 3450, started
  with `STRIPE_FAKE=1`); the script's header comment is the source of truth.
- Every run makes fresh **throwaway accounts** (`dev+media<timestamp>@playtest.test`, `tester+media...`). When it sets
  up a state directly in the database (`psql` on port 5499), its `own()` guard only allows queries that name its own
  rows. Its password is read from `scripts/evidence.cjs`.
- `scripts/evidence.cjs` (`npm run evidence`) is the older end-to-end evidence run (`docs/evidence/summary.json`); it
  needs `ALLOW_DEV_OUTBOX=1` under `next start` and `ADMIN_EMAILS` containing its `ADMIN`.

---

## 7. Database changes

`prisma migrate dev` fails on this machine's local Postgres cluster: its `template1` database is damaged, so Prisma can't
create the shadow database it needs. Migrations are therefore written **by hand**:

1. Change `prisma/schema.prisma`.
2. Write the SQL in a new folder `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` (timestamp later than the
   newest folder). Prisma can draft it for you: run the diff command below with `--script` instead of `--exit-code`,
   then review the SQL. Data moves (for example copying old values into a new column) are added by hand.
3. Check that the migrations and the schema agree. The shadow database `playtest_lite_shadow` already exists on the
   local cluster, so Prisma doesn't need to create one:

   ```bash
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma \
     --shadow-database-url "postgresql://postgres@localhost:5499/playtest_lite_shadow" \
     --exit-code
   ```

   It must print "No difference detected" (exit code 0; 2 means they differ).
4. Apply it, **with the dev server stopped** (it holds the Prisma client open):

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

   Then restart `npm run dev`. The test schema picks the migration up on the next `vitest run` (global setup).
5. Production: `npm run db:deploy` (`prisma migrate deploy`) with `DATABASE_URL` and `DIRECT_URL` pointing at Neon.
   Nothing runs it automatically at build time today.

### Batch 23 migration (applied to the local dev database)

`20261105090000_email_queue_reservations` adds the tables `EmailQueue` (§1: every email sent through Resend, stored first, with its tries) and
`Reservation` (§6: a chargeback hold's Pay what you owe, authorized on the card until the team's Approve). Checked with `prisma migrate diff --exit-code`
against `playtest_lite_shadow`; applied with `prisma migrate deploy` to the local `playtest_lite` database only. A running dev server needs a restart to load
the new client. Production: `npm run db:deploy`.

### Batch 21 migration (applied to the local dev database)

`20261104090000_call_room` (batch 21: the built-in call room replaces Jitsi) adds `Call.endedAt` / `Call.endReason` (the server ended the call: `length`, `calls_cap`,
or what closed it: `blocked`, `paused`, `stopped`, `left`, `ended`), `Call.devSeenAt` / `Call.testerSeenAt` (each side's latest room poll) and the table
`CallSignal` (the room's relayed connection messages, deleted when the call ends). `CallPresence` now holds the stretches the two browsers were connected.
`User.callCheckId` (the old Jitsi practice room) is no longer used but kept (no column drops). Checked with `prisma migrate diff --exit-code` against
`playtest_lite_shadow`; applied with `prisma migrate deploy` to the local `playtest_lite` database only. A running dev server needs a restart to load the new
client. Production: `npm run db:deploy`.

### Batch 20 migration (applied to the local dev database)

`20261103090000_age_confirmed` adds the nullable `User.ageConfirmedAt` (batch 20 §5: when the account confirmed it is 18 or older: the sign-up tick, Google's
sign-up step). Only sign-up asks (batch 20 §21): accounts made before it have no value and are not asked again; the updated-Terms tick asks only about the Terms. Checked with `prisma migrate diff
--exit-code` against `playtest_lite_shadow`; applied with `prisma migrate deploy` to the local `playtest_lite` database only. A running dev server needs a restart
to load the new client. Production: `npm run db:deploy`. Google's pending sign-ups (the step's 30 minutes) are `AppState` rows `google-signup:<sha256 of the
cookie's token>`; no table was added for them.

### Batch 15 migrations (not yet applied to the dev database)

Batch 15 adds thirteen migrations, `20261031090000_login_attempts_time_zone` through `20261031210000_admin_actions`:
login attempts and time zones, payment recovery, suspension sides, chat client ids, security keys, Contact us messages,
tester days, call measuring (`CallPresence`, with a backfill that marks past calls as measured from their logged
length), tester alerts, contract changes, key reports, event links and admin actions. To apply them to the
local dev database: stop `npm run dev` (port 3400), then in PowerShell

```powershell
$env:DATABASE_URL="postgresql://postgres@localhost:5499/playtest_lite"; $env:DIRECT_URL=$env:DATABASE_URL
npx prisma migrate deploy
npx prisma generate
```

and start `npm run dev` again. (Set `DIRECT_URL` too: the schema's `directUrl` is what migrate uses.)

### Batch 16 migration

Batch 16 adds one hand-written migration, `20261031220000_drop_waitlist`: it drops the `WaitlistEntry` table (section 7: no
waitlist; the site launches with open sign-up). It is already applied to the local `playtest_lite` database; no hosted
database has the table. Batch 16's per-tester deadline reminders need no migration (they reuse `Test.notifiedMarks`).

Batch 16's new pieces, for finding them: field mistakes on every form (`components/FieldChecks.tsx`: server marks,
`MistakeList`; `components/FormMistakes.tsx`; Post/Edit's message-to-field map in `lib/listingFields.ts`), blocks hiding a
developer's other tests (`server/blocks.ts`: `hiddenByBlock`), the invite search (`server/invites.ts`: `invitePanel`), the
tester dashboard's "Search by developer" (`lib/devSearch.ts`, `app/app/DevSearch.tsx`), the plain scroll boxes
(`components/ScrollList.tsx`), "Your tests with <name>" (`lib/testerTests.ts`, `components/TesterTests.tsx`), the Open until
cap (`openUntilCapDay` in `lib/rules.ts`) and Edit's cross-tab notes (`components/FieldNote.tsx`, `editNews` in
`server/tests.ts`).

### Batch 17 migration

Batch 17 adds one hand-written migration, `20261101090000_test_visits`: the `TestVisit` table behind the tester dashboard's
"Tests visited" (section 18: one row per tester and test, `visitedAt`). It is applied to the local `playtest_lite` database;
restart `npm run dev` after pulling it (the Prisma client changed). Everything else in batch 17 is computed: the rating
windows and their pauses (`server/ratings.ts`: `testerRateState`, `devRateStates`), the stop-once for a stop while a page
is open (`server/stopMoment.ts`) and the close-out dates (`server/closeOut.ts`: `closeOutOf`, `pieceCloseOut`).

On a fresh, healthy Postgres cluster (a new machine, Docker, Neon) none of this is needed: `npm run db:migrate`
(`prisma migrate dev`) works as normal, and the hand-written migrations stay valid.

---

## 8. Launch checklist

- [ ] **GitHub.** The repo has no remote yet. Create a private GitHub repository and push `master`. Protect the default
      branch before adding collaborators (section 9).
- [ ] **Neon.** Create the database; set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct). Run `npm run db:deploy`.
- [ ] **Vercel.** Import the repo; set every variable from section 4 for Production (and Preview, with test keys).
      Set `APP_URL` to the real https address. Confirm the cron from `vercel.json` appears and `CRON_SECRET` is set.
- [ ] **Stripe, live.** `STRIPE_SECRET_KEY` = live secret key, `STRIPE_ALLOW_LIVE=1`, `STRIPE_PUBLISHABLE_KEY` = live
      publishable key. Turn on **Connect** (Express accounts, transfers capability) and complete the platform profile.
- [ ] **Stripe webhooks.** Two endpoints, both at `APP_URL/api/stripe/webhook` (events in section 4): the platform endpoint
      (secret in `STRIPE_WEBHOOK_SECRET`) and a Connect endpoint, "events on connected accounts" (secret in
      `STRIPE_CONNECT_WEBHOOK_SECRET`).
- [ ] **Resend.** Verify the sending domain; set `RESEND_API_KEY` and `EMAIL_FROM` on that domain. Send yourself a reset
      link to test. Without the key, live emails would silently go to the outbox table.
- [ ] **Cloudflare R2.** Create the bucket and an API token limited to it; set the four `R2_*` variables. Add a CORS rule
      allowing `PUT` (uploads go straight from the browser) and `GET` from the `APP_URL` origin.
- [ ] **UptimeRobot email alert (batch 23 §2).** Add a **second** monitor: type **Keyword**, URL
      `APP_URL/api/health?key=<HEALTH_KEY>`, keyword `degraded: emails`, alert when the keyword **exists**, every 5 minutes, with your email and phone
      (SMS) as its alert contacts. It alerts through UptimeRobot's own system when emails have been failing for 15 minutes, so you hear even when Resend is
      down. (Test it on staging: AT-HOME section 6.)
- [ ] **UptimeRobot.** Generate a long random `HEALTH_KEY`, set `OUTAGE_CHECKS=1`, and add a 5-minute HTTP monitor on
      `APP_URL/api/health?key=<HEALTH_KEY>`. This monitor also drives the reminders and timers every 5 minutes (batch 19 §4): keep it on. Then add an Alert Contact: type **Webhook**, method **POST**, URL
      `APP_URL/api/health/alert?key=<HEALTH_KEY>`, "Send as JSON" with
      `{"alertType": "*alertType*", "alertDateTime": "*alertDateTime*", "alertDuration": "*alertDuration*"}`, and attach it to
      the monitor for both down and up alerts. **The webhook needs these three UptimeRobot variables (batch 26 §1):** `*alertType*` (1 = down, 2 = up),
      `*alertDateTime*` (Unix seconds; an alert more than 10 minutes off the server's clock is refused) and `*alertDuration*` (seconds the monitor was down,
      sent on up alerts). During a real outage the down alert can't reach the site, so the up alert's `alertDuration` is what records it; without it the app's
      own heartbeat (the 5-minute sweep) still records the gap, a little longer than the real downtime (from the last sweep before it to the first after it).
      A paused monitor or a stopped plan also stops the sweep, so a gap of 15 minutes or more is then recorded as an outage too: keep the monitor on.
- [ ] **FREE_UNTIL.** Decide the end of free-during-launch. Leave it unset for "free with no end", or set an ISO date at
      least 30 days ahead.
- [ ] **SKIP_EMAIL_CONFIRM.** Make sure it is `0` or unset (production ignores it anyway; keep staging honest too).
- [ ] **ALLOW_DEV_OUTBOX and STRIPE_FAKE.** Unset in production.
- [ ] **Admin accounts.** Put the admins' emails in `ADMIN_EMAILS`, have each sign up and confirm their email, and open
      `/admin`. Behaviour of admin accounts: [Admin accounts](DESIGN-DOC.md#admin-accounts).
- [ ] **Google sign-in (optional).** OAuth client with redirect URI `APP_URL/api/auth/google/callback`.
- [ ] **Right after going live (batch 23 §10): one real $1 payment.** With your own card, between two of your own accounts: as a developer, Pay a tester
      account of yours $1.00 for a sent part (the tester account's payout setup done). Check the bank's confirmation (if your bank asks), the charge in
      Stripe (live mode) → Payments, the tester's transfer in Stripe → Connect, then refund it from the Stripe dashboard (the payment → Refund). Steps in
      [AT-HOME](media/proof/AT-HOME.md) section 8.
- [ ] Walk the guide's [Edge cases to test before launch](DESIGN-DOC.md#edge-cases-to-test-before-launch) in Stripe
      test mode on a staging deployment.

---

## 9. Security notes

- **Every press is checked on the server.** Pages hide what can't be pressed, but every route re-checks the user
  (`requireUser` / `requireActive`), ownership (`ownTest`, `ownContract`), the account state (suspension, holds,
  restricted actions) and the business rules, inside a transaction with a row lock where it matters. Hidden buttons are
  never the only guard.
- **Every press names its account.** `api()` sends `x-uid` (set through `setPageUser` by `SessionWatch` in the
  signed-in layout);
  `getUserFromRequest` refuses a mismatch with `409 account_changed`, so a tab left open as one account can't act after
  another account signs in in the same browser.
- **Sessions.** Random 32-byte tokens; only the SHA-256 hash is stored. Cookie `pt_session` is `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production. Password reset signs out every device; a password change signs out the
  others. Reset and confirm links are hashed, single-use and time-limited, with at most 3 emails an hour.
- **Cross-site requests.** `readJson` accepts only `application/json` bodies and refuses a foreign `Origin`; together
  with `SameSite=Lax` this blocks form-based CSRF.
- **One charge per press.** Each Pay press carries a `payKey`; the `Review.payKey` unique index and Stripe's idempotency
  key (`pay-<payKey>`) make a repeated press a no-op. "Pay what you owe" claims rows under a lock (`paying`).
- **Webhook signatures.** `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`; a bad signature is a 400 and
  nothing runs. The fake Stripe only exists on a localhost `APP_URL` with no real key.
- **Live keys are opt-in.** An `sk_live_` key is refused unless `STRIPE_ALLOW_LIVE=1`.
- **Formatted answers are rendered safely.** `parseFormatted` (`src/lib/markdown.ts`) understands only bold, italic
  and code blocks; `Formatted.tsx` renders them as React text, so everything is escaped. There is no
  `dangerouslySetInnerHTML` anywhere in `src/`. Links are never made clickable.
- **Uploads.** Type allow-list (`ATTACHMENT_TYPES`, or `video/*`), 500 MB per recording, 25 MB per file, 5 recordings
  and 5 files per part (`src/lib/server/storage.ts`, `startRecording`). Local uploads are streamed with a byte counter
  and a path check; files are served only to the tester who made them and the test's developer (`canView`), with
  `nosniff`, `private, no-store`, and zips as downloads. JSON bodies are capped at 100 KB (450 KB for written answers).
- **Headers.** `next.config.ts` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and a strict referrer
  policy on every response.
- **Admin.** `/admin` and `/api/admin/*` check `isAdmin` (the `isAdmin` flag or `ADMIN_EMAILS`). Suspensions, test
  pauses and stops, hold approvals and dispute decisions record which admin acted (`AccountEvent.byId`,
  `Test.adminPausedById` / `adminStoppedById`, `User.holdApprovedById`, `Dispute.decidedById`).
- **No secrets in the repo.** `.env*` is ignored except `.env.example`, which holds only placeholders. A scan of tracked
  files found no Stripe, Resend or webhook keys. `scripts/evidence.cjs` contains a password used only for local
  throwaway accounts.
- **When collaborators join.** Protect the default branch on GitHub: require a pull request with at least one approving
  review, require the check to pass, and block force pushes. Keep production secrets only in Vercel.

---

## 10. Known gaps and open decisions

**Open product questions** are in the guide: [QA and open questions](DESIGN-DOC.md#qa-and-open-questions) (edge cases
to test, [Open questions](DESIGN-DOC.md#open-questions), post-launch, launch priorities). Some entries there are already
settled by later batches (excerpts are built, batch 13; developer deletion follows batch 12); check the batches first.

### DEFAULT items (built as recommended, not yet confirmed by the owner)

Find them with `grep -rn DEFAULT src` and in the batch files (`grep -n DEFAULT docs/BATCH-*.md`).

| Item | Where to flip it | Batch |
| --- | --- | --- |
| Drafts stay editable while a test is paused | `PAUSE_DEFAULTS.draftsEditable` in `src/lib/rules.ts` | 6 §4 |
| A team pause of one test follows the same tester rules | `PAUSE_DEFAULTS.teamPauseSameRules` in `src/lib/rules.ts` | 6 §4 |
| Deadlines and Open until move later when a pause lifts | `PAUSE_DEFAULTS.shiftDeadlines` in `src/lib/rules.ts` (used by `pauseShiftMs`) | 6 §4 |
| The Rate button has no end date | `rateBlocker` in `src/lib/server/ratings.ts` | 4 D4 |
| Restricted or paused: Stop, End early and Cancel call (Stop and End early silent); holds count as restricted | `RESTRICTED_OK_ACTIONS`, `TEAM_PAUSED_OK_ACTIONS` in `src/lib/restricted.ts`, `pausedForDeveloper` in server/tests | 15 §23, §29, §37 |
| Paying less than the listing still needs a reason | `REASON_WHEN_UNDER_LISTING` in `src/lib/rules.ts` (owner: true) | 15 §30 |
| A refused press on a team-paused test goes to the test page's banner | `api()` in `src/lib/client.ts` (`admin_paused` routing) | 15 §23 |
| The review date is the later of the tester's own deadline and sent (or the call) + 7 days, whatever stops or leaves | `chargeOpensAt` / `reviewDateOf` in `src/lib/rules.ts` | 15 §18 |
| A tester who finished counts as "no longer working" for typing their key back | `keyRefusal` in `src/lib/keys.ts` | 15 §19 |
| The first live update never scrolls mid-task (a pill instead) | `LiveTop.tsx` | 15 §28 |
| A key marked working stops the tester's next press even with Alerts Off | `CONTRACT_KINDS` in server/testerGate | 15 §45 |
| At most 20,000 characters per question and for the steps | `LIMITS.question`, `LIMITS.whatToDo` in `src/lib/limits.ts` | 15 §3, §17 |
| A deleted tester with no payout account: their sent work leaves Needs you | `testerPayable` / `PAYABLE_TESTER` in `src/lib/rules.ts`, the check in `review` (server/payments) | 11 §1 |
| A newly sent question set is priced at the current contract's written price | `sendWritten` in `src/lib/server/tests.ts` | 13 §8 |
| Quiet Switch / Keep for the developer (never a stop) | `DEV_QUIET_KINDS` in `src/lib/rules.ts` | 14 §4 |
| Subscription details: free launch ends like a lapse; Approved-only keeps working; Subscribe refused while restricted; lapse email ignores Off; subscription lines in "Payments and holds"; perk names | `src/lib/subscription.ts` (`PERKS`, `SUBSCRIBE_WAITS`), `src/lib/server/subscription.ts`, `GROUP_TITLES.payhold` in `src/lib/bell.ts` | 8 §8 |

### Technical gaps found while writing this (not fixed)

- (Fixed in batch 15: the Connect webhook's own secret §5, outages from the uptime service's alerts §10, R2 upload sizes
  signed and checked §6, sign-in limits §7, admins can open disputed work §8, time zones in bell lines and emails §11.)
- **Security (batch 15 §41).** The pre-launch audit's fixes are listed in [docs/media/proof/SECURITY.md](media/proof/SECURITY.md).
  **Dependencies:** the Next.js and Prisma major upgrades were left for after launch on purpose; plan them as their own change.
- **Long daily job.** `runDaily` does everything in one request, one row at a time. Watch Vercel's function time limit as
  data grows.
- (Fixed in batch 15: sign-in attempt limits and one message, §7; admins open disputed work, §8; each reader's own time zone, §11.) Bell
  stacking days are still UTC days (`dayKey`).
- **Batch 15 interpretations** are listed in the batch's final report (and in the commit messages): steps aren't part of the terms offer box; the
  review date ignores stops and leaves; `dueAt` uses the end of the join day in UTC; the dashboards have no live box, so §28's scroll applies to the
  test page, Edit and the session page; a pending excerpt request has no time of its own in the dashboard's Needs you (it sorts as new).

---

## 11. Conventions

- **Comments cite the owner's decisions.** A comment such as `(Owner, Oct 29, batch 14 section 2)` or `(NEWEST+3)` names
  the decision that explains the code. Keep doing it: when you change a rule, cite the batch or decision and update the
  comment, so the next reader can find why. `NEWEST+n` refers to the sections of `LEAN-SPEC.md`.
- **One place per rule.** Numbers in `LIMITS` (`src/lib/limits.ts`), money and timers in `src/lib/rules.ts`. Pages and
  servers import them; don't spell a number twice. User-facing sentences that the server and page share are exported
  constants or small functions (for example `PAUSED_SEND`, `overListingLine`).
- **Stop-once rules.** Every press that can be affected by something it hadn't shown sends its "seen" marker and goes
  through `devGate` or `testerGate`. The first press stops with the list (blue, under the button); the second goes ahead
  if nothing newer happened. Final refusals (stopped, paused, already decided) are separate and never "press again".
  A new event kind goes into `DEV_STOP_KINDS`, `DEV_QUIET_KINDS` or one of the `*_EXEMPT_KINDS` lists with a reason.
  Behaviour: [Why an old tab can't act on stale information](DESIGN-DOC.md#why-an-old-tab-cant-act-on-stale-information).
- **Red and blue.** Form mistakes are red at the field (`HttpError(400, ...)`); refusals and stop-once boxes are blue
  under the button. Behaviour: [Notices](DESIGN-DOC.md#notices).
- **Wording.**
  - Testers never see "hold", "suspended", "failed" or "chargeback" about a developer. They see "paused" and "delayed"
    (for example `delayedPayLine`, `OWED_FOR_TESTERS`, `pausedForTesters` in `src/lib/rules.ts`).
  - People are "they" unless they chose a pronoun: use `pronouns()` and `displayName()` from `src/lib/format.ts`.
  - Plain sentences, no jargon, no blame; follow the guide's wording.
- **Money in cents.** Always `Int` cents; format with `money()`; convert input with `toCents()`.
- **Commits.** Batches were committed on `master` with a summary title and never pushed. Tests come with every change,
  and `NEXT_DIST_DIR=.next-build npm run check` must be green before a commit.
