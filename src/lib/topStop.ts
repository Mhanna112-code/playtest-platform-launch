"use client";
import { useState } from "react";
import { ApiError } from "./client";
import { mergeChanges, useLiveAppend } from "./live";
import type { Change } from "@/components/ChangesBox";

export type StopBox = { changes: Change[]; tail: string; top: boolean; now: string };

/**
 * A stop-once refusal from the server. The box shows under the pressed button (a press never scrolls to the top box);
 * for new terms (top = true) the offer box at the top also shows the line, without scrolling there.
 */
export function stopBox(e: unknown): StopBox | null {
  if (!(e instanceof ApiError && e.code === "stop_once")) return null;
  // (Owner) "now": when the box was made; the next press sends it as boxAt and goes ahead only if nothing new happened since.
  const box = { changes: (e.data.changes as Change[]) ?? [], tail: String(e.data.tail ?? "Press again to go ahead."), top: e.data.top === true, now: typeof e.data.now === "string" ? e.data.now : new Date().toISOString() };
  if (box.top) {
    window.dispatchEvent(new CustomEvent("tester-top", { detail: box }));
  }
  return box;
}

/** A panel's stop box that stays live while open: changes the page picks up meanwhile are added to it. */
export function useStopBox() {
  const [box, setBox] = useState<StopBox | null>(null);
  useLiveAppend(box != null, (added) => setBox((b) => (b ? { ...b, changes: mergeChanges(b.changes, added) } : b)));
  return [box, setBox] as const;
}
