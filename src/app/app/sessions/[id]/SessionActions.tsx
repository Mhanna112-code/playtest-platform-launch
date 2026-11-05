"use client";
import { VIDEO_ACCEPT } from "@/lib/videoFormats";
import { Paperclip } from "lucide-react";
import { withoutAttachmentMarkers } from "@/lib/answerAttachments";
import { CharacterCount } from "@/components/CharacterCount";
import { DISPUTE_PRESS, PRESS_VERBS, refusalLine } from "@/lib/pressLabels";
import { Err } from "@/components/Err";
import { FormMistakes } from "@/components/FormMistakes";
import { checkFields } from "@/components/FieldChecks";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, errOf, FIELD, offerShown } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { DISCARD_ALL_LABEL, DraftButton, DraftTag, USE_SAVED_ALL_LABEL, useKept, useKeptUnits } from "@/lib/useKept";
import { NOTES_UNIT, answerUnit, type Units } from "@/lib/draftUnits";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ANSWER_MIN_CHARS, ANSWER_ONE, ANSWER_REQUIRED, ANSWER_SHORT, answerChars, answerShortLine, answersMissing, qRequired, qText } from "@/lib/questions";
import { ChangesBox } from "@/components/ChangesBox";
import { LongText, QUESTION_LINES } from "@/components/LongText";
import { NOTHING_CHANGED_LINE, NOTHING_TO_ADD } from "@/lib/rules";
import { ADDITIONS_MAX, ANSWER_PRESS, ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, additionsFull, additionsLeftLine } from "@/lib/additions";
import { QuestionBox } from "@/components/QuestionBox";
import { WRITTEN_MAX_CHARS, additionTooLongLine, writtenLength } from "@/lib/rules";
import { wrapSelection } from "@/lib/markdown";
import { additionRule, answerRule, limitEdit, limitedChange } from "@/lib/typingLimit";
import { uploadToSession } from "@/lib/upload";
import { attachmentTag, hasMarkerFor, removeAttachmentMarker, tagMarker, type AnswerAttachment } from "@/lib/answerAttachments";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { fileSize } from "@/lib/format";
import { useFinished } from "@/lib/usePress";
import { PressDone } from "@/components/PressDone";

/**
 * (Owner, Nov 5, §213) A Send refused because the test is paused: a blue notice naming the press, above the "kept as a draft" line. The page redraws for the
 * pause (Send goes), so the refusal is kept for this tab (sessionStorage) until it shows; once Send is back (the test resumed) it goes.
 */
const pausedKey = (sessionId: string, press: string) => `paused-send:${sessionId}:${press}`;
function rememberPaused(sessionId: string, press: string, message: string) {
  try { sessionStorage.setItem(pausedKey(sessionId, press), message); } catch { /* storage off: the notice shows until the redraw */ }
}
function PausedSend({ sessionId, press, label = press, canSend, now }: { sessionId: string; press: string; /** the press's name in the line (`press` keys it) */ label?: string; canSend: boolean; now: string }) {
  const [message, setMessage] = useState(now);
  useEffect(() => {
    try {
      if (canSend && !now) { sessionStorage.removeItem(pausedKey(sessionId, press)); setMessage(""); return; }
      const kept = sessionStorage.getItem(pausedKey(sessionId, press));
      if (kept) setMessage(kept);
    } catch { /* storage off */ }
  }, [sessionId, press, canSend, now]);
  if (!message && !now) return null;
  return <p role="status" className="rounded-lg border border-sky-300/40 bg-sky-300/[0.08] p-2.5 text-sm text-sky-100" data-paused-send=""><strong className="font-semibold text-sky-50">Your {label} didn&apos;t go through:</strong> {now || message}</p>;
}

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
      <label className="btn-ghost cursor-pointer px-2 py-0.5 text-xs" title="Attach a file"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" /><input type="file" aria-label="Attach a file" disabled={!!pending.current} className="sr-only" accept={`image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.zip,${VIDEO_ACCEPT}`} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || pending.current) return; setErr(""); progress(file.name, 0); try { const { id, tag } = await uploadToSession(sessionId, file, file.name, "written", (pct) => progress(file.name, pct)); finish(id, file.name, file, tag); } catch (e) { failed(); setErr(errOf(e)); } }} /></label>
      {/* (Owner, Oct 30) The form's mistake list shows once, at Send: an attach problem is one line here. */}
      <Err text={err} press="Attach a file" />
      {/* (Owner, Oct 30) No ⏺ in the written answers: recordings belong to the recorded part. 📎 attaches files (videos too). */}
    </div>
  );
}

