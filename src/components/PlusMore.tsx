"use client";
import { useState, type ReactNode } from "react";

/**
 * (Owner, Oct 27) A short list inside a row (the unmet needs on an invite row, a tester's devices and languages): 3 items, then "+N more" which opens the rest in place.
 */
export function PlusMore({ items, shown = 3, sep = ", ", className }: { items: ReactNode[]; shown?: number; sep?: string; className?: string }) {
  const [all, setAll] = useState(false);
  const list = all ? items : items.slice(0, shown);
  return (
    <span className={className} data-plus-more={items.length > shown ? (all ? "open" : "closed") : undefined}>
      {list.map((x, i) => <span key={i}>{i > 0 && sep}{x}</span>)}
      {items.length > shown && (
        <button type="button" className="btn-ghost ml-1 !px-1.5 !py-0 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "fewer" : `+${items.length - shown} more`}</button>
      )}
    </span>
  );
}
