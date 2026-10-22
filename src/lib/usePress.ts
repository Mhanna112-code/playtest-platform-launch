"use client";
import { useState } from "react";
import { api, ApiError } from "./client";
import type { Change } from "@/components/ChangesBox";

/**
 * A panel's presses: sends the page's "seen" marker. If the server stops once, the box lists the changes and the next
 * press in this panel is sent as confirmed. A refusal shows its plain sentence in the same place.
 */
export function usePress(seenAt: string) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function press<T>(path: string, body: Record<string, unknown> = {}): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const r = await api<T>(path, { ...body, seenAt, confirmed: changes != null });
      setChanges(null);
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setChanges((e.data.changes as Change[]) ?? []);
      } else {
        setChanges(null);
        setError((e as Error).message);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { press, changes, error, busy, setError };
}