/** (Batch 30 §14) The form's "Write at least 50 characters (12 so far)." or the server's "Each answer needs at least 50 characters." (with or without FIELD's mark). */
const isShortLine = (m: string) => /^\W?Write at least \d+ characters \(\d+ so far\)\.$/.test(m) || m.replace(/^\W/, "") === ANSWER_SHORT;

/** One answer box with its formatting toolbar. */
/** (Batch 16 section 10) A required answer left empty is red at its box, with the server's own line. */
export { ANSWER_REQUIRED };
function AnswerBox({ id, value, onChange, sessionId, attachments, onAttach, onRemove, rows = 3, required, min, short, total, alone = false }: { id: string; value: string; onChange: (v: string) => void; sessionId: string; /** (Owner, Nov 3, §140) the whole written part's count now (writtenLength) */ total: number; /** (Owner, Nov 4, §186) an addition's box: its own text alone is limited (additionRule) */ alone?: boolean; attachments: AnswerAttachment[]; onAttach: (item: AnswerAttachment) => void; onRemove: (id: string) => void; rows?: number; required?: boolean; /** (Batch 30 §14) an answer to a question: the counter below the minimum */ min?: boolean; /** red: Send found it too short */ short?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const chars = answerChars(value);
  // (Owner, Nov 3) The preview stays hidden until "Preview" is pressed (on phones it took the screen); the button names the files placed in the answer.
  const [preview, setPreview] = useState(false);
  const files = attachments.filter((a) => hasMarkerFor(value, a.id, attachments)).length;
  // (Owner, Nov 3, batch 35 §140) Typing stops at the written part's limit: this box takes what the other answers and the notes leave of the 20,000 (counted
  // without the file markers, as the counter and the server count). Bold / italic from the toolbar is held to it too; a file's marker never counts.
  // (Owner, Nov 4, §186) An addition's box (`alone`) takes 20,000 of its own. A draft already longer (kept from before the limit came down) is never cut: it may
  // only shrink (limitEdit), its counter is red and its press is refused until it fits.
  const rule = alone ? additionRule() : answerRule(total - withoutAttachmentMarkers(value).length);
  const toolbar = (v: string) => onChange(limitEdit(ref.current?.value ?? value, v, rule).value);
  return (
    <div className="space-y-1">
      <FormatBar target={ref} onChange={toolbar} sessionId={sessionId} onAttach={onAttach} known={attachments} />
      <textarea ref={ref} id={id} rows={rows} className="input" value={value} data-typing-limit="" onChange={(e) => onChange(limitedChange(e, value, rule))} {...(required ? { "data-required": "", "data-required-msg": ANSWER_REQUIRED } : {})} />
      {value.trim() && (
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" aria-expanded={preview} data-preview-toggle="" onClick={() => setPreview((p) => !p)}>
          {preview ? "Hide preview" : `Preview${files ? ` (${files} ${files === 1 ? "file" : "files"})` : ""}`}
        </button>
      )}
      {/* (Owner, Oct 30) The preview scrolls in its own box (about 12 lines) instead of growing the page. */}
      {preview && value.trim() && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-white/10 p-2" tabIndex={0} data-answer-preview="">
          <AnswerWithAttachments text={value} attachments={attachments} onRemove={(id) => { onChange(removeAttachmentMarker(value, id, attachments)); onRemove(id); }} />
        </div>
      )}
      {/* (Owner, Nov 4, §189) An addition's box (`alone`): this is its one counter ("N / 20,000", the addition's own text); the add form draws no second one. */}
      <CharacterCount value={value} count={withoutAttachmentMarkers(value).length} minCount={chars} min={min ? ANSWER_MIN_CHARS : 0} max={WRITTEN_MAX_CHARS} required={required || short} data-answer-count={chars} {...(alone ? { "data-written-count": "" } : {})} />
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
  const [pausedNow, setPausedNow] = useState("");
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
    // (Batch 35 §120) The boxes that named the file are kept without its marker first (only those units), so the server sees no draft still using it.
    const named = [...typedFor.map((q, i) => (hasMarkerFor(answers[i] ?? "", id, attachments) ? answerUnit(q) : "")), hasMarkerFor(notes, id, attachments) ? NOTES_UNIT : ""].filter(Boolean);
    void keep.write(named).then(() => api(`/api/sessions/${sessionId}/recording-remove`, { recordingId: id, written: true })).then(() => setAttachments((old) => old.filter((a) => a.id !== id))).catch((e) => setMsg({ ok: false, text: errOf(e) }));
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
  // (Batch 35 §40, §41) Sent: the page redraws in place (the scroll stays at the answers); until it has, Send stays greyed with its line under it.
  const fin = useFinished(() => { setBusy(false); setBox(null); setBoxAt(""); });
  // (NEXT-UI 10) Typed and not sent: kept on the server, back after a reload or on another device, with "Draft" (batch 35 §8: after signing in, with "Use saved": the saved answers, or empty).
  const same = answers.every((a, i) => a === (initial[i] ?? "")) && notes === initialNotes;
  // The draft says which questions it was typed for: after a switch to changed questions, an answer never lands under a different question.
  const [typedFor] = useState(questions); // the questions the boxes were made for (a refresh after a switch doesn't re-pair them)
  // (Owner, Nov 2, batch 35 §120) Per-field: one unit per question's box and one for the notes; this tab keeps only the boxes it changed, and the server keeps each
  // box's latest (answer 1 typed in one tab and answer 2 in another both stay).
  const answerUnits = (as: string[], n: string): Units => ({ ...Object.fromEntries(typedFor.map((q, i) => [answerUnit(q), as[i] ?? ""])), [NOTES_UNIT]: n });
  const keep = useKeptUnits(`written:${sessionId}`, answerUnits(answers, notes), answerUnits(questions.map((_, i) => initial[i] ?? ""), initialNotes), (u) => {
    setAnswers((cur) => questions.map((q, i) => { const v = u[answerUnit(q)]; return typeof v === "string" ? v : cur[i] ?? ""; }));
    if (typeof u[NOTES_UNIT] === "string") setNotes(u[NOTES_UNIT] as string);
  }, { questions: typedFor });

  /**
   * (Owner, Oct 31, batch 35 §18) A restored draft marks each box it changed, like Edit's fields: "Draft" with "Use saved" under every answer box (and the notes)
   * whose text differs from what was sent (or from empty when nothing was sent); "Use saved" puts that one box back. "Use saved for all" beside Send puts every
   * box back. A file whose marker leaves with a box's text follows the existing rules (no box names it: it's back in the files list).
   */
  const sentAt = (i: number) => initial[i] ?? "";
  // (Owner, Oct 31, batch 35 §39) "Use saved" only once answers were sent (back to them); answers never sent: "Discard" (empties) and "Discard all".
  const answerKind = update ? "saved" : "discard";
  const boxDraft = (i: number) => (keep.restored && keep.isDraft(answerUnit(typedFor[i] ?? questions[i])) && answers[i] !== sentAt(i) ? <DraftTag disabled={busy || fin.done} kind={answerKind} field={`a${i}`} onUseSaved={() => setAnswers((all) => questions.map((_, j) => (j === i ? sentAt(i) : all[j] ?? "")))} /> : null);
  const notesDraft = keep.restored && keep.isDraft(NOTES_UNIT) ? <DraftTag disabled={busy || fin.done} kind={answerKind} field="notes" onUseSaved={() => setNotes(initialNotes)} /> : null;
  const length = writtenLength([...answers, notes]);
  // (Owner, Oct 28, batch 20 section 26) After a send: "Send my updated answers" waits until something differs from it (changing it back disables it again).
  const unchanged = update && sentSame && !newFiles && same;
  const sendPress = "Send"; // (§170) refusals name the press Send
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
      fin.finish(update ? "Sent your answers to the new questions." : "Sent your answers.");
    } catch (err) {
      const sb = stopBox(err); if (sb) { setBox(sb); setBoxAt(sb.now); }
      else if (err instanceof ApiError && err.code === "paused") { rememberPaused(sessionId, sendPress, err.message); setPausedNow(err.message); }
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
      {/* (Owner, Nov 4, batch 35 §170) A refusal names the press Send (as the server's own lines do), not "Your Send my answers didn't go through". */}
      <FormMistakes top text={msg && !msg.ok ? msg.text : ""} press={update ? "Send my answers to the new questions" : "Send my answers"} named={PRESS_VERBS.written}
        find={(m) => (m === ANSWER_ONE || isShortLine(m) ? document.getElementById(`a${missingAt ?? 0}`) : m === ANSWER_REQUIRED ? (missingAt != null ? document.getElementById(`a${missingAt}`) : null) ?? Array.from(document.querySelectorAll<HTMLTextAreaElement>(`textarea[data-required-msg="${ANSWER_REQUIRED}"]`)).find((t) => !t.value.trim()) : null)} />
      {/* (Batch 20 section 1) More than 3 questions: the questions and their answer boxes sit in a scroll box about 3 questions tall; the notes, counter, files
          and Send stay below it, and a red mistake scrolls the box to its question. */}
      <QuestionBox count={questions.length} size="form" className="space-y-3" >
      {questions.map((q, i) => (
        <div key={i} data-question="">
          {/* (Batch 15 section 3) A long question sits in a scroll box about 6 lines tall. (Owner, Nov 4, §182) Now the shared fold: its first 2 lines, then Show more. */}
          {/* (Batch 26 sections 11 and 14) The "*" only on a question the developer ticked Required, right after the question's words (not at the far right). */}
          <label className="label flex items-start gap-0.5" htmlFor={`a${i}`} data-question-label=""><LongText inline text={qText(q)} lines={QUESTION_LINES} label={`Question ${i + 1}`} />{qRequired(q) && <span className="req shrink-0" data-required-star="" aria-label="required" />}</label>
          <AnswerBox id={`a${i}`} sessionId={sessionId} attachments={attachments} onAttach={addAttachment} onRemove={removeAttachment} required={qRequired(q)} min short={missingAt === i && !!msg && !msg.ok && isShortLine(msg.text)} total={length} value={answers[i]} onChange={(v) => setAnswers((all) => questions.map((_, j) => (j === i ? v : all[j] ?? "")))} />
          {boxDraft(i)}
        </div>
      ))}
      </QuestionBox>
      <div>
        <label className="label" htmlFor="notes">Anything else (bugs, ideas)</label>
        <AnswerBox id="notes" rows={2} sessionId={sessionId} attachments={attachments} onAttach={addAttachment} onRemove={removeAttachment} total={length} value={notes} onChange={setNotes} />
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
      {/* (Batch 11) (Batch 14) At most 20,000 characters for the whole written part, counted live ((Owner, Nov 4, §186) was 50,000). */}
      <p className={`text-xs ${length > WRITTEN_MAX_CHARS ? "text-rose-300" : "text-slate-500"}`} data-written-count="">{length.toLocaleString("en-US")} / {WRITTEN_MAX_CHARS.toLocaleString("en-US")}</p>
      {canSend && lines.map((l) => <p key={l} className="note" data-above-send="">{l}</p>)}
      <span>{canSend && <button className={`btn ${unchanged ? "!bg-white/10 !text-ink-400 !shadow-none" : ""}`} disabled={busy || length > WRITTEN_MAX_CHARS || unchanged} title={unchanged ? NOTHING_CHANGED_LINE : undefined} data-send-idle={unchanged ? "" : undefined}>{busy && !fin.done ? "Sending…" : update ? "Send my answers to the new questions" : "Send my answers"}</button>}{keep.restored && [...keep.drafted].some(keep.isDraft) && <DraftButton className="ml-3 text-sm text-sky-300 underline" data-use-saved-all="" disabled={busy || fin.done} onPress={() => { setAnswers(questions.map((_, i) => initial[i] ?? "")); setNotes(initialNotes); }}>{update ? USE_SAVED_ALL_LABEL : DISCARD_ALL_LABEL}</DraftButton>}</span>
      <PausedSend sessionId={sessionId} press={sendPress} canSend={canSend} now={pausedNow} />
      {!canSend && <p className="note" data-draft-kept="">Your answers are kept as a draft. Send comes back when the test resumes.</p>}
      {/* (Owner, Oct 30, batch 32 §4) Under Send, where the press is (above the questions it could be out of view); in view when it appears. */}
      {needOne && !answers.some((a) => a.trim()) && <p ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="text-sm text-rose-300" role="alert" data-answer-one="">{ANSWER_ONE}</p>}
      <PressDone line={fin.line} />
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {msg?.ok && <p className="ok">{msg.text}</p>}
    </form>
  );
}

