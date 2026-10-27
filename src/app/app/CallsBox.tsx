"use client";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { CancelMenu } from "@/components/CancelMenu";
import { JoinCall } from "@/components/JoinCall";
import { LongList } from "@/components/LongList";
import { usePress } from "@/lib/usePress";

export type DashCall = { id: string; testId: string; test: string; who: string; when: string; minutes: number; needsReason: boolean; joinable: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * (Design doc 3; owner, Oct 27) The developer dashboard's Calls box: every booked call, soonest first. Join appears only while the call can be joined. Each row links to that call on
 * the test page, where it can be cancelled; while the account is suspended or on hold the test pages are closed, so the row has Cancel itself (the one press that still works). The
 * press follows the stop-once and refusal rules: its box shows right under the row.
 */
export function CallsBox({ calls, seenAt, restricted }: { calls: DashCall[]; seenAt: string; restricted: boolean }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  return (
    <section className="space-y-3" aria-label="Calls" id="calls-box">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="h-5 w-5 text-amber-300" /> Calls <span className="text-sm font-normal text-slate-400">soonest first</span></h2>
      {calls.length === 0 ? <p className="card text-sm text-slate-400">No booked calls.</p> : (
        <div className="card p-3">
          <LongList shown={4} tall="max-h-72" className="divide-y divide-white/5">
            {calls.map((c) => (
              <li key={c.id} className="space-y-1 py-2 text-sm" data-call-row={c.id}>
                <div className="flex flex-wrap items-center gap-2">
                  {restricted ? (
                    <span className="mr-auto min-w-0 truncate text-slate-200" title={`${c.who} · ${c.test}`}><b className="text-white">{c.who}</b> · {c.test} · {fmt(c.when)} · {c.minutes} min</span>
                  ) : (
                    <Link href={`/app/tests/${c.testId}#call-${c.id}`} className="mr-auto min-w-0 truncate text-slate-200 no-underline hover:underline" title={`${c.who} · ${c.test}`}><b className="text-white">{c.who}</b> · {c.test} · {fmt(c.when)} · {c.minutes} min <ArrowRight className="inline h-4 w-4 text-indigo-300" /></Link>
                  )}
                  {c.joinable && <JoinCall callId={c.id} />}
                  {restricted && <CancelMenu needsReason={c.needsReason} busy={busy} other={c.who} onCancel={(reason) => void press(`/api/tests/${c.testId}/cancel-call`, { callId: c.id, reason }, c.id).then((r) => r && window.location.reload())} />}
                </div>
                {at === c.id && <ChangesBox changes={changes} error={error} />}
              </li>
            ))}
          </LongList>
        </div>
      )}
    </section>
  );
}
