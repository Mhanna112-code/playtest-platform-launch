import { LIMITS } from "./limits";
// (NEWEST+8) Optional written questions, as in the full app: each question can be marked "not required". Stored as the
// question's text with this marker in front (part of the terms: a change offers new terms like any question change).
export const NOT_REQUIRED = "[not required] ";
export const qOptional = (q: string) => q.startsWith(NOT_REQUIRED);
export const qText = (q: string) => (qOptional(q) ? q.slice(NOT_REQUIRED.length) : q);

/** (Owner, Oct 28, batch 20 section 2) "At most 20 questions." once the list (one question per line) reaches 20; "" below that. */
export function questionLimitLine(text: string) {
  return text.split("\n").map((q) => q.trim()).filter(Boolean).length >= LIMITS.questions.max ? `At most ${LIMITS.questions.max} questions.` : "";
}
