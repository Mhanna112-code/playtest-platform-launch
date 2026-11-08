# Existing bank confirmations remain available

Confirm with your bank and Confirm all can start and finish during a developer suspension or an admin pause of a test. Confirm all includes eligible waiting charges from paused tests. The usual stop-once checks still list an unseen pause, suspension or other relevant change before the next press proceeds.

The existing three-day confirmation deadline keeps running; neither a pause nor its lift resets it. Confirm all retains its existing earliest-item deadline and shorter inline bank-check limit. Expired, cancelled, covered or already-settled payments keep their normal refusals and duplicate-payment protection.

This does not allow new Pay or Pay more during those restrictions, or turn a deferred payment into a confirmable bank check. Existing checks cancelled when a restriction began remain cancelled.

Regression coverage: `confirm-during-pauses.test.ts` tests single and bulk confirmation under both restrictions, stop-once behavior, payment completion, restrictions remaining in place, new payment refusals, and the original three-day deadline through pause/lift/expiry. Existing Confirm all and team-pause suites are also run.
