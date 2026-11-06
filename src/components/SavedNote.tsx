"use client";
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** (Owner, Nov 5, §275) How long the Save's note stays before it fades. */
export const SAVED_NOTE_MS = 8_000;

/**
 * (Owner bug fix) A Save result that arrives in the address (?saved=1&...) is shown ONCE and then taken out of the address,
 * so a later reload or refresh (after a call request, Pay, Invite, End early ...) never replays it. (Owner, Nov 5, §275) It no longer stays until the page is
 * left: it fades after SAVED_NOTE_MS, or closes with its ×; a live redraw of the page never brings it back.
 */
export function SavedNote({ children }: { children: ReactNode }) {
  const [kept] = useState(children);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of ["saved", "offered", "skipped", "closed", "resent", "spotclosed", "spots"]) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
    const t = setTimeout(() => setShown(false), SAVED_NOTE_MS);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="flex items-start gap-2" data-saved-note="">
      <div className="min-w-0 flex-1">{kept}</div>
      <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-label="Close" data-saved-close="" onClick={() => setShown(false)}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
