"use client";
import { refusalLine } from "@/lib/pressLabels";
import { Err } from "@/components/Err";
import { FormMistakes } from "@/components/FormMistakes";
import { checkFields } from "@/components/FieldChecks";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errOf, FIELD, offerShown } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { DISCARD_ALL_LABEL, DraftTag, USE_SAVED_ALL_LABEL, useKept } from "@/lib/useKept";
import { restoreDraft } from "@/lib/answerSets";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ANSWER_MIN_CHARS, ANSWER_ONE, ANSWER_REQUIRED, ANSWER_SHORT, answerChars, answerCounter, answerShortLine, answersMissing, qRequired, qText } from "@/lib/questions";
import { ChangesBox } from "@/components/ChangesBox";
import { ScrollText } from "@/components/ScrollText";
import { NOTHING_CHANGED_LINE } from "@/lib/rules";
import { QuestionBox } from "@/components/QuestionBox";
import { WRITTEN_MAX_CHARS, writtenLength } from "@/lib/rules";
import { wrapSelection } from "@/lib/markdown";
import { uploadToSession } from "@/lib/upload";
import { attachmentTag, hasMarkerFor, removeAttachmentMarker, tagMarker, type AnswerAttachment } from "@/lib/answerAttachments";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { fileSize } from "@/lib/format";

/** (Owner, Oct 29, batch 11) Bold, Italic and Code block for a written answer (stored as Markdown; the developer sees it formatted). */
function FormatBar({ target, onChange, sessionId, onAttach, known }: { target: React.RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void; sessionId: string; onAttach: (item: AnswerAttachment) => void; /** the uploads this form knows (a tag from an older server is made unique among them) */ known: AnswerAttachment[] }) {
  const [err, setErr] = useState("");
  const pending = useRef("");
  const recordingAt = useRef<number | null>(null);
  const progress = (filename: string, pct: number) => { const el = target.current; if (!el) return; const next = `[Uploading ${filename}… ${pct}%]`; onChange(pending.current ? el.value.replace(pending.current, next) : el.value.slice(0, recordingAt.current ?? el.selectionStart) + next + el.value.slice(recordingAt.current ?? el.selectionStart)); pending.current = next; recordingAt.current = null; };
  // (Batch 35 §4) The short marker "[📎 map.png #k3f9]" (its tag from the server, unique among the contract's uploads).
  const finish = (id: string, filename: string, file: Blob, tag: string) => { if (target.current) onChange(target.current.value.replace(pending.current, tagMarker(tag || attachmentTag(id, known.map((a) => a.id)), filename))); pending.current = ""; recordingAt.current = null; onAttach({ id, filename, size: file.size, contentType: file.type.split(";")[0] }); };
  const failed = () => { if (target.current) onChange(target.current.value.replace(pending.current, "")); pending.current = ""; recordingAt.current = null; };
  const apply = (kind: "bold" | "italic" | "code") => {
    const el = target.current;
    if (!el) return;
    const r = wrapSelection(el.value, el.selectionStart, el.selectionEnd, kind);
    onChange(r.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  };
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting" data-format-bar="">
      <button type="button" className="btn-ghost px-2 py-0.5 text-xs font-bold" title="Bold" onClick={() => apply("bold")}>B</button>
      <button type="button" className="btn-ghost px-2 py-0.5 text-xs italic" title="Italic" onClick={() => apply("italic")}>I</button>
      <button type="button" className="btn-ghost px-2 py-0.5 font-mono text-xs" title="Code block" onClick={() => apply("code")}>{"</>"}</button>
      <label className="btn-ghost cursor-pointer px-2 py-0.5 text-xs" title="Attach a file">📎<input type="file" aria-label="Attach a file" disabled={!!pending.current} className="sr-only" accept="image/*,application/pdf,text/plain,.zip,video/*" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || pending.current) return; setErr(""); progress(file.name, 0); try { const { id, tag } = await uploadToSession(sessionId, file, file.name, "written", (pct) => progress(file.name, pct)); finish(id, file.name, file, tag); } catch (e) { failed(); setErr(errOf(e)); } }} /></label>
      {/* (Owner, Oct 30) The form's mistake list shows once, at Send: an attach problem is one line here. */}
      <Err text={err} />
      {/* (Owner, Oct 30) No ⏺ in the written answers: recordings belong to the recorded part. 📎 attaches files (videos too). */}
    </div>
  );
}

