# Forced stop-once and refusal notices

Code snapshot `6b8a1077` on `codex/reminder-audit`. The [refusal wording index](REFUSAL-NOTICE-INDEX.md) lists the individual server responses by action and source condition. This guide groups the notices by what the user pressed and what changed.

## How to read the wording

Braces stand for a value inserted at runtime. A line may carry a timestamp beside it, and names, tests, and affected work may be links. The button label can include the tester and part, such as `Pay on {tester}'s written answers`.

| Display | Exact wording or pattern |
|---|---|
| Named stop-once box | `Your {button} didn't go through.` then `Since you opened this page:` and the applicable lines, then `Press {button verb} again to go ahead.` |
| Unnamed stop-once box | `Your press didn't go through.` and `Press again to go ahead.` |
| Account-change heading | `Changed in another tab or device since you opened this page:` |
| Named refusal | `Your {button} didn't go through: {reason}` |
| Bare refusal | The reason displays by itself when the action has no name or the reason already names the refused press. |
| Explicit bare refusals | `Answer the new terms first: Switch or Keep.` and `Acknowledge the NDA change first.` |
| Cancelled bank check | The response `This payment was cancelled: nothing was charged.` displays as `Cancelled: nothing was charged.` |
| Field validation | A field error can display in red using its own text, without the blue-box header. |

