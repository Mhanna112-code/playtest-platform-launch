"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { useState } from "react";
import { api, errOf, FIELD, offerShown } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { uploadToSession } from "@/lib/upload";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NOTHING_CHANGED_LINE } from "@/lib/rules";

type Rec = { id: string; filename: string; size: number; uploaded: boolean; sent?: boolean };

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");

/** (Batch 13 section 7) One recording before sending: a preview, its length and size, and Remove (with a confirm). */
function RecordingRow({ r, sessionId, canRemove }: { r: Rec; sessionId: string; canRemove: boolean }) {
  const [length, setLength] = useState("");
  const [err, setErr] = useState("");
  return (
    <li className="space-y-1 rounded-lg border border-white/[0.08] p-2" data-recording-row={r.id}>
      <video controls preload="metadata" className="max-h-56 w-full rounded bg-black" src={`/api/recordings/${r.id}/file`} onLoadedMetadata={(e) => setLength(clock(e.currentTarget.duration))} />
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <a href={`/api/recordings/${r.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 break-all">{r.filename}</a>
        <span className="text-xs text-slate-500">{length && `${length} · `}{(r.size / 1024 / 1024).toFixed(1)} MB{r.sent ? " · sent" : " · not sent yet"}</span>
        {canRemove && (
          <ConfirmButton className="btn-ghost ml-auto !px-2 !py-0.5 text-xs" title="Remove this recording?" confirmLabel="Remove" body={<p>{r.sent ? "It stays with what you sent until you send again; then it's left out. Its slot is free at once." : "It's deleted and its slot is free again."}</p>}
            onConfirm={() => api(`/api/sessions/${sessionId}/recording-remove`, { recordingId: r.id }).then(() => window.location.reload()).catch((e) => setErr(errOf(e)))}>
            Remove
          </ConfirmButton>
        )}
      </p>
      <Err text={err} />
    </li>
  );
}

/**
 * Upload up to 5 screen recordings (500 MB each), then send them. (Owner, Oct 29, batch 13 section 7) Send sends them all together as ONE piece of work; until it's paid
 * (or rejected) recordings can be removed or added and sent again.
 */
export function RecordingUpload({ sessionId, recordings, canSend, sentBefore, seenAt, sendable = true, removedSince = false }: { sessionId: string; recordings: Rec[]; canSend: boolean; sentBefore: boolean; seenAt: string; /** (Batch 10) false while the test is paused: uploads (drafts) still work, Send is hidden */ sendable?: boolean; /** (Batch 20 section 26) a sent recording removed since */ removedSince?: boolean }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const uploaded = recordings.filter((r) => r.uploaded);
  // (Owner, Oct 28, batch 20 section 26) Sent and nothing added or removed since: the updated Send waits.
  const unchanged = sentBefore && uploaded.every((r) => r.sent) && !removedSince;

  async function upload(file: File) {
    setErr("");
    if (file.size > 500 * 1024 * 1024) return setErr(FIELD + "Recordings can be at most 500 MB.");
    setBusy(true);
    try {
      await uploadToSession(sessionId, file, file.name, "recording", setProgress);
      window.location.reload();
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2" data-mistakes-root="">
      {uploaded.length > 0 && (
        <ul className="space-y-2" data-recordings="">
          {uploaded.map((r) => <RecordingRow key={r.id} r={r} sessionId={sessionId} canRemove={canSend} />)}
        </ul>
      )}
      <p className="text-xs text-slate-500" data-recording-count="">{uploaded.length} of 5 recordings{uploaded.length >= 5 ? ": remove one to add another" : ""}</p>
      {canSend && uploaded.length < 5 && (
        <>
          {/* (Batch 11) Record in the page, or upload a file. */}
          <ScreenRecorder sessionId={sessionId} part="recording" />
          <label className="block text-sm">
            <span className="label">Or upload a recording (video, up to 500 MB; 5 at most)</span>
            <input type="file" id={`recording-file-${sessionId}`} accept="video/*" disabled={busy} data-match="video file|500 MB|file is empty|upload a recording first" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; /* (batch 31 section 2) the same file can be picked again to retry */ if (f) upload(f); }} />
          </label>
        </>
      )}
      {progress != null && <p className="note">Uploading… {progress}%</p>}
      {canSend && sendable && uploaded.length > 0 && (
        <button
          className={`btn ${unchanged ? "!bg-white/10 !text-ink-400 !shadow-none" : ""}`}
          disabled={busy || unchanged}
          title={unchanged ? NOTHING_CHANGED_LINE : undefined}
          data-send-idle={unchanged ? "" : undefined}
          onClick={async (e) => {
            if (!offerShown() && !checkFields(e.currentTarget.parentElement)) return; // (batch 27 section 1) an open offer comes first
            setBusy(true);
            setErr("");
            try {
              await api(`/api/sessions/${sessionId}/recording-send`, { seenAt, confirmed, boxAt });
              window.location.reload();
            } catch (e) {
              const sb = stopBox(e); if (sb) { setBox(sb); setBoxAt(sb.now); }
              else setErr(errOf(e));
              setBusy(false);
            }
          }}
        >
          {sentBefore ? `Send my updated recording${uploaded.length === 1 ? "" : "s"}` : `Send my recording${uploaded.length === 1 ? "" : "s"}`}
        </button>
      )}
      <ChangesBox side="tester" changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      {/* (Batch 16 section 10) A file mistake is red at the file box, and listed here. */}
      <FormMistakes text={err} press={sentBefore ? "Send my updated recording" : "Send my recording"} />
    </div>
  );
}
