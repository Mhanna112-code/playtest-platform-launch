"use client";
import { VIDEO_ACCEPT } from "@/lib/videoFormats";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { useState } from "react";
import { api, errOf, FIELD, offerShown } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { uploadToSession } from "@/lib/upload";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { RecordingVideo } from "@/components/RecordingVideo";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ADDED_LABEL, addedLabel } from "@/lib/additions";
import { fileSize } from "@/lib/format";
import { useFinished } from "@/lib/usePress";
import { PressDone } from "@/components/PressDone";
import { Fold, ResizeBox } from "@/components/Panel";
import { LIST_PANEL } from "@/components/ScrollList";

/** `group`: 0 = sent first, 1… = the addition it was sent with (headed "Added"); unsent ones have none. (§167) `addedOn`: that addition's date, in the tester's zone. */
type Rec = { id: string; filename: string; size: number; uploaded: boolean; sent?: boolean; group?: number; addedOn?: string };

/** (Batch 35 §41) Send's result line shows under Send; an upload's under the upload box. */
const sending = (line: string) => line.startsWith("Sent ") || line.startsWith("Added ");

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");

/**
 * (Batch 13 section 7) One recording: a preview, its length and size. (Owner, Nov 3, batch 35 §136) A sent one is locked (no Remove); one not sent yet has Remove
 * (with a confirm).
 */
