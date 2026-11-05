import { itemsFor, itemsOf, type SetItem } from "./answerSets";
import { qText } from "./questions";

/**
 * (Owner, Nov 3, batch 35 §136) Sent work is locked: what a tester sent stays exactly as it was, and anything they send later is ADDED under it.
 * An addition is stored on the piece (`Submission.additions`), oldest first:
 * - written answers: more text (`text`, with markers for its files) added to ONE question (`questionKey`, §167), or, after a switch to changed questions, the
 *   answers to the new questions (`items`, with that send's `notes`); an addition made before §167 has no `questionKey` (it was added to the whole part);
 * - a recording: the recordings added (`files`).
 * `at`: when it was sent (every addition has had one since §136). `files`: the uploads sent with it (their ids).
 */
export type Addition = { at: string; text?: string; items?: SetItem[]; notes?: string; files: string[]; /** (§167) the question it was added to */ questionKey?: string;
  /** (§222) the first answer to a question that had none ("Answer this question"): not one of its 5 */ first?: boolean };

/** The word above every addition. */
export const ADDED_LABEL = "Added";
/** (Owner, Nov 3, §167) "Added · Nov 3, 2026, 11:29 PM": the label with when it was added, in the viewer's zone. */
export const addedLabel = (when: string) => `${ADDED_LABEL} · ${when}`;
/**
 * (Owner, Nov 4, §188; replaces §167's last fold "Added (not about one question)") Every written part ends with ONE fixed "Anything else" spot after its last
 * question: the notes sent with the answers (its original), the additions made before §167 (no question), and what is added there now, each dated. A new
 * addition there is stored like a question's, with this key (`questionKey: "else"`; a question's key is always "q…", so it never matches one). No migration.
 */
export const ANYTHING_ELSE_TITLE = "Anything else";
export const ANYTHING_ELSE_KEY = "else";
/** (§188) An addition to Anything else: the new ones (its key) and the old ones with no question (or a key no question has any more). */
export const isElseKey = (key: string | undefined) => !key || key === ANYTHING_ELSE_KEY;
/**
 * (§188) What the lines name an addition by: a question ("to her answer to “…”") or Anything else ("to “Anything else” in her written answers"). `poss`: her / your.
 */
export const addedToWhat = (poss: string, question?: string) =>
  question === ANYTHING_ELSE_TITLE ? `to “${ANYTHING_ELSE_TITLE}” in ${poss} written answers` : question ? `to ${poss} answer to ${quoteQuestion(question)}` : `to ${poss} written answers`;
/** (§167) The tag on a question that came with changed questions. */
export const NEW_QUESTION_TAG = "new question";
/** (§167) A question fold's count: "· 2 added". */
export const addedCount = (n: number) => `· ${n} added`;

/**
 * (Owner, Nov 5, §222; replaces §167's 10 per part, across all its questions) At most 5 additions per current question, and Anything else has its own 5. Only what
 * Add to this answer made counts (`addsTo`): the answers to changed questions and their send's notes never count (that Send is never refused for it). Additions
 * made before §167 (no question) are Anything else's, so they count toward its 5. A question with no answer yet gets "Answer this question" instead: that first
 * answer is stored with `first` and never counts, and it is offered after any cap; once answered, the question follows the normal 5.
 */
export const ADDITIONS_MAX = 5;
/** (§222) The grey note under a question's row at its 5 (Anything else's names it). */
export const additionsFull = (key: string) =>
  key === ANYTHING_ELSE_KEY ? `You've added to ${ANYTHING_ELSE_TITLE} ${ADDITIONS_MAX} times, the most it takes.` : `You've added to this answer ${ADDITIONS_MAX} times, the most it takes.`;
export const ADDITIONS_FULL = additionsFull("");
/** (§222) "3 of 5 additions left" (a row's own, shown once that question has at least one addition). */
export const additionsLeftLine = (made: number) => `${Math.max(0, ADDITIONS_MAX - made)} of ${ADDITIONS_MAX} additions left`;
/** (§222) The press (and its button) for a question with no answer yet. */
export const ANSWER_PRESS = "Answer this question";
/** (§222) What Add to this answer made under `key` (Anything else: its key and the old ones with no question), oldest first. */
export const addsTo = (stored: unknown, key: string) =>
  additionsOf(stored).filter((a) => !a.items && (key === ANYTHING_ELSE_KEY ? isElseKey(a.questionKey) : a.questionKey === key));
/** (§222) How many of a question's 5 are used: its additions, but not the free first answer. */
export const addsCounted = (stored: unknown, key: string) => addsTo(stored, key).filter((a) => !a.first).length;
/**
 * (§222) A current question with no answer yet: its latest answer is blank and nothing was added to it (typically one that came with changed questions and was
 * left empty). Anything else is never one (it isn't a question).
 */
