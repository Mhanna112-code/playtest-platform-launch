# November 7 request status

This reconciles the owner's requests in this chat. Implemented does not mean every manual scenario is finished. The owner deferred password changes and automatic sign-out, declined automatic spot reduction, and declined the extra bank-charge waiting-for-lift notice.

## Implemented and merged through f3b6c598

- Terms of Use updates; edits follow the listing while agreed parts/prices have Keep/Switch.
- Private previous-name lookup for existing counterparts in Find tests, Invite testers and the test's Testers search.
- Fifty-character minimum for Add to this answer.
- Automatic key release on Leave, End early and tester removal; legacy inactive assignments released on key-box/join access. Assigned keys retained in Terms history.
- Joined/left/ended/rejoined dates and developer-visible Keep/Switch choices in Terms history, preserving question-change history. No NDA acceptance badge or entry there.
- Departed/deleted tester selection returns to All testers.
- Individual tester deadline changes trigger page refresh even if the overall work deadline stays unchanged.
- Pay what you owe's losing tab gets an in-flight/already-paid refusal rather than the generic press-again message.
- Paused developer test headers retain their ordinary tags and key count, adding Paused.
- Tester earnings omit the developer's Pay what you owe repayment method.
- Withdrawn applications produce a quiet developer live line, never a stop-once; stale Accept/Decline presses refuse.
- Rewritten social captions and caption-led marketing reels; see docs/marketing/NOV7-AUDIT.md and its linked assets.

## Completed in the follow-up branch

- Routine reminders stop after deletion at generation and delivery retry. Queued mixed summaries remove reminder text and HTML while retaining actual receipts/updates. Source account IDs prevent confusing a deleted account with a new account that reuses the email address. Older queue entries recover context from their originating notices where available.
- Payout-problem and rating reminder generation excludes deleted recipients, including first rating prompts.
- Orange rejoin tags: Previously left test / Previously ended early, on the developer roster and tester session.
- A developer payment landing during the tester's Charge gate produces the final paid refusal.
- Required non-payment reminders between Weekly/Monthly summaries use an account-updates subject, rather than payment updates.
- Addition pricing was subsequently changed at the owner's request: all additions before the deadline and before Charge opens adopt the current agreed terms; after the deadline or Charge opens, additions preserve the existing price, status and Charge dates. See ADDITION-CHARGE-PRICE-RULE.md and commits 306d2f9d/f558f806.
- All $1,000 work/call caps lowered to $500 without grandfathering test data; committed as 2a0e553f. See CAPS-500.md. These commits have not been merged into the owner checkout.

The queued-email context has an additive migration (20261107220000_deleted_reminder_queue_context). It is tested only in isolated local test schemas. It must be applied to the app database before merging/running this follow-up code. The repository instructions prohibit this agent from applying migrations to public or hosted databases. Email already handed to the delivery service cannot be recalled.

## Manual checks performed

- Fresh review work, moved review dates, correct reminder body and work destination; actual copies sent to the owner's requested address.
- Off: real join, written submission, answer addition and chat notices remained in the bell and were excluded from the end-of-day email. Required review reminder included.
- Weekly between summaries: required review reminder included; ordinary notices retained for the later summary. This does not yet verify the eventual Weekly summary or Monthly/Daily matrix.
- Payment hold repayment, two-tab Pay what you owe race reproduced; Second Admin approvals lifted the holds.
- Dev Tester tester-side suspension removed the tester from the test, retained submitted work and refused tester actions (403), without suspending the developer side. Reinstatement restored the account, without auto-rejoining the test.
- fb developer-side suspension and reinstatement through Second Admin.
- Historical bell links to retained work were manually confirmed by the owner, including a deleted tester row.
- Charge samples prepared with normal Post/Join/Send actions; sample dates moved to open Charge. The owner exercised the $20 charge/repayment path. This does not establish every open-tab button race.

## Manual checks still to finish together

1. Charge while Pay/End early/call controls are already open; old-tab presses and bank-window notices; no duplicate charge.
2. Submit, leave, open Charge, rejoin, change parts/prices, Keep/Switch: retain the prior stint's work dates and appropriate saved price.
3. Key release/reassignment and retained key history on Leave, End early and deletion; orange rejoin tags after returning.
4. Eventual Weekly, Daily and Monthly summaries; immediate 15-minute call reminder; duplicates and correct destinations.
5. Pause spanning a deadline, already-expired deadlines, overlapping pauses and pause closure.
6. Ratings on both account sides and excerpt permission after question changes/NDA changes.

## Audit findings and remaining proposals

- Suggested currently sorts availability, requirements, rated-before-unrated, Bayesian score, successful payment count, then device/language fit. The quoted requirements → score → experience → fit order differs because batch 35 section 276 explicitly added the rated-first step. The score formula itself matches. Experience counts payment rows, not distinct tests. The owner explicitly chose to keep the rated-first rule in this follow-up. No ranking policy changed.
- Other undecided Claude items remain in docs/PENDING.md: End early hang handling, current versus historical test names in payment records, card reverification after card changes, excerpt Hidden list/files/caps, and alternative stop/refresh rules. They are proposals, not approved work in this chat.
- The local launch-report attachment contained only its title and Loading the report; its absent body could not be checked. The source Claude chat itself was not available, so no claim is made that every promise in that chat was inspected.

See docs/marketing/NOV7-AUDIT.md for the original bounded code audit, email timing/coverage, and ratings/excerpts findings. Latest checks and commit IDs are reported in the chat; a full check with an unrelated storage-size timeout is not reported as green.

## Later dashboard request — resumed and implemented

The owner resumed all dashboard/message/link changes and added local panel search, simpler To do rows and Needs you eligibility matching the test page. See [dashboard changes](NOV7-DASHBOARD-CHANGES.md) for the final scope, behavior and validation. The earlier untracked snapshots are historical only; the current implementation is in the branch. Automatic sign-out and password changes remain deferred.

## Highlight reels

Completed in 6a966c83 (already merged earlier): three silent 1080 × 1920, 16-second caption-led reels (Post a test, Three ways, Kept drafts), cover images and scene review sheets. Revised platform captions are in marketing/SOCIAL-POSTS.md. They replace the corresponding old drafts, not the entire original collection. They are promotional graphics, not fresh UI walkthrough footage. Nothing published. The later $500 and addition rules do not invalidate their displayed claims.

## Final earlier-work validation

The three focused follow-up files passed 12 tests: deleted-account reminders and retry filtering (9), orange rejoin tags (2), and Charge/Pay gate race (1). Migration diff reports no difference. The complete repository check remains non-green from the previously recorded broader failures; do not infer a clean full suite from the focused checks. The queued-email migration has not been applied to the owner database, so these follow-up changes must not be run there before it is applied by the owner/merger.

The additional other-tab and daily-review regression suites passed 27 tests (39 focused tests across five files in total). Final typecheck, lint and production build passed; lint retains existing warnings. The schema migration diff also passed. The full npm run check is still not green from the previously recorded broader failures.

## Merge completed
Merged into local master by explicit owner authorization through 457b2f08. The local public email-queue migration had already been applied with separate owner approval. No push. Owner Prisma client regeneration failed with Windows EPERM renaming the loaded query-engine DLL; server was not stopped. That regeneration needs retrying after the owner stops the server. Latest profile tests: 2 passed; typecheck and lint passed. Full check was interrupted during test startup; the previously recorded full-suite failures remain unresolved. Earlier branch-only and migration-pending statements above describe the earlier state.
