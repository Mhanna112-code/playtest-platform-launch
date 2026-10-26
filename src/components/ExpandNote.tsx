"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * (Design doc 5) A blue note under a field that another tab or device changed: what changed and when. Runs over two
 * lines? Then it is cut after two and an expand arrow opens the rest.
 */
export function ExpandNote({ label, lines }: { label: string; lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [lines, label]);
  return (
    <div className="info mt-1.5 flex items-start gap-2 !p-2 text-xs" role="status" data-field-note="">
      <div ref={ref} className={`min-w-0 flex-1 whitespace-pre-line ${open ? "" : "line-clamp-2"}`}>
        <b>{label}:</b> {lines.join("; ")}
      </div>
      {(long || open) && (
        <button type="button" className="btn-ghost !rounded-md !px-1.5 !py-0.5 text-xs" aria-expanded={open} aria-label={open ? "Show less" : "Show all of it"} onClick={() => setOpen(!open)}>
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
