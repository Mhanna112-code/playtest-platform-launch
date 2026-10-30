export const PAYOUT_LINE = "Your bank couldn't receive a payout. Update your payout details.";
/** (Owner, Oct 29, batch 32 §1) A tester's share waits for their payout setup: the bell line and email, again every 3 days until it's done. */
export const payoutWaitLine = (amount: string) => `${amount} is waiting for you: finish your payout setup to receive it.`;
/** (Batch 32 §1) The grey line on the join page and the session page while their payout setup isn't done. */
export const PAYOUT_SETUP_HINT = "You can join and work now; payments wait until you finish your payout setup.";
