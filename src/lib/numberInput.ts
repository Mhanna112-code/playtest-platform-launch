// (Owner, Oct 31, batch 35 §25) Number-only boxes: ONE helper for every money box (data-money: part prices, the live call rate, Pay / Pay more and a call's rate
// there, the admin's dispute Decide total, the tester's Charge amount) and every whole-number box (data-whole: spots, a call's Length, the admin's Extend days).
// FieldChecks (src/components/FieldChecks.tsx) applies it to every such box on the page, before the page's own handlers see the typing or the paste:
//   - a money box holds digits and one decimal point, at most 2 decimals; anything else typed is ignored (the box keeps what it had), and a paste keeps only the
//     digits and the first decimal point ("$1,000.50" → "1000.50"; decimals past the second are dropped);
//   - a whole-number box holds digits only (batch 20 section 19: never 0 or below: a value that is only zeros is ignored, the box keeps what it had).
// The range checks and their red lines stay where they are (data-min / data-max and their messages).

/** (Batch 35 §25) What a money box may hold: digits, then at most one decimal point and 2 decimals. "" is fine (an empty box). */
export const MONEY_TEXT = /^\d*(\.\d{0,2})?$/;
/** (Batch 35 §25) What a whole-number box may hold: digits only. */
export const WHOLE_TEXT = /^\d*$/;

/** (Batch 35 §25) Only the digits of any text (what a whole-number box keeps of a paste). */
export const digitsOnly = (text: string) => text.replace(/\D/g, "");

/**
 * (Batch 35 §25) Any text cleaned for a money box: only the digits and the first decimal point stay, cut to 2 decimals ("$1,000.50" → "1000.50", "-5.00" → "5.00",
 * "1.2.3" → "1.23", "12.345" → "12.34"). "0" stays (a $0 Pay, Free).
 */
export function moneyText(next: string) {
  const kept = next.replace(/[^\d.]/g, "");
  const dot = kept.indexOf(".");
  if (dot < 0) return kept;
  return kept.slice(0, dot + 1) + kept.slice(dot + 1).replace(/\./g, "").slice(0, 2);
}

/**
 * (Owner, Oct 28, batch 20 section 19) What a whole-number box may hold: digits only (a minus, "e", "+", "." and letters are dropped), never 0 or below: a value
 * that is only zeros is ignored (the box keeps `prev`). Leading zeros go ("007" → "7").
 */
export function wholeText(next: string, prev = "") {
  const digits = digitsOnly(next);
  if (!digits) return "";
  if (/^0+$/.test(digits)) return prev;
  return digits.replace(/^0+/, "");
}

/**
 * (Batch 35 §25) A money box after a keystroke: the typed value when it's still a money value; otherwise the keystroke is ignored and the box keeps `prev` (a
 * letter, a second decimal point, a third decimal). With no usable `prev` (a value set some other way), the typed value cleaned.
 */
export function typedMoney(next: string, prev?: string) {
  if (MONEY_TEXT.test(next)) return next;
  if (prev != null && MONEY_TEXT.test(prev)) return prev;
  return moneyText(next);
}

/**
 * (Batch 35 §25) The box's value after a paste of `text` over the selection [start, end) of `value` (no selection known, e.g. a type="number" box: the paste
 * replaces the whole value): the pasted text cleaned, then the whole value cleaned.
 */
export function pastedNumber(kind: "money" | "whole", value: string, text: string, start: number | null, end: number | null, prev = value) {
  const from = start ?? 0, to = end ?? value.length;
  const whole = start == null || end == null;
  if (kind === "whole") {
    const clean = digitsOnly(text);
    return wholeText(whole ? clean : value.slice(0, from) + clean + value.slice(to), prev);
  }
  return moneyText(whole ? moneyText(text) : value.slice(0, from) + moneyText(text) + value.slice(to));
}

/** (Batch 35 §25) Whether a single typed character can go in such a box at all (digits; a money box: also its first decimal point, when `value` has none). */
export function keyAllowed(kind: "money" | "whole", key: string, valueOutsideSelection = "") {
  if (/^\d$/.test(key)) return true;
  return kind === "money" && key === "." && !valueOutsideSelection.includes(".");
}
