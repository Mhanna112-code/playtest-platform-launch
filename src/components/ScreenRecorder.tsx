"use client";
import { useEffect, useRef, useState } from "react";
import { Err } from "@/components/Err";
import { uploadToSession } from "@/lib/upload";

type Phase = { name: "idle" } | { name: "recording"; started: number } | { name: "review"; blob: Blob; url: string } | { name: "uploading"; pct: number };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * (Owner, Oct 29, batch 11) "Record" on the session page: records the screen (and the microphone if allowed) in the browser with getDisplayMedia + MediaRecorder, with a
 * timer and Stop, then a preview, then uploads through the recording upload (500 MB, 5 per session). `part`: the Recording part, or attached to the written part.
 * Modelled on the full app's recording-uploader.
 */
export function ScreenRecorder({ sessionId, part, label = "Record", onUploaded, onUploadProgress, onUploadError, onStart, onCancel, disabled = false }: { sessionId: string; part: "recording" | "written"; label?: string; onUploaded?: (id: string, filename: string, file: Blob, tag: string) => void; onUploadProgress?: (filename: string, pct: number) => void; onUploadError?: () => void; onStart?: () => void; onCancel?: () => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [can, setCan] = useState(false);
  const [withMic, setWithMic] = useState(true);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(0);
  const live = useRef<{ recorder: MediaRecorder; streams: MediaStream[]; ctx: AudioContext } | null>(null);
  useEffect(() => setCan(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined"), []);
  useEffect(() => {
    if (phase.name !== "recording") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase.name]);
  useEffect(() => () => stop(), []);

  async function start() {
    onStart?.();
    setErr("");
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch {
      onCancel?.();
      return setErr("Screen sharing was cancelled or blocked by the browser.");
    }
    let mic: MediaStream | null = null;
    if (withMic) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { setErr("No microphone access, so this recording has no voice."); }
    }
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const s of [screen, mic]) if (s && s.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
    const stream = new MediaStream([...screen.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      setPhase({ name: "review", blob, url: URL.createObjectURL(blob) });
    };
    live.current = { recorder, streams: [screen, ...(mic ? [mic] : [])], ctx };
    screen.getVideoTracks()[0].addEventListener("ended", stop); // the browser's own "Stop sharing"
    recorder.start(1000);
    setNow(Date.now());
    setPhase({ name: "recording", started: Date.now() });
  }

  function stop() {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (l.recorder.state !== "inactive") l.recorder.stop();
    l.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void l.ctx.close();
  }

  async function upload(blob: Blob) {
    setErr("");
    setPhase({ name: "uploading", pct: 0 });
    try {
      const filename = `recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
      onUploadProgress?.(filename, 0);
      const { id, tag } = await uploadToSession(sessionId, blob, filename, part, (pct) => { setPhase({ name: "uploading", pct }); onUploadProgress?.(filename, pct); });
      if (onUploaded) onUploaded(id, filename, blob, tag); else window.location.reload();
      setPhase({ name: "idle" });
    } catch (e) {
      onUploadError?.();
      setErr((e as Error).message);
      setPhase({ name: "review", blob, url: URL.createObjectURL(blob) });
    }
  }

  if (!can) return null;
  const elapsed = phase.name === "recording" ? Math.max(0, Math.floor((now - phase.started) / 1000)) : 0;
  return (
    <div className="space-y-2 text-sm" data-recorder={part}>
      {phase.name === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" disabled={disabled} onClick={start}>{label}</button>
          <label className="flex items-center gap-1.5 text-xs text-slate-400"><input type="checkbox" checked={withMic} onChange={(e) => setWithMic(e.target.checked)} /> With my microphone</label>
        </div>
      )}
      {phase.name === "recording" && (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-rose-200"><span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" /> Recording {clock(elapsed)}</span>
          <button type="button" className="btn-danger" onClick={stop}>Stop</button>
        </div>
      )}
      {phase.name === "review" && (
        <div className="space-y-2">
          <video src={phase.url} controls className="max-h-72 w-full rounded bg-black" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={disabled} onClick={() => upload(phase.blob)}>Upload this recording</button>
            <button type="button" className="btn-ghost" onClick={() => { onCancel?.(); setPhase({ name: "idle" }); }}>Discard</button>
          </div>
        </div>
      )}
      {phase.name === "uploading" && <p className="note">Uploading… {phase.pct}%</p>}
      <Err text={err} />
    </div>
  );
}
