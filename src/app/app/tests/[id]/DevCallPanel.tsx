"use client";
import { useRef, useState } from "react";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { JoinCall } from "@/components/JoinCall";
import { CalendarPlus } from "lucide-react";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";
import { LIVE_SECTIONS, LivePanel, LiveSection } from "@/components/LivePanel";
import { CallTimer } from "@/components/CallTimer";
import { ReportProblem } from "@/components/ReportProblem";
import { CallPresence, CallTimelineLine } from "@/components/CallPresence";
import { CancelMenu } from "@/components/CancelMenu";
import type { RowJson } from "@/lib/callRows";
import { acceptChoices, describeRows, newRow, RequestRows, rowsPayload, type RowState } from "@/components/RequestRows";

export type DevCall = { id: string; when: string; minutes: number; rate: string; canCancel: boolean; started: boolean; reported: boolean; late?: string; joinable?: boolean; report?: { byMe: boolean; note: string } | null };
/** A booked daily / weekly set: its line ("Weekly · Mon 3:00 PM (3 left)", or no count for Forever), and whether Cancel needs a reason. */
export type DevSet = { id: string; label: string; minutes: number; rate: string; needsReason: boolean; calls: DevCall[] };
export type DevReq = { id: string; rows: RowJson[]; mine: boolean; rate: string; minutes?: number };
export type DevPast = { id: string; who: string; when: string; minutes: number; logged: number | null; joined: string; outcome: { label: string; tone: "grey" | "amber" | "green" | "rose" }[]; devJoinedAt: string | null; testerJoinedAt: string | null; cancelled: boolean };
const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-400/40 text-rose-200" } as const;
export type DevTester = { contractId: string; name: string; terms: string; booked: number; calls: DevCall[]; sets: DevSet[]; requests: DevReq[] };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const short = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * The developer's live-call panel (owner layout): the rate line; one tick row per tester with their terms and
 * "N of 3 booked"; [Request a time] to everyone ticked; then per-tester blocks (ticked testers, or everyone with a call or
 * request when nothing is ticked): booked calls, daily/weekly sets as one line, waiting requests. Boxes under the button.
 */
export function DevCallPanel({ testId, seenAt, testers, canRequest, noRequestReason = "", past = [] }: { testId: string; seenAt: string; testers: DevTester[]; canRequest: boolean; noRequestReason?: string; past?: DevPast[] }) {
  const { press, changes, error, busy, at, errData } = usePress(seenAt);
  const [ticked, setTicked] = useState<string[]>([]);
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [minutes, setMinutes] = useState("");
  const form = useRef<HTMLDivElement>(null);
  const minNow = useLocalMin(5);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} link={typeof errData.requestId === "string" ? `req-${errData.requestId}` : undefined} /></div> : null);
  const go = async (path: string, body: Record<string, unknown>, key: string) => {
    const r = await press<{ message?: string }>(`/api/tests/${testId}/${path}`, body, key);
    if (r) {
      window.location.reload();
    }
  };
  const all = testers.length > 0 && testers.every((t) => ticked.includes(t.contractId));
  const filled = rowsPayload(rows);
  const shown = ticked.length ? testers.filter((t) => ticked.includes(t.contractId)) : testers.filter((t) => t.calls.length || t.sets.length || t.requests.length);

  const callRow = (t: DevTester, c: DevCall) => (
    <li key={c.id} id={`call-${c.id}`} className="flex flex-wrap items-center gap-2">
      <span className="mr-auto">{t.name} · {fmt(c.when)} · {c.minutes} min · {c.rate}{c.late && <span className="ml-2 badge">{c.late}</span>}</span>
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
      <p className="note">Calls you request use each tester&apos;s contract rate.</p>
      {/* The form is never hidden silently: a short line says why. */}
      {!canRequest && noRequestReason && <p className="note" data-no-request="">{noRequestReason}</p>}
      {canRequest && testers.length === 0 && <p className="note">Nobody is working on this test right now, so there is nobody to request a call with.</p>}
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
        <div className="space-y-2 text-sm" ref={form}>
          <RequestRows rows={rows} setRows={setRows} minNow={minNow} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="inline-flex items-center gap-1 text-sm">Length <input className="input w-20" inputMode="numeric" placeholder="60" aria-label="Length in minutes" data-min="10" data-max="180" data-whole="" data-msg="A live call lasts from 10 to 180 minutes." value={minutes} onChange={(e) => setMinutes(e.target.value)} /> min <span className="text-xs text-slate-500">10–180</span></label>
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
          {t.requests.length > 0 && <p className="font-medium">Waiting</p>}
          <ul className="space-y-1">
            {t.requests.map((r) => (
              <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 ${MARKABLE}`}>
                <span className="mr-auto">
                  {r.mine ? "You requested" : `${t.name} requested`}{" "}
                  {describeRows(r.rows)}{r.minutes ? ` · ${r.minutes} min` : ""} · {r.rate}
                </span>
                {r.mine ? (
                  <button className="btn-ghost" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "withdraw", contractId: t.contractId }, "w-" + r.id)}>Withdraw</button>
                ) : (
                  <>
                    {acceptChoices(r.rows).map((x) => (
                      <button key={x.label} className="btn" disabled={busy} onClick={() => go("answer-request", { requestId: r.id, action: "accept", ...(x.time ? { time: x.time } : {}), contractId: t.contractId }, "a-" + r.id)}>{x.label}</button>
                    ))}
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
    {/* Past calls (the full app's PastRow): when · who · length · who joined · outcome badges, and the room timeline. */}
    <LiveSection title={LIVE_SECTIONS.past} show={past.length > 0}>
      {past.map((x) => (
        <li key={x.id} id={`call-${x.id}`} data-call="past" className="flex flex-wrap items-center gap-2 py-2 text-sm">
          <span className="text-slate-200">{fmt(x.when)}</span>
          <span className="text-slate-400">· {x.who}</span>
          <span className="text-slate-400">· {x.logged ?? x.minutes} min{x.logged != null && x.logged !== x.minutes ? ` (booked ${x.minutes})` : ""}</span>
          {x.joined && !x.cancelled && <span className="text-xs text-slate-400">{x.joined}</span>}
          {x.outcome.map((o) => <span key={o.label} className={`badge ${TONE[o.tone]}`}>{o.label}</span>)}
          {!x.cancelled && <CallTimelineLine people={[{ name: x.who, joinedAt: x.testerJoinedAt }, { name: "You", joinedAt: x.devJoinedAt }]} />}
        </li>
      ))}
    </LiveSection>
    </LivePanel>
  );
}
