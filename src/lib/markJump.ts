"use client";
/**
 * A link to something on this page (the full app's "Needs you" link pattern): bring it to the middle of the view and
 * mark it a moment (a ring for 4 seconds, see `data-[marked]:` on the target).
 */
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  // (Batch 15 section 42) A target inside a fold (a tester row's "Calls (N)", the tester's Call history) opens it first.
  for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.setAttribute("data-marked", "");
  setTimeout(() => el.removeAttribute("data-marked"), 4000);
}

/**
 * (Owner, NEXT-UI 13) After a press, bring the notice (and the button right above it) into view with the least scrolling:
 * nothing moves when both are already visible; never the top of the page.
 */
export function bringInView(el: HTMLElement | null) {
  if (!el) return;
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
 * (Owner, Oct 30, batch 35 §7) Where a link goes when its target isn't on the page: a sent piece ("piece-<id>", in Needs you) that was paid since is shown on its
 * tester's row ("part-<id>", the part's line there). The first of these on the page wins.
 */
export const hashTargets = (id: string) => (id.startsWith("piece-") ? [id, `part-${id.slice("piece-".length)}`] : [id]);

/** The classes a jump target carries. */
export const MARKABLE = "scroll-mt-24 rounded-xl transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300";
