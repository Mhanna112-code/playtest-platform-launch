import { qOptional, qText } from "./questions";

/**
 * (Owner, Oct 29, batch 13 section 8) Written answers are stored as whole SETS: each question with the answer it got, so answers sent before a switch to changed
 * questions never show under the wrong questions.
 */
export type SetItem = { question: string; required: boolean; answer: string };
/** A previous set: the questions and answers as they were until a switch to changed questions. */
export type PrevSet = { until: string; items: SetItem[] };

/** At most 3 previous sets (questions have 3 changes). */
export const MAX_PREV_SETS = 3;

/** The contract's questions (stored with the "not required" marker) as empty set items. */
export const itemsFor = (questions: string[], answers: string[] = []): SetItem[] =>
  questions.map((q, i) => ({ question: qText(q), required: !qOptional(q), answer: answers[i] ?? "" }));

/**
 * A stored set, whatever its age: the new [{ question, required, answer }] form, or an older list of answers paired with `questions` by position.
 */
export function itemsOf(stored: unknown, questions: string[] = []): SetItem[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((x, i) => {
    if (typeof x === "string") {
      const q = questions[i];
      return { question: q != null ? qText(q) : `Question ${i + 1}`, required: q != null ? !qOptional(q) : true, answer: x };
    }
    const o = (x ?? {}) as Partial<SetItem>;
    return { question: String(o.question ?? `Question ${i + 1}`), required: o.required !== false, answer: String(o.answer ?? "") };
  });
}

/** The previous sets stored on a contract or submission. */
export function prevSetsOf(stored: unknown): PrevSet[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((x) => {
    const o = (x ?? {}) as { until?: unknown; items?: unknown };
    return typeof o.until === "string" ? [{ until: o.until, items: itemsOf(o.items) }] : [];
  });
}

/** Do two sets ask exactly the same questions (text and order)? */
export const sameQuestions = (a: { question: string }[], b: { question: string }[]) => a.length === b.length && a.every((x, i) => x.question === b[i].question);

/**
 * The answers for the CURRENT questions after a switch: a question whose text is unchanged keeps its answer (sent or draft); a changed or new question starts empty.
 */
export function carryOver(prev: SetItem[], questions: string[]): string[] {
  const byText = new Map<string, string>();
  for (const p of prev) if (!byText.has(p.question)) byText.set(p.question, p.answer);
  return questions.map((q) => byText.get(qText(q)) ?? "");
}

/** Add a previous set at the front, keeping at most MAX_PREV_SETS. */
export const pushPrev = (sets: PrevSet[], set: PrevSet) => [set, ...sets].slice(0, MAX_PREV_SETS);
