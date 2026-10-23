import { useEffect, useRef } from "react";
import type { Change } from "@/components/ChangesBox";

// The page's "seen" marker moves forward as the live top notice shows changes (owner, NEWEST+3): every button sends
// the later of the page's own render time and the last time the notice showed everything.
let shownUpTo = "";
let scope = "";

export function setShown(s: string, at: string) {
  scope = s;
  if (!shownUpTo || at > shownUpTo) shownUpTo = at;
}
export function clearShown(s: string) {
  if (scope === s) {
    scope = "";
    shownUpTo = "";
  }
}
/** The seen marker a press sends: the page's render time, or later if the top notice has shown more. */
export function seenNow(pageSeenAt: string) {
  return shownUpTo && shownUpTo > pageSeenAt ? shownUpTo : pageSeenAt;
}

/** New changes the top notice just picked up: an open stop box under a button adds them (it stays live). */
export const LIVE_EVENT = "live-changes";
export function announce(added: Change[]) {
  if (added.length) window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: added }));
}

const ck = (c: Change) => `${new Date(c.at).getTime()}|${c.text}`;

/**
 * Lines a stop box under a pressed button has shown: seen. The top box still lists them, quietly: they never cause
 * its once-per-page scroll (a press never moves the page).
 */
const shownInBox = new Set<string>();
export function markShownInBox(lines: Change[]) {
  for (const c of lines) shownInBox.add(ck(c));
}
export const wasShownInBox = (c: Change) => shownInBox.has(ck(c));

/**
 * Lines a stop box under a pressed button has shown: seen. The top box still lists them, quietly: they never cause
 * its once-per-page scroll (a press never moves the page).
 */
const shownInBox = new Set<string>();
export function markShownInBox(lines: Change[]) {
  for (const c of lines) shownInBox.add(ck(c));
}
export const wasShownInBox = (c: Change) => shownInBox.has(ck(c));
/** Adds newly picked-up changes to an open box, skipping any it already lists. */
export function mergeChanges(old: Change[], added: Change[]) {
  const have = new Set(old.map(ck));
  return [...old, ...added.filter((c) => !have.has(ck(c)))];
}

/** While a stop box is open, new changes the page picks up are added to it. */
export function useLiveAppend(open: boolean, add: (added: Change[]) => void) {
  const cb = useRef(add);
  cb.current = add;
  useEffect(() => {
    if (!open) return;
    const on = (e: Event) => cb.current((e as CustomEvent<Change[]>).detail);
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, [open]);
}
