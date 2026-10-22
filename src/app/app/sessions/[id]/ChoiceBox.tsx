"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { money, toCents } from "@/lib/format";
import { stopBox, type StopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";

/**
 * Day 14 without a review: charge the developer (the lower of listing and asked, minus what's already been paid for this
 * part) or let it go. Charge needs its tick; Let it go asks once in place. (Never shown when the part is paid in full.)
 */
export function ChoiceBox({ sessionId, submissionId, line, devName, cents, seenAt }: { sessionId: string; submissionId: string; line: string; devName: string; cents: number; seenAt: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [box, setBox] = useState<StopBox | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [confirmLetGo, setConfirmLetGo] = useState(false);
  const [amount, setAmount] = useState((cents / 100).toFixed(2));
  const typed = toCents(amount);
  const go = (choice: string) => {
    setBusy(true);
    api(`/api/sessions/${sessionId}/choose`, { submissionId, choice, amount, tickedCents: choice === "charge" && ticked ? typed : undefined, seenAt, confirmed })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e); if (sb) { setBox(sb); setConfirmed(true); }
        else setErr(errOf(e));
        setBusy(false);
      });
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{line}.</p>
      {confirmLetGo ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Close this with nothing more paid?</span>
          <button className="btn-ghost" disabled={busy} onClick={() => go("letgo")}>Yes, let it go</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirmLetGo(false)}>Keep it</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1">
            $ <input className="input w-24" inputMode="decimal" aria-label="Amount to charge" value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); }} />
            <span className="note">(up to {money(cents)})</span>
          </label>
          <label>
            <input type="checkbox" checked={ticked} disabled={typed == null} onChange={(e) => setTicked(e.target.checked)} /> charge {devName} {typed == null ? "–" : money(typed)} now
          </label>
          <button className="btn" disabled={busy || !ticked || typed == null} onClick={() => go("charge")}>{`Charge ${devName} ${typed == null ? "" : money(typed)}`}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirmLetGo(true)}>Let it go</button>
        </div>
      )}
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
