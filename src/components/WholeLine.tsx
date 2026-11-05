"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { keepAmounts } from "@/components/Amounts";

/**
 * (Owner, Nov 5, §216) A payment row whose names are cut (NAME_CUT) opens its whole text the bell's way (§202): an arrow after it, and the whole line, names uncut,
 * in a small scroll box under it. No hover. A row with nothing cut has no arrow.
 */
export function WholeLine({ shown, full, children }: { shown: string; full?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const cut = !!full && full !== shown;
  return (
    <>
      {children}
      {cut && (
        <button type="button" className="ml-1 inline-flex rounded p-0.5 align-middle text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-expanded={open}
          aria-label={open ? "Hide the whole line" : "Show the whole line"} data-whole-toggle="" onClick={() => setOpen(!open)}>
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {cut && open && <span className="mt-1 block max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white/[0.04] px-2 py-1.5 text-sm font-normal text-slate-200" tabIndex={0} data-whole-line="">{keepAmounts(full!)}</span>}
    </>
  );
}
