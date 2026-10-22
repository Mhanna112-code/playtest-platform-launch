"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { JoinCall } from "@/components/JoinCall";

type Booked = { id: string; when: string; minutes: number; name: string; room: string; canCancel: boolean; started: boolean; reported: boolean; late?: string; rate?: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The developer's live-call panel: offer / remove times, cancel a booked call. Its stop-once box sits under this panel. */
export function CallPanel(p: { testId: string; seenAt: string; booked: Booked[] }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} /></div> : null);
  const [report, setReport] = useState<Record<string, string>>({});

  async function go(action: string, body: Record<string, unknown>, key = action) {
    const r = await press(`/api/tests/${p.testId}/${action}`, body, key);
    if (r) window.location.reload();
  }

  return (
    <div className="space-y-2" id="calls">
      <section className="panel" aria-label="Live calls">
        <h2>Live calls</h2>
        {p.booked.length > 0 && (
          <>
            <h3>Booked</h3>
            <ul className="space-y-2 text-sm">
              {p.booked.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">{fmt(b.when)} · {b.minutes} min · {b.name}{b.rate && ` · ${b.rate}`}{b.late && <span className="ml-2 badge">{b.late}</span>}</span>
                  {!b.started && <JoinCall callId={b.id} />}
                  {!b.started && (b.canCancel ? <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: b.id }, "cancel-" + b.id)}>Cancel the call</button> : (
                    <span className="inline-flex gap-2">
                      <input className="input w-56" placeholder="Why? (less than 24 hours away)" value={report["c" + b.id] ?? ""} onChange={(e) => setReport({ ...report, ["c" + b.id]: e.target.value })} />
                      <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: b.id, reason: report["c" + b.id] ?? "" }, "cancel-" + b.id)}>Cancel the call</button>
                    </span>
                  ))}
                  {b.started && !b.reported && (
                    <span className="inline-flex gap-2">
                      <JoinCall callId={b.id} />
                      <input className="input w-56" placeholder={`${b.name} didn't show up / was late…`} value={report[b.id] ?? ""} onChange={(e) => setReport({ ...report, [b.id]: e.target.value })} />
                      <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: b.id, note: report[b.id] ?? "" }, "noshow-" + b.id)}>Report a problem</button>
                    </span>
                  )}
                  {b.reported && <span className="note">Problem reported to the team.</span>}
                  {box("cancel-" + b.id)}
                  {box("noshow-" + b.id)}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="note">Calls you request use each tester&apos;s contract rate. A tester can ask for a different rate if they request a call.</p>
      </section>
    </div>
  );
}
