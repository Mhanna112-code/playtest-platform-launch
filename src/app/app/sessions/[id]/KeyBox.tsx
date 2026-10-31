"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";

/** (Design doc 8) The tester's access key, with "This key doesn't work" (the developer is told; a free extra replaces it). */
export function KeyBox({ sessionId, seenAt, value, broken, fresh, canReport = true, fixed = false }: { sessionId: string; seenAt: string; value: string; broken: boolean; fresh?: boolean; canReport?: boolean; fixed?: boolean }) {
  const { press, error, busy, changes, finish } = usePress(seenAt); // (batch 35 §40) a key replaced meanwhile: the page redraws in place
  const [said, setSaid] = useState(false);
  return (
    // (Batch 34 §12) The "gave you an access key" line's See it jumps here (KEY_BOX_ID, marked for a moment).
    <div className={`space-y-1.5 text-sm ${MARKABLE}`} id="access-key">
      <p className="flex flex-wrap items-center gap-2 text-white">
        <KeyRound className="h-4 w-4 text-amber-300" /> <strong>Your access key:</strong>
        <code className={`rounded bg-white/[0.06] px-2 py-0.5 font-mono ${broken || said ? "text-slate-500 line-through" : "text-amber-100"}`}>{value}</code>
        {broken || said ? (
          // (Owner, Oct 30, batch 15 sections 44 and 45) A report can't be undone by the tester; the developer can mark the key as working again.
          <span className="text-slate-400" data-key-state="broken">Marked as not working. The developer was told. They can send you another key in a message.</span>
        ) : !canReport ? null : (
          <button className="btn-ghost px-3 py-1 text-xs" disabled={busy} onClick={() => void press<{ replaced?: boolean }>(`/api/sessions/${sessionId}/key-broken`, {}, "key").then((r) => { if (!r) return; if (r.replaced) finish(); else setSaid(true); })}>This key doesn&apos;t work</button>
        )}
      </p>
      {fresh && !broken && <p className="info" role="status">The developer gave you a new access key.</p>}
      {fixed && !broken && !said && <p className="info" role="status" data-key-state="fixed">The developer marked your key as working. If it still fails, you can report it again.</p>}
      {changes == null && error && <p className="info" role="status">{error}</p>}
      <ChangesBox side="tester" changes={changes} />
    </div>
  );
}
