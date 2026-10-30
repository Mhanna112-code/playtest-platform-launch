"use client";
import { createContext, useContext, useEffect, useState } from "react";

/** (Batch 30 §15) The "See it" of a listing line in the top box: the event LiveTop sends (with the line's time) so the page can mark what that save changed. */
export const SEE_IT_EVENT = "see-it";

/**
 * (Batch 34 §14) Where a listing line's "See it" goes on this page (e.g. "#listing" on the developer's test page), for every stop box under any of its buttons: the
 * boxes take it from here unless they're given their own `seeIt`.
 */
const SeeItContext = createContext<string | undefined>(undefined);
export function SeeItTarget({ target, children }: { target: string; children?: React.ReactNode }) {
  return <SeeItContext.Provider value={target}>{children}</SeeItContext.Provider>;
}
export const useSeeItTarget = () => useContext(SeeItContext);

/**
 * (Batch 30 §15; batch 34 §14) A "See it" press: a line inside a pop-up closes the pop-up first (its own scroll then brings the target into view); a fold opens; and
 * the page is told the line's time so it can mark what that save changed (ListingSeeIt).
 */
export function seeItClick(e: React.MouseEvent<HTMLElement>, target: string, at?: string | Date) {
  const dialog = e.currentTarget.closest("dialog");
  if (dialog) {
    e.preventDefault();
    dialog.close();
  }
  setTimeout(() => {
    const el = document.querySelector(target);
    if (el instanceof HTMLDetailsElement) el.open = true;
    if (dialog && el) el.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.dispatchEvent(new CustomEvent(SEE_IT_EVENT, { detail: { at: at ? new Date(at).toISOString() : undefined } }));
  }, 0);
}

/**
 * (Batch 30 §15) A small "Updated <date/time>" tag on a listing-information line changed since the tester joined: tapping it shows before → now in place.
 */
export function UpdatedTag({ when, before, now }: { when: string; before: string; now: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {" "}
      <button type="button" className="badge cursor-pointer border-sky-300/40 text-[11px] text-sky-200" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-info-updated="">
        {when ? `Updated ${when}` : "Updated"}
      </button>
      {open && (
        <span className="mt-1 block space-y-1 rounded-lg bg-white/[0.03] p-2 text-xs" data-info-before-now="">
          <span className="block"><b className="text-slate-400">Before:</b> <span className="block max-h-32 overflow-y-auto whitespace-pre-wrap break-words" tabIndex={0} data-diff-scroll="">{before}</span></span>
          <span className="block"><b className="text-slate-400">Now:</b> <span className="block max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-slate-200" tabIndex={0} data-diff-scroll="">{now}</span></span>
        </span>
      )}
    </>
  );
}

/**
 * (Batch 30 §15) The top box's "Updated · 7:21 PM: … · See it" on the session page: opens the contract box ("Your agreed scope"), brings it into view and marks
 * the listing lines that save changed (those last updated at or after the line's time) for a few seconds. With none matching, every updated line is marked.
 */
export function ListingSeeIt({ box }: { box: string }) {
  useEffect(() => {
    const on = (e: Event) => {
      const at = new Date((e as CustomEvent<{ at?: string }>).detail?.at ?? "").getTime();
      const el = document.getElementById(box);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      const lines = [...el.querySelectorAll<HTMLElement>("[data-info-line][data-updated-at]")];
      let marked = isNaN(at) ? [] : lines.filter((l) => new Date(l.dataset.updatedAt ?? "").getTime() >= at - 10_000);
      if (!marked.length) marked = lines;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      (marked[0] ?? el).scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      marked.forEach((l) => l.setAttribute("data-marked", ""));
      setTimeout(() => marked.forEach((l) => l.removeAttribute("data-marked")), 4000);
    };
    window.addEventListener(SEE_IT_EVENT, on);
    return () => window.removeEventListener(SEE_IT_EVENT, on);
  }, [box]);
  return null;
}
