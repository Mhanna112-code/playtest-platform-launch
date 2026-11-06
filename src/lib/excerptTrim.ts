/**
 * (Owner, Nov 4, §196) Trimming an excerpt is delete-only (§262: typing back a deleted character, the very one, restores it): the box starts with the whole answer (its plain text) and only deleting works. What is kept is a mask
 * over the answer's characters (true: kept). Shared by the tester's box (Excerpts.tsx) and the server's check (excerpts.ts requestExcerpt).
 *   - Where a part was removed from the MIDDLE (words kept on both sides), the excerpt reads " … " there. Nothing marks a cut at the very start or end, and a
 *     removed run of spaces or line breaks only is one space (words are never glued together).
 *   - The server accepts a text whose "…"-separated pieces each appear in the answer, in order (whitespace tidied); anything else added is refused as before.
 */
export const GAP = " … ";
export const ELLIPSIS = "…";

/** Whitespace tidied, for comparing a trimmed quote with the answer it came from. */
export const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Everything of the answer kept (the box at first, and after "Use original answer"). */
export const allKept = (original: string) => new Array<boolean>(original.length).fill(true);

/** What the box shows: the kept characters, as they are (no ellipsis). */
export function keptChars(original: string, kept: readonly boolean[]) {
  let out = "";
  for (let i = 0; i < original.length; i++) if (kept[i] !== false) out += original[i];
  return out;
}

/** Each run of the answer, kept or left out, in order (the original's highlights). */
export function runsOf(original: string, kept: readonly boolean[]): { text: string; kept: boolean }[] {
  const runs: { text: string; kept: boolean }[] = [];
  for (let i = 0; i < original.length; i++) {
    const k = kept[i] !== false;
    const last = runs[runs.length - 1];
    if (last && last.kept === k) last.text += original[i];
    else runs.push({ text: original[i], kept: k });
  }
  return runs;
}

/** The excerpt as it's sent and stored: the kept text with " … " at each gap in the middle, whitespace tidied. `gaps`: how many ellipses it has; `pieces`: the text between them. */
export function excerptOf(original: string, kept: readonly boolean[]): { text: string; gaps: number; pieces: string[] } {
  let marked = "";
  for (const r of runsOf(original, kept)) marked += r.kept ? r.text : /\S/.test(r.text) ? "\u0000" : " ";
  const pieces = marked.split("\u0000").map(squash).filter(Boolean);
  return { text: pieces.join(GAP), gaps: Math.max(0, pieces.length - 1), pieces };
}

/**
 * A change to the box: the range of the OLD value that was deleted when `next` is `old` with exactly one contiguous range removed, else null (typing, pasting,
 * dropping, an autocorrect replacement, or no change: refused). Compared by common prefix and suffix, so it doesn't depend on which event the browser sent.
 * `caret` (the box's caret after the change, where a deletion leaves it) places the range when the text alone can't tell: deleting "I tried … shook. " before
 * "I don't" leaves the same text as deleting "tried … shook. I ", but only the first is what was selected (the strike-through and the " … " follow it).
 */
export function deletedRange(old: string, next: string, caret?: number | null): { start: number; end: number } | null {
  if (next.length >= old.length) return null;
  const len = old.length - next.length;
  if (caret != null && caret >= 0 && caret <= next.length && old.slice(0, caret) === next.slice(0, caret) && old.slice(caret + len) === next.slice(caret)) return { start: caret, end: caret + len };
  let p = 0;
  while (p < next.length && old[p] === next[p]) p++;
  let s = 0;
  while (s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
  if (p + s !== next.length) return null;
  return { start: p, end: old.length - s };
}

/**
 * (Owner, Nov 5, §262) A change that typed text into the box: where (a box position in the OLD value) and what, when `next` is `old` with exactly one run
 * inserted, else null. `caret` (after the change, the end of what was typed) places it when the text alone can't tell.
 */
export function insertedRange(old: string, next: string, caret?: number | null): { at: number; text: string } | null {
  if (next.length <= old.length) return null;
  const len = next.length - old.length;
  if (caret != null && caret >= len && caret <= next.length) {
    const at = caret - len;
    if (old.slice(0, at) === next.slice(0, at) && old.slice(at) === next.slice(caret)) return { at, text: next.slice(at, caret) };
  }
  let p = 0;
  while (p < old.length && old[p] === next[p]) p++;
  let s = 0;
  while (s < old.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
  if (p + s !== old.length) return null;
  return { at: p, text: next.slice(p, next.length - s) };
}

/**
 * (Owner, Nov 5, §262) Typing back what was deleted by accident: `text` typed at box position `at` restores the answer's left-out characters right there, in order
 * (the first left-out character after the kept one before the caret, then the next ...), when each typed character is exactly that character. Anything else
 * (a different character, typing where nothing was left out, typing past the left-out run) is refused: null. The result is still only the answer's own words.
 */
export function restoreAt(original: string, kept: readonly boolean[], at: number, text: string): boolean[] | null {
  if (!text) return null;
  let i = 0;
  for (let seen = 0; i < original.length && seen < at; i++) if (kept[i] !== false) seen++;
  const out = kept.slice();
  for (const ch of text) {
    if (i >= original.length || out[i] !== false || original[i] !== ch) return null;
    out[i] = true;
    i++;
  }
  return out;
}

/** The mask after deleting the box's characters [start, end) (box positions, mapped back onto the answer). */
export function deleteFrom(kept: readonly boolean[], start: number, end: number) {
  const out = kept.slice();
  let at = 0;
  for (let i = 0; i < out.length && at < end; i++) {
    if (out[i] === false) continue;
    if (at >= start) out[i] = false;
    at++;
  }
  return out;
}

/** (§196) The server's check: every "…"-separated piece of `text` appears in `answer`, in order (whitespace tidied). Words added anywhere fail. */
export function fromAnswer(answer: string, text: string) {
  const whole = squash(answer);
  const pieces = text.split(ELLIPSIS).map(squash).filter(Boolean);
  if (!pieces.length) return false;
  let at = 0;
  for (const p of pieces) {
    const i = whole.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}
