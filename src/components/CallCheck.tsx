"use client";
/**
 * (Owner, Oct 28, batch 18 section 13; batch 21 section 1) "Check your call setup", from the moment a call is booked: a small in-app panel that previews your camera
 * and shows your microphone level, in this browser only. It never makes a call, never talks to the server and is never measured.
 */
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { CALL_CHECK_LABEL, CALL_CHECK_NOTE } from "@/lib/rules";

export const CALL_CHECK_BLOCKED = "Allow your camera and microphone in the browser's permission prompt to check them.";

function CheckPanel({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [level, setLevel] = useState(0);
  const [cam, setCam] = useState<boolean | null>(null);
  const [mic, setMic] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        setCam(stream.getVideoTracks().length > 0);
        setMic(stream.getAudioTracks().length > 0);
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (stream.getAudioTracks().length) {
          ctx = new AudioContext();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            setLevel(Math.min(1, peak / 64));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch {
        setError(CALL_CHECK_BLOCKED);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => null);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="mt-2 w-full max-w-sm space-y-2 rounded-xl border border-white/10 bg-ink-950/60 p-3" data-call-check-panel="">
      {error ? <p className="info">{error}</p> : (
        <>
          <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" aria-label="Your camera" />
            {cam === false && <span className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">No camera found</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Mic className="h-4 w-4" />
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-label="Microphone level"><span className="block h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></span>
            {mic === false && <span>No microphone found</span>}
          </div>        </>
      )}
      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={onClose}>Done</button>
    </div>
  );
}

export function CallCheck({ show = true, className = "" }: { show?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 text-xs ${className}`} data-call-check="">
      <button type="button" className="text-sky-300 hover:underline" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{CALL_CHECK_LABEL}</button>
      <span className="text-slate-400">{CALL_CHECK_NOTE}</span>
      {open && <CheckPanel onClose={() => setOpen(false)} />}
    </span>
  );
}
