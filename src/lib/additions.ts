import { itemsOf, type SetItem } from "./answerSets";
import { qText } from "./questions";

/**
 * (Owner, Nov 3, batch 35 §136) Sent work is locked: what a tester sent stays exactly as it was, and anything they send later is ADDED under it.
 * An addition is stored on the piece (`Submission.additions`), oldest first:
 * - written answers: more text (`text`, with markers for its files) added to ONE question (`questionKey`, §167), or, after a switch to changed questions, the
 *   answers to the new questions (`items`, with that send's `notes`); an addition made before §167 has no `questionKey` (it was added to the whole part);
 * - a recording: the recordings added (`files`).
 * `at`: when it was sent (every addition has had one since §136). `files`: the uploads sent with it (their ids).
 */
export type Addition = { at: string; text?: string; items?: SetItem[]; notes?: string; files: string[]; /** (§167) the question it was added to */ questionKey?: string };

/** The word above every addition. */
export const ADDED_LABEL = "Added";
/** (Owner, Nov 3, §167) "Added · Nov 3, 2026, 11:29 PM": the label with when it was added, in the viewer's zone. */
export const addedLabel = (when: string) => `${ADDED_LABEL} · ${when}`;
/** (§167) The last fold of a written part: additions made before they were about one question. */
export const ADDED_GENERAL = "Added (not about one question)";
/** (§167) The tag on a question that came with changed questions. */
export const NEW_QUESTION_TAG = "new question";
/** (§167) A question fold's count: "· 2 added". */
export const addedCount = (n: number) => `· ${n} added`;

/** (Owner, Nov 3, §167) At most 10 additions per written part, across all its questions (old ones with no question and the answers to changed questions too). */
export const ADDITIONS_MAX = 10;
export const ADDITIONS_FULL = `You've added to this part ${ADDITIONS_MAX} times, the most it takes.`;
/** "3 of 10 additions left" (shown once a part has at least one addition). */
export const additionsLeftLine = (made: number) => `${Math.max(0, ADDITIONS_MAX - made)} of ${ADDITIONS_MAX} additions left`;
/** (§167) An older page's general "Add more" (no question): refused. */
export const ADD_UNDER_QUESTION = "Add to one question: open it in your answers and use Add to this answer.";
/** (§167) A question that isn't in the current questions (an older page after a change). */
export const QUESTION_GONE = "That question isn't one of your current questions. Reload the page and add under one of them.";

/**
 * (§167) A question's key: a short hash of its text (the answers are matched by question text everywhere, e.g. carryOver), so it stays the same when the
 * questions are reordered and fits a draft key (`add:<session>:<questionKey>`). A second question with the same text in one set gets "-2", and so on.
 */
