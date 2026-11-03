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
