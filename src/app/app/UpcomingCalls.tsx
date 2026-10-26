"use client";
import { CalendarClock } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { CancelMenu } from "@/components/CancelMenu";
import { LongList } from "@/components/LongList";
import { usePress } from "@/lib/usePress";

export type UpcomingCall = { id: string; testId: string; test: string; who: string; when: string; minutes: number; needsReason: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * (Design doc 3) The developer dashboard's "Upcoming calls" (the next 7 days) with Cancel, usable during a suspension. The press
 * follows the stop-once and refusal rules: its box shows right under the row.
 */
export function UpcomingCalls({ calls, seenAt }: { calls: UpcomingCall[]; seenAt: string }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  return (
    <section className="space-y-3" aria-label="Upcoming calls" id="upcoming-calls">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="h-5 w-5 text-amber-300" /> Upcoming calls <span className="text-sm font-normal text-slate-400">next 7 days</span></h2>
      {calls.length === 0 ? <p className="card text-sm text-slate-400">No calls in the next 7 days.</p> : (
        <div className="card p-3">
          <LongList shown={4} tall="max-h-72" className="divide-y divide-white/5">
            {calls.map((c) => (
              <li key={c.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto text-slate-200"><b className="text-white">{c.who}</b> · {c.test} · {fmt(c.when)} · {c.minutes} min</span>
                  <CancelMenu needsReason={c.needsReason} busy={busy} other={c.who} onCancel={(reason) => void press(`/api/tests/${c.testId}/cancel-call`, { callId: c.id, reason }, c.id).then((r) => r && window.location.reload())} />
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
