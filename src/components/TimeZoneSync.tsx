"use client";
import { useEffect } from "react";
import { api } from "@/lib/client";

/** (Owner, Oct 30, batch 15 section 11) One small call from the app layout whenever the browser's time zone differs from the one stored for the account. */
export function TimeZoneSync({ stored }: { stored: string }) {
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
