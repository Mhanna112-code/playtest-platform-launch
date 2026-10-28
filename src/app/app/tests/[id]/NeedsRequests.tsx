"use client";
import { jumpTo } from "@/lib/markJump";
import type { RowJson } from "@/lib/callRows";
import { describeRows } from "@/components/RequestRows";

export type NeedsRequest = { id: string; contractId: string; name: string; rows: RowJson[]; minutes: number; rate: string; warning?: string };

/**
 * Call requests waiting for the developer's answer (in "Needs you"). (Owner, Oct 28, batch 16 section 35) No Accept / Decline here any more: the whole row, and
 * its "Answer in Live session →" link, open the Live session's Call requests panel at that request (highlighted for a few seconds), where Accept / Decline follow
 * every rule of that panel. The row leaves Needs you once the request is answered, withdrawn or closed (the page follows live).
 */
export function NeedsRequests({ requests }: { testId?: string; seenAt?: string; requests: NeedsRequest[] }) {
  if (!requests.length) return null;
  const open = (id: string) => jumpTo(`req-${id}`);
  return (
    <ul className="space-y-2 text-sm">
      {requests.map((r) => (
        <li key={r.id} id={`needs-req-${r.id}`} className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-white/10 p-3 hover:border-white/20" data-needs-request="" onClick={() => open(r.id)}>
          <span className="mr-auto text-slate-300"><b className="text-white">{r.name}</b> asked for a live call: {describeRows(r.rows)} · {r.minutes} min · {r.rate}</span>
          <a href={`#req-${r.id}`} className="text-sm" data-answer-live="" onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(r.id); }}>Answer in Live session →</a>
          {/* (Batch 15 section 34) What's left of the $1,000 for this tester's calls, when it's under an hour. */}
          {r.warning && <span className="basis-full text-xs text-amber-200" data-calls-warning="">{r.warning}</span>}
        </li>
      ))}
    </ul>
  );
}
