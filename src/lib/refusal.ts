// (Owner, Nov 9, §363) A press refused because of the state of the test (and, §364, of the account or the other person): ONE short line, "{cause}, so your
// {button} didn't go through." (no date, no name, no tail); the page's banner keeps the details. Pure: the server's refusals and the pages share it.

/** "This test was stopped, so your Send didn't go through." (no press known: "This test was stopped.") */
export const pressRefused = (cause: string, press?: string | null) => (press ? `${cause}, so your ${press} didn't go through.` : `${cause}.`);

/** (§363) Every press refused because the test was stopped: the developer's Stop, the team's Stop, or the developer deleting their account. */
export const STOPPED_CAUSE = "This test was stopped";
export const stoppedPressLine = (press?: string | null) => pressRefused(STOPPED_CAUSE, press);
/** The bare line some refusals still give before a press is named (join, invites): turned into the press's line by `asPressRefusal`. */
export const TEST_WAS_STOPPED = `${STOPPED_CAUSE}.`;

/** A refusal line written without its press ("This test was stopped."), named with it. Lines of other causes are returned as they are. */
export function asPressRefusal(line: string, press: string) {
  if (line === TEST_WAS_STOPPED) return stoppedPressLine(press);
  return line;
}