function RecordingRow({ r, sessionId, canRemove }: { r: Rec; sessionId: string; canRemove: boolean }) {
  const [length, setLength] = useState("");
  const [err, setErr] = useState("");
  // (Batch 35 §40, §41) Removed: the page redraws in place (the row goes); until then Remove stays greyed with its line.
  const fin = useFinished();
  return (
    <li className="space-y-1 rounded-lg border border-white/[0.08] p-2" data-recording-row={r.id} data-sent={r.sent ? "" : undefined}>
      <RecordingVideo className="max-h-56 w-full rounded bg-black" src={`/api/recordings/${r.id}/file`} onLength={(s) => setLength(clock(s))} />{/* (Nov 2, §119) old recordings too */}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <a href={`/api/recordings/${r.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 break-all">{r.filename}</a>
        <span className="text-xs text-slate-500">{length && `${length} · `}{fileSize(r.size)}{r.sent ? " · sent" : " · not sent yet"}</span>
        {canRemove && !r.sent && (
          <ConfirmButton disabled={fin.done} className="btn-ghost ml-auto !px-2 !py-0.5 text-xs" title="Remove this recording?" confirmLabel="Remove" body={<p>It&apos;s deleted and its slot is free again.</p>}
            onConfirm={() => api(`/api/sessions/${sessionId}/recording-remove`, { recordingId: r.id }).then(() => fin.finish("Removed.")).catch((e) => setErr(errOf(e)))}>
            Remove
          </ConfirmButton>
        )}
      </p>
      <PressDone line={fin.line} />
      <Err text={err} press="Remove" />
    </li>
  );
}

/**
 * Upload up to 5 screen recordings (500 MB each), then send them. (Owner, Oct 29, batch 13 section 7) Send sends them all together as ONE piece of work.
 * (Owner, Nov 3, batch 35 §136; replaces "until it's paid recordings can be removed or added and sent again") Sent recordings are locked: they can't be removed.
 * More can be added, within the 5: "Add more" opens the upload tools, and "Add my recording" sends the new ones, listed under the sent ones with "Added".
 * (Owner, Oct 31, batch 35 §40, §41) An upload, a recording made here, Remove and Send redraw the page in place; until the redraw has landed the pressed button
 * stays greyed with its line.
 */
/** (§156) The file box's press ("Or upload a recording"), named in its refusals. */
const UPLOAD_PRESS = "Upload a recording";

export function RecordingUpload({ sessionId, recordings, canSend, sentBefore, seenAt, sendable = true, lines = [] }: { /** (Batch 30 §2, §3) grey lines above Send */ lines?: string[]; sessionId: string; recordings: Rec[]; canSend: boolean; sentBefore: boolean; seenAt: string; /** (Batch 10) false while the test is paused: uploads (drafts) still work, Send is hidden */ sendable?: boolean }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fin = useFinished(() => { setBusy(false); setProgress(null); setBox(null); setBoxAt(""); });
  const uploaded = recordings.filter((r) => r.uploaded);
  const sent = uploaded.filter((r) => r.sent);
  const fresh = uploaded.filter((r) => !r.sent);
  const groups = [...new Set(sent.map((r) => r.group ?? 0))].sort((a, b) => a - b);
  // (Batch 35 §136) After a send the upload tools sit behind "Add more" (open while something waits to be added).
  const [adding, setAdding] = useState(false);
  const toolsOpen = !sentBefore || adding || fresh.length > 0;
  const n = fresh.length;
  const press = sentBefore ? `Add my recording${n === 1 ? "" : "s"}` : `Send my recording${n === 1 ? "" : "s"}`;

  // (§156) A refusal names the press it came from: the file box's upload, or Send / Add.
  const [errPress, setErrPress] = useState("");
  async function upload(file: File) {
    setErr("");
    setErrPress(UPLOAD_PRESS);
    if (file.size > 500 * 1024 * 1024) return setErr(FIELD + "Recordings can be at most 500 MB.");
    setBusy(true);
    try {
      await uploadToSession(sessionId, file, file.name, "recording", setProgress);
      setProgress(null);
      fin.finish("Uploaded.");
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2" data-mistakes-root="">
      {/* One list: what was sent first, then each addition under "Added"; then what isn't sent yet. (Owner, Nov 4, §182) It sits in "Your recording", a fold
          (open at first, kept open or closed), in the list panel (scrolls inside, the grip drags it, its height kept). */}
      {uploaded.length > 0 && (
        <Fold id={`own-recordings-${sessionId}`} summary={<span className="font-medium text-white" data-own-recordings-title="">{uploaded.length === 1 ? "Your recording" : `Your recordings (${uploaded.length})`}</span>}>
          <ResizeBox id={`own-recordings-list-${sessionId}`} label="Your recordings" defaultMax={LIST_PANEL.ownRecordings}>
            <div className="space-y-2" data-own-recordings="">
            {groups.map((g) => (
              <div key={g} className={g ? "space-y-1 border-t border-white/10 pt-2" : ""} data-recording-group={g}>
                {g > 0 && <p className="text-xs font-semibold text-emerald-300" data-added-label="">{(() => { const on = sent.find((r) => r.group === g)?.addedOn; return on ? addedLabel(on) : ADDED_LABEL; })()}</p>}
                <ul className="space-y-2" data-recordings="">
                  {sent.filter((r) => (r.group ?? 0) === g).map((r) => <RecordingRow key={r.id} r={r} sessionId={sessionId} canRemove={false} />)}
                </ul>
              </div>
            ))}
            {fresh.length > 0 && (
              <ul className="space-y-2" data-recordings="" data-not-sent="">
                {fresh.map((r) => <RecordingRow key={r.id} r={r} sessionId={sessionId} canRemove={canSend} />)}
              </ul>
            )}
            </div>
          </ResizeBox>
        </Fold>
      )}
      <p className="text-xs text-slate-500" data-recording-count="">{uploaded.length} of 5 recordings{uploaded.length >= 5 ? (fresh.length ? ": remove one to add another" : ": the most this part takes") : ""}</p>
      {canSend && uploaded.length < 5 && !toolsOpen && (
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" data-add-more="recording" onClick={() => setAdding(true)}>Add more</button>
      )}
      {canSend && uploaded.length < 5 && toolsOpen && (
        <>
          {sentBefore && <p className="note">What you sent stays as it is. New recordings are added under it.</p>}
          {/* (Batch 11) Record in the page, or upload a file. */}
          <ScreenRecorder sessionId={sessionId} part="recording" disabled={busy} />
          <label className="block text-sm">
            <span className="label">Or upload a recording (video, up to 500 MB; 5 at most)</span>
            <input type="file" id={`recording-file-${sessionId}`} accept={VIDEO_ACCEPT} disabled={busy} data-match="Choose a video in|500 MB|file is empty|upload a recording first" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; /* (batch 31 section 2) the same file can be picked again to retry */ if (f) upload(f); }} />
          </label>
        </>
      )}
      {progress != null && <p className="note">Uploading… {progress}%</p>}
      {fin.done && !sending(fin.line) && <PressDone line={fin.line} />}
      {canSend && sendable && fresh.length > 0 && lines.map((l) => <p key={l} className="note" data-above-send="">{l}</p>)}
      {canSend && sendable && fresh.length > 0 && (
        <button
          className="btn"
          disabled={busy}
          data-recording-send={sentBefore ? "add" : "send"}
          onClick={async (e) => {
            if (!offerShown() && !checkFields(e.currentTarget.parentElement)) return; // (batch 27 section 1) an open offer comes first
            setBusy(true);
            setErr("");
            setErrPress(press);
            try {
              await api(`/api/sessions/${sessionId}/recording-send`, { seenAt, confirmed, boxAt, ...(sentBefore ? { add: true } : {}) });
              setBox(null);
              setAdding(false);
              fin.finish(sentBefore ? `Added your recording${n === 1 ? "" : "s"}.` : `Sent your recording${n === 1 ? "" : "s"}.`);
            } catch (e) {
              const sb = stopBox(e); if (sb) { setBox(sb); setBoxAt(sb.now); }
              else setErr(errOf(e));
              setBusy(false);
            }
          }}
        >
          {press}
        </button>
      )}
      {canSend && !sendable && fresh.length > 0 && <p className="note" data-draft-kept="">Your recordings are kept. {sentBefore ? "Adding" : "Sending"} comes back when the test resumes.</p>}
      {sending(fin.line) && <PressDone line={fin.line} />}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {/* (Batch 16 section 10) A file mistake is red at the file box, and listed here. */}
      <FormMistakes text={err} press={err.startsWith(FIELD) ? press : errPress || press} />
    </div>
  );
}
