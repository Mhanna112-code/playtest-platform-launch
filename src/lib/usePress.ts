"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errOf } from "./client";
import { holdForRedraw, redrawLanded } from "./pageLock";
import type { Change } from "@/components/ChangesBox";
import { liveRuleOf, mergeChanges, useLiveAppend, type LiveRule } from "./live";
import { reloadKeepingPlace } from "./keepPlace";
import { useHoldOpen } from "@/components/HoldFold";
import { useCarried, useCarriedLive } from "./pressCarry";
import { offerStop } from "./topStop";

const NO_DATA: Record<string, unknown> = {};

/** How long a finished press's result line shows at least (the page's redraw may land sooner): the old reloads waited about as long. */
export const DONE_HOLD_MS = 900;
/** A press that must load the page again (`finish(line, { reload: true })`) shows its result line this long first. */
export const DONE_RELOAD_MS = 600;

/** When a finished press lets go of its box: once the redraw has landed and the result line has shown its time. Milliseconds from now (0: at once). */
export const releaseIn = (shownUntil: number, now = Date.now()) => Math.max(0, shownUntil - now);

/**
 * One way for every press that went through:
 * - Keep your place: the page redraws IN PLACE (router.refresh, the same redraw as the page's live poll, lib/liveSync.ts) instead of reloading, so the
 *   scroll stays at the part pressed in and a "#…" in the address is never jumped to again. Where a full reload is truly needed (`{ reload: true }`), it keeps
 *   the scroll and drops the stale "#…" first (lib/keepPlace.ts).
 * - A finished press stays finished: from `finish(line)` until the redraw has landed, `done` is true: the box's button stays greyed and disabled, its
 *   inputs (amount, note, tick) are hidden, and only the result line shows (`line`, e.g. "Paid $10.00 more to new@gmail.com."). No live-looking button flashes
 *   back before the page has its new state. Once the redraw lands the box lets go (`onFresh` empties its inputs): a Pay more that's still there is empty and
 *   can be pressed again.
 */
/** The app router, or null where none is mounted (a box drawn on its own: the server's static render, the tests). useRouter reads one context and then throws. */
function useAppRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function useFinished(onFresh?: () => void) {
  const router = useAppRouter();
  const [refreshing, startRefresh] = useTransition();
  const [line, setLine] = useState<string | null>(null);
  const waiting = useRef<{ until: number } | null>(null);
  const fresh = useRef(onFresh);
  useEffect(() => {
    fresh.current = onFresh;
  });
  useEffect(() => {
    const w = waiting.current;
    if (refreshing || !w) return;
    const release = () => {
      waiting.current = null;
      setLine(null);
      redrawLanded(); // the page's buttons come back once the redraw landed
      fresh.current?.();
    };
    const left = releaseIn(w.until);
    if (!left) return release();
    const t = setTimeout(release, left);
    return () => clearTimeout(t);
  }, [refreshing, line]);
  function finish(result = "", how: { reload?: boolean } = {}) {
    setLine(result);
    // Every button on the page waits for this redraw (or reload) too, after a press that locked the page.
    holdForRedraw();
    if (how.reload) {
      waiting.current = null; // the page loads again: the box stays finished until then
      setTimeout(() => reloadKeepingPlace(), result ? DONE_RELOAD_MS : 0);
      return;
    }
    if (!router) return void setTimeout(() => reloadKeepingPlace(), result ? DONE_RELOAD_MS : 0);
    waiting.current = { until: Date.now() + (result ? DONE_HOLD_MS : 0) };
    startRefresh(() => router.refresh());
  }
  return { done: line !== null, line: line ?? "", finish };
}

/**
 * A panel's presses: sends the page's "seen" marker. If the server stops once, the box lists the changes directly under
 * the pressed button (its key) and the next press is sent as confirmed. A refusal shows in the same place.
 */
