"use client";
import { useState } from "react";
import { api } from "@/lib/client";

/** The developer adds their side to a dispute, once. */
export function DisputeSide({ testId, disputeId }: { testId: string; disputeId: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={`side-${disputeId}`}>Add your side (once; the team reads both)</label>
      <textarea id={`side-${disputeId}`} rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)} />
      <button
        className="btn-ghost"
        onClick={() => api(`/api/tests/${testId}/dispute-side`, { disputeId, text }).then(() => window.location.reload()).catch((e) => setErr((e as Error).message))}
      >
        Send your side
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
