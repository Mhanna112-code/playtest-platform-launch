"use client";
import { lineFallbacks } from "./lineAnchors";
/**
 * A link to something on this page (the full app's "Needs you" link pattern): bring it to the middle of the view and
 * mark it a moment (a ring for 4 seconds, see `data-[marked]:` on the target).
 */
/** (Owner, Nov 4, §182) Sent to a folded long text (LongText) that holds a jump's target: it opens at once. */
export const OPEN_FOLD_TEXT = "fold-text:open";

export function jumpTo(id: string) {
  let el = document.getElementById(id);
  if (!el) return;
  // (§182) A target inside a folded long text (an answer, an addition) opens it first; it is drawn again open, so the target is found again.
  let folded = false;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.dataset?.foldText === "closed") { p.dispatchEvent(new Event(OPEN_FOLD_TEXT)); folded = true; }
  if (folded) el = document.getElementById(id) ?? el;
  // (Batch 15 section 42) A target inside a fold (a tester row's "Had (N)" / "Cancelled (N)", the same two in the tester's Live session, §209) opens it first.
  for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  // (Batch 35 §139) A link straight to a part (or to its Pay / Pay more) opens the folds under it: its answers or recordings and its Pay box.
  el.querySelectorAll?.<HTMLDetailsElement>("details[data-jump-open]").forEach((d) => { d.open = true; });
  // (Owner, Nov 9, §356) A disputed part's payments: its "Payments (N)" opens too (the decided dispute is listed there).
  if (el.dataset?.jumpOpenAll !== undefined) el.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => { d.open = true; });
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.setAttribute("data-marked", "");
  setTimeout(() => el.removeAttribute("data-marked"), 4000);
}

/** (Owner's bug, Oct 31, batch 35 §62) Until then a box under a button doesn't pull the page back to itself: a See it jump is under way. */
let heldUntil = 0;
/** Held for `ms` from now (a later call replaces the time: the jump's own scroll landing shortens it). */
export const holdBringInView = (ms: number, now = Date.now()) => void (heldUntil = now + ms);
export const bringInViewHeld = (now = Date.now()) => now < heldUntil;

/**
 * (Owner, NEXT-UI 13) After a press, bring the notice (and the button right above it) into view with the least scrolling:
 * nothing moves when both are already visible; never the top of the page.
 */
export function bringInView(el: HTMLElement | null) {
  if (!el || bringInViewHeld()) return;
  // (Owner, Nov 4, §179) A notice inside a scrolling panel (a call's dispute box in the tester's Live call panel, a Pay more in the developer's Calls (N)): the
  // panel scrolls to it first (the least scrolling, at once, so the page's step below measures where it landed), then the page.
  const box = el.closest?.<HTMLElement>("[data-panel-box]");
  if (box) {
    const b = box.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    let d = 0;
    if (e.bottom > b.bottom) d = e.bottom - b.bottom;
    if (e.top - d < b.top) d = e.top - b.top; // taller than the panel: its top first
    if (Math.abs(d) > 1) box.scrollTop += d;
  }
  const prev = el.previousElementSibling as HTMLElement | null;
  const r = el.getBoundingClientRect();
  const top = prev && prev.tagName === "BUTTON" ? Math.min(prev.getBoundingClientRect().top, r.top) : r.top;
  const lo = 88; // under the sticky header
  const hi = window.innerHeight - 12;
  let dy = 0;
  if (r.bottom > hi) dy = r.bottom - hi;
  if (top - dy < lo) dy = top - lo; // too tall to fit both: the button first
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: "smooth" });
}

/**
 * (Owner, Nov 5, §209) The tester's "Call history" card and its "Booked (N)" are gone: an older link to them ("#call-history", "#calls-booked-<id>", e.g. a
 * page or tab kept from before) opens the Live session, where the booked calls and Had / Cancelled are now.
 */
const RETIRED = /^(call-history|calls-booked-[\w-]+)$/;
/**
 * When a sent piece or a paid-work update clears from Needs you, open the same part under Testers.
 */
export const hashTargets = (id: string) => {
  if (id.startsWith("piece-") || id.startsWith("update-")) return [id, id.replace(/^(piece|update)-/, "part-")];
  if (id === "needs-review") return [id, "needs-you", "your-tests"];
  if (id === "needs-you") return [id, "your-tests"];
  if (["suspended-tests", "rejoin", "history"].includes(id)) return [id, "previous-tests"];
  if (RETIRED.test(id)) return [id, "live"];
  return lineFallbacks(id);
};
/** (Owner, Nov 6, §284) Jump to a line's place, or the first fallback on the page (a request whose row has left: its Call requests box). */
export const jumpToFirst = (id: string) => jumpTo(hashTargets(id).find((t) => document.getElementById(t)) ?? id);

/** The classes a jump target carries. */
export const MARKABLE = "scroll-mt-24 rounded-xl transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300";
