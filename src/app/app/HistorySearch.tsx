"use client";
import { useRef, useState } from "react";

/**
 * (Owner, Oct 31, batch 35 §81) The search box over the tester's History: hides every row whose test name or developer doesn't contain what's typed
 * (the rows are drawn on the server, each with its own `data-hist-search` text).
 */
export function HistorySearch() {
  const box = useRef<HTMLDivElement>(null);
  const [none, setNone] = useState(false);
  function filter(q: string) {
    const list = box.current?.parentElement?.querySelectorAll<HTMLElement>("[data-hist-search]") ?? [];
    const words = q.trim().toLowerCase();
    let shown = 0;
    list.forEach((li) => {
      const hit = !words || (li.dataset.histSearch ?? "").includes(words);
      li.hidden = !hit;
      if (hit) shown++;
    });
    setNone(list.length > 0 && shown === 0);
  }
  return (
    <div ref={box} className="space-y-1">
      <input type="search" className="input w-full sm:w-80" placeholder="Search by test or developer" aria-label="Search your tests" onChange={(e) => filter(e.target.value)} data-hist-search-box="" />
      {none && <p className="text-sm text-slate-400" data-hist-none="">No test matches.</p>}
    </div>
  );
}
