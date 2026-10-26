"use client";
import { KeyRound } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { LongList } from "@/components/LongList";
import { usePress } from "@/lib/usePress";

export type BrokenRow = { contractId: string; name: string; at: string };

/**
 * (Design doc 6, owner Oct 26) The yellow box under the live updates box: "N testers reported keys not working", the 3 most
 * recent named, then a dropdown with all of them. It never stops a press. Each row has "Assign a free key" (by hand: it gives that
 * tester the next free key; the tester is told on their session page).
 */
export function KeysNotice({ testId, seenAt, rows }: { testId: string; seenAt: string; rows: BrokenRow[] }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  if (!rows.length) return null;
  const recent = [...rows].sort((a, b) => (a.at < b.at ? 1 : -1));
  const names = recent.slice(0, 3).map((r) => r.name);
  return (
    <section id="keys-notice" className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status" aria-label="Access keys not working">
      <p className="flex flex-wrap items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> {rows.length} tester{rows.length === 1 ? "" : "s"} reported key{rows.length === 1 ? "" : "s"} not working
        <span className="font-normal text-amber-100/80">· {names.join(", ")}{rows.length > 3 ? ` and ${rows.length - 3} more` : ""}</span></p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-amber-200">{rows.length === 1 ? "See who" : `See all ${rows.length}`}</summary>
        <div className="mt-2">
          <LongList shown={rows.length} tall="max-h-52" className="space-y-2">
            {recent.map((r) => (
              <li key={r.contractId} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.name}</span>
                  <button className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => void press(`/api/tests/${testId}/assign-key`, { contractId: r.contractId }, r.contractId).then((x) => x && window.location.reload())}>Assign a free key</button>
                </div>
                {at === r.contractId && <ChangesBox changes={changes} error={error} />}
              </li>
            ))}
          </LongList>
        </div>
      </details>
    </section>
  );
}
