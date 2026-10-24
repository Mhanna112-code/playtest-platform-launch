"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";
import type { RowJson } from "@/lib/callRows";
import { acceptChoices, describeRows } from "@/components/RequestRows";

export type NeedsRequest = { id: string; contractId: string; name: string; rows: RowJson[]; minutes: number; rate: string };

/** Call requests waiting for the developer's answer (in "Needs you"): Accept (one button per time when there is a choice) / Decline. */
export function NeedsRequests({ testId, seenAt, requests }: { testId: string; seenAt: string; requests: NeedsRequest[] }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  if (!requests.length) return null;
  const go = async (r: NeedsRequest, body: Record<string, unknown>, key: string) => {
    const x = await press(`/api/tests/${testId}/answer-request`, { requestId: r.id, contractId: r.contractId, ...body }, key);
    if (x) window.location.reload();
  };
  return (
    <ul className="space-y-2 text-sm">
      {requests.map((r) => (
        <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-3 ${MARKABLE}`}>
          <span className="mr-auto text-slate-300"><b className="text-white">{r.name}</b> asked for a live call: {describeRows(r.rows)} · {r.minutes} min · {r.rate}</span>
          {acceptChoices(r.rows).map((x) => (
            <button key={x.label} className="btn" disabled={busy} onClick={() => go(r, { action: "accept", ...(x.time ? { time: x.time } : {}) }, "a-" + r.id)}>{x.label}</button>
          ))}
          <button className="btn-ghost" disabled={busy} onClick={() => go(r, { action: "decline" }, "d-" + r.id)}>Decline</button>
          {(at === "a-" + r.id || at === "d-" + r.id) && <div className="basis-full"><ChangesBox changes={changes} error={error} link={undefined} /></div>}
        </li>
      ))}
    </ul>
  );
}
