"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { JoinCall } from "@/components/JoinCall";

type Slot = { id: string; when: string; minutes: number };
type Mine = { id: string; when: string; minutes: number; room: string; canCancel: boolean; started: boolean; reported: boolean; cancelled: string; late?: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The tester's live-call panel: Book / Cancel stop once for call changes since the page loaded (box under this panel). */
export function TesterCallPanel(p: { sessionId: string; seenAt: string; label: string; open: Slot[]; mine: Mine[]; refusal: string; lateNote?: string }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} /></div> : null);
  const [report, setReport] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState("");
  async function go(action: string, body: Record<string, unknown>, key = action) {
    const r = await press(`/api/sessions/${p.sessionId}/${action}`, body, key);
    if (r) window.location.reload();
  }
  const upcoming = p.mine.some((m) => !m.cancelled && !m.started);
  return (
    <div className="space-y-2" id="calls">
      <section className="panel" aria-label="Live call">
        <h2>Live call</h2>
        <p className="note">{p.label}</p>
        {p.lateNote && !p.refusal && <p className="note">{p.lateNote}</p>}
        {p.mine.length > 0 && (
          <ul className="space-y-2 text-sm">
            {p.mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto">{fmt(m.when)} · {m.minutes} min{m.cancelled && ` · ${m.cancelled}`}{m.late && <span className="ml-2 badge">{m.late}</span>}</span>
                {!m.cancelled && <JoinCall callId={m.id} />}
                {!m.cancelled && !m.started && (m.canCancel ? <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: m.id }, "cancel-" + m.id)}>Cancel</button> : (
                  <span className="inline-flex gap-2">
                    <input className="input w-48" placeholder="Why? (less than 24 hours away)" value={report["c" + m.id] ?? ""} onChange={(e) => setReport({ ...report, ["c" + m.id]: e.target.value })} />
                    <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: m.id, reason: report["c" + m.id] ?? "" }, "cancel-" + m.id)}>Cancel</button>
                  </span>
                ))}
                {!m.cancelled && m.started && !m.reported && (
                  <span className="inline-flex gap-2">
                    <input className="input w-56" placeholder="The developer didn't show up…" value={report[m.id] ?? ""} onChange={(e) => setReport({ ...report, [m.id]: e.target.value })} />
                    <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: m.id, note: report[m.id] ?? "" }, "noshow-" + m.id)}>Report a problem</button>
                  </span>
                )}
                {m.reported && <span className="note">Problem reported to the team.</span>}
                {box("cancel-" + m.id)}
                {box("noshow-" + m.id)}
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
                  <button className="btn-ghost" disabled={busy} onClick={() => go("book", { slotId: s.id, ask }, "book-" + s.id)}>Book</button>
                  {box("book-" + s.id)}
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}
