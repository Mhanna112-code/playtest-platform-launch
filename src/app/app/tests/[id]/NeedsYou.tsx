"use client";
import type { ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";

/**
 * (Design doc 3 and 6) "Needs you": a fold (like every panel on the page). Each person's sent parts sit in a drop-down of their own inside it.
 * (Owner, Nov 3) The list is a draggable panel that scrolls through the names (and each name's drop-down is its own panel holding all their parts).
 */
export function NeedsYou({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details id="needs-you" open className="card scroll-mt-24 border-amber-300/30" aria-label="Needs you">
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white">
        <span className="h-2 w-2 rounded-full bg-amber-400" /> <h2 className="inline">Needs you</h2> <span className="text-sm font-normal text-slate-400">{count}</span>
      </summary>
      <div className="mt-4" data-needs-list="scroll">
        <ResizeBox id="needs-you-list" label="Needs you" defaultMax="min(36rem, 70vh)" tallest={0.85}>
          <div className="space-y-4">{children}</div>
        </ResizeBox>
      </div>
    </details>
  );
}
