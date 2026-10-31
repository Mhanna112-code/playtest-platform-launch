"use client";
import { useEffect, useState } from "react";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD, errOf } from "@/lib/client";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { uploadToSession } from "@/lib/upload";
import { fileSize } from "@/lib/format";

type Item = { id: string; filename: string; size: number; uploaded: boolean; video: boolean; sent: boolean };

/**
 * (Owner, Oct 29, batch 11) Files and recordings attached to the written part: up to 5 files of 500 MB each (batch 31 section 2; was 25 MB: images, PDF, plain text, zip), plus screen recordings (recorded
 * here with Record, or uploaded; they count toward the 5 recordings). They go to the developer with the written answers when they are sent.
 */
export function WrittenAttachments({ sessionId, items, canAdd }: { sessionId: string; items: Item[]; canAdd: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [liveItems, setLiveItems] = useState(items);
  const [places, setPlaces] = useState<{ id: string; labels: string[] }[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ attachments: { id: string; filename: string; size: number; contentType: string }[]; places: { id: string; labels: string[] }[] }>).detail;
      setPlaces(detail.places);
      setLiveItems((old) => detail.attachments.map((a) => ({ ...a, uploaded: true, video: a.contentType.startsWith("video/"), sent: old.find((i) => i.id === a.id)?.sent ?? false })));
    };
    window.addEventListener(`written-files:${sessionId}`, receive);
    return () => window.removeEventListener(`written-files:${sessionId}`, receive);
  }, [sessionId, items]);
  const uploaded = liveItems.filter((i) => i.uploaded);
  const files = uploaded.filter((i) => !i.video).length;
  async function add(file: File) {
    setErr("");
    if (!file.type.startsWith("video/") && file.size > 500 * 1024 * 1024) return setErr(FIELD + "Files can be at most 500 MB.");
    setBusy(true);
    try {
      await uploadToSession(sessionId, file, file.name, "written", setPct);
      window.location.reload();
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
      setPct(null);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.08] p-3 text-sm" data-written-attachments="" data-mistakes-root="">
      <p className="font-medium text-white">Files and recordings</p>
      {uploaded.length > 0 && (
        <ul className="space-y-1">
          {uploaded.map((i) => (
            <li key={i.id}><a href={`/api/recordings/${i.id}/file`} target="_blank" rel="noreferrer">{i.filename}</a> <span className="text-slate-400">{places.find((p) => p.id === i.id)?.labels.map((q) => `in your answer to “${q}”`).join("; ") || "not in an answer"}</span> · {fileSize(i.size)}{i.sent ? "" : <span className="ml-1 text-xs text-amber-200">· goes with your answers when you send them</span>}</li>
          ))}
        </ul>
      )}
      {canAdd && (
        <>
          {files < 5 && (
            <label className="block">
              <span className="label">Attach a file (images, PDF, text or zip; 500 MB each, 5 at most) or a video</span>
              <input type="file" id={`attach-${sessionId}`} accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.zip,application/zip,video/*" data-match="attach an image|video file|at most|file is empty" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; /* (batch 31 section 2) the same file can be picked again to retry */ if (f) add(f); }} />
            </label>
          )}
          <ScreenRecorder sessionId={sessionId} part="written" label="Record your screen" />
        </>
      )}
      {pct != null && <p className="note">Uploading… {pct}%</p>}
      {/* (Batch 16 section 10) A file mistake is red at the file box and listed. */}
      <FormMistakes text={err} press="Attach" />
    </div>
  );
}
