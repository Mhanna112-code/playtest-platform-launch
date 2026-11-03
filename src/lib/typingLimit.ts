// (Owner, Nov 3, batch 35 §140) Typing stops at every box's limit. Most boxes use the browser's own maxLength (it counts JS string length, UTF-16 units, as the
// counters and the server's checks do; a saved value already longer is never cut, only added to). This file is the one shared limiter for the boxes maxLength
// can't describe: the one-per-line boxes (access keys, questions: each LINE has its limit, Enter always works) and the written answers (counted without the
// file markers, all the answers together). It also holds the grey "Cut to the N-character limit." note a cut paste shows, and focusLine (§141: a list item under
// a box puts the cursor on its line).
import { withoutAttachmentMarkers } from "./answerAttachments";
import { KEY_MAX_LENGTH } from "./keys";
import { LIMITS } from "./limits";
import { WRITTEN_MAX_CHARS } from "./rules";

/** What a box allows. `max`: the whole box (by `measure`, the value's length unless given); `lineMax`: each line (by `lineMeasure`). */
export type TypingRule = {
  max?: number;
  measure?: (value: string) => number;
  lineMax?: number;
  lineMeasure?: (line: string) => number;
  /** The grey note's words when a paste was cut ("Cut to the 200-character limit for each key."). */
  cutNote?: string;
};

/** (Owner, Nov 3) Keys and questions are checked trimmed (the server trims each line), so spaces around a line don't count against it. */
export const trimmedLength = (line: string) => line.trim().length;

const len = (s: string) => s.length;
/** A cut never leaves half an emoji (a lone high surrogate) at its end. */
const safeCut = (s: string, k: number) => (k > 0 && k < s.length && /[\uD800-\uDBFF]/.test(s[k - 1]) ? k - 1 : k);
/** The largest k (0..s.length) for which fits(k) holds, `fits` growing with k (more characters never measure shorter); 0 when nothing fits. */
function largest(s: string, fits: (k: number) => boolean) {
  if (fits(s.length)) return s.length;
  let lo = 0, hi = s.length; // fits(lo) is assumed (0 always "fits": nothing added), fits(hi) is false
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return safeCut(s, lo);
}

/**
 * What one edit leaves in a limited box: `prev` the value before, `next` what the browser made of it. The inserted text is found by comparing the two (the common
 * start and end); `caretAfter` (the cursor after the edit, when known) says where the insertion ended, so typing "a" after an "a" is placed right. Deleting is
 * always allowed. What was added is cut so that:
 *  - each line it touches stays within `lineMax` (a line already over it takes nothing more, but Enter still starts a new line; a pasted block is cut line by line);
 *  - the whole box stays within `max` (or doesn't grow, when it was already over).
 * Returns the value, whether anything was cut, and where the cursor goes (the end of what was kept).
 */
