"use client";
import { useState } from "react";
import { ClampText } from "./ClampText";

/**
 * (Owner, Oct 30, batch 15 section 3) Questions in a list (the offer box, "Questions then and now", cards): each cut to 3 lines with "Show more", and the list shows 3
 * then "+N more".
 */
export function QuestionList({ items, shown = 3, empty = "none" }: { items: string[]; shown?: number; empty?: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <span>{empty}</span>;
  const list = all ? items : items.slice(0, shown);
  return (
    <span className="block space-y-1" data-question-list={items.length > shown ? (all ? "open" : "closed") : undefined}>
      {list.map((q, i) => <ClampText key={i} text={`“${q}”`} />)}
      {items.length > shown && (
        <button type="button" className="btn-ghost !px-1.5 !py-0 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "fewer" : `+${items.length - shown} more`}</button>
      )}
    </span>
  );
}
