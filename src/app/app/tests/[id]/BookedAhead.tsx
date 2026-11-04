"use client";
import { CalendarPlus } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { CancelMenu } from "@/components/CancelMenu";
import { JoinCall } from "@/components/JoinCall";
import { ReportProblem } from "@/components/ReportProblem";
import { usePress } from "@/lib/usePress";
import type { DevCall } from "./DevCallPanel";

/** One call still ahead (or running), with its time already in the reader's time zone. */
export type AheadCall = DevCall & { whenText: string };

/**
 * (Owner, Nov 4, §186) The calls still ahead (or in progress) with one tester, at the top of their row's "Booked (N)", soonest first: the time, the length and the
 * rate, with the Live session row's own buttons and rules (Join call while it can be joined, Add to calendar, Cancel with a reason within 24 hours, Report a
 * problem once it started), the same presses and the same stop-once. The Live session keeps its rows (a link to `#call-<id>` still lands there, with the
 * call's timer); these rows are `booked-call-<id>`.
 */
export function BookedAhead({ testId, seenAt, name, calls, buttons = true }: { testId: string; seenAt: string; name: string; calls: AheadCall[];
  /** false once the tester's work ended: the Live session lists working testers only, so no buttons here either */ buttons?: boolean }) {
  const { press, changes, error, busy, at, finish } = usePress(seenAt);
  const box = (k: string) => (at === k ? <div className="basis-full"><ChangesBox changes={changes} error={error} press="Cancel call" /></div> : null);
  if (!calls.length) return null;
  return (
    <ul className="space-y-2" data-calls-ahead={calls.length}>
      {calls.map((c) => (
        <li key={c.id} id={`booked-call-${c.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 p-2 scroll-mt-24 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-booked-call={c.id} data-call-ahead="">
          <span className="mr-auto text-slate-200">
            {c.whenText} · {c.minutes} min · {c.rate}
            {c.late && <span className="ml-2 badge">{c.late}</span>}
            {c.measuring && <span className="ml-2 badge border-sky-300/40 text-sky-200" data-measuring="">{c.measuring}</span>}
            {!c.started && !c.measuring && <span className="ml-2 badge" data-call-badge="">Upcoming</span>}
          </span>
          {buttons && <span className="flex max-w-full flex-wrap items-center gap-2" data-call-buttons="">
            {c.joinable && <JoinCall callId={c.id} />}
            {!c.started && <a href={`/api/calls/${c.id}/ics`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline"><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>}
            {!c.started && <CancelMenu needsReason={!c.canCancel} busy={busy} other={name} onCancel={async (why) => { if (await press(`/api/tests/${testId}/cancel-call`, { callId: c.id, reason: why }, "cancel-" + c.id)) finish(); }} />}
            {c.started && <ReportProblem path={`/api/tests/${testId}/no-show`} callId={c.id} otherName={name} seenAt={seenAt} reported={c.report ?? null} />}
          </span>}
          {box("cancel-" + c.id)}
        </li>
      ))}
    </ul>
  );
}
