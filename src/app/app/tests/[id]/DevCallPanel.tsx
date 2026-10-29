"use client";
import { useEffect, useRef, useState } from "react";
import { lengthCap } from "@/lib/callMeasure";
import { useRouter } from "next/navigation";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD } from "@/lib/client";
import { JoinCall } from "@/components/JoinCall";
import { CalendarPlus } from "lucide-react";
import { usePress } from "@/lib/usePress";
import { LivePanel } from "@/components/LivePanel";
import { CallTimer } from "@/components/CallTimer";
import { ReportProblem } from "@/components/ReportProblem";
import { CallPresence } from "@/components/CallPresence";
import { CancelMenu } from "@/components/CancelMenu";
import type { RowJson } from "@/lib/callRows";
import { alignedClash, describeRows, newRow, RequestRows, rowsPayload, type RowState } from "@/components/RequestRows";
import { CallRequestsPanel, type PanelReq } from "@/components/CallRequestsPanel";
import { jumpTo } from "@/lib/markJump";

export type DevCall = { id: string; when: string; minutes: number; rate: string; canCancel: boolean; started: boolean; reported: boolean; late?: string; joinable?: boolean; report?: { byMe: boolean; note: string } | null; measuring?: string };
/** A booked daily / weekly set: its line ("Weekly · Mon 3:00 PM (3 left)", or no count for Forever), and whether Cancel needs a reason. */
export type DevSet = { id: string; label: string; minutes: number; rate: string; needsReason: boolean; calls: DevCall[] };
export type DevReq = { id: string; rows: RowJson[]; mine: boolean; rate: string; minutes?: number };
export type DevTester = { contractId: string; name: string; terms: string; booked: number; calls: DevCall[]; sets: DevSet[]; requests: DevReq[]; warning?: string;
  /** (Batch 16 section 33) For the clash checks: waiting requests with them (both sides), what's left of the $1,000 and the rate a call books at. */
  pending?: number; leftCents?: number | null; rateCents?: number | null };
/** (Batch 16 section 33) The developer's other calls (any tester, any test): "You have a call with Ana Silva then (1:30–2:00 PM)." */
export type OtherCall = { contractId: string; name: string; start: string; minutes: number };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The developer's live-call panel (owner layout): the rate line; one tick row per tester with their terms and
 * "N of 3 booked"; [Request a time] to everyone ticked; then per-tester blocks (ticked testers, or everyone with a call or
 * request when nothing is ticked): booked calls, daily/weekly sets as one line, waiting requests. Boxes under the button.
 */
