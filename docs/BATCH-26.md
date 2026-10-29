# Batch 26: bugs found by the batch 20-24 recordings (Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 25. Every item was seen in a recording; the file names are in docs/media. Lines marked DEFAULT are my proposals; the owner can change them.

## 1. A real outage is never recorded
A real full stop of the site isn't recorded: UptimeRobot's "down" alert goes to the site's own webhook, which is down, so it's lost; the "up" alert then finds no open outage (`{"ok":true,"type":"up","outage":null}`) and nothing moves (src/lib/server/outages.ts `recordAlert`, src/app/api/health/alert/route.ts). Fix so a real outage is always recorded:
- **The up alert carries the length.** UptimeRobot's up alert includes how long the monitor was down (its alert duration / datetime fields: check its webhook variables). When an up alert arrives with no open outage, record the outage from that: start = up time minus the duration.
- **The app's own heartbeat as backup.** The 5-minute sweep stores its last run time. When the app finds a gap of 15 minutes or more since the last heartbeat (on the next sweep, or on start), it records an outage for the gap, unless the up alert already recorded it (never twice for the same downtime: merge overlapping ones).
- Both follow the existing rules: 15 minutes or more is recorded and moves every running clock; over 24 hours waits for the admin's "Approve: move every timer".
- HANDOVER: which UptimeRobot variables the webhook needs.
- Tests: up alert alone (no down alert) records the right start and end; a heartbeat gap alone records it; both together record it once; under 15 minutes nothing; over 24 hours waits for Approve.

## 2. Calls and blocks
- **A block ends a call already in progress** (batch 21 §2), at once, on both pages (blk-02-join-call.png; src/lib/server/blocks.ts `blockUser` must end the call like a pause does).
- **The end line for a block** (b21-02-block-*.png shows "Call ended: this call isn't available." on both pages): the person who blocked sees "Call ended: you blocked <name>."; the other sees "Call ended: the call was cancelled." (DEFAULT; never says they were blocked).

## 3. The team's Stop never names the developer
A test stopped by the team shows the tester "Nora Lane stopped the test…" (ct-04-rated.png, ct-04-after-stop.png; rules.ts endedLine / overHalf ~541/559). Testers read "This test was stopped at 3:10 PM." for a team stop, everywhere (stop boxes, banners, live box, bell). Check every place that builds a stop line.

## 4. Stop box shows the time twice
The Rate stop box prints the time twice (ct-04-rate-stops.png). One time per line, everywhere a stop line is built.

## 5. The developer's chargeback box says "payment hold"
During a chargeback hold the developer's box says "payment hold" (b22-01-chargeback-hold.png). Use the chargeback wording there.

## 6. The tester sees when Charge opens (DEFAULT)
A sent, listed part waiting for the developer only says "Waiting for the developer" (ct-01-tester-waiting.png). Add: "If <dev> hasn't paid by <review date>, you can charge or let it go then." (the later of their own deadline and 7 days after sending; a listed call: 7 days after the call). Moves with pauses like the date itself. Not for unlisted parts.

## 7. Invite comes back when a spot opens
Invite stays greyed out after a spot opens (b20-10-spot-opens.png, b20-10-video.webm; InvitePanel.tsx). It must follow the page live both ways (full → disabled with its line; a spot opens → enabled).

## 8. "Finished", not "left"
A tester who rated (finished their part) shows "· left" in "Worked with you" (b20-23-worked-with.png; `togetherState` in src/lib/server/invites.ts). Show "· finished".

## 9. Confirm with your bank stops exactly like Pay
Its stop box didn't list another tester's dispute (b23-09-stop.png). Confirm on a piece must stop for exactly the changes Pay on that piece stops for (same devGate call, same Alerts types). Tests: whatever stops Pay on that piece stops Confirm.

## 10. Call requests
- A call request closed because the tester finished their part shows live on the developer's page ("Closed: the tester finished their part"), like the other closures (b24 recording).
- A Withdraw refused on a closed request reads "Your Answer didn't go through" (b24-02-withdraw.png): name the press ("Your Withdraw didn't go through") or, for a plain refusal, just the refusal line.
- The request row shows "Contract $30/h" while the page shows "Live call: $24/h" (b20-07-after.png). When a tester is on older terms, say so: "Their terms: $30/h (the listing is now $24/h)" (DEFAULT).

## 11. Layout
- Sign-up refusals: the red line sits between the tick and its words; on the Google step only the Terms tick goes red (b20-05-signup-refused.png, b20-05-google-refused.png; signup/page.tsx, signup/google/page.tsx). Put the red line under the whole tick row, and make every missing tick red on both steps.
- The required-question "*" sits at the far right of its row (b20-28-star.png): put it right after the question's label.

## 12. Admin "Payouts waiting" shows everything
It shows only the 100 oldest with no paging (src/app/admin/page.tsx:36). Make it the plain scroll box of batch 17 §7 (loading more, "That's all (N)").

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
