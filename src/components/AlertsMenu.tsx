"use client";
import { useState } from "react";
import { BellOff } from "lucide-react";
import { ALERT_TYPES } from "@/lib/alerts";
import { api } from "@/lib/client";

/**
 * (Design doc 6) "Alerts": tick the update types that should NOT interrupt your buttons any more. They still show (greyed) in the live
 * box. A payment hold, a closed tester account, a stopped test and final refusals always stop.
 */
export function AlertsMenu({ ignored: start, keys }: { ignored: string[]; keys?: string[] }) {
  const [ignored, setIgnored] = useState<string[]>(start);
  const [saved, setSaved] = useState("");
  async function toggle(key: string, on: boolean) {
    const next = on ? [...ignored, key] : ignored.filter((x) => x !== key);
    setIgnored(next);
    await api("/api/account/alerts", { ignored: next }).then(() => setSaved("Saved."), () => setSaved("Couldn't save. Try again."));
  }
  return (
    <details className="relative" data-alerts-menu="">
      <summary className="btn-secondary cursor-pointer list-none px-3 py-1.5 text-sm"><BellOff className="h-4 w-4" /> Alerts{ignored.length ? ` (${ignored.length} off)` : ""}</summary>
      {/* On phones the button can sit at the left edge: the menu opens in the page under it instead of hanging off-screen. */}
      <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] max-sm:static max-sm:w-full max-sm:max-w-none space-y-1.5 rounded-2xl border border-white/15 bg-slate-900 p-3 text-sm shadow-2xl">
        <p className="text-xs text-slate-400">Tick what should <b>not</b> stop your buttons. A payment hold or pause, a closed tester account, a stopped test and final refusals always stop.</p>
        {/* (Batch 15 section 39) A paused or stopped test lists only the types that can still happen there; the other ticks are kept. */}
        {ALERT_TYPES.filter((a) => !keys || keys.includes(a.key)).map((a) => (
          <label key={a.key} className="flex cursor-pointer items-center gap-2 text-slate-200">
            <input type="checkbox" checked={ignored.includes(a.key)} onChange={(e) => void toggle(a.key, e.target.checked)} /> {a.label}
          </label>
        ))}
        {saved && <p className="text-xs text-emerald-300" role="status">{saved}</p>}
      </div>
    </details>
  );
}
