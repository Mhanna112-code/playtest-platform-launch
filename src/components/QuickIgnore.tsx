"use client";
import { useState } from "react";
import { alertLabel } from "@/lib/alerts";
import { api } from "@/lib/client";

/**
 * (Design doc 6) Under a developer's stop box: how to stop being stopped for what is listed ("You can turn these stops off in Alerts, at the
 * top of the page"), with a quick "Don't stop me for:" button per update type in the box.
 */
export function QuickIgnore({ alerts }: { alerts: string[] }) {
  const [done, setDone] = useState<string[]>([]);
  if (!alerts.length) return null;
  const off = (k: string) => api("/api/account/alerts/add", { key: k }).then(() => setDone((d) => [...d, k])).catch(() => null);
  return (
    <div className="mt-1 space-y-1 text-xs text-sky-200/90" data-quick-ignore="">
      <p>You can turn these stops off in Alerts, at the top of the page.</p>
      <p className="flex flex-wrap items-center gap-1.5">Don&apos;t stop me for:
        {alerts.map((k) => (
          <button key={k} type="button" className="btn-ghost !rounded-md !px-2 !py-0.5 text-xs" disabled={done.includes(k)} onClick={() => void off(k)}>{done.includes(k) ? `${alertLabel(k)} (off)` : alertLabel(k)}</button>
        ))}
      </p>
    </div>
  );
}
