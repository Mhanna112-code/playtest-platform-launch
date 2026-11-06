"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { nameMatches } from "@/lib/nameSearch";

/**
 * (Owner, Nov 5, §274) "Search testers": a name box at the top of Needs you (filters the people) and right below the Testers list's avatars (filters the tester
 * rows). As you type, any case, with the invite search's name match (nameMatches); on this page only, never sent to the server. Shown only with more than one
 * person; nothing matching says "No testers match “x”.".
 */
export const SEARCH_TESTERS = "Search testers";
export const noTestersMatch = (typed: string) => `No testers match “${typed.trim()}”.`;
/** Whether a person with this name shows for what's typed (an empty box shows everyone). */
export const nameShown = (name: string, typed: string) => !typed.trim() || nameMatches(name, typed);

export function SearchTestersBox({ value, onChange, where }: { value: string; onChange: (v: string) => void; /** data-tester-search's value */ where: string }) {
  return (
    <label className="relative block max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
      <input type="search" className="input pl-9" placeholder={SEARCH_TESTERS} aria-label={SEARCH_TESTERS} data-tester-search={where} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Hides the elements under `root` matching `selector` whose name (the `nameKey` data attribute) doesn't match; returns how many still show. */
export function hideUnmatched(root: HTMLElement | null, selector: string, nameKey: string, typed: string, alsoShown: (el: HTMLElement) => boolean = () => true) {
  let left = 0;
  root?.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.hidden = !nameShown(el.dataset[nameKey] ?? "", typed) || !alsoShown(el);
    if (!el.hidden) left++;
  });
  return left;
}

// The Testers list's box sits in the card's header (below the avatars), the rows further down (RowsBox): the typed name passes between them like the avatar filter.
const SEARCH_EVENT = "tester-search";
let typedNow = "";
function setTyped(v: string) {
  typedNow = v;
  window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: v }));
}
/** What's typed in the Testers list's search box ("" while it's empty or hidden). */
export function useTesterSearch() {
  const [typed, set] = useState(typedNow);
  useEffect(() => {
    set(typedNow);
    const on = (e: Event) => set(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(SEARCH_EVENT, on);
    return () => window.removeEventListener(SEARCH_EVENT, on);
  }, []);
  return typed;
}

/** The Testers list's search box, right below the avatars. Gone (and its name cleared) when only one tester is left. */
export function TesterListSearch() {
  const typed = useTesterSearch();
  useEffect(() => () => setTyped(""), []);
  return <div data-tester-list-search=""><SearchTestersBox value={typed} onChange={setTyped} where="testers" /></div>;
}
