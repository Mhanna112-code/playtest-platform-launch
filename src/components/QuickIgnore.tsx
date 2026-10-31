"use client";
import { useState } from "react";
import { alertLabel } from "@/lib/alerts";
import { api } from "@/lib/client";
import { alertsTestNow, publishIgnoredAlerts, publishTesterAlertsOff, setTesterAlertsOff, useIgnoredAlerts, useTesterAlertsOff } from "@/lib/testerAlerts";

/**
 * (Design doc 6) Under a developer's stop box: how to stop being stopped for what is listed ("You can turn these stops off in Alerts on the test
 * page": batch 15 section 26 kept the developer's Alerts in the overview's button row, and Edit has it too), with a quick "Don't stop me for:" button per update type in the box.
 */
export function QuickIgnore({ alerts }: { alerts: string[] }) {
  // (Batch 20 section 8) A chip reads the one shared setting: "(off)" while the type is ticked in Alerts (here, in another box, or in another tab), and back to
  // a press when it's un-ticked there.
  // (Owner, Oct 31, batch 35 §73) The chips save on this page's test (its Alerts are its own); a page with no test shows no chips.
  const testId = alertsTestNow();
  const done = useIgnoredAlerts(testId);
  if (!alerts.length) return null;
  const off = (k: string) => api<{ ignored?: string[] }>("/api/account/alerts/add", { testId, key: k }).then((r) => publishIgnoredAlerts(testId, Array.isArray(r.ignored) ? r.ignored : [...new Set([...done, k])])).catch(() => null);
  return (
    <div className="mt-1 space-y-1 text-xs text-sky-200/90" data-quick-ignore="">
      <p>You can turn these stops off in Alerts on the test page.</p>
      {testId && <p className="flex flex-wrap items-center gap-1.5">Don&apos;t stop me for:
        {alerts.map((k) => (
          <button key={k} type="button" className="btn-ghost !rounded-md !px-2 !py-0.5 text-xs" disabled={done.includes(k)} onClick={() => void off(k)}>{done.includes(k) ? `${alertLabel(k)} (off)` : alertLabel(k)}</button>
        ))}
      </p>}
    </div>
  );
}

/**
 * (Batch 15 sections 26 and 44) Under a tester's stop box: the quick "Turn off alerts" (new terms from the developer, a key marked as working and what they did in another tab still stop: ALERTS_OFF_KINDS).
 * (Owner, Oct 28, batch 17 section 13) With Alerts already Off, neither line shows (only "Press <button> again to go ahead." / the terms tail remain).
 */
export function TesterAlertsOff({ show, where }: { show: boolean; /** (Batch 30 §10) "join": the join page (no test page yet) */ where?: "join" }) {
  // (Batch 20 section 8) Pressed in this box: "Alerts are off" while they stay off; turned back On (the Alerts button, another tab) it offers the press again.
  const [pressed, setPressed] = useState(false);
  const off = useTesterAlertsOff();
  const done = pressed && off;
  if (!show || (off && !done)) return null;
  return (
    <div className="mt-1 space-y-1 text-xs text-sky-200/90" data-quick-alerts-off="">
      {/* (Batch 30 §10) The join page has no test page yet: Alerts is on the dashboard. */}
      <p>{where === "join" ? "You can turn these stops off below, or with Alerts on your dashboard." : "You can turn these stops off below, or with Alerts at the top of your test's page."} New terms from the developer, a key marked as working and what you did in another tab still stop.</p>
      <button type="button" className="btn-ghost !rounded-md !px-2 !py-0.5 text-xs" disabled={done} onClick={() => void api("/api/account/tester-alerts", { off: true }).then(() => { setPressed(true); setTesterAlertsOff(true); publishTesterAlertsOff(true); }).catch(() => null)}>{done ? "Alerts are off" : "Turn off alerts"}</button>
    </div>
  );
}
