"use client";
import { ClampText } from "./ClampText";
import { QuestionBox } from "./QuestionBox";

/**
 * (Owner, Oct 30, batch 15 section 3) Questions in a list (the offer box, "Questions then and now", Contract changes, "Your agreed scope"): each cut to 3 lines
 * with "Show more". (Owner, Oct 28, batch 20 section 1) More than 3: every question inside a scroll box about 3 questions tall (no "+N more"); 3 or fewer show
 * without a box.
 */
export function QuestionList({ items, empty = "none" }: { items: string[]; empty?: string }) {
  if (!items.length) return <span>{empty}</span>;
  return (
    <QuestionBox count={items.length} as="span" className="space-y-1">
      {items.map((q, i) => <span key={i} className="block" data-question=""><ClampText text={`“${q}”`} /></span>)}
    </QuestionBox>
  );
}