export function questionKey(text: string) {
  let h = 0x811c9dc5;
  for (const ch of qText(text)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `q${h.toString(36)}`;
}
export function questionKeys(items: { question: string }[]): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const k = questionKey(it.question);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}-${n}`;
  });
}

/** (§167) A question as the live line, bell and email quote it (a long one cut at 80 characters). */
export const quoteQuestion = (q: string) => {
  const t = qText(q).replace(/\s+/g, " ").trim();
  return `“${t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t}”`;
};

/** The additions stored on a piece (anything malformed is skipped). */
export function additionsOf(stored: unknown): Addition[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.at !== "string") return [];
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === "string") : [];
    return [{
      at: o.at, files,
      ...(typeof o.text === "string" ? { text: o.text } : {}),
      ...(Array.isArray(o.items) ? { items: itemsOf(o.items) } : {}),
      ...(typeof o.notes === "string" && o.notes ? { notes: o.notes } : {}),
      ...(typeof o.questionKey === "string" && o.questionKey ? { questionKey: o.questionKey } : {}),
    }];
  });
}

/** One added text under a question (or in the last fold). */
export type AddedText = { at: string; text: string; files: string[] };
/**
 * (§167) One question of a written part as the developer reads it: its fold holds the answer, then each addition to it, oldest first. `fresh`: a question that
 * came with changed questions (its answer was sent with them, at `at`).
 */
export type QuestionThread = { key: string; question: string; required: boolean; answer: string; fresh: boolean; at?: string; adds: AddedText[] };
/** (§167) A changed-questions send's notes and its files not placed in an answer, shown under the notes with its date. */
export type SetExtra = { at: string; notes: string; files: string[]; texts: string[] };

/**
 * (Owner, Nov 3, §167; replaces §136's one list) A written part by question: a thread per question that was sent (the first questions, then each new question
 * that came with changed questions), each with the additions made to it. The answers to changed questions go under the question they answer: a new question
 * gets its own thread, an unchanged question whose answer differs gets it as an addition. Additions made before §167 (no question) go to `general`.
 */
export function writtenThreads(answers: unknown, questions: string[], stored: unknown) {
  const first = itemsOf(answers, questions);
  const threads: QuestionThread[] = [];
  const byKey = new Map<string, QuestionThread>();
  const current = new Map<string, string>();
  const put = (t: QuestionThread) => { threads.push(t); byKey.set(t.key, t); current.set(t.key, t.answer); };
  questionKeys(first).forEach((key, i) => put({ key, question: first[i].question, required: first[i].required, answer: first[i].answer, fresh: false, adds: [] }));
  const general: Addition[] = [];
  const extras: SetExtra[] = [];
  for (const a of additionsOf(stored)) {
    if (a.items) {
      const keys = questionKeys(a.items);
      const placed: string[] = [];
      a.items.forEach((it, i) => {
        const t = byKey.get(keys[i]);
        if (!t) put({ key: keys[i], question: it.question, required: it.required, answer: it.answer, fresh: true, at: a.at, adds: [] });
        else if (it.answer.trim() && it.answer !== current.get(t.key)) {
          t.adds.push({ at: a.at, text: it.answer, files: [] });
          current.set(t.key, it.answer);
        } else return;
        placed.push(it.answer);
      });
      if (a.notes || a.files.length) extras.push({ at: a.at, notes: a.notes ?? "", files: a.files, texts: placed });
      continue;
    }
    const t = a.questionKey ? byKey.get(a.questionKey) : undefined;
    if (t) t.adds.push({ at: a.at, text: a.text ?? "", files: a.files });
    else general.push(a);
  }
  return { threads, general, extras };
}

/**
 * (§167) A written piece for the "By question" view: the latest answers per question, each followed by what was added to that question ("*Added · <date>*" and
 * the text; `when` formats the date in the viewer's zone). The notes, then additions with no question, join "Other notes" as before (§136).
 */
export function answersByQuestion(sub: { answers: unknown; notes: string; additions?: unknown }, questions: string[], when: (at: string) => string) {
  const items = latestItems(sub, questions);
  const keys = questionKeys(items);
  const adds = additionsOf(sub.additions);
  const under = (a: Addition) => (a.text != null && a.questionKey && keys.includes(a.questionKey) ? a.questionKey : null);
  const answers = items.map((it, i) => [it.answer, ...adds.filter((a) => under(a) === keys[i]).map((a) => `*${addedLabel(when(a.at))}*\n${a.text}`)].filter((x) => x.trim()).join("\n\n"));
  const notes = [sub.notes, ...adds.filter((a) => !under(a)).flatMap((a) => [a.notes ?? "", a.text ?? ""])].filter((x) => x.trim()).join("\n\n");
  return { items, answers, notes };
}

/** The latest set of answers on a written piece: the last addition that answered questions, else what was sent first. */
export function latestItems(sub: { answers: unknown; additions?: unknown }, questions: string[] = []): SetItem[] {
  const sets = additionsOf(sub.additions).filter((a) => a.items);
  return sets.length ? sets[sets.length - 1].items! : itemsOf(sub.answers, questions);
}

/** When the latest addition was sent (null: nothing added). */
export function lastAddedAt(stored: unknown): Date | null {
  const adds = additionsOf(stored);
  return adds.length ? new Date(adds[adds.length - 1].at) : null;
}

/** The time a part's header line shows: the latest addition, else when it was sent. */
export const pieceTime = (sub: { updatedAt: Date; additions?: unknown }) => lastAddedAt(sub.additions) ?? sub.updatedAt;

/** The ids of every upload sent with an addition (the rest of a piece's uploads were sent with it first). */
export const addedFiles = (adds: Addition[]) => new Set(adds.flatMap((a) => a.files));

/** Every text in a written piece, for the written part's character count ((Owner, Nov 4, §186) no longer one limit over all of them: each send and each addition has its own 20,000): the first answers and notes, then each addition's text, answers and notes. */
export function writtenTexts(sub: { answers: unknown; notes: string; additions?: unknown }): string[] {
  return [
    ...itemsOf(sub.answers).map((x) => x.answer), sub.notes,
    ...additionsOf(sub.additions).flatMap((a) => [a.text ?? "", ...(a.items ?? []).map((x) => x.answer), a.notes ?? ""]),
  ];
}
