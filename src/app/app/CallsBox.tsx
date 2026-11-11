"use client";
import { Cut, TestName } from "@/components/Cut";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { CancelMenu } from "@/components/CancelMenu";
import { LIST_PANEL } from "@/components/ScrollList";
import { ResizeBox } from "@/components/Panel";
import { usePress } from "@/lib/usePress";
import { CallCheck } from "@/components/CallCheck";

export type DashCall = { id: string; testId: string; test: string; who: string; when: string; minutes: number; needsReason: boolean; joinable: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * (Design doc 3; owner, Oct 27) The developer dashboard's Calls box: every booked call, soonest first. (Owner, Nov 11, §380 L) No Join call here. Each row links to that call on
 * the test page, where it can be cancelled; while the account is suspended or on hold the test pages are closed, so the row has Cancel itself (the one press that still works). The
 * press follows the stop-once and refusal rules: its box shows right under the row.
 */
export function CallsBox({ calls, seenAt, restricted }: { calls: DashCall[]; seenAt: string; restricted: boolean }) {
  const { press, changes, error, busy, at, finish } = usePress(seenAt);
  return (
    <section className="space-y-3" aria-label="Calls" id="calls-box">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="h-5 w-5 text-amber-300" /> Calls{/* (Owner, Nov 2) no "soonest first": the order speaks for itself */}</h2>
      {calls.length === 0 ? <p className="card text-sm text-slate-400">No booked calls.</p> : (
        <div className="card p-3">
          {/* (Owner, Nov 3, batch 35 §152) In the draggable panel (§139): it scrolls inside, and the grip drags it shorter or taller. */}
          <ResizeBox id="dash-calls" label="Calls" defaultMax={LIST_PANEL.dashCalls}>
          <ul className="divide-y divide-white/5" data-dash-calls="">
            {calls.map((c) => (
              <li key={c.id} className="space-y-1 py-2 text-sm" data-call-row={c.id}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* (Owner, Nov 3, long text) Only the names are cut with "…": the call's day, time and length always show, on a line of their own when the
                      names are long. */}
                  {restricted ? (
                    <span className="mr-auto flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 text-slate-200"><span className="min-w-0 max-w-full [overflow-wrap:anywhere]"><b className="text-white"><Cut text={c.who} /></b> · <TestName text={c.test} /></span> <span className="whitespace-nowrap">· {fmt(c.when)} · {c.minutes} min</span></span>
                  ) : (
                    <Link href={`/app/tests/${c.testId}#call-${c.id}`} className="mr-auto flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 text-slate-200 no-underline hover:underline"><span className="min-w-0 max-w-full [overflow-wrap:anywhere]"><b className="text-white"><Cut text={c.who} /></b> · <TestName text={c.test} /></span> <span className="whitespace-nowrap">· {fmt(c.when)} · {c.minutes} min <ArrowRight className="inline h-4 w-4 text-indigo-300" /></span></Link>
                  )}
                  {/* (Owner, Nov 11, §380 L) No Join call here: the row links to the call on the test page. */}
                  {restricted && <CancelMenu needsReason={c.needsReason} busy={busy} other={c.who} onCancel={(reason) => void press(`/api/tests/${c.testId}/cancel-call`, { callId: c.id, reason }, c.id).then((r) => r && finish())} />}
                </div>
                <CallCheck />
                {at === c.id && <ChangesBox changes={changes} error={error} />}
              </li>
            ))}
          </ul>
          </ResizeBox>
        </div>
      )}
    </section>
  );
}
