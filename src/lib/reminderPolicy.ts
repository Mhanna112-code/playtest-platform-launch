/** Older rating prompts and payout-setup/problem notices predate reminder keys; these groups contain no payment receipts. */
export const REMINDER_ONLY_GROUPS = ["ratings", "payout"];
export const NON_REMINDER_NOTICE = { reminderKey: null, OR: [{ groupKey: null }, { groupKey: { notIn: REMINDER_ONLY_GROUPS } }] };

/**
 * Reminder keys (by prefix) that show only their NEWEST waiting copy in EVERY morning email: Daily full summaries and the short emails too, not only the Weekly /
 * Monthly summaries (which collapse every reminder key). The older copies are marked emailed with the email; the bell keeps every copy.
 * (Owner, Nov 2026: one copy of an invite or applications reminder per email, whatever the setting)
 * Add a key here (one line) to collapse it the same way.
 */
export const NEWEST_ONLY_EVERYWHERE = ["invite:", "applications:"];
export const newestOnlyEverywhere = (reminderKey: string | null | undefined) => !!reminderKey && NEWEST_ONLY_EVERYWHERE.some((p) => reminderKey.startsWith(p));
