"use client";
// The full app's site-wide field checks (components/field-checks.tsx there), for lean's fields: as soon as you leave a
// box (or pick a date) the same check the button would run happens right away; a box with a problem is outlined in red
// with its message under it. Rules come from the box itself:
//   - number boxes: data-min / data-max (and data-zero-ok: 0 is allowed too), data-msg for the message (data-min-msg / data-max-msg
//     when below / above differ, matching the server's own lines);
//   - date / time boxes: min / max (data-msg, e.g. "Pick a time in the future.");
//   - text: maxLength, data-min-chars (counted after trimming), and data-required (+ data-required-msg): blank is red.
// Presses that aren't form submits call checkFields(root) first: every box in it is checked and marked.
// (Owner, Oct 28, batch 16 section 10) ONE rule for every form: a mistake shows at its field (red box, red line), from the client check or the
// server (markServerMistakes, the same text); a field stays red until its OWN value is fixed (re-checked as it's typed in once it's red; editing
// another field never clears it); a press goes to the first red field and puts the cursor in it; the list under the button (MistakeList) is read
// from the red fields themselves, so the two always agree. A field a component marks red itself carries data-red-msg (its line's text).
import { useEffect, useRef, useState } from "react";
import { roundedMoneyText } from "@/lib/format";
import { scrollQuestionBoxTo } from "@/components/QuestionBox";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (el: EventTarget | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
/** What the server's mistake was about: kept against the value the field had then (a changed value clears it; the client rules then decide). */
const server = new WeakMap<Element, { msg: string; value: string }>();
const hasRules = (el: Element) =>
  server.has(el) ||
  (isField(el) && (el.dataset.required != null || el.dataset.min != null || el.dataset.max != null || el.dataset.minChars != null || (el instanceof HTMLInputElement && (el.type === "date" || el.type === "datetime-local") && (!!el.min || !!el.max))));

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

function ruleMessage(el: Element): string {
  const own = isField(el) && !el.disabled ? clientMessage(el) : "";
  if (own) return own;
  const s = server.get(el);
  if (s && s.value === valueOf(el)) return s.msg;
  if (s) server.delete(el);
  return "";
}

const notes = new WeakMap<Element, HTMLElement>();
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
  changed();
  return false;
}

/** The fields red right now inside `root`, top to bottom, each with the text of its red line. */
export function redFields(root: Element | null): { el: HTMLElement; text: string }[] {
  if (!root) return [];
  const out: { el: HTMLElement; text: string }[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-invalid="true"], [data-red-msg]'))) {
    // A box inside a smaller box with its own list (data-mistakes-root inside `root`) belongs to that list only.
    const own = el.closest("[data-mistakes-root]");
    if (own && own !== root && root.contains(own)) continue;
    const note = notes.get(el);
    const described = el.getAttribute("aria-describedby");
    const text = (note?.isConnected ? note.textContent : "") || el.dataset.redMsg || (described ? document.getElementById(described.split(" ")[0])?.textContent : "") || "";
    if (text && !out.some((x) => x.el === el)) out.push({ el, text });
  }
  return out;
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
    if (!hasRules(el) || (isField(el) && el.disabled)) continue;
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

/**
 * (Owner, Oct 28, batch 20 section 19) What a whole-number box (data-whole: spots, a call's Length, the admin's Extend days…) may hold: digits only (a minus, "e",
 * "+", "." and letters are dropped), never 0 or below: a value that is only zeros is ignored (the box keeps what it had). The maximum keeps its red line.
 */
export function wholeText(next: string, prev = "") {
  const digits = next.replace(/\D/g, "");
  if (!digits) return "";
  if (/^0+$/.test(digits)) return prev;
  return digits.replace(/^0+/, "");
}
/** (Batch 20 section 19) A money box never takes a minus sign ($0 stays allowed where it is today). */
export const moneyText = (next: string) => next.replace(/[-\u2212]/g, "");
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
    };
    // (Batch 20 section 19) Whole-number and money boxes: what can't be in them is never typed or pasted in (checked before the page's own handlers see it).
    const last = new WeakMap<HTMLInputElement, string>();
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (el.dataset.whole != null && !/\d/.test(e.key)) e.preventDefault();
      else if (el.dataset.money != null && (e.key === "-" || e.key === "\u2212")) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || (el.dataset.whole == null && el.dataset.money == null)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const clean = el.dataset.whole != null ? wholeText(text, "") : moneyText(text);
      if (clean === text) return;
      e.preventDefault();
      if (!clean) return;
      setValue(el, el.dataset.whole != null ? wholeText(clean, el.value) : clean);
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
        const next = moneyText(el.value);
        if (next !== el.value) setValue(el, next);
      }
    };
    const onChange = (e: Event) => {
      if (!isField(e.target)) return;
      if (hasRules(e.target)) showField(e.target);
      recheck(e.target);
    };
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
    document.addEventListener("input", onRaw, true);
    document.addEventListener("input", onType);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onEnter, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("input", onRaw, true);
      document.removeEventListener("input", onType);
      document.removeEventListener("change", onChange);
      document.removeEventListener("submit", onSubmit, true);
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
 * follows the fields live: fixing a field removes its bullet at the same moment, and the list goes with the last one. With no red field, a mistake
 * that belongs to no field shows as a plain red line.
 */
export function MistakeList({ press, orphans = [], shown, top = false }: { press: string; orphans?: string[]; shown?: boolean; top?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState(false);
  const [items, setItems] = useState<{ el: HTMLElement; text: string }[]>([]);
  useEffect(() => {
    const rootOf = () => ref.current?.closest("[data-mistakes-root], form") ?? null;
    const read = () => setItems(redFields(rootOf()));
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
      window.removeEventListener("field-mistakes", read);
      window.removeEventListener("mistakes-press", onPress);
    };
  }, []);
  const on = pressed || !!shown;
  const extra = orphans.filter((o) => !items.some((i) => i.text === o));
  const n = items.length + extra.length;
  return (
    <div ref={ref} data-mistake-list="" className="space-y-1" hidden={!on || n === 0}>
      {on && n > 0 && items.length > 0 && (
        <>
          <p className="err-field">{fixLine(n, press, top)}</p>
          <ul className="err-field list-disc pl-5">
            {items.map((i, k) => (
              <li key={k}>
                <a href={i.el.id ? `#${i.el.id}` : "#"} className="text-rose-300 underline decoration-rose-300/50 hover:text-rose-200" data-mistake-link="" onClick={(e) => { e.preventDefault(); focusField(i.el); }}>{i.text}</a>
              </li>
            ))}
            {extra.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </>
      )}
      {on && n > 0 && items.length === 0 && extra.map((o) => <p key={o} className="err-field" role="alert">{o}</p>)}
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
