"use client";
import { useState } from "react";
import { api, ApiError, errOf } from "./client";
import type { Change } from "@/components/ChangesBox";

/**
 * A panel's presses: sends the page's "seen" marker. If the server stops once, the box lists the changes directly under
 * the pressed button (its key) and the next press is sent as confirmed. A refusal shows in the same place.
 */
export function usePress(seenAt: string, onStop?: (data: Record<string, unknown>) => void) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");

  async function press<T>(path: string, body: Record<string, unknown> = {}, key = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setAt(key);
    try {
      const r = await api<T>(path, { ...body, seenAt, confirmed: changes != null });
      setChanges(null);
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setChanges((e.data.changes as Change[]) ?? []);
        onStop?.(e.data);
      } else {
        setChanges(null);
        setError(errOf(e));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { press, changes, error, busy, setError, at };
}
