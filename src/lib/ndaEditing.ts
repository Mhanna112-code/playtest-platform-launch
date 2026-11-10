import { teamPausedNow } from "./restricted";

export const NDA_ONLY_EDIT = "Only the NDA can be edited while this test is paused or stopped.";
/** (Owner, Nov 9, §358) A closed test (its work ended on its own: test close passed) is edited like a stopped one: the NDA only. */
export const workEndedTest = (test: { status: string; workEndedAt?: Date | null }) => test.status === "closed" || !!test.workEndedAt;
export function ndaOnlyEdit(test: { status: string; adminPausedAt: Date | null; workEndedAt?: Date | null }, dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null }) {
  return test.status === "stopped" || workEndedTest(test) || teamPausedNow(test) || !!dev.holdStartedAt || !!dev.devSuspendedAt;
}
