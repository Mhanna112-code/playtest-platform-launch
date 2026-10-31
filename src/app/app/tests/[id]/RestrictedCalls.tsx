"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { CancelMenu } from "@/components/CancelMenu";
import { usePress } from "@/lib/usePress";

export type RestrictedCall = { id: string; who: string; when: string; minutes: number; needsReason: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * (Owner, Oct 30, batch 15 sections 29 and 37) The restricted / paused view's compact "Booked calls": time, tester and length, with Cancel on each (a reason within
 * 24 hours, as everywhere). Cancel keeps its normal stop-once; after it the page stays on this view.
 */
export function RestrictedCalls({ testId, seenAt, calls }: { testId: string; seenAt: string; calls: RestrictedCall[] }) {
  const { press, changes, error, busy, at, finish } = usePress(seenAt);
  return (
    <section className="card space-y-2" id="calls" data-restricted-calls="">
      <h2 className="font-semibold text-white">Booked calls</h2>
      {!calls.length && <p className="note">No calls are booked.</p>}
      <ul className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
        {calls.map((c) => (
          <li key={c.id} id={`call-${c.id}`} className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-slate-200">{fmt(c.when)} · {c.who} · {c.minutes} min</span>
            <CancelMenu needsReason={c.needsReason} busy={busy} other={c.who} onCancel={async (why) => { if (await press(`/api/tests/${testId}/cancel-call`, { callId: c.id, reason: why }, c.id)) finish(); }} />
            {at === c.id && <div className="basis-full"><ChangesBox changes={changes} error={error} press="Cancel call" /></div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
