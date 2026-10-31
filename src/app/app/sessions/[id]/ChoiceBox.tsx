"use client";
import { refusalLine } from "@/lib/pressLabels";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { useState } from "react";
import { api, errOf, FIELD } from "@/lib/client";
import { money, toCents } from "@/lib/format";
import { CHARGE_TICK_CENTS, chargeTickLabel, letGoTickLabel } from "@/lib/rules";
import { stopBox, useStopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";
import { PressDone } from "@/components/PressDone";
import { useFinished } from "@/lib/usePress";

/**
 * Day 14 without a review: charge the developer (the lower of listing and asked, minus what's already been paid for this
 * part) or let it go. (Batch 16 section 39) Charge goes through on its own; above $200 it needs its tick. (Batch 32 §13) Let it go has its own tick instead of a pop-up. (Never shown when the part is paid in full.) (Batch 16 section 10) A mistake
 * is red at its box with the server's own line, and listed under the buttons.
 * (Batch 35 §40, §41) Once it goes through, the page redraws in place (the scroll stays here); until it has, only the pressed button (greyed) and its line show.
 */
export function ChoiceBox({ paused = false, sessionId, submissionId, callId, line, devName, cents, seenAt }: { paused?: boolean; sessionId: string; submissionId?: string; callId?: string; line: string; devName: string; cents: number; seenAt: string }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fin = useFinished(() => setBusy(false));
  const [ticked, setTicked] = useState(false);
  const [letGo, setLetGo] = useState(false);
  // (Batch 19 section 5) The stop box names the press that was made: "Your Let it go didn't go through." / "Your Charge didn't go through."
  const [pressed, setPressed] = useState<"Charge" | "Let it go">("Charge");
  const [amount, setAmount] = useState((cents / 100).toFixed(2));
  // (Batch 16 section 36) What will be charged: the typed amount rounded to the cent (the box shows it rounded once it's left).
  const typed = toCents(amount);
  // (Batch 16 section 39) No tick for ordinary amounts; above $200 the tick stays, required, naming the amount.
  const over = typed != null && typed > CHARGE_TICK_CENTS;
  const go = (choice: string) => {
    setPressed(choice === "letgo" ? "Let it go" : "Charge");
    setBusy(true);
    setErr("");
    api(`/api/sessions/${sessionId}/choose`, { ...(callId ? { callId } : { submissionId }), choice, amount, tickedCents: choice === "charge" && over && ticked ? typed : undefined, seenAt, confirmed, boxAt })
      .then(() => fin.finish(choice === "letgo" ? "You let it go." : `Charged ${devName} ${money(typed ?? cents)}.`))
      .catch((e) => {
        const sb = stopBox(e); if (sb) { setBox(sb); setBoxAt(sb.now); }
        else {
          // (Batch 32 §15) The second press went ahead and failed for another reason: the earlier stop box goes (only the refusal shows).
          setBox(null);
          setErr(errOf(e));
        }
        setBusy(false);
      });
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100" data-mistakes-root="">
      <p>{line}.</p>
      {/* (Owner, Oct 28 afternoon) Charge and Let it go both work while the test is paused; a Charge then may be paid later (never says why). */}
      {paused && <p className="note" data-paused-charge="">This test is paused right now. You can still charge or let it go; payment may be delayed until the test resumes.</p>}
      {fin.done ? (
        <div className="flex flex-wrap items-center gap-2" data-choice-done="">
          <button className={pressed === "Charge" ? "btn" : "btn-secondary"} disabled>{pressed === "Charge" ? `Charge ${devName} ${typed == null ? "" : money(typed)}` : "Let it go"}</button>
          <PressDone line={fin.line} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1">
            $ <input className="input w-24" inputMode="decimal" data-money="" aria-label="Amount to charge" id={`charge-${submissionId ?? callId}`} data-min="0.5" data-max={String(cents / 100)} data-msg="Enter an amount like 5.00." data-min-msg="The smallest card charge is $0.50." data-max-msg={`At most ${money(cents)}.`}
              data-match="amount like|at most|smallest card charge" value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); }} />
            <span className="note">(up to {money(cents)})</span>
          </label>
          {over && (
            <label data-charge-tick="">
              <input type="checkbox" checked={ticked} data-match="^Tick “Charge" onChange={(e) => setTicked(e.target.checked)} /> {chargeTickLabel(devName, typed!)}
            </label>
          )}
          <button className="btn" disabled={busy || typed == null || (over && !ticked)} onClick={(e) => checkFields(e.currentTarget.parentElement) && go("charge")}>{`Charge ${devName} ${typed == null ? "" : money(typed)}`}</button>
          {/* (Owner, Oct 30, batch 32 §13) No pop-up: a tick next to Let it go, which stays disabled until it's ticked. */}
          <label className="inline-flex items-center gap-1" data-letgo-tick="">
            <input type="checkbox" checked={letGo} onChange={(e) => setLetGo(e.target.checked)} /> {letGoTickLabel(devName)}
          </label>
          <button className="btn-secondary" disabled={busy || !letGo} onClick={() => go("letgo")}>Let it go</button>
        </div>
      )}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} didntGo press={pressed} />
      {/* (Batch 32 §12) Names the press ("Your Charge didn't go through: …"); "Answer the new terms first: Switch or Keep." reads exactly so. */}
      <Err text={err && !err.startsWith(FIELD) ? refusalLine(pressed, err) : ""} />
      <FormMistakes text={err.startsWith(FIELD) ? err : ""} press="Charge" />
    </div>
  );
}
