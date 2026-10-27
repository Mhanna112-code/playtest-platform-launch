"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { uploadToSession } from "@/lib/upload";

type Item = { id: string; filename: string; size: number; uploaded: boolean; video: boolean; sent: boolean };

/**
 * (Owner, Oct 29, batch 11) Files and recordings attached to the written part: up to 5 files of 25 MB (images, PDF, plain text, zip), plus screen recordings (recorded
 * here with Record, or uploaded; they count toward the 5 recordings). They go to the developer with the written answers when they are sent.
 */
export function WrittenAttachments({ sessionId, items, canAdd }: { sessionId: string; items: Item[]; canAdd: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const uploaded = items.filter((i) => i.uploaded);
  const files = uploaded.filter((i) => !i.video).length;
  async function add(file: File) {
    setErr("");
    if (!file.type.startsWith("video/") && file.size > 25 * 1024 * 1024) return setErr("Files can be at most 25 MB.");
    setBusy(true);
    try {
      await uploadToSession(sessionId, file, file.name, "written", setPct);
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      setPct(null);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.08] p-3 text-sm" data-written-attachments="">
      <p className="font-medium text-white">Files and recordings</p>
      {uploaded.length > 0 && (
        <ul className="space-y-1">
          {uploaded.map((i) => (
            <li key={i.id}><a href={`/api/recordings/${i.id}/file`} target="_blank" rel="noreferrer">{i.filename}</a> · {(i.size / 1024 / 1024).toFixed(1)} MB{i.sent ? "" : <span className="ml-1 text-xs text-amber-200">· goes with your answers when you send them</span>}</li>
          ))}
        </ul>
      )}
      {canAdd && (
        <>
          {files < 5 && (
            <label className="block">
              <span className="label">Attach a file (images, PDF, text or zip; 25 MB each, 5 at most) or a video</span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.zip,application/zip,video/*" disabled={busy} onChange={(e) => e.target.files?.[0] && add(e.target.files[0])} />
            </label>
          )}
          <ScreenRecorder sessionId={sessionId} part="written" label="Record your screen" />
        </>
      )}
      {pct != null && <p className="note">Uploading… {pct}%</p>}
      <Err text={err} />
    </div>
  );
}
