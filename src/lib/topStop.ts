"use client";
import { ApiError, isFieldError } from "./client";
import { useCarried } from "./pressCarry";
import { liveRuleOf, mergeChanges, useLiveAppend, type LiveRule } from "./live";
import type { Change } from "@/components/ChangesBox";

export type StopBox = { changes: Change[]; tail: string; top: boolean; now: string; /** the rule the server built it under: lines added live follow what the press is about under the Alerts as they are now (lib/live.ts ruleNow) */ rule?: LiveRule | null };

/**
 * A stop-once refusal from the server. It shows under the pressed button (the one line on a page whose top box takes its changes, lib/stopLine.ts; else the
 * box), scrolled into view the "nearest" way.
 * (Owner, Dec 10 2026; replaces "the page scrolls UP to the offer box, which shows the line there") A stop naming new terms (top = true: Switch / Keep's own
 * "changed the terms again", or Leave's / Rate's) shows under its own button too, and the page never moves: the offer loads at once (offerStop).
 */
export function stopBox(e: unknown): StopBox | null {
  if (!(e instanceof ApiError && e.code === "stop_once")) return null;
  // "now": when the box was made; the next press sends it as boxAt and goes ahead only if nothing new happened since.
  const box = { changes: (e.data.changes as Change[]) ?? [], tail: String(e.data.tail ?? "Press again to go ahead."), top: e.data.top === true, now: typeof e.data.now === "string" ? e.data.now : new Date().toISOString(), rule: liveRuleOf(e.data) };
  offerStop(e.data);
  return box;
}

/** (Owner, Dec 10 2026) The page event a stop naming new terms sends: the session page's Switch / Keep (TesterTop) loads the offer at once if it doesn't show it. */
export const OFFER_LOAD_EVENT = "tester-top";
/** (Owner, Dec 10 2026) A stop that names new terms (`top`): the offer loads at once (no box moves up there, and the page doesn't scroll). Every stop on the page
 * calls it (stopBox, usePress, useStopOnce). */
export function offerStop(data: Record<string, unknown> | undefined) {
  if (data?.top === true && typeof window !== "undefined") window.dispatchEvent(new Event(OFFER_LOAD_EVENT));
}

/**
 * A press refused (pressing again can't help: paused, part over, closed …), never a form mistake (red, 400), a "too fast" or a server
 * error (pressing again can help): one press ends in one outcome, so a stop-once box still open under that button goes with it.
 */
export const pressRefusal = (e: unknown) => e instanceof ApiError && e.code !== "stop_once" && !isFieldError(e) && e.status < 500 && e.status !== 429;

/**
 * A panel's stop box that stays live while open: changes the page picks up meanwhile are added to it. `carry`: kept by the button's part, so a redraw
 * that swaps the panel for a new one mid-press still shows the box under the button (lib/pressCarry.ts).
 */
export function useStopBox(carry?: string) {
  const [box, setBox] = useCarried<StopBox | null>(carry, "stopBox", null);
  useLiveAppend(box != null, (added) => setBox((b) => (b ? { ...b, changes: mergeChanges(b.changes, added) } : b)), box?.rule);
  return [box, setBox] as const;
}
