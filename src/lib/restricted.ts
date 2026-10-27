// (Owner, Oct 27) A payment hold, a chargeback hold and an admin suspension are ONE state for a developer's pages: every page of theirs that
// changes anything is closed, every press is refused (and routes them to the top of the dashboard), and a blue box there says why and how to resume.
// Pure helpers shared by the server, the layout and the browser.

export type DevRestriction = "suspended" | "hold" | "chargeback";
export type Restrictable = { suspendedAt?: Date | string | null; holdStartedAt?: Date | string | null; holdReason?: string | null };

/** Why a developer is restricted right now (null = not). A suspension wins over a hold for the wording of what to do first. */
export function restrictionOf(u: Restrictable): DevRestriction | null {
  if (u.suspendedAt) return "suspended";
  if (u.holdStartedAt) return u.holdReason === "chargeback" ? "chargeback" : "hold";
  return null;
}

/** Every cause that applies (a suspended developer can also be on a hold). */
export function restrictionsOf(u: Restrictable): DevRestriction[] {
  const out: DevRestriction[] = [];
  if (u.suspendedAt) out.push("suspended");
  if (u.holdStartedAt) out.push(u.holdReason === "chargeback" ? "chargeback" : "hold");
  return out;
}

/**
 * Is the account restricted as a DEVELOPER? An admin suspension restricts the whole account, so it counts for a developer whatever side is in use; a payment
 * or chargeback hold restricts only the developer side: an account with a tester side that is on its tester side is not.
 */
export function devRestricted(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): boolean {
  if (u.suspendedAt) return true;
  if (!u.holdStartedAt || !u.isDeveloper) return false;
  const using = side ?? u.side ?? "";
  return !u.isTester || using !== "tester";
}

/** The press verbs that still work for a restricted developer (everything else is refused on the server): only Cancel call, from the dashboard's Calls box. */
export const RESTRICTED_OK_ACTIONS = new Set(["cancel-call"]);

/** What a refused press tells the developer (the blue box at the dashboard top says the rest). */
export const RESTRICTED_LINE: Record<DevRestriction, string> = {
  suspended: "Your account is suspended: your tests are paused.",
  hold: "Your account is on hold until you pay what you owe: your tests are paused.",
  chargeback: "Your account is on hold after a chargeback: your tests are paused.",
};

/** Testers never read "hold", "suspended", "failed" or "chargeback" about a developer. */
export const PAUSED_TEST_LINE = "This test is paused right now.";

/**
 * A short key for the restriction a page is under ("" = none, "s" suspended, "h" payment hold, "c" chargeback hold; "sh" both). The layout renders it and the tab compares it with the
 * account's status every ~20 s: a change from "" moves the tab to the top of the dashboard.
 */
export function restrictionKey(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): string {
  const held = u.holdStartedAt && u.isDeveloper && devRestricted({ ...u, suspendedAt: null }, side);
  return `${u.suspendedAt ? "s" : ""}${held ? (u.holdReason === "chargeback" ? "c" : "h") : ""}`;
}
