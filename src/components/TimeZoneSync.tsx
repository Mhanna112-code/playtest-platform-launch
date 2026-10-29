"use client";
import { useEffect } from "react";
import { api } from "@/lib/client";

/** (Batch 28 §4) The account's saved time zone for times a client component writes (the stop box); undefined (the browser's) when none is saved. */
export const savedZone = () => (typeof window !== "undefined" ? (window as unknown as { __savedTz?: string }).__savedTz || undefined : undefined);

/** (Owner, Oct 30, batch 15 section 11) One small call from the app layout whenever the browser's time zone differs from the one stored for the account. */
export function TimeZoneSync({ stored }: { stored: string }) {
  if (typeof window !== "undefined") (window as unknown as { __savedTz?: string }).__savedTz = stored;
  useEffect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return;
    }
    if (tz && tz !== stored) api("/api/account/timezone", { timeZone: tz }).catch(() => null);
  }, [stored]);
  return null;
}
