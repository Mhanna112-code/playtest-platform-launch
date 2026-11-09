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
| D09 | Pay | Refusal | A payment on the same piece is already at the bank. | `A payment for this part is being confirmed. Wait for it to finish before paying again.` |
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


## Tester and developer application and invitation variants

[Join, Apply, Withdraw and developer application decisions](../src/lib/server/joining.ts) · [No thanks](../src/app/api/invites/%5Bid%5D/route.ts) · [Listing copy](../src/lib/listingSave.ts)

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| J01 | Join / Apply / Ask to rejoin | Refusal | The test stopped, its join date passed, or it closed to new testers. | `This test was stopped.` / `“{test}” closed to new testers on {date}.` / `This test isn't taking new testers any more.` |
| J02 | Join | Refusal | The tester attempts ordinary Join on a test that requires an application or invitation. | `This test takes applications: press Apply to join.` / `This test is invite only.` |
| J03 | Join | Refusal | The tester blocked the developer and the block remains active. | `You blocked {developer}: unblock {object pronoun} in Account → Blocked people to join.` |
| J04 | Join / Apply | Stop once | An unseen listing save changed the listing or NDA. The action is still available. | `{developer} edited the listing` or `{developer} changed the NDA: read and accept it again below`. Then `Press again to {join or apply} on the current listing.` |
| J05 | Join | Refusal | The invite closed before the press. | `This invite is no longer open.` / `This test was stopped.` / `“{test}” closed to new testers on {date}.` / `“{test}” isn't taking new testers right now, so this invite was closed.` |
| J06 | Join | Refusal | The original invitation was replaced and the current attempt needs the new invitation. | `{developer} changed the listing at {time} and sent you a new invite on it. Press Join to join on it.` |
| J07 | No thanks | Stop once | The developer replaced the invite and a fresh one is open. | `{developer} updated “{test}”: your invite was sent again on the new listing` and `The new listing: {terms}`. The second press answers the replacement. |
| J08 | No thanks | Refusal | The invitation was already used or closed. | `You already joined.` / the reason in J05. A full test can still have an open invitation. |
| J09 | Apply / Ask to rejoin | Refusal | A request is already pending. | `You already have a request waiting for this test.` Other-tab variants are `You already applied to join this test in another tab.` and `You already asked to rejoin this test in another tab.` |
| J10 | Withdraw | Refusal | The developer already accepted or declined the application. | `{developer} accepted your application at {time}, so you're in this test.` / `{developer} declined your application at {time}.` |
| J11 | Withdraw | Refusal | Another tab withdrew the application, a listing change closed it, or there is no pending application. | `You withdrew it in another tab at {time}.` / `It closed when {developer} changed the listing at {time}. You can apply again.` / `There's no pending application to withdraw.` |
| J12 | Developer Accept | Refusal | An earlier press already accepted the application. | `You already accepted this application.` |
| J13 | Developer Decline | Refusal | An earlier press already declined the application. | `You already declined this application.` |
| J14 | Developer Accept / Decline | Refusal | The tester withdrew the application, or another action already answered it. | `{tester} withdrew {possessive pronoun} application.` / `This application was already answered.` |
| J15 | Developer Accept / Decline | Refusal | The application closed because the test filled up, became invite only, changed its listing, or a block took effect. | `{tester}'s application closed when the test filled up at {time}.` / `{tester}'s application closed when the test became invite only at {time}.` / `{tester}'s application closed when you changed the listing in another tab at {time}.` / `{tester}'s application was closed.` |
| J16 | Developer Accept / Decline | Stop once | The application is still pending, but the tester's fit or rating changed since it was shown. | The current requirements or rating change line. See the [application gate](../src/lib/server/joining.ts#L328) for the formatters used for each change. |
| J17 | Cancel invite | Refusal | The tester already joined, the invite was replaced, or it was already cancelled. | `{Subject pronoun} already joined.` / `This invite is no longer valid: it was re-sent on the new listing.` / `This invite was already cancelled.` |

## Call button variants

