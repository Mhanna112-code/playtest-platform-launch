// (Owner, Oct 27) A payment hold, a chargeback hold and an admin suspension are ONE state for a developer's pages: every page of theirs that
// changes anything is closed, every press is refused (and routes them to the top of the dashboard), and a blue box there says why and how to resume.
// (Owner, Oct 30, batch 15 section 16) Suspensions are per side: a developer-side suspension restricts only the developer side (like a hold), a tester-side one only
// the tester side. A mixed account keeps the other side working.
// Pure helpers shared by the server, the layout and the browser.

export type DevRestriction = "suspended" | "hold" | "chargeback";
export type Restrictable = {
  devSuspendedAt?: Date | string | null;
  testerSuspendedAt?: Date | string | null;
  holdStartedAt?: Date | string | null;
  holdReason?: string | null;
};

/** Is either side suspended? */
export const anySuspended = (u: Restrictable) => !!(u.devSuspendedAt || u.testerSuspendedAt);

/** Why a developer is restricted right now (null = not). A suspension wins over a hold for the wording of what to do first. */
export function restrictionOf(u: Restrictable): DevRestriction | null {
  if (u.devSuspendedAt) return "suspended";
  if (u.holdStartedAt) return u.holdReason === "chargeback" ? "chargeback" : "hold";
  return null;
}

/** Every cause that applies (a suspended developer can also be on a hold). */
export function restrictionsOf(u: Restrictable): DevRestriction[] {
  const out: DevRestriction[] = [];
  if (u.devSuspendedAt) out.push("suspended");
  if (u.holdStartedAt) out.push(u.holdReason === "chargeback" ? "chargeback" : "hold");
  return out;
}

/**
 * Is the account restricted as a DEVELOPER? A developer-side suspension, a payment hold or a chargeback hold restricts only the developer side: an account with a
 * tester side that is on its tester side is not (batch 15 section 16: suspensions work like holds here).
 */
export function devRestricted(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): boolean {
  if (!u.isDeveloper || !(u.devSuspendedAt || u.holdStartedAt)) return false;
  const using = side ?? u.side ?? "";
  return !u.isTester || using !== "tester";
}

/** Is the account restricted as a TESTER (its tester side suspended, and the tester side is the one in use)? */
export function testerRestricted(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): boolean {
  if (!u.isTester || !u.testerSuspendedAt) return false;
  const using = side ?? u.side ?? "";
  return !u.isDeveloper || using === "tester";
}

/**
 * The press verbs that still work for a restricted developer (everything else is refused on the server). (Owner, Oct 30, batch 15 sections 27, 29 and 37) Stop the
 * test, End early and Cancel call, from the restricted view of a test page (and Cancel call from the dashboard's Calls box); and the developer's side of a dispute.
 */
export const RESTRICTED_OK_ACTIONS = new Set(["cancel-call", "stop", "end-early", "dispute-side"]);
/** (Batch 15 section 23) What still works on a test the team paused (the same pair, plus chat and the side of a dispute). */
// (Owner, Oct 28, batch 17 section 14) Rate too: both sides rate a test the team paused, straight through (not while the developer is held or suspended).
export const TEAM_PAUSED_OK_ACTIONS = new Set(["stop", "end-early", "cancel-call", "message", "dispute-side", "rate"]);

/** What a refused press tells the developer (the blue box at the dashboard top says the rest). */
export const RESTRICTED_LINE: Record<DevRestriction, string> = {
  suspended: "Your account is suspended: your tests are paused.",
  hold: "Your account is on hold until you pay what you owe: your tests are paused.",
  chargeback: "Your account is on hold after a chargeback: your tests are paused.",
};

/** Testers never read "hold", "suspended", "failed" or "chargeback" about a developer. */
export const PAUSED_TEST_LINE = "This test is paused right now.";

/**
 * A short key for the restriction a page is under ("" = none, "s" developer side suspended, "t" tester side suspended, "h" payment hold, "c" chargeback hold). The layout
 * renders it and the tab compares it with the account's status every ~20 s: a change from "" moves the tab to the top of the dashboard.
 */
export function restrictionKey(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): string {
  const dev = devRestricted(u, side);
  const held = dev && u.holdStartedAt;
  return `${dev && u.devSuspendedAt ? "s" : ""}${testerRestricted(u, side) ? "t" : ""}${held ? (u.holdReason === "chargeback" ? "c" : "h") : ""}`;
}
