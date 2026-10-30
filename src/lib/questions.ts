import { LIMITS } from "./limits";
import { parseFormatted } from "./markdown";
import { withoutAttachmentMarkers } from "./answerAttachments";
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
// (Owner, Oct 29, batch 32 §4) Shown above the questions, no box red: any one answer will do.
export const ANSWER_ONE = "Answer at least one question before sending (any one; none is required).";
export const ANSWER_REQUIRED = "Answer every required question before sending.";
/** (Batch 26 section 14) The Post / Edit line under the questions box; (batch 30 §14) with the answers' minimum (Post, Edit and the join page). */
export const ANSWER_MIN_LINE = "Each answer is at least 50 characters.";
export const QUESTIONS_RULE_LINE = `Testers answer at least one question. Tick Required on any they must answer. ${ANSWER_MIN_LINE}`;

/** (Owner, Oct 29, batch 30 §14) Every answer sent to a question is at least this many characters (the "Anything else" box has no minimum). */
export const ANSWER_MIN_CHARS = 50;
/**
 * The minimum the server checks: ANSWER_MIN_CHARS, except where the ANSWER_MIN_CHARS setting says otherwise. Only the test suite sets it (to 1, since the tests written
 * before batch 30 send short answers such as "a"; the batch 30 tests set it back to 50). Production never sets it.
 */
export function answerMin() {
  const v = typeof process !== "undefined" ? Number(process.env?.ANSWER_MIN_CHARS) : NaN;
  return Number.isInteger(v) && v >= 1 ? v : ANSWER_MIN_CHARS;
}
/** The server's refusal, with which question (`missing`). */
export const ANSWER_SHORT = `Each answer needs at least ${ANSWER_MIN_CHARS} characters.`;
/** The form's red line at the answer: "Write at least 50 characters (12 so far)." */
export const answerShortLine = (chars: number) => `Write at least ${ANSWER_MIN_CHARS} characters (${chars} so far).`;
/** The counter under an answer box while it's below the minimum: "12 / 50 characters minimum". */
export const answerCounter = (chars: number) => `${chars} / ${ANSWER_MIN_CHARS} characters minimum`;

/** (Batch 30 §14) How long an answer counts as: trimmed, without the formatting marks (** for bold, * for italic, ``` around a code block); spaces inside count. */
export function answerChars(answer: string) {
  return parseFormatted(withoutAttachmentMarkers(answer ?? "").trim())
    .map((b) => (b.kind === "code" ? b.text : b.runs.map((r) => r.text).join("")))
    .join("\n")
    .trim().length;
}

/**
 * (Batch 26 section 14) What stops Send my answers (and Send my updated answers), or null: a Required question left empty (the first one: `at`), or no question answered
 * at all (`at` 0, the first question's box). The "Anything else (bugs, ideas)" box doesn't count. No questions: nothing to check.
 * (Batch 30 §14) Every answer given (Required, or an optional one filled in) is at least `min` characters (answerChars): the first one too short is `at`, with its
 * `chars`; an optional question left completely empty is fine, and "at least one question" means at least one answer of `min`+ characters.
 */
export function answersMissing(questions: string[], answers: string[], min = ANSWER_MIN_CHARS): { message: string; at: number; chars?: number } | null {
  if (!questions.length) return null;
  const filled = (i: number) => !!(answers[i] ?? "").trim();
  const req = questions.findIndex((q, i) => qRequired(q) && !filled(i));
  if (req >= 0) return { message: ANSWER_REQUIRED, at: req };
  const short = questions.findIndex((_, i) => filled(i) && answerChars(answers[i]) < min);
  if (short >= 0) return { message: ANSWER_SHORT, at: short, chars: answerChars(answers[short]) };
  if (!questions.some((_, i) => filled(i))) return { message: ANSWER_ONE, at: 0 };
  return null;
}

/** (Owner, Oct 28, batch 20 section 2) "At most 20 questions." once the list (one question per line) reaches 20; "" below that. */
export function questionLimitLine(text: string) {
  return text.split("\n").map((q) => q.trim()).filter(Boolean).length >= LIMITS.questions.max ? `At most ${LIMITS.questions.max} questions.` : "";
}