A retry is eligible to go through when nothing newer requires acknowledgement and the action still meets its rules. A refusal requires the condition in the message to change. Some bank and admin results have dedicated displays. [Stop box](../src/components/ChangesBox.tsx#L60) · [Button names and refusal formatting](../src/lib/pressLabels.ts#L148) · [Field validation](../src/components/Err.tsx)

## Test state changes

These notices use the action's timestamp and apply to eligible presses on a view that has yet to account for the change. Auto-refresh, an updated live box, or a stop box that already listed the change can mean the next press goes straight through. A hard refusal can take precedence.

| Cause | Developer sees | Tester sees |
|---|---|---|
| Team pause | `The team paused this test at {time}.` | `This test was paused at {time}.` |
| Developer payment hold | `Your tests were paused at {time}.` | `This test was paused at {time}.` |
| Developer suspension | `Your developer account was suspended at {time}.` | `This test was paused at {time}.` |
| Team lifts its pause | `The team lifted its pause on this test at {time}.` | `This test resumed at {time}.` |
| Developer stops the test | `You stopped this test at {time}.` | `{developer} stopped this test at {time}.` |
| Team stops the test | `The team stopped this test at {time}.` | `This test was stopped at {time}.` |
| Test closure | `This test closed at {time}.` | `This test closed at {time}.` |
| Developer ends this tester's work early | `You ended {tester}'s work early at {time}.` | `{developer} ended your work early at {time}.` |

- **Pause and team lift.** Eligible payment and confirmation actions, work and calls, Rate, chat, and some report, block, and excerpt presses use the pause gate. The team’s **Decide** does not use that gate. A pause and lift can appear in the same box when both happened since the relevant view timestamp. The tester's team-lift notice waits if a developer hold or suspension still pauses the test.
- **Stop, closure, End early.** On the developer side, check eligible **Pay**, **Pay more**, and **Rate**. On the tester side, check eligible **Charge**, **Let it go**, and **Rate** when the event ended their own participation. **Dispute**, adding the developer’s side, and excerpts do not get the Stop-only retry. Edit Save has its own version and state check.
- **Leave and block.** A tester leaving can stop a stale developer payment press on that tester with `{tester} left the test`. The block action itself has no dedicated Stop-once message for the other party. A block can end the session and lead to action-specific refusals. For example, eligible first Pay remains available, while Pay more can return `This payment isn't available.`

[Exact templates](../src/lib/rules.ts#L1848) · [Pause and stop checks](../src/lib/server/stopMoment.ts#L8) · [Developer gate](../src/lib/server/tests.ts#L753) · [Tester gate](../src/lib/server/testerGate.ts#L175) · [Rate gate](../src/lib/server/ratings.ts#L225)

## Same-tester disputes, charges, and departures

| Who presses | What independently stops the press | Wording |
|---|---|---|
| Developer pays, requests or changes a call, or ends work early for the affected tester | That tester raised a dispute, the team decided it, or a qualifying charge happened on that tester’s work. A payment press can also stop if that tester left. | `{tester} disputed the pay for {possessive pronoun} {part}`, `The team decided {tester}'s dispute on {possessive pronoun} {part}: {decision}`, `Payment went through on {test}: {amount} to {tester} for the {part}`, or `Payment failed on {test}: {amount} to {tester} for the {part} · pay what you owe in Payments`. A departure reads `{tester} left the test`. |
| Developer confirms an existing charge | A dispute, decision, departure or another qualifying charge on the same tester. | The same event lines. The charge being confirmed is excluded from its own stop box. |
| Developer rates | The team decided this tester's dispute, or an applicable test or work state changed. | The decision or state line. Ordinary work and payment lines do not enter the developer Rate gate. |
| Tester makes an eligible press | Developer added their side to the tester's dispute. | `{developer} added {possessive pronoun} side to your dispute about your written answers`, `… your recording`, or `… your live call on {call time}`. |
| Tester makes an eligible press | Team decided the tester's dispute. | `The team decided your dispute with {developer} about your {part}: the pay was raised to {amount}` or `The team decided your dispute with {developer} about your {part}: the pay stays at {amount}`. |

Ordinary sending and adding to work, ordinary developer payments in either direction of the race, and ordinary call activity depend on Alerts. An unrelated tester's event can appear under Alerts, while a forced same-tester event uses the target of the pressed button. [Forced event filter](../src/lib/server/live.ts#L276) · [Tester dispute wording](../src/lib/server/testerGate.ts#L145) · [Team decision wording](../src/lib/server/live.ts#L490)

## Listing, work, join and call changes

| Button and role | When | Exact line or template |
|---|---|---|
| Tester **Send / Add** | The form contains a question removed since it was shown, or a newer save added or changed a question that affects the form. | `{developer} removed the question {quoted question}`, `{developer} added the question {quoted question}`, or `{developer} made the question {quoted question} required` / `not required`. |
| Tester **Switch / Keep** | A different offer replaced the one they are answering. | `{developer} changed the terms again: {terms diff}` and `Press again to decide on these newest terms.` |
| Tester **Join / Apply / Ask to rejoin / Withdraw / No thanks** | A newer listing save or application, invitation, availability, or own action makes the page stale. | `{developer} changed the listing: your application was closed`, `{test} is full: your application was closed`, `{developer} made the test invite only: your application was closed`, `{developer} changed the listing: here's a new invite on the updated listing`, `{developer} changed the listing: your invite closed (no spots left)`, or `{test} is full right now. Your invite stays open; we'll tell you when a spot opens.` Listing edits have their own lines. The Join/Apply tail is `Press again to {verb} on the current listing.` |
| Developer **Save** | The same field changed in another tab, or the key list changed. | `{field}: your version will replace the one saved in another tab at {time}.`, `You changed the {fields} in another tab`, and added or removed key lines. The tail is `Press Save again to save.` or `Press Save again to save your changes (fields you didn't touch keep the newer values).` |
| Developer **Invite anyway** | The requirements or availability snapshot changed between selecting invitees and confirming. | `What's missing changed since you looked. Press Invite anyway again to invite on this:` followed by the current gaps. This uses the invitation confirmation panel. |
| Developer multi-tester call request | Some selected testers reached the limit and others can still receive the request. | The unavailable tester list and `Press again to send to the others ({names}).` |
| Applicable developer or tester press | Their own conflicting action happened in another tab. | `You {action} in another tab`. The action comes from the logged press and can include its target. |

A pending NDA acknowledgement or required **Switch / Keep** choice is a refusal, while a stale choice targeting an offer that has since changed uses the stop-once row above. [Questions](../src/lib/questionHistory.ts#L59) · [Terms](../src/lib/server/terms.ts#L180) · [Joining](../src/lib/server/joining.ts#L65) · [Listing wording](../src/lib/server/listingPanel.ts) · [Edit Save](../src/lib/server/tests.ts#L456) · [Invites](../src/lib/server/invites.ts#L389) · [Call request](../src/lib/server/requests.ts#L692)

## Payment and team changes

| Button and role | When | Exact line or template |
|---|---|---|
| Developer **Confirm all** | Payment set or total changed. | `Also waiting for your bank now: {payment}`, `{payment}: {reason it dropped out}`, `You {action} in another tab`, and `Confirm all now covers {count} payment(s): {total}.` A late race can give `What's waiting for your bank changed meanwhile.` |
| Developer **Pay what you owe** | A failed payment, a charge, a chargeback, or its amount changed the total. | `Another payment failed meanwhile: {item}`, `Added to what you owe meanwhile: {item}`, `Your bank's chargeback of {amount}{payment description} was reversed in your favour: {amount} taken off`, the bank's changed amount, then `New total {amount}.` Without item details, `What you owe changed: now {amount}.` A late race can give `What you owe changed meanwhile. Press again to pay what's left.` |
| Developer **Pay what you owe** | The refreshed total requires a confirmation tick or the hold requires a reservation. | `Press again to pay {amount}.`, `Press again to reserve {amount} on your card: it's taken when the team approves lifting your hold.`, or `Press again to verify your card, then reserve {amount} on it: it's taken when the team approves lifting your hold.` The tick variant starts `Tick “I confirm this payment is over $200.” and press again`. |
| Team **Decide** | The developer added their side since the admin saw the dispute. | `The developer added {possessive pronoun} side` when the change remains unanswered by the current view. |
| Team **Decide** | A developer payment since the admin opened the decision raised the paid amount above the entered total. | `{tester}'s pay changed since you opened this: the developer paid {increase} more, now {paid} paid, more than your {decision} decision. A decision can only raise the pay: decide {paid} or more.` |
| Team **Pause / Lift the pause / Stop (close) / Extend / Close now / Allow 3 more changes / Approve / Don't approve / Delete account / $0 close-out** | A newer applicable change on the same test, hold or account. | `{admin} {action} at {time}.` or `You {action} in another tab at {time}.` The action names the actual pause, lift, stop, closing-date extension, close, locked-field change, $0 close-out, hold approval or release, suspension, or reinstatement. |
| **Settings, Edit profile, Payments** | Another page changed a field or payment setting this press depends on. | `{field}: {old value} → {new value}` or its specific line such as `Password changed`, under `Changed in another tab or device since you opened this page:`. Matching or reverted values drop out. |

[Confirm all](../src/lib/server/confirmAll.ts#L241) · [Pay what you owe](../src/lib/server/holds.ts#L606) · [Reservation and tick wording](../src/lib/rules.ts#L1206) · [Decide](../src/lib/server/payments.ts#L459) · [Team action variants](../src/lib/server/adminRace.ts#L95) · [Account change gate](../src/lib/server/accountChanges.ts#L38)

## Refusal lookup by button

Use the [verbatim refusal source index](REFUSAL-NOTICE-INDEX.md) to distinguish similarly worded results. Search for these handler names to reach the conditions and variants for the button.

| Role and button | Search for |
|---|---|
| Tester Join, Apply, Ask to rejoin, Withdraw, No thanks | `joinRefusal`, `join`, `askToRejoin`, `inviteClosedLine`, `declineInvite`, `withdrawApplication` |
| Tester Send, Add, upload, Switch/Keep, Leave | `sendWritten`, `addWritten`, `answerTermsFirst`, `ndaBlockCheck`, `leaveTest`, `recordings.ts`, `terms.ts` |
| Either role's call or test chat | `requests.ts`, `calls.ts`, `messages.ts`, `cancelCall`, `joinCall` |
| Developer Pay, Pay more, Confirm, Confirm all, Pay what you owe | `payments.ts`, `confirm.ts`, `confirmAll.ts`, `holds.ts`, `chargeback.ts` |
| Tester Charge, Let it go, Dispute, Rate, Excerpt | `chargeRefusals`, `openDispute`, `testerRate`, `excerpts.ts` |
| Developer Save, Stop, End early, Rate, Invite | `editTest`, `stopTest`, `endEarly`, `devRate`, `inviteTesters` |
| Team Pause, Lift, Stop, Close, Decide, Approve, Delete | `restrictions.ts`, `pauseClosure.ts`, `decideDispute`, `chargeback.ts`, `teamClose.ts` |

Page banners, disabled buttons that do not submit, ordinary bell or email notices, and bank-provider text that is not defined by the app are outside the verbatim index. The index identifies dynamic messages by template or source formatter when the rendered sentence depends on account, test, or bank state.
