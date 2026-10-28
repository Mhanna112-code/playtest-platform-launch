"use client";
import Link from "next/link";
import { useState } from "react";
import { ScrollList } from "@/components/ScrollList";
import { fmtDate } from "@/lib/format";
import { filterTesterTests, noTestsWithLine, type TesterTestRow } from "@/lib/testerTests";

/**
 * (Owner, Oct 28, batch 16 section 15, clarified) "Your tests with <name>" on a tester's profile, for the developer viewing it: every one of their own tests the
 * tester joined, most recent first, in the plain scroll box (section 14), with the Open and Closed ticks above it (both ticked, or both unticked: all). The
 * ticks wrap above the box on phones.
 */
export function TesterTests({ name, rows }: { name: string; rows: TesterTestRow[] }) {
  const [open, setOpen] = useState(true);
  const [closed, setClosed] = useState(true);
  const shown = filterTesterTests(rows, open, closed);
  return (
    <section className="card space-y-3" data-tester-tests="">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="font-semibold text-white">Your tests with {name}</h2>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
            <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} data-tests-filter="open" /> Open</label>
            <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} data-tests-filter="closed" /> Closed</label>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400" data-tester-tests-none="">{noTestsWithLine(name)}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-400">{open ? "No open tests." : "No closed tests."}</p>
      ) : (
        <ScrollList className="space-y-2" label={`Your tests with ${name}`}>
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 p-3 text-sm" data-tester-test={r.open ? "open" : "closed"}>
              <span className="min-w-[12rem] flex-1">
                <Link href={r.href} className="block truncate font-medium text-white" title={r.title}>{r.title}</Link>
                <span className="block text-slate-400">Joined {fmtDate(new Date(r.joinedAt))}</span>
              </span>
              <span className="badge">{r.state}</span>
            </li>
          ))}
        </ScrollList>
      )}
    </section>
  );
}
