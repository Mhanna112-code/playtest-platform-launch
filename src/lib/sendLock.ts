import { createContext, useCallback, useLayoutEffect, useState, type RefObject } from "react";

/**
 * (Owner, Nov 5, §261) "Disable typing in boxes while their send is going through." While a press that sends what's typed is in flight (from the press until the
 * server answers, with any bank check it opens, and after it went through until the page's redraw has landed), every box whose text that press sends is
 * read-only: still selectable and readable, just not changeable. The same form's file pickers, formatting buttons and "Use theirs" buttons are disabled. One look
 * for all of them, in globals.css ([data-send-locked]: dimmed, cursor-not-allowed).
 * When the press ends (refused, failed, stopped once) the boxes are as before; a refused press keeps the draft as it always did. Boxes another press sends (a
 * different form on the same page) never take this.
 * Every press's box uses these two spreads; `sending` is the form's own in-flight state (usePress's `busy`, a form's own `busy`, `bank.open`, `useSending`;
 * PressButton tells its caller with `onSending`).
 */
export const SEND_LOCKED_ATTR = "data-send-locked";

export type TextLock = { readOnly?: true; "aria-readonly"?: true; "data-send-locked"?: "" };
export type PickLock = { disabled?: true; "data-send-locked"?: "" };

/** (§261) A text box (textarea, text input) whose text the press sends: read-only while it's on its way. Spread it AFTER the box's own `readOnly`, if any. */
export function lockText(sending: boolean): TextLock {
  return sending ? { readOnly: true, "aria-readonly": true, [SEND_LOCKED_ATTR]: "" } : {};
}

/** (§261) A file picker, formatting button or "Use theirs" in the same form: disabled while the press is on its way. Spread it AFTER the element's own `disabled`. */
export function lockPick(sending: boolean): PickLock {
  return sending ? { disabled: true, [SEND_LOCKED_ATTR]: "" } : {};
}

/**
 * (§261) A form's whole press, from the click to its end: `run(send)` is `sending` until `send` settles. It covers what a press does after the server answered
 * and before the form's own finished state takes over (a bank check, clearing the draft), so the boxes never open for a moment in between. It changes nothing
 * the press does.
 */
export function useSending() {
  const [sending, setSending] = useState(false);
  const run = useCallback(async <T,>(send: () => Promise<T>): Promise<T> => {
    setSending(true);
    try {
      return await send();
    } finally {
      setSending(false);
    }
  }, []);
  return { sending, run };
}

/** (§261) The text boxes `useLockInside` makes read-only: every textarea and typed input (not ticks, choices, hidden values, files or buttons). */
export const LOCKED_TEXT_SELECTOR = 'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="reset"])';

/**
 * (§261) For a form whose boxes are drawn by many parts (the signed-out forms: AuthForm's boxes are its pages' own; Post a test / Edit: its fields, KeyBoxes,
 * FieldNote's "Use theirs"): while `sending`, every text box inside `root` that isn't read-only already becomes read-only and every file picker and "Use theirs"
 * disabled, each marked; when the press ends exactly those are put back. A form that draws its few boxes itself uses `lockText` / `lockPick` instead.
 */
export function lockInside(root: ParentNode | null): () => void {
  if (!root) return () => {};
  const text = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(LOCKED_TEXT_SELECTOR)).filter((el) => !el.readOnly);
  // File pickers, and "Use theirs" (it would put another tab's value in a box on its way).
  const files = Array.from(root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="file"], button[data-use-theirs]')).filter((el) => !el.disabled);
  for (const el of text) { el.readOnly = true; el.setAttribute("aria-readonly", "true"); el.setAttribute(SEND_LOCKED_ATTR, ""); }
  for (const el of files) { el.disabled = true; el.setAttribute(SEND_LOCKED_ATTR, ""); }
  return () => {
    for (const el of text) { el.readOnly = false; el.removeAttribute("aria-readonly"); el.removeAttribute(SEND_LOCKED_ATTR); }
    for (const el of files) { el.disabled = false; el.removeAttribute(SEND_LOCKED_ATTR); }
  };
}

/** (§261) `lockInside` for a mounted form: locked while `sending`, put back when it ends (or the form goes). */
export function useLockInside(root: RefObject<HTMLElement | null>, sending: boolean) {
  useLayoutEffect(() => (sending ? lockInside(root.current) : undefined), [root, sending]);
}

/** (§261) A form whose shared box component draws its boxes (the written answers' AnswerBox): the form says it's sending once, every box in it reads this. */
export const SendingScope = createContext(false);
