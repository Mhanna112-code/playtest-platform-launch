"use client";
import { useRef, useState, type ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";
import { LIST_PANEL } from "@/components/ScrollList";
import { FIND_SEARCH_MAX } from "@/lib/findSearch";

/** (§152) Whether a question matches what was typed: anywhere in its text, any case ("STUCK" finds "Where did you get stuck?"); an empty search shows all. */
export const questionMatches = (title: string, query: string) => !query.trim() || title.toLowerCase().includes(query.trim().toLowerCase());
/** (§152) The line when nothing matches. */
export const noQuestionsLine = (query: string) => `No questions match “${query.trim()}”.`;

/**
 * (Owner, Nov 3, batch 35 §152) "By question"'s list: a "Search questions" box above it (filters as you type, "Anything else" included; §188, was "Other notes"), Open all / Close all, and the
 * questions in the draggable panel (`by-question-<testId>`), each its own fold (rendered on the server and passed in as `node`).
 */
export function QuestionSearch({ testId, items }: { testId: string; items: { key: string; title: string; node: ReactNode }[] }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => questionMatches(i.title, query));
  // Open all / Close all: each fold's own toggle keeps the new state (Fold's onToggle), so it stays through the live redraws.
  const all = (open: boolean) => list.current?.querySelectorAll<HTMLDetailsElement>("details[data-fold]").forEach((d) => { d.open = open; });
  return (
    <div className="space-y-2" data-by-question-list="">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" className="input min-w-[14rem] flex-1" placeholder="Search questions" aria-label="Search questions" maxLength={FIND_SEARCH_MAX} value={query} onChange={(e) => setQuery(e.target.value)} data-question-search="" />
        <button type="button" className="btn-ghost text-xs" onClick={() => all(true)}>Open all</button>
        <button type="button" className="btn-ghost text-xs" onClick={() => all(false)}>Close all</button>
      </div>
      {shown.length === 0 && <p className="note" data-no-question-match="">{noQuestionsLine(query)}</p>}
      <div ref={list} hidden={shown.length === 0}>
        <ResizeBox id={`by-question-${testId}`} label="Questions" defaultMax={LIST_PANEL.questions}>
          {items.map((i) => <div key={i.key} hidden={!shown.includes(i)} data-question-item={i.title}>{i.node}</div>)}
        </ResizeBox>
      </div>
    </div>
  );
}
