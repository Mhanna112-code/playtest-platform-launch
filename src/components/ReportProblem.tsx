"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

/**
 * "Report a problem with this call" (the full app's fold, call-tools.tsx there): No-show / Late, a note, Send to the team.
 * Lean consequences unchanged (the no-show rules); one report per call. Once sent, the line says what was reported.
 */
export function ReportProblem({ path, callId, otherName, seenAt, reported }: { path: string; callId: string; otherName: string; seenAt: string; reported: { byMe: boolean; note: string } | null }) {
  const { press, changes, error, busy, finish } = usePress(seenAt);
  const [kind, setKind] = useState<"no_show" | "late">("no_show");
  const [note, setNote] = useState("");
  if (reported) {
    return (
      <p className="w-full rounded-lg border border-rose-400/25 bg-rose-400/[0.04] p-2.5 text-xs text-slate-200">
        <AlertTriangle className="mr-1 inline h-4 w-4 text-rose-300" />
        {reported.byMe ? `You reported that ${otherName}` : `${otherName} reported that you`} {reported.note.charAt(0).toLowerCase() + reported.note.slice(1)}{" "}
        <span className="text-amber-200">Problem reported to the team.</span>
      </p>
    );
  }
  return (
    <details className="w-full text-sm">
      <summary className="cursor-pointer text-rose-200"><AlertTriangle className="mr-1 inline h-4 w-4" />Report a problem with this call</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-4 text-slate-200">
          <label className="flex items-center gap-1.5"><input type="radio" name={`kind-${callId}`} checked={kind === "no_show"} onChange={() => setKind("no_show")} /> {otherName} didn&apos;t show up</label>
          <label className="flex items-center gap-1.5"><input type="radio" name={`kind-${callId}`} checked={kind === "late"} onChange={() => setKind("late")} /> {otherName} was late</label>
        </div>
        <textarea className="input min-h-14 text-sm" maxLength={1000} placeholder="What happened" aria-label="What happened" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={async () => { if (await press(path, { callId, kind, note })) finish(); }}>Send to the team</button>
        <ChangesBox changes={changes} error={error} />
        <p className="text-xs text-slate-400">The team looks at it with the call room&apos;s join times. One report per call.</p>
      </div>
    </details>
  );
}
