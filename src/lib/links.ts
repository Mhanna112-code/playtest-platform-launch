// (Owner, Oct 26) Every bell line opens the exact place. Developer: the test page at the item (#piece-<submission> in Needs you, #tester-<session>,
// #call-<call>). Tester: the session page at the part or call (#part-written, #part-recording, #part-live, #call-<call>). Admin: /admin?dispute=<id>
// (the dispute row) or /admin?user=<id> (the account).

/** The session page's part for what a payment label names ("written answers", "recording", "live call"). */
export const partAnchor = (label: string) => (label === "recording" ? "part-recording" : label === "live call" || label === "call" ? "part-live" : "part-written");
