import { ALL_BACK } from "./confirmAllText";

// (Owner, Nov 3, batch 35 §160) Once the bank's page is open, Stripe's Complete can't be stopped by us. So while it is open, the box tells the developer (a blue
// notice inside the bank check's box, directly above the bank's frame) what changed that would have stopped their press, or that the check was cancelled underneath
// them, before they press Complete. Shared by the server's peek (lib/server/bankPeek.ts) and the box (components/BankCheck.tsx).

/** The notice's heading over the changes. */
export const NOTICE_HEAD = "While your bank's page was open:";

/** Under the changes: the press still goes through as pressed when Complete is pressed ("reserves" for a chargeback hold's Pay what you owe). */
export const stillPaysLine = (amount: string, reserve = false) => `Complete still ${reserve ? "reserves" : "pays"} ${amount} as pressed; or press Cancel.`;

/** The cancelled check: "This bank check was cancelled: your tests were paused (a payment hold started). Pressing Complete won't charge anything." */
export const cancelledLine = (why: string, card = false) => `This bank check was cancelled: ${why}. ${card ? "Pressing Complete won't verify this card." : "Pressing Complete won't charge anything."}`;

/** Why a check was cancelled underneath the open bank page (the plain reason after "This bank check was cancelled: "). */
export const CANCELLED_WHY = {
  hold: "your tests were paused (a payment hold started)",
  card: "you saved a new card",
  pressRanOut: "its 15 minutes ran out",
  awayRanOut: "the 3 days to confirm it ran out",
  paused: "this payment is paused until your tests resume",
  otherMode: "it was made in Stripe's other mode (test or live)",
  elsewhere: "it was ended elsewhere (in another tab, or by the team)",
  // (Owner, Nov 4, §171 B4) This window's check is no longer the charge's live check.
  inAll: "it was moved into your Confirm all in another tab",
  inOther: "it was moved into another payment in another tab",
  replaced: "a new bank check replaced it (in another tab, or after your Confirm all ended)",
  paidOther: "the payment already went through on another bank check",
  // (§171 B6) Pay what you owe while chargebacks change underneath it.
  reviewAgain: "a new chargeback arrived, so the team reviews your account again before you can pay",
  won: "your bank decided a chargeback in your favour, so what you owe changed",
} as const;

/** A change line as the notice shows it: one sentence, ending with its stop. */
export const noticeLine = (text: string) => (/[.!?)”"]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

// (Owner, Nov 3, §160) The button under the open bank window is "Cancel" again. Pressed (or the page closed or reloaded while the window is open), the server asks
// Stripe first: a payment that went through is recorded as paid and the box just closes; otherwise the developer's own press is cancelled at Stripe (nothing charged)
// and what it covered is payable again. A charge made while the developer was away is never cancelled (that would count as declined): it keeps waiting.
export const BANK_CANCEL = "Cancel";
/** Under Cancel: what it does, per kind of check. */
export const CANCEL_HINTS = {
  press: "Already finished with your bank? It's recorded as paid; otherwise nothing is charged.",
  waits: "Already finished with your bank? It's recorded as paid; otherwise nothing is charged and it keeps waiting for your bank.",
  all: "Already finished with your bank? It's recorded as paid; otherwise nothing is charged and each payment keeps waiting for your bank.",
  card: "Already finished with your bank? Your card is verified; otherwise nothing is saved.",
} as const;
export type CancelKind = keyof typeof CANCEL_HINTS;
/** A charge made while away, its window closed unfinished: it keeps waiting with its own date. */
export const STILL_WAITS = "Nothing was charged: this payment still waits for your bank.";
export const stillWaitingLine = (by: string) => `${STILL_WAITS} Confirm with your bank by ${by}.`;
/** (§160) The developer's own press with its bank window open elsewhere (another tab, or left): its Cancel there. */
export const CANCEL_THIS_CHECK = "Cancel this check";
/**
 * (Owner, Nov 4, batch 35 §170) What "Cancel this check" (pressed in a tab other than the bank window's) says once it worked: a plain success line, never "Your
 * Confirm with your bank didn't go through: …" (the wrong press, and a cancel that worked isn't a failure). A charge made while away isn't cancelled (§160): it
 * keeps waiting with its own date. Stripe said it had gone through: paid, with the amount.
 */
export const CANCELLED_NOTHING_CHARGED = "Cancelled: nothing was charged.";
export const cancelledStillWaitsLine = (by: string) => `${CANCELLED_NOTHING_CHARGED} It still waits for your bank until ${by}.`;
export const alreadyConfirmedLine = (amount: string) => `Your bank already confirmed it: paid ${amount}.`;
/** The cancel's finish answered "nothing was charged" (`not_confirmed`): its success line; `by` is the date a charge made while away still waits until. */
export function cancelledCheckLine(message: string, by?: unknown) {
  if (typeof by === "string" && by && message.startsWith(STILL_WAITS)) return cancelledStillWaitsLine(by);
  // Confirm all's one check: each payment is back to its own Confirm with your bank.
  return message.includes(ALL_BACK) ? `${CANCELLED_NOTHING_CHARGED} ${ALL_BACK}` : CANCELLED_NOTHING_CHARGED;
}
/**
 * (Owner, Nov 3, §160) Pay what you owe's check (its one payment, or a chargeback hold's reservation) is being made or waits for the bank in another tab: that tab's
 * box hides the button and says so (with Cancel this check); a press from an older page is refused with the same line (never a stop-once, never "already reserved").
 */
export const owedElsewhereLine = (amount: string) => `Pay what you owe (${amount}) is waiting for your bank in another tab or window: finish that check, or cancel it.`;
