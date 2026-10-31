"use client";
// The full app's site-wide field checks (components/field-checks.tsx there), for lean's fields: as soon as you leave a
// box (or pick a date) the same check the button would run happens right away; a box with a problem is outlined in red
// with its message under it. Rules come from the box itself:
//   - number boxes: data-min / data-max (and data-zero-ok: 0 is allowed too), data-msg for the message (data-min-msg / data-max-msg
//     when below / above differ, matching the server's own lines);
//   - date / time boxes: min / max (data-msg, e.g. "Pick a time in the future.");
//   - text: maxLength, data-min-chars (counted after trimming), and data-required (+ data-required-msg): blank is red; data-pattern (batch 35 §27): a
//     filled-in box that doesn't match it is red with data-msg.
// Presses that aren't form submits call checkFields(root) first: every box in it is checked and marked.
// (Owner, Oct 28, batch 16 section 10) ONE rule for every form: a mistake shows at its field (red box, red line), from the client check or the
// server (markServerMistakes, the same text); a field stays red until its OWN value is fixed (re-checked as it's typed in once it's red; editing
// another field never clears it); a press goes to the first red field and puts the cursor in it; the list under the button (MistakeList) is read
// from the red fields themselves, so the two always agree. A field a component marks red itself carries data-red-msg (its line's text).
import { useEffect, useRef, useState } from "react";
import { roundedMoneyText } from "@/lib/format";
import { scrollQuestionBoxTo } from "@/components/QuestionBox";
import { digitsOnly, keyAllowed, moneyText, pastedNumber, typedMoney, wholeText } from "@/lib/numberInput";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (el: EventTarget | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
/** What the server's mistake was about: kept against the value the field had then (a changed value clears it; the client rules then decide). */
const server = new WeakMap<Element, { msg: string; value: string }>();
const hasRules = (el: Element) =>
  server.has(el) ||
  (isField(el) && (el.dataset.required != null || el.dataset.pattern != null || el.dataset.min != null || el.dataset.max != null || el.dataset.minChars != null || (el instanceof HTMLInputElement && (el.type === "date" || el.type === "datetime-local") && (!!el.min || !!el.max))));

/** A box's value (a tick: whether it's ticked); a group of boxes (data-field-group): all of theirs. */
const valueOf = (el: Element): string => {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return String(el.checked);
  if (isField(el)) return el.value;
  return JSON.stringify(Array.from(el.querySelectorAll("input, select, textarea")).map((x) => valueOf(x)));
};

function clientMessage(el: Field): string {
  const v = el.value.trim();
  const msg = el.dataset.msg;
  // (Design doc 4) A required box left blank is red at the field (on blur and on submit).
  if (el.dataset.required != null && !v) return el.dataset.requiredMsg ?? "This is required.";
  // (Owner, Oct 31, batch 35 §27) data-pattern: what a filled-in box must match (case-insensitive; the build link: "^https://"), data-msg its line.
  if (el.dataset.pattern != null && v && !new RegExp(el.dataset.pattern, "i").test(v)) return msg ?? "Check this field.";
  if (el instanceof HTMLInputElement && (el.type === "date" || el.type === "datetime-local")) {
    if (!v) return "";
    if (el.min && v < el.min) return msg ?? "Pick a time in the future.";
    if (el.max && v > el.max) return el.dataset.maxMsg ?? msg ?? "Pick an earlier date.";
    return "";
  }
  if (el.dataset.min != null || el.dataset.max != null) {
    if (!v) return "";
    const n = Number(v);
    const min = el.dataset.min != null ? Number(el.dataset.min) : -Infinity;
    const max = el.dataset.max != null ? Number(el.dataset.max) : Infinity;
    if (!Number.isFinite(n)) return msg ?? "Enter a number.";
    if (el.dataset.whole != null && !Number.isInteger(n)) return msg ?? "Enter a whole number.";
    if (el.dataset.zeroOk != null && n === 0) return "";
    if (n < min) return el.dataset.minMsg ?? msg ?? `From ${min} to ${max}.`;
    if (n > max) return el.dataset.maxMsg ?? msg ?? `From ${min} to ${max}.`;
    return "";
  }
  if (el.dataset.minChars != null) {
    const min = Number(el.dataset.minChars);
    // (Batch 30 §18) data-min-label names the field in the line: "Name of this test: at least 10 characters (6 so far)."
    if (v.length > 0 && v.length < min) return el.dataset.minLabel ? `${el.dataset.minLabel}: at least ${min} characters (${v.length} so far).` : msg ?? `Write at least ${min} characters (${v.length} so far).`;
  }
  return "";
}

/**
 * (Owner's bug, Oct 31, batch 35 §19) A field that can't be filled in (disabled itself, or inside a disabled fieldset: Free ticked, its part unticked, a locked
 * group) is never red: no outline, no line, never in the list under the button.
 */
export const isOff = (el: Element) => isField(el) && (el.disabled || !!el.matches?.(":disabled"));

function ruleMessage(el: Element): string {
  // (Batch 35 §19) Disabled: nothing to fix there (the server's line for it goes too).
  if (isOff(el)) return "";
  const own = isField(el) ? clientMessage(el) : "";
  if (own) return own;
  const s = server.get(el);
  if (s && s.value === valueOf(el)) return s.msg;
  if (s) server.delete(el);
  return "";
}

const notes = new WeakMap<Element, HTMLElement>();
/** (Batch 35 §19) The fields this file shows red right now: re-checked whenever what decides their rule may have changed. */
const reds = new Set<Element>();
let ids = 0;
let queued = false;
/** Tells every list under a button that the red fields changed. */
function changed() {
  if (queued || typeof window === "undefined") return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    window.dispatchEvent(new Event("field-mistakes"));
  });
}

