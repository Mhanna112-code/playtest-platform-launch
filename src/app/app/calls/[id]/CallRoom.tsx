"use client";
// (Owner, Oct 28, batch 21) The built-in call room, adapted from the full app's call room (src/app/call/[slotId]/call-room.tsx there): camera, microphone and screen
// sharing straight between the two browsers (WebRTC, "perfect negotiation": on a clash the tester's browser gives way), with the connection messages relayed through
// /api/calls/<id>/room by polling. Each poll says whether this browser is connected to the other: the time both were connected is the call's measured length. The
// server ends the call for real (150% of the booked length, the $1,000, a block, a pause, a suspension, a leave, End early or a Stop): both pages hang up at once and
// show "Call ended: <reason>"; the room can't be rejoined.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { CallCheck } from "@/components/CallCheck";
import { STRICT_NETWORK_LINE } from "@/lib/callMeasure";
import { TAB } from "@/lib/client";

type Ice = { urls: string | string[]; username?: string; credential?: string }[];
type Who = { callId: string; role: "tester" | "developer"; myName: string; otherName: string; iceServers: Ice };

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
/** Sends one message from the room (never a press: connection messages, "connected", "left"). */
const post = (callId: string, body: unknown, keepalive = false) =>
  fetch(`/api/calls/${callId}/room`, { method: "POST", headers: { "content-type": "application/json", "x-tab": TAB }, body: JSON.stringify(body), keepalive });

/** What shows when there's no picture: the person's initial and a note, as in the full app. */
function NoVideo({ name, note }: { name: string; note: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-volt-300/20 text-3xl font-semibold text-white" aria-hidden>{name.trim().charAt(0).toUpperCase() || "?"}</span>
      <span className="text-sm text-slate-300">{note}</span>
    </div>
  );
}

