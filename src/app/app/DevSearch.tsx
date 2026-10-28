"use client";
import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { ScrollList } from "@/components/ScrollList";
import { fmtDate } from "@/lib/format";
import { noDevMatchLine, searchByDeveloper, type DevSearchRow } from "@/lib/devSearch";

/**
 * (Owner, Oct 28, batch 16 section 13) "Search by developer" at the top of the tester dashboard's tests. Typing narrows to every test the tester has
 * been in (any status: `rows` holds all of them, not just what the sections below show) whose developer's name contains the text, most recent first,
 * in the dashboards' plain scroll box (section 14). Clearing the box brings the normal dashboard back. Full width on phones.
 */
export function DevSearch({ rows, children }: { rows: DevSearchRow[]; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const typed = q.trim();
  const found = searchByDeveloper(rows, q);
  return (
    <>
      <section className="space-y-3" id="dev-search" data-dev-search="">
        <div className="flex w-full items-center gap-2 sm:max-w-sm">
          <label htmlFor="devSearch" className="sr-only">Search by developer</label>
          <span className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <input id="devSearch" type="search" className="input w-full pl-9" placeholder="Search by developer" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </span>
        </div>
        {typed && (found.length === 0 ? (
          <p className="card text-sm text-slate-400" data-dev-search-none="">{noDevMatchLine(q)}</p>
        ) : (
          <ScrollList className="space-y-2" label="Tests found">
            {found.map((r) => {
              const inner = (
                <>
                  <span className="min-w-[12rem] flex-1">
                    <span className="block truncate font-medium text-white" title={r.title}>{r.title}</span>
                    <span className="block text-sm text-slate-400">{r.developer} · joined {fmtDate(new Date(r.joinedAt))}</span>
                  </span>
                  <span className="badge">{r.status}</span>
                </>
              );
              return (
                <li key={r.id} data-dev-search-row={r.id}>
                  {r.href ? <Link href={r.href} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">{inner}</Link> : <div className="card flex flex-wrap items-center gap-3 p-4">{inner}</div>}
                </li>
              );
            })}
          </ScrollList>
        ))}
      </section>
      {!typed && children}
    </>
  );
}
