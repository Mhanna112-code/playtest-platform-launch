// (Owner, Nov 9, §363; §364) A press refused because of the state of the test, of the account, or of the other person: ONE short line, "{cause}, so your {button}
// didn't go through." (no date, no name, no tail); the page's banner, the dashboard's blue box, the payment row or the bell keeps the details. Pure: the server's
// refusals and the pages share it.

/** "This test was stopped, so your Send didn't go through." (no press known: "This test was stopped.") */
export const pressRefused = (cause: string, press?: string | null) => (press ? `${cause}, so your ${press} didn't go through.` : `${cause}.`);

/** (§363) Every press refused because the test was stopped: the developer's Stop, the team's Stop, or the developer deleting their account (§364 item 9). */
export const STOPPED_CAUSE = "This test was stopped";
export const stoppedPressLine = (press?: string | null) => pressRefused(STOPPED_CAUSE, press);
/** The bare line some refusals still give before a press is named (join, invites): turned into the press's line by `asPressRefusal`. */
export const TEST_WAS_STOPPED = `${STOPPED_CAUSE}.`;

/** (§364 item 2) The work window ended (test close): "This test ended, so your Send didn't go through." Never why (a pause closure never says it). */
export const ENDED_CAUSE = "This test ended";
/** (§364 item 3) The tester's own part ended (left, rated, ended early, blocked, removed): "Your part in this test has ended, so your Send didn't go through." */
export const PART_ENDED_CAUSE = "Your part in this test has ended";
/** (§364 item 4) The developer's press about a tester whose session ended (left, ended, removed, deleted their account). */
export const sessionEndedCause = (name: string) => `${name}'s session has ended`;
/** (§364 item 5) The tester's press on a paused test (any cause; never why). The banner keeps "Sending work and requesting calls come back when it resumes." */
export const PAUSED_CAUSE = "This test is paused right now";
/** (§364 item 6) The developer's press on a test the team paused. The banner keeps what still works. */
export const TEAM_PAUSED_CAUSE = "The team paused this test";
/** (§364 item 7) The developer's press during their payment or chargeback hold ("Pay what you owe first." stays for owing without a hold). */
export const HELD_CAUSE = "Your tests are paused";
/** (§364 item 8) A suspended tester (or a suspended admin). */
export const ACCOUNT_PAUSED_CAUSE = "Your account is paused";
/** (§364 item 8) A suspended developer. */
export const ACCOUNT_SUSPENDED_CAUSE = "Your account is suspended";
/** (§364 item 10) Join / Apply / an invite on a test that can't take testers right now (paused, or the developer blocked them: never why). */
export const NOT_TAKING_CAUSE = "This test isn't taking new testers right now";
/** (§364 item 10) Open until passed. */
export const closedToNewCause = (date: string) => `This test closed to new testers on ${date}`;
/** (§364 item 12) Your own deleted account (an old tab's press). */
export const ACCOUNT_NO_LONGER_EXISTS = "This account no longer exists.";
/** (§364 item 13) Cancel call / Cancel calls on a call (or a set's calls) already cancelled. */
export const CALL_ALREADY_CANCELLED = "This call was already cancelled.";

/** The press names the old "{what} waits until …" refusals used: "extra pay" is the Pay more button. */
export const pressOfWhat = (what: string) => (what === "extra pay" ? "Pay more" : what);

const ANY_MORE = "This test isn't taking new testers any more.";
/**
 * A refusal line written without its press (the join refusals' and the invite's), named with it: stopped (§363), Open until passed, paused / blocked / an
 * invite closed by a pause ("isn't taking new testers right now"), not open any more. Lines of other causes (full, already joined, the key line …) stay as they are.
 */
export function asPressRefusal(line: string, press: string) {
  if (line === TEST_WAS_STOPPED) return stoppedPressLine(press);
  const closed = /^(?:This test|“.*”) closed to new testers on (.+)\.$/.exec(line);
  if (closed) return pressRefused(closedToNewCause(closed[1]), press);
  if (line === "This test is paused right now." || line === `${NOT_TAKING_CAUSE}.` || / isn't taking new testers right now, so this invite was closed\.$/.test(line)) return pressRefused(NOT_TAKING_CAUSE, press);
  if (line === ANY_MORE) return pressRefused(ANY_MORE.replace(/\.$/, ""), press);
  return line;
}

/** (Owner, Nov 11, §377) A full test, for Join, Apply and Ask to rejoin: "This test is full, so your Join didn't go through." */
export const FULL_CAUSE = "This test is full";
/**
 * (Owner, Nov 11, §377) A join refusal (joinRefusal's line) named with Join, Apply or Ask to rejoin: asPressRefusal's lines, and "This test is full." in the
 * pattern too. Every other line stays as it is (the invite's "<title> is full right now.", already joined, the key line, the test limit …).
 */
export const joinPressRefusal = (line: string, press: string) => (line === `${FULL_CAUSE}.` ? pressRefused(FULL_CAUSE, press) : asPressRefusal(line, press));
