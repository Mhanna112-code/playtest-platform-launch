"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { JoinCall } from "@/components/JoinCall";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";

export type DevCall = { id: string; when: string; minutes: number; rate: string; canCancel: boolean; started: boolean; reported: boolean; late?: string; joinable?: boolean };
export type DevSet = { id: string; label: string; calls: DevCall[] };
export type DevReq = { id: string; times: string[]; weeks: number; repeat: string; mine: boolean; rate: string; minutes?: number };
export type DevTester = { contractId: string; name: string; terms: string; booked: number; calls: DevCall[]; sets: DevSet[]; requests: DevReq[] };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const short = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * The developer's live-call panel (owner layout): the rate line; one tick row per tester with their terms and
 * "N of 3 booked"; [Request a time] to everyone ticked; then per-tester blocks (ticked testers, or everyone with a call or
 * request when nothing is ticked): booked calls, daily/weekly sets as one line, waiting requests. Boxes under the button.
 */
export function DevCallPanel({ testId, seenAt, testers, canRequest }: { testId: string; seenAt: string; testers: DevTester[]; canRequest: boolean }) {
  const { press, changes, error, busy, at, errData } = usePress(seenAt);
  const [ticked, setTicked] = useState<string[]>([]);
  const [kind, setKind] = useState<"one" | "daily" | "weekly">("one");
  const [whens, setWhens] = useState<string[]>([""]);
  const [count, setCount] = useState(4);
  const [minutes, setMinutes] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [done, setDone] = useState("");
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /></div> : null);
  const go = async (path: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`/api/tests/${testId}/${path}`, body, key);
    if (r) {
      if (r.message) setDone(r.message);
      setTimeout(() => window.location.reload(), r.message ? 1500 : 0);
    }
  };
  const all = testers.length > 0 && testers.every((t) => ticked.includes(t.contractId));
  const filled = whens.filter(Boolean).map((w) => new Date(w).toISOString());
  const shown = ticked.length ? testers.filter((t) => ticked.includes(t.contractId)) : testers.filter((t) => t.calls.length || t.sets.length || t.requests.length);

  const callRow = (t: DevTester, c: DevCall) => (
    <li key={c.id} className="flex flex-wrap items-center gap-2">
      <span className="mr-auto">{t.name} · {fmt(c.when)} · {c.minutes} min · {c.rate}{c.late && <span className="ml-2 badge">{c.late}</span>}</span>
      {c.joinable && <JoinCall callId={c.id} />}
      {!c.started && (c.canCancel ? (
        <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: c.id }, "cancel-" + c.id)}>Cancel</button>
      ) : (
        <span className="inline-flex gap-2">
          <input className="input w-48" placeholder="Why? (less than 24 hours away)" value={reason[c.id] ?? ""} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} />
          <button className="btn-ghost" disabled={busy} onClick={() => go("cancel-call", { callId: c.id, reason: reason[c.id] ?? "" }, "cancel-" + c.id)}>Cancel</button>
        </span>
      ))}
      {c.started && !c.reported && (
        <span className="inline-flex gap-2">
          <input className="input w-48" placeholder={`${t.name} didn't show up…`} value={reason["n" + c.id] ?? ""} onChange={(e) => setReason({ ...reason, ["n" + c.id]: e.target.value })} />
          <button className="btn-ghost" disabled={busy} onClick={() => go("no-show", { callId: c.id, note: reason["n" + c.id] ?? "" }, "noshow-" + c.id)}>Report a problem</button>
        </span>
      )}
      {box("cancel-" + c.id)}
      {box("noshow-" + c.id)}
    </li>
  );

  return (
    <section className="panel" id="calls" aria-label="Call requests">
      <h2>Live calls</h2>
      <p className="note">Calls you request use each tester&apos;s contract rate. A tester can ask for a different rate if they request a call.</p>
      {canRequest && testers.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <label className="block font-medium"><input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : testers.map((t) => t.contractId))} /> Select all ({testers.length})</label>
          {testers.map((t) => (
            <label key={t.contractId} className="block">
              <input type="checkbox" checked={ticked.includes(t.contractId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.contractId] : ticked.filter((x) => x !== t.contractId))} /> <b>{t.name}</b> · {t.terms} · {t.booked} of 3 booked
            </label>
          ))}
        </fieldset>
      )}
      {canRequest && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-4">
            <label><input type="radio" checked={kind === "one"} onChange={() => setKind("one")} /> Choose one (up to 3 times)</label>
            <label><input type="radio" checked={kind === "daily"} onChange={() => { setKind("daily"); setWhens([whens[0] ?? ""]); }} /> Daily</label>
            <label><input type="radio" checked={kind === "weekly"} onChange={() => { setKind("weekly"); setWhens([whens[0] ?? ""]); }} /> Weekly</label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {whens.map((w, i) => (
              <input key={i} type="datetime-local" aria-label={`Requested time ${i + 1}`} className="input max-w-xs" value={w} onChange={(e) => setWhens(whens.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <label className="inline-flex items-center gap-1 text-sm">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min</label>
            {kind === "one" && whens.length < 3 && <button type="button" className="btn-ghost" onClick={() => setWhens([...whens, ""])}>+ Another time</button>}
            {kind !== "one" && (
              <select aria-label="How many calls" className="input w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} calls</option>)}
              </select>
            )}
            <button
              className="btn"
              disabled={busy || !filled.length || ticked.length === 0}
              onClick={() => go("request-time", { contractIds: ticked, minutes: minutes.trim() ? minutes.trim() : "", ...(kind === "one" ? { times: filled } : { times: filled.slice(0, 1), weeks: count, repeat: kind }) }, "request")}
            >
              Request a time
            </button>
          </div>
          {ticked.length === 0 && <p className="note">Tick one or more testers to request a time.</p>}
          {box("request")}
          {done && <p className="ok">{done}</p>}
        </div>
      )}
      {shown.length === 0 && <p className="note">No calls or requests yet.</p>}
      {shown.map((t) => (
        <div key={t.contractId} className="space-y-1 rounded-lg border border-white/10 p-3 text-sm">
          <h3>{t.name}</h3>
          {!t.calls.length && !t.sets.length && !t.requests.length && <p className="note">No calls or requests</p>}
          {(t.calls.length > 0 || t.sets.length > 0) && <p className="font-medium">Booked</p>}
          <ul className="space-y-1">
            {t.calls.map((c) => callRow(t, c))}
            {t.sets.map((s) => (
              <li key={s.id} className="space-y-1">
                <span>{t.name} · {s.label} </span>
                <button className="btn-ghost text-xs" onClick={() => setOpen({ ...open, [s.id]: !open[s.id] })}>{open[s.id] ? "Hide calls" : "Show calls"}</button>
                {open[s.id] && <ul className="ml-4 space-y-1">{s.calls.map((c) => callRow(t, c))}</ul>}
              </li>
            ))}
          </ul>
          {t.requests.length > 0 && <p className="font-medium">Waiting</p>}
          <ul className="space-y-1">
            {t.requests.map((r) => (
              <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 ${MARKABLE}`}>
                <span className="mr-auto">
                  {r.mine ? "You requested" : `${t.name} requested`}{" "}
                  {r.weeks ? `${r.repeat === "daily" ? "daily" : "weekly"} calls: ${short(r.times[0])} · ${r.weeks} calls from ${fmt(r.times[0])}` : r.times.length > 1 ? `one of: ${r.times.map(fmt).join(" · ")}` : fmt(r.times[0])}{r.minutes ? ` · ${r.minutes} min` : ""} · {r.rate}
                </span>
                {r.mine ? (
                  <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: t.contractId }, "w-" + r.id)}>Withdraw</button>
                ) : (
                  <>
                    {!r.weeks && r.times.length > 1 ? (
                      r.times.map((x) => (
                        <button key={x} className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", time: x, contractId: t.contractId }, "a-" + r.id)}>Accept {short(x)}</button>
                      ))
                    ) : (
                      <button className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", contractId: t.contractId }, "a-" + r.id)}>{r.weeks ? `Accept all ${r.weeks}` : "Accept"}</button>
                    )}
                    <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "decline", contractId: t.contractId }, "d-" + r.id)}>Decline</button>
                  </>
                )}
                {box("w-" + r.id)}
                {box("a-" + r.id)}
                {box("d-" + r.id)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
