"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { useRef, useState } from "react";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { NotSentTag, useKept } from "@/lib/useKept";
import { restoreDraft } from "@/lib/answerSets";
import { ConfirmButton } from "@/components/ConfirmButton";
import { qOptional, qText } from "@/lib/questions";
import { ChangesBox } from "@/components/ChangesBox";
import { ScrollText } from "@/components/ScrollText";
import { WRITTEN_MAX_CHARS, writtenLength } from "@/lib/rules";
import { wrapSelection } from "@/lib/markdown";

/** (Owner, Oct 29, batch 11) Bold, Italic and Code block for a written answer (stored as Markdown; the developer sees it formatted). */
function FormatBar({ target, onChange }: { target: React.RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void }) {
  const apply = (kind: "bold" | "italic" | "code") => {
    const el = target.current;
    if (!el) return;
    const r = wrapSelection(el.value, el.selectionStart, el.selectionEnd, kind);
    onChange(r.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  };
  return (
    <span className="flex gap-1" role="toolbar" aria-label="Formatting" data-format-bar="">
      <button type="button" className="btn-ghost px-2 py-0.5 text-xs font-bold" title="Bold" onClick={() => apply("bold")}>B</button>
      <button type="button" className="btn-ghost px-2 py-0.5 text-xs italic" title="Italic" onClick={() => apply("italic")}>I</button>
      <button type="button" className="btn-ghost px-2 py-0.5 font-mono text-xs" title="Code block" onClick={() => apply("code")}>{"</>"}</button>
    </span>
  );
}

/** One answer box with its formatting toolbar. */
function AnswerBox({ id, value, onChange, rows = 3 }: { id: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="space-y-1">
      <FormatBar target={ref} onChange={onChange} />
      <textarea ref={ref} id={id} rows={rows} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * Written answers: one box per question in the tester's contract. Can be updated until it's paid. `canSend` false (batch 10: the test is paused): the boxes stay and what is
 * typed is kept as a draft, but Send is hidden until the test resumes.
 */
export function WrittenForm({ sessionId, questions, initial, initialNotes, update, seenAt, canSend = true }: { sessionId: string; questions: string[]; initial: string[]; initialNotes: string; update: boolean; seenAt: string; canSend?: boolean }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [answers, setAnswers] = useState<string[]>(questions.map((_, i) => initial[i] ?? ""));
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // (NEXT-UI 10) Typed and not sent: kept on the server, back after a reload or on another device, with "Not sent yet".
  const same = answers.every((a, i) => a === (initial[i] ?? "")) && notes === initialNotes;
  // The draft says which questions it was typed for: after a switch to changed questions, an answer never lands under a different question.
  const [typedFor] = useState(questions); // the questions the boxes were made for (a refresh after a switch doesn't re-pair them)
  const keep = useKept(`written:${sessionId}`, { answers, notes, questions: typedFor }, same, (v) => {
    setAnswers(restoreDraft(questions, initial, v));
    setNotes(v.notes ?? initialNotes);
  });

  const length = writtenLength([...answers, notes]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    if (length > WRITTEN_MAX_CHARS) return setMsg({ ok: false, text: `Your written answers can be at most ${WRITTEN_MAX_CHARS.toLocaleString("en-US")} characters in all (now ${length.toLocaleString("en-US")}).` });
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/sessions/${sessionId}/written`, { answers, notes, seenAt, confirmed, boxAt });
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
          {/* (Batch 15 section 3) A long question sits in a scroll box about 6 lines tall. */}
          <label className={`label ${qOptional(q) ? "" : "req"}`} htmlFor={`a${i}`}><ScrollText text={qText(q)} label={`Question ${i + 1}`} />{qOptional(q) && <span className="ml-1 font-normal text-ink-500">· not required</span>}</label>
          <AnswerBox id={`a${i}`} value={answers[i]} onChange={(v) => setAnswers((all) => all.map((a, j) => (j === i ? v : a)))} />
        </div>
      ))}
      <div>
        <label className="label" htmlFor="notes">Anything else (bugs, ideas)</label>
        <AnswerBox id="notes" rows={2} value={notes} onChange={setNotes} />
      </div>
      {/* (Batch 11) (Batch 14) At most 50,000 characters for the whole written part, counted live. */}
      <p className={`text-xs ${length > WRITTEN_MAX_CHARS ? "text-rose-300" : "text-slate-500"}`} data-written-count="">{length.toLocaleString("en-US")} / {WRITTEN_MAX_CHARS.toLocaleString("en-US")}</p>
      <span>{canSend && <button className="btn" disabled={busy || length > WRITTEN_MAX_CHARS}>{busy ? "Sending…" : update ? "Send my updated answers" : "Send my answers"}</button>}{keep.restored && <NotSentTag />}</span>
      {!canSend && <p className="note" data-draft-kept="">Your answers are kept as a draft. Send comes back when the test resumes.</p>}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
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
      <ConfirmButton live className="btn-secondary px-3 py-1.5 text-sm text-rose-200" title={`Are you sure you want to leave “${title}”?`} confirmLabel="Leave this test" onConfirm={leave}
        body={(
          <ul className="list-disc space-y-1 pl-5">
            <li>What you already sent is still reviewed and paid as usual.</li>
            <li>The parts you haven&apos;t sent close with no pay. Calls ahead are cancelled.</li>
            <li>You can join again later while the test is open: your session comes back.</li>
          </ul>
        )}>
        Leave this test
      </ConfirmButton>
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} didntGo />
      <Err text={err ? `Your press didn't go through. ${err}` : ""} />
    </div>
  );
}

/** Dispute once, on any part the developer reviewed (batch 10). `limit`: how far a decision can raise the pay ("up to the listing amount", or the unlisted max). */
export function DisputeForm({ sessionId, kind, id, seenAt, disabledNote = "", limit = "up to the listing amount" }: { disabledNote?: string; sessionId: string; kind: "submission" | "call"; id: string; seenAt?: string; limit?: string }) {
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
      <p className="note">You can dispute this once. Our team decides; a decision can only raise the pay, {limit}.</p>
      <button
        className="btn"
        disabled={busy || !!disabledNote}
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
      {disabledNote && <p className="note" data-owed-note="">{disabledNote}</p>}
      {keep.restored && <NotSentTag />}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </details>
  );
}