[Call request answers and sets](../src/lib/server/requests.ts) · [Individual calls and join](../src/lib/server/calls.ts)

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| C01 | Accept | Refusal | This request was already accepted, or another time on it was booked. | `You already accepted this request at {time}.` / `You already accepted another time of this request at {time}.` / `Another time of this request was booked.` |
| C02 | Accept / Decline | Refusal | The other person withdrew the request. | `{name} withdrew this request.` |
| C03 | Decline | Refusal | The request was already declined by this side. | `You already declined this request.` |
| C04 | Withdraw | Refusal | The sender already withdrew it or the other side answered first. | `You already withdrew this request.` / `{name} declined this request at {time}.` / `This time was booked at {time}.` |
| C05 | Accept / Decline / Withdraw | Refusal | The selected time disappeared, or the whole request closed. | `That time is no longer in this request.` / `The call time {date and time} is no longer available.` / `This request closed: {reason}.` The reason can be `you have another call at that time` or `{name} is no longer free at that time`. |
| C06 | Accept / Decline | Refusal | The sender tries to answer their own request. | `You can't answer your own request: withdraw it instead.` |
| C07 | Withdraw | Refusal | The recipient tries to withdraw the sender's request. | `Only the person who asked can withdraw it.` |
| C08 | Request a time | Refusal | The session ended, or the tester tries while the test is paused. | `Your session has ended.` / `{tester}'s session has ended.` / `This test is paused right now. You can request calls once it resumes.` |
| C09 | Request a time | Refusal | No tester was selected for a developer request. | `Tick at least one tester.` |
| C10 | Join call | Refusal | The call is unavailable, including a cancelled call opened from a stale page. | `This call isn't available.` The call panel can separately show why it is unavailable. |
| C11 | Cancel call | Refusal | The individual call was already cancelled. | Developer `The call with {tester} was already cancelled.` Tester `Your call with {developer} on {date and time} was already cancelled.` |
| C12 | Cancel calls | Refusal | All remaining calls in the set were already cancelled. | `The remaining calls of this set were already cancelled.` |
| C13 | Cancel call / Cancel calls | Refusal | A reason is required because a call starts in less than 24 hours. | `The call is less than 24 hours away: say why you're cancelling (the other side sees it).` |
| C14 | Report a call problem | Refusal | A problem was already reported, or the call was cancelled. | `A problem with this call was already reported.` / `This call was cancelled.` |
| C15 | Accept | Refusal | The selected time is too soon or falls after work ends. | `{date and time} is less than {lead time} from now, so it can't be booked any more. Request a later time instead.` / `{date and time} is after testers' work on this test ends ({end date and time}), so it can't be booked.` |

## Work, rating, disputes and excerpts

