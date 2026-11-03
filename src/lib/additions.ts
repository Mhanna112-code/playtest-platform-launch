import { itemsOf, type SetItem } from "./answerSets";

/**
 * (Owner, Nov 3, batch 35 §136) Sent work is locked: what a tester sent stays exactly as it was, and anything they send later is ADDED under it. Each part reads as
 * one list: what was sent first, then each addition headed "Added" (no time: the part's header line carries the time of the latest one).
 * An addition is stored on the piece (`Submission.additions`), oldest first:
 * - written answers: more text (`text`, with markers for its files), or, after a switch to changed questions, the answers to the new questions (`items`, with that
 *   send's `notes`);
 * - a recording: the recordings added (`files`).
 * `files`: the uploads sent with it (their ids).
 */
export type Addition = { at: string; text?: string; items?: SetItem[]; notes?: string; files: string[] };

/** The word above every addition. */
export const ADDED_LABEL = "Added";

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
    }];
  });
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

/** Every text in a written piece, for the 50,000-character limit: the first answers and notes, then each addition's text, answers and notes. */
export function writtenTexts(sub: { answers: unknown; notes: string; additions?: unknown }): string[] {
  return [
    ...itemsOf(sub.answers).map((x) => x.answer), sub.notes,
    ...additionsOf(sub.additions).flatMap((a) => [a.text ?? "", ...(a.items ?? []).map((x) => x.answer), a.notes ?? ""]),
  ];
}
