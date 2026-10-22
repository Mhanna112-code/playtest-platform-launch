"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

type Req = { id: string; when: string; mine: boolean; who: string; contractId: string };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Request a time (developer → one tester; tester → developer) and the pending requests with Accept / Decline / Withdraw. */
export function CallRequests(p: { path: string; seenAt: string; requests: Req[]; targets: { contractId: string; name: string }[]; canRequest: boolean }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const [when, setWhen] = useState("");
  const [who, setWho] = useState(p.targets[0]?.contractId ?? "");
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} /> : null);
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    const r = await press(`${p.path}/${action}`, body, key);
    if (r) window.location.reload();
  };
  return (
    <div className="space-y-2 text-sm">
      {p.requests.length > 0 && (
        <ul className="space-y-1">
          {p.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="mr-auto">{r.mine ? `You requested ${fmt(r.when)}${r.who ? ` with ${r.who}` : ""}` : `${r.who} requested ${fmt(r.when)}`}</span>
              {r.mine ? (
                <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: r.contractId }, "w-" + r.id)}>Withdraw</button>
              ) : (
                <>
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
        <div className="flex flex-wrap items-end gap-2">
          {p.targets.length > 1 && (
            <select aria-label="With" className="input w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
              {p.targets.map((t) => <option key={t.contractId} value={t.contractId}>{t.name}</option>)}
            </select>
          )}
          <input type="datetime-local" aria-label="Requested time" className="input max-w-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button className="btn-ghost" disabled={busy || !when} onClick={() => go("request-time", { startsAt: new Date(when).toISOString(), contractId: who }, "request")}>Request a time</button>
          <div className="basis-full">{box("request")}</div>
        </div>
      )}
    </div>
  );
}
