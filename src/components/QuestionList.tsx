"use client";
import { ClampText } from "./ClampText";
import { QuestionBox } from "./QuestionBox";

/**
 * (Owner, Oct 30, batch 15 section 3) Questions in a list (the offer box, "Questions then and now", Contract changes, "Your agreed scope"): each cut to 3 lines
 * with "Show more". (Owner, Oct 28, batch 20 section 1) More than 3: every question inside a scroll box about 3 questions tall (no "+N more"); 3 or fewer show
 * without a box.
 * (Owner, Oct 31, batch 35 §15) `numbered` (the Listing panel): a numbered list, each question quoted in bright text with its "Required" as a small tag after
 * the quote (never inside it), so the questions read apart from the panel's labels.
 */
export function QuestionList({ items, empty = "none", numbered = false }: { items: (string | { text: string; required?: boolean })[]; empty?: string; numbered?: boolean }) {
  if (!items.length) return <span>{empty}</span>;
  const all = items.map((q) => (typeof q === "string" ? { text: q, required: false } : q));
  if (numbered)
    return (
      <QuestionBox count={all.length} as="ol" className="space-y-1">
        {all.map((q, i) => (
          <li key={i} className="flex gap-2" data-question="">
            <span className="w-5 shrink-0 text-right tabular-nums text-slate-500">{i + 1}.</span>
            <span className="min-w-0 flex-1"><ClampText text={`“${q.text}”`} /></span>
            {q.required && <span className="mt-0.5 h-fit shrink-0 rounded border border-amber-300/40 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-200" data-question-required="">Required</span>}
          </li>
        ))}
      </QuestionBox>
    );
  return (
    <QuestionBox count={all.length} as="span" className="space-y-1">
      {all.map((q, i) => <span key={i} className="block" data-question=""><ClampText text={`“${q.text}”`} /></span>)}
    </QuestionBox>
  );
}