function Room({ callId, role, myName, otherName, iceServers, onEnded, onLeft }: Who & { onEnded: (line: string) => void; onLeft: (measured: number) => void }) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenSender = useRef<RTCRtpSender | null>(null);
  const [status, setStatus] = useState("Starting your camera…");
  const [otherHere, setOtherHere] = useState(false);
  const [measured, setMeasured] = useState(0);
  const [warn, setWarn] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [myVideo, setMyVideo] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [otherVideo, setOtherVideo] = useState(false);
  const [otherCam, setOtherCam] = useState(true);
  const [otherMic, setOtherMic] = useState(true);
  const [otherSharing, setOtherSharing] = useState(false);
  const [otherNoCamera, setOtherNoCamera] = useState(false);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  // What this browser shows the other (camera / microphone on or off, sharing), and the shared screen: kept for a fresh connection.
  const media = useRef({ mic: true, cam: true, noCamera: false, sharing: false });
  const screenTrack = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let stopped = false;
    let after = 0;
    let connected = false;
    let makingOffer = false;
    const polite = role === "tester"; // on a clash, the tester's browser gives way
    const send = (kind: string, payload: unknown) => post(callId, { kind, payload }).catch(() => null);
    // (Batch 21 section 3) Each side reports connecting and disconnecting: only the time both browsers are connected is measured.
    const report = (now: boolean) => {
      if (now === connected) return;
      connected = now;
      void send("state", { connected: now });
    };
    let pc: RTCPeerConnection | null = null;
    /** A fresh connection carrying this browser's camera and microphone (and the shared screen): at the start, and whenever the other person comes (back) into the room. */
    const connect = () => {
      const next = new RTCPeerConnection({ iceServers });
      pc = next;
      pcRef.current = next;
      screenSender.current = null;
      next.onicecandidate = (e) => {
        if (pc === next && e.candidate) void send("candidate", e.candidate.toJSON());
      };
      next.ontrack = (e) => {
        if (pc !== next) return;
        if (remoteRef.current && e.streams[0]) remoteRef.current.srcObject = e.streams[0];
        if (e.track.kind === "video") setOtherVideo(true);
      };
      next.onconnectionstatechange = () => {
        if (pc !== next) return;
        const s = next.connectionState;
        report(s === "connected");
        setStatus(s === "connected" ? "Connected" : s === "connecting" ? "Connecting…" : s === "failed" ? STRICT_NETWORK_LINE : s === "disconnected" ? `${otherName} lost connection…` : "Waiting…");
      };
      next.onnegotiationneeded = async () => {
        if (pc !== next) return;
        try {
          makingOffer = true;
          await next.setLocalDescription();
          await send("description", next.localDescription);
        } catch {
          // closed meanwhile
        } finally {
          makingOffer = false;
        }
      };
      const stream = streamRef.current;
      if (stream) for (const t of stream.getTracks()) next.addTrack(t, stream);
      const screen = screenTrack.current;
      if (screen && screen.readyState === "live") {
        const cameraSender = next.getSenders().find((x) => x.track?.kind === "video");
        if (cameraSender) void cameraSender.replaceTrack(screen);
        else screenSender.current = next.addTrack(screen, new MediaStream([screen]));
      }
    };
    const hangUp = () => {
      stopped = true;
      pc?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenTrack.current?.stop();
    };
    // Closing the tab or leaving the page: the other side is told at once.
    const bye = () => void post(callId, { kind: "leave" }, true).catch(() => null);
    window.addEventListener("pagehide", bye);

    (async () => {
      // Coming into the room clears the old connection messages and asks the other browser (if it's there) for a fresh connection with this one.
      await post(callId, { kind: "join" }).catch(() => null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;
        setMyVideo(stream.getVideoTracks().length > 0);
        media.current.noCamera = !stream.getVideoTracks().length;
        setStatus(`Waiting for ${otherName}…`);
      } catch {
        setStatus("Allow your camera or microphone to join (check the browser's permission prompt).");
      }
      if (stopped) return;
      connect();
      // No camera (none plugged in, or not allowed): tell the other side, so they see "No camera", not "Connecting…".
      if (media.current.noCamera) void send("media", { ...media.current, cam: false });
      // The relay loop: their messages, and "I'm here" (and "connected") for measuring the call.
      while (!stopped) {
        try {
          const r = await fetch(`/api/calls/${callId}/room?after=${after}&connected=${connected ? 1 : 0}`, { cache: "no-store", headers: { "x-tab": TAB } });
          const data = await r.json().catch(() => null);
          if (!r.ok) {
            if (r.status === 403 || r.status === 404) {
              hangUp();
              ended.current((data?.error?.line as string) || (data?.error?.message as string) || "This call isn't available.");
              break;
            }
          } else if (data) {
            setOtherHere(!!data.otherHere);
            setMeasured(Number(data.measured) || 0);
            setWarn(typeof data.warn === "string" ? data.warn : "");
            for (const s of data.signals as { id: number; kind: string; payload: string }[]) {
              after = Math.max(after, s.id);
              const msg = JSON.parse(s.payload);
              const cur = pcRef.current; // the connection now (a "join" replaces it)
              if (!cur) continue;
              if (s.kind === "description") {
                const collision = msg.type === "offer" && (makingOffer || cur.signalingState !== "stable");
                if (!polite && collision) continue; // ignore their offer; ours wins
                try {
                  await cur.setRemoteDescription(msg);
                  if (msg.type === "offer") {
                    await cur.setLocalDescription();
                    await send("description", cur.localDescription);
                  }
                } catch {
                  // an answer meant for an older connection
                }
              } else if (s.kind === "candidate") {
                try {
                  await cur.addIceCandidate(msg);
                } catch {
                  // candidates for an ignored offer
                }
              } else if (s.kind === "media") {
                setOtherCam(msg.cam !== false);
                setOtherMic(msg.mic !== false);
                setOtherNoCamera(!!msg.noCamera);
                setOtherSharing(!!msg.sharing);
              } else if (s.kind === "join") {
                // They came (back) into the room: a fresh connection, and what they should show of us.
                cur.close();
                report(false);
                if (remoteRef.current) remoteRef.current.srcObject = null;
                setOtherVideo(false);
                connect();
                void send("media", media.current);
              } else if (s.kind === "bye") {
                setStatus(`${otherName} left the call`);
                if (remoteRef.current) remoteRef.current.srcObject = null;
                setOtherVideo(false);
              }
            }
          }
        } catch {
          // a missed poll is fine
        }
        await new Promise((res) => setTimeout(res, pcRef.current?.connectionState === "connected" ? 2000 : 1000));
      }
    })();
    return () => {
      window.removeEventListener("pagehide", bye);
      hangUp();
    };
  }, [callId, role, otherName, iceServers]);

  const tell = (state: Partial<{ mic: boolean; cam: boolean; noCamera: boolean; sharing: boolean }>) => {
    media.current = { ...media.current, ...state };
    void post(callId, { kind: "media", payload: media.current }).catch(() => null);
  };
  const toggle = (kind: "audio" | "video") => {
    const tracks = kind === "audio" ? streamRef.current?.getAudioTracks() : streamRef.current?.getVideoTracks();
    tracks?.forEach((t) => {
      t.enabled = !t.enabled;
    });
    if (kind === "audio") setMic(!mic);
    else setCam(!cam);
    // Tell the other side, so they see your name instead of a black picture.
    tell(kind === "audio" ? { mic: !mic } : { cam: !cam });
  };
  const shareScreen = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const pc = pcRef.current;
      const track = screen.getVideoTracks()[0];
      if (!pc || !track) return;
      screenTrack.current = track;
      // With a camera, the screen takes its place; without one, the screen is sent as a new picture.
      const cameraSender = pc.getSenders().find((x) => x.track?.kind === "video" && x !== screenSender.current);
      if (cameraSender) await cameraSender.replaceTrack(track);
      else screenSender.current = pc.addTrack(track, screen);
      if (localRef.current) localRef.current.srcObject = screen;
      setSharing(true);
      tell({ sharing: true });
      track.onended = async () => {
        screenTrack.current = null;
        const now = pcRef.current;
        const cameraTrack = streamRef.current?.getVideoTracks()[0];
        const sender = now?.getSenders().find((x) => x.track === track);
        if (sender && cameraTrack && sender !== screenSender.current) await sender.replaceTrack(cameraTrack);
        if (now && screenSender.current) {
          now.removeTrack(screenSender.current);
          screenSender.current = null;
        }
        if (localRef.current) localRef.current.srcObject = streamRef.current;
        setSharing(false);
        tell({ sharing: false });
      };
    } catch {
      // cancelled
    }
  };
  const leave = async () => {
    const r = await post(callId, { kind: "leave" }).then((x) => x.json()).catch(() => null);
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    screenTrack.current?.stop();
    onLeft(typeof r?.measured === "number" ? r.measured : measured);
  };

  return (
    <div className="space-y-3" data-call-room="">
      {warn && <p className="info" role="status" data-call-warn="">{warn}</p>}
      <div className="grid items-start gap-3 md:grid-cols-[2fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video ref={remoteRef} autoPlay playsInline className="aspect-video w-full object-cover" aria-label={`${otherName}'s video`} />
          {!(otherVideo && (otherCam || otherSharing)) && <NoVideo name={otherName} note={!otherHere ? "Not here yet" : otherNoCamera ? "No camera" : !otherCam ? "Camera off" : "Connecting…"} />}
          {otherSharing && <span className="absolute right-3 top-3 rounded-full bg-sky-500/80 px-2.5 py-1 text-xs font-medium text-white">Sharing their screen</span>}
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">{!otherMic && <MicOff className="h-3.5 w-3.5 text-rose-300" aria-label="muted" />}{otherName}{otherHere ? "" : " · not here yet"}</span>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video ref={localRef} autoPlay playsInline muted className="aspect-video w-full object-cover" aria-label="Your video" />
          {!sharing && (!myVideo || !cam) && <NoVideo name={myName} note={!myVideo ? "No camera" : "Camera off"} />}
          {sharing && <span className="absolute right-3 top-3 rounded-full bg-sky-500/80 px-2.5 py-1 text-xs font-medium text-white">You&apos;re sharing your screen</span>}
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">{!mic && <MicOff className="h-3.5 w-3.5 text-rose-300" aria-label="muted" />}You</span>
        </div>
      </div>
      <div className="card flex flex-wrap items-center gap-2 py-3">
        <span className="min-w-0 flex-1 text-sm text-slate-300" role="status" data-call-status="">{status} · measured so far: <strong className="text-white">{measured} min</strong></span>
        <button type="button" onClick={() => toggle("audio")} className="btn-secondary px-3 py-1.5 text-sm" aria-pressed={!mic}>{mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} {mic ? "Mute" : "Unmute"}</button>
        <button type="button" onClick={() => toggle("video")} className="btn-secondary px-3 py-1.5 text-sm" aria-pressed={!cam}>{cam ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} {cam ? "Camera off" : "Camera on"}</button>
        <button type="button" onClick={shareScreen} className="btn-secondary px-3 py-1.5 text-sm"><MonitorUp className="h-4 w-4" /> Share screen</button>
        <button type="button" onClick={leave} className="btn-danger px-3 py-1.5 text-sm"><PhoneOff className="h-4 w-4" /> Leave</button>
      </div>
    </div>
  );
}

