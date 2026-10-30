// (Owner, Oct 29, batch 27 section 1) An open new-terms offer blocks the tester's Send and every call press until they answer it (Switch or Keep).
// Shared by the server (the refusal) and the pages (the line under the pressed button, and the move up to the Switch / Keep box). No imports: safe everywhere.

/** The one line, under the pressed button and from the server. */
export const ANSWER_TERMS_FIRST = "Answer the new terms first: Switch or Keep.";
/** The refusal's code. */
export const ANSWER_TERMS_CODE = "answer_terms";
/** The page event that brings the Switch / Keep box into view, highlighted for a few seconds (the session page's TesterTop listens). */
export const ANSWER_TERMS_EVENT = "answer-terms";
/**
 * The session presses an open offer blocks: Send my answers / updated answers, Send my recording(s), Request a time, Accept / Decline / Withdraw, Cancel call, Cancel the
 * remaining calls, and (owner, Oct 29, batch 32 §7) Charge, Let it go and Dispute.
 */
export const TERMS_BLOCKED_ACTIONS: readonly string[] = ["written", "recording-send", "request-time", "answer-request", "cancel-call", "cancel-set", "choose", "dispute"];

/** Is this API path one of the blocked presses (the session presses above, or Join call)? */
export function termsBlockedPath(path: string) {
  const p = path.split("?")[0].split("/").filter(Boolean); // api, sessions | calls, <id>, <action>
  if (p[0] !== "api" || p.length !== 4) return false;
  if (p[1] === "sessions") return TERMS_BLOCKED_ACTIONS.includes(p[3]);
  return p[1] === "calls" && p[3] === "join";
}
