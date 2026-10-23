"use client";
import { useState } from "react";
import { api, ApiError, errOf } from "./client";
import type { Change } from "@/components/ChangesBox";
import { mergeChanges, useLiveAppend } from "./live";

/**
 * A panel's presses: sends the page's "seen" marker. If the server stops once, the box lists the changes directly under
 * the pressed button (its key) and the next press is sent as confirmed. A refusal shows in the same place.
 */
export function usePress(seenAt: string, onStop?: (data: Record<string, unknown>) => void, opts: { once?: boolean } = {}) {
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
  return { press, changes, error, busy, setError, at, errData };
}
