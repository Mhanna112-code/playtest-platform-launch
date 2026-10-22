"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { JoinCall } from "@/components/JoinCall";

type Mine = { id: string; when: string; minutes: number; room: string; canCancel: boolean; started: boolean; reported: boolean; cancelled: string; late?: string; rate?: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The tester's live-call panel: Book / Cancel stop once for call changes since the page loaded (box under this panel). */
export function TesterCallPanel(p: { sessionId: string; seenAt: string; label: string; mine: Mine[]; refusal: string; lateNote?: string; rateLine?: string }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} /></div> : null);
  const [report, setReport] = useState<Record<string, string>>({});
  async function go(action: string, body: Record<string, unknown>, key = action) {
    const r = await press(`/api/sessions/${p.sessionId}/${action}`, body, key);
    if (r) window.location.reload();
  }
  return (
    <div className="space-y-2" id="calls">
      <section className="panel" aria-label="Live call">
        <h2>Live call</h2>
        <p className="note">{p.label}</p>
        {p.rateLine && <p className="note">{p.rateLine}</p>}
        {p.lateNote && !p.refusal && <p className="note">{p.lateNote}</p>}
        {p.mine.length > 0 && (
          <ul className="space-y-2 text-sm">
            {p.mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto">{fmt(m.when)} · {m.minutes} min{m.rate && ` · ${m.rate}`}{m.cancelled && ` · ${m.cancelled}`}{m.late && <span className="ml-2 badge">{m.late}</span>}</span>
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
      </section>
    </div>
  );
}