/** Checks one box (or group) and shows / clears its red message. Returns whether it's fine. */
export function showField(el: Element) {
  const message = ruleMessage(el);
  let note = notes.get(el);
  if (!message) {
    // Only what this file marked is cleared here (a component's own red line, data-red-msg, is the component's).
    if (note) {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      el.classList.remove("field-bad");
      note.remove();
      notes.delete(el);
      reds.delete(el);
      changed();
    }
    return true;
  }
  el.setAttribute("aria-invalid", "true");
  el.classList.add("field-bad");
  if (!note || !note.isConnected) {
    note = document.createElement("p");
    note.id = `field-check-${++ids}`;
    note.setAttribute("role", "alert");
    note.setAttribute("data-field-error", "");
    note.className = "mt-1 w-full basis-full text-sm font-medium text-rose-300";
    // A box inside a wrapper marked data-note-after (e.g. the password box with its Show button) gets its line under the wrapper.
    (el.closest("[data-note-after]") ?? el).insertAdjacentElement("afterend", note);
    el.setAttribute("aria-describedby", note.id);
    notes.set(el, note);
  }
  if (note.textContent !== message) note.textContent = message;
  reds.add(el);
  changed();
  return false;
}

/**
 * (Owner's bug, Oct 31, batch 35 §19) Every red field's check again, now: after any typing or tick anywhere, and whenever a field's rules change under it (it
 * became disabled, its required mark went: ticking Free or unticking its part). Each field still goes by its OWN value and rules (editing another field
 * never fixes it), but a box that can no longer be filled in, or no longer needs a value, never keeps its red line. Gone from the page: forgotten.
 */
export function recheckRed() {
  for (const el of Array.from(reds)) {
    if (!el.isConnected) {
      reds.delete(el);
      notes.get(el)?.remove();
      notes.delete(el);
      changed();
      continue;
    }
    showField(el);
  }
}
/** (Batch 35 §19) The attributes that decide a field's rule: a change to any of them re-checks the red fields. */
export const RULE_ATTRS = ["disabled", "data-required", "data-required-msg", "data-pattern", "data-min", "data-max", "data-min-chars", "data-zero-ok", "min", "max"];

