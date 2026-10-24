"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { NotSentTag, useKept } from "@/lib/useKept";
import { ConfirmButton } from "@/components/ConfirmButton";
import { qOptional, qText } from "@/lib/questions";
import { ChangesBox } from "@/components/ChangesBox";

/** Written answers: one box per question in the tester's contract. Can be updated until it's paid. */
export function WrittenForm({ sessionId, questions, initial, initialNotes, update, seenAt }: { sessionId: string; questions: string[]; initial: string[]; initialNotes: string; update: boolean; seenAt: string }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [answers, setAnswers] = useState<string[]>(questions.map((_, i) => initial[i] ?? ""));
  const [notes, setNotes] = useState(initialNotes);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // (NEXT-UI 10) Typed and not sent: kept on the server, back after a reload or on another device, with "Not sent yet".
  const same = answers.every((a, i) => a === (initial[i] ?? "")) && notes === initialNotes && ask === "";
  const keep = useKept(`written:${sessionId}`, { answers, notes, ask }, same, (v) => {
    setAnswers(questions.map((_, i) => v.answers?.[i] ?? initial[i] ?? ""));
    setNotes(v.notes ?? initialNotes);
    setAsk(v.ask ?? "");
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/sessions/${sessionId}/written`, { answers, notes, ask, seenAt, confirmed, boxAt });
      await keep.clear();
      window.location.reload();
    } catch (err) {
      const sb = stopBox(err); if (sb) { setBox(sb); setBoxAt(sb.now); }
      else setMsg({ ok: false, text: errOf(err) });
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={send}>
      {questions.map((q, i) => (
        <div key={i}>
          <label className={`label ${qOptional(q) ? "" : "req"}`} htmlFor={`a${i}`}>{qText(q)}{qOptional(q) && <span className="ml-1 font-normal text-ink-500">· not required</span>}</label>
          <textarea id={`a${i}`} rows={3} className="input" value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
        </div>
      ))}
      <div>
        <label className="label" htmlFor="notes">Anything else (bugs, ideas)</label>
        <textarea id="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label className="block text-sm">Ask $ <input className="input inline w-24" inputMode="decimal" placeholder="optional" aria-label="Ask for this" data-min="0" data-max="999999.99" data-msg="Ask $0 or more (Stripe can't take more than $999,999.99 in one charge)." value={ask} onChange={(e) => setAsk(e.target.value)} /> for this <span className="text-xs text-slate-500">at least $0</span></label>
      <span><button className="btn" disabled={busy}>{busy ? "Sending…" : update ? "Send the updated answers" : "Send my written answers"}</button>{keep.restored && <NotSentTag />}</span>
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {msg && (msg.ok ? <p className="ok">{msg.text}</p> : <Err text={msg.text} />)}
    </form>
  );
}

export function LeaveButton({ sessionId, seenAt, title }: { sessionId: string; seenAt: string; title: string }) {
  const [err, setErr] = useState("");
  const [box, setBox] = useStopBox();
  const [confirmed, setConfirmed] = useState(false);
  const leave = () =>
    api(`/api/sessions/${sessionId}/leave`, { seenAt, confirmed })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setConfirmed(true);
        } else setErr(errOf(e));
      });
  return (
    <div className="space-y-2">
      <ConfirmButton className="btn-secondary px-3 py-1.5 text-sm text-rose-200" title={`Are you sure you want to leave “${title}”?`} confirmLabel="Leave this test" onConfirm={leave}
        body={(
          <ul className="list-disc space-y-1 pl-5">
            <li>What you already sent is still reviewed and paid as usual.</li>
            <li>The parts you haven&apos;t sent close with no pay. Calls ahead are cancelled.</li>
            <li>You can join again later while the test is open: your session comes back.</li>
          </ul>
        )}>
        Leave this test
      </ConfirmButton>
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}

/** Dispute once: only for a part in the contract paid below the listing amount. */
export function DisputeForm({ sessionId, kind, id, seenAt }: { sessionId: string; kind: "submission" | "call"; id: string; seenAt?: string }) {
  const [box, setBox] = useStopBox();
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const keep = useKept(`dispute:${kind}:${id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  // The full app's fold (no separate mode): "Dispute the pay" opens the form in place.
  return (
    <details className="space-y-2">
      <summary className="cursor-pointer text-sm text-volt-300">Dispute the pay</summary>
      <label className="label req" htmlFor={`d-${id}`}>Why should the pay be higher? (the team and the developer read it)</label>
      <textarea id={`d-${id}`} rows={3} className="input" maxLength={2000} data-min-chars="10" data-msg="Say why you think the pay should be higher (at least a sentence)." value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-xs text-slate-500">10–2,000 characters</p>
      <p className="note">You can dispute this once. Our team decides; a decision can only raise the pay, up to the listing amount.</p>
      <button
        className="btn"
        disabled={busy}
        onClick={async (e) => {
          if (!checkFields(e.currentTarget.closest("details"))) return;
          setBusy(true);
          setErr("");
          try {
            await api(`/api/sessions/${sessionId}/dispute`, { kind, id, reason, seenAt, confirmed, boxAt });
            await keep.clear();
            window.location.reload();
          } catch (e) {
            const sb = stopBox(e);
            if (sb) {
              setBox(sb);
              setBoxAt(sb.now);
            } else setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        Send the dispute
      </button>
      {keep.restored && <NotSentTag />}
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </details>
  );
}
