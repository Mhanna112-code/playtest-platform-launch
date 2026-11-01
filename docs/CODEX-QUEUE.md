# Codex queue (Nov 1): paste each block into Codex as its own task, in this order
Done already: 11, 12, 13, 14, 15 (catalog). Not included: 16 (Find testers).

## 1. Task 15b: the stale list + a short notice sheet (docs only)

```
Read AGENTS.md first and follow it. Task number: 15b (branch codex/notice-catalog-2, worktree C:/Users/march/Projects/pl-codex-15b,
branched from master). Documentation only: change no app code.

docs/BLUE-NOTICES.md exists (task 15). Two jobs:
1. Add a section at its end, "Doesn't update until a reload":
(Added Nov 1) Then a section "Doesn't update until a reload": every page or panel whose shown state depends on something that
can change ELSEWHERE (another test, another person's other tests, the tester's own other tabs, the account's limits) but that the
page's 20-second beat (src/lib/liveSync.ts, LiveTop, AutoRefresh fingerprints `v`) doesn't watch. Known candidates to check: the
Invite panel rows (tester at 10 tests, suspended, blocked), Find tests (spots, new / closed tests), the tester dashboard's New tests
for you, call request clash notes (calls on other tests), the join page's Join when the tester reaches 10 tests elsewhere. For
each: what looks stale, what a press does then (refused / stops / goes through), and a one-line fix suggestion.
2. Write docs/BLUE-NOTICES-SHORT.md, about 100-150 lines, for the owner to test from: grouped by SITUATION (test stopped or
   closed, test paused / hold / chargeback / suspension, already done by someone else, window closed, blocked, limits, your own
   other tab, someone else changed it, bank confirm), each wording ONCE with "used by: <presses>" and how it goes away (next
   press, reload, another page, the 20-second redraw, Dismiss). Only what a person sees: no status codes, file names or internal
   names. Include the "Doesn't update until a reload" list in short form at the end.
Commit on the branch; don't push or merge.
```

## 2. Task 19: a Pay waiting for the bank isn't 'Paid' yet

```
Read AGENTS.md first and follow it. Task number: 19 (schema codex19, build folder .next-codex19, branch codex/pending-pay-state,
worktree C:/Users/march/Projects/pl-codex-19, branched from master).

Bug (owner): when the developer presses Pay (or Pay on a call) and their bank asks to confirm, the tester's part flips to "Paid"
straight away, then back to "Waiting for review" if the bank check fails, is closed, or times out (15 minutes). The review row is
created with the press: src/lib/server/confirm.ts pressAction / release() deletes it again for needs_action "review" / "call"
payments (see the comment block at the top of confirm.ts for the on-session vs away rules).

Wanted: while a Pay's payment is still waiting for the developer's bank (status needs_action), everyone sees it as NOT paid yet:
- Tester's session page: the part stays "Waiting for review" (the batch 35 §97 payment tag: src/lib/testerPaymentStatus.ts,
  src/components/TesterPaymentTag.tsx), no "Paid $X: you get …" line, no "has paid" amount for it, no Dispute, no paid bell/email;
  it becomes "Paid" only when the bank check succeeds (confirmFinish).
- Developer's test page / Needs you: the piece shows "Confirming with your bank" (the inline bank check) instead of a paid row;
  their dashboard counts don't treat it as paid.
- Everything that reads "is this piece paid" (Charge / Let it go shown or refused, Rate's "everything reviewed", Pay more room,
  close-out lines, Needs review counts, the tester dashboard's Waiting for review) treats needs_action as not paid, while
  pieceLocked still locks the piece (no Charge, no admin Decide) during the 15 minutes.
Prefer one helper (e.g. "reviewSettled(review, payments)") over scattered checks; or don't create the review until confirmFinish —
pick whichever touches less and keeps release() simple; explain the choice in the doc section.
Charges made while the developer is away (needs_confirmation: a tester's Charge, a dispute decision) keep today's "Payment
delayed" behaviour.

Tests in tests/batch35-pending-pay-state.test.ts: Pay needing the bank → tester sees Waiting for review (no Paid line, no Dispute)
→ confirm succeeds → Paid; the same Pay → bank check fails or 15 minutes pass → still Waiting for review, nothing charged, Pay
available again; the piece is locked meanwhile (Charge refused). Append "## §107 A Pay waiting for the bank isn't paid yet (owner,
Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky, rerun alone: batch22 "two admins at once", batch17-rate §12, codex9
resource_missing, batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open to charging", batch34
outage Approve after Dismiss, batch4 "Open until heads-ups wait while the test is paused"). Commit on the branch; don't push or
merge.
```

