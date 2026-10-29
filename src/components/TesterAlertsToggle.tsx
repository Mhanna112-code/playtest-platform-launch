"use client";
import { useEffect, useState } from "react";
import { BellOff, Bell } from "lucide-react";
import { api } from "@/lib/client";
import { publishTesterAlertsOff, setTesterAlertsOff, useTesterAlertsOff } from "@/lib/testerAlerts";

/**
 * (Owner, Oct 30, batch 15 section 26) The tester's one-press Alerts, at the top right of the session page, saved per tester for all their tests.
 * On: a button stops once when something changed since the page opened. Off: only new terms from the developer and their key marked working stop it; every other
 * change still shows in the live box, greyed. (Owner, Oct 28, batch 16 section 4) The grey line under the button says what stops a press, for the state shown.
 */
export const ALERTS_ON_LINE = "Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs.";
export const ALERTS_OFF_LINE = "Stops a press only for: new terms, your key marked as working.";
export function TesterAlertsToggle({ off: start }: { off: boolean }) {
  // (Batch 20 section 8) The one shared setting: a box's "Turn off alerts", another tab or the page's poll changes it here at once.
  const off = useTesterAlertsOff(start);
  const [err, setErr] = useState("");
  // (Batch 17 section 13) The stop boxes on this page know the state shown here.
  useEffect(() => setTesterAlertsOff(off), [off]);
  async function flip() {
    setErr("");
    try {
      const r = await api<{ off: boolean }>("/api/account/tester-alerts", { off: !off });
      publishTesterAlertsOff(typeof r.off === "boolean" ? r.off : !off);
    } catch {
      setErr("Couldn't save. Try again.");
    }
  }
  return (
    <div className="flex max-w-xs flex-col items-end gap-1 text-right max-sm:items-start max-sm:text-left" data-tester-alerts={off ? "off" : "on"}>
      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" aria-pressed={!off} onClick={() => void flip()}>
        {off ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />} Alerts: {off ? "Off" : "On"}
      </button>
      <p className="text-xs text-slate-400" data-tester-alerts-line="">{off ? ALERTS_OFF_LINE : ALERTS_ON_LINE}</p>
      {err && <p className="text-xs text-rose-300">{err}</p>}
    </div>
  );
}
