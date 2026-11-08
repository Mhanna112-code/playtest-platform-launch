"use client";
import { CharacterCount } from "@/components/CharacterCount";
import { useState } from "react";
import { PressButton } from "@/components/PressButton";
import { DraftTag, useKept } from "@/lib/useKept";
import { LIMITS } from "@/lib/limits";
import { lockText } from "@/lib/sendLock";

/** The developer adds their side to a dispute, once. (Owner, Oct 30, batch 15 section 27) Optional, never stopped, up to 2,000 characters with a counter (refused beyond, never cut). */
export function DisputeSide({ testId, disputeId, seenAt }: { testId: string; disputeId: string; seenAt: string }) {
  const [text, setText] = useState("");
  // (Batch 35 §41) Sent: the box and its counter go, the button stays greyed with its line until the page has redrawn (then the side shows on the page).
  const [sent, setSent] = useState(false);
  // (NEXT-UI 10) Dispute text typed and not sent is kept on the server ("Draft"; batch 35 §8: after signing in, with "Use saved").
  // (Owner, Nov 5, §261) While Send your side is going through, the box is read-only.
  const [sending, setSending] = useState(false);
  const keep = useKept(`dispute:side:${disputeId}`, { text }, text === "", (v) => setText(v.text ?? ""));
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={`side-${disputeId}`}>Add your side (optional, once; the team reads both)</label>
      {!sent && <textarea id={`side-${disputeId}`} rows={2} className="input" maxLength={LIMITS.devSide} value={text} onChange={(e) => setText(e.target.value)} {...lockText(sending)} />}
      {!sent && <CharacterCount value={text} min={10} max={LIMITS.devSide} required data-side-count="" />}
      <PressButton disabled={!text.trim() || text.length > LIMITS.devSide} seenAt={seenAt} path={`/api/tests/${testId}/dispute-side`} body={{ disputeId, text }} doneLine="Your side is sent to the team." onSending={setSending} onDone={async () => { setSent(true); await keep.clear(); }}>Send your side</PressButton>
      {!sent && keep.restored && text !== "" && <DraftTag kind="discard" onUseSaved={() => setText("")} />}
    </div>
  );
}
