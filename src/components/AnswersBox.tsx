"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * (Owner, Oct 29, batch 10) One piece's written answers, as the developer reads them: when they are longer than about 16 lines they sit in their own scroll box of that
 * height (the question labels inside it, scrolling as one). The Pay box goes after it, outside the box, so it stays visible.
 */
export function AnswersBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <div
      ref={box}
      data-answers-box={long ? "scroll" : "plain"}
      tabIndex={long ? 0 : undefined}
      aria-label={long ? "Written answers (scroll for more)" : undefined}
      className={`max-h-[20rem] space-y-2 overflow-y-auto ${long ? "rounded-lg border border-white/10 bg-white/[0.02] p-2 pr-3" : ""}`}
    >
      {children}
    </div>
  );
}
