"use client";
import { useEffect, useRef, useState } from "react";

/**
 * (Owner, Oct 27) Long text that is the content of a row (a reason, a note): cut after 3 lines with "Show more" opening the rest in place. Whitespace is kept.
 */
export function ClampText({ text, lines = 3, className = "" }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text]);
  return (
    <span className="block">
      <p ref={ref} className={`whitespace-pre-wrap break-words ${className}`} style={open ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</p>
      {(long || open) && <button type="button" className="btn-ghost !px-1.5 !py-0 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}
    </span>
  );
}
