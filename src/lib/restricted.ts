// (Owner, Oct 27) A payment hold, a chargeback hold and an admin suspension are ONE state for a developer's pages: every page of theirs that
// changes anything is closed, every press is refused (and routes them to the top of the dashboard), and a blue box there says why and how to resume.
// (Owner, Oct 30, batch 15 section 16) Suspensions are per side: a developer-side suspension restricts only the developer side (like a hold), a tester-side one only
// the tester side. A mixed account keeps the other side working.
// Pure helpers shared by the server, the layout and the browser.
import { ACCOUNT_SUSPENDED_CAUSE, HELD_CAUSE, TEAM_PAUSED_CAUSE } from "./refusal";

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
/**
 * (Owner, Nov 4, §172; replaces batch 15 sections 1, 23 and 37 and batch 17 §14 for a team pause) The team's pause of ONE test follows the same exact rules as a
 * developer suspension, for that test only: the same presses still work (Stop, End early, Cancel call and the developer's side of a dispute). Rate reaches its own
 * refusal (RATE_TEAM_PAUSED), as a suspended developer's does; chat waits for the lift.
 * (Owner, Nov 11, §386 A; replaces §368) No money moves while the test or the developer is paused: Pay more is refused like every other payment press (moneyFrozen).
 */
// (Owner, Nov 11, §379 item 1) The developer's chat Send goes through during the team's pause of their test (not during their own suspension or hold).
export const TEAM_PAUSED_OK_ACTIONS = new Set([...RESTRICTED_OK_ACTIONS, "message"]);

/** (§172) Is this test paused by the team right now? A stopped or closed test isn't paused any more (the team can't lift it then: its pause is over). */
export const teamPausedNow = (t: { adminPausedAt?: Date | string | null; status?: string | null }) => !!t.adminPausedAt && t.status !== "stopped";
/** (§172) What a refused press on a test the team paused says (never "suspended" or "hold"). */
export const TEAM_PAUSED_LINE = "The team paused this test: you can stop it, end testers' work early, cancel calls, or add your side of a dispute."; // (§386 A) paying waits
/** (§172) The developer's Rate on a test the team paused (a suspended developer's reads RATE_INACTIVE). */
export const RATE_TEAM_PAUSED = "The team paused this test: you can rate once the pause is lifted.";


/**
 * A short key for the restriction a page is under ("" = none, "s" developer side suspended, "t" tester side suspended, "h" payment hold, "c" chargeback hold). The layout
 * renders it and the tab compares it with the account's status every ~20 s: a change from "" moves the tab to the top of the dashboard.
 */
export function restrictionKey(u: Restrictable & { isDeveloper?: boolean; isTester?: boolean; side?: string }, side?: string | null): string {
  const dev = devRestricted(u, side);
  const held = dev && u.holdStartedAt;
  return `${dev && u.devSuspendedAt ? "s" : ""}${testerRestricted(u, side) ? "t" : ""}${held ? (u.holdReason === "chargeback" ? "c" : "h") : ""}`;
}

/**
 * (Owner, Nov 11, §386 A; replaces §368, §113 and §358 for the money windows) No money moves while the test or its developer is paused: "frozen" is a team pause
 * of the test still in force (teamPausedNow: a closed test's pause that began before it closed counts; a stopped test's doesn't), the developer's payment or
 * chargeback hold, or their developer-side suspension, during the test AND after it closed or stopped (a hold or suspension can start after). While frozen the
 * developer's Pay, Pay more, Confirm with your bank and Confirm all, the tester's Charge and Let it go, and a listed call's automatic charge are refused or wait;
 * each piece's own dates and closing date move on by the frozen time. Pay what you owe, the chargeback steps, the subscription and both sides of a dispute go on.
 * The cause that names a refusal: a suspension first (as before), then a hold, then the team's pause.
 * (Owner, Nov 11, §386 F) A developer's deletion ends the freeze: a deleted account can never be reinstated or have its hold lifted, so nothing is frozen once the
 * developer is deleted (even with a suspension, a hold or the team's pause still on the rows), and each frozen span ends at the deletion (closeOut moneySpans).
 * The batch 12 deletion rule then applies: pieces already open to Charge stay open (charged to the saved card); work under review never opens Charge.
 */
export type MoneyFreeze = "suspension" | "hold" | "team";
export function moneyFrozen(
  dev: { holdStartedAt?: Date | string | null; devSuspendedAt?: Date | string | null; deletedAt?: Date | string | null },
  test?: { adminPausedAt?: Date | string | null; status?: string | null } | null,
): MoneyFreeze | null {
  if (dev.deletedAt) return null; // (§386 F)
  if (dev.devSuspendedAt) return "suspension";
  if (dev.holdStartedAt) return "hold";
  if (test && teamPausedNow(test)) return "team";
  return null;
}
/** (§386 A) The developer's refusal cause: "Your account is suspended" / "Your tests are paused" / "The team paused this test" (+ ", so your Pay didn't go through."). */
export const frozenCause = (f: MoneyFreeze) => (f === "suspension" ? ACCOUNT_SUSPENDED_CAUSE : f === "hold" ? HELD_CAUSE : TEAM_PAUSED_CAUSE);
/** (§386 A) The tester's cause, whatever froze it (never the developer's hold or suspension): "This test is paused, so your Charge didn't go through." */
export const TESTER_FROZEN_CAUSE = "This test is paused";
