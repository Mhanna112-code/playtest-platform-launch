"use client";
import { useRef, useState } from "react";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";
import type { RowJson } from "@/lib/callRows";
import { acceptChoices, describeRows, newRow, RequestRows, rowsPayload, type RowState } from "@/components/RequestRows";

type Req = { id: string; rows: RowJson[]; mine: boolean; who: string; contractId: string; rate: string; minutes?: number };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Calls are always requests. A request is "Choose one" (up to 3 times; the other side picks one) or "Weekly" (one time
 * repeated 2–8 weeks; accepting books every week). Developer: ticked testers (Select all). Tester: the same,
 * always at the contract rate. Pending requests: Accept / Decline / Withdraw. Boxes under the button.
 */
export function CallRequests(p: { path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean }) {
  // (NEXT-UI 12b) What the limit box said: the next press sends it, and stops again if who is blocked / at the limit changed.
  const [limitSeen, setLimitSeen] = useState("");
  const { press, changes, error, busy, at, errData } = usePress(p.seenAt, (d) => {
    if (typeof d.limitSeen === "string") setLimitSeen(d.limitSeen);
  });
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [ticked, setTicked] = useState<string[]>(p.targets.length === 1 ? [p.targets[0].contractId] : []);
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /> : null);
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      window.location.reload();
    }
  };
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows);
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(5);
  const send = () =>
    checkFields(form.current) &&
    go(
      "request-time",
      {
        rows: filled,
        minutes: minutes.trim() ? minutes.trim() : "",
        ...(p.side === "developer" ? { contractIds: ticked, limitSeen } : {}),
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
                {describeRows(r.rows)}{r.minutes ? ` · ${r.minutes} min` : ""} · {r.rate}
              </span>
              {r.mine ? (
                <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: r.contractId }, "w-" + r.id)}>Withdraw</button>
              ) : (
                <>
                  {acceptChoices(r.rows).map((x) => (
                    <button key={x.label} className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", ...(x.time ? { time: x.time } : {}), contractId: r.contractId }, "a-" + r.id)}>{x.label}</button>
                  ))}
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
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="inline-flex items-center gap-1">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max="180" data-whole="" data-msg="A live call lasts from 10 to 180 minutes." value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min <span className="text-xs text-slate-500">10–180</span></label>
            <button className="btn-ghost" disabled={busy || !filled.length || (p.side === "developer" && ticked.length === 0)} onClick={send}>Request a time</button>
          </div>
          {box("request")}
        </div>
      )}
    </div>
  );
}
