"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { stopBox, type StopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";

/** Written answers: one box per question in the tester's contract. Can be updated until it's paid. */
export function WrittenForm({ sessionId, questions, initial, initialNotes, update, seenAt }: { sessionId: string; questions: string[]; initial: string[]; initialNotes: string; update: boolean; seenAt: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [box, setBox] = useState<StopBox | null>(null);
  const [answers, setAnswers] = useState<string[]>(questions.map((_, i) => initial[i] ?? ""));
  const [notes, setNotes] = useState(initialNotes);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/sessions/${sessionId}/written`, { answers, notes, ask, seenAt, confirmed });
      window.location.reload();
    } catch (err) {
      const sb = stopBox(err); if (sb) { setBox(sb); setConfirmed(true); }
      else setMsg({ ok: false, text: errOf(err) });
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={send}>
      {questions.map((q, i) => (
        <div key={i}>
          <label className="label req" htmlFor={`a${i}`}>{q}</label>
          <textarea id={`a${i}`} rows={3} className="input" value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
        </div>
      ))}
      <div>
        <label className="label" htmlFor="notes">Anything else (bugs, ideas)</label>
        <textarea id="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label className="block text-sm">Ask $ <input className="input inline w-24" inputMode="decimal" placeholder="optional" value={ask} onChange={(e) => setAsk(e.target.value)} /> for this</label>
      <button className="btn" disabled={busy}>{busy ? "Sending…" : update ? "Send the updated answers" : "Send my written answers"}</button>
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {msg && (msg.ok ? <p className="ok">{msg.text}</p> : <Err text={msg.text} />)}
    </form>
  );
}

export function LeaveButton({ sessionId, seenAt }: { sessionId: string; seenAt: string }) {
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const [box, setBox] = useState<StopBox | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-2">
      {!sure ? (
        <button className="btn-ghost" onClick={() => setSure(true)}>Leave the test</button>
      ) : (
        <div className="space-y-2 rounded-lg border border-rose-200 p-3">
          <p className="text-sm">Leave this test? Work you already sent is still reviewed and paid. Calls ahead are cancelled. You can&apos;t rejoin.</p>
          <button
            className="btn-danger"
            onClick={() =>
              api(`/api/sessions/${sessionId}/leave`, { seenAt, confirmed })
                .then(() => window.location.reload())
                .catch((e) => {
                  const sb = stopBox(e);
                  if (sb) {
                    setBox(sb);
                    setConfirmed(true);
                  } else setErr(errOf(e));
                })
            }
          >
            Leave the test
          </button>{" "}
          <button className="btn-ghost" onClick={() => setSure(false)}>Stay</button>
          <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
        </div>
      )}
      <Err text={err} />
    </div>
  );
}

/** Dispute once: only for a part in the contract paid below the listing amount. */
export function DisputeForm({ sessionId, kind, id, seenAt }: { sessionId: string; kind: "submission" | "call"; id: string; seenAt?: string }) {
  const [box, setBox] = useState<StopBox | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>Dispute the pay</button>;
  return (
    <div className="space-y-2">
      <label className="label req" htmlFor={`d-${id}`}>Why should the pay be higher? (the team and the developer read it)</label>
      <textarea id={`d-${id}`} rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="note">You can dispute this once. Our team decides; a decision can only raise the pay, up to the listing amount.</p>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await api(`/api/sessions/${sessionId}/dispute`, { kind, id, reason, seenAt, confirmed });
            window.location.reload();
          } catch (e) {
            const sb = stopBox(e);
            if (sb) {
              setBox(sb);
              setConfirmed(true);
            } else setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        Send the dispute
      </button>
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
