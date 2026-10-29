"use client";
import { useRef, useState } from "react";
import { lengthCap } from "@/lib/callMeasure";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import type { RowJson } from "@/lib/callRows";
import { alignedClash, newRow, RequestRows, rowsPayload, type RowState } from "@/components/RequestRows";
import { CallRequestsPanel } from "@/components/CallRequestsPanel";
import type { Slot } from "@/lib/callClash";

type Req = { id: string; rows: RowJson[]; mine: boolean; who: string; contractId: string; rate: string; minutes?: number };

/**
 * Calls are always requests. A request is "Choose one" (up to 3 times; the other side picks one) or "Weekly" (one time
 * repeated 2–8 weeks; accepting books every week). Developer: ticked testers (Select all). Tester: the same,
 * always at the contract rate. Pending requests: Accept / Decline / Withdraw. Boxes under the button. (Batch 16 section 10) A mistake in the request form is
 * red at its box (the server's line goes to the box whose data-match fits it) and listed under Request a time.
 */
export function CallRequests(p: {
  path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean;
  /** (Batch 16 section 33) For the clash checks: the booked calls between you, your other calls, and the limits (waiting, booked, what's left of the $1,000, the rate). */
  clash?: { calls: Slot[]; elsewhere: (Slot & { name: string })[]; pending: number; booked: number; leftCents: number | null; rateCents: number | null };
}) {
  // (NEXT-UI 12b) What the limit box said: the next press sends it, and stops again if who is blocked / at the limit changed.
  const [limitSeen, setLimitSeen] = useState("");
  const { press, changes, error, busy, at, errData } = usePress(p.seenAt, (d) => {
    if (typeof d.limitSeen === "string") setLimitSeen(d.limitSeen);
  });
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [ticked, setTicked] = useState<string[]>(p.targets.length === 1 ? [p.targets[0].contractId] : []);
  const red = error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <ChangesBox side={p.side} changes={changes} error={k === "request" && red ? "" : error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /> : null);
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      window.location.reload();
    }
  };
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows);
  // (Owner, Oct 28, batch 16 section 33) Clash checks while the form is filled (the same as the developer's): red under the row, blue for an exact match.
  const clash = p.clash && p.side === "tester" && p.targets[0]
    ? alignedClash(rows, minutes, "tester", [{ name: p.targets[0].name, calls: p.clash.calls, requests: p.requests.map((q) => ({ id: q.id, rows: q.rows, minutes: q.minutes ?? 0, mine: q.mine })), pending: p.clash.pending, booked: p.clash.booked, leftCents: p.clash.leftCents, rateCents: p.clash.rateCents }], p.clash.elsewhere)
    : { notes: undefined, limits: [] as string[] };
  // (Batch 18 section 6) The Length is at most what's left of the $1,000 for your calls at the call's rate.
  const lenCap = p.clash && p.side === "tester" && p.targets[0] ? lengthCap([{ name: p.targets[0].name, leftCents: p.clash.leftCents, rateCents: p.clash.rateCents }]) : null;
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
      {/* (Batch 16 sections 33 and 35) The one Call requests panel: every waiting request with them, both directions, soonest first. */}
      <CallRequestsPanel side={p.side} seenAt={p.seenAt} path={() => p.path}
        requests={p.requests.map((r) => ({ id: r.id, contractId: r.contractId, tester: p.side === "tester" ? "You" : r.who, asker: r.who, rows: r.rows, minutes: r.minutes ?? 0, mine: r.mine, rate: r.rate }))} />
      {p.canRequest && (
        <div className="space-y-2" ref={form} data-mistakes-root="">
          {p.side === "developer" && p.targets.length > 0 && (
            <fieldset className="space-y-1" id="call-with" data-field-group="" data-match="tick at least one tester">
              <legend className="label">With</legend>
              <label className="block font-medium"><input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : p.targets.map((t) => t.contractId))} /> Select all ({p.targets.length})</label>
              {p.targets.map((t) => (
                <label key={t.contractId} className="block">
                  <input type="checkbox" checked={ticked.includes(t.contractId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.contractId] : ticked.filter((x) => x !== t.contractId))} /> {t.name} · {t.rate}
                </label>
              ))}
            </fieldset>
          )}
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} notes={clash.notes} />
          {clash.limits.map((l) => <p key={l} className="err-field" tabIndex={-1} data-red-msg={l} data-clash-limit="">{l}</p>)}
          <div className="flex flex-wrap items-end gap-2">
            <label className="inline-flex items-center gap-1">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max={lenCap ? lenCap.max : 180} data-max-msg={lenCap?.line} data-whole="" data-msg="A live call lasts from 10 to 180 minutes." data-required="" data-required-msg="Enter the call's length in minutes."
              data-match="length in minutes|live call lasts|^At most \d+ minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min <span className="text-xs text-slate-500" data-length-hint="">{lenCap ? lenCap.hint : "10–180"}</span></label>
            <button className="btn-ghost" disabled={busy || !filled.length || (p.side === "developer" && ticked.length === 0)} onClick={send}>Request a time</button>
          </div>
          {box("request")}
          <FormMistakes text={at === "request" && red ? error : ""} press="Request a time" />
        </div>
      )}
    </div>
  );
}
