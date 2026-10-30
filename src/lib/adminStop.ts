"use client";
import { useState } from "react";
import { ApiError } from "./client";
import { mergeChanges } from "./live";
import type { Change } from "@/components/ChangesBox";

/** (Owner, Oct 30, batch 34 §1) The admin pages' stop box heading: "Since this page loaded:". */
export const ADMIN_STOP_HEADING = "Since this page loaded:";

/**
 * (Batch 34 §1) An admin press's stop-once state, as the developer and tester presses keep theirs: another admin changed the same account, test, hold or outage since
 * the page loaded, so the press stopped once with the box (ChangesBox, under the button); the next press is sent confirmed with the box's time and goes ahead unless
 * something newer happened (then the box gets the new lines).
 */
export function useAdminStop() {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [boxAt, setBoxAt] = useState("");
  return {
    changes,
    /** What the next press adds: nothing, or (after a stop) `confirmed` and the box's time. */
    marks: (): Record<string, unknown> => (changes ? { confirmed: true, ...(boxAt ? { boxAt } : {}) } : {}),
    /** True when the error was the stop (the box now shows it). */
    caught: (e: unknown) => {
      if (!(e instanceof ApiError && e.code === "stop_once")) return false;
      const lines = (e.data.changes as Change[]) ?? [];
      setChanges((c) => (c ? mergeChanges(c, lines) : lines));
      if (typeof e.data.now === "string") setBoxAt(e.data.now);
      return true;
    },
    clear: () => setChanges(null),
  };
}
