"use client";
import { Err } from "@/components/Err";
import { checkFields } from "@/components/FieldChecks";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { ChangesBox } from "@/components/ChangesBox";

type Rec = { id: string; filename: string; size: number; uploaded: boolean };

/** Upload up to 5 screen recordings (500 MB each), then send them. Can be sent again with new ones until paid. */
export function RecordingUpload({ sessionId, recordings, canSend, sentBefore, initialAsk = "", seenAt }: { sessionId: string; recordings: Rec[]; canSend: boolean; sentBefore: boolean; initialAsk?: string; seenAt: string }) {
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [box, setBox] = useStopBox();
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // (Owner, Oct 26) An updated recording starts at the ask already sent; the tester may change it (raise it too) or clear it.
  const [ask, setAsk] = useState(initialAsk);
  const uploaded = recordings.filter((r) => r.uploaded);

  async function upload(file: File) {
    setErr("");
    if (file.size > 500 * 1024 * 1024) return setErr("Recordings can be at most 500 MB.");
    setBusy(true);
    try {
      const { recordingId, uploadUrl } = await api<{ recordingId: string; uploadUrl: string }>(`/api/sessions/${sessionId}/recording-start`, { filename: file.name, size: file.size, contentType: file.type || "video/mp4" });
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", uploadUrl);
        x.setRequestHeader("content-type", file.type || "video/mp4");
        x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        x.onload = () => (x.status < 300 ? resolve() : reject(new Error("The upload didn't finish. Try again.")));
        x.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
        x.send(file);
      });
      await api(`/api/sessions/${sessionId}/recording-done`, { recordingId });
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
        <label className="block text-sm">
          <span className="label">Add a recording (video, up to 500 MB; 5 at most)</span>
          <input type="file" accept="video/*" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
      {progress != null && <p className="note">Uploading… {progress}%</p>}
      {canSend && uploaded.length > 0 && (
        <label className="block text-sm">Ask $ <input className="input inline w-24" inputMode="decimal" placeholder="optional" aria-label="Ask for this" data-min="0" data-max="999999.99" data-msg="Ask $0 or more (Stripe can't take more than $999,999.99 in one charge)." value={ask} onChange={(e) => setAsk(e.target.value)} /> for this <span className="text-xs text-slate-500">at least $0</span></label>
      )}
      {canSend && uploaded.length > 0 && (
        <button
          className="btn"
          disabled={busy}
          onClick={async (e) => {
            if (!checkFields(e.currentTarget.parentElement)) return;
            setBusy(true);
            try {
              await api(`/api/sessions/${sessionId}/recording-send`, { ask, seenAt, confirmed, boxAt });
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
