"use client";
import { useEffect } from "react";

/** How close to a text box's bottom-right corner a finger has to land to drag it (px). */
export const TOUCH_GRIP_PX = 36;
/** The shortest a text box can be dragged on a touch screen (px): about two lines. */
export const TOUCH_MIN_PX = 56;

/** The new height for a drag of `dy` px from `start`, never below TOUCH_MIN_PX (the CSS max-height caps the top). */
export const touchHeight = (start: number, dy: number) => Math.max(TOUCH_MIN_PX, Math.round(start + dy));

/** Whether a touch at (x, y) is on the grip of a box with this rectangle. */
export const onGrip = (x: number, y: number, r: { right: number; bottom: number }) => x >= r.right - TOUCH_GRIP_PX && x <= r.right && y >= r.bottom - TOUCH_GRIP_PX && y <= r.bottom;

/**
 * (Owner, Nov 3) Phones' browsers (Safari on iPhone, Chrome on Android) don't give text boxes the drag corner desktop browsers do, so on a touch
 * screen every text box gets its own grip: the mark drawn in its bottom-right corner (globals.css), and a finger that lands there drags the box
 * taller or shorter instead of scrolling or opening the keyboard. Mounted once in the layout, so every text box on every page has it.
 */
export function TouchResize() {
  useEffect(() => {
    let drag: { box: HTMLTextAreaElement; y: number; h: number } | null = null;
    const start = (e: TouchEvent) => {
      const box = e.target;
      if (!(box instanceof HTMLTextAreaElement) || box.disabled || box.readOnly || e.touches.length !== 1) return;
      const t = e.touches[0];
      const r = box.getBoundingClientRect();
      if (!onGrip(t.clientX, t.clientY, r)) return;
      e.preventDefault();
      drag = { box, y: t.clientY, h: r.height };
    };
    const move = (e: TouchEvent) => {
      if (!drag) return;
      e.preventDefault();
      drag.box.style.height = `${touchHeight(drag.h, e.touches[0].clientY - drag.y)}px`;
    };
    const end = () => { drag = null; };
    document.addEventListener("touchstart", start, { passive: false, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, true);
    document.addEventListener("touchcancel", end, true);
    return () => {
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", end, true);
    };
  }, []);
  return null;
}
