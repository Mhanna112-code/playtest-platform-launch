"use client";
import { useEffect, useState } from "react";
import { BellOff, Bell } from "lucide-react";
import { api } from "@/lib/client";

/**
 * (Owner, Oct 30, batch 15 section 26) The tester's one-press Alerts, at the top right of the session page, saved per tester for all their tests.
 * On: a button stops once when something changed since the page opened. Off: only new terms from the developer (and their key marked working) stop it; every other
 * change still shows in the live box, greyed.
 */
export function TesterAlertsToggle({ off: start }: { off: boolean }) {
  const [off, setOff] = useState(start);
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => setOff(!!(e as CustomEvent<{ off: boolean }>).detail?.off);
    window.addEventListener("tester-alerts", on);
    return () => window.removeEventListener("tester-alerts", on);
  }, []);
  async function flip() {
    setErr("");
    try {
      await api("/api/account/tester-alerts", { off: !off });
      setOff(!off);
      window.dispatchEvent(new CustomEvent("tester-alerts", { detail: { off: !off } }));
    } catch {
      setErr("Couldn't save. Try again.");
    }
  }
  return (
    <div className="flex max-w-xs flex-col items-end gap-1 text-right max-sm:items-start max-sm:text-left" data-tester-alerts={off ? "off" : "on"}>
      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" aria-pressed={!off} onClick={() => void flip()}>
        {off ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />} Alerts: {off ? "Off" : "On"}
      </button>
      <p className="text-xs text-slate-400">On: a button stops once when something changed since you opened the page. Off: only new terms from the developer stop it.</p>
      {err && <p className="text-xs text-rose-300">{err}</p>}
    </div>
  );
}
