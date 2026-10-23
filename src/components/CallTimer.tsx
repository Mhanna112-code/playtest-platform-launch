"use client";
// The full app's call clock (components/call-timer.tsx there), counted from the booked start (the call runs in an outside
// video room). Shows "starts in N min", then "N of M covered minutes" with a bar, and a reminder 5 minutes before the
// covered time runs out and when it does. Lean rule: the covered time is 150% of the booked length (the most the
// developer can log); past it, the extra time isn't paid.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Timer, X } from "lucide-react";

const MINUTE = 60_000;

export function CallTimer({ startsAt, minutes, role, label = "Live call" }: { startsAt: string; minutes: number; role: "tester" | "developer"; label?: string }) {
  const start = new Date(startsAt).getTime();
  const covered = Math.floor(minutes * 1.5);
  const [now, setNow] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState("");

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // The call is usually in another tab: the tab title says it too.
  const minutesIn = now == null ? null : Math.floor((now - start) / MINUTE);
  const alert = minutesIn == null || minutesIn < covered - 5 || minutesIn > covered * 2 ? "" : minutesIn < covered ? `⏰ ${covered - minutesIn} min of covered time left` : "⏰ Covered time is up";
  useEffect(() => {
    if (!alert) return;
    const before = document.title;
    document.title = alert;
    return () => {
      document.title = before;
    };
  }, [alert]);

  if (now == null) return null;
  const elapsed = Math.floor((now - start) / MINUTE);
  // Shown from 15 minutes before until well after the covered time (calls can run long).
  if (now < start - 15 * MINUTE || elapsed > covered * 2) return null;

  const stage = elapsed < 0 ? "soon" : elapsed < covered - 5 ? "running" : elapsed < covered ? "ending" : "over";
  const pct = Math.min(100, Math.max(0, (elapsed / covered) * 100));
  const popup =
    stage === "ending"
      ? {
          key: "ending",
          title: `${covered - elapsed} minute${covered - elapsed === 1 ? "" : "s"} of covered time left`,
          text: role === "tester" ? `The booking covers up to ${covered} minutes. Past that, the extra time isn't paid.` : `You can log up to ${covered} minutes for this call. Past that, the extra time isn't paid.`,
        }
      : stage === "over"
        ? {
            key: "over",
            title: "Covered time is up",
            text: role === "tester" ? "You can keep going, but the extra time isn't paid." : `You can keep going; you can log up to ${covered} minutes when you enter the call's length.`,
          }
        : null;

  return (
    <>
      <div data-call-timer="" className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${stage === "over" ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-sky-300/30 bg-sky-400/[0.06] text-sky-100"}`}>
        <Timer className="h-4 w-4" />
        <span className="font-medium">{label}:</span>
        {stage === "soon" ? (
          <span>starts in {-elapsed} min</span>
        ) : (
          <>
            <span className="font-mono">{elapsed} of {covered} covered minutes</span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10"><span className={`block h-full ${stage === "over" ? "bg-amber-300" : "bg-sky-300"}`} style={{ width: `${pct}%` }} /></span>
            {stage === "over" && <span>· overtime isn&apos;t paid</span>}
          </>
        )}
        <span className="text-xs opacity-70">(from the booked start time)</span>
      </div>
      {popup && dismissed !== popup.key &&
        createPortal(
          <div role="alert" className="fixed bottom-5 left-5 z-50 w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-amber-300/50 bg-ink-900/95 p-4 shadow-2xl backdrop-blur">
            <button type="button" onClick={() => setDismissed(popup.key)} className="absolute right-3 top-3 text-slate-500 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
            <p className="flex items-center gap-2 font-semibold text-white"><Timer className="h-5 w-5 text-amber-300" /> {popup.title}</p>
            <p className="mt-1 text-sm text-slate-300">{popup.text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
