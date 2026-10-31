"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errOf } from "./client";
import type { Change } from "@/components/ChangesBox";
import { mergeChanges, useLiveAppend } from "./live";
import { reloadKeepingPlace } from "./keepPlace";

/** (Batch 35 §41) How long a finished press's result line shows at least (the page's redraw may land sooner): the old reloads waited about as long. */
export const DONE_HOLD_MS = 900;
/** (Batch 35 §41) A press that must load the page again (`finish(line, { reload: true })`) shows its result line this long first. */
export const DONE_RELOAD_MS = 600;

/** When a finished press lets go of its box: once the redraw has landed and the result line has shown its time. Milliseconds from now (0: at once). */
export const releaseIn = (shownUntil: number, now = Date.now()) => Math.max(0, shownUntil - now);

/**
 * (Owner, Oct 31, batch 35 §40, §41) One way for every press that went through:
 * - §40 Keep your place: the page redraws IN PLACE (router.refresh, the same redraw as the page's live poll, lib/liveSync.ts §37) instead of reloading, so the
 *   scroll stays at the part pressed in and a "#…" in the address is never jumped to again. Where a full reload is truly needed (`{ reload: true }`), it keeps
 *   the scroll and drops the stale "#…" first (lib/keepPlace.ts).
 * - §41 A finished press stays finished: from `finish(line)` until the redraw has landed, `done` is true: the box's button stays greyed and disabled, its
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
      fresh.current?.();
    };
    const left = releaseIn(w.until);
    if (!left) return release();
    const t = setTimeout(release, left);
    return () => clearTimeout(t);
  }, [refreshing, line]);
  function finish(result = "", how: { reload?: boolean } = {}) {
    setLine(result);
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
export function usePress(seenAt: string, onStop?: (data: Record<string, unknown>) => void, opts: { once?: boolean; /** (batch 35 §41) the redraw after a finished press landed: empty the box */ onFresh?: () => void } = {}) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const [errData, setErrData] = useState<Record<string, unknown>>({});
  // (Owner) When the box last updated (the stop, or a line added live): the next press goes ahead only if nothing new
  // happened since. Leave and Block (opts.once) still stop just once.
  const [boxAt, setBoxAt] = useState("");

  async function press<T>(path: string, body: Record<string, unknown> = {}, key = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setErrData({});
    setAt(key);
    try {
      const r = await api<T>(path, { ...body, seenAt, confirmed: changes != null || body.confirmed === true, ...(changes != null && !opts.once && boxAt ? { boxAt } : {}) });
      setChanges(null);
      const note = (r as { note?: unknown } | null)?.note;
      if (typeof note === "string") setError(note); // shown under the button (blue)
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        // A stop after a stop adds its new lines to the box.
        setChanges((c) => (c ? mergeChanges(c, (e.data.changes as Change[]) ?? []) : ((e.data.changes as Change[]) ?? [])));
        if (typeof e.data.now === "string") setBoxAt(e.data.now);
        onStop?.(e.data);
      } else {
        setChanges(null);
        setError(errOf(e));
        setErrData(e instanceof ApiError ? e.data : {});
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  // The open box stays live: changes the page picks up meanwhile are added to it.
  useLiveAppend(changes != null, (added) => {
    setChanges((c) => (c ? mergeChanges(c, added) : c));
    const newest = added.map((a) => a.at).sort().pop();
    if (newest) setBoxAt((b) => (b && b > newest ? b : newest));
  });
  // (Batch 35 §40, §41) A press that went through: `finish(line)` redraws the page in place; until it has, the panel stays busy (its buttons greyed) and `done`.
  const fin = useFinished(opts.onFresh);
  return { press, changes, setChanges, error, busy: busy || fin.done, setError, at, errData, done: fin.done, doneLine: fin.line, finish: fin.finish };
}