/** (Batch 35 §136) The Add button's name, in its refusals and mistakes list. (§167) One per question. */
export const ADD_PRESS = "Add to my answer";
/** (§167) The button that opens a question's box. */
export const ADD_OPEN = "Add to this answer";

/**
 * (Owner, Nov 3, batch 35 §136, §167; replaces §136's one "Add more" box for the whole part) Sent written answers are locked: each question of the tester's
 * read-only list has its own "Add to this answer" box (Bold, Italic, Code block, 📎 files), sent with "Add to my answer" and added under that question. Kept as a
 * draft per question (`add:<session>:<questionKey>`), editable until it's sent; a restored draft opens its question's fold. `canSend` false (a paused test): the
 * box and its draft stay, the button is hidden. (Owner, Nov 4, §186) Each addition has the answers' own limit: at most 20,000 characters of its own (its counter
 * counts only it; `used`, the characters already sent, is gone). (Owner, Nov 5, §222; replaces §167's part-wide 10) `made`: this question's additions so far
 * (at most ADDITIONS_MAX, 5): the row says "3 of 5 additions left" once there is one; at 5 only this row closes, its grey note under the question's name, and a
 * draft stays, read-only. `first`: a question with no answer yet: the row is "Answer this question" (ANSWER_PRESS, the press's name in its refusals too), free and
 * offered after any cap; sent, the question follows the normal 5.
 * (Owner, Nov 4, §182) The button sits below the written answers' panel (`question` names it there); pressed, the box opens in the panel, directly under the
 * question's latest part: drawn into its `slot` (`<div data-add-slot>` at the end of that question's fold), the question's fold opened and the box brought into
 * view. The box is a fold of its own (open), and its editor scrolls inside when long; Add to my answer and Close stay under it.
 */
