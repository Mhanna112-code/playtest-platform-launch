"use client";
import type { ReactNode } from "react";

/**
 * (Design doc 3 and 6) "Needs you": a fold (like every panel on the page); with more than 3 items it becomes a scroll box. Each
 * person's sent parts sit in a drop-down of their own inside it.
 */
export function NeedsYou({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details id="needs-you" open className="card scroll-mt-24 border-amber-300/30" aria-label="Needs you">
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white">
        <span className="h-2 w-2 rounded-full bg-amber-400" /> <h2 className="inline">Needs you</h2> <span className="text-sm font-normal text-slate-400">{count}</span>
      </summary>
      <div className={`mt-4 space-y-4 ${count > 3 ? "max-h-[30rem] overflow-y-auto pr-1" : ""}`} data-needs-list={count > 3 ? "scroll" : "plain"}>{children}</div>
    </details>
  );
}
