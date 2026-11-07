"use client";
import { useEffect, useState } from "react";

/**
 * (Owner, Nov 3, batch 35 §140) The circles at the top of the tester list filter it: pressing one shows only that tester's row (the circle is marked); pressing it
 * again, or "All testers", shows everyone. Buttons with aria-pressed, so the keyboard works. The choice is kept while the page redraws.
 * (Owner, Nov 6, §283) Choosing a circle clears the "Search testers" box under them, and typing there clears the choice (TesterListSearch listens for
 * FILTER_EVENT): one way of narrowing the list at a time.
 */
export const FILTER_EVENT = "tester-filter";
const KEY = "tester-filter";

function read(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function choose(id: string) {
  try {
    if (id) window.sessionStorage.setItem(KEY, id);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the filter still works until the page reloads
  }
  window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: id }));
}
/** (Owner, Nov 6, §283) Typing in "Search testers" clears the circles' choice (the two never narrow the list together). */
export const clearTesterFilter = () => { if (read()) choose(""); };
/** A departed/deleted tester must not leave the list stuck on a stale circle selection. */
export function resetInactiveTesterFilter(activeIds: string[], chosen = "") {
  const current = chosen || read();
  if (current && !activeIds.includes(current)) { choose(""); return ""; }
  return current;
}
/** The tester shown alone (""; everyone). */
export function useTesterFilter() {
  const [id, setId] = useState("");
  useEffect(() => {
    setId(read());
    const on = (e: Event) => setId(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(FILTER_EVENT, on);
    return () => window.removeEventListener(FILTER_EVENT, on);
  }, []);
  return id;
}
/** Which rows show for a choice: every row, or only that tester's. */
export const rowShown = (rowTesterId: string, chosen: string) => !chosen || rowTesterId === chosen;

export function AvatarButton({ testerId, name, obj = "them" }: { testerId: string; name: string; /** (batch 35 §162) the tester's object pronoun */ obj?: string }) {
  const chosen = useTesterFilter();
  const on = chosen === testerId;
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `${name}: showing only ${obj} (press to show everyone)` : `Show only ${name}`} data-avatar-filter={testerId}
      onClick={() => choose(on ? "" : testerId)}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950 ring-2 focus:outline-none focus-visible:ring-sky-300 ${on ? "ring-sky-300 ring-offset-2 ring-offset-slate-950" : "ring-slate-950 hover:ring-sky-300"}`}>
      {name.trim().charAt(0).toUpperCase()}
    </button>
  );
}

export function AllTesters() {
  const chosen = useTesterFilter();
  if (!chosen) return null;
  return <button type="button" className="btn-ghost px-2 py-0.5 text-xs" data-filter-all="" onClick={() => choose("")}>All testers</button>;
}