export function WrittenAddForm({ sessionId, seenAt, canSend = true, known = [], lines = [], questionKey, question, made = 0, first = false, slot }: { sessionId: string; seenAt: string; canSend?: boolean; known?: AnswerAttachment[]; lines?: string[]; questionKey: string; question: string; made?: number; /** (§222) a question with no answer yet: "Answer this question" */ first?: boolean; /** (§182) the data-add-slot the open box is drawn into */ slot?: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [attachments, setAttachments] = useState(known);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [box, setBox] = useStopBox();
  const [boxAt, setBoxAt] = useState("");
  const [pausedNow, setPausedNow] = useState("");
  const root = useRef<HTMLDivElement>(null);
  // (§182) Where the open box is drawn (null: here, at the button's place); `pressed`: opened by the button, so it is brought into view.
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const pressed = useRef(false);
  // After every draw: a redraw of the page can draw the slot anew, so it is looked up again (it only sets when the slot changed, so it settles at once).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!slot) return;
    const found = document.querySelector<HTMLElement>(`[data-add-slot="${CSS.escape(slot)}"]`);
    if (found !== slotEl) setSlotEl(found);
  });
  // (§222) This question's 5 (never for its free first answer); the buttons' words and the press named in refusals.
  const full = !first && made >= ADDITIONS_MAX;
  const opener = first ? ANSWER_PRESS : ADD_OPEN, sender = first ? ANSWER_PRESS : ADD_PRESS;
  const fin = useFinished(() => { setBusy(false); setText(""); setOpen(false); setBox(null); setBoxAt(""); });
  const keep = useKept(`add:${sessionId}:${questionKey}`, { text }, text === "", (v) => {
    if (typeof v.text === "string" && v.text) {
      setText(v.text);
      setOpen(true);
    }
  });
  // (§167) A kept draft opens its question's fold, so it isn't hidden. (§182) Every fold it is in ("Your written answers" too); opened by the button, it is
  // brought into view (the panel scrolls to it) and its box takes the typing.
  useEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;
    if (!pressed.current) return;
    pressed.current = false;
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    el.querySelector<HTMLTextAreaElement>("textarea:not([readonly])")?.focus({ preventScroll: true });
  }, [open, slotEl]);
  // (Owner, Nov 4, §186) Only this addition counts toward its 20,000.
  const length = writtenLength([text]);
  const empty = !withoutAttachmentMarkers(text).trim() && !attachments.some((a) => hasMarkerFor(text, a.id, attachments));
  const remove = (id: string) => void api(`/api/sessions/${sessionId}/recording-remove`, { recordingId: id, written: true }).then(() => setAttachments((old) => old.filter((a) => a.id !== id))).catch((e) => setErr(errOf(e)));
  async function add() {
    if (!canSend || empty || full) return;
    if (text.includes("[Uploading ")) return setErr(FIELD + "Wait for the upload to finish before sending.");
    if (!offerShown() && length > WRITTEN_MAX_CHARS) return setErr(FIELD + additionTooLongLine(length));
    setBusy(true);
    setErr("");
    try {
      await api(`/api/sessions/${sessionId}/written-add`, { text, question: questionKey, seenAt, confirmed: !!boxAt, boxAt, ...(first ? { first: true } : {}) });
      await keep.clear();
      fin.finish(first ? "Your answer was sent." : "Added to your answer.");
    } catch (e) {
      const sb = stopBox(e);
      if (sb) { setBox(sb); setBoxAt(sb.now); }
      else if (e instanceof ApiError && e.code === "paused") { rememberPaused(sessionId, `Add:${questionKey}`, e.message); setPausedNow(e.message); }
      else setErr(errOf(e));
      setBusy(false);
    }
  }
  // (Owner, Nov 5, §222; replaces §186's one note for the part) At this question's 5 only its row closes: no button, the question's name and under it the grey
  // note ("You've added to this answer 5 times, the most it takes."); the other rows stay open. A kept draft still opens read-only below.
  const name = slot && <span className="line-clamp-1 min-w-0 flex-1 basis-40 text-xs text-slate-400 [overflow-wrap:anywhere]" data-add-question="">{question}</span>;
  if (!open && !fin.done) {
    if (full) return (
      <div ref={root} className="space-y-0.5" data-add-for={questionKey} data-add-closed="">
        {name}
        <p className="note" data-additions-full="">{additionsFull(questionKey)}</p>
      </div>
    );
    return (
      <div ref={root} className="space-y-1" data-add-for={questionKey}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" data-add-more="written" data-answer-first={first ? "" : undefined} onClick={() => { pressed.current = true; setOpen(true); }}>{opener}</button>
          {/* (§182) Below the panel: which question it adds to (its first line). */}
          {name}
        </div>
        {/* (§222) The row's own count, once this question has an addition. */}
        {!first && made > 0 && <p className="note" data-additions-left="">{additionsLeftLine(made)}</p>}
      </div>
    );
  }
  const boxNode = (
    <div ref={root} className="space-y-2 rounded-lg border border-white/10 p-3" data-add-box="written" data-add-for={questionKey} data-mistakes-root="">
      {!fin.done && (
        // (§182) The box folds (open at first); what's typed scrolls inside it when long.
        <details open className="group/fold" data-add-fold="">
          <summary className="fold-chevron cursor-pointer text-sm font-medium text-slate-200">{opener}</summary>
          <div className="mt-2 max-h-[min(24rem,60vh)] space-y-2 overflow-y-auto pr-1" data-add-scroll="">
            <label className="sr-only" htmlFor={`add-${sessionId}-${questionKey}`}>{opener}</label>
            <p className="sr-only">{question}</p>
            {full ? (
              // (§167, §222) At the question's 5 the draft is kept, read-only.
              <textarea id={`add-${sessionId}-${questionKey}`} className="input" rows={3} readOnly value={text} maxLength={WRITTEN_MAX_CHARS} data-add-readonly="" />
            ) : (
              <>
                <p className="note">{questionKey === ANYTHING_ELSE_KEY ? `What you sent stays as it is. This is added under ${ANYTHING_ELSE_TITLE}.` /* (Owner, Nov 4, §188) */ : first ? "What you sent stays as it is. This is your answer to this question." /* (§222) */ : "What you sent stays as it is. This is added under this answer."}</p>
                <AnswerBox id={`add-${sessionId}-${questionKey}`} rows={3} sessionId={sessionId} attachments={attachments} onAttach={(a) => setAttachments((old) => [...old.filter((x) => x.id !== a.id), a])} onRemove={remove} total={length} alone value={text} onChange={setText} />
              </>
            )}
            {keep.restored && text !== "" && !full && <DraftTag disabled={busy} kind="discard" onUseSaved={() => setText("")} />}
            {canSend && !full && lines.map((l) => <p key={l} className="note" data-above-send="">{l}</p>)}
          </div>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {canSend && !full && <button type="button" className="btn" data-add-send="written" disabled={busy || fin.done || empty || length > WRITTEN_MAX_CHARS} title={empty ? NOTHING_TO_ADD : undefined} onClick={add}>{busy && !fin.done ? (first ? "Sending…" : "Adding…") : sender}</button>}
        {!fin.done && !busy && !full && <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(false)}>Close</button>}
      </div>
      <PausedSend sessionId={sessionId} press={`Add:${questionKey}`} label={first ? ANSWER_PRESS : "Add"} canSend={canSend} now={pausedNow} />
      {!canSend && !full && <p className="note" data-draft-kept="">What you add is kept as a draft. Adding comes back when the test resumes.</p>}
      <PressDone line={fin.line} />
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {/* (Owner, Nov 4, batch 35 §170) A refusal names the press Add (§146), not "Your Add to my answer didn't go through". */}
      {/* (§222) A question's first answer is the press Answer this question. */}
      <FormMistakes text={err} press={sender} named={first ? ANSWER_PRESS : PRESS_VERBS["written-add"]} />
    </div>
  );
  // (§182) Open: drawn in the panel under the question's latest part (its slot); nothing stays at the button's place below the panel.
  return slotEl ? createPortal(boxNode, slotEl) : boxNode;
}

