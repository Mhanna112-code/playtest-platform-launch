"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/**
 * "Report <name>" on a profile (owner, Oct 27): a reason box and Send to the team. Once sent (one report per pair, ever) the button is replaced by
 * "You reported <name> on <date>." The only stop is a race check: already reported in another tab, a blue notice under the button.
 */
export function ReportButton({ userId, name, reportedOn }: { userId: string; name: string; reportedOn: string | null }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (reportedOn) return <p className="text-xs text-slate-400" data-reported="">You reported {name} on {reportedOn}.</p>;
  return (
    <div className="space-y-2">
      {!open ? (
        <button type="button" className="text-xs text-slate-500 hover:text-rose-200" onClick={() => setOpen(true)}>Report {name}</button>
      ) : (
        <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm" data-report-box="">
          <label className="label req" htmlFor={`report-${userId}`}>What happened? (the team reads it)</label>
          <textarea id={`report-${userId}`} rows={3} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr("");
                try {
                  await api("/api/reports", { userId, note });
                  window.location.reload();
                } catch (e) {
                  setErr(errOf(e));
                  setBusy(false);
                }
              }}
            >
              Send to the team
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <Err text={err} />
    </div>
  );
}
