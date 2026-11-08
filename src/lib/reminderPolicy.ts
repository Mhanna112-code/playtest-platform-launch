/** Older rating prompts and payout-setup/problem notices predate reminder keys; these groups contain no payment receipts. */
export const REMINDER_ONLY_GROUPS = ["ratings", "payout"];
export const NON_REMINDER_NOTICE = { reminderKey: null, OR: [{ groupKey: null }, { groupKey: { notIn: REMINDER_ONLY_GROUPS } }] };
