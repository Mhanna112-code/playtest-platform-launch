import Link from "next/link";
import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { fmtDate } from "@/lib/format";

// The full app's "Testers joined" card (dev test page, right after the header): the Seats avatar row (one circle per
// spot; each tester's circle has a hover / tap card with their profile summary, a link to the profile and Block at its
// bottom), "N spots still open" / "All spots are filled", "N of M spots taken · Change in Edit", and "No longer
// working (N)".

export type Seat = { testerId: string; name: string; summary: string[]; block: ReactNode };
export type Gone = { contractId: string; name: string; how: string; at: Date | null };

function TesterAvatar({ seat }: { seat: Seat }) {
  return (
    <span className="group relative inline-block">
      <Link href={`/app/testers/${seat.testerId}`} aria-label={`${seat.name}: profile`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950 no-underline ring-2 ring-slate-950 hover:no-underline hover:ring-sky-300 focus:outline-none focus-visible:ring-sky-300">
        {seat.name.trim().charAt(0).toUpperCase()}
      </Link>
      <span role="tooltip"
        className="invisible absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-slate-900 p-4 text-sm opacity-0 shadow-2xl transition before:absolute before:inset-x-0 before:-top-2 before:h-2 before:content-[''] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <span className="block font-semibold text-white">{seat.name}</span>
        {seat.summary.map((l) => <span key={l} className="block text-slate-300">{l}</span>)}
        <Link href={`/app/testers/${seat.testerId}`} className="mt-1 block text-sky-300 hover:underline">See their profile</Link>
        {seat.block && <span className="mt-3 block border-t border-white/10 pt-2">{seat.block}</span>}
      </span>
    </span>
  );
}

export function TestersJoined({ testId, spots, seats, gone, status, children }: { testId: string; spots: number; seats: Seat[]; gone: Gone[]; status: string; children?: ReactNode }) {
  const joined = seats.length;
  const shown = Math.min(spots, 12);
  const stopped = status === "stopped";
  return (
    <details open className="card space-y-3" id="testers-joined" aria-label="Testers joined">
      <summary className="fold-chevron flex cursor-pointer items-center justify-between">
        <span className="flex items-center gap-2 font-semibold text-white"><Users className="h-5 w-5 text-indigo-300" /> <h2 className="inline">Testers</h2></span>
        <span className="text-sm text-slate-400">{joined} of {spots}</span>
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: shown }, (_, i) => (seats[i] ? <TesterAvatar key={seats[i].testerId} seat={seats[i]} /> : <span key={i} className="h-9 w-9 rounded-full border-2 border-dashed border-slate-600" />))}
        {spots > shown && <span className="text-sm text-slate-400">+{spots - shown} more</span>}
      </div>
      {children}
      {gone.length > 0 && (
        <details className="text-sm text-slate-400">
          <summary className="cursor-pointer">No longer working ({gone.length})</summary>
          <ul className="mt-1.5 space-y-0.5 pl-4">
            {gone.map((g) => (
              <li key={g.contractId}><a href={`#tester-${g.contractId}`} className="text-sky-300 hover:underline">{g.name}</a> <span className="badge ml-1" data-gone-tag={g.how}>{g.how}</span>{g.at && <> · {fmtDate(g.at)}</>}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {stopped ? "The test was stopped." : status !== "open" ? "Not taking testers." : joined === 0 ? "Waiting for the first tester to join." : joined >= spots ? "All spots are filled." : `${spots - joined} spot${spots - joined === 1 ? "" : "s"} still open.`}
        </p>
        <p className="text-sm text-slate-400">
          {joined} of {spots} {spots === 1 ? "spot" : "spots"} taken
          {!stopped && <> · <Link href={`/app/tests/${testId}/edit#spots`} className="text-sky-300 hover:underline">Change in Edit</Link></>}
        </p>
      </div>
    </details>
  );
}