[Charge and Let it go](../src/lib/server/holds.ts#L1878) · [Disputes](../src/lib/server/payments.ts) · [Rating](../src/lib/server/ratings.ts) · [Excerpts](../src/lib/server/excerpts.ts)

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| W01 | Charge | Refusal | The tester's deadline or seven-day review period has yet to pass. | `You can choose once 7 days have passed since you sent it and your deadline has passed.` |
| W02 | Let it go | Refusal | Press the stale choice before its window opens. | `You can choose once 7 days have passed since you sent it and your deadline has passed.` |
| W03 | Charge | Refusal | The piece's Charge window expired. | `Charge and Let it go closed on {date}.` |
| W04 | Let it go | Refusal | The piece's choice window expired. | `Charge and Let it go closed on {date}.` |
| W05 | Charge / Let it go | Refusal | The work was late, already settled, or already paid in full. | `You can't charge for work sent after your deadline.` / `This was already settled.` / `This part is already paid in full.` |
| W06 | Charge / Let it go | Refusal | The developer paid while the choice was open. | `{developer} paid {amount} for this meanwhile: you can dispute it if you think it should be more.` If disputes are closed, the line ends after `meanwhile.` |
| W07 | Charge / Let it go | Refusal | The developer's first Pay is already waiting for their bank on the same part. | `A payment for this is being confirmed right now.` |
| W08 | Charge | Refusal | The amount is malformed, above the allowed maximum, or below the card minimum. | `Enter an amount like 5.00.` / `At most {amount}.` / `The smallest card charge is $0.50.` |
| W09 | Dispute | Refusal | The specific piece's dispute window ended before the press. | `This part closed on {date}, so it can't be disputed any more.` |
| W10 | Send your side | Refusal | The developer already sent their side, or the team already decided the dispute. | `You already added your side.` / `This dispute was already decided.` |
| W11 | Tester Rate | Refusal | The tester's rating window expired. | `Rating closed on {date}.` |
| W12 | Developer Rate | Refusal | The developer's rating window expired. | `The 14 days to rate {tester} have passed.` |
| W13 | Developer Rate | Refusal | The team paused the test, or the developer account is restricted. | `The team paused this test: you can rate once the pause is lifted.` / `You can rate once your account is active again.` |
| W14 | Ask the developer | Refusal | A current NDA prevents a new excerpt request. | `This test now has an NDA, so its work can't be shown as an excerpt.` |
| W15 | Ask the developer | Refusal | The same excerpt is pending or already on the profile. | `You already asked to show this excerpt.` / `This excerpt is already on your profile.` |
| W16 | Ask the developer | Refusal | A different request is already pending for the part or question, or the excerpt cap is reached. | `You already asked to show an excerpt from this part. Wait for the developer's answer.` / `You already asked to show an excerpt for this question. Wait for the developer's answer.` / `You can show at most 3 excerpts. Remove one first.` |
| W17 | Allow | Refusal | The request was already allowed, denied, or withdrawn. | `You already allowed this excerpt.` / `You already denied this excerpt.` / `{tester} withdrew this request.` A missing request without a recorded withdrawal can use `This request was already decided.` |
| W18 | Deny | Refusal | The request was already allowed, denied, or withdrawn. | The same reason bodies as W17. Verify that the heading names **Deny**. |
| W19 | Remove excerpt | Refusal | The tester already removed it, or a developer tries to use an old Remove control. | `This excerpt was already taken down.` / `Only the tester can remove an excerpt from their profile.` |
| W20 | Developer Rate | Refusal | The tester has an open dispute. | `Rating opens once the team decides {tester}'s dispute.` |
| W21 | Dispute | Refusal | The tester settled the part or the part is already paid at its cap. | `You settled this part yourself (Charge or Let it go), so there's no developer decision to dispute.` / `Already paid the most this piece can be paid, so there's nothing to dispute.` |
| W22 | Chat | Refusal | The current session or account state prevents chat. | `Unable to chat with this tester.` / `Unable to chat with this developer.` |
| W23 | Leave | Refusal | The tester already left in another tab. | `You already left this test.` |
| W24 | End early | Refusal | All selected testers' work has already ended and no eligible tester remains. | `{tester or list of testers}'s work already ended.` Other unavailable selections can add their own reasons. |

## Bank, admin and account variants

[Bank confirmation](../src/lib/server/confirm.ts#L297) · [Confirm all](../src/lib/server/confirmAll.ts) · [Admin races](../src/lib/server/adminRace.ts#L189) · [Account stop-once wording](../src/lib/server/accountChanges.ts#L38)

| # | Button | Result | Setup and press | Expected wording |
|---|---|---|---|---|
| B01 | Confirm with your bank | Refusal | The individual confirmation expired. | `This confirmation expired: nothing was charged.` |
| B02 | Confirm with your bank | Refusal | An earlier press already confirmed the individual payment. | `You already confirmed this payment.` / `You already confirmed this payment in another tab at {time}.` |
| B03 | Confirm with your bank | Refusal | The individual item is already part of an open Confirm all check. | `This payment is in your Confirm all, waiting for your bank: finish that check, or cancel it.` |
| B04 | Confirm with your bank | Refusal | The payment itself is paused awaiting resumption. | `This payment is paused until your tests resume.` |
| B05 | Confirm all | Refusal | This account confirmed all listed payments in another tab. | `You already confirmed this payment in another tab at {time}.` / `You already confirmed these payments in another tab at {time}.` |
| B06 | Decide | Refusal | Another admin already decided this dispute. | `{admin} already decided this dispute at {time}.` For the same admin's other tab, `You already decided this dispute in another tab at {time}.` |
| B07 | Decide | Refusal | A bank check is still open for the disputed piece. | `The developer is confirming a payment for this piece with {possessive pronoun} bank. Decide again once it's confirmed or fails.` |
| B08 | Pause | Refusal | The test was already paused by an admin. | `That test was already paused (by {admin} at {time}).` / `You already paused this test in another tab at {time}.` |
| B09 | Lift the pause / Extend / Close now | Refusal | An admin already lifted the test's pause. | `That test's pause was already lifted (by {admin} at {time}).` / `You already lifted the pause on this test in another tab at {time}.` |
| B10 | Lift the pause | Refusal | The team has no pause to lift. | `That test isn't paused.` / `That test isn't paused by the team: it's paused by the developer's account state.` |
| B11 | Stop (close) / Close now | Refusal | Another action already stopped or closed the test. | `That test was already {stopped or closed} (by {actor} at {time}).` / `You already {stopped or closed} this test in another tab at {time}.` |
| B12 | Suspend | Refusal | An admin already suspended that side. | `That account's {tester or developer side} is already suspended (by {admin}).` / `You already suspended the {tester or developer side} in another tab at {time}.` |
| B13 | Reinstate | Refusal | An admin already reinstated that side. | `That account's {tester or developer side} was already reinstated (by {admin}).` / `You already reinstated the {tester or developer side} in another tab at {time}.` |
| B14 | Approve a chargeback hold | Refusal | Another tab or admin already approved the hold. | `That hold was already approved.` / `That hold was already approved (by {admin} at {time}).` / `You already approved lifting this hold in another tab at {time}.` |
| B15 | Settings Save | Stop once | Open Settings twice. In tab B change email from Off to Daily. Submit a different choice from stale tab A. | `Your Save didn't go through.` / `Changed in another tab or device since you opened this page:` / `Email: Off → Daily`. |
| B16 | Save profile | Stop once | Open the same side's Edit profile twice. Save a temporary name in tab B, then submit a different name from stale tab A. | `Your Save profile didn't go through.` / `Changed in another tab or device since you opened this page:` / `Name: {original} → {saved}`. |
| B17 | Change card | Stop once | On a local developer account using Stripe test mode, open Payments twice. Save another test card in tab B, then press Change card in stale tab A. | `Your Change card didn't go through.` / `Changed in another tab or device since you opened this page:` / `Card: {old card label} → {new card label}`. The first press should stop before another bank check opens. |
| B18 | Delete account (team) | Refusal | The account was already deleted. | `That account was already deleted (by {actor} at {time}).` For the same admin's other tab, `You already deleted this account in another tab at {time}.` |
| B19 | Suspend / Reinstate | Refusal | A newer state change invalidated the page or preview the admin was acting on. | `Since {your Preview or this page loaded}, {admin} {suspended or reinstated} that account's {tester or developer side} at {date and time}.` For the same admin, `Since {your Preview or this page loaded}, you {suspended or reinstated} that account's {tester or developer side} in another tab at {date and time}.` |
| B20 | Pay | Refusal | The tester used Charge or Let it go on the same piece before Pay. | `{tester} already charged {amount} for {possessive pronoun} {piece}.` / `{tester} let {possessive pronoun} {piece} go: nothing was charged.` |
| B21 | Pay | Refusal | This account already paid the same piece. | `You already paid {amount} for {tester}'s {piece}.` / `You already paid {amount} for {tester}'s {piece} in another tab at {time}.` |
| B22 | Pay / Pay more | Refusal | The relevant payment window closed. | `Pay closed on {date}.` / `Pay more closed on {date}.` |
| B23 | Pay | Refusal | The same amount is owed after an unsuccessful attempt. | `This {amount} is owed: pay it with “Pay what you owe” in Payments.` |

The matrix retains T12, T13, and D10 as reference rows. They are outside the selected manual run. A refreshed tab may remove the stale conditions needed for a stop-once test, so record whether the page updated before pressing. The [source index](REFUSAL-NOTICE-INDEX.md) covers additional validation, authentication, and technical response branches. Browser and provider variants still need their own verification.
