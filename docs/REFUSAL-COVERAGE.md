# Refusal and stop-once coverage (§365)

Status on Nov 9 (branch next-353). Three test files were asked for. Only the first is built; the other two are **gaps**, listed below with the existing
tests that cover parts of them today. Nothing here claims coverage that a test doesn't give.

## 1. Cause families × buttons — `tests/refusal-matrix.test.ts` (built)

Each row: the state is set once, every listed button is pressed, the text must be exactly `{cause}, so your {button} didn't go through.` and the test's
rows (contracts, parts, requests, calls, payments, invites, applications, excerpts, ratings, messages, the test) must not change.

| Cause | Side | Buttons covered | Case |
|---|---|---|---|
| This test was stopped (developer's Stop) | tester | Send, Add, Send (recording), upload, Request a time, Accept, Decline, Leave | "stopped (the developer's Stop)" |
| This test was stopped (developer's Stop) | developer | Stop the test, End early, Request a time, Invite | same |
| This test was stopped (team's Stop) | developer | Invite, Next round, Request a time | "stopped (the team's Stop)" |
| This test was stopped (developer deleted) | tester | Send, Rate, Ask the developer (excerpt) | "stopped (the developer deleted their account)" |
| This test ended | tester | Send, Add, Send (recording), upload, Request a time, Accept, Decline | "ended (the work window)" |
| Your part in this test has ended | tester | Send, Add, Send (recording), upload, Request a time, Leave | "part ended (she left)" |
| {name}'s session has ended | developer | End early, Request a time | same |
| This test is paused right now | tester | Send, Request a time, Accept | "paused (the developer's hold)" |
| Your tests are paused | developer | Next round, Invite, Pay, Subscribe for $7/month | same |
| The team paused this test | developer | Invite, Next round, Send (chat), Pay more | "team paused" |
| Your account is paused | tester | Send Answers, Rate | "account paused / suspended" |
| Your account is suspended | developer | Next round, Invite, Pay | same |
| This test closed to new testers on {date} / isn't taking new testers right now | tester | Join | "join and invites closed" |
| This call was already cancelled. | both | Cancel call | "call already cancelled" |
| This account no longer exists. | developer | Confirm with your bank | "own deleted account" |

Found and fixed by it (commit "§365: the refusal matrix …"): the developer's Request a time on a stopped test, the tester's Accept on a held test, and
Subscribe's button name.

Not yet in the matrix (covered elsewhere, or a gap): Withdraw and Cancel call on the stopped / ended / part-ended rows (tests/batch16-tester-stopped,
tests/session-end); Switch / Keep (tests/batch35-nov2-a, tests/session-end); Apply, Accept on an application, Ask to rejoin, an invite's Join
(tests/batch16-invites-live, tests/block, tests/flow); Charge / Let it go for a suspended tester (tests/batch17-rate); the admin's buttons while suspended
(tests/batch15-security); Pay what you owe and Confirm all while suspended (no test: **gap**); Post the test / Delete on a stopped draft (no test: **gap**).

## 2. Every other state refusal per button — `tests/refusal-button-matrix.test.ts` (**not built: gap**)

Asked: for each button, every state refusal its route can throw (already done here or in another tab, already paid / charged / settled, windows closed,
caps and daily limits, the block's "This payment isn't available.", full, key refusals, deleted accounts, NDA / terms changes), each reached and asserted
with nothing changed. Excluded by the request: field validation (empty, too long, bad format) and technical errors (500, network, Stripe provider errors).

Existing coverage, by family (not a matrix; each file covers some buttons only): already done in another tab — tests/batch34*.test.ts,
tests/batch35-*-own*.test.ts; already paid / settled — tests/batch35-stop-rules-v2.test.ts, tests/pay-matrix*.test.ts; windows closed —
tests/batch17-close-out.test.ts, tests/batch35-call-window.test.ts, tests/call-window-test-close-361.test.ts; caps and limits — tests/batch18-call-cap.test.ts,
tests/call-limit-request-boxes-185.test.ts; the block's line — tests/block.test.ts, tests/batch16-blocks.test.ts; full and keys — tests/joining.test.ts,
tests/key-*.test.ts; deleted accounts — tests/deleted-account-360.test.ts, tests/dev-deleted-charge-363.test.ts; NDA / terms — tests/nda-*.test.ts,
tests/batch27*.test.ts.

## 3. Every stop-once line per button — `tests/stop-once-matrix.test.ts` (**not built: gap**)

Asked: for every button, both sides, every kind of line that can stop it once, with (a) the exact box lines and tail and nothing charged or saved, (b) the
second press going ahead, (c) Alerts on vs off / the ticks (forced lines either way, ordinary lines only with the tick), (d) a line a box already listed not
stopping again; checklist docs/STOP-ONCE-NOTICES.md and docs/NOTICE-TEST-MATRIX.md.

Existing coverage of the §362 forced rows (complete for these): tests/tester-send-paid-stop-183.test.ts (tester Send / Add for written answers and a
recording, the $0 answer, Dispute; Alerts on and off; another part not stopping) and tests/pay-matrix.test.ts (Needs you's Pay and Pay more forced; the
Testers list's Pay more and another part following the tick). Other rows are covered piecemeal by tests/pay-matrix*.test.ts, tests/batch16-alerts.test.ts,
tests/batch29-gates.test.ts, tests/batch30c-stops.test.ts, tests/charge-forces-tester-stops-193.test.ts, tests/tester-gate.test.ts and
tests/batch35-stop-rules-v2.test.ts, without the full button × line × Alerts grid.
