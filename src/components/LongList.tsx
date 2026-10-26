"use client";
import { Children, useState, type ReactNode } from "react";

/**
 * (Design doc 2) The long-list rule: the newest `shown` lines (3), then "Show N more" opening a scroll box about 8 lines
 * tall. Used by the live box, the stop boxes, the yellow keys notice, Needs you and Invited.
 */
export function LongList({ children, shown = 3, className = "space-y-0.5", tall = "max-h-52", as: Tag = "ul" }: { children: ReactNode; shown?: number; className?: string; tall?: string; as?: "ul" | "div" }) {
  const items = Children.toArray(children);
  const [all, setAll] = useState(false);
  if (items.length <= shown) return <Tag className={className}>{items}</Tag>;
  return (
    <>
      <Tag className={`${className} ${all ? `${tall} overflow-y-auto pr-1` : ""}`} data-long-list={all ? "open" : "closed"}>{all ? items : items.slice(0, shown)}</Tag>
      <button type="button" className="btn-ghost mt-1 !px-2 !py-0.5 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? "Show fewer" : `Show ${items.length - shown} more`}
      </button>
    </>
  );
}
