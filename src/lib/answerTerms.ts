// (Owner, Oct 29, batch 27 section 1) An open new-terms offer blocks the tester's Send and every call press until they answer it (Switch or Keep).
// Shared by the server (the refusal) and the pages (the line under the pressed button). No imports: safe everywhere.
// (Owner, Dec 10 2026; replaces "and the move up to the Switch / Keep box") The page no longer moves: the line says where Switch / Keep is.

/** The one line, under the pressed button and from the server. (Owner, Dec 10 2026) "… at the top of the page." */
export const ANSWER_TERMS_FIRST = "Answer the new terms first: Switch or Keep at the top of the page.";
/** Switch / Keep when no offer is open any more: the server's refusal, and the Switch / Keep box's line when the offer is withdrawn after a press. */
export const NO_LONGER_ON_OFFER = "These terms are no longer on offer.";
/** The refusal's code. */
export const ANSWER_TERMS_CODE = "answer_terms";
/** The page event that marks the Switch / Keep box a few seconds (the session page's TesterTop listens). (Owner, Dec 10 2026) Its ring only: the page doesn't scroll. */
export const ANSWER_TERMS_EVENT = "answer-terms";
/** Switching alone preserves a sent piece's price; sending fresh written answers is the existing exception. */
export const SENT_WORK_PRICE_EXPLANATION = "Switching alone does not change submitted work. Before the tester's deadline and before Charge opens, sending more written answers, adding to an answer or sending additional recordings updates the unpaid part to their current agreed parts and price. After the tester's deadline or once Charge opens, additions preserve the piece's saved price, on-time status and Charge dates; they create no extra Charge entitlement. After payment or Charge, additions never reopen Charge.";
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
