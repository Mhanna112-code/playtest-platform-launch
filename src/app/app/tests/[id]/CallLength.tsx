"use client";
import { useState } from "react";
import { api } from "@/lib/client";

/** "How long was the call?": sets the Pay box reference (rate × these minutes) and its starting amount. */
export function CallLength({ testId, callId, minutes }: { testId: string; callId: string; minutes: number }) {
  const [v, setV] = useState(String(minutes));
  const [err, setErr] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <div>
        <label className="label" htmlFor={`len-${callId}`}>How long was the call?</label>
        <input id={`len-${callId}`} className="input w-24" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} /> min
      </div>
      <button
        className="btn-ghost"
        onClick={() => api(`/api/tests/${testId}/call-length`, { callId, minutes: Number(v) }).then(() => window.location.reload()).catch((e) => setErr((e as Error).message))}
      >
        Save the length
      </button>
      {err && <p className="err basis-full">{err}</p>}
    </div>
  );
}
