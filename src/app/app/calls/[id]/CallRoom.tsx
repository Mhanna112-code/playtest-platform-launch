"use client";
import { useEffect, useState } from "react";
import { CALL_JOIN_LINE } from "@/lib/rules";
import { CallCheckLink } from "@/components/CallCheckLink";

/**
 * The room (its heartbeats measure the call's length): closes at once (for both, in every tab) when the call is cancelled, either side blocks the other, or (batch 18
 * section 3) its pay reaches what's left of the $1,000 for that tester's calls on the test; from 10 minutes before that, a line says when it ends.
 */
export function CallRoom({ callId, room, initialLine, initialBoth, initialCapLine = "", hostLine = "", opensAt = "", checkUrl = "" }: { callId: string; room: string; initialLine: string; initialBoth: string | null; initialCapLine?: string; /** (batch 18 section 12) the Jitsi host line for this side */ hostLine?: string; /** (batch 18 section 13) Join opens 10 minutes before the start */ opensAt?: string; /** this account's practice room */ checkUrl?: string }) {
  const [line, setLine] = useState(initialLine);
  const [both, setBoth] = useState(initialBoth);
  const [capLine, setCapLine] = useState(initialCapLine);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/calls/${callId}/status`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (r && typeof r.line === "string") {
        setLine(r.line);
        setBoth(r.bothJoinedAt);
        setCapLine(typeof r.capLine === "string" ? r.capLine : "");
      }
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(t);
  }, [callId]);
  // (Batch 15 section 40) While this page is open it tells the site every ~10 seconds that this person is here: the call's length is measured from both people's presence.
  useEffect(() => {
    if (line) return;
    const beat = () => void fetch(`/api/calls/${callId}/presence`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true }).catch(() => null);
    beat();
    const t = setInterval(beat, 10_000);
    return () => clearInterval(t);
  }, [callId, line]);
  if (line) return <p className="info" data-call-line="">{line}</p>;
  // (Batch 18 section 13) Join for the real call opens only 10 minutes before the start; the practice room is there from booking on.
  const open = !opensAt || now >= new Date(opensAt).getTime();
  return (
    <div className="space-y-2">
      {capLine && <p className="info" role="status" data-call-cap="">{capLine}</p>}
      {both && <p className="note">Both joined at {new Date(both).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>}
      {/* (Batch 18 section 10) The call runs in its Jitsi room, in a new tab; this page stays open and measures it. */}
      {open ? <a className="btn no-underline hover:no-underline" href={room} target="_blank" rel="noreferrer" data-call-join="">Join</a>
        : <p className="note" data-call-join-later="">You can join from {new Date(opensAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.</p>}
      <p className="note" data-call-join-line="">{CALL_JOIN_LINE}</p>
      {hostLine && <p className="note" data-call-host-line="">{hostLine}</p>}
      <CallCheckLink url={checkUrl} />
    </div>
  );
}
