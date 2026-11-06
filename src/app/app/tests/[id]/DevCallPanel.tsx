"use client";
import { Cut, NameLink } from "@/components/Cut";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD } from "@/lib/client";
import { JoinCall } from "@/components/JoinCall";
import { CalendarPlus } from "lucide-react";
import { usePress } from "@/lib/usePress";
import { DraftTag, useKept } from "@/lib/useKept";
import { LivePanel } from "@/components/LivePanel";
import { CallTimer } from "@/components/CallTimer";
import { ReportProblem } from "@/components/ReportProblem";
import { CallPresence } from "@/components/CallPresence";
import { CancelMenu } from "@/components/CancelMenu";
import type { RowJson } from "@/lib/callRows";
import type { Slot } from "@/lib/callClash";
import { alignedClash, formClashInputs, madeBy, newRow, RequestRows, rowsPayload, sentLine, useWindowShutLine, type PressMade, type RowState } from "@/components/RequestRows";
import { CallCheck } from "@/components/CallCheck";
import { PressDone } from "@/components/PressDone";
import { liveTicks, useDropGoneTicks } from "@/lib/liveTicks";
import type { CallEnd } from "@/lib/callWindow";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { HoldFold, useHoldOpen } from "@/components/HoldFold";
import { LIST_PANEL, TESTERS_CALLS_TALLEST } from "@/components/ScrollList";
import { lockText, useSending } from "@/lib/sendLock";

export type DevCall = { id: string; when: string; minutes: number; rate: string; canCancel: boolean; started: boolean; reported: boolean; late?: string; joinable?: boolean; report?: { byMe: boolean; note: string } | null; measuring?: string };
/** A booked daily / weekly set: its line ("Weekly · Mon 3:00 PM (3 left)", or no count for Forever), and whether Cancel needs a reason. */
export type DevSet = { id: string; label: string; minutes: number; rate: string; needsReason: boolean; calls: DevCall[] };
export type DevReq = { id: string; rows: RowJson[]; mine: boolean; rate: string; minutes?: number };
export type DevTester = { contractId: string; name: string; /** (Owner, Nov 3, §166) their profile: the name is the green link */ testerHref?: string | null; terms: string; booked: number; calls: DevCall[]; sets: DevSet[]; requests: DevReq[]; warning?: string;
  /** (Batch 16 section 33) For the clash checks: waiting requests with them (both sides). (Owner, Nov 6, §280) No longer what's left of the $1,000. */
  pending?: number;
  /** (Owner, Nov 6, §292) Their calls booked with someone else (any test): time ranges only, never who with; a request overlapping one is red at its row. */
  busy?: Slot[] };
/** (Batch 16 section 33) The developer's other calls (any tester, any test): "You have a call with Ana Silva then (1:30–2:00 PM)." */
export type OtherCall = { contractId: string; name: string; start: string; minutes: number };

