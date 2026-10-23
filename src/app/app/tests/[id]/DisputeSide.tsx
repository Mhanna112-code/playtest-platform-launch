"use client";
import { useState } from "react";
import { PressButton } from "@/components/PressButton";
import { NotSentTag, useKept } from "@/lib/useKept";

/** The developer adds their side to a dispute, once. */
export function DisputeSide({ testId, disputeId, seenAt }: { testId: string; disputeId: string; seenAt: string }) {
  const [text, setText] = useState("");
  // (NEXT-UI 10) Dispute text typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`dispute:side:${disputeId}`, { text }, text === "", (v) => setText(v.text ?? ""));
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={`side-${disputeId}`}>Add your side (once; the team reads both)</label>
      <textarea id={`side-${disputeId}`} rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)} />
      <PressButton seenAt={seenAt} path={`/api/tests/${testId}/dispute-side`} body={{ disputeId, text }} onDone={async () => { await keep.clear(); window.location.reload(); }}>Send your side</PressButton>
      {keep.restored && <NotSentTag />}
    </div>
  );
}
