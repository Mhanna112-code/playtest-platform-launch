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
