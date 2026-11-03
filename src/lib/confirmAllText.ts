import { money } from "@/lib/format";

// (Owner, Nov 3, batch 35 §147) Confirm all: every charge waiting for "Confirm with your bank" confirmed at once, as ONE payment with ONE bank check. The words the
// page and the server share (plain, like the rest of the app).

/** The button: "Confirm all (3) · $42.00". */
export const confirmAllLabel = (n: number, cents: number) => `Confirm all (${n}) · ${money(cents)}`;
/** The press's name in its stop box ("Your Confirm all didn't go through."). */
export const CONFIRM_ALL = "Confirm all";

/** Under the button when a renewal (or another payment confirmed on its own) waits too: "Your plan's renewal $9.00 isn't in Confirm all: confirm it on its own." */
export const leftOutLine = (names: string[]) =>
  names.length === 1 ? `${up(names[0])} isn't in Confirm all: confirm it on its own.` : `Not in Confirm all (confirm each on its own): ${names.join(", ")}.`;
const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** (Owner, Nov 3) The stop line when the new total is over $200 and the press had no tick. */
export const tickToGoOn = "Tick “I confirm this payment is over $200.” and press again to go ahead.";
/** The approved check's line under the button. */
export const allConfirmedLine = (n: number, cents: number) => `Your bank confirmed it: ${money(cents)} for ${n} payment${n === 1 ? "" : "s"} went through.`;
/** The bank refused (or the check was cancelled): nothing charged, each back to its own Confirm. */
export const ALL_BACK = "Each payment is back to its own Confirm with your bank.";
export const ALL_NOT_CONFIRMED = `Your bank didn't confirm the payment, so nothing was charged. ${ALL_BACK}`;
export const ALL_CANCELLED = `Check cancelled: nothing was charged. ${ALL_BACK}`;
/** The one check is open (this tab or another): its line in the box, with "Cancel this check". */
export const allWaitingLine = (n: number, cents: number) => `Confirm all: ${money(cents)} for ${n} payment${n === 1 ? "" : "s"} is waiting for your bank.`;
/** A second Confirm all (another tab) while one waits for the bank. */
export const ALL_BUSY = "Your Confirm all is already waiting for your bank: finish that check, or cancel it.";
/** An old tab's Confirm with your bank on a payment Confirm all covers. */
export const IN_CONFIRM_ALL = "This payment is in your Confirm all, waiting for your bank: finish that check, or cancel it.";
export const NOTHING_TO_CONFIRM = "There's nothing waiting for your bank to confirm.";
/** Some were already confirmed at the bank when Confirm all cancelled their checks: recorded as paid, left out of the total. */
export const alreadyPaidLine = (names: string[]) => `Already confirmed with your bank, so recorded as paid: ${names.join(", ")}.`;
/** The one payment was declined: "Your card was declined. Nothing was charged. Each payment is back to its own Confirm with your bank." */
export const allDeclinedLine = (why: string, back: number, of: number, declined: number) =>
  [why, "Nothing was charged.", back === of ? ALL_BACK : back ? `${back} of the ${of} payments are back to their own Confirm with your bank.` : "", declined ? `${declined === 1 ? "One was" : `${declined} were`} declined on its own too, so it's added to what you owe.` : ""].filter(Boolean).join(" ");