/** The fields red right now inside `root`, top to bottom, each with the text of its red line. */
export function redFields(root: Element | null): { el: HTMLElement; text: string }[] {
  if (!root) return [];
  const out: { el: HTMLElement; text: string }[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-invalid="true"], [data-red-msg]'))) {
    // A box inside a smaller box with its own list (data-mistakes-root inside `root`) belongs to that list only.
    const own = el.closest("[data-mistakes-root]");
    if (own && own !== root && root.contains(own)) continue;
    if (isOff(el)) continue; // (batch 35 §19) a disabled field is never in the list
    const note = notes.get(el);
    const described = el.getAttribute("aria-describedby");
    // (Owner, Oct 31, batch 35 §31) Never an empty bullet: a red field with no line text is named instead ("Open until needs fixing.").
    const text = ((note?.isConnected ? note.textContent : "") || el.dataset.redMsg || (described ? document.getElementById(described.split(" ")[0])?.textContent : "") || "").trim() || needsFixingLine(fieldNameOf(el));
    if (!out.some((x) => x.el === el || x.text === text)) out.push({ el, text }); // the same line once
  }
  return out;
}

/** (Batch 35 §31) A red field's name, for a bullet when it has no line of its own: its label, aria-label, legend or placeholder. */
export function fieldNameOf(el: HTMLElement): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
  const own = el.getAttribute("aria-label") || byFor || el.closest("label")?.textContent || el.closest("fieldset")?.querySelector("legend")?.textContent || el.getAttribute("placeholder") || "";
  return own.replace(/\s+/g, " ").replace(/\*/g, "").trim();
}
/** (Batch 35 §31) "Open until needs fixing." (a field with no name: "A field needs fixing."). */
export const needsFixingLine = (name: string) => (name ? `${name} needs fixing.` : "A field needs fixing.");

/**
 * (Owner, Oct 31, batch 35 §31) The bullets under "Fix the mistake(s) above": every red field's line (linked to it), then every mistake that belongs to no field,
 * blank lines dropped, each text once (trimmed); the heading's count is the number of bullets.
 */
export function mistakeBullets<T extends { text: string }>(items: T[], orphans: string[]): { items: T[]; extra: string[]; n: number } {
  const seen = new Set<string>();
  const its = items.filter((i) => { const t = i.text.trim(); if (!t || seen.has(t)) return false; seen.add(t); return true; });
  const extra = orphans.map((o) => o.trim()).filter((o) => { if (!o || seen.has(o)) return false; seen.add(o); return true; });
  return { items: its, extra, n: its.length + extra.length };
}

/** Scrolls to a red field and puts the cursor in it (a group: its first box). */
export function focusField(el: HTMLElement) {
  const target = isField(el) ? el : el.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? el;
  // (Batch 20 section 1) Inside a question box (the answer form with more than 3 questions), the box scrolls to the field's question first.
  if (!scrollQuestionBoxTo(el)) el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  target.focus?.({ preventScroll: true });
}
/** A press with mistakes goes to the FIRST red field, top to bottom. */
export function focusFirstMistake(root: Element | null) {
  const first = redFields(root)[0];
  if (first) focusField(first.el);
  return !!first;
}
/** Tells the list under the button of this `root` that a press was made (it shows from then on). */
export function announcePress(root: Element | null) {
  if (root && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mistakes-press", { detail: root }));
}

/** Before a press: every box with rules inside `root` is checked and marked; false when any is wrong (the first red field gets the cursor). */
export function checkFields(root: Element | null) {
  if (!root) return true;
  let ok = true;
  for (const el of Array.from(root.querySelectorAll("input, textarea, select, [data-field-group]"))) {
    if (!hasRules(el) || isOff(el)) continue;
    if (!showField(el)) ok = false;
  }
  if (redFields(root).length) ok = false;
  if (!ok) {
    announcePress(root);
    focusFirstMistake(root);
  }
  return ok;
}

/**
 * The server's field mistakes: each message goes to its field (the box in `root` whose data-match pattern fits it, or `find`), red with that text,
 * until that field's value changes. Returns the messages that belong to no field (they stay in the list without a link).
 */
/** (Batch 30 §20) The server's lines the form doesn't already show red itself (same words, ignoring the spaces around them). */
export const notShownYet = (messages: string[], shown: string[]) => messages.filter((m) => !shown.some((x) => x.trim() && x.trim() === m.trim()));

export function markServerMistakes(root: Element | null, messages: string[], find?: (msg: string) => Element | null | undefined) {
  if (!root) return messages;
  const fields = Array.from(root.querySelectorAll<HTMLElement>("[data-match]"));
  const orphans: string[] = [];
  // (Batch 30 §20) A line the form already shows red on its own (data-red-msg, e.g. the calls cap under Request a time) isn't shown, or counted, a second time.
  const shown = Array.from(root.querySelectorAll<HTMLElement>("[data-red-msg]")).map((el) => el.dataset.redMsg ?? "");
  for (const msg of notShownYet(messages, shown)) {
    const el = find?.(msg) ?? fields.find((f) => new RegExp(f.dataset.match!, "i").test(msg)) ?? null;
    if (!el || !root.contains(el)) {
      orphans.push(msg);
      continue;
    }
    // One line per field: a box already red with its own (client) line keeps it.
    if (notes.get(el)?.isConnected && !server.has(el) && ruleMessage(el)) continue;
    server.set(el, { msg, value: valueOf(el) });
    showField(el);
  }
  announcePress(root);
  return orphans;
}

// (Owner, Oct 31, batch 35 §25) Number-only boxes: the one shared helper (src/lib/numberInput.ts); wholeText / moneyText stay importable from here.
export { moneyText, wholeText } from "@/lib/numberInput";
const setValue = (el: HTMLInputElement, next: string) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, next);

