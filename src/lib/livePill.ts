// (Owner, Oct 29, batch 27 section 4; replaces batch 15 section 28's first-update scroll) The live box's pill: every update that arrives while the box is out of view
// raises "1 new update" (counting up), whatever is being typed; nothing scrolls on its own. Its arrow points where the updates are. No imports: pure, tested directly.

export type PillSide = "" | "up" | "down";

/**
 * Where the live box is against the screen: "" while its newest lines (the top of the box) show, "up" when they're above the screen, "down" when below (on Edit the box
 * sits under Save, so it can be below).
 */
export function pillSide(r: { top: number; bottom: number } | null | undefined, viewHeight: number): PillSide {
  if (!r) return "up";
  if (r.top < 0) return "up";
  // The top of the box (the newest line, about 3 lines tall) must be on the screen; a box taller than the screen counts once its top shows.
  const head = Math.min(r.bottom - r.top, 80);
  return r.top + head <= viewHeight ? "" : "down";
}

/** "1 new update ↑" / "3 new updates ↓". */
export const pillLabel = (count: number, side: PillSide) => `${count} new update${count === 1 ? "" : "s"} ${side === "down" ? "↓" : "↑"}`;
