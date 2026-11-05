"use client";
import { useState, type ReactNode } from "react";
import { ScrollList } from "@/components/ScrollList";
import { FIND_SEARCH_MAX } from "@/lib/findSearch";
import { YOUR_TESTS_SEARCH_LABEL, noYourTestsLine, yourTestMatches } from "@/lib/yourTestsSearch";

/**
 * (Owner, Nov 5, §204) "Your tests" with a search box above the cards: as you type, only the tests whose name or product name contains it (any case). Every
 * card is on the page (drawn on the server, passed in as `node`), so the search covers them all; the scroll box (batch 16 section 14) is unchanged. What was
 * typed is this box's own state, so it stays through the dashboard's live redraws (a redraw brings new cards, filtered the same way).
 */
export function YourTestsSearch({ items }: { items: { key: string; title: string; product: string | null; node: ReactNode }[] }) {
  const [query, setQuery] = useState("");
  const shown = items.filter((i) => yourTestMatches(i, query));
  return (
    <div className="space-y-2" data-your-tests="">
      <input type="search" className="input w-full max-w-xs" placeholder={YOUR_TESTS_SEARCH_LABEL} aria-label="Search your tests by test or product name" maxLength={FIND_SEARCH_MAX}
        value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" data-your-tests-search="" />
      {shown.length === 0 && query.trim() !== "" && <p className="note" data-your-tests-none="">{noYourTestsLine(query)}</p>}
      {shown.length > 0 && (
        // (Batch 16 section 14) Every test card, in a scroll box about 2 card rows tall (one column of about 3 on phones).
        <ScrollList size="cards" className="grid gap-4 md:grid-cols-2">
          {shown.map((i) => <li key={i.key}>{i.node}</li>)}
        </ScrollList>
      )}
    </div>
  );
}
