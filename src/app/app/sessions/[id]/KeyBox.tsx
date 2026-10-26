"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

/** (Design doc 8) The tester's access key, with "This key doesn't work" (the developer is told; a free extra replaces it). */
export function KeyBox({ sessionId, seenAt, value, broken, fresh }: { sessionId: string; seenAt: string; value: string; broken: boolean; fresh?: boolean }) {
  const { press, error, busy, changes } = usePress(seenAt);
  const [said, setSaid] = useState(false);
  return (
    <div className="space-y-1.5 text-sm" id="access-key">
      <p className="flex flex-wrap items-center gap-2 text-white">
        <KeyRound className="h-4 w-4 text-amber-300" /> <strong>Your access key:</strong>
        <code className={`rounded bg-white/[0.06] px-2 py-0.5 font-mono ${broken || said ? "text-slate-500 line-through" : "text-amber-100"}`}>{value}</code>
        {broken || said ? (
          <span className="text-slate-400">You said it doesn&apos;t work. The developer was told; a new key shows here once they add one.</span>
        ) : (
          <button className="btn-ghost px-3 py-1 text-xs" disabled={busy} onClick={() => void press<{ replaced?: boolean }>(`/api/sessions/${sessionId}/key-broken`, {}, "key").then((r) => { if (!r) return; if (r.replaced) window.location.reload(); else setSaid(true); })}>This key doesn&apos;t work</button>
        )}
      </p>
      {fresh && !broken && <p className="info" role="status">The developer gave you a new access key.</p>}
      {changes == null && error && <p className="info" role="status">{error}</p>}
      <ChangesBox changes={changes} />
    </div>
  );
}
