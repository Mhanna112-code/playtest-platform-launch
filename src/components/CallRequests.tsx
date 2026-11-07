"use client";
import { useRef, useState } from "react";
import { PressDone } from "@/components/PressDone";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD, offerShown } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { DraftTag, useKept } from "@/lib/useKept";
import type { RowJson } from "@/lib/callRows";
import { alignedClash, formClashInputs, madeBy, newRow, RequestRows, rowsPayload, sentLine, useWindowShutLine, type PressMade, type RowState } from "@/components/RequestRows";
import { CallRequestsPanel, useClosingRequests } from "@/components/CallRequestsPanel";
import type { ClashTarget, Slot } from "@/lib/callClash";
import type { CallEnd } from "@/lib/callWindow";
import { lockText, useSending } from "@/lib/sendLock";

type Req = { id: string; rows: RowJson[]; mine: boolean; who: string; contractId: string; rate: string; minutes?: number };

/**
 * Calls are always requests. A request is one time or "Daily" / "Weekly" (one time repeated; accepting books every one); (owner, Nov 5, §208) "+ Another
 * time" sends each time as its own request (older "choose one" requests still waiting keep their rows). Developer: ticked testers (Select all). Tester: the same,
 * always at the contract rate. Pending requests: Accept / Decline / Withdraw. Boxes under the button. (Batch 16 section 10) A mistake in the request form is
 * red at its box (the server's line goes to the box whose data-match fits it) and listed under Request a time.
 */
