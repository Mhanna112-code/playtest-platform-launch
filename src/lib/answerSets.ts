import { qOptional, qText } from "./questions";

/**
 * (Owner, Oct 29, batch 13 section 8) Written answers are stored as whole SETS: each question with the answer it got, so answers sent before a switch to changed
 * questions never show under the wrong questions.
 */
export type SetItem = { question: string; required: boolean; answer: string };
/** A previous set: the questions and answers as they were until a switch to changed questions. */
/** (Owner, Oct 30, batch 15 section 14) One version kept in a previous set: what was sent ("Sent <date>"), or the draft typed after it ("Draft (not sent)"). */
export type PrevVersion = { kind: "sent" | "draft"; at?: string; items: SetItem[] };
export type PrevSet = { until: string; items: SetItem[]; versions?: PrevVersion[] };

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
      // (Batch 28 §6) A question it can't find is not required (no "*" on a "Question N" placeholder).
      return { question: q != null ? qText(q) : `Question ${i + 1}`, required: q != null ? !qOptional(q) : false, answer: x };
    }
    const o = (x ?? {}) as Partial<SetItem>;
    return { question: String(o.question ?? `Question ${i + 1}`), required: o.required !== false, answer: String(o.answer ?? "") };
  });
}

/** The previous sets stored on a contract or submission. */
export function prevSetsOf(stored: unknown): PrevSet[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((x) => {
    const o = (x ?? {}) as { until?: unknown; items?: unknown; versions?: unknown };
    const versions = Array.isArray(o.versions)
      ? o.versions.flatMap((v) => {
          const w = (v ?? {}) as { kind?: unknown; at?: unknown; items?: unknown };
          return w.kind === "sent" || w.kind === "draft" ? [{ kind: w.kind as "sent" | "draft", ...(typeof w.at === "string" ? { at: w.at } : {}), items: itemsOf(w.items) }] : [];
        })
      : undefined;
    return typeof o.until === "string" ? [{ until: o.until, items: itemsOf(o.items), ...(versions?.length ? { versions } : {}) }] : [];
  });
}

/** (Batch 15 section 14) A set's versions; an older set stored without them reads "Sent" when the part was sent, else "Draft (not sent)". */
export const versionsOf = (s: PrevSet, sentPart: boolean): PrevVersion[] => s.versions?.length ? s.versions : [{ kind: sentPart ? "sent" : "draft", items: s.items }];

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

/**
 * (Report pass) A kept draft of the written form, put back into the form for `questions`. A draft that says which questions it was typed for is matched by question
 * text, so answers to a question that changed since (a switch to new terms) never land under the new question; an older draft without them is matched by position.
 * A question with no kept answer starts from `initial`.
 */
export function restoreDraft(questions: string[], initial: string[], kept: { answers?: unknown; questions?: unknown }) {
  const answers = Array.isArray(kept.answers) ? kept.answers.map((a) => (typeof a === "string" ? a : "")) : [];
  const typedFor = Array.isArray(kept.questions) ? kept.questions.map((q) => qText(String(q))) : null;
  return questions.map((q, i) => {
    const j = typedFor ? typedFor.indexOf(qText(q)) : i;
    return (j >= 0 ? answers[j] : undefined) ?? initial[i] ?? "";
  });
}

/** Add a previous set at the front, keeping at most MAX_PREV_SETS. */
export const pushPrev = (sets: PrevSet[], set: PrevSet) => [set, ...sets].slice(0, MAX_PREV_SETS);
