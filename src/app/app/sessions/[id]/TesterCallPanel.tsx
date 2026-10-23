"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { JoinCall } from "@/components/JoinCall";
import { CalendarPlus } from "lucide-react";
import { CallTimer } from "@/components/CallTimer";
import { CallPresence, CallTimelineLine } from "@/components/CallPresence";
import { LIVE_SECTIONS, LiveSection } from "@/components/LivePanel";

type Mine = { id: string; when: string; minutes: number; room: string; canCancel: boolean; started: boolean; ended?: boolean; reported: boolean; cancelled: string; late?: string; rate?: string; joinable?: boolean; devJoinedAt?: string | null; testerJoinedAt?: string | null; joined?: string; outcome?: { label: string; tone: "grey" | "amber" | "green" | "rose" }[]; logged?: number | null };
const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-400/40 text-rose-200" } as const;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The tester's calls inside the Live session panel: Booked (still ahead or running: Join call while it can be joined,
 * Cancel) and Past calls (over or cancelled). Cancel and Report a problem stop once for call changes since the page
 * loaded (box under the button).
 */
export function TesterCallPanel(p: { sessionId: string; seenAt: string; mine: Mine[]; refusal: string; lateNote?: string; devName: string }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} /></div> : null);
  const [report, setReport] = useState<Record<string, string>>({});
  async function go(action: string, body: Record<string, unknown>, key = action) {
    const r = await press(`/api/sessions/${p.sessionId}/${action}`, body, key);
    if (r) window.location.reload();
  }
  const booked = p.mine.filter((m) => !m.cancelled && !m.ended);
  const past = p.mine.filter((m) => m.cancelled || m.ended);
  const row = (m: Mine) => (
    <li key={m.id} data-call={m.cancelled || m.ended ? "past" : "booked"} className="flex flex-wrap items-center gap-2 py-2 text-sm">
      {m.ended || m.cancelled ? (
        // Past calls (the full app's PastRow): when · length · who joined · outcome badges.
        <span className="mr-auto flex flex-wrap items-center gap-2">
          <span className="text-slate-200">{fmt(m.when)}</span>
          <span className="text-slate-400">· {m.logged ?? m.minutes} min{m.logged != null && m.logged !== m.minutes ? ` (booked ${m.minutes})` : ""}</span>
          {m.joined && !m.cancelled && <span className="text-xs text-slate-400">{m.joined}</span>}
          {(m.outcome ?? []).map((o) => <span key={o.label} className={`badge ${TONE[o.tone]}`}>{o.label}</span>)}
        </span>
      ) : (
        <span className="mr-auto text-slate-200">{fmt(m.when)} · {m.minutes} min{m.rate && ` · ${m.rate}`}{m.late && <span className="ml-2 badge">{m.late}</span>}</span>
      )}
      {!m.cancelled && m.joinable && <JoinCall callId={m.id} />}
      {!m.cancelled && !m.ended && <a href={`/api/calls/${m.id}/ics`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline"><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>}
      {!m.cancelled && !m.started && (m.canCancel ? <button className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => go("cancel-call", { callId: m.id }, "cancel-" + m.id)}>Cancel</button> : (
        <span className="inline-flex gap-2">
          <input className="input w-48" placeholder="Why? (less than 24 hours away)" value={report["c" + m.id] ?? ""} onChange={(e) => setReport({ ...report, ["c" + m.id]: e.target.value })} />
          <button className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => go("cancel-call", { callId: m.id, reason: report["c" + m.id] ?? "" }, "cancel-" + m.id)}>Cancel</button>
        </span>
      ))}
      {!m.cancelled && m.started && !m.reported && (
        <span className="inline-flex gap-2">
          <input className="input w-56" placeholder="The developer didn't show up…" value={report[m.id] ?? ""} onChange={(e) => setReport({ ...report, [m.id]: e.target.value })} />
          <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: m.id, note: report[m.id] ?? "" }, "noshow-" + m.id)}>Report a problem</button>
        </span>
      )}
      {m.reported && <span className="note">Problem reported to the team.</span>}
      {!m.cancelled && m.joinable && <div className="w-full"><CallPresence callId={m.id} startsAt={m.when} minutes={m.minutes} /></div>}
      {m.ended && !m.cancelled && <CallTimelineLine people={[{ name: p.devName, joinedAt: m.devJoinedAt ?? null }, { name: "You", joinedAt: m.testerJoinedAt ?? null }]} />}
      {!m.cancelled && m.joinable && <div className="w-full"><CallTimer startsAt={m.when} minutes={m.minutes} role="tester" label={`Call with ${p.devName}`} /></div>}
      {box("cancel-" + m.id)}
      {box("noshow-" + m.id)}
    </li>
  );
  if (!p.mine.length) return null;
  return (
    <div className="space-y-4" id="calls">
      {p.lateNote && !p.refusal && <p className="note">{p.lateNote}</p>}
      <LiveSection title={LIVE_SECTIONS.booked} show={booked.length > 0}>{booked.map(row)}</LiveSection>
      <LiveSection title={LIVE_SECTIONS.past} show={past.length > 0}>{past.map(row)}</LiveSection>
    </div>
  );
}