/** (Batch 30 §14) The form's "Write at least 50 characters (12 so far)." or the server's "Each answer needs at least 50 characters." (with or without FIELD's mark). */
const isShortLine = (m: string) => /^\W?Write at least \d+ characters \(\d+ so far\)\.$/.test(m) || m.replace(/^\W/, "") === ANSWER_SHORT;

/** One answer box with its formatting toolbar. */
/** (Batch 16 section 10) A required answer left empty is red at its box, with the server's own line. */
export { ANSWER_REQUIRED };
function AnswerBox({ id, value, onChange, sessionId, attachments, onAttach, onRemove, rows = 3, required, min, short }: { id: string; value: string; onChange: (v: string) => void; sessionId: string; attachments: AnswerAttachment[]; onAttach: (item: AnswerAttachment) => void; onRemove: (id: string) => void; rows?: number; required?: boolean; /** (Batch 30 §14) an answer to a question: the counter below the minimum */ min?: boolean; /** red: Send found it too short */ short?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const chars = min ? answerChars(value) : 0;
  return (
    <div className="space-y-1">
      <FormatBar target={ref} onChange={onChange} sessionId={sessionId} onAttach={onAttach} known={attachments} />
      <textarea ref={ref} id={id} rows={rows} className="input" value={value} onChange={(e) => onChange(e.target.value)} {...(required ? { "data-required": "", "data-required-msg": ANSWER_REQUIRED } : {})} />
      {/* (Owner, Oct 30) The preview scrolls in its own box (about 12 lines) instead of growing the page. */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 p-2" tabIndex={0} data-answer-preview="">
        <AnswerWithAttachments text={value} attachments={attachments} onRemove={(id) => { onChange(removeAttachmentMarker(value, id, attachments)); onRemove(id); }} />
      </div>
      {/* (Batch 30 §14) While an answer is below the minimum: "12 / 50 characters minimum" (grey; red once Send found it short). An empty optional answer shows nothing. */}
      {min && chars < ANSWER_MIN_CHARS && (!!value.trim() || required || short) && <p className={`text-xs ${short ? "text-rose-300" : "text-slate-500"}`} data-answer-count={chars}>{answerCounter(chars)}</p>}
    </div>
  );
}

/**
 * Written answers: one box per question in the tester's contract. Can be updated until it's paid. `canSend` false (batch 10: the test is paused): the boxes stay and what is
 * typed is kept as a draft, but Send is hidden until the test resumes.
 */
export function WrittenForm({ sessionId, questions, initial, initialNotes, update, seenAt, canSend = true, sentSame = false, newFiles = false, lines = [], initialAttachments = [] }: { /** (Batch 30 §2, §3) grey lines above Send */ lines?: string[]; sessionId: string; questions: string[]; initial: string[]; initialNotes: string; update: boolean; seenAt: string; canSend?: boolean; initialAttachments?: AnswerAttachment[]; /** (Batch 20 section 26) what was sent is for these same questions (so the form starts from exactly it) */ sentSame?: boolean; /** an attachment added since the last send */ newFiles?: boolean }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [answers0, setAnswers] = useState<string[]>(questions.map((_, i) => initial[i] ?? ""));
  // (Batch 20 section 28, bug found by the owner) Always one answer per question shown, each a string: a shorter or holed list made a box uncontrolled (what was typed
  // showed but never reached the press), so the server got fewer answers than questions and refused "Answer every required question" with nothing red on the page.
  const answers = questions.map((_, i) => answers0[i] ?? "");
  const [missingAt, setMissingAt] = useState<number | null>(null);
  // (Batch 32 §4) "Answer at least one question…": a line above the questions (no box red), gone once any answer has text.
  const [needOne, setNeedOne] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [attachments, setAttachments] = useState(initialAttachments);
  /**
   * (Owner, Oct 31, batch 35 §38) No "Files and recordings" box under the answers: files go in an answer with 📎 (its preview shows them, × removes one; the server
   * keeps the limits: 5 files, 5 recordings, 500 MB each). Files that old box added and no answer shows still go with every Send: listed under the answers, each with ×.
   */
  const loose = attachments.filter((a) => ![...answers, notes].some((t) => hasMarkerFor(t, a.id, attachments)));
  const addAttachment = (item: AnswerAttachment) => setAttachments((old) => [...old.filter((a) => a.id !== item.id), item]);
  const removeAttachment = (id: string) => {
    const refs = [...answers, notes].reduce((n, a) => n + (hasMarkerFor(a, id, attachments) ? 1 : 0), 0);
    if (refs > 1) return;
    const data = { answers: answers.map((a) => removeAttachmentMarker(a, id, attachments)), notes: removeAttachmentMarker(notes, id, attachments), questions };
    void api("/api/kept", { key: `written:${sessionId}`, data }).then(() => api(`/api/sessions/${sessionId}/recording-remove`, { recordingId: id, written: true })).then(() => setAttachments((old) => old.filter((a) => a.id !== id))).catch((e) => setMsg({ ok: false, text: errOf(e) }));
  };
  // (Owner's finding, Oct 30, batch 32 §12) Answers sent from another device or tab arrive with the page's next redraw: boxes nobody touched here take them
  // (they stayed empty while the button already read "Send my updated answers"); anything typed here is kept.
  const lastSent = useRef({ answers: initial, notes: initialNotes });
  useEffect(() => {
    const was = lastSent.current;
    lastSent.current = { answers: initial, notes: initialNotes };
    if (JSON.stringify(was.answers) === JSON.stringify(initial) && was.notes === initialNotes) return;
    setAnswers((cur) => questions.map((_, i) => ((cur[i] ?? "") === (was.answers[i] ?? "") ? initial[i] ?? "" : cur[i] ?? "")));
    setNotes((cur) => (cur === was.notes ? initialNotes : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), initialNotes]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // (NEXT-UI 10) Typed and not sent: kept on the server, back after a reload or on another device, with "Draft" (batch 35 §8: after signing in, with "Use saved": the saved answers, or empty).
  const same = answers.every((a, i) => a === (initial[i] ?? "")) && notes === initialNotes;
  // The draft says which questions it was typed for: after a switch to changed questions, an answer never lands under a different question.
  const [typedFor] = useState(questions); // the questions the boxes were made for (a refresh after a switch doesn't re-pair them)
  const keep = useKept(`written:${sessionId}`, { answers, notes, questions: typedFor }, same, (v) => {
    setAnswers(restoreDraft(questions, initial, v));
    setNotes(v.notes ?? initialNotes);
  });

  /**
   * (Owner, Oct 31, batch 35 §18) A restored draft marks each box it changed, like Edit's fields: "Draft" with "Use saved" under every answer box (and the notes)
   * whose text differs from what was sent (or from empty when nothing was sent); "Use saved" puts that one box back. "Use saved for all" beside Send puts every
   * box back. A file whose marker leaves with a box's text follows the existing rules (no box names it: it's back in the files list).
   */
  const sentAt = (i: number) => initial[i] ?? "";
  // (Owner, Oct 31, batch 35 §39) "Use saved" only once answers were sent (back to them); answers never sent: "Discard" (empties) and "Discard all".
  const answerKind = update ? "saved" : "discard";
  const boxDraft = (i: number) => (keep.restored && answers[i] !== sentAt(i) ? <DraftTag kind={answerKind} field={`a${i}`} onUseSaved={() => setAnswers((all) => questions.map((_, j) => (j === i ? sentAt(i) : all[j] ?? "")))} /> : null);
  const notesDraft = keep.restored && notes !== initialNotes ? <DraftTag kind={answerKind} field="notes" onUseSaved={() => setNotes(initialNotes)} /> : null;
  const length = writtenLength([...answers, notes]);
  // (Owner, Oct 28, batch 20 section 26) After a send: "Send my updated answers" waits until something differs from it (changing it back disables it again).
  const unchanged = update && sentSame && !newFiles && same;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    if ([...answers, notes].some((a) => a.includes("[Uploading "))) return setMsg({ ok: false, text: FIELD + "Wait for the upload to finish before sending." });
    // (Batch 27 section 1) An open new-terms offer comes first: the press goes straight to its refusal (the page goes up to Switch / Keep).
    const terms = offerShown();
    if (!terms && length > WRITTEN_MAX_CHARS) return setMsg({ ok: false, text: FIELD + `Your written answers can be at most ${WRITTEN_MAX_CHARS.toLocaleString("en-US")} characters in all (now ${length.toLocaleString("en-US")}).` });
    // (Batch 26 section 14) The server's rule, at once: at least one question answered, plus every Required one; red at the question.
    const missing = terms ? null : answersMissing(questions, answers);
    if (missing?.message === ANSWER_ONE) return setNeedOne(true);
    if (missing) {
      setMissingAt(missing.at);
      // (Batch 30 §14) Too short: "Write at least 50 characters (12 so far)." at that answer.
      return setMsg({ ok: false, text: FIELD + (missing.message === ANSWER_SHORT ? answerShortLine(missing.chars ?? 0) : missing.message) });
    }
    setBusy(true);
    setMsg(null);
    try {
      setMissingAt(null);
      await api(`/api/sessions/${sessionId}/written`, { answers, notes, seenAt, confirmed, boxAt });
      await keep.clear();
      window.location.reload();
    } catch (err) {
      const sb = stopBox(err); if (sb) { setBox(sb); setBoxAt(sb.now); }
      else {
        // (Batch 20 section 28) Which required question the server found empty: the red goes AT it.
        if (err instanceof ApiError && err.message === ANSWER_ONE) { setNeedOne(true); setBusy(false); return; }
        if (err instanceof ApiError && typeof err.data.missing === "number") setMissingAt(err.data.missing);
        // (Batch 30 §14) The server found an answer too short: the same red line at it as the page's own check.
        if (err instanceof ApiError && err.message === ANSWER_SHORT && typeof err.data.chars === "number") setMsg({ ok: false, text: FIELD + answerShortLine(err.data.chars) });
        else setMsg({ ok: false, text: errOf(err) });
      }
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={send}>
      {/* (Owner, Oct 30) The mistake list sits once, at the top of the written part. (Batch 16 section 10) The server's "answer every required question" goes to the first empty required box. */}
      <FormMistakes top text={msg && !msg.ok ? msg.text : ""} press={update ? "Send my updated answers" : "Send my answers"}
        find={(m) => (m === ANSWER_ONE || isShortLine(m) ? document.getElementById(`a${missingAt ?? 0}`) : m === ANSWER_REQUIRED ? (missingAt != null ? document.getElementById(`a${missingAt}`) : null) ?? Array.from(document.querySelectorAll<HTMLTextAreaElement>(`textarea[data-required-msg="${ANSWER_REQUIRED}"]`)).find((t) => !t.value.trim()) : null)} />
      {/* (Batch 20 section 1) More than 3 questions: the questions and their answer boxes sit in a scroll box about 3 questions tall; the notes, counter, files
          and Send stay below it, and a red mistake scrolls the box to its question. */}
      <QuestionBox count={questions.length} size="form" className="space-y-3" >
      {questions.map((q, i) => (
        <div key={i} data-question="">
          {/* (Batch 15 section 3) A long question sits in a scroll box about 6 lines tall. */}
          {/* (Batch 26 sections 11 and 14) The "*" only on a question the developer ticked Required, right after the question's words (not at the far right). */}
          <label className="label flex items-start gap-0.5" htmlFor={`a${i}`} data-question-label=""><ScrollText className="min-w-0" text={qText(q)} label={`Question ${i + 1}`} />{qRequired(q) && <span className="req shrink-0" data-required-star="" aria-label="required" />}</label>
          <AnswerBox id={`a${i}`} sessionId={sessionId} attachments={attachments} onAttach={addAttachment} onRemove={removeAttachment} required={qRequired(q)} min short={missingAt === i && !!msg && !msg.ok && isShortLine(msg.text)} value={answers[i]} onChange={(v) => setAnswers((all) => questions.map((_, j) => (j === i ? v : all[j] ?? "")))} />
          {boxDraft(i)}
        </div>
      ))}
      </QuestionBox>
      <div>
        <label className="label" htmlFor="notes">Anything else (bugs, ideas)</label>
        <AnswerBox id="notes" rows={2} sessionId={sessionId} attachments={attachments} onAttach={addAttachment} onRemove={removeAttachment} value={notes} onChange={setNotes} />
        {notesDraft}
      </div>
      {loose.length > 0 && (
        <div className="space-y-1 text-sm" data-loose-files="">
          <p className="text-slate-400">Files not in an answer (they go with your answers when you send them):</p>
          <ul className="flex flex-wrap gap-2">
            {loose.map((a) => (
              <li key={a.id} className="inline-flex items-center gap-1"><a className="rounded border border-white/15 px-2 py-1 text-xs" href={`/api/recordings/${a.id}/file`} target="_blank" rel="noreferrer">{a.filename} · {fileSize(a.size)}</a><button type="button" aria-label={`Remove ${a.filename}`} className="btn-ghost px-1" onClick={() => removeAttachment(a.id)}>×</button></li>
            ))}
          </ul>
        </div>
      )}
      {/* (Batch 11) (Batch 14) At most 50,000 characters for the whole written part, counted live. */}
      <p className={`text-xs ${length > WRITTEN_MAX_CHARS ? "text-rose-300" : "text-slate-500"}`} data-written-count="">{length.toLocaleString("en-US")} / {WRITTEN_MAX_CHARS.toLocaleString("en-US")}</p>
      {canSend && lines.map((l) => <p key={l} className="note" data-above-send="">{l}</p>)}
      <span>{canSend && <button className={`btn ${unchanged ? "!bg-white/10 !text-ink-400 !shadow-none" : ""}`} disabled={busy || length > WRITTEN_MAX_CHARS || unchanged} title={unchanged ? NOTHING_CHANGED_LINE : undefined} data-send-idle={unchanged ? "" : undefined}>{busy ? "Sending…" : update ? "Send my updated answers" : "Send my answers"}</button>}{keep.restored && !same && <button type="button" className="ml-3 text-sm text-sky-300 underline" data-use-saved-all="" onClick={() => { setAnswers(questions.map((_, i) => initial[i] ?? "")); setNotes(initialNotes); }}>{update ? USE_SAVED_ALL_LABEL : DISCARD_ALL_LABEL}</button>}</span>
      {!canSend && <p className="note" data-draft-kept="">Your answers are kept as a draft. Send comes back when the test resumes.</p>}
      {/* (Owner, Oct 30, batch 32 §4) Under Send, where the press is (above the questions it could be out of view); in view when it appears. */}
      {needOne && !answers.some((a) => a.trim()) && <p ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="text-sm text-rose-300" role="alert" data-answer-one="">{ANSWER_ONE}</p>}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {msg?.ok && <p className="ok">{msg.text}</p>}
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
      <Err text={err ? refusalLine("Leave", err) : ""} />
    </div>
  );
}

/** Dispute once, on any part the developer reviewed (batch 10). `limit`: how far a decision can raise the pay (batch 28 §15: "up to $20.00 more", to the piece's cap). */
export function DisputeForm({ sessionId, kind, id, seenAt, disabledNote = "", limit = "up to the piece's cap" }: { disabledNote?: string; sessionId: string; kind: "submission" | "call"; id: string; seenAt?: string; limit?: string }) {
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
    <details className="space-y-2" data-mistakes-root="">
      <summary className="cursor-pointer text-sm text-volt-300">Dispute the pay</summary>
      <label className="label req" htmlFor={`d-${id}`}>Why should the pay be higher? (the team and the developer read it)</label>
      <textarea id={`d-${id}`} rows={3} className="input" maxLength={2000} data-required="" data-required-msg="Say why you think the pay should be higher (at least a sentence)." data-min-chars="10" data-msg="Say why you think the pay should be higher (at least a sentence)." data-match="pay should be higher" value={reason} onChange={(e) => setReason(e.target.value)} />
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
      {keep.restored && reason !== "" && <DraftTag kind="discard" onUseSaved={() => setReason("")} />}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <FormMistakes text={err} press="Send the dispute" />
    </details>
  );
}
