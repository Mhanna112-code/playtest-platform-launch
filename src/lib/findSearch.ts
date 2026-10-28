import { testPaused } from "./rules";

/**
 * (Owner, Oct 28, batch 17 section 8) Find tests' search box: test name, product name or developer name, any part, any case, searched on the server
 * together with the category chips, Device / Part / Sort by / Show. Admins get the same page listing every test, each card with its state.
 */
export const FIND_SEARCH_LABEL = "Search tests or developers";
/** The longest search the server looks at (anything after it is ignored). */
export const FIND_SEARCH_MAX = 100;
export const findQuery = (q: unknown) => (typeof q === "string" ? q.trim().slice(0, FIND_SEARCH_MAX) : "");
/** "No open tests match “har”." (an admin's list holds every test: "No tests match “har”."). */
export const noFindMatchLine = (typed: string, admin = false) => `No ${admin ? "" : "open "}tests match “${typed.trim()}”.`;

/** (Batch 17 section 8) The states an admin's Find tests shows on each card, in the order of its tick boxes. */
export const TEST_STATES = ["Open", "Full", "Joining closed", "Paused", "Stopped", "Closed", "Draft", "Invite only"] as const;
export type TestState = (typeof TEST_STATES)[number];
/** The URL form of a state ("Joining closed" → "joining-closed"). */
export const stateKey = (s: TestState) => s.toLowerCase().replace(/ /g, "-");
/** The ticked states from the URL's `states=open,full` (unknown words are ignored; none ticked = every state). */
export function statesFrom(v: unknown): TestState[] {
  const keys = typeof v === "string" ? v.split(",") : [];
  return TEST_STATES.filter((s) => keys.includes(stateKey(s)));
}

/**
 * One test's state for the admin's card. A test is in exactly one, the first that applies: Draft; Stopped (the developer's or the team's Stop) or Closed (it closed
 * after its pause, or the team's Close now); Paused (a hold, the developer's suspension or the team's pause); Joining closed (Open until passed); Full; Invite only; Open.
 */
export function testState(
  t: { status: string; openUntil: Date | null; adminPausedAt?: Date | null; pauseClosedAt?: Date | null; joinMode: string; spots: number },
  dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null },
  working: number,
  now = new Date(),
): TestState {
  if (t.status === "draft") return "Draft";
  if (t.status === "stopped") return t.pauseClosedAt ? "Closed" : "Stopped";
  if (t.status === "closed") return "Closed";
  if (testPaused(dev, t)) return "Paused";
  if (t.openUntil && t.openUntil < now) return "Joining closed";
  if (working >= t.spots) return "Full";
  if (t.joinMode === "invite") return "Invite only";
  return "Open";
}
