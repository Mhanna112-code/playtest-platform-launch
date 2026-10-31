"use client";
import { useState } from "react";
import { PressButton } from "@/components/PressButton";
import { DraftTag, useKept } from "@/lib/useKept";
import { LIMITS } from "@/lib/limits";

/** The developer adds their side to a dispute, once. (Owner, Oct 30, batch 15 section 27) Optional, never stopped, up to 2,000 characters with a counter (refused beyond, never cut). */
export function DisputeSide({ testId, disputeId, seenAt }: { testId: string; disputeId: string; seenAt: string }) {
  const [text, setText] = useState("");
  // (Batch 35 §41) Sent: the box and its counter go, the button stays greyed with its line until the page has redrawn (then the side shows on the page).
  const [sent, setSent] = useState(false);
  // (NEXT-UI 10) Dispute text typed and not sent is kept on the server ("Draft"; batch 35 §8: after signing in, with "Use saved").
  const keep = useKept(`dispute:side:${disputeId}`, { text }, text === "", (v) => setText(v.text ?? ""));
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={`side-${disputeId}`}>Add your side (optional, once; the team reads both)</label>
      {!sent && <textarea id={`side-${disputeId}`} rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)} />}
      {!sent && <p className={`text-xs ${text.length > LIMITS.devSide ? "text-rose-300" : "text-slate-500"}`} data-side-count="">{text.length.toLocaleString("en-US")} / {LIMITS.devSide.toLocaleString("en-US")}</p>}
      <PressButton disabled={!text.trim() || text.length > LIMITS.devSide} seenAt={seenAt} path={`/api/tests/${testId}/dispute-side`} body={{ disputeId, text }} doneLine="Your side is sent to the team." onDone={async () => { setSent(true); await keep.clear(); }}>Send your side</PressButton>
      {!sent && keep.restored && text !== "" && <DraftTag kind="discard" onUseSaved={() => setText("")} />}
    </div>
  );
}
