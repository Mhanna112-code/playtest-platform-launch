"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

type Slot = { id: string; when: string; minutes: number };
type Mine = { id: string; when: string; minutes: number; room: string; canCancel: boolean; started: boolean; reported: boolean; cancelled: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The tester's live-call panel: Book / Cancel stop once for call changes since the page loaded (box under this panel). */
export function TesterCallPanel(p: { sessionId: string; seenAt: string; label: string; open: Slot[]; mine: Mine[]; refusal: string }) {
  const { press, changes, error, busy } = usePress(p.seenAt);
  const [report, setReport] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState("");
  async function go(action: string, body: Record<string, unknown>) {
    const r = await press(`/api/sessions/${p.sessionId}/${action}`, body);
    if (r) window.location.reload();
  }
  const upcoming = p.mine.some((m) => !m.cancelled && !m.started);
  return (
    <div className="space-y-2" id="calls">
      <section className="panel" aria-label="Live call">
        <h2>Live call</h2>
        <p className="note">{p.label}</p>
        {p.mine.length > 0 && (
          <ul className="space-y-2 text-sm">
            {p.mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto">{fmt(m.when)} · {m.minutes} min{m.cancelled && ` · ${m.cancelled}`}</span>
                {!m.cancelled && <a className="btn-ghost" href={m.room} target="_blank" rel="noreferrer">Join call</a>}
                {!m.cancelled && !m.started && (m.canCancel ? <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: m.id })}>Cancel</button> : (
                  <span className="inline-flex gap-2">
                    <input className="input w-48" placeholder="Why? (less than 24 hours away)" value={report["c" + m.id] ?? ""} onChange={(e) => setReport({ ...report, ["c" + m.id]: e.target.value })} />
                    <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: m.id, reason: report["c" + m.id] ?? "" })}>Cancel</button>
                  </span>
                ))}
                {!m.cancelled && m.started && !m.reported && (
                  <span className="inline-flex gap-2">
                    <input className="input w-56" placeholder="The developer didn't show up…" value={report[m.id] ?? ""} onChange={(e) => setReport({ ...report, [m.id]: e.target.value })} />
                    <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: m.id, note: report[m.id] ?? "" })}>Report a problem</button>
                  </span>
                )}
                {m.reported && <span className="note">Problem reported to the team.</span>}
              </li>
            ))}
          </ul>
        )}
        {!p.refusal && !upcoming && p.open.length > 0 && (
          <label className="block text-sm">Ask $ <input className="input inline w-24" inputMode="decimal" placeholder="optional" value={ask} onChange={(e) => setAsk(e.target.value)} /> for this call</label>
        )}
        {!p.refusal && !upcoming && (
          p.open.length === 0 ? <p className="note">No call times offered yet. You&apos;ll get an email when there are.</p> : (
            <ul className="space-y-1 text-sm">
              {p.open.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="mr-auto">{fmt(s.when)} · {s.minutes} min</span>
                  <button className="btn-ghost" disabled={busy} onClick={() => go("book", { slotId: s.id, ask })}>Book</button>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
      <ChangesBox changes={changes} error={error} />
    </div>
  );
}
