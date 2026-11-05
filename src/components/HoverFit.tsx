"use client";
import { useEffect } from "react";

/** How close to the screen's edges a hover card may come (px). */
export const HOVER_EDGE_PX = 8;

/**
 * (Owner, Nov 4, §187) How far left a hover card must move to stay on the screen: its right edge at most HOVER_EDGE_PX from the screen's right edge, never past
 * the left one. 0 when it already fits.
 */
export function hoverShift(r: { left: number; right: number }, screen: number, edge = HOVER_EDGE_PX) {
  const over = r.right - (screen - edge);
  return over > 0 ? Math.max(0, Math.min(over, r.left - edge)) : 0;
}

/**
 * (Owner, Nov 4, §187) The hover cards (a person's name, the Testers joined avatars, the dashboard's tester circles: `[data-hover-card]`) are not drawn at all until
 * shown (they were only invisible, and the developer's card on the tester's session page made the page scroll 2px sideways at 375px). Shown (hover or focus), a
 * card that would run past the screen's right edge moves left to fit. Mounted once in the layout, like TouchResize.
 */
export function HoverFit() {
  useEffect(() => {
    const fit = (e: Event) => {
      const group = (e.target as Element | null)?.closest?.(".group");
      const card = group?.querySelector<HTMLElement>(":scope > [data-hover-card]");
      if (!card) return;
      card.style.transform = "";
      requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        if (!r.width) return;
        const shift = hoverShift(r, document.documentElement.clientWidth);
        card.style.transform = shift ? `translateX(-${Math.ceil(shift)}px)` : "";
      });
    };
    document.addEventListener("mouseover", fit, true);
    document.addEventListener("focusin", fit, true);
    return () => {
      document.removeEventListener("mouseover", fit, true);
      document.removeEventListener("focusin", fit, true);
    };
  }, []);
  return null;
}