## 3. Task 20: Invite rows (and other stale panels) update on the beat

```
Read AGENTS.md first and follow it. Task number: 20 (schema codex20, build folder .next-codex20, branch codex/invite-rows-live,
worktree C:/Users/march/Projects/pl-codex-20, branched from master).

Bug (owner): a tester's row in a test's Invite testers panel (src/app/app/tests/[id]/InvitePanel.tsx, data from
src/lib/server/invites.ts rankedTesters: greyed "Can't join this test" at MAX_ACTIVE_TESTS, suspended, blocked, rated this test,
already invited / in) only updates when THIS test changes or on a reload. fbbb dropped under 10 tests on other tests and stayed
greyed until the developer reloaded (and the other way round: reaching 10 leaves an invitable-looking row whose Invite then stops).

Wanted: on the page's existing 20-second beat (src/lib/liveSync.ts LIVE_TICK; AutoRefresh redraws), the panel's rows re-check
availability: a cheap fingerprint of the shown testers' invitability (active test count crossing the limit, suspension, block,
rated here, invited / in) so the page redraws when it changes, like AutoRefresh's `v` fingerprints elsewhere (e.g. BankToConfirm's
bankTopV). No new timers. Ticked boxes and typed search stay as they are across the redraw; a ticked tester who became uninvitable
is unticked with the existing greyed reason.

(Added Nov 1) If task 15's "Doesn't update until a reload" list exists (docs/BLUE-NOTICES.md), fix the other real ones there the same
way (a fingerprint on the existing beat, no new timers); list in the doc section which ones you fixed and which you left and why.
Tests in tests/batch35-invite-rows-live.test.ts: the fingerprint changes when a shown tester's active count crosses the limit or
they get blocked / suspended, and not for unrelated changes. Append "## §109 Invite rows update on the beat (owner, Nov 1)" to
docs/BATCH-35.md. npm run check green (known flaky list as in the earlier tasks). Commit on the branch; don't push or merge.
```

## 4. Task 18: one Needs you while restricted

```
Read AGENTS.md first and follow it. Task number: 18 (schema codex18, build folder .next-codex18, branch codex/restricted-needs-you,
worktree C:/Users/march/Projects/pl-codex-18, branched from master).

Owner decision: while the developer side is suspended or on a hold (payment or chargeback), the dashboard (src/app/app/page.tsx)
shows ONE "Needs you" holding only what still works, each item done right there, instead of the separate boxes it shows today:
- "Your bank wants you to confirm (N)" (src/app/app/BankToConfirm.tsx) — each waiting payment with its Confirm with your bank
  (inline, as on the test page: BankWaiting);
- "Disputes: add your side" (disputeBox, DisputeSide inline);
- "Excerpt requests" (excerptBox, Allow / Deny inline);
- Ratings to give stays its own box (it already works during a restriction where allowed).
Order inside Needs you: bank confirms first (soonest "confirm by" first), then disputes, then excerpt requests. One box (card), plain
bordered rows, one scroll box (ScrollList), the count in the heading — the same look as the normal Needs you (batch 35 §96, §102).
When NOT restricted, nothing changes (Needs you as now; the dashboard's bank box stays at the top as now).
Keep each item's existing stop / refusal rules and live updates (AutoRefresh queries bank=1 etc.).

Tests in tests/batch35-restricted-needs-you.test.ts: a held developer with a bank confirm, an open dispute and an excerpt request
sees one Needs you with all three (and no separate boxes); each press still works from there; an unrestricted developer's dashboard
is unchanged. Update tests that expected the separate boxes (search data-dispute-box, data-excerpt-box, data-bank-top). Append
"## §106 One Needs you while restricted (owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky, rerun alone:
batch22 "two admins at once", batch17-rate §12, codex9 resource_missing, batch34-invite-beats-application, batch16-account-tabs,
batch12 "a part already open to charging", batch34 outage Approve after Dismiss, batch4 "Open until heads-ups wait while the
test is paused"). Commit on the branch; don't push or merge.
```

