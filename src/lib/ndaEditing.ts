import { teamPausedNow } from "./restricted";

export const NDA_ONLY_EDIT = "Only the NDA can be edited while this test is paused or stopped.";
export function ndaOnlyEdit(test: { status: string; adminPausedAt: Date | null }, dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null }) {
  return test.status === "stopped" || teamPausedNow(test) || !!dev.holdStartedAt || !!dev.devSuspendedAt;
}
