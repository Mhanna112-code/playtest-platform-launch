"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";
import { hideUnmatched, noTestersMatch, SearchTestersBox } from "./TesterSearch";

/**
 * (Design doc 3 and 6) "Needs you": a fold (like every panel on the page). Each person's sent parts sit in a drop-down of their own inside it.
 * (Owner, Nov 3) The list is a draggable panel that scrolls through the names (and each name's drop-down is its own panel holding all their parts).
 * (Owner, Nov 5, §274) A "Search testers" box at its top keeps only the people (§181's drop-downs, data-needs-who) whose name matches as you type, with the invite
 * search's name match; on the page only. Shown only with more than one person; nobody matching says "No testers match “x”.".
 */
export function NeedsYou({ count, people = 0, children }: { count: number; /** how many people's drop-downs it holds */ people?: number; children: ReactNode }) {
  const [q, setQ] = useState("");
  const searchable = people > 1;
  const typed = searchable ? q : "";
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(1);
  // After every render (a live redraw brings new rows): the same count again changes nothing, so this never loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLeft(hideUnmatched(box.current, "[data-needs-person]", "needsWho", typed));
  });
  return (
    <details id="needs-you" open className="card scroll-mt-24 border-amber-300/30" aria-label="Needs you">
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white">
        <span className="h-2 w-2 rounded-full bg-amber-400" /> <h2 className="inline">Needs you</h2> <span className="text-sm font-normal text-slate-400">{count}</span>
      </summary>
      {searchable && (
        <div className="mt-4 space-y-2" data-needs-search="">
          <SearchTestersBox value={q} onChange={setQ} where="needs" />
          {typed.trim() && left === 0 && <p className="note" data-tester-search-none="needs">{noTestersMatch(typed)}</p>}
        </div>
      )}
      <div className="mt-4" data-needs-list="scroll">
        <ResizeBox id="needs-you-list" label="Needs you" defaultMax="min(36rem, 70vh)" tallest={0.85}>
          <div ref={box} className="space-y-4">{children}</div>
        </ResizeBox>
      </div>
    </details>
  );
}