/**
 * The call page's room: the line that replaces it (cancelled, ended, closed), "You can join from 3:50 PM." before the room opens (then Join), and the room itself,
 * which starts at once when the page is opened while the room is open (Join call on the test or session page opens it).
 */
export function CallRoom({ initialLine, opensAt, back, ...who }: Who & { initialLine: string; opensAt: string; back: string }) {
  const [line, setLine] = useState(initialLine);
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState(() => !initialLine && Date.now() >= new Date(opensAt).getTime());
  const [session, setSession] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  // Outside the room (before it opens, or after leaving): checks every few seconds for a cancellation or an end.
  useEffect(() => {
    if (line || (started && left == null)) return;
    const t = setInterval(async () => {
      setNow(Date.now());
      const r = await fetch(`/api/calls/${who.callId}/status`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r && typeof r.line === "string" && r.line) setLine(r.line);
    }, 5000);
    return () => clearInterval(t);
  }, [who.callId, line, started, left]);

  if (line) return <p className="info" data-call-line="">{line}</p>;
  if (left != null)
    return (
      <div className="card space-y-3" data-call-left="">
        <p className="text-lg font-semibold text-white">You left the call</p>
        <p className="text-slate-300">Measured so far: <strong className="text-white">{left} minute{left === 1 ? "" : "s"}</strong> with both of you connected.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setLeft(null);
              setSession((n) => n + 1);
            }}
          >
            Rejoin
          </button>
          <Link href={back} className="btn-secondary">Back to the test</Link>
        </div>
      </div>
    );
  const open = now >= new Date(opensAt).getTime();
  if (!started)
    return (
      <div className="space-y-2">
        {open ? <button type="button" className="btn" data-call-join="" onClick={() => setStarted(true)}>Join</button> : <p className="note" data-call-join-later="">You can join from {clock(opensAt)}.</p>}
        <CallCheck />
      </div>
    );
  return <Room key={session} {...who} onEnded={setLine} onLeft={setLeft} />;
}
