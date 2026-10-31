"use client";
import { useRef, useState } from "react";
import { lengthCap } from "@/lib/callMeasure";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD, offerShown } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { DraftTag, useKept } from "@/lib/useKept";
import type { RowJson } from "@/lib/callRows";
import { alignedClash, formClashInputs, madeBy, newRow, RequestRows, rowsPayload, type PressMade, type RowState } from "@/components/RequestRows";
import { CallRequestsPanel } from "@/components/CallRequestsPanel";
import type { ClashTarget, Slot } from "@/lib/callClash";

type Req = { id: string; rows: RowJson[]; mine: boolean; who: string; contractId: string; rate: string; minutes?: number };

/**
 * Calls are always requests. A request is "Choose one" (up to 3 times; the other side picks one) or "Weekly" (one time
 * repeated 2–8 weeks; accepting books every week). Developer: ticked testers (Select all). Tester: the same,
 * always at the contract rate. Pending requests: Accept / Decline / Withdraw. Boxes under the button. (Batch 16 section 10) A mistake in the request form is
 * red at its box (the server's line goes to the box whose data-match fits it) and listed under Request a time.
 */
export function CallRequests(p: {
  path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean;
  /** (Owner, Oct 29, batch 29 section 20) The server's call lead (CALL_MIN_AHEAD_MINUTES, read on the server and passed down), so form and server agree. */
  leadMinutes: number;
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
  // (Owner, Oct 28, batch 20 section 18) The typed times and length survive any reload (kept on the server, "Draft"; batch 35 §8: after signing in, with "Use saved"), and are forgotten once sent.
  const keep = useKept<{ rows: RowState[]; minutes: string }>(`request:${p.path.split("/").filter(Boolean).pop() ?? ""}`, { rows, minutes }, rows.every((r) => !r.when) && !minutes.trim(), (v) => {
    if (Array.isArray(v.rows) && v.rows.length) setRows(v.rows);
    setMinutes(typeof v.minutes === "string" ? v.minutes : "");
  });
  const red = error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <ChangesBox side={p.side} changes={changes} error={k === "request" && red ? "" : error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /> : null);
  // (Batch 20 section 7) From the press until the reload, the clash checks use the data as it was when pressed and never what the press made.
  const [frozen, setFrozen] = useState<{ targets: ClashTarget[]; elsewhere: (Slot & { name: string })[] } | null>(null);
  const [made, setMade] = useState<PressMade | null>(null);
  const liveTargets: ClashTarget[] = p.clash && p.side === "tester" && p.targets[0]
    ? [{ name: p.targets[0].name, calls: p.clash.calls, requests: p.requests.map((q) => ({ id: q.id, rows: q.rows, minutes: q.minutes ?? 0, mine: q.mine })), pending: p.clash.pending, booked: p.clash.booked, leftCents: p.clash.leftCents, rateCents: p.clash.rateCents }]
    : [];
  const liveElsewhere = p.clash?.elsewhere ?? [];
  const go = async (action: string, body: Record<string, unknown>, key: string) => {
    setFrozen({ targets: liveTargets, elsewhere: liveElsewhere });
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      // It went through: the form clears at once (its times are now the request, or the booked call), then the page loads again.
      setMade(madeBy(r));
      setRows([newRow()]);
      setMinutes("");
      await keep.clear();
      window.location.reload();
    } else setFrozen(null);
  };
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows);
  // (Owner, Oct 28, batch 16 section 33) Clash checks while the form is filled (the same as the developer's): red under the row, blue for an exact match.
  const clash = liveTargets.length
    ? alignedClash(rows, minutes, "tester", formClashInputs(liveTargets, frozen?.targets ?? null, made), frozen?.elsewhere ?? liveElsewhere)
    : { notes: undefined, limits: [] as string[] };
  // (Batch 18 section 6) The Length is at most what's left of the $1,000 for your calls at the call's rate.
  const lenCap = p.clash && p.side === "tester" && p.targets[0] ? lengthCap([{ name: p.targets[0].name, leftCents: p.clash.leftCents, rateCents: p.clash.rateCents }]) : null;
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(p.leadMinutes); // (batch 27 section 6; batch 29 section 20) the server's lead, passed from the server
  // (Batch 27 section 1) The tester's open new-terms offer comes first: the press goes straight to its refusal (the page goes up to Switch / Keep).
  const send = () =>
    ((p.side === "tester" && offerShown()) || checkFields(form.current)) &&
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
          {/* (Batch 19 section 5) The Length label and "min" stay on one line (never squeezed), and a red line at the box goes under the whole row. */}
          <div className="flex flex-wrap items-end gap-2" data-note-after="" data-length-row="">
            <label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max={lenCap ? lenCap.max : 180} data-max-msg={lenCap?.line} data-whole="" data-msg="A live call lasts from 10 to 180 minutes." data-required="" data-required-msg="Enter the call's length in minutes."
              data-match="length in minutes|live call lasts|^At most \d+ minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min</label>
            <span className="pb-2 text-xs text-slate-500" data-length-hint="">{lenCap ? lenCap.hint : "10–180"}</span>
            <button className="btn-ghost" disabled={busy || !filled.length || (p.side === "developer" && ticked.length === 0)} onClick={send}>Request a time</button>
            {keep.restored && <DraftTag onUseSaved={keep.signedIn ? () => { setRows([newRow()]); setMinutes(""); } : undefined} />}
          </div>
          {box("request")}
          <FormMistakes text={at === "request" && red ? error : ""} press="Request a time" />
        </div>
      )}
    </div>
  );
}
