import { LIMITS } from "./limits";
// (Owner, Oct 29, batch 26 section 14) Questions are NOT required by default: the developer ticks "Required" on any a tester must answer, stored as the question's text
// with REQUIRED in front (part of the terms: a change offers new terms like any question change). An unmarked question is not required. Sending written answers needs at
// least one answered question plus every Required one (answersMissing: the server and the form use the same rule).
// (Before batch 26 every question was required unless marked "[not required] "; the migration 20261106090000_questions_not_required took that marker off stored
// questions. A leftover one still reads as not required, its marker left out.)
export const REQUIRED = "[required] ";
/** The old marker (before batch 26): read as not required, never written. */
export const NOT_REQUIRED = "[not required] ";
export const qRequired = (q: string) => q.startsWith(REQUIRED);
export const qOptional = (q: string) => !qRequired(q);
export const qText = (q: string) => (q.startsWith(REQUIRED) ? q.slice(REQUIRED.length) : q.startsWith(NOT_REQUIRED) ? q.slice(NOT_REQUIRED.length) : q);
/** A question as stored: "[required] Where did you get stuck?" or the plain text. */
export const qStored = (text: string, required: boolean) => (required ? REQUIRED + text : text);

/** (Batch 26 section 14) The two refusals of Send my answers, at the field and in the mistakes list. */
export const ANSWER_ONE = "Answer at least one question before sending.";
export const ANSWER_REQUIRED = "Answer every required question before sending.";
/** (Batch 26 section 14) The Post / Edit line under the questions box. */
export const QUESTIONS_RULE_LINE = "Testers answer at least one question. Tick Required on any they must answer.";

/**
 * (Batch 26 section 14) What stops Send my answers (and Send my updated answers), or null: a Required question left empty (the first one: `at`), or no question answered
 * at all (`at` 0, the first question's box). The "Anything else (bugs, ideas)" box doesn't count. No questions: nothing to check.
 */
export function answersMissing(questions: string[], answers: string[]): { message: string; at: number } | null {
  if (!questions.length) return null;
  const filled = (i: number) => !!(answers[i] ?? "").trim();
  const req = questions.findIndex((q, i) => qRequired(q) && !filled(i));
  if (req >= 0) return { message: ANSWER_REQUIRED, at: req };
  if (!questions.some((_, i) => filled(i))) return { message: ANSWER_ONE, at: 0 };
  return null;
}

/** (Owner, Oct 28, batch 20 section 2) "At most 20 questions." once the list (one question per line) reaches 20; "" below that. */
export function questionLimitLine(text: string) {
  return text.split("\n").map((q) => q.trim()).filter(Boolean).length >= LIMITS.questions.max ? `At most ${LIMITS.questions.max} questions.` : "";
}
