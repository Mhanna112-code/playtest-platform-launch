// (Owner, Oct 30, batch 15 section 36) Every stop-once box and every refusal names the press first: "Your Pay didn't go through." / "Your Save didn't go through: …".
// The button's own label for each press, by its API path (the server's failed-press lines use the same table).

export const PRESS_VERBS: Record<string, string> = {
  edit: "Save", stop: "Stop the test", "end-early": "End early", "next-round": "Next round", invite: "Invite", "cancel-invite": "Cancel invite", "request-time": "Request a time", "answer-request": "Answer",
  application: "Answer", join: "Join", apply: "Apply", "rejoin-ask": "Ask to rejoin", message: "Send", written: "Send", "recording-start": "Send", "recording-send": "Send", "recording-done": "Send",
  leave: "Leave", rate: "Rate", terms: "Switch or Keep", choose: "Charge", dispute: "Dispute", "dispute-side": "Send your side", "no-show": "Report", "cancel-call": "Cancel call",
  "cancel-set": "Cancel calls", "pay-extra": "Pay more", "key-broken": "Report", open: "Accept testers again", review: "Pay", "post-draft": "Post the test", "delete-draft": "Delete", "withdraw-application": "Withdraw",
};

/** The label of the press behind an API path: "/api/tests/<id>/edit" → "Save"; "/api/review" → "Pay"; "/api/sessions/<id>/written" → "Send". */
export function pressLabelOf(path: string): string {
  const p = path.split("?")[0].split("/").filter(Boolean); // api, tests, <id>, <action>
  if (p[1] === "review") return "Pay";
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
  if (!label || label === "press" || /^Your .*didn't go through/.test(message)) return message;
  return `Your ${label} didn't go through: ${message.trim()}`;
}
