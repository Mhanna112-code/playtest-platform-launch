# Existing bank confirmations remain available

Confirm with your bank and Confirm all can start and finish during a developer suspension or an admin pause of a test. Confirm all includes eligible waiting charges from paused tests. The usual stop-once checks still list an unseen pause, suspension or other relevant change before the next press proceeds.

The existing three-day confirmation deadline keeps running; neither a pause nor its lift resets it. Confirm all retains its existing earliest-item deadline and shorter inline bank-check limit. Expired, cancelled, covered or already-settled payments keep their normal refusals and duplicate-payment protection.

(Owner, Nov 9, §368; replaces "This does not allow new Pay or Pay more during those restrictions") New Pay, Pay more and a call's Pay now go through and charge at once during a developer suspension or a team pause, and a listed call's automatic charge is made then too, the same as the tester's Charge; neither restriction cancels the developer's own open bank check any more. Only a payment or chargeback hold keeps them waiting for Pay what you owe. A deferred payment from before the change is charged at the next sweep (only a hold keeps it waiting). Existing checks cancelled when a restriction began remain cancelled. Coverage: `pay-during-pauses-368.test.ts`.

Regression coverage: `confirm-during-pauses.test.ts` tests single and bulk confirmation under both restrictions, stop-once behavior, payment completion, restrictions remaining in place, new payment refusals, and the original three-day deadline through pause/lift/expiry. Existing Confirm all and team-pause suites are also run.
