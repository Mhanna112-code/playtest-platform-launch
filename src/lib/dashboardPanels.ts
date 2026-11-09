import { pauseCauses } from "./pause";

export const PREVIOUS_TEST_FILTERS = ["Removed From", "Closed", "Left"];
/** (Owner, Nov 9, §353) The developer's Your tests ticks; each test is in exactly one (a draft in none). */
export const DEV_TEST_FILTERS = ["Stopped by admin", "Stopped by you", "Paused", "Open", "Closed"];
export function previousTestGroup(c: {status:string;endKind:string;test:{status:string;workEndedAt:Date|null}}): string|null {
 if(c.endKind === "early" || c.endKind === "suspended" || c.endKind === "removed" || c.endKind === "blocked") return "Removed From";
 if(c.status === "left") return "Left";
 if(c.status !== "working" || c.test.status === "stopped" || c.test.status === "closed" || c.test.workEndedAt) return "Closed";
 return null;
}
/**
 * (Owner, Nov 9, §353) Which of the developer's Your tests ticks a test is under (it listed stopped and closed tests under "Open" until their close-out, and a
 * stopped test as Paused too during a hold or suspension):
 *   Closed: its work ended (status "closed" / workEndedAt: the last deadline passed), or a pause ran 7 days and closed it (pauseClosedAt).
 *   Stopped by admin: stopped by the team (adminStoppedAt). Stopped by you: stopped by the developer.
 *   Paused: running and paused for any cause (the team's pause, a payment or chargeback hold, a developer suspension).
 *   Open: running (status "open", work not ended) and not paused: full, and past Open until with testers still working, included.
 *   A draft: none.
 */
export function developerTestGroups(
  t: { status: string; adminStoppedAt: Date | null; pauseClosedAt?: Date | null; workEndedAt?: Date | null; adminPausedAt?: Date | null },
  dev: { holdStartedAt?: Date | null; holdReason?: string | null; devSuspendedAt?: Date | null },
): string[] {
  if (t.status === "draft") return [];
  if (t.status === "closed" || t.workEndedAt || (t.status === "stopped" && t.pauseClosedAt)) return ["Closed"];
  if (t.status === "stopped") return [t.adminStoppedAt ? "Stopped by admin" : "Stopped by you"];
  return [pauseCauses(dev, t).length ? "Paused" : "Open"];
}
