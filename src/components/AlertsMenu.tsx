"use client";
import { useState } from "react";
import { BellOff } from "lucide-react";
import { ALERT_TYPES } from "@/lib/alerts";

/** (Batch 16 section 21) The line under "Alerts". */
export const ALERTS_INTRO_REST = "stop your buttons. A payment hold or pause, a stopped test and final refusals always stop.";
import { api } from "@/lib/client";
import { publishIgnoredAlerts, useIgnoredAlerts } from "@/lib/testerAlerts";

/**
 * (Design doc 6) "Alerts": tick the update types that should NOT interrupt your buttons any more. They still show (greyed) in the live
 * box. A payment hold, a stopped test and final refusals always stop. (Batch 16 section 21) A stored tick for a type no longer in the menu (the old
 * "Your saves and presses in another tab") is ignored.
 */
export function AlertsMenu({ ignored: start, keys }: { ignored: string[]; keys?: string[] }) {
  // (Batch 20 section 8) The one shared setting: a stop box's "Don't stop me for" chip ticks it here at once (and in other tabs); un-ticking here turns the chip back.
  const shared = useIgnoredAlerts(start);
  const ignored = shared.filter((k) => ALERT_TYPES.some((a) => a.key === k));
  const [saved, setSaved] = useState("");
  async function toggle(key: string, on: boolean) {
    // One type at a time (the server adds or removes just it), so a menu drawn earlier never saves its old list over a chip's press.
    publishIgnoredAlerts(on ? [...new Set([...shared, key])] : shared.filter((x) => x !== key), false);
    await api<{ ignored: string[] }>("/api/account/alerts", { key, off: on }).then((r) => {
      publishIgnoredAlerts(r.ignored);
      setSaved("Saved.");
    }, () => {
      publishIgnoredAlerts(shared, false);
      setSaved("Couldn't save. Try again.");
    });
  }
  return (
    <details className="relative" data-alerts-menu="">
      <summary className="btn-secondary cursor-pointer list-none px-3 py-1.5 text-sm"><BellOff className="h-4 w-4" /> Alerts{ignored.length ? ` (${ignored.length} off)` : ""}</summary>
      {/* On phones the button can sit at the left edge: the menu opens in the page under it instead of hanging off-screen. */}
      <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] max-sm:static max-sm:w-full max-sm:max-w-none space-y-1.5 rounded-2xl border border-white/15 bg-slate-900 p-3 text-sm shadow-2xl">
        <p className="text-xs text-slate-400" data-alerts-intro="">Tick what should <b>not</b> {ALERTS_INTRO_REST}</p>
        {/* (Batch 15 section 39; owner, Oct 31, batch 35 §63) Every type is listed, so "(N off)" matches the ticks shown; a type that can't happen on a paused or
            stopped test is greyed and can't be changed there (its tick is kept). */}
        {ALERT_TYPES.map((a) => {
          const off = !!keys && !keys.includes(a.key);
          return (
            <label key={a.key} className={`flex items-center gap-2 ${off ? "cursor-default text-slate-500" : "cursor-pointer text-slate-200"}`} data-alert-na={off ? "" : undefined}>
              <input type="checkbox" checked={ignored.includes(a.key)} disabled={off} onChange={(e) => void toggle(a.key, e.target.checked)} /> {a.label}
            </label>
          );
        })}
        {saved && <p className="text-xs text-emerald-300" role="status">{saved}</p>}
      </div>
    </details>
  );
}