/** (Owner, Nov 6, §291) The Live session's "Booked (N)" section (the bottom of the panel), and a tester's drop-down in it. */
export const BOOKED_SECTION = "booked-calls";
export const bookedPersonAnchor = (contractId: string) => `booked-person-${contractId}`;
/** (§291) Holds the tester's drop-down open while a press on one of their calls is under way or shows its stop box. */
function HoldWhile({ on }: { on: boolean }) {
  useHoldOpen(on);
  return null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The developer's live-call panel (owner layout): the rate line; one tick row per tester with their terms and
 * "N of 3 booked or requested" ((§185) booked times + waiting requests, the pair's limit); [Request a time] to everyone ticked; then (Owner, Nov 6, §291) at the
 * bottom "Booked (N)": one drop-down per tester with a call, their booked calls and daily/weekly sets (one line each) soonest first ((§181) the waiting requests
 * are the page's Call requests box). Boxes under the button.
 */
export function DevCallPanel({ testId, seenAt, testers, canRequest, noRequestReason = "", elsewhere = [], leadMinutes, end }: { testId: string; seenAt: string; /** (Batch 29 section 20) the server's call lead, passed down */ leadMinutes: number; testers: DevTester[]; canRequest: boolean; noRequestReason?: string; elsewhere?: OtherCall[];
  /** (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (the server's, in the reader's words): the time box's latest time and the calls drop-down. */
  end?: CallEnd }) {
  const router = useRouter();
  // (Batch 16 section 21) A call request, booking or cancellation from another tab stops a press touching it once: the panel shows it at once.
  // (Owner, Nov 5, §278) Request a time's refusal lines for ticked testers whose session ended meanwhile (the others' press went on): beside its stop box or done
  // line; their ticks go.
  const [goneLines, setGoneLines] = useState<{ contractId: string; text: string }[]>([]);
  const takeGone = (data: Record<string, unknown> | null | undefined) => {
    const g = Array.isArray(data?.gone) ? (data.gone as { contractId: string; text: string }[]) : [];
    setGoneLines(g);
    if (g.length) setTicked((now) => now.filter((id) => !g.some((x) => x.contractId === id)));
  };
  const { press, changes, error, busy, at, errData, doneLine, finish } = usePress(seenAt, (data) => { if (Array.isArray(data?.gone)) takeGone(data); router.refresh(); }, { onFresh: () => { setFrozen(null); setMade(null); setGoneLines([]); } });
  // Requesting the same time again is already done: said plainly, and the request shows in the panel.
  useEffect(() => {
    if (error.startsWith("You already requested this time")) router.refresh();
  }, [error, router]);
  const [ticked, setTicked] = useState<string[]>([]);
  // (§278) A ticked tester whose row left the list (left, ended…) is unticked on the redraw, and never sent hidden.
  useDropGoneTicks(testers.map((t) => t.contractId), setTicked);
  const tickedIds = liveTicks(ticked, testers.map((t) => t.contractId));
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [minutes, setMinutes] = useState("");
  // (Owner, Oct 28, batch 20 section 18) The typed times, length and ticks survive any reload (kept on the server, "Draft"; batch 35 §8: after signing in, with "Use saved"), and are forgotten once sent.
  const keep = useKept<{ rows: RowState[]; minutes: string; ticked: string[] }>(`request:t-${testId}`, { rows, minutes, ticked }, rows.every((r) => !r.when) && !minutes.trim(), (v) => {
    if (Array.isArray(v.rows) && v.rows.length) setRows(v.rows);
    setMinutes(typeof v.minutes === "string" ? v.minutes : "");
    if (Array.isArray(v.ticked)) setTicked(v.ticked.filter((id) => testers.some((t) => t.contractId === id)));
  });
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(leadMinutes); // (batch 27 section 6; batch 29 section 20) the server's lead, passed from the server
  const shut = useWindowShutLine(end, leadMinutes); // (batch 35 §132) "No more calls can be requested: …"
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // (Batch 16 section 10) A mistake in the request form is red at its box and listed under Request a time (not as a plain line).
  const red = error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={k === "request" && red ? "" : error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /></div> : null);
  const go = async (path: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`/api/tests/${testId}/${path}`, body, key);
    if (r) finish(); // (batch 35 §40, §41) the page redraws in place; the buttons stay greyed until it has
  };
  // (Batch 20 section 7) From the Request a time press until the reload, the clash checks use the testers as they were when pressed and never what the press made
  // (its new requests, or the call it booked); the form clears as soon as it goes through.
  const [frozen, setFrozen] = useState<{ testers: DevTester[]; elsewhere: OtherCall[] } | null>(null);
  const [made, setMade] = useState<PressMade | null>(null);
  // (Owner, Nov 5, §261) From Request a time until it ends (and, gone through, until the redraw), the times and the length are read-only and Discard waits.
  const requesting = useSending();
  const request = (body: Record<string, unknown>) => requesting.run(async () => {
    setFrozen({ testers, elsewhere });
    setGoneLines([]);
    const r = await press<{ message?: string; gone?: { contractId: string; text: string }[] }>(`/api/tests/${testId}/request-time`, body, "request");
    if (r) takeGone(r);
    if (r) {
      setMade(madeBy(r));
      setRows([newRow()]);
      setMinutes("");
      await keep.clear();
      finish(sentLine(r)); // (§208) "3 requests sent." for 3 times (§278: a gone tester's refusal line shows beside it)
    } else setFrozen(null);
  });
  const sendLocked = requesting.sending || (busy && at === "request");
  const checked = formClashInputs(testers.map((t) => ({ ...t, calls: [...t.calls, ...t.sets.flatMap((x) => x.calls)] })), frozen ? frozen.testers.map((t) => ({ ...t, calls: [...t.calls, ...t.sets.flatMap((x) => x.calls)] })) : null, made);
  const all = testers.length > 0 && testers.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows, end);
  // (Owner, Oct 28, batch 16 section 33) Clash checks as the form is filled, for every ticked tester (and every call of a Daily / Weekly set): red lines under the
  // row (listed under the button; the press waits until fixed), a blue line for an exact match with their waiting request, and the limits in today's wording.
  // (Owner, Nov 6, §280) The Length is 10–180 minutes whatever is left of the $1,000 for the ticked testers' calls (no "At most N minutes", no cap in the hint).
  const clash = alignedClash(rows, minutes, "developer", checked.filter((t) => ticked.includes(t.contractId)).map((t) => ({
    name: t.name, pending: t.pending, booked: t.booked, busy: t.busy,
    calls: t.calls.map((c) => ({ id: c.id, start: c.when, minutes: c.minutes })),
    requests: t.requests.map((q) => ({ id: q.id, rows: q.rows, minutes: q.minutes ?? 0, mine: q.mine })),
  })), (frozen?.elsewhere ?? elsewhere).filter((c) => !ticked.includes(c.contractId)).map((c) => ({ start: c.start, minutes: c.minutes, name: c.name })), end);
  // (Owner, Oct 28, batch 16 section 21) What this form is requesting that is now booked or requested (e.g. from another tab): marked; the rest of the form stays.
  const already = filled.flatMap((r) => ticked.flatMap((cid) => {
    const t = checked.find((x) => x.contractId === cid);
    if (!t) return [];
    const at = new Date(r.startsAt).getTime();
    if (t.calls.some((c) => new Date(c.when).getTime() === at)) return [`Already booked: ${t.name}, ${fmt(r.startsAt)}`];
    if (t.requests.some((q) => q.mine && q.rows.some((x) => new Date(x.startsAt).getTime() === at))) return [`Already requested: ${t.name}, ${fmt(r.startsAt)}`];
    return [];
  }));
  // (Owner, Nov 6, §291) The Booked section: every tester with a call or a set ahead (or running), by their soonest call.
  const firstAt = (t: DevTester) => [...t.calls.map((c) => c.when), ...t.sets.flatMap((x) => x.calls.map((c) => c.when))].sort()[0] ?? "";
  const withCalls = testers.filter((t) => t.calls.length > 0 || t.sets.length > 0).sort((a, b) => firstAt(a).localeCompare(firstAt(b)));
  /** (§291) A tester's booked calls: each call, and each call of a set (a running Forever set with none listed is one booked time, as §185 counts it). */
  const callsOf = (t: DevTester) => t.calls.length + t.sets.reduce((n, x) => n + Math.max(1, x.calls.length), 0);
  const bookedN = withCalls.reduce((n, t) => n + callsOf(t), 0);
  const joinableFor = (t: DevTester) => t.calls.some((c) => c.joinable) || t.sets.some((x) => x.calls.some((c) => c.joinable));
  /** (§291) A tester's calls and sets in one list, soonest first (a set by its next call). */
  const soonestFirst = (t: DevTester) => [
    ...t.calls.map((call) => ({ kind: "call" as const, at: call.when, call })),
    ...t.sets.map((set) => ({ kind: "set" as const, at: set.calls.map((c) => c.when).sort()[0] ?? "", set })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const callRow = (t: DevTester, c: DevCall) => (
    <li key={c.id} id={`call-${c.id}`} className="flex flex-wrap items-center gap-2">
      {/* (Owner, Nov 6, §291; §187 item 5) Inside the tester's own drop-down: the name is on the drop-down, once, not on every row. */}
      <span className="mr-auto min-w-0">{fmt(c.when)} · {c.minutes} min · {c.rate}{c.late && <span className="ml-2 badge">{c.late}</span>}{c.measuring && <span className="ml-2 badge border-sky-300/40 text-sky-200" data-measuring="">{c.measuring}</span>}</span>
      {/* (Owner, Nov 3, long text) The call's buttons stay together: beside the line when there is room, all on a line of their own when it is long
          (never Add to calendar on one line and Cancel on the next). */}
      <span className="flex max-w-full flex-wrap items-center gap-2" data-call-buttons="">
        {c.joinable && <JoinCall callId={c.id} />}
        {!c.started && <a href={`/api/calls/${c.id}/ics`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline"><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>}
        {!c.started && <CancelMenu needsReason={!c.canCancel} busy={busy} other={t.name} onCancel={(why) => go("cancel-call", { callId: c.id, reason: why }, "cancel-" + c.id)} />}
        {c.started && <ReportProblem path={`/api/tests/${testId}/no-show`} callId={c.id} otherName={t.name} seenAt={seenAt} reported={c.report ?? null} />}
      </span>
      {box("cancel-" + c.id)}
      {box("noshow-" + c.id)}
      <CallCheck className="w-full" />
      {c.joinable && <div className="w-full"><CallPresence callId={c.id} startsAt={c.when} minutes={c.minutes} /></div>}
      {c.joinable && <div className="w-full"><CallTimer startsAt={c.when} minutes={c.minutes} role="developer" label={`Call with ${t.name}`} /></div>}
    </li>
  );

  // A booked daily / weekly set: one line (its calls under "Show calls", open while one can be joined) with "Cancel the remaining calls".
  const setRow = (t: DevTester, s: DevSet) => (
    <li key={s.id} className="space-y-1" data-call-set="">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto min-w-0">{s.label} · {s.minutes} min · {s.rate}</span>
        <button className="btn-ghost text-xs" onClick={() => setOpen({ ...open, [s.id]: !(open[s.id] ?? s.calls.some((c) => c.joinable)) })}>{(open[s.id] ?? s.calls.some((c) => c.joinable)) ? "Hide calls" : "Show calls"}</button>
        <CancelMenu needsReason={s.needsReason} busy={busy} other={t.name} label="Cancel the remaining calls"
          rule={`Cancels every call still ahead and ${t.name} is told.${s.needsReason ? " The next one is less than 24 hours away: say why." : ""}`}
          onCancel={(why) => go("cancel-set", { contractId: t.contractId, setId: s.id, reason: why }, "cancel-set-" + s.id)} />
      </div>
      <p className="text-xs text-slate-400">Cancel to stop the remaining calls.</p>
      {box("cancel-set-" + s.id)}
      {(open[s.id] ?? s.calls.some((c) => c.joinable)) && <ul className="ml-4 space-y-1">{s.calls.map((c) => callRow(t, c))}</ul>}
    </li>
  );

  return (
    // The full app's ONE Live session panel (a fold on the test page), its length the next booked call's.
    <LivePanel fold minutes={testers.flatMap((t) => [...t.calls, ...t.sets.flatMap((x) => x.calls)]).filter((c) => !c.started).sort((a, b) => a.when.localeCompare(b.when))[0]?.minutes ?? null}>
    <section className="space-y-3" id="calls" aria-label="Call requests">
      {/* (Owner, Oct 28) A stopped test shows only what still works: no request-tool text. */}
      {canRequest && <p className="note">Calls you request use each tester&apos;s contract rate. A call that isn&apos;t a listed part reads “Not listed”: its pay is up to you.</p>}
      {/* The form is never hidden silently: a short line says why. */}
      {!canRequest && noRequestReason && <p className="note" data-no-request="">{noRequestReason}</p>}
      {canRequest && testers.length === 0 && <p className="note">Nobody is working on this test right now, so there is nobody to request a call with.</p>}
      {canRequest && testers.length > 0 && (
        <fieldset className="max-h-48 min-w-0 space-y-1 overflow-y-auto pr-1 text-sm">
          <label className="block font-medium"><input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : testers.map((t) => t.contractId))} /> Select all ({testers.length})</label>
          {testers.map((t) => (
            <label key={t.contractId} className="block">
              <input type="checkbox" checked={ticked.includes(t.contractId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.contractId] : ticked.filter((x) => x !== t.contractId))} /> <b><Cut fit text={t.name} /></b> · {t.terms} · {t.booked + (t.pending ?? 0)} of 3 booked or requested
              {t.warning && <span className="block pl-5 text-xs text-amber-200" data-calls-warning="">{t.warning}</span>}
            </label>
          ))}
        </fieldset>
      )}
      {/* (Owner, Nov 1, batch 35 §103) Nobody working: no form (it could only be refused). (Batch 35 §132) Less than the lead left before testers' work ends: no
          time fits, so no form either, and a line says why. */}
      {canRequest && testers.length > 0 && shut && <p className="note" data-window-shut="">{shut}</p>}
      {canRequest && testers.length > 0 && !shut && (
        <div className="space-y-2 text-sm" ref={form} data-mistakes-root="">
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} notes={clash.notes} leadMinutes={leadMinutes} end={end} locked={sendLocked} />
          {clash.limits.map((l) => <p key={l} className="err-field" tabIndex={-1} data-red-msg={l} data-clash-limit="">{l}</p>)}
          {already.length > 0 && <ul className="space-y-0.5 text-xs text-amber-200" data-already="">{already.map((l) => <li key={l}>{l}</li>)}</ul>}
          {/* (Batch 19 section 5) The Length label and "min" stay on one line (never squeezed), and a red line at the box goes under the whole row. */}
          <div className="flex flex-wrap items-end gap-2" data-note-after="" data-length-row="">
            <label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max="180" data-whole="" data-msg="A live call lasts from 10 to 180 minutes." data-required="" data-required-msg="Enter the call's length in minutes."
              data-match="length in minutes|live call lasts" value={minutes} onChange={(e) => setMinutes(e.target.value)} {...lockText(sendLocked)} /> min</label>
            <span className="pb-2 text-xs text-slate-500" data-length-hint="">10–180</span>
            <button
              className="btn"
              disabled={busy || !filled.length || tickedIds.length === 0}
              onClick={() => checkFields(form.current) && request({ contractIds: tickedIds, minutes: minutes.trim() ? minutes.trim() : "", rows: filled })}
            >
              Request a time
            </button>
            {keep.restored && <DraftTag disabled={busy} kind="discard" onUseSaved={() => { setRows([newRow()]); setMinutes(""); setTicked([]); }} />}
          </div>
          {tickedIds.length === 0 && <p className="note">Tick one or more testers to request a time.</p>}
          {goneLines.length > 0 && at === "request" && <div className="info" role="status" data-request-gone="">{goneLines.map((g) => <p key={g.contractId} data-refusal="">{g.text}</p>)}</div>}
          {box("request")}
          <PressDone line={doneLine} />
          <FormMistakes text={at === "request" && red ? error : ""} press="Request a time" />
        </div>
      )}
      {/* (Owner, Nov 4, §181) The waiting call requests (theirs and yours) are no longer here: they are the page's own Call requests box (CallRequestsBox), one
          drop-down per person; nor is each tester's "Waiting" list below. */}
      {/* (Owner, Nov 6, §291) The booked calls are their own section at the BOTTOM of the Live session: "Booked (N)", then the draggable panel (OwnPanel: its own
          scroll), holding one drop-down per tester (the green name, "· N calls"; closed at first, open while one of their calls can be joined; a link to
          #call-<id> opens it), each with that tester's calls and sets soonest first in a scroll box of its own. Every row keeps its buttons (Join, Add to calendar,
          Cancel and its Why, Report a problem, Check your call setup) and its call-<id> anchor. (§187 item 5) Inside the tester's own drop-down the rows don't repeat
          the name. Was (batch 15 §33, §152) one card per tester (ticked, or everyone with a call) under the request form. */}
      {(bookedN > 0 || canRequest) && (
        <section className="space-y-1.5" id={BOOKED_SECTION} data-live-section="Booked" data-booked-section={bookedN} aria-label="Booked calls">
          <h3 className="text-sm font-semibold text-white">Booked ({bookedN})</h3>
          {bookedN === 0 && <p className="note">No calls booked yet.</p>}
          {bookedN > 0 && <OwnPanel><ResizeBox id={`testers-calls-${testId}`} label="Booked calls" defaultMax={LIST_PANEL.testersCalls} tallest={TESTERS_CALLS_TALLEST}>
          <div className="space-y-2" data-testers-calls="">
          {withCalls.map((t) => (
            <HoldFold key={t.contractId} defaultOpen={joinableFor(t)} data={{ id: bookedPersonAnchor(t.contractId), "data-booked-person": t.contractId }} toggleData={{ "data-booked-person-toggle": "" }}
              summary={<span className="flex min-w-0 flex-1 items-baseline gap-1"><span className="min-w-0"><NameLink fit text={t.name} href={t.testerHref} /></span><span className="shrink-0 whitespace-nowrap font-normal text-slate-400" data-booked-count="">· {callsOf(t)} call{callsOf(t) === 1 ? "" : "s"}</span></span>}>
              {/* A press on one of their calls (under way, or its stop box) keeps their drop-down open. */}
              <HoldWhile on={!!at && (t.calls.some((c) => at === "cancel-" + c.id) || t.sets.some((x) => at === "cancel-set-" + x.id || x.calls.some((c) => at === "cancel-" + c.id)))} />
              {t.warning && <p className="text-xs text-amber-200" data-calls-warning="">{t.warning}</p>}
              <OwnPanel><ResizeBox id={`booked-${t.contractId}`} label={`Booked calls with ${t.name}`} defaultMax={LIST_PANEL.booked}>
              <ul className="space-y-1 text-sm" data-booked-scroll="">
                {soonestFirst(t).map((item) => item.kind === "call" ? callRow(t, item.call) : setRow(t, item.set))}
              </ul>
              </ResizeBox></OwnPanel>
            </HoldFold>
          ))}
          </div>
          </ResizeBox></OwnPanel>}
        </section>
      )}
    </section>
    </LivePanel>
  );
}
