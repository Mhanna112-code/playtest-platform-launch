"use client";
import { useState } from "react";
import { PressButton } from "@/components/PressButton";

/** "How long was the call?": sets the Pay box reference (rate × these minutes) and its starting amount. */
export function CallLength({ testId, callId, minutes, seenAt }: { testId: string; callId: string; minutes: number; seenAt: string }) {
  const [v, setV] = useState(String(minutes));
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <div>
        <label className="label" htmlFor={`len-${callId}`}>How long was the call?</label>
        <input id={`len-${callId}`} className="input w-24" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} /> min
      </div>
      <PressButton seenAt={seenAt} path={`/api/tests/${testId}/call-length`} body={{ callId, minutes: Number(v) }}>Save the length</PressButton>
    </div>
  );
}