## 5. Task 17: Message anyone from their profile

```
Read AGENTS.md first and follow it. Task number: 17 (schema codex17, build folder .next-codex17, branch codex/profile-messages,
worktree C:/Users/march/Projects/pl-codex-17, branched from master).

Owner request: a "Message" button on every profile (developer profile /app/developers/[id] and tester profile /app/testers/[id])
so anyone can message anyone, not only people who share a test. Today chats exist only per test and tester
(src/lib/server/messages.ts: chatAccess, openTesterChat, sendChat; the Messages page src/app/app/messages).

Build: a direct conversation between two accounts that isn't tied to a test (new model + local migration under prisma/migrations;
never run migrations against a hosted DB). It shows in the Messages page next to the test chats (its own row: the other person's
name, "Direct message"), with the same message UI, unread counts, bell line and email rules as test chats, the same drafts
(useKept) and the same length limits. "Message" on a profile opens it (creating it on the first message, not on the press).
Rules to keep:
- Blocks either way: no button, and an old page's send is refused with the existing neutral line ("Unable to chat with this
  developer." / "… tester.").
- A suspended side, a deleted account, the sender's own restriction: same as test chats (refused with the existing lines;
  check chatRestriction / the restricted rules in src/lib/restricted.ts).
- No messaging yourself; admins keep their existing tools (no Message button needed on the admin views).
- Abuse guard: a simple per-sender limit on NEW conversations started per day (for example 20) with a plain refusal line; the
  Report button on profiles stays as it is.
- Testers never see "hold", "suspended", "failed" or "chargeback" about a developer in these lines.

Tests in tests/batch35-profile-messages.test.ts: a developer messages a tester they never worked with (both see it in Messages,
unread count and bell); blocked either way refused and no button; suspended side refused; the daily new-conversation limit
refuses the 21st; a test chat between the same two people stays separate. Append "## §105 Message anyone from their profile
(owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky, rerun alone: batch22 "two admins at once",
batch17-rate §12, codex9 resource_missing, batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open
to charging", batch34 outage Approve after Dismiss, batch4 "Open until heads-ups wait while the test is paused"). Commit on the
branch; don't push or merge.
```

## 6. Task 22: your own page is the page load on every side (optional)

```
Read AGENTS.md first and follow it. Task number: 22 (schema codex22, build folder .next-codex22, branch codex/page-load-own,
worktree C:/Users/march/Projects/pl-codex-22, branched from master).

docs/BATCH-35.md §51 made the ADMIN side treat "your own page" as the same PAGE LOAD (x-load, src/app/admin/PageLoad.tsx,
ActionLog "admin-tab"). The developer and tester sides still key their own actions on the per-tab id (src/lib/server/live.ts
tabOf / ownChanges, ActionLog.tab; src/lib/client.ts TAB / PAGE_LOAD). Make developer and tester own-action checks use the page
load the same way (a press without x-load falls back to x-tab, as on the admin side), so: a press from the page that made the
change never stops itself; a page drawn after the change goes straight through, even in the same tab; a page drawn before it
(another tab, or the same tab via Back) stops once.
Also change the wording everywhere from "in another tab" to "on another page or tab" (search the rules and server text; keep one
helper for it), and update the tests that expect the old words.
Tests in tests/batch35-page-load-own.test.ts for developer and tester: same page load never stops; same tab, later page load goes
through; earlier page load in the same tab stops once with "on another page or tab". Append "## §110 Your own page is the page
load on every side (owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky list as in the earlier tasks). Commit on
the branch; don't push or merge.
```
