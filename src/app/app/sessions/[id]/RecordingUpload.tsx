"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { uploadToSession } from "@/lib/upload";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { ChangesBox } from "@/components/ChangesBox";

type Rec = { id: string; filename: string; size: number; uploaded: boolean };

/** Upload up to 5 screen recordings (500 MB each), then send them. Can be sent again with new ones until paid. */
export function RecordingUpload({ sessionId, recordings, canSend, sentBefore, seenAt, sendable = true }: { sessionId: string; recordings: Rec[]; canSend: boolean; sentBefore: boolean; seenAt: string; /** (Batch 10) false while the test is paused: uploads (drafts) still work, Send is hidden */ sendable?: boolean }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const uploaded = recordings.filter((r) => r.uploaded);

  async function upload(file: File) {
    setErr("");
    if (file.size > 500 * 1024 * 1024) return setErr("Recordings can be at most 500 MB.");
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
    <div className="space-y-2">
      {uploaded.length > 0 && (
        <ul className="text-sm">
          {uploaded.map((r) => (
            <li key={r.id}>
              <a href={`/api/recordings/${r.id}/file`} target="_blank" rel="noreferrer">{r.filename}</a> · {(r.size / 1024 / 1024).toFixed(1)} MB
            </li>
          ))}
        </ul>
      )}
      {canSend && recordings.length < 5 && (
        <>
          {/* (Batch 11) Record in the page, or upload a file. */}
          <ScreenRecorder sessionId={sessionId} part="recording" />
          <label className="block text-sm">
            <span className="label">Or upload a recording (video, up to 500 MB; 5 at most)</span>
            <input type="file" accept="video/*" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </>
      )}
      {progress != null && <p className="note">Uploading… {progress}%</p>}
      {canSend && sendable && uploaded.length > 0 && (
        <button
          className="btn"
          disabled={busy}
          onClick={async (e) => {
            if (!checkFields(e.currentTarget.parentElement)) return;
            setBusy(true);
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
          {sentBefore ? "Send my updated recording" : "Send my recording"}
        </button>
      )}
      <ChangesBox changes={box && !box.top ? box.changes : null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
