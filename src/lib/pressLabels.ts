// (Owner, Oct 30, batch 15 section 36) Every stop-once box and every refusal names the press first: "Your Pay didn't go through." / "Your Save didn't go through: …".
// The button's own label for each press, by its API path (the server's failed-press lines use the same table).
import { ANSWER_TERMS_FIRST } from "./answerTerms";

export const PRESS_VERBS: Record<string, string> = {
  edit: "Save", stop: "Stop the test", "end-early": "End early", "next-round": "Next round", "go-next-round": "Go to the next round", invite: "Invite", "cancel-invite": "Cancel invite", "request-time": "Request a time", "answer-request": "Answer",
  application: "Answer", join: "Join", apply: "Apply", "rejoin-ask": "Ask to rejoin", message: "Send", written: "Send", "recording-start": "Send", "recording-send": "Send", "recording-done": "Send",
  leave: "Leave", rate: "Rate", terms: "Switch or Keep", choose: "Charge", dispute: "Dispute", "dispute-side": "Send your side", "no-show": "Report", "cancel-call": "Cancel call",
  "cancel-set": "Cancel calls", "pay-extra": "Pay more", "key-broken": "Report", open: "Accept testers again", review: "Pay", "post-draft": "Post the test", "delete-draft": "Delete", "withdraw-application": "Withdraw",
};

/** (Batch 30 §20) The buttons on a call request. */
export const ANSWER_REQUEST_VERBS: Record<string, string> = { withdraw: "Withdraw", accept: "Accept", decline: "Decline" };

/** (Batch 35 §2) The buttons on an application row: the stop box and refusals name Accept or Decline (not "Answer"). */
export const APPLICATION_VERBS: Record<string, string> = { accept: "Accept", decline: "Decline" };

/** (Batch 35 §2) The press named by the body's `action` for an application or a call request ("Accept"), or undefined (the path's own label is used). */
export function bodyPressVerb(action: string | undefined, body?: unknown): string | undefined {
  const a = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  if (typeof a !== "string") return undefined;
  if (action === "application") return APPLICATION_VERBS[a];
  if (action === "answer-request") return ANSWER_REQUEST_VERBS[a];
  return undefined;
}

/** The label of the press behind an API path: "/api/tests/<id>/edit" → "Save"; "/api/review" → "Pay"; "/api/sessions/<id>/written" → "Send". */
export function pressLabelOf(path: string, body?: unknown): string {
  const p = path.split("?")[0].split("/").filter(Boolean); // api, tests, <id>, <action>
  if (p[1] === "review") return "Pay";
  // (Batch 30 §20) A call request's answer names the button pressed: Withdraw, Accept or Decline (not "Answer").
  // (Batch 35 §2) An application's Accept / Decline likewise.
  if (p[3] === "answer-request" || (p[1] === "tests" && p[3] === "application")) {
    const v = bodyPressVerb(p[3], body);
    if (v) return v;
  }
  if (p[1] === "calls" && p[3] === "join") return "Join call";
  if ((p[1] === "tests" || p[1] === "sessions") && p[3]) return PRESS_VERBS[p[3]] ?? "press";
  if (p[1] === "tests" && !p[2]) return "Post the test";
  if (p[1] === "payments" && p[2] === "owed") return "Pay what you owe";
  if (p[1] === "invites" && p[2]) return "No thanks"; // (batch 17 section 4) an invite's No thanks
  return "press";
}

/** "Pay on Ana Silva's written answers" → "Pay": the verb said in "Press <verb> again to go ahead." */
export const pressVerb = (label: string) => label.split(" on ")[0];

/** A refusal that doesn't already name the press: "Your Pay didn't go through: <reason>" (the reason as the server wrote it). */
export function refusalLine(label: string, message: string) {
  // (Batch 27 section 1) "Answer the new terms first: Switch or Keep." reads exactly so under the pressed button.
  if (!label || label === "press" || /^Your .*didn't go through/.test(message) || message === ANSWER_TERMS_FIRST) return message;
  return `Your ${label} didn't go through: ${message.trim()}`;
}
