"use client";
import { useState } from "react";
import { api } from "@/lib/client";

/** Day 14 without a review: charge the developer (listing, or the asked amount if lower) or let it go. */
export function ChoiceBox({ sessionId, submissionId, line, by }: { sessionId: string; submissionId: string; line: string; by: string }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = (choice: string) => {
    setBusy(true);
    api(`/api/sessions/${sessionId}/choose`, { submissionId, choice }).then(() => window.location.reload()).catch((e) => { setErr((e as Error).message); setBusy(false); });
  };
  const [charge] = line.match(/charge \$[\d.,]+/) ?? ["charge"];
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{line}.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy} onClick={() => go("charge")}>{charge.replace(/^charge/, "Charge")}</button>
        <button className="btn-ghost" disabled={busy} onClick={() => go("letgo")}>Let it go</button>
      </div>
      <p className="note">If you don&apos;t choose by {by}, it&apos;s charged automatically.</p>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
