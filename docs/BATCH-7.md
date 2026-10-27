# Batch 7: owner decisions (Oct 28, evening)

This file wins over BATCH-6, BATCH-5, BATCH-4 and the design doc where they differ.

## 1. "Not listed"
Calls (and any part) that aren't a listed part of the tester's contract carry the short label "Not listed", on both sides. This replaces batch 6's longer wording. The $100 cap is said only when a Pay goes over it (the existing blocked line).

## 2. A stopped test shows only what still works
**Developer test page, stopped test.** Remove the panels and buttons that can no longer be used: Invite testers, the call-request tools in Live session (keep the list of past calls), Edit, Stop and End early. Next round stays, because it starts a new draft from this test.
- These stay: Needs you (Pay, Reject, a call's length, a dispute's side), the Testers panel (rows, Rate, Extra pay), chat, Alerts, and the stopped line.
- Drop the "This test was stopped, so no calls can be requested or booked." text, since the request tools are gone.

**Tester session page, stopped test or ended work.** Hide the Send buttons and the call-request tools. Show:
- their agreed scope;
- every part with its status (sent, under review, paid with the amount, not accepted, payment delayed);
- the work they sent (readable);
- Terms history.

These still work: Charge or Let it go, Dispute, Rate, Leave (if still in), and chat.

A paused test is different: it can resume, so Send stays visible and is refused with the batch 6 notice.

## 3. Drafts open in Post a test
A draft (a Next round not yet opened) is not a test page.
- Clicking a draft card opens Post a test filled in with the draft's saved details.
- "Post the test" there opens it for testers (what "Accept testers again" did for a draft).
- /app/tests/<draft id> and its Edit page redirect to that Post page.
- Next round creates the draft and goes straight to that Post page.
- A draft can be deleted from the Post page (confirm pop-up).

## 4. Stop-once on everything still allowed
Check, and add tests, that every press still available on a stopped test or a paused test runs the stop-once check (the blue notice under the button listing what changed, then "Press again to go ahead"):
- Developer, stopped test: Pay, Reject, Extra pay, call length, dispute side, Rate.
- Developer, restricted: Cancel call in the dashboard Calls box. Its server route must return the changes, not only refuse.
- Tester, stopped or paused test: Charge, Let it go, Dispute, Rate, Leave, Cancel call.

Fix any press that skips the check.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check` until it's green.
- No migration is expected. If one is needed, write it by hand and check it with the `prisma migrate diff ... --exit-code` command from BATCH-6.
- Don't touch port 3400. Don't run `migrate deploy` or `generate` while it runs.
- Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, any interpretations, and anything you couldn't do.
