// (Owner, Oct 30, batch 15 section 36) Every stop-once box and every refusal names the press first: "Your Pay didn't go through." / "Your Save didn't go through: …".
// The button's own label for each press, by its API path (the server's failed-press lines use the same table).
import { ANSWER_TERMS_FIRST } from "./answerTerms";
import { CANCEL_CHECK, CONFIRM_WITH_BANK } from "./rules";
import { CONFIRM_ALL } from "./confirmAllText";
import { CANCELLED_NOTHING_CHARGED } from "./bankNotice";
/** The server's line for a bank check cancelled underneath it (confirm.ts CONFIRM_CANCELLED: a team pause, a new card, a chargeback won). */
export const CHECK_CANCELLED_UNDERNEATH = "This payment was cancelled: nothing was charged.";
import { SUBSCRIPTION_PRICE } from "./subscription";

export const PRESS_VERBS: Record<string, string> = {
  edit: "Save", stop: "Stop the test", "end-early": "End early", "next-round": "Next round", invite: "Invite", "cancel-invite": "Cancel invite", "request-time": "Request a time", "answer-request": "Answer",
  application: "Answer", join: "Join", apply: "Apply", "rejoin-ask": "Ask to rejoin", message: "Send", written: "Send", "recording-start": "Send", "recording-send": "Send", "recording-done": "Send",
  leave: "Leave", rate: "Rate", terms: "Switch or Keep", choose: "Charge", dispute: "Dispute", "dispute-side": "Send your side", "no-show": "Report", "cancel-call": "Cancel call",
  "cancel-set": "Cancel calls", "pay-extra": "Pay more", open: "Accept testers again", review: "Pay", "post-draft": "Post the test", "delete-draft": "Delete", "withdraw-application": "Withdraw",
  // (Owner, Nov 3, races) Adding to sent answers is "Add" (its refusal named no press: "Nora Lane stopped the test on Nov 3…" alone); the removed-from card's Dismiss.
  "written-add": "Add", "dismiss-removed": "Dismiss",
  // (Owner, Nov 3, §156) Presses that named nothing ("press"): a recording's Remove, the developer's broken-key Dismiss (its count is in pressLabelOf), and the
  // tester's key report by its button's own words (as the stopped line's "your “This key doesn't work” didn't go through").
  "recording-remove": "Remove", "keys-dismiss": "Dismiss selected", "key-broken": "“This key doesn't work”",
};

/**
 * (Owner, Nov 4, batch 35 §170) The tester's "Send the dispute" button is the press Dispute: its refusals read "Your Dispute didn't go through: …" (not "Your Send
 * the dispute …"). Likewise the written answers' "Send my answers" button is the press Send, and "Add to my answer" the press Add (§146), as the server's
 * own lines name them (FormMistakes' `named`).
 */
export const DISPUTE_PRESS = PRESS_VERBS.dispute;

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

/** (§156) The admin console's buttons, by their /api/admin/<action> (the labels AdminButton shows). */
export const ADMIN_PRESS: Record<string, string> = {
  suspend: "Suspend", unsuspend: "Reinstate", "delete-account": "Delete account", "pause-test": "Pause", "unpause-test": "Lift the pause", "stop-test": "Stop (close)",
  "allow-critical-changes": "Allow 3 more changes of the locked fields", "approve-hold": "Approve", "approve-chargeback": "Approve",
  "decline-chargeback": "Don't approve: release the reservation", "emails-clear": "Clear this list (the emails are kept)", "approve-outage": "Approve: move every timer",
  "approve-gap": "Approve: move every timer", "dismiss-gap": "Dismiss", "contact-replied": "Mark replied", "extend-pause": "Extend", "close-paused": "Close now",
  decide: "Decide", "preview-suspension": "Preview suspension",
};
/** (§156) Team close's button: "Close all open reviews for $0" (an account) or "Close this test's open reviews for $0" (a test). */
export const teamCloseLabel = (scope: unknown) => (scope === "developer" ? "Close all open reviews for $0" : "Close this test's open reviews for $0");

/** (§156) Payments' form buttons (Add a card / Change card, the payout setup): the form sends which one it showed; anything else reads as the first. */
export const CARD_PRESSES = ["Add a card", "Change card"];
export const PAYOUT_PRESSES = ["Connect a payout account", "Continue setup", "Update payout details", "Change payout details"];
/** (Owner, Nov 5, §200) A connected payout account's button: Stripe's Express dashboard, where the bank account is changed. */
export const CHANGE_PAYOUT = "Change payout details";
/** (§200) The presses that go to Stripe's pages for a connected account (/api/payments/payout-dashboard): the banner's, else Change payout details. */
export const PAYOUT_CHANGE_PRESSES = [CHANGE_PAYOUT, "Update payout details"];

/**
 * (Owner, Nov 3, §156) Every press outside tests / sessions, by its route (and its body where one route serves several buttons): the button's own label.
 * Undefined for a path that isn't one of these presses (a read, or something no button sends).
 */
