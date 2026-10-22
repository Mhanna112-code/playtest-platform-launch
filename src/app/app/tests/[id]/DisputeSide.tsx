"use client";
import { useState } from "react";
import { PressButton } from "@/components/PressButton";

/** The developer adds their side to a dispute, once. */
export function DisputeSide({ testId, disputeId, seenAt }: { testId: string; disputeId: string; seenAt: string }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={`side-${disputeId}`}>Add your side (once; the team reads both)</label>
      <textarea id={`side-${disputeId}`} rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)} />
      <PressButton seenAt={seenAt} path={`/api/tests/${testId}/dispute-side`} body={{ disputeId, text }}>Send your side</PressButton>
    </div>
  );
}
