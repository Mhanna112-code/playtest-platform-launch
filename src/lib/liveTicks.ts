"use client";
import { useEffect } from "react";

/**
 * (Owner, Nov 5, §278) A tick list's ticks that are still rows on the page, in tick order. A ticked person whose row left the list (a tester who left, whose work
 * ended…) is never sent hidden: every press, "Select all" and count uses only these.
 */
export const liveTicks = (ticked: readonly string[], rows: readonly string[]) => ticked.filter((id) => rows.includes(id));

/** (§278) When the page redraws, ticks whose rows are gone are dropped (the same array when nothing went, so nothing redraws for it). */
export function useDropGoneTicks(rows: readonly string[], setTicked: (f: (now: string[]) => string[]) => void) {
  const key = rows.join("|");
  useEffect(() => {
    setTicked((now) => {
      const kept = liveTicks(now, rows);
      return kept.length === now.length ? now : kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
