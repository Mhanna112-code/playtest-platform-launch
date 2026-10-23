"use client";
import { useEffect, useState } from "react";

/** The room: closes at once (for both, in every tab) when the call is cancelled or either side blocks the other. */
export function CallRoom({ callId, room, initialLine, initialBoth }: { callId: string; room: string; initialLine: string; initialBoth: string | null }) {
  const [line, setLine] = useState(initialLine);
  const [both, setBoth] = useState(initialBoth);
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/calls/${callId}/status`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (r && typeof r.line === "string") {
        setLine(r.line);
        setBoth(r.bothJoinedAt);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [callId]);
  if (line) return <p className="info">{line}</p>;
  return (
    <div className="space-y-2">
      {both && <p className="note">Both joined at {new Date(both).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>}
      <iframe title="Call room" src={room} allow="camera; microphone; display-capture" className="h-[70vh] w-full rounded-lg border border-white/10" />
      <p className="note">Trouble with the video? <a href={room} target="_blank" rel="noreferrer">Open the room in a new tab</a>.</p>
    </div>
  );
}
