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

/**
 * The seen marker a press sends: the page's render time, or later if the top notice has shown more. (Batch 30 §12 and the Oct 29 addition) A redraw of the page (a
 * refresh after a press, its poll, "You now meet this test's needs", a key marked working, new terms, a refused press) gives the page a newer render time but shows no
 * change lines: on a page that notes its first load (PageLoaded), the marker starts from that load and moves on only with what the top box actually showed.
 */
export function seenNow(pageSeenAt: string) {
  return pressSeenAt(pageSeenAt, pageLoadedAt(), shownUpTo);
}
/** (Batch 30) The rule itself: the earlier of the press's render time and the page's first load, moved on to what the top box showed. */
export function pressSeenAt(rendered: string, loadedAt: string, shown: string) {
  const base = loadedAt && loadedAt < rendered ? loadedAt : rendered;
  return shown && shown > base ? shown : base;
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
  // (Owner's finding, Oct 29, batch 32 §8) The same moment from two places reads as one line: the server's "This test was stopped at 3:22 PM." and the live
  // update's "This test was stopped" (shown "· 3:22 PM") within the same minute. The box keeps its own wording.
  const same = new Set(kept.map(sameMoment));
  return [...kept, ...added.filter((c) => !have.has(ck(c)) && !same.has(sameMoment(c)))];
}
/** A line's text without a closing " at 3:22 PM." (and its full stop), with its minute: two lines that say the same moment match. */
export function sameMoment(c: Change) {
  const base = c.text.replace(/ at \d{1,2}:\d{2}\s?[AP]M\.?$/, "").replace(/\.$/, "");
  return `${Math.floor(new Date(c.at).getTime() / 60_000)}|${base}`;
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