export function usePress(seenAt: string, onStop?: (data: Record<string, unknown>) => void, opts: { /** the redraw after a finished press landed: empty the box */ onFresh?: () => void; /** each key is its own press: another
  key's box never confirms (or merges into) this one, and pressing another key clears it */ perKey?: boolean;
  /** the button's part (lib/pressCarry.ts): a redraw that swaps this panel for a new one mid-press still shows the press's box or refusal (and its
   * "done" line) under the button of the panel shown now */ carry?: string } = {}) {
  const carry = opts.carry;
  const [changes, setChanges] = useCarried<Change[] | null>(carry, "changes", null);
  const [error, setError] = useCarried(carry, "error", "");
  const [busy, setBusy] = useCarried(carry, "busy", false);
  const [at, setAt] = useCarried(carry, "at", "");
  const [errData, setErrData] = useCarried<Record<string, unknown>>(carry, "errData", NO_DATA);
  // When the box last updated (the stop, or a line added live): the next press goes ahead only if nothing new
  // happened since.
  const [boxAt, setBoxAt] = useCarried(carry, "boxAt", "");
  // The rule the server built the box under: lines added live follow what the press is about under the Alerts as they are now (lib/live.ts ruleNow).
  const [rule, setRule] = useCarried<LiveRule | null>(carry, "liveRule", null);
  // (Owner, Dec 10 2026) Clear, then the new outcome: the box (or its one line) leaves the view the moment its button is pressed; it stays open meanwhile
  // (live lines still join it under its rule), and the press's outcome replaces it.
  const [hidden, setHidden] = useCarried(carry, "hidden", false);

  /**
   * Flow: sends the page's seen time; a second press (its box still open) sends `confirmed` and the box's time (`boxAt`). The server answers in the owner's
   * order: a refusal (blue, `error`) → the stop-once box (`changes`, and its rule for lines added live) → a red mistake (`error` with the FIELD mark) → the
   * result (its note shows under the button).
   */
  async function press<T>(path: string, body: Record<string, unknown> = {}, key = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setErrData(NO_DATA);
    setAt(key);
    // With `perKey`, only this key's own box makes this press its second one.
    const again = changes != null && (!opts.perKey || key === at);
    if (!again && opts.perKey) setChanges(null);
    // (Owner, Dec 10 2026) Clear, then the new outcome: the line (or box) under the button leaves the view the moment it is pressed; a second press still goes
    // ahead (`again` and the box's time).
    setHidden(true);
    try {
      const r = await api<T>(path, { ...body, seenAt, confirmed: again || body.confirmed === true, ...(again && boxAt ? { boxAt } : {}) });
      setChanges(null);
      setHidden(false);
      const note = (r as { note?: unknown } | null)?.note;
      if (typeof note === "string") setError(note); // shown under the button (blue)
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        // A stop after a stop adds its new lines to the box.
        setChanges((c) => (c && again ? mergeChanges(c, (e.data.changes as Change[]) ?? []) : ((e.data.changes as Change[]) ?? [])));
        if (typeof e.data.now === "string") setBoxAt(e.data.now);
        setRule(liveRuleOf(e.data));
        offerStop(e.data); // (Owner, Dec 10 2026) new terms named (Rate): the offer loads at once
        onStop?.(e.data);
      } else {
        setChanges(null);
        setError(errOf(e));
        setErrData(e instanceof ApiError ? e.data : {});
      }
      return null;
    } finally {
      setHidden(false);
      setBusy(false);
    }
  }
  // The open box stays live: changes the page picks up meanwhile are added to it. Only those its rule keeps: a line left out never moves boxAt.
  useLiveAppend(changes != null, (added) => {
    setChanges((c) => (c ? mergeChanges(c, added) : c));
    const newest = added.map((a) => a.at).sort().pop();
    if (newest) setBoxAt((b) => (b && b > newest ? b : newest));
  }, rule);
  // A press that went through: `finish(line)` redraws the page in place; until it has, the panel stays busy (its buttons greyed) and `done`.
  const fin = useFinished(opts.onFresh);
  // A press whose panel was swapped meanwhile finishes in the panel shown now.
  const shown = useCarriedLive(carry, fin);
  const finish: typeof fin.finish = (...a) => shown().finish(...a);
  // A press under way, its stop box or its refusal keeps the Needs you drop-downs around it open (outside one: nothing).
  useHoldOpen(busy || fin.done || changes != null || !!error);
  /** Another button opened its panel or dialog: the box (and refusal) under the earlier press goes. */
  const clear = () => {
    setChanges(null);
    setHidden(false);
    setError("");
    setAt("");
  };
  return { press, changes: hidden ? null : changes, setChanges, error, busy: busy || fin.done, setError, at, errData, done: fin.done, doneLine: fin.line, finish, clear };
}
