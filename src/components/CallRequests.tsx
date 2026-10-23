"use client";
import { useRef, useState } from "react";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";

type Req = { id: string; times: string[]; weeks: number; repeat?: string; mine: boolean; who: string; contractId: string; rate: string; minutes?: number };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Calls are always requests. A request is "Choose one" (up to 3 times; the other side picks one) or "Weekly" (one time
 * repeated 2–8 weeks; accepting books every week). Developer: ticked testers (Select all). Tester: optional
 * "Ask $___/h" (only on their own request). Pending requests: Accept / Decline / Withdraw. Boxes under the button.
 */
export function CallRequests(p: { path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean }) {
  const { press, changes, error, busy, at, errData } = usePress(p.seenAt);
  const [minutes, setMinutes] = useState("");
  const [kind, setKind] = useState<"one" | "daily" | "weekly">("one");
  const [whens, setWhens] = useState<string[]>([""]);
  const [weeks, setWeeks] = useState(4);
  const [ticked, setTicked] = useState<string[]>(p.targets.length === 1 ? [p.targets[0].contractId] : []);
  const [ask, setAsk] = useState("");
  const [done, setDone] = useState("");
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /> : null);
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      if (r.message) setDone(r.message);
      setTimeout(() => window.location.reload(), r.message ? 1500 : 0);
    }
  };
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  const filled = whens.filter(Boolean).map((w) => new Date(w).toISOString());
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(5);
  const send = () =>
    checkFields(form.current) &&
    go(
      "request-time",
      {
        ...(kind !== "one" ? { times: filled.slice(0, 1), weeks, repeat: kind } : { times: filled }),
        minutes: minutes.trim() ? minutes.trim() : "",
        ...(p.side === "developer" ? { contractIds: ticked } : { ask }),
      },
      "request",
    );
  return (
    <div className="space-y-2 text-sm">
      {p.requests.length > 0 && (
        <ul className="space-y-2">
          {p.requests.map((r) => (
            <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 ${MARKABLE}`}>
              <span className="mr-auto">
                {r.mine ? `You requested${p.side === "developer" ? ` with ${r.who}` : ""}` : `${r.who} requested`}{" "}
                {r.weeks ? `${r.repeat === "daily" ? "daily" : "weekly"} calls: ${fmt(r.times[0])}, ${r.weeks} calls` : r.times.length > 1 ? `one of: ${r.times.map(fmt).join(" · ")}` : fmt(r.times[0])}{r.minutes ? ` · ${r.minutes} min` : ""} · {r.rate}
              </span>
              {r.mine ? (
                <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: r.contractId }, "w-" + r.id)}>Withdraw</button>
              ) : (
                <>
                  {!r.weeks && r.times.length > 1 ? (
                    r.times.map((t) => (
                      <button key={t} className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", time: t, contractId: r.contractId }, "a-" + r.id)}>
                        Accept {new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                      </button>
                    ))
                  ) : (
                    <button className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", contractId: r.contractId }, "a-" + r.id)}>{r.weeks ? `Accept all ${r.weeks}` : "Accept"}</button>
                  )}
                  <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "decline", contractId: r.contractId }, "d-" + r.id)}>Decline</button>
                </>
              )}
              <div className="basis-full">{box("w-" + r.id)}{box("a-" + r.id)}{box("d-" + r.id)}</div>
            </li>
          ))}
        </ul>
      )}
      {p.canRequest && (
        <div className="space-y-2" ref={form}>
          {p.side === "developer" && p.targets.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="label">With</legend>
              <label className="block font-medium"><input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : p.targets.map((t) => t.contractId))} /> Select all ({p.targets.length})</label>
              {p.targets.map((t) => (
                <label key={t.contractId} className="block">
                  <input type="checkbox" checked={ticked.includes(t.contractId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.contractId] : ticked.filter((x) => x !== t.contractId))} /> {t.name} · {t.rate}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-4">
            <label><input type="radio" checked={kind === "one"} onChange={() => setKind("one")} /> Choose one (up to 3 times)</label>
            <label><input type="radio" checked={kind === "daily"} onChange={() => { setKind("daily"); setWhens([whens[0] ?? ""]); }} /> Daily</label>
            <label><input type="radio" checked={kind === "weekly"} onChange={() => { setKind("weekly"); setWhens([whens[0] ?? ""]); }} /> Weekly</label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {whens.map((w, i) => (
              <input key={i} type="datetime-local" min={minNow} data-msg="Pick a time in the future." aria-label={`Requested time ${i + 1}`} className="input max-w-xs" value={w} onChange={(e) => setWhens(whens.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            {kind === "one" && whens.length < 3 && <button type="button" className="btn-ghost" onClick={() => setWhens([...whens, ""])}>+ Another time</button>}
            {kind !== "one" && (
              <select aria-label="How many calls" className="input w-auto" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} calls</option>)}
              </select>
            )}
            <label className="inline-flex items-center gap-1">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max="180" data-whole="" data-msg="A live call lasts from 10 to 180 minutes." value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min <span className="text-xs text-slate-500">10–180</span></label>
            {p.side === "tester" && (
              <label className="inline-flex items-center gap-1">Ask $<input className="input w-20" inputMode="decimal" placeholder="optional" aria-label="Ask per hour" data-min="0" data-max="5000" data-msg="Ask at most $5,000.00 an hour." value={ask} onChange={(e) => setAsk(e.target.value)} />/h <span className="text-xs text-slate-500">up to $5,000</span></label>
            )}
            <button className="btn-ghost" disabled={busy || !filled.length || (p.side === "developer" && ticked.length === 0)} onClick={send}>Request a time</button>
          </div>
          {box("request")}
        </div>
      )}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
