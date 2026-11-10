"use client";
import { ApiError, isFieldError } from "./client";
import { useCarried } from "./pressCarry";
import { liveRuleOf, mergeChanges, useLiveAppend, type LiveRule } from "./live";
import type { Change } from "@/components/ChangesBox";

export type StopBox = { changes: Change[]; tail: string; top: boolean; now: string; /** (§373) the rule the server built it under: lines added live follow it */ rule?: LiveRule | null };

/**
 * A stop-once refusal from the server. The box shows under the pressed button, scrolled into view the "nearest" way.
 * (Owner's one exception, reason A) new terms (top = true): the page scrolls UP to the offer box (Switch / Keep), which shows
 * the line there.
 */
export function stopBox(e: unknown): StopBox | null {
  if (!(e instanceof ApiError && e.code === "stop_once")) return null;
  // (Owner) "now": when the box was made; the next press sends it as boxAt and goes ahead only if nothing new happened since.
  const box = { changes: (e.data.changes as Change[]) ?? [], tail: String(e.data.tail ?? "Press again to go ahead."), top: e.data.top === true, now: typeof e.data.now === "string" ? e.data.now : new Date().toISOString(), rule: liveRuleOf(e.data) };
  if (box.top) {
    window.dispatchEvent(new CustomEvent("tester-top", { detail: box }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return box;
}

/**
 * (Owner, Nov 11, §376) A press refused (pressing again can't help: paused, part over, closed …), never a form mistake (red, 400), a "too fast" or a server
 * error (pressing again can help): one press ends in one outcome, so a stop-once box still open under that button goes with it.
 */
export const pressRefusal = (e: unknown) => e instanceof ApiError && e.code !== "stop_once" && !isFieldError(e) && e.status < 500 && e.status !== 429;

/**
 * A panel's stop box that stays live while open: changes the page picks up meanwhile are added to it. (§371) `carry`: kept by the button's part, so a redraw
 * that swaps the panel for a new one mid-press still shows the box under the button (lib/pressCarry.ts).
 */
export function useStopBox(carry?: string) {
  const [box, setBox] = useCarried<StopBox | null>(carry, "stopBox", null);
  useLiveAppend(box != null, (added) => setBox((b) => (b ? { ...b, changes: mergeChanges(b.changes, added) } : b)), box?.rule);
  return [box, setBox] as const;
}