function otherPress(p: string[], b: Record<string, unknown>): string | undefined {
  const [, a, x, y] = p;
  const pick = (v: unknown, list: string[]) => (typeof v === "string" && list.includes(v) ? v : list[0]);
  switch (a) {
    case "review": return "Pay";
    case "blocks": return b.action === "unblock" ? "Unblock" : "Block";
    case "direct": return x ? "Send" : undefined;
    case "excerpts": return b.action === "decide" ? (b.decision === "deny" ? "Deny" : "Allow") : b.action === "remove" ? "Remove" : "Ask the developer";
    case "reports": return "Send to the team";
    case "help": return "Send to the team";
    case "profile": return "Save profile";
    case "invites": return x ? "No thanks" : undefined; // (batch 17 section 4) an invite's No thanks
    case "visits": return x ? "Remove" : undefined; // Tests visited: Remove
    case "chat": return x === "open" ? "Chat" : undefined; // "Chat with <name>"
    case "calls": return y === "join" ? "Join call" : undefined;
    case "recordings": return y === "upload" ? "Upload" : undefined;
    case "admin": return x === "team-close" ? teamCloseLabel(b.scope) : x === "preview-team-close" ? `Preview: ${teamCloseLabel(b.scope).replace(/^Close/, "close")}` : x ? ADMIN_PRESS[x] : undefined;
    case "auth":
      switch (x) {
        case "login": return "Log in";
        case "signup": return "Sign up";
        case "forgot": return "Send the reset link";
        case "reset": case "password": return "Save the new password";
        case "resend": return "Resend the link";
        case "logout": return b.everywhere === true ? "Sign out of all devices" : "Sign out";
        case "google": return y === "finish" ? "Continue" : undefined;
      }
      return undefined;
    case "account":
      switch (x) {
        case "alerts": return y === "add" ? "Don't stop me for" : "Alerts";
        case "tester-alerts": return "Alerts";
        case "delete": return "Delete account";
        case "notify": return "Save";
        case "side": return b.add === true ? (b.side === "developer" ? "Start posting tests too" : "Start testing too") : `Switch to your ${b.side === "developer" ? "developer" : "tester"} side`;
      }
      return undefined;
    case "payments":
      switch (x) {
        case "owed": return typeof b.cancelCheck === "string" ? CANCEL_CHECK : "Pay what you owe";
        case "confirm-all": return typeof b.cancel === "string" ? CANCEL_CHECK : CONFIRM_ALL; // (§147)
        case "confirm": return CONFIRM_WITH_BANK;
        case "card": return pick(b.press, CARD_PRESSES);
        case "payout": return pick(b.press, PAYOUT_PRESSES);
        case "payout-dashboard": return pick(b.press, PAYOUT_CHANGE_PRESSES); // (§200)
        case "subscription": return b.action === "cancel" ? "Cancel subscription" : b.action === "keep" ? "Keep my subscription" : `Subscribe for ${SUBSCRIPTION_PRICE}`;
        // "Verify a card" starts the check; the card form's "Verify this card" sends the card (and finishes after the bank's check).
        case "verify-card": return typeof b.paymentMethod === "string" || b.finish === true ? "Verify this card" : "Verify a card";
      }
      return undefined;
  }
  return undefined;
}

/** The label of the press behind an API path: "/api/tests/<id>/edit" → "Save"; "/api/review" → "Pay"; "/api/sessions/<id>/written" → "Send". */
export function pressLabelOf(path: string, body?: unknown): string {
  const p = path.split("?")[0].split("/").filter(Boolean); // api, tests, <id>, <action>
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // (Batch 30 §20) A call request's answer names the button pressed: Withdraw, Accept or Decline (not "Answer").
  // (Batch 35 §2) An application's Accept / Decline likewise.
  if (p[3] === "answer-request" || (p[1] === "tests" && p[3] === "application")) {
    const v = bodyPressVerb(p[3], body);
    if (v) return v;
  }
  // (Owner, Nov 3, races) The recording part's Add (it sends `add: true`) and the removed-from cards' Dismiss all.
  if (p[1] === "sessions" && p[3] === "recording-send" && b.add === true) return "Add";
  if (p[1] === "sessions" && p[3] === "dismiss-removed" && b.all === true) return "Dismiss all";
  // (§156) Switch / Keep and Charge / Let it go name the button pressed; the broken-key Dismiss its count ("Dismiss 2").
  if (p[1] === "sessions" && p[3] === "terms" && (b.choice === "keep" || b.choice === "switch")) return b.choice === "keep" ? "Keep my current terms" : "Switch to the new terms";
  if (p[1] === "sessions" && p[3] === "choose" && b.choice === "letgo") return "Let it go";
  if (p[1] === "tests" && p[3] === "keys-dismiss" && Array.isArray(b.keyIds) && b.keyIds.length > 1) return `Dismiss ${b.keyIds.length}`;
  if ((p[1] === "tests" || p[1] === "sessions") && p[3]) return PRESS_VERBS[p[3]] ?? "press";
  if (p[1] === "tests" && !p[2]) return "Post the test";
  return otherPress(p, b) ?? "press";
}

/** "Pay on Ana Silva's written answers" → "Pay": the verb said in "Press <verb> again to go ahead." */
export const pressVerb = (label: string) => label.split(" on ")[0];

/** A refusal that doesn't already name the press: "Your Pay didn't go through: <reason>" (the reason as the server wrote it). */
export function refusalLine(label: string, message: string) {
  // (Batch 27 section 1) "Answer the new terms first: Switch or Keep." reads exactly so under the pressed button.
  // (§156) A line that already names its press anywhere ("Nora Lane stopped the test on Nov 3, so your Send didn't go through. …") isn't named twice.
  if (!label || label === "press" || /\b[Yy]our .*didn't go through/.test(message) || message === ANSWER_TERMS_FIRST) return message;
  // (Owner, Nov 5, §217; recording R4a) A check already cancelled underneath it (the team's pause, a new card, a chargeback won) reads as a cancel, whichever press
  // reached it (Cancel this check, Complete in its window, Confirm with your bank): "Cancelled: nothing was charged.", never "Your Confirm with your bank didn't go
  // through: …".
  if (message.trim() === CHECK_CANCELLED_UNDERNEATH) return CANCELLED_NOTHING_CHARGED;
  return `Your ${label} didn't go through: ${message.trim()}`;
}
