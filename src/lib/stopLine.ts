"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { Change } from "@/components/ChangesBox";
import { markShownInBox } from "./live";

/**
 * (Owner, Dec 10 2026) "Replace the stop-once boxes everywhere with one line." On a page whose top updates box lists the same kind of change lines (the
 * tester's session page, the join page, the developer's test page: their LiveTop is drawn with `stopLines`), a press stopped once shows ONE blue line under
 * its button, "Your Send Answers didn't go through: check the updates at the top. Press again to go ahead.", and the changes the stop carried go into the top
 * box at once (whatever the Alerts, never twice). The next press goes ahead exactly as before (`confirmed` and the box's time: the server is unchanged).
 * Pages with no top box for those changes (Edit's Save, the account pages, Home, admin, the confirmation dialogs) keep their own box (ChangesBox drawn in full).
 */
export const STOP_LINE_TAIL = "check the updates at the top. Press again to go ahead.";
/** The one line under the pressed button, named as the refusal lines name the press (pressLabelOf / refusalLine): "Your Join didn't go through: …". */
export const stopLineText = (press: string) => `Your ${press && press !== "press" ? press : "press"} didn't go through: ${STOP_LINE_TAIL}`;

/** (Owner, Dec 10 2026) The page event that hands a stop's changes to the top box (LiveTop listens). */
export const TO_TOP_EVENT = "stop-to-top";

// The changes handed to the top box on this page (path): a top box drawn again in place (the session page's redraw) lists them too.
let handed: { path: string; lines: Change[] } = { path: "", lines: [] };
// How many top boxes drawn with `stopLines` are on the page now (the session page's box is drawn again in place on a redraw: a count, never a flag).
let pages = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
/** True while a top box that takes the stops' changes is on the page. */
export const stopLinesHere = () => pages > 0;
/** (Owner, Dec 10 2026) Called by LiveTop drawn with `stopLines`: while it is on the page, stop boxes under buttons show as the one line. */
export function useStopLinePage(on: boolean) {
  useEffect(() => {
    if (!on) return;
    pages++;
    emit();
    return () => {
      pages--;
      emit();
      // Left the page (no top box drawn again in its place within a moment): what was handed to it goes with it.
      setTimeout(() => {
        if (!pages) handed = { path: "", lines: [] };
      }, 1000);
    };
  }, [on]);
}
/** Whether the boxes under buttons on this page show as the one line (ChangesBox). Never on the server's render: a stop only comes after a press. */
export const useStopLines = () => useSyncExternalStore(subscribe, stopLinesHere, () => false);

const herePath = () => (typeof window === "undefined" ? "" : window.location.pathname);
/** The changes stops on this page handed to the top box so far (oldest first). */
export function handedToTop(): Change[] {
  return handed.path === herePath() ? handed.lines : [];
}
/**
 * (Owner, Dec 10 2026) A stop's changes go into the top box at once: seen like a box's lines (markShownInBox: the top box lists them quietly and every
 * press on the page counts them as listed), kept for a top box drawn again, and sent to the box shown now (TO_TOP_EVENT). The box skips lines it already has.
 */
export function sendToTop(changes: Change[]) {
  if (typeof window === "undefined") return;
  markShownInBox(changes);
  const path = herePath();
  handed = { path, lines: [...(handed.path === path ? handed.lines : []), ...changes].slice(-200) };
  if (changes.length) window.dispatchEvent(new CustomEvent(TO_TOP_EVENT, { detail: changes }));
}
/** Tests: a fresh page. */
export const resetStopLines = () => {
  handed = { path: "", lines: [] };
};
