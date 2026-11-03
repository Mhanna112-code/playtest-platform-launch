// (Owner, Nov 3, batch 35 §160) Once the bank's page is open, Stripe's Complete can't be stopped by us. So while it is open, the box tells the developer (a blue
// notice inside the bank check's box, directly above the bank's frame) what changed that would have stopped their press, or that the check was cancelled underneath
// them, before they press Complete. Shared by the server's peek (lib/server/bankPeek.ts) and the box (components/BankCheck.tsx).

/** The notice's heading over the changes. */
export const NOTICE_HEAD = "While your bank's page was open:";

/** Under the changes: the press still goes through as pressed when Complete is pressed ("reserves" for a chargeback hold's Pay what you owe). */
export const stillPaysLine = (amount: string, reserve = false) => `Complete still ${reserve ? "reserves" : "pays"} ${amount} as pressed; or press Close.`;

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
