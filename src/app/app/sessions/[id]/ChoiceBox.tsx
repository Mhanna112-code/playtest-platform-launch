"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { money } from "@/lib/format";
import { stopBox, type StopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";

/**
 * Day 14 without a review: charge the developer (the lower of listing and asked, minus what's already been paid for this
 * part) or let it go. Charge needs its tick; Let it go asks once in place. Nothing left to charge: only "Close it".
 */
export function ChoiceBox({ sessionId, submissionId, line, devName, cents, seenAt }: { sessionId: string; submissionId: string; line: string; devName: string; cents: number; seenAt: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [box, setBox] = useState<StopBox | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [confirmLetGo, setConfirmLetGo] = useState(false);
  const go = (choice: string) => {
    setBusy(true);
    api(`/api/sessions/${sessionId}/choose`, { submissionId, choice, tickedCents: choice === "charge" ? cents : undefined, seenAt, confirmed })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e); if (sb) { setBox(sb); setConfirmed(true); }
        else setErr((e as Error).message);
        setBusy(false);
      });
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{line}.</p>
      {cents === 0 ? (
        <button className="btn-ghost" disabled={busy} onClick={() => go("letgo")}>Close it</button>
      ) : confirmLetGo ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Close this with nothing more paid?</span>
          <button className="btn-ghost" disabled={busy} onClick={() => go("letgo")}>Yes, let it go</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirmLetGo(false)}>Keep it</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label>
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> charge {devName} {money(cents)} now
          </label>
          <button className="btn" disabled={busy || !ticked} onClick={() => go("charge")}>{`Charge ${devName} ${money(cents)}`}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirmLetGo(true)}>Let it go</button>
        </div>
      )}
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      {err && <p className="err">{err}</p>}
    </div>
  );
}
