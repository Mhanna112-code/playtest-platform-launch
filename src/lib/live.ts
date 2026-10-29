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
/**
 * (Owner, Oct 28, batch 16 section 38B) When this page first loaded in this tab (a refresh of its data never moves it), and the newest change a stop box under a button
 * has listed. A tester's press sends both: a call change stops it once even when the live box or a refresh already showed it, until a stop box has listed it.
 */
let loaded: { path: string; at: string } | null = null;
let boxSeenUpTo = "";
export function notePageLoaded(at: string) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (!loaded || loaded.path !== path) {
    loaded = { path, at };
    boxSeenUpTo = "";
  }
}
export const pageLoadedAt = () => (loaded && typeof window !== "undefined" && loaded.path === window.location.pathname ? loaded.at : "");
export const boxSeenAt = () => boxSeenUpTo;

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
  for (const c of lines) {
    shownInBox.add(ck(c));
    if (c.at > boxSeenUpTo) boxSeenUpTo = c.at;
  }
}
export const wasShownInBox = (c: Change) => shownInBox.has(ck(c));
/** Adds newly picked-up changes to an open box, skipping any it already lists. */
export function mergeChanges(old: Change[], added: Change[]) {
  // (Batch 20 section 4) A keyed line (one per ticked tester's needs) replaces the box's earlier line with that key: one line per tester, its latest time.
  const keys = new Set(added.map((c) => c.key).filter(Boolean));
  const kept = old.filter((c) => !c.key || !keys.has(c.key));
  const have = new Set(kept.map(ck));
  return [...kept, ...added.filter((c) => !have.has(ck(c)))];
}

/** While a stop box is open, new changes the page picks up are added to it. */
export function useLiveAppend(open: boolean, add: (added: Change[]) => void) {
  const cb = useRef(add);
  cb.current = add;
  useEffect(() => {
    if (!open) return;
    // (Batch 20 section 25) Quiet live-box lines (a tester's Switch, …) never join a stop box.
    const on = (e: Event) => {
      const added = ((e as CustomEvent<Change[]>).detail ?? []).filter((c) => !c.quiet);
      if (added.length) cb.current(added);
    };
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, [open]);
}