/** Rounds a money box (data-money) in place, through the native setter so a React-controlled box takes the new value too. */
export function roundMoneyBox(el: HTMLInputElement) {
  const next = roundedMoneyText(el.value);
  if (next === el.value) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function FieldChecks() {
  useEffect(() => {
    const groupOf = (el: Element) => el.closest("[data-field-group]");
    // Once a box is red it's re-checked as it's typed in (the line updates, and goes when it's fixed); so is its group.
    const recheck = (el: Element) => {
      if (notes.has(el) || server.has(el)) showField(el);
      const g = groupOf(el);
      if (g && (notes.has(g) || server.has(g))) showField(g);
    };
    const onLeave = (e: FocusEvent) => {
      // (Batch 16 section 36) A money box rounds to the cent when it's left (half up) and shows the rounded value: what will be charged.
      if (e.target instanceof HTMLInputElement && e.target.dataset.money != null) roundMoneyBox(e.target);
      if (!isField(e.target) || !hasRules(e.target)) return;
      showField(e.target);
    };
    const onType = (e: Event) => {
      if (isField(e.target)) recheck(e.target);
      queueMicrotask(recheckRed); // (batch 35 §19) after the page's own redraw
    };
    // (Batch 20 section 19; batch 35 §25: src/lib/numberInput.ts) Whole-number and money boxes: what can't be in them is never typed or pasted in (checked before
    // the page's own handlers see it). A money box: digits and one decimal point, at most 2 decimals; a whole-number box: digits only.
    const kindOf = (el: EventTarget | null): "money" | "whole" | null =>
      el instanceof HTMLInputElement ? (el.dataset.whole != null ? "whole" : el.dataset.money != null ? "money" : null) : null;
    /** The box's selection, or null where the browser has none to give (a type="number" box). */
    const selOf = (el: HTMLInputElement): [number | null, number | null] => {
      try {
        return [el.selectionStart, el.selectionEnd];
      } catch {
        return [null, null];
      }
    };
    const last = new WeakMap<HTMLInputElement, string>();
    /** A money box's value just before the keystroke (the value it goes back to when the keystroke is ignored), with its selection. */
    const before = new WeakMap<HTMLInputElement, { value: string; sel: [number | null, number | null] }>();
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const kind = kindOf(el);
      if (!kind || !(el instanceof HTMLInputElement) || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const [a, b] = selOf(el);
      const outside = a == null || b == null ? el.value : el.value.slice(0, a) + el.value.slice(b);
      if (!keyAllowed(kind, e.key, outside)) e.preventDefault();
    };
    // (Batch 35 §25) Typing that would leave a money box holding something else (a third decimal, a second point; a phone keyboard's keys have no key name) is
    // stopped before it lands; where the browser can't stop it, onRaw puts the box back.
    const onBefore = (e: InputEvent) => {
      const el = e.target;
      if (kindOf(el) !== "money" || !(el instanceof HTMLInputElement)) return;
      const sel = selOf(el);
      before.set(el, { value: el.value, sel });
      if (e.inputType !== "insertText" || e.data == null || sel[0] == null || sel[1] == null) return;
      const next = el.value.slice(0, sel[0]) + e.data + el.value.slice(sel[1]);
      if (typedMoney(next, el.value) !== next && e.cancelable) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target;
      const kind = kindOf(el);
      if (!kind || !(el instanceof HTMLInputElement)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const [a, b] = selOf(el);
      const next = pastedNumber(kind, el.value, text, a, b, el.value);
      const plain = a == null || b == null ? text : el.value.slice(0, a) + text + el.value.slice(b);
      if (next === plain) return; // it fits as it is: the browser pastes it
      const clean = kind === "whole" ? digitsOnly(text) : moneyText(text);
      e.preventDefault();
      if (next === el.value) return;
      setValue(el, next);
      const at = a == null ? null : Math.min(next.length, a + clean.length);
      if (at != null) try { el.setSelectionRange(at, at); } catch { /* a box without a selection */ }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // The value it had when entered: a lone "0" typed over it brings it back.
    const onEnter = (e: FocusEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.dataset.whole != null) last.set(e.target, e.target.value);
    };
    const onRaw = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.dataset.whole != null) {
        const next = wholeText(el.value, last.get(el) ?? "");
        if (next !== el.value) setValue(el, next);
        last.set(el, next);
      } else if (el.dataset.money != null) {
        const was = before.get(el);
        before.delete(el);
        const pasted = e instanceof InputEvent && /^insertFrom/.test(e.inputType);
        const next = pasted ? moneyText(el.value) : typedMoney(el.value, was?.value);
        if (next !== el.value) {
          setValue(el, next);
          // An ignored keystroke leaves the cursor where it was.
          if (was && next === was.value && was.sel[0] != null && was.sel[1] != null) try { el.setSelectionRange(was.sel[0], was.sel[1]); } catch { /* no selection */ }
        }
      }
    };
    const onChange = (e: Event) => {
      if (!isField(e.target)) return;
      if (hasRules(e.target)) showField(e.target);
      recheck(e.target);
      queueMicrotask(recheckRed); // (batch 35 §19) Free ticked, a part unticked: the boxes they switch off lose their red at once
    };
    // (Batch 35 §19) A field's rules changed under it (disabled, required mark gone), however that happened: its red is checked again.
    const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => recheckRed());
    watch?.observe(document.body, { attributes: true, subtree: true, attributeFilter: RULE_ATTRS });
    // A form submit checks every box in it first (the press is stopped when one is wrong).
    const onSubmit = (e: Event) => {
      if (!(e.target instanceof HTMLFormElement)) return;
      if (!checkFields(e.target)) {
        // (Design doc 5) Edit's Save still goes to the server, so a blue stop and the red mistakes can show together; the server never saves while red remains.
        if (e.target.hasAttribute("data-red-and-blue")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("focusout", onLeave);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onEnter, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("beforeinput", onBefore, true);
    document.addEventListener("input", onRaw, true);
    document.addEventListener("input", onType);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onEnter, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("beforeinput", onBefore, true);
      document.removeEventListener("input", onRaw, true);
      document.removeEventListener("input", onType);
      document.removeEventListener("change", onChange);
      document.removeEventListener("submit", onSubmit, true);
      watch?.disconnect();
    };
  }, []);
  return null;
}

/** "Fix the mistake above, then press Save again." / "Fix the 2 mistakes above, …". */
export const fixLine = (n: number, press: string, top = false) =>
  // (Owner, Oct 30) A list shown at the top of its form doesn't point up: "Fix these 5 mistakes, then press Send my answers again."
  top ? `Fix ${n === 1 ? "this mistake" : `these ${n} mistakes`}, then press ${press} again.` : `Fix the ${n === 1 ? "mistake" : `${n} mistakes`} above, then press ${press} again.`;

/**
 * (Batch 16 section 10) The list under a button: the heading and one bullet per field red right now (the same text as its line), each a link to its
 * field; then any server mistake that belongs to no field. It shows once a press was made in its form (or box: the nearest data-mistakes-root) and
 * follows the fields live: fixing a field removes its bullet at the same moment, and the list goes with the last one. (Batch 35 §31) A mistake that belongs to
 * no field is a bullet in the same list too (never a loose red line).
 */
export function MistakeList({ press, orphans = [], shown, top = false }: { press: string; orphans?: string[]; shown?: boolean; top?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState(false);
  const [items, setItems] = useState<{ el: HTMLElement; text: string }[]>([]);
  // (Owner, Oct 31, batch 35 §57) A server line that belongs to no field goes once the person changes anything in this form (a new refusal brings new ones).
  const [orphansGone, setOrphansGone] = useState(false);
  useEffect(() => setOrphansGone(false), [orphans]);
  useEffect(() => {
    const rootOf = () => ref.current?.closest("[data-mistakes-root], form") ?? null;
    const read = () => setItems(redFields(rootOf()));
    // (Batch 35 §57) A field the page itself marks red (data-red-msg / aria-invalid set by React, e.g. the NDA tick's "Accept the NDA to join.") clears its bullet the
    // moment the page clears it: the list follows those attributes too, not only this file's own checks.
    const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => read());
    const root0 = rootOf();
    if (root0) watch?.observe(root0, { attributes: true, subtree: true, attributeFilter: ["data-red-msg", "aria-invalid"] });
    const onEdit = (e: Event) => {
      const r = rootOf();
      if (!r || !(e.target instanceof Node) || !r.contains(e.target)) return;
      setOrphansGone(true);
      queueMicrotask(read);
    };
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    const onPress = (e: Event) => {
      const r = (e as CustomEvent<Element>).detail;
      const mine = rootOf();
      if (mine && r && (r.contains(mine) || mine.contains(r))) setPressed(true);
      read();
    };
    read();
    window.addEventListener("field-mistakes", read);
    window.addEventListener("mistakes-press", onPress);
    return () => {
      watch?.disconnect();
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      window.removeEventListener("field-mistakes", read);
      window.removeEventListener("mistakes-press", onPress);
    };
  }, []);
  // (Owner, Oct 31, batch 35 §31) An orphan arriving shows the list at once (a server refusal is a press's answer).
  const left = orphansGone ? [] : orphans;
  const on = pressed || !!shown || left.some((o) => o.trim());
  // (Batch 35 §31) ALL mistakes under the one heading: the red fields' lines (linked) and the ones that belong to no field, never a loose red line; no blank or
  // repeated bullet; the count is the bullets'.
  const { items: shownItems, extra, n } = mistakeBullets(items, left);
  return (
    <div ref={ref} data-mistake-list="" className="space-y-1" hidden={!on || n === 0} role={on && n > 0 ? "alert" : undefined}>
      {on && n > 0 && (
        <>
          <p className="err-field">{fixLine(n, press, top)}</p>
          <ul className="err-field list-disc pl-5">
            {shownItems.map((i, k) => (
              <li key={k}>
                <a href={i.el.id ? `#${i.el.id}` : "#"} className="text-rose-300 underline decoration-rose-300/50 hover:text-rose-200" data-mistake-link="" onClick={(e) => { e.preventDefault(); focusField(i.el); }}>{i.text}</a>
              </li>
            ))}
            {extra.map((o) => <li key={o} data-mistake-orphan="">{o}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

/** A picker's min, set after the page loads (the viewer's own time): "" on the server. */
export function useLocalMin(plusMinutes = 0, dateOnly = false) {
  const [v, setV] = useState("");
  useEffect(() => setV(localNow(plusMinutes, dateOnly)), [plusMinutes, dateOnly]);
  return v;
}

/** "now + minutes" as a datetime-local / date value in the viewer's time (a picker's min). */
export function localNow(plusMinutes = 0, dateOnly = false) {
  const d = new Date(Date.now() + plusMinutes * 60_000);
  const s = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
  return dateOnly ? s.slice(0, 10) : s.slice(0, 16);
}
