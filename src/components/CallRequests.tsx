"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

type Req = { id: string; when: string; mine: boolean; who: string; contractId: string; rate: string };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Calls are always requests. Developer: Request a time with ticked testers (Select all). Tester: Request a time, with an
 * optional "Ask $___/h" (only there). Pending requests: Accept (always the contract rate) / Decline / Withdraw.
 */
export function CallRequests(p: { path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const [when, setWhen] = useState("");
  const [ticked, setTicked] = useState<string[]>(p.targets.length === 1 ? [p.targets[0].contractId] : []);
  const [ask, setAsk] = useState("");
  const [acceptAsk, setAcceptAsk] = useState<Record<string, string>>({});
  const [done, setDone] = useState("");
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} /> : null);
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      if (r.message) setDone(r.message);
      setTimeout(() => window.location.reload(), r.message ? 1500 : 0);
    }
  };
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  return (
    <div className="space-y-2 text-sm">
      {p.requests.length > 0 && (
        <ul className="space-y-2">
          {p.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="mr-auto">
                {r.mine ? `You requested ${fmt(r.when)}${p.side === "developer" ? ` with ${r.who}` : ""}` : `${r.who} requested ${fmt(r.when)}`} · {r.rate}
              </span>
              {r.mine ? (
                <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: r.contractId }, "w-" + r.id)}>Withdraw</button>
              ) : (
                <>
                  {p.side === "tester" && (
                    <label className="inline-flex items-center gap-1">Ask $<input className="input w-20" inputMode="decimal" placeholder="optional" value={acceptAsk[r.id] ?? ""} onChange={(e) => setAcceptAsk({ ...acceptAsk, [r.id]: e.target.value })} />/h</label>
                  )}
                  <button className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", contractId: r.contractId }, "a-" + r.id)}>Accept</button>
                  <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "decline", contractId: r.contractId }, "d-" + r.id)}>Decline</button>
                </>
              )}
              <div className="basis-full">{box("w-" + r.id)}{box("a-" + r.id)}{box("d-" + r.id)}</div>
            </li>
          ))}
        </ul>
      )}
      {p.canRequest && (
        <div className="space-y-2">
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
          <div className="flex flex-wrap items-end gap-2">
            <input type="datetime-local" aria-label="Requested time" className="input max-w-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
            {p.side === "tester" && (
              <label className="inline-flex items-center gap-1">Ask $<input className="input w-20" inputMode="decimal" placeholder="optional" aria-label="Ask per hour" value={ask} onChange={(e) => setAsk(e.target.value)} />/h</label>
            )}
            <button
              className="btn-ghost"
              disabled={busy || !when || (p.side === "developer" && ticked.length === 0)}
              onClick={() => go("request-time", p.side === "developer" ? { startsAt: new Date(when).toISOString(), contractIds: ticked } : { startsAt: new Date(when).toISOString(), ask }, "request")}
            >
              Request a time
            </button>
          </div>
          {box("request")}
        </div>
      )}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
