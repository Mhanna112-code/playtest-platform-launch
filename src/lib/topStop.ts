"use client";
import { useState } from "react";
import { ApiError } from "./client";
import { mergeChanges, useLiveAppend } from "./live";
import type { Change } from "@/components/ChangesBox";

export type StopBox = { changes: Change[]; tail: string; top: boolean };

/**
 * A stop-once refusal from the server. When new terms are the reason, the page scrolls to the offer box at the top and
 * the line shows there (top = true); otherwise the box shows under the pressed button.
 */
export function stopBox(e: unknown): StopBox | null {
  if (!(e instanceof ApiError && e.code === "stop_once")) return null;
  const box = { changes: (e.data.changes as Change[]) ?? [], tail: String(e.data.tail ?? "Press again to go ahead."), top: e.data.top === true };
  if (box.top) {
    window.dispatchEvent(new CustomEvent("tester-top", { detail: box }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return box;
}

/** A panel's stop box that stays live while open: changes the page picks up meanwhile are added to it. */
export function useStopBox() {
  const [box, setBox] = useState<StopBox | null>(null);
  useLiveAppend(box != null, (added) => setBox((b) => (b ? { ...b, changes: mergeChanges(b.changes, added) } : b)));
  return [box, setBox] as const;
}