export const noAnswerYet = (latest: { answer: string }[], keys: string[], stored: unknown, key: string) => {
  const at = keys.indexOf(key);
  return key !== ANYTHING_ELSE_KEY && at >= 0 && !latest[at].answer.trim() && addsTo(stored, key).length === 0;
};
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
      ...(o.first === true ? { first: true } : {}),
    }];
  });
}

/** One added text under a question (or under Anything else). */
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
 * gets its own thread, an unchanged question whose answer differs gets it as an addition. (Owner, Nov 4, §188) Additions to Anything else (its key, or made
 * before §167 with no question) go to `general`; `other` is everything Anything else shows after its original (the notes), oldest first: those additions and
 * each changed-questions send's own notes and loose files (`extras`).
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
  const other: ({ kind: "add"; add: AddedText } | { kind: "set"; set: SetExtra })[] = [];
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
      if (a.notes || a.files.length) {
        const x = { at: a.at, notes: a.notes ?? "", files: a.files, texts: placed };
        extras.push(x);
        other.push({ kind: "set", set: x });
      }
      continue;
    }
    const t = a.questionKey && !isElseKey(a.questionKey) ? byKey.get(a.questionKey) : undefined;
    if (t) t.adds.push({ at: a.at, text: a.text ?? "", files: a.files });
    else {
      general.push(a);
      other.push({ kind: "add", add: { at: a.at, text: a.text ?? "", files: a.files } });
    }
  }
  return { threads, general, extras, other };
}

/**
 * (§167) A written piece for the "By question" view: the latest answers per question, each followed by what was added to that question ("*Added · <date>*" and
 * the text; `when` formats the date in the viewer's zone). (Owner, Nov 4, §188) Anything else is the last entry: the notes, then what was added there (to
 * Anything else, or before §167 with no question) and a changed-questions send's own notes, each under its "*Added · <date>*" like a question's.
 */
export function answersByQuestion(sub: { answers: unknown; notes: string; additions?: unknown }, questions: string[], when: (at: string) => string) {
  const items = latestItems(sub, questions);
  const keys = questionKeys(items);
  const adds = additionsOf(sub.additions);
  const under = (a: Addition) => (a.text != null && a.questionKey && keys.includes(a.questionKey) ? a.questionKey : null);
  const answers = items.map((it, i) => [it.answer, ...adds.filter((a) => under(a) === keys[i]).map((a) => `*${addedLabel(when(a.at))}*\n${a.text}`)].filter((x) => x.trim()).join("\n\n"));
  const dated = (a: Addition) => {
    const text = [a.notes ?? "", a.text ?? ""].filter((x) => x.trim()).join("\n\n");
    return text ? `*${addedLabel(when(a.at))}*\n${text}` : "";
  };
  const notes = [sub.notes, ...adds.filter((a) => !under(a)).map(dated)].filter((x) => x.trim()).join("\n\n");
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

/** (Owner, Nov 5, §226) The stored additions up to `until` (the Testers list's part as last paid); all of them without one. */
export function additionsUntil(stored: unknown, until: Date | string | null | undefined): unknown {
  if (!until) return stored;
  const upTo = new Date(until).getTime();
  return (Array.isArray(stored) ? stored : []).filter((x) => {
    const at = (x as { at?: unknown } | null)?.at;
    return typeof at === "string" && new Date(at).getTime() <= upTo;
  });
}

/**
 * (Owner, Nov 5, §234) A question of a written part is PAST when it is no longer one of the contract's questions (`current`: the contract's questions now; a
 * question is matched by its words, as everywhere). Past questions leave the answers panel for the "Past questions" box (read-only, never added to).
 */
export const isPastQuestion = (question: string, current: string[]) => !new Set(current.map(qText)).has(qText(question));
/** (§234) The part's past questions (their threads: the answer and each addition), as the panel would draw them. */
export const pastThreads = (answers: unknown, current: string[], stored: unknown) =>
  writtenThreads(answers, current, stored).threads.filter((t) => isPastQuestion(t.question, current));

/**
 * (Owner, Nov 5, §235) What a current question already has: its answer as last sent (by its words, also after a switch to changed questions), when it was answered
 * (a non-blank answer, or anything added to it); null for a question with no answer yet. The tester's form below the answers shows only the nulls, and a Send of it
 * keeps every non-null one exactly as it was (the server fills them in): answered questions are added to with Add to this answer, never re-sent.
 */
export function carriedAnswers(sub: { answers: unknown; additions?: unknown }, questions: string[]): (string | null)[] {
  const byText = new Map(latestItems(sub, questions).map((x) => [qText(x.question), x.answer]));
  const keys = questionKeys(itemsFor(questions));
  return questions.map((q, i) => {
    const a = byText.get(qText(q)) ?? "";
    return a.trim() || addsTo(sub.additions, keys[i]).length ? a : null;
  });
}
