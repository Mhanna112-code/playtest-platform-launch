"use client";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * (Owner, Nov 3, batch 35 §139) Sent work in its own panel: written answers and recordings in the developer's tester rows and in Needs you sit in a box with its
 * own scroll. At first it is small (about 12rem, 6–8 lines, and never more than 40% of the screen), so the Pay / Pay more box under it is in view; a shorter
 * piece is only as tall as it is. The grip at its bottom-right corner drags it taller or shorter: at least about 3 lines (5rem), at most 60% of the screen.
 * The content scrolls inside at any height. A height the person dragged to is kept for that panel while the page redraws (and in this tab's sessionStorage, so
 * it survives the panel being drawn again).
 */
export const PANEL_DEFAULT_MAX = "min(12rem, 40vh)";
/** The smallest a panel can be dragged (about 3 lines). */
export const PANEL_MIN_PX = 80;
/** The tallest a panel can be dragged: 60% of the screen. */
export const PANEL_MAX_SHARE = 0.6;
/** One arrow-key press on the grip. */
export const PANEL_STEP_PX = 24;

/** A dragged height kept within the panel's limits for a screen `viewport` px tall (`share`: the tallest it can be dragged, as a share of the screen). */
export function clampPanel(px: number, viewport: number, share = PANEL_MAX_SHARE) {
  const max = Math.max(PANEL_MIN_PX, Math.round(viewport * share));
  return Math.round(Math.min(max, Math.max(PANEL_MIN_PX, px)));
}

const heightKey = (id: string) => `panel-h:${id}`;
const foldKey = (id: string) => `fold:${id}`;
/** The height a person dragged this panel to in this tab (null: none kept, or storage blocked). */
export function keptHeight(id: string): number | null {
  try {
    const v = Number(window.sessionStorage.getItem(heightKey(id)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
export const keepHeight = (id: string, px: number) => write(heightKey(id), String(px));
/** Whether this fold was left open (true) or closed (false) in this tab; null: never toggled (it starts as drawn). */
export function keptFold(id: string): boolean | null {
  try {
    const v = window.sessionStorage.getItem(foldKey(id));
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
export const keepFold = (id: string, open: boolean) => write(foldKey(id), open ? "1" : "0");
function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // private window or storage blocked: the height simply isn't remembered
  }
}

/**
 * (Owner, Nov 3, batch 35 §152) The call lists (call requests, booked and past calls, the dashboards' calls) and the payment lists sit in this same panel: `defaultMax`
 * keeps each list's old height at first (a CSS max-height), and `tallest` is how tall the grip drags it (60% of the screen, unless the list was already taller).
 */
export function ResizeBox({ id, children, label, className = "", defaultMax = PANEL_DEFAULT_MAX, tallest = PANEL_MAX_SHARE }: { /** unique on the page, e.g. "needs-sub-<id>" */ id: string; children?: ReactNode; /** what's inside, for screen readers */ label: string; className?: string;
  /** (§152) the height at first, a CSS max-height */ defaultMax?: string; /** (§152) the tallest the grip drags it, as a share of the screen */ tallest?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const kept = keptHeight(id);
    if (kept != null) setHeight(clampPanel(kept, window.innerHeight, tallest));
  }, [id, tallest]);
  const set = useCallback((px: number, save: boolean) => {
    const h = clampPanel(px, window.innerHeight, tallest);
    setHeight(h);
    if (save) keepHeight(id, h);
  }, [id, tallest]);
  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    drag.current = { y: e.clientY, h: box.current?.getBoundingClientRect().height ?? 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (drag.current) set(drag.current.h + e.clientY - drag.current.y, false);
  };
  const up = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    set(drag.current.h + e.clientY - drag.current.y, true);
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLSpanElement>) => {
    const now = box.current?.getBoundingClientRect().height ?? PANEL_MIN_PX;
    const to = e.key === "ArrowDown" ? now + PANEL_STEP_PX : e.key === "ArrowUp" ? now - PANEL_STEP_PX : e.key === "Home" ? PANEL_MIN_PX : e.key === "End" ? window.innerHeight : null;
    if (to == null) return;
    e.preventDefault();
    set(to, true);
  };
  return (
    <div className={`relative rounded-lg border border-white/10 bg-white/[0.02] ${className}`} data-panel={id}>
      <div ref={box} tabIndex={0} aria-label={`${label} (scroll for more)`} data-panel-box="" data-panel-height={height ?? "default"}
        className="space-y-2 overflow-y-auto p-2 pb-4 pr-3"
        style={height != null ? { height, maxHeight: `${tallest * 100}vh` } : { maxHeight: defaultMax }}>
        {children}
      </div>
      {/* The grip: drag it (or use the arrow keys on it) to make the panel taller or shorter. */}
      <span role="separator" aria-orientation="horizontal" aria-label={`Resize ${label}: drag, or use the up and down arrow keys`} tabIndex={0} data-panel-grip=""
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        className="absolute bottom-0.5 right-0.5 flex h-4 w-4 cursor-ns-resize [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 touch-none select-none items-end justify-end rounded-sm text-slate-500 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true"><path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" /></svg>
      </span>
    </div>
  );
}

/**
 * (Owner, Nov 3, batch 35 §139) A fold under a part (its answers or recordings; its Pay or Pay more box): its own toggle, open by default. Opened or closed, it stays
 * that way while the page redraws (and in this tab's sessionStorage). A link to something inside it (or to it) opens it (markJump's jumpTo).
 */
export function Fold({ id, summary, children, defaultOpen = true, className = "", summaryClassName = "" }: { id: string; summary: ReactNode; children?: ReactNode; defaultOpen?: boolean; className?: string; summaryClassName?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const kept = keptFold(id);
    if (ref.current && kept != null) ref.current.open = kept;
  }, [id]);
  return (
    <details ref={ref} open={defaultOpen} className={`group/fold ${className}`} data-fold={id} data-jump-open=""
      onToggle={(e) => keepFold(id, e.currentTarget.open)}>
      <summary className={`fold-chevron cursor-pointer text-sm text-slate-300 ${summaryClassName}`}>{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
