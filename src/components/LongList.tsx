"use client";
import { Children, useState, type ReactNode } from "react";

/**
 * (Design doc 2) The long-list rule: the newest `shown` lines (3), then "Show N more" opening a scroll box about 8 lines
 * tall. Used by the live box, the stop boxes, the yellow keys notice, Needs you and Invited.
 * (Owner, Dec 10 2026) Folded, it showed the FIRST `shown` items: right for a list fed newest first (the live box, LiveNotices, the bell, Payments, Invited),
 * wrong for one fed oldest first (a stop box's change lines, the join pop-up's stop). `newest="last"`: the list is oldest first, so folded it shows the LAST
 * `shown` items, in the same order; opened, all of them.
 */
export function LongList({ children, shown = 3, className = "space-y-0.5", tall = "max-h-52", as: Tag = "ul", newest = "first" }: { children: ReactNode; shown?: number; className?: string; tall?: string; as?: "ul" | "div"; /** where the newest items are */ newest?: "first" | "last" }) {
  const items = Children.toArray(children);
  const [all, setAll] = useState(false);
  if (items.length <= shown) return <Tag className={className}>{items}</Tag>;
  return (
    <>
      <Tag className={`${className} ${all ? `${tall} overflow-y-auto pr-1` : ""}`} data-long-list={all ? "open" : "closed"}>{all ? items : newest === "last" ? items.slice(-shown) : items.slice(0, shown)}</Tag>
      <button type="button" className="btn-ghost mt-1 !px-2 !py-0.5 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? "Show fewer" : `Show ${items.length - shown} more`}
      </button>
    </>
  );
}
