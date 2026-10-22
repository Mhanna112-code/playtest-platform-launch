"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

type Slot = { id: string; when: string; minutes: number; who: string };
type Booked = { id: string; when: string; minutes: number; name: string; room: string; canCancel: boolean; started: boolean; reported: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The developer's live-call panel: offer / remove times, cancel a booked call. Its stop-once box sits under this panel. */
export function CallPanel(p: { testId: string; seenAt: string; minutes: number; open: Slot[]; booked: Booked[]; testers: { id: string; name: string }[]; stopped: boolean }) {
  const { press, changes, error, busy } = usePress(p.seenAt);
  const [times, setTimes] = useState<string[]>([""]);
  const [all, setAll] = useState(true);
  const [ticked, setTicked] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [report, setReport] = useState<Record<string, string>>({});

  async function go(action: string, body: Record<string, unknown>) {
    const r = await press(`/api/tests/${p.testId}/${action}`, body);
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
                  <span className="mr-auto">{fmt(b.when)} · {b.minutes} min · {b.name}</span>
                  {!b.started && <a className="btn-ghost" href={b.room} target="_blank" rel="noreferrer">Join call</a>}
                  {!b.started && (b.canCancel ? <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: b.id })}>Cancel the call</button> : (
                    <span className="inline-flex gap-2">
                      <input className="input w-56" placeholder="Why? (less than 24 hours away)" value={report["c" + b.id] ?? ""} onChange={(e) => setReport({ ...report, ["c" + b.id]: e.target.value })} />
                      <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: b.id, reason: report["c" + b.id] ?? "" })}>Cancel the call</button>
                    </span>
                  ))}
                  {b.started && !b.reported && (
                    <span className="inline-flex gap-2">
                      <a className="btn-ghost" href={b.room} target="_blank" rel="noreferrer">Join call</a>
                      <input className="input w-56" placeholder={`${b.name} didn't show up / was late…`} value={report[b.id] ?? ""} onChange={(e) => setReport({ ...report, [b.id]: e.target.value })} />
                      <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: b.id, note: report[b.id] ?? "" })}>Report a problem</button>
                    </span>
                  )}
                  {b.reported && <span className="note">Problem reported to the team.</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>Open times</h3>
        {p.open.length === 0 ? <p className="note">No open times.</p> : (
          <ul className="space-y-1 text-sm">
            {p.open.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="mr-auto">{fmt(s.when)} · {s.minutes} min · {s.who}</span>
                <button className="btn-ghost" disabled={busy} onClick={() => go("remove-time", { slotId: s.id })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {!p.stopped && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <h3>Offer call times</h3>
            <p className="note">Up to 5 at once, {p.minutes} min each. Any tester in the test can book, even without a live call in their contract.</p>
            {times.map((t, i) => (
              <input key={i} type="datetime-local" aria-label={`Time ${i + 1}`} className="input max-w-xs" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            {times.length < 5 && <button className="btn-ghost" type="button" onClick={() => setTimes([...times, ""])}>+ Another time</button>}
            <fieldset className="text-sm">
              <legend className="label">Who can book</legend>
              <label className="mr-4"><input type="radio" checked={all} onChange={() => setAll(true)} /> All testers</label>
              <label><input type="radio" checked={!all} onChange={() => setAll(false)} /> Only:</label>
              {!all && p.testers.map((t) => (
                <label key={t.id} className="ml-3"><input type="checkbox" checked={ticked.includes(t.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))} /> {t.name}</label>
              ))}
            </fieldset>
            <div>
              <label className="label" htmlFor="link">Call link (blank: we make a simple video room)</label>
              <input id="link" className="input max-w-md" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={() => go("offer-times", { times: times.filter(Boolean).map((t) => new Date(t).toISOString()), allowedTesterIds: all ? [] : ticked, link, minutes: p.minutes })}
            >
              Offer these times
            </button>
          </div>
        )}
      </section>
      <ChangesBox changes={changes} error={error} />
    </div>
  );
}
