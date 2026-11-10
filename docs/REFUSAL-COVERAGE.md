# Refusal and stop-once coverage (§365)

Status on Nov 9 (branch next-353), after the owner narrowed §365: three test files cover the rows below. Everything else (the other buttons' own refusals,
and the combinations the owner dropped) is **covered by recordings**: the recording runs press those buttons and show their lines; they are not gaps.

## 1. Cause families × buttons — `tests/refusal-matrix.test.ts`

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
| The team paused this test | developer | Invite, Next round, Send (chat) (§368: Pay and Pay more go through) | "team paused" |
| Your account is paused | tester | Send Answers, Rate | "account paused / suspended" |
| Your account is suspended | developer | Next round, Invite (§368: Pay goes through) | same |
| This test closed to new testers on {date} / isn't taking new testers right now | tester | Join | "join and invites closed" |
| This call was already cancelled. | both | Cancel call | "call already cancelled" |
| This account no longer exists. | developer | Confirm with your bank | "own deleted account" |

Not in this matrix, **covered by recordings**: Withdraw and Cancel call on the stopped / ended / part-ended rows; Switch / Keep; Apply, Accept on an
application, Ask to rejoin, an invite's Join; Charge / Let it go for a suspended tester; the admin's buttons while suspended; Pay what you owe while
suspended; Post the test / Delete on a stopped draft.

## 2. Money buttons' state refusals — `tests/money-refusal-matrix.test.ts`

Pay, Pay more, Confirm with your bank, Confirm all, Charge, Let it go and Dispute. Each case asserts the exact text and that the database didn't change
(contracts, parts, reviews, the developer's payments, disputes). Field validation and technical errors are out of scope.

| Button | Refusals covered |
|---|---|
| Pay | already paid (here / in another tab at {time}); settled by the tester's Charge or Let it go; the team's $0 closure; an old rejection; a declined payment owed on it; a payment on the part at the bank (the tester's Charge: confirm it first; the developer's own: being confirmed); Pay closed; $500 a part; the calls' $500 per tester; a cancelled / not started call; owing without a hold ("Pay what you owe first."); a deleted tester with no payout account; §368: a hold refuses it, a team pause doesn't |
| Pay more | nothing paid yet; a call that hasn't taken place; the team's $0 closure; Pay more closed; the $500 cap including Pay more; a payment on the part at the bank (the tester's Charge, the developer's own earlier Pay more); the block's hidden "This payment isn't available." (either way) and a deleted tester; §368: a hold refuses it |
| Confirm with your bank | nothing to confirm (no such payment, another developer's); already confirmed (here / in another tab); cancelled; expired; inside an open Confirm all; a charge waiting for a hold's lift (the held line); own deleted account |
| Confirm all | nothing waiting; already confirmed in another tab; one already waiting for the bank; during a hold (nothing waits for the bank); own deleted account |
| Charge, Let it go | not open yet; late work; the window closed; the developer paid meanwhile; her own choice already made; her Charge waiting for the developer's bank; the developer's first Pay at the bank; the team's $0 closure (fixed with §365: it read as the developer paying $0, "you can dispute it") |
| Dispute | nothing paid yet; already disputed; the team's $0 closure; a part she settled herself; nothing left to dispute (paid the most; paid to the most since her page loaded); closed (she rated; the part's closing date passed) |

Pauses and holds as §368 has them are also in `tests/pay-during-pauses-368.test.ts` (each payment press charges once during a team pause and a suspension).

Not in this matrix, **covered by recordings**: every other button's own refusals (already done here or in another tab, windows, limits, keys, full,
NDA / terms changes, deleted accounts on the non-money buttons); Pay more "already done in another tab" (the same press key returns the earlier result,
and another tab's Pay more stops the press once: file 3); the unlisted call's $0 closure and per-hour cap (also in tests/notif-310.test.ts,
tests/batch11.test.ts).

## 3. Always-stop rules — `tests/stop-once-matrix.test.ts`

Each case runs with Alerts Off (every developer type ignored, the tester's Alerts off) and with Alerts On, and asserts: the first press stops with
exactly the box's lines and tail ("Press {button} again to go ahead."), nothing is charged or saved; with Alerts Off the second press (confirmed, with the
box's time) goes ahead; with Alerts On a press sending the line as already listed by a box (`shownIds`) goes ahead without stopping again.

| Rule | Presses covered | Section |
|---|---|---|
| Own action in another tab | developer Pay (after a Pay in tab B); tester Add (after a Request a time in tab B) | 1 |
| A dispute about that tester | developer Pay, Pay more, Confirm with your bank, End early, Request a time | 2 |
| The team's decision about that tester | the same five | 2 |
| The developer's side on the tester's dispute | tester Add, Request a time, Leave (a Dispute on the disputed part is refused at once, never stopped) | 2 |
| The team's decision on the tester's dispute | the same | 2 |
| A charge about that tester (an automatic call charge) | developer Pay, Pay more, Confirm with your bank, End early, Request a time | 3 |
| The payment's tester leaving | Pay, Pay more (forced); Confirm with your bank follows "Testers leaving" (§340) | 4 |
| §362: a developer payment on the part | tester Add (written), recording Send and Add, Dispute | 5 |
| §362: work on the part | Needs you's Pay (recording) and Pay (a written update, Pay more's route), forced; the Testers list's Pay more doesn't stop with "Work sent" ignored | 5 |
| One ordinary line per button | developer: Ben adding to his answers (Work sent) under Pay, Pay more, Confirm with your bank, End early, Request a time; tester: a payment on her other part under Add, Request a time, Leave, Dispute | 6 |

Not in this matrix (the owner dropped them from §365), **covered by recordings**: every other kind of line on every other button (listing, call,
join and application changes; pauses and lifts, also in tests/pause-stops-every-press-271.test.ts; the Confirm all and Pay what you owe boxes).
