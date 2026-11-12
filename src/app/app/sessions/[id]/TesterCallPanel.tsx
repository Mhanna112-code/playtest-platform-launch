"use client";
import { useEffect, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { JoinCall } from "@/components/JoinCall";
import { CalendarPlus } from "lucide-react";
import { CallTimer } from "@/components/CallTimer";
import { ReportProblem } from "@/components/ReportProblem";
import { CallPresence, CallTimelineLine } from "@/components/CallPresence";
import { LIVE_SECTIONS, LiveSection } from "@/components/LivePanel";
import { CancelMenu, cancelButton } from "@/components/CancelMenu";
import { FIELD } from "@/lib/client";
import { CallCheck } from "@/components/CallCheck";
import { LIST_PANEL } from "@/components/ScrollList";

export type TesterSet = { id: string; label: string; minutes: number; rate: string; needsReason: boolean; callIds: string[] };
type Mine = { id: string; setId?: string | null; when: string; minutes: number; canCancel: boolean; started: boolean; ended?: boolean; reported: boolean; cancelled: string; late?: string; rate?: string; joinable?: boolean; devJoinedAt?: string | null; testerJoinedAt?: string | null; joined?: string; outcome?: { label: string; tone: "grey" | "amber" | "green" | "rose" }[]; logged?: number | null; lengthText?: string; report?: { byMe: boolean; note: string } | null };
const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-400/40 text-rose-200" } as const;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The tester's calls still ahead or running, in the Live session's "Booked" (Join call while it can be joined, Cancel). Cancel and Report a problem stop once
 * for call changes since the page loaded (box under the button).
 * (Owner, Nov 5, §209; undoes §186's move of these rows into a "Call history" card) Back in the Live session, in the §152 draggable panel `booked-<sessionId>`
 * as before §186. (Owner, Nov 6, §291) "Booked (N)", the LAST section of the Live session: under "Had (N)" / "Cancelled (N)" and the Requests.
 */
export function TesterCallPanel(p: { sessionId: string; seenAt: string; mine: Mine[]; sets?: TesterSet[]; refusal: string; lateNote?: string; devName: string; noReport?: boolean }) {
  const { press, changes, error, busy, at, finish } = usePress(p.seenAt);
  /** (§387 3) This key's press was refused: its menu's red list drops "press … again". */
  const refusedAt = (k: string) => at === k && !!error && !error.startsWith(FIELD);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox side="tester" changes={changes} error={error} button={cancelButton(k)} /></div> : null);
  async function go(action: string, body: Record<string, unknown>, key = action) {
    const r = await press(`/api/sessions/${p.sessionId}/${action}`, body, key);
    if (r) finish(); // (batch 35 §40, §41) the page redraws in place; the buttons stay greyed until it has
  }
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sets = p.sets ?? [];
  // (Owner, Nov 5, §209) A link to one call of a set ("#call-<id>": the dashboard's upcoming call, a bell) opens that set's calls, so HashJump finds the row.
  const setKey = sets.map((st) => `${st.id}:${st.callIds.join(",")}`).join(";");
  useEffect(() => {
    const show = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const st = id.startsWith("call-") ? sets.find((x) => x.callIds.includes(id.slice("call-".length))) : undefined;
      if (st) setOpen((o) => ({ ...o, [st.id]: true }));
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey]);
  const inSet = new Set(sets.flatMap((x) => x.callIds));
  // A booked set shows as one line (its calls inside "Show calls"); everything else as before.
  const booked = p.mine.filter((m) => !m.cancelled && !m.ended && !inSet.has(m.id));
  const row = (m: Mine) => (
    <li key={m.id} id={`call-${m.id}`} data-call={m.cancelled || m.ended ? "past" : "booked"} className="flex flex-wrap items-center gap-2 py-2 text-sm">
      {m.ended || m.cancelled ? (
        // Past calls (the full app's PastRow): when · length · who joined · outcome badges.
        <span className="mr-auto flex flex-wrap items-center gap-2">
          <span className="text-slate-200">{fmt(m.when)}</span>
          <span className="text-slate-400">· {m.logged ?? m.minutes} min{m.logged != null && m.logged !== m.minutes ? ` (booked ${m.minutes})` : ""}</span>
          {m.joined && !m.cancelled && <span className="text-xs text-slate-400">{m.joined}</span>}
          {(m.outcome ?? []).map((o) => <span key={o.label} className={`badge ${TONE[o.tone]}`}>{o.label}</span>)}
        </span>
      ) : (
        <span className="mr-auto text-slate-200">{fmt(m.when)} · {m.minutes} min{m.rate && ` · ${m.rate}`}{m.late && <span className="ml-2 badge">{m.late}</span>}</span>
      )}
      {!m.cancelled && m.joinable && <JoinCall callId={m.id} />}
      {!m.cancelled && !m.ended && <a href={`/api/calls/${m.id}/ics`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline"><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>}
      {/* (Batch 16 section 24) Once the work is over (a stop, a closure, an early end): no Cancel call and no Join call. */}
      {!m.cancelled && !m.started && !p.refusal && <CancelMenu needsReason={!m.canCancel} busy={busy} other={p.devName} refused={refusedAt("cancel-" + m.id)} onCancel={(why) => go("cancel-call", { callId: m.id, reason: why }, "cancel-" + m.id)} />}
      {!m.cancelled && m.started && !p.noReport && <ReportProblem path={`/api/sessions/${p.sessionId}/no-show`} callId={m.id} otherName={p.devName} seenAt={p.seenAt} reported={m.report ?? null} />}
      {/* (Batch 15 section 40) The app measures the length while you're both connected in the call room; nobody enters it. */}
      {m.started && !m.cancelled && m.lengthText && <span className="badge border-sky-300/40 text-sky-200" data-measuring="">{m.lengthText}</span>}
      {!m.cancelled && m.joinable && <div className="w-full"><CallPresence callId={m.id} startsAt={m.when} minutes={m.minutes} /></div>}
      {m.ended && !m.cancelled && <CallTimelineLine people={[{ name: p.devName, joinedAt: m.devJoinedAt ?? null }, { name: "You", joinedAt: m.testerJoinedAt ?? null }]} />}
      {!m.cancelled && m.joinable && <div className="w-full"><CallTimer startsAt={m.when} minutes={m.minutes} role="tester" label={`Call with ${p.devName}`} /></div>}
      {box("cancel-" + m.id)}
      {box("noshow-" + m.id)}
      {!m.cancelled && !m.ended && <CallCheck className="w-full" />}
    </li>
  );
  const setRow = (st: TesterSet) => {
    const calls = p.mine.filter((m) => st.callIds.includes(m.id));
    const shown = open[st.id] ?? calls.some((m) => m.joinable);
    return (
      <li key={st.id} className="space-y-1 py-2 text-sm" data-call-set="">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-slate-200">{st.label} · {st.minutes} min · {st.rate}</span>
          <button className="btn-ghost text-xs" onClick={() => setOpen({ ...open, [st.id]: !shown })}>{shown ? "Hide calls" : "Show calls"}</button>
          {!p.refusal && <CancelMenu needsReason={st.needsReason} busy={busy} other={p.devName} label="Cancel the remaining calls" refused={refusedAt("cancel-set-" + st.id)}
            rule={`Cancels every call still ahead and ${p.devName} is told.${st.needsReason ? " The next one is less than 24 hours away: say why." : ""}`}
            onCancel={(why) => go("cancel-set", { setId: st.id, reason: why }, "cancel-set-" + st.id)} />}
        </div>
        <p className="text-xs text-slate-400">Cancel to stop the remaining calls.</p>
        {box("cancel-set-" + st.id)}
        {shown && <ul className="ml-4 divide-y divide-white/5">{calls.map(row)}</ul>}
      </li>
    );
  };
  // (Owner, Nov 6, §291) Calls and sets in one list, soonest first (a set by its next call); the heading counts every call ahead, a set's too (a running Forever
  // set with none listed is one booked time, as §185 counts it).
  const items = [
    ...booked.map((call) => ({ kind: "call" as const, at: call.when, call })),
    ...sets.map((set) => ({ kind: "set" as const, at: p.mine.filter((m) => set.callIds.includes(m.id)).map((m) => m.when).sort()[0] ?? "", set })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const bookedN = booked.length + sets.reduce((n, st) => n + Math.max(1, p.mine.filter((m) => st.callIds.includes(m.id) && !m.cancelled && !m.ended).length), 0);
  if (!p.mine.length) return null;
  return (
    <div className="space-y-4" id="calls" data-calls-ahead={booked.length + sets.length}>
      {p.lateNote && !p.refusal && <p className="note">{p.lateNote}</p>}
      {/* (Owner, Nov 3, batch 35 §152) The booked calls in the draggable panel (scrolls inside; the grip drags it shorter or taller).
          (Owner, Nov 6, §291) At the bottom of the Live session (the page draws this panel last), headed "Booked (N)", calls and sets soonest first; one
          developer, so no per-name drop-down. */}
      <LiveSection title={LIVE_SECTIONS.booked} count={bookedN} show={booked.length > 0 || sets.length > 0} panel={`booked-${p.sessionId}`} panelMax={LIST_PANEL.testerBooked}>
        {items.map((it) => it.kind === "call" ? row(it.call) : setRow(it.set))}
      </LiveSection>
    </div>
  );
}
