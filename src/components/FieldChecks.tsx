"use client";
// The full app's site-wide field checks (components/field-checks.tsx there), for lean's fields: as soon as you leave a
// box (or pick a date) the same check the button would run happens right away; a box with a problem is outlined in red
// with its message under it, and clears as soon as what's typed is fine. Rules come from the box itself:
//   - number boxes: data-min / data-max (and data-zero-ok: 0 is allowed too), data-msg for the message;
//   - date / time boxes: min / max (data-msg, e.g. "Pick a time in the future.");
//   - text: maxLength, data-min-chars (counted after trimming), and data-required (+ data-required-msg): blank is red.
// Presses that aren't form submits call checkFields(root) first: every box in it is checked and marked.
import { useEffect, useState } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;
const isField = (el: EventTarget | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
const hasRules = (el: Field) => el.dataset.required != null || el.dataset.min != null || el.dataset.max != null || el.dataset.minChars != null || (el instanceof HTMLInputElement && (el.type === "date" || el.type === "datetime-local") && (!!el.min || !!el.max));

function ruleMessage(el: Field): string {
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
    if (n < min || n > max) return msg ?? `From ${min} to ${max}.`;
    return "";
  }
  if (el.dataset.minChars != null) {
    const min = Number(el.dataset.minChars);
    if (v.length > 0 && v.length < min) return msg ?? `Write at least ${min} characters (${v.length} so far).`;
  }
  return "";
}

const notes = new WeakMap<Field, HTMLElement>();
let ids = 0;

/** Checks one box and shows / clears its red message. Returns whether it's fine. */
export function showField(el: Field) {
  const message = ruleMessage(el);
  let note = notes.get(el);
  if (!message) {
    el.removeAttribute("aria-invalid");
    el.classList.remove("field-bad");
    note?.remove();
    notes.delete(el);
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
    el.insertAdjacentElement("afterend", note);
    el.setAttribute("aria-describedby", note.id);
    notes.set(el, note);
  }
  note.textContent = message;
  return false;
}

/** Before a press: every box with rules inside `root` is checked and marked; false when any is wrong (the first gets the focus). */
export function checkFields(root: Element | null) {
  if (!root) return true;
  let ok = true;
  for (const el of Array.from(root.querySelectorAll("input, textarea"))) {
    if (!isField(el) || !hasRules(el) || el.disabled) continue;
    if (!showField(el)) {
      if (ok) el.focus();
      ok = false;
    }
  }
  return ok;
}

export function FieldChecks() {
  useEffect(() => {
    const touched = new WeakSet<Field>();
    const onLeave = (e: FocusEvent) => {
      if (!isField(e.target) || !hasRules(e.target)) return;
      touched.add(e.target);
      showField(e.target);
    };
    // While typing a message never appears: a marked box clears as soon as it's fine.
    const onType = (e: Event) => {
      if (!isField(e.target) || !hasRules(e.target) || !touched.has(e.target)) return;
      if (!ruleMessage(e.target)) showField(e.target);
    };
    const onChange = (e: Event) => {
      if (!isField(e.target) || !hasRules(e.target)) return;
      touched.add(e.target);
      showField(e.target);
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
    document.addEventListener("input", onType);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("input", onType);
      document.removeEventListener("change", onChange);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
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
