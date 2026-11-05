"use client";
import { TestName } from "@/components/Cut";
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { Search } from "lucide-react";
import { ScrollList } from "@/components/ScrollList";
import { fmtDate } from "@/lib/format";
import { DEV_SEARCH_LABEL, devOrTestMatches, noDevMatchLine, noTodoMatchLine, searchByDeveloper, type DevSearchRow } from "@/lib/devSearch";

/**
 * (Owner, Oct 28, batch 16 section 13) "Search by developer" at the top of the tester dashboard's tests. Typing narrows to every test the tester has
 * been in (any status: `rows` holds all of them, not just what the sections below show) whose developer's name contains the text, most recent first,
 * in the dashboards' plain scroll box (section 14). Clearing the box brings the normal dashboard back. Full width on phones.
 * (Owner, Nov 5, §204) "Search by developer or test": the developer's name OR the test's name (devOrTestMatches). `todo` (the "To do" section) stays on the
 * page while the box is typed in, below the results, showing only its rows for matching tests (each row wrapped in DevSearchHit); the other sections still
 * give way to the results. What was typed stays through the page's live redraws (this box's own state).
 */
const Typed = createContext("");

export function DevSearch({ rows, todo, children }: { rows: DevSearchRow[]; /** (§204) the To do section, filtered while typed */ todo?: React.ReactNode; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const typed = q.trim();
  const found = searchByDeveloper(rows, q);
  return (
    <Typed.Provider value={typed}>
      <section className="space-y-3" id="dev-search" data-dev-search="">
        <div className="flex w-full items-center gap-2 sm:max-w-sm">
          <label htmlFor="devSearch" className="sr-only">{DEV_SEARCH_LABEL}</label>
          <span className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <input id="devSearch" type="search" className="input w-full pl-9" placeholder={DEV_SEARCH_LABEL} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
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
                    <span className="block font-medium"><TestName text={r.title} /></span>
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
      {todo}
      {!typed && children}
    </Typed.Provider>
  );
}

/** (Owner, Nov 5, §204) One To do row: shown while the box is empty or its test matches (developer's name or test name). */
export function DevSearchHit({ title, developer, children }: { title: string; developer: string; children: React.ReactNode }) {
  const typed = useContext(Typed);
  return !typed || devOrTestMatches({ title, developer }, typed) ? <>{children}</> : null;
}

/**
 * (§204) To do's list while the box is typed in: the line when none of its rows match (`rows`: each row's test and developer), with the list hidden; otherwise
 * the list (`children`).
 */
export function DevSearchList({ rows, children }: { rows: { title: string; developer: string }[]; children: React.ReactNode }) {
  const typed = useContext(Typed);
  if (typed && !rows.some((r) => devOrTestMatches(r, typed))) return <p className="card text-sm text-slate-400" data-todo-search-none="">{noTodoMatchLine(typed)}</p>;
  return <>{children}</>;
}
