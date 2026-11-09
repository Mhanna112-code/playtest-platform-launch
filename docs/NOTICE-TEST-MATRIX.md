# Playtest notice test matrix

This table is organized by the button to press. Use the [stop-once reference](STOP-ONCE-NOTICES.md) for shared templates and the [refusal source index](REFUSAL-NOTICE-INDEX.md) for additional branches. The matrix covers the test, session, payment, dispute, and team controls in the manual run. It is a source audit with specific manual test cases. It does not certify every variant of every site button in the browser.

A **Stop once** row shows the change line inside the blue box. Its standard opening is `Your {button} didn't go through.` The normal closing is `Press {button} again to go ahead.` A **Refusal** row gives the message body. The usual display adds `Your {button} didn't go through: `. Rows marked **Bare** show their text on its own. Braces mark values inserted at runtime.

## Tester

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| T01 | Join | Refusal | A full test has no available spot. | `This test is full.` With an open invite, `{test} is full right now.` |
| T02 | Join | Refusal | The tester already has a working session. | `You've already joined this test.` |
| T03 | Join | Refusal | The tester presses ordinary Join for a previously ended session without an invitation or accepted rejoin. | `You can't join this test again.` |
| T04 | Join / Ask to rejoin | Refusal | The developer still blocks the tester. | `This test isn't taking new testers right now.` |
| T05 | Join / Apply / No thanks / Withdraw | Stop once | A relevant listing or invitation changed after the page drew. | One possible line is `{developer} changed the listing: here's a new invite on the updated listing`. See the [listing variants](../src/lib/server/joining.ts#L65) for changed applications, full tests, and other stale actions. |
| T06 | Send Answers / Add | Stop once | The question was removed or a new question changed what the open form can send. | `{developer} removed the question {quoted question}` or `{developer} added the question {quoted question}`. A required-state change reads `{developer} made the question {quoted question} {required or not required}`. |
| T07 | Send Answers / Send recording | Refusal | The test is paused and the tester tries to send. | `This test is paused right now. You can send this once it resumes.` |
| T08 | Send work / applicable call press | Bare refusal | A parts-and-prices offer is outstanding on the working session. | `Answer the new terms first: Switch or Keep.` |
| T09 | Switch / Keep | Stop once | A new offer replaced the offer shown on the page. | `{developer} changed the terms again: {terms diff}` then `Press again to decide on these newest terms.` |
| T10 | Dispute / Charge / applicable session press | Bare refusal | An NDA acknowledgement is pending and the pressed action requires it. | `Acknowledge the NDA change first.` This can occur on a past session after a restricted NDA edit. |
| T11 | Charge / Let it go | Refusal | The tester's own side is suspended. | `You can do this once your account is active again.` |
| T12 | Charge / Let it go / Rate | Stop once | The applicable action is still eligible and the unseen change ended this tester's work. | `{developer} ended your work early at {time}.` / `{developer} stopped this test at {time}.` / `This test was stopped at {time}.` / `This test closed at {time}.` |
| T13 | Rate or another eligible session action | Stop once | The team lifts the pause after the page's relevant timestamp and the page has not accounted for it. | `This test resumed at {time}.` A pause that also occurred after the timestamp can add `This test was paused at {time}.` |
| T14 | Applicable session action | Stop once | The developer adds their side to this tester's dispute. | `{developer} added {possessive pronoun} side to your dispute about your {part}` |
| T15 | Applicable session action | Stop once | The team decides this tester's dispute. | `The team decided your dispute with {developer} about your {part}: the pay was raised to {amount}` or `The team decided your dispute with {developer} about your {part}: the pay stays at {amount}` |
| T16 | Dispute | Refusal | This piece already has a dispute. | `You already disputed this payment. A part can be disputed once.` |
| T17 | Dispute | Refusal | The tester has rated the test. | `You rated this test, so its disputes are closed.` |
| T18 | Rate | Refusal | The tester has an open dispute, has a Charge or Let it go choice, or is suspended. | Respectively `Rating opens once the team decides your dispute.`, `Charge or let go of your unreviewed work first.`, or `You can rate once your account is active again.` |
| T19 | Rate | Refusal | Another tab already rated the developer. | `You already rated {developer}.` |
| T20 | Ask the developer | Refusal | The tester selects unpaid written answers for an excerpt. | `Only written answers the developer paid for can be shown as excerpts.` |

## Developer

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| D01 | Save | Stop once | A different tab saved a competing value for a field being edited. | `{field}: your version will replace the one saved in another tab at {time}.` Tail `Press Save again to save.` or `Press Save again to save your changes (fields you didn't touch keep the newer values).` |
| D02 | Save | Refusal | An old Edit tab submits listing or key edits while only NDA changes are permitted. | `Only the NDA can be edited while this test is paused or stopped.` A closed test uses `This test is closed, so it can't be edited.` |
| D03 | Invite anyway | Confirmation | The selection's requirement gaps changed while the confirmation was open. | `What's missing changed since you looked. Press Invite anyway again to invite on this:` followed by the updated gaps. |
| D04 | Request a time | Stop once | In a group request, some selected testers are unavailable and others can still receive it. | The current limit or conflict lines, then `Press again to send to the others ({names}).` |
| D05 | Pay / Pay more / End early / eligible call action | Stop once | The selected tester raises a dispute or the team decides it after the page's relevant timestamp. | `{tester} disputed the pay for {possessive pronoun} {part}` or `The team decided {tester}'s dispute on {possessive pronoun} {part}: {decision}` |
| D06 | Pay / Pay more / End early / eligible call action | Stop once | A qualifying Charge on the selected tester's work occurs, with ordinary payment Alerts ignored. | `Payment went through on {test}: {amount} to {tester} for the {part}` or `Payment failed on {test}: {amount} to {tester} for the {part} · pay what you owe in Payments` where the payment line is the trigger. |
| D07 | Pay / Pay more | Stop once | The tester left and this payment is still available. | `{tester} left the test` |
| D08 | Pay more | Refusal | Either side blocked the other. | `This payment isn't available.` |
| D09 | Pay | Refusal | A payment on the same piece is already at the bank. | `A payment for this is being confirmed right now.` |
| D10 | Confirm with your bank | Stop once | The team pauses after the page drew, while an existing confirmation is still eligible. | `The team paused this test at {time}.` |
| D11 | Confirm with your bank | Bare refusal | The pending bank check was cancelled underneath the open tab. | `Cancelled: nothing was charged.` |
| D12 | Confirm with your bank | Refusal | The bank declines confirmation or no eligible check exists for this payment. | `Your bank didn't confirm the payment, so nothing was charged.` or `There's nothing to confirm here.` |
| D13 | Confirm all | Stop once | Items or total changed after the page drew. | `Also waiting for your bank now: {payment}`, applicable removed-item reasons, then `Confirm all now covers {count} {payment or payments}: {total}.` Late-race variant `What's waiting for your bank changed meanwhile.` |
| D14 | Confirm all | Refusal | No payments remain eligible to confirm. | `There's nothing waiting for your bank to confirm.` A race with your own tab can identify when you confirmed the payment instead. |
| D15 | Pay what you owe | Stop once | The debts or total changed. | `Added to what you owe meanwhile: {item}` or `Another payment failed meanwhile: {item}`, with applicable adjustment lines. A late race reads `What you owe changed meanwhile. Press again to pay what's left.` |
| D16 | Rate | Refusal | Another tab already rated the tester. | `You already rated {tester}.` |

## Team and shared actions

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| A01 | Decide | Stop once | The developer added their side after the admin opened the dispute. | `The developer added {possessive pronoun} side` |
| A02 | Decide | Stop once | Pay more brought the paid amount above the entered award after the admin opened the page. | `{tester}'s pay changed since you opened this: the developer paid {increase} more, now {paid} paid, more than your {decision} decision. A decision can only raise the pay: decide {paid} or more.` |
| A03 | Pause / Lift the pause / Stop (close) / Extend / Close now / Approve | Stop once | An applicable admin action changed the same test or hold, and the current button is still eligible. | `{admin} {action} at {time}.` For your own other tab, `You {action} in another tab at {time}.` See the [exact action phrases](../src/lib/server/adminRace.ts#L119). |
| A04 | Any eligible test, session, or account control with an own-tab gate | Stop once | The current account took a relevant action elsewhere after the page's timestamp. | `You {action} in another tab` for test activity. Settings, profile, and payment settings can use `Changed in another tab or device since you opened this page:` with `{field}: {old value} → {new value}`. |

Use the [source index](REFUSAL-NOTICE-INDEX.md) for the remaining conditions and alternate copy under each handler. Site-wide browser validation, third-party bank screens, and runtime combinations still need separate coverage to claim every button and message is verified.
