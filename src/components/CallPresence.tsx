"use client";
// The full app's call presence (components/call-presence.tsx there), on lean data: the site keeps when each side first
// joined the room (Join call), not every visit. Around the call's time (from 10 minutes before until the room closes,
// 30 minutes after the end) it checks every 10 seconds while the page is visible: "Ana joined the call room at 3:01"
// (with the green dot) or "Ana hasn't joined yet". After the call, CallTimelineLine says the room's timeline.
import { useEffect, useState } from "react";

type Status = { line: string; other: { name: string; joinedAt: string | null }; meJoinedAt: string | null };

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const WINDOW_BEFORE = 10 * 60_000;
const AFTER_END = 30 * 60_000;

export function CallPresence({ callId, startsAt, minutes }: { callId: string; startsAt: string; minutes: number }) {
  const [s, setS] = useState<Status | null>(null);
  const start = new Date(startsAt).getTime();
  const closes = start + minutes * 60_000 + AFTER_END;
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() < start - WINDOW_BEFORE || Date.now() > closes) return;
      const r = await fetch(`/api/calls/${callId}/status`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r && r.other) setS(r);
    };
    void check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [callId, start, closes]);
  if (!s || s.line) return null;
  const here = !!s.other.joinedAt;
  return (
    <div data-call-presence="" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.05] px-3 py-2 text-sm" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${here ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
      <span className="min-w-0 flex-1 text-slate-200">
        {here ? <><strong className="text-white">{s.other.name}</strong> joined the call room at {clock(s.other.joinedAt!)}</> : <><strong className="text-white">{s.other.name}</strong> hasn&apos;t joined yet</>}
        {here && s.meJoinedAt && " · you joined too"}
      </span>
    </div>
  );
}

/** After the call: "Call room: Ana joined 3:00 · Nora joined 3:05 · both in from 3:05" (or "never joined"). */
export function CallTimelineLine({ people }: { people: { name: string; joinedAt: string | null }[] }) {
  const joined = people.filter((p) => p.joinedAt);
  const both = joined.length === people.length && people.length > 1 ? new Date(Math.max(...joined.map((p) => new Date(p.joinedAt!).getTime()))).toISOString() : null;
  return (
    <p data-call-timeline="" className="w-full text-xs text-slate-400">
      Call room: {[...people.map((p) => (p.joinedAt ? `${p.name} joined ${clock(p.joinedAt)}` : `${p.name} never joined`)), ...(both ? [`both in from ${clock(both)}`] : [])].join(" · ")}
    </p>
  );
}