export function DevCallPanel({ testId, seenAt, testers, canRequest, noRequestReason = "", requests = [], elsewhere = [] }: { testId: string; seenAt: string; testers: DevTester[]; canRequest: boolean; noRequestReason?: string; /** (Batch 16 section 33) every waiting request, both directions */ requests?: PanelReq[]; elsewhere?: OtherCall[] }) {
  const router = useRouter();
  // (Batch 16 section 21) A call request, booking or cancellation from another tab stops a press touching it once: the panel shows it at once.
  const { press, changes, error, busy, at, errData } = usePress(seenAt, () => router.refresh());
  // Requesting the same time again is already done: said plainly, and the request shows in the panel.
  useEffect(() => {
    if (error.startsWith("You already requested this time")) router.refresh();
  }, [error, router]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [minutes, setMinutes] = useState("");
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(5);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // (Batch 16 section 10) A mistake in the request form is red at its box and listed under Request a time (not as a plain line).
  const red = error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={k === "request" && red ? "" : error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /></div> : null);
  const go = async (path: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`/api/tests/${testId}/${path}`, body, key);
    if (r) {
      window.location.reload();
    }
  };
  const all = testers.length > 0 && testers.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows);
  // (Owner, Oct 28, batch 16 section 33) Clash checks as the form is filled, for every ticked tester (and every call of a Daily / Weekly set): red lines under the
  // row (listed under the button; the press waits until fixed), a blue line for an exact match with their waiting request, and the limits in today's wording.
  const tickedTesters = testers.filter((t) => ticked.includes(t.contractId));
  // (Batch 18 section 6) The Length is at most what's left of the $1,000 for the ticked testers' calls at their rate (the smallest applies, named).
  const lenCap = lengthCap(tickedTesters);
  const clash = alignedClash(rows, minutes, "developer", tickedTesters.map((t) => ({
    name: t.name, pending: t.pending, booked: t.booked, leftCents: t.leftCents, rateCents: t.rateCents,
    calls: [...t.calls, ...t.sets.flatMap((x) => x.calls)].map((c) => ({ start: c.when, minutes: c.minutes })),
    requests: t.requests.map((q) => ({ id: q.id, rows: q.rows, minutes: q.minutes ?? 0, mine: q.mine })),
  })), elsewhere.filter((c) => !ticked.includes(c.contractId)).map((c) => ({ start: c.start, minutes: c.minutes, name: c.name })));
  // (Owner, Oct 28, batch 16 section 21) What this form is requesting that is now booked or requested (e.g. from another tab): marked; the rest of the form stays.
  const already = filled.flatMap((r) => ticked.flatMap((cid) => {
    const t = testers.find((x) => x.contractId === cid);
    if (!t) return [];
    const at = new Date(r.startsAt).getTime();
    if ([...t.calls, ...t.sets.flatMap((x) => x.calls)].some((c) => new Date(c.when).getTime() === at)) return [`Already booked: ${t.name}, ${fmt(r.startsAt)}`];
    if (t.requests.some((q) => q.mine && q.rows.some((x) => new Date(x.startsAt).getTime() === at))) return [`Already requested: ${t.name}, ${fmt(r.startsAt)}`];
    return [];
  }));
  const shown = ticked.length ? testers.filter((t) => ticked.includes(t.contractId)) : testers.filter((t) => t.calls.length || t.sets.length || t.requests.length);

  const callRow = (t: DevTester, c: DevCall) => (
    <li key={c.id} id={`call-${c.id}`} className="flex flex-wrap items-center gap-2">
      <span className="mr-auto">{t.name} · {fmt(c.when)} · {c.minutes} min · {c.rate}{c.late && <span className="ml-2 badge">{c.late}</span>}{c.measuring && <span className="ml-2 badge border-sky-300/40 text-sky-200" data-measuring="">{c.measuring}</span>}</span>
      {c.joinable && <JoinCall callId={c.id} />}
      {!c.started && <a href={`/api/calls/${c.id}/ics`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline"><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>}
      {!c.started && <CancelMenu needsReason={!c.canCancel} busy={busy} other={t.name} onCancel={(why) => go("cancel-call", { callId: c.id, reason: why }, "cancel-" + c.id)} />}
      {c.started && <ReportProblem path={`/api/tests/${testId}/no-show`} callId={c.id} otherName={t.name} seenAt={seenAt} reported={c.report ?? null} />}
      {box("cancel-" + c.id)}
      {box("noshow-" + c.id)}
      {c.joinable && <div className="w-full"><CallPresence callId={c.id} startsAt={c.when} minutes={c.minutes} /></div>}
      {c.joinable && <div className="w-full"><CallTimer startsAt={c.when} minutes={c.minutes} role="developer" label={`Call with ${t.name}`} /></div>}
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
        <fieldset className="max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
          <label className="block font-medium"><input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : testers.map((t) => t.contractId))} /> Select all ({testers.length})</label>
          {testers.map((t) => (
            <label key={t.contractId} className="block">
              <input type="checkbox" checked={ticked.includes(t.contractId)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.contractId] : ticked.filter((x) => x !== t.contractId))} /> <b>{t.name}</b> · {t.terms} · {t.booked} of 3 booked
              {t.warning && <span className="block pl-5 text-xs text-amber-200" data-calls-warning="">{t.warning}</span>}
            </label>
          ))}
        </fieldset>
      )}
      {canRequest && (
        <div className="space-y-2 text-sm" ref={form} data-mistakes-root="">
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} notes={clash.notes} />
          {clash.limits.map((l) => <p key={l} className="err-field" tabIndex={-1} data-red-msg={l} data-clash-limit="">{l}</p>)}
          {already.length > 0 && <ul className="space-y-0.5 text-xs text-amber-200" data-already="">{already.map((l) => <li key={l}>{l}</li>)}</ul>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="inline-flex items-center gap-1 text-sm">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max={lenCap ? lenCap.max : 180} data-max-msg={lenCap?.line} data-whole="" data-msg="A live call lasts from 10 to 180 minutes." data-required="" data-required-msg="Enter the call's length in minutes."
              data-match="length in minutes|live call lasts|^At most \d+ minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min <span className="text-xs text-slate-500" data-length-hint="">{lenCap ? lenCap.hint : "10–180"}</span></label>
            <button
              className="btn"
              disabled={busy || !filled.length || ticked.length === 0}
              onClick={() => checkFields(form.current) && go("request-time", { contractIds: ticked, minutes: minutes.trim() ? minutes.trim() : "", rows: filled }, "request")}
            >
              Request a time
            </button>
          </div>
          {ticked.length === 0 && <p className="note">Tick one or more testers to request a time.</p>}
          {box("request")}
          <FormMistakes text={at === "request" && red ? error : ""} press="Request a time" />
        </div>
      )}
      <CallRequestsPanel side="developer" seenAt={seenAt} requests={requests} path={() => `/api/tests/${testId}`} />
      {shown.length === 0 && canRequest && <p className="note">No calls or requests yet.</p>}
      {/* (Batch 15 section 33) The whole list of tester cards scrolls on its own once it's taller than about 2 screens; the tick list and the request form stay above it. */}
      <div className="max-h-[200vh] space-y-2 overflow-y-auto pr-1" data-testers-calls="">
      {shown.map((t) => (
        <div key={t.contractId} className="space-y-1 rounded-lg border border-white/10 p-3 text-sm">
          <h3>{t.name}</h3>
          {!t.calls.length && !t.sets.length && !t.requests.length && <p className="note">No calls or requests</p>}
          {t.warning && <p className="text-xs text-amber-200" data-calls-warning="">{t.warning}</p>}
          {(t.calls.length > 0 || t.sets.length > 0) && <p className="font-medium">Booked</p>}
          {/* (Batch 15 sections 33 and 42) Calls ahead and in progress, soonest first, in a scroll box about 3 calls tall; calls that are over are in the tester's row. */}
          <ul className="max-h-40 space-y-1 overflow-y-auto pr-1" data-booked-scroll="">
            {t.calls.map((c) => callRow(t, c))}
            {t.sets.map((s) => (
              <li key={s.id} className="space-y-1" data-call-set="">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">{t.name} · {s.label} · {s.minutes} min · {s.rate}</span>
                  <button className="btn-ghost text-xs" onClick={() => setOpen({ ...open, [s.id]: !(open[s.id] ?? s.calls.some((c) => c.joinable)) })}>{(open[s.id] ?? s.calls.some((c) => c.joinable)) ? "Hide calls" : "Show calls"}</button>
                  <CancelMenu needsReason={s.needsReason} busy={busy} other={t.name} label="Cancel the remaining calls"
                    rule={`Cancels every call still ahead and ${t.name} is told.${s.needsReason ? " The next one is less than 24 hours away: say why." : ""}`}
                    onCancel={(why) => go("cancel-set", { contractId: t.contractId, setId: s.id, reason: why }, "cancel-set-" + s.id)} />
                </div>
                <p className="text-xs text-slate-400">Cancel to stop the remaining calls.</p>
                {box("cancel-set-" + s.id)}
                {(open[s.id] ?? s.calls.some((c) => c.joinable)) && <ul className="ml-4 space-y-1">{s.calls.map((c) => callRow(t, c))}</ul>}
              </li>
            ))}
          </ul>
          {/* (Batch 16 section 33) Their waiting requests and yours, as they arrive; each opens its row in Call requests (Accept / Decline / Withdraw are there). */}
          {t.requests.length > 0 && <p className="font-medium">Waiting</p>}
          <ul className="space-y-1">
            {t.requests.map((r) => (
              <li key={r.id}>
                <a href={`#req-${r.id}`} onClick={(e) => { e.preventDefault(); jumpTo(`req-${r.id}`); }}>
                  {r.mine ? "You requested" : `${t.name} requested`} {describeRows(r.rows)}{r.minutes ? ` · ${r.minutes} min` : ""} · {r.rate}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
    </section>
    </LivePanel>
  );
}