export function limitEdit(prev: string, next: string, rule: TypingRule, caretAfter?: number): { value: string; cut: boolean; caret: number } {
  const fine = { value: next, cut: false, caret: -1 };
  if (next === prev || (rule.max == null && rule.lineMax == null)) return fine;
  const most = Math.min(prev.length, next.length);
  // prev = prev.slice(0, a) + (what was replaced) + its last b characters; next = the same start + the inserted text + the same end
  let b = -1;
  if (caretAfter != null && caretAfter >= 0 && caretAfter <= next.length && next.length - caretAfter <= prev.length && prev.endsWith(next.slice(caretAfter))) b = next.length - caretAfter;
  let a = 0;
  const aMost = b < 0 ? most : Math.min(prev.length - b, next.length - b);
  while (a < aMost && prev[a] === next[a]) a++;
  if (b < 0) {
    b = 0;
    while (b < most - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
  }
  const head = next.slice(0, a), tail = next.slice(next.length - b);
  let added = next.slice(a, next.length - b);
  if (!added) return fine; // a deletion
  const original = added;
  if (rule.lineMax != null) {
    const max = rule.lineMax, m = rule.lineMeasure ?? len;
    const before = head.slice(head.lastIndexOf("\n") + 1); // the start of the line the edit begins on
    const nl = tail.indexOf("\n");
    const after = nl < 0 ? tail : tail.slice(0, nl); // the end of the line it ends on
    const parts = added.split("\n");
    added = parts
      .map((p, i) => {
        const pre = i === 0 ? before : "", post = i === parts.length - 1 ? after : "";
        return p.slice(0, largest(p, (k) => k === 0 || m(pre + p.slice(0, k) + post) <= max));
      })
      .join("\n");
  }
  if (rule.max != null) {
    const max = rule.max, m = rule.measure ?? len;
    const cap = Math.max(max, m(prev)); // already over (an older, longer value): it may not grow
    const room = added;
    added = room.slice(0, largest(room, (k) => k === 0 || m(head + room.slice(0, k) + tail) <= cap));
  }
  if (added === original) return fine;
  return { value: head + added + tail, cut: true, caret: head.length + added.length };
}

/** "Cut to the 2,000-character limit." */
export const cutToLine = (max: number, what = "") => `Cut to the ${max.toLocaleString("en-US")}-character limit${what ? ` ${what}` : ""}.`;

/** (Owner, Nov 3) The access keys box (Post's, and Edit's Free box): each key (line) up to KEY_MAX_LENGTH, counted trimmed as the server does. */
export const KEY_RULE: TypingRule = { lineMax: KEY_MAX_LENGTH, lineMeasure: trimmedLength, cutNote: cutToLine(KEY_MAX_LENGTH, "for each key") };
/** (Owner, Nov 3) The questions box: each question (line) up to LIMITS.question, trimmed (the 21st question is capQuestions' rule). */
export const QUESTION_RULE: TypingRule = { lineMax: LIMITS.question, lineMeasure: trimmedLength, cutNote: cutToLine(LIMITS.question, "for each question") };
/**
 * (Owner, Nov 3) One written-answer box: the whole written part (every answer and the notes) is at most WRITTEN_MAX_CHARS without the file markers, so a box takes
 * what is left after the others (`others`: their count).
 */
export const answerRule = (others: number): TypingRule => ({ max: Math.max(0, WRITTEN_MAX_CHARS - others), measure: (v) => withoutAttachmentMarkers(v).length, cutNote: cutToLine(WRITTEN_MAX_CHARS, "for all your answers together") });

type Box = HTMLInputElement | HTMLTextAreaElement;
const notes = new WeakMap<Element, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
/** How long the grey note stays. */
export const CUT_NOTE_MS = 4000;
/**
 * (Owner, Nov 3) A paste that was cut: a short grey line under the box for a moment ("Cut to the 2,000-character limit."), after the box's counter when it has
 * one right under it. Shown again (and kept longer) by the next cut paste. Never red: nothing is wrong, the box just took what fits.
 */
export function showCutNote(box: Box, text: string) {
  if (typeof document === "undefined") return;
  const had = notes.get(box);
  if (had) clearTimeout(had.timer);
  let el = had?.el;
  if (!el || !el.isConnected) {
    el = document.createElement("p");
    el.setAttribute("role", "status");
    el.setAttribute("data-cut-note", "");
    el.className = "mt-1 w-full basis-full text-right text-xs text-slate-400";
    const at = box.closest("[data-note-after]") ?? box;
    const next = at.nextElementSibling;
    (next?.hasAttribute("data-character-count") ? next : at).insertAdjacentElement("afterend", el);
  }
  el.textContent = text;
  const shown = el;
  notes.set(box, { el: shown, timer: setTimeout(() => { shown.remove(); notes.delete(box); }, CUT_NOTE_MS) });
}

const pasted = (e: Event) => /^insertFrom(Paste|Drop)/.test((e as InputEvent).inputType ?? "");
/**
 * A limited box's onChange: the value the box may take after this edit (`prev` its value before). When the edit was cut, the box itself is set to the kept value
 * with the cursor at its end (so React's redraw doesn't move it), and a cut paste shows the grey note. While an IME is composing, nothing is cut (the counter
 * and the server still check).
 */
export function limitedChange(e: { target: Box; nativeEvent: Event }, prev: string, rule: TypingRule): string {
  const box = e.target;
  if ((e.nativeEvent as InputEvent).isComposing) return box.value;
  const r = limitEdit(prev, box.value, rule, box.selectionEnd ?? undefined);
  if (!r.cut) return box.value;
  box.value = r.value;
  try { box.setSelectionRange(r.caret, r.caret); } catch { /* a box without a selection */ }
  if (pasted(e.nativeEvent) && rule.cutNote) showCutNote(box, rule.cutNote);
  return r.value;
}

/**
 * (Owner, Nov 3, §141) Where line `index` is in `text`: [start, end) offsets, the end before its line break. Lines break at "\n", "\r\n" or "\r"; blank lines count
 * as lines. Past the last line: the end of the text.
 */
export function lineRange(text: string, index: number): [number, number] {
  let start = 0;
  for (let i = 0; i < index; i++) {
    const m = /\r\n|\n|\r/g;
    m.lastIndex = start;
    const hit = m.exec(text);
    if (!hit) return [text.length, text.length];
    start = hit.index + hit[0].length;
  }
  const m = /\r\n|\n|\r/g;
  m.lastIndex = start;
  const hit = m.exec(text);
  return [start, hit ? hit.index : text.length];
}

/** The lines of a box with their line numbers (0-based), blank ones left out: the items of the list under it. Trimmed. */
export const linesOf = (text: string) => text.split(/\r\n|\n|\r/).map((t, line) => ({ text: t.trim(), line })).filter((x) => x.text);

/** How far down the box line `index` starts, in pixels, with wrapping: measured in a hidden copy of the box with the same width and font. */
function lineTop(box: HTMLTextAreaElement, start: number) {
  const cs = getComputedStyle(box);
  const copy = document.createElement("div");
  for (const p of ["font", "letterSpacing", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing", "tabSize", "wordSpacing", "textIndent"] as const) copy.style[p] = cs[p];
  Object.assign(copy.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", width: `${box.clientWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word", borderStyle: "solid", height: "auto" });
  copy.textContent = box.value.slice(0, start);
  const mark = document.createElement("span");
  mark.textContent = "​";
  copy.appendChild(mark);
  document.body.appendChild(copy);
  const top = mark.offsetTop;
  copy.remove();
  return top;
}

/**
 * (Owner, Nov 3, §141) A list item under a box (a question, a key) was clicked: the cursor goes into the box at the end of that line, and the box scrolls so the
 * line is in view (and the box into the page's view). Nothing is selected, so typing never replaces the line by accident.
 */
export function focusLine(box: HTMLTextAreaElement | null, index: number) {
  if (!box) return;
  const [, end] = lineRange(box.value, index);
  box.focus({ preventScroll: true });
  try { box.setSelectionRange(end, end); } catch { /* no selection */ }
  try {
    const top = lineTop(box, lineRange(box.value, index)[0]);
    const lh = parseFloat(getComputedStyle(box).lineHeight) || 20;
    if (top < box.scrollTop || top + lh > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  } catch { /* measuring failed: the browser's own scroll to the cursor stays */ }
  box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}