export function LeaveButton({ sessionId, seenAt, title }: { sessionId: string; seenAt: string; title: string }) {
  const [err, setErr] = useState("");
  const [box, setBox] = useStopBox();
  const [confirmed, setConfirmed] = useState(false);
  const fin = useFinished();
  const leave = () =>
    api(`/api/sessions/${sessionId}/leave`, { seenAt, confirmed })
      .then(() => { setBox(null); fin.finish("You left this test."); })
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setConfirmed(true);
        } else setErr(errOf(e));
      });
  return (
    <div className="space-y-2">
      <ConfirmButton live disabled={fin.done} className="btn-secondary px-3 py-1.5 text-sm text-rose-200" title={`Are you sure you want to leave “${title}”?`} confirmLabel="Leave this test" onConfirm={leave}
        body={(
          <ul className="list-disc space-y-1 pl-5">
            <li>What you already sent is still reviewed and paid as usual.</li>
            <li>The parts you haven&apos;t sent close with no pay. Calls ahead are cancelled.</li>
            <li>You can join again later while the test is open: your session comes back.</li>
          </ul>
        )}>
        Leave this test
      </ConfirmButton>
      <PressDone line={fin.line} />
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
  const [meanwhile, setMeanwhile] = useState("");
  const [busy, setBusy] = useState(false);
  // (Batch 35 §41) Sent: the box and its lines go, Send the dispute stays greyed with its line until the page has redrawn (then the dispute shows on the page).
  const fin = useFinished(() => { setBusy(false); setReason(""); setBox(null); setBoxAt(""); });
  const keep = useKept(`dispute:${kind}:${id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  // The full app's fold (no separate mode): "Dispute the pay" opens the form in place.
  return (
    <details className="space-y-2" data-mistakes-root="">
      <summary className="cursor-pointer text-sm text-volt-300">Dispute the pay</summary>
      {!fin.done && <>
      <label className="label req" htmlFor={`d-${id}`}>Why should the pay be higher? (the team and the developer read it)</label>
      <textarea id={`d-${id}`} rows={3} className="input" maxLength={2000} data-required="" data-required-msg="Say why you think the pay should be higher (at least a sentence)." data-min-chars="10" data-msg="Say why you think the pay should be higher (at least a sentence)." data-match="pay should be higher" value={reason} onChange={(e) => setReason(e.target.value)} />
      <CharacterCount value={reason} min={10} max={2000} required />
      <p className="note">You can dispute this once. Our team decides; a decision can only raise the pay, {limit}.</p>
      </>}
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
            setBox(null);
            setReason(""); // sent: nothing left to discard
            fin.finish("Your dispute is sent to the team.");
          } catch (e) {
            const sb = stopBox(e);
            if (sb) {
              setBox(sb);
              setBoxAt(sb.now);
            } else if (e instanceof ApiError && e.code === "no_dispute" && / meanwhile \(/.test(e.message)) {
              // (Owner, Nov 3, §159) A payment since the page loaded left nothing to dispute: one refusal naming it, in the blue box (never a stop to press again).
              setBox(null);
              setMeanwhile(e.message);
            } else setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        Send the dispute
      </button>
      <PressDone line={fin.line} />
      {!fin.done && disabledNote && <p className="note" data-owed-note="">{disabledNote}</p>}
      {keep.restored && reason !== "" && <DraftTag disabled={busy || fin.done} kind="discard" onUseSaved={() => setReason("")} />}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {/* (Owner, Nov 4, batch 35 §170) A refusal names the press Dispute (its route's label), not the button's words: "Your Dispute didn't go through: …". */}
      {meanwhile && <p className="info" data-dispute-meanwhile="">{refusalLine(DISPUTE_PRESS, meanwhile)}</p>}
      <FormMistakes text={err} press="Send the dispute" named={DISPUTE_PRESS} />
    </details>
  );
}
