"use client";
import { useState } from "react";
import { alertLabel } from "@/lib/alerts";
import { api } from "@/lib/client";

/**
 * (Design doc 6) Under a developer's stop box: how to stop being stopped for what is listed ("You can turn these stops off in Alerts on the test
 * page": batch 15 section 26 kept the developer's Alerts in the overview's button row, and Edit has it too), with a quick "Don't stop me for:" button per update type in the box.
 */
export function QuickIgnore({ alerts }: { alerts: string[] }) {
  const [done, setDone] = useState<string[]>([]);
  if (!alerts.length) return null;
  const off = (k: string) => api("/api/account/alerts/add", { key: k }).then(() => setDone((d) => [...d, k])).catch(() => null);
  return (
    <div className="mt-1 space-y-1 text-xs text-sky-200/90" data-quick-ignore="">
      <p>You can turn these stops off in Alerts on the test page.</p>
      <p className="flex flex-wrap items-center gap-1.5">Don&apos;t stop me for:
        {alerts.map((k) => (
          <button key={k} type="button" className="btn-ghost !rounded-md !px-2 !py-0.5 text-xs" disabled={done.includes(k)} onClick={() => void off(k)}>{done.includes(k) ? `${alertLabel(k)} (off)` : alertLabel(k)}</button>
        ))}
      </p>
    </div>
  );
}

/** (Batch 15 sections 26 and 44) Under a tester's stop box: the quick "Turn off alerts" (new terms from the developer and a key marked as working still stop: CONTRACT_KINDS). */
export function TesterAlertsOff({ show }: { show: boolean }) {
  const [done, setDone] = useState(false);
  if (!show) return null;
  return (
    <div className="mt-1 space-y-1 text-xs text-sky-200/90" data-quick-alerts-off="">
      <p>You can turn these stops off below, or with Alerts at the top of your test&apos;s page. New terms from the developer and a key marked as working still stop.</p>
      <button type="button" className="btn-ghost !rounded-md !px-2 !py-0.5 text-xs" disabled={done} onClick={() => void api("/api/account/tester-alerts", { off: true }).then(() => { setDone(true); window.dispatchEvent(new CustomEvent("tester-alerts", { detail: { off: true } })); }).catch(() => null)}>{done ? "Alerts are off" : "Turn off alerts"}</button>
    </div>
  );
}
