"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { pressSeenAt } from "@/lib/live";

/**
 * (Owner bug, Nov 4, batch 35 §176) The dashboard's "Your bank wants you to confirm" box redraws on its own (its poll, a new row, a press elsewhere on the page), and
 * each redraw is a new server render time. The dashboard never shows a test's change lines (no top box, no pill), so a redraw shows none of them: its presses
 * (Confirm with your bank, Confirm all) count from when the dashboard FIRST loaded here, never from the latest redraw (batch 30's rule for pages whose redraws
 * show no change lines). Navigating back to the dashboard is a new load. Rows that appear after the load use the same time.
 */
const LoadedAt = createContext("");

export function KeepLoadTime({ at, children }: { at: string; children?: ReactNode }) {
  // The first render's time: a redraw (router.refresh) keeps this component, and its state, where it is.
  const [first] = useState(at);
  return <LoadedAt.Provider value={first}>{children}</LoadedAt.Provider>;
}

/** The seen marker a press under KeepLoadTime sends: the earlier of the page's first load and its render time (outside one: the render time, unchanged). */
export const useLoadTime = (seenAt: string) => keptSeenAt(seenAt, useContext(LoadedAt));
export const keptSeenAt = (seenAt: string, loadedAt: string) => (seenAt ? pressSeenAt(seenAt, loadedAt, "") : seenAt);
