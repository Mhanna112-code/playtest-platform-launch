"use client";
/**
 * A link to something on this page (the full app's "Needs you" link pattern): bring it to the middle of the view and
 * mark it a moment (a ring for 4 seconds, see `data-[marked]:` on the target).
 */
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.setAttribute("data-marked", "");
  setTimeout(() => el.removeAttribute("data-marked"), 4000);
}

/** The classes a jump target carries. */
export const MARKABLE = "scroll-mt-24 rounded-xl transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300";
