"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
export function seeItClick(e: React.MouseEvent<HTMLElement>, target: string, at?: string | Date, saveAt?: string | Date, /** (batch 35 §34) the panel lines the line's changes cover */ keys?: string[]) {
  const dialog = e.currentTarget.closest("dialog");
  if (dialog) {
    e.preventDefault();
    dialog.close();
  }
  setTimeout(() => {
    const el = document.querySelector(target);
    if (el instanceof HTMLDetailsElement) el.open = true;
    if (dialog && el) el.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    window.dispatchEvent(new CustomEvent(SEE_IT_EVENT, { detail: { at: at ? new Date(at).toISOString() : undefined, saveAt: saveAt ? new Date(saveAt).toISOString() : undefined, ...(keys?.length ? { keys } : {}) } }));
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

/** How long See it waits for the page's redraw to show a newer Save before it only brings the panel into view (marking nothing). */
export const SEE_IT_WAIT_MS = 10_000;

/** (Batch 35 §3) What a listing line's See it does with the developer's Listing panel (which says the Save it shows in `data-saved-at`). */
export function seeItPlan(shown: string | undefined, saveAt: string | undefined, at: number): "mark" | "refresh" | "none" | "legacy" {
  if (shown === undefined) return "legacy"; // the session page's contract box: as before
  const s = shown ? new Date(shown).getTime() : NaN;
  if (saveAt) {
    const w = new Date(saveAt).getTime();
    if (s === w) return "mark";
    return isNaN(s) || w > s ? "refresh" : "none"; // the panel shows an older Save: redraw first; a newer one: that line's fields are no longer the panel's
  }
  // A line without its Save (an older page's box): the panel shows it when that Save is no older than the line (within the same 10 seconds the lines use).
  if (isNaN(at)) return "legacy";
  if (!isNaN(s) && s >= at - 10_000) return s <= at + 10_000 ? "mark" : "none";
  return "refresh";
}

/**
 * (Batch 30 §15) The top box's "Updated · 7:21 PM: … · See it" on the session page: opens the contract box ("Your agreed scope"), brings it into view and marks
 * the listing lines that save changed (those last updated at or after the line's time) for a few seconds. With none matching, every updated line is marked.
 * (Owner's finding, Oct 30, batch 35 §3) The developer's Listing panel says which Save it shows (`data-saved-at`): a line about a newer Save (its line came before
 * the page redrew) redraws the page first and marks that Save's fields once the panel shows it; it never marks another Save's fields (a line about an older Save
 * only brings the panel into view).
 */
export function ListingSeeIt({ box }: { box: string }) {
  const router = useRouter();
  useEffect(() => {
    let wait: ReturnType<typeof setInterval> | undefined;
    const reduce = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mark = (el: HTMLElement, marked: HTMLElement[]) => {
      (marked[0] ?? el).scrollIntoView({ block: marked[0] ? "center" : "start", behavior: reduce() ? "auto" : "smooth" });
      marked.forEach((l) => l.setAttribute("data-marked", ""));
      setTimeout(() => marked.forEach((l) => l.removeAttribute("data-marked")), 4000);
    };
    const updated = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-info-line][data-updated-at]")];
    // (Owner, Oct 31, batch 35 §34) One line covers every listing change since the page's seen time: See it marks every panel line any of them changed.
    const covered = (el: HTMLElement, keys?: string[]) => (keys?.length ? [...el.querySelectorAll<HTMLElement>("[data-info-line]")].filter((l) => keys.includes(l.dataset.infoLine ?? "")) : updated(el));
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ at?: string; saveAt?: string; keys?: string[] }>).detail ?? {};
      const at = new Date(d.at ?? "").getTime();
      const el = document.getElementById(box);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      if (wait) clearInterval(wait);
      wait = undefined;
      const plan = seeItPlan(el.dataset.savedAt, d.saveAt, at);
      if (plan === "legacy" && d.keys?.length) return mark(el, covered(el, d.keys));
      if (plan === "legacy") {
        const lines = updated(el);
        let marked = isNaN(at) ? [] : lines.filter((l) => new Date(l.dataset.updatedAt ?? "").getTime() >= at - 10_000);
        if (!marked.length) marked = lines;
        return mark(el, marked);
      }
      // The panel's tagged lines are exactly the fields of the Save it shows.
      if (plan === "mark") return mark(el, covered(el, d.keys));
      if (plan === "none") return mark(el, []);
      // The line's Save is newer than the panel: redraw, then mark once the panel shows that Save (the panel is drawn again, so it's looked up each time).
      el.scrollIntoView({ block: "start", behavior: reduce() ? "auto" : "smooth" });
      router.refresh();
      const until = Date.now() + SEE_IT_WAIT_MS;
      wait = setInterval(() => {
        const now = document.getElementById(box);
        const p = now ? seeItPlan(now.dataset.savedAt, d.saveAt, at) : "refresh";
        if (now && (p === "mark" || p === "none")) {
          clearInterval(wait);
          wait = undefined;
          return mark(now, p === "mark" ? covered(now, d.keys) : []);
        }
        if (Date.now() > until) {
          clearInterval(wait);
          wait = undefined;
        }
      }, 150);
    };
    window.addEventListener(SEE_IT_EVENT, on);
    return () => {
      window.removeEventListener(SEE_IT_EVENT, on);
      if (wait) clearInterval(wait);
    };
  }, [box, router]);
  return null;
}
