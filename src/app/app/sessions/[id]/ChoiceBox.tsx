"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { money, toCents } from "@/lib/format";
import { stopBox, useStopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";

/**
 * Day 14 without a review: charge the developer (the lower of listing and asked, minus what's already been paid for this
 * part) or let it go. Charge needs its tick; Let it go asks once in place. (Never shown when the part is paid in full.)
 */
export function ChoiceBox({ sessionId, submissionId, line, devName, cents, seenAt }: { sessionId: string; submissionId: string; line: string; devName: string; cents: number; seenAt: string }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [amount, setAmount] = useState((cents / 100).toFixed(2));
  const typed = toCents(amount);
  const go = (choice: string) => {
    setBusy(true);
    api(`/api/sessions/${sessionId}/choose`, { submissionId, choice, amount, tickedCents: choice === "charge" && ticked ? typed : undefined, seenAt, confirmed, boxAt })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e); if (sb) { setBox(sb); setBoxAt(sb.now); }
        else setErr(errOf(e));
        setBusy(false);
      });
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      <p>{line}.</p>
      {(
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1">
            $ <input className="input w-24" inputMode="decimal" aria-label="Amount to charge" data-min="0.5" data-max={String(cents / 100)} data-msg={`Charge from $0.50 up to ${money(cents)}.`} value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); }} />
            <span className="note">(up to {money(cents)})</span>
          </label>
          <label>
            <input type="checkbox" checked={ticked} disabled={typed == null} onChange={(e) => setTicked(e.target.checked)} /> charge {devName} {typed == null ? "–" : money(typed)} now
          </label>
          <button className="btn" disabled={busy || !ticked || typed == null} onClick={(e) => checkFields(e.currentTarget.parentElement) && go("charge")}>{`Charge ${devName} ${typed == null ? "" : money(typed)}`}</button>
          <ConfirmButton className="btn-secondary" disabled={busy} title="Let it go?" confirmLabel="Let it go" onConfirm={() => go("letgo")}
            body={<p>This closes with nothing more paid.</p>}>
            Let it go
          </ConfirmButton>
        </div>
      )}
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