export function CallRequests(p: {
  path: string; seenAt: string; side: "developer" | "tester"; requests: Req[]; targets: { contractId: string; name: string; rate: string }[]; canRequest: boolean;
  /** (Owner, Oct 29, batch 29 section 20) The server's call lead (CALL_MIN_AHEAD_MINUTES, read on the server and passed down), so form and server agree. */
  leadMinutes: number;
  /** (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (the server's, in the reader's words): the time box's latest time and the calls drop-down. */
  end?: CallEnd;
  /**
   * (Batch 16 section 33) For the clash checks: the booked calls between you, your other calls, and the limits (waiting, booked). (Owner, Nov 6, §280) No longer
   * what's left of the $500 or the rate: booking isn't checked against it.
   */
  clash?: { calls: Slot[]; elsewhere: (Slot & { name: string })[]; pending: number; booked: number;
    /** (Owner, Nov 6, §292) The developer's calls booked with other testers (any test): time ranges only, never who with (their private bookings). */
    busy?: Slot[] };
}) {
  // (NEXT-UI 12b) What the limit box said: the next press sends it, and stops again if who is blocked / at the limit changed.
  const [limitSeen, setLimitSeen] = useState("");
  const { press, changes, error, busy, at, errData, doneLine, finish } = usePress(p.seenAt, (d) => {
    if (typeof d.limitSeen === "string") setLimitSeen(d.limitSeen);
  }, { onFresh: () => { setFrozen(null); setMade(null); } });
  const [minutes, setMinutes] = useState("");
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [ticked, setTicked] = useState<string[]>(p.targets.length === 1 ? [p.targets[0].contractId] : []);
  // (Owner, Oct 28, batch 20 section 18) The typed times and length survive any reload (kept on the server, "Draft"; batch 35 §8: after signing in, with "Use saved"), and are forgotten once sent.
  const keep = useKept<{ rows: RowState[]; minutes: string }>(`request:${p.path.split("/").filter(Boolean).pop() ?? ""}`, { rows, minutes }, rows.every((r) => !r.when) && !minutes.trim(), (v) => {
    if (Array.isArray(v.rows) && v.rows.length) setRows(v.rows);
    setMinutes(typeof v.minutes === "string" ? v.minutes : "");
  });
  // (Owner, Nov 5, §228 fix) The waiting requests as the panels show them, held over both lists: one that stops waiting keeps its row, saying what happened, for
  // 6 seconds from any cause (even the last one: its list stays drawn meanwhile).
  const { shown: reqsShown, closing } = useClosingRequests(p.requests.map((r) => ({ id: r.id, contractId: r.contractId, tester: p.side === "tester" ? "You" : r.who, asker: r.who, rows: r.rows, minutes: r.minutes ?? 0, mine: r.mine, rate: r.rate })));
  const red = error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <ChangesBox side={p.side} changes={changes} error={k === "request" && red ? "" : error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /> : null);
  // (Batch 20 section 7) From the press until the reload, the clash checks use the data as it was when pressed and never what the press made.
  const [frozen, setFrozen] = useState<{ targets: ClashTarget[]; elsewhere: (Slot & { name: string })[] } | null>(null);
  const [made, setMade] = useState<PressMade | null>(null);
  const liveTargets: ClashTarget[] = p.clash && p.side === "tester" && p.targets[0]
    ? [{ name: p.targets[0].name, calls: p.clash.calls, requests: p.requests.map((q) => ({ id: q.id, rows: q.rows, minutes: q.minutes ?? 0, mine: q.mine })), pending: p.clash.pending, booked: p.clash.booked, busy: p.clash.busy }]
    : [];
  const liveElsewhere = p.clash?.elsewhere ?? [];
  // (Owner, Nov 5, §261) From Request a time until it ends (and, gone through, until the redraw), the times and the length are read-only and Discard waits.
  const requesting = useSending();
  const go = (action: string, body: Record<string, unknown>, key: string) => requesting.run(async () => {
    setFrozen({ targets: liveTargets, elsewhere: liveElsewhere });
    const r = await press<{ message?: string }>(`${p.path}/${action}`, body, key);
    if (r) {
      // It went through: the form clears at once (its times are now the request, or the booked call), then (batch 35 §40, §41) the page redraws in place, the
      // button greyed with its line until it has.
      setMade(madeBy(r));
      setRows([newRow()]);
      setMinutes("");
      await keep.clear();
      finish(action === "request-time" ? sentLine(r) : "");
    } else setFrozen(null);
  });
  const sendLocked = requesting.sending || (busy && at === "request");
  const all = p.targets.length > 0 && p.targets.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows, p.end);
  // (Owner, Oct 28, batch 16 section 33) Clash checks while the form is filled (the same as the developer's): red under the row, blue for an exact match.
  const clash = liveTargets.length
    ? alignedClash(rows, minutes, "tester", formClashInputs(liveTargets, frozen?.targets ?? null, made), frozen?.elsewhere ?? liveElsewhere, p.end)
    : { notes: undefined, limits: [] as string[] };
  // (Owner, Nov 6, §280) The Length is 10–180 minutes whatever is left of the $500 for your calls (no "At most N minutes", no cap in the hint).
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(p.leadMinutes); // (batch 27 section 6; batch 29 section 20) the server's lead, passed from the server
  // (Batch 35 §132) Less than the lead left before testers' work ends: no time fits, so the form goes and a line says why.
  const shut = useWindowShutLine(p.end, p.leadMinutes);
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
      {/* (Batch 16 sections 33 and 35) The waiting requests with them, soonest first. (Owner, Nov 4, §185) Split as on the developer's page: "Requests to you (N)"
          (theirs, to answer: Accept / Decline) and "Your requests (N)" (yours, waiting: Withdraw), each its own panel (`call-requests-<id>` / `your-requests-<id>`).
          One person here (the developer), so no name search. Neither waiting: the one "No call requests waiting." line. */}
      {(() => {
        const id = p.path.split("/").filter(Boolean).pop() ?? "";
        const all = reqsShown;
        const toYou = all.filter((r) => !r.mine), yours = all.filter((r) => r.mine);
        const panel = (title: string, list: typeof all, kind: "call-requests" | "your-requests") => (
          <div data-requests-to-you={kind === "call-requests" ? "" : undefined} data-your-requests={kind === "your-requests" ? "" : undefined}>
            <CallRequestsPanel side={p.side} seenAt={p.seenAt} path={() => p.path} leadMinutes={p.leadMinutes} panelId={`${kind}-${id}`} title={title} sectionId={kind} showCount requests={list} closing={closing} />
          </div>
        );
        if (!all.length) return <CallRequestsPanel side={p.side} seenAt={p.seenAt} path={() => p.path} leadMinutes={p.leadMinutes} panelId={`call-requests-${id}`} requests={[]} />;
        return (
          <>
            {toYou.length > 0 && panel("Call requests to you", toYou, "call-requests") /* (Owner, Nov 6, §287) "Call" first */}
            {yours.length > 0 && panel("Call requests you sent", yours, "your-requests")}
          </>
        );
      })()}
      {p.canRequest && shut && <p className="note" data-window-shut="">{shut}</p>}
      {p.canRequest && !shut && (
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
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} notes={clash.notes} leadMinutes={p.leadMinutes} end={p.end} locked={sendLocked} />
          {clash.limits.map((l) => <p key={l} className="err-field" tabIndex={-1} data-red-msg={l} data-clash-limit="">{l}</p>)}
          {/* (Batch 19 section 5) The Length label and "min" stay on one line (never squeezed), and a red line at the box goes under the whole row. */}
          <div className="flex flex-wrap items-end gap-2" data-note-after="" data-length-row="">
            <label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max="180" data-whole="" data-msg="A live call lasts from 10 to 180 minutes." data-required="" data-required-msg="Enter the call's length in minutes."
              data-match="length in minutes|live call lasts" value={minutes} onChange={(e) => setMinutes(e.target.value)} {...lockText(sendLocked)} /> min</label>
            <span className="pb-2 text-xs text-slate-500" data-length-hint="">10–180</span>
            <button className="btn-ghost" disabled={busy || !filled.length || (p.side === "developer" && ticked.length === 0)} onClick={send}>Request a time</button>
            {keep.restored && <DraftTag disabled={busy} kind="discard" onUseSaved={() => { setRows([newRow()]); setMinutes(""); }} />}
          </div>
          {box("request")}
          <PressDone line={doneLine} />
          <FormMistakes text={at === "request" && red ? error : ""} press="Request a time" />
        </div>
      )}
    </div>
  );
}
