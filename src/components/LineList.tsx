"use client";
import type { ReactNode } from "react";
import { CharacterCount } from "@/components/CharacterCount";
import { focusLine, linesOf, trimmedLength } from "@/lib/typingLimit";

/** One line of a one-per-line box, as listed under it. `line`: its line in the box (0-based, blank lines counted). */
export type ListedLine = { text: string; line: number; n: number; dup: boolean };

/**
 * (Owner, Nov 3, batch 35 §141) The list under a one-per-line box (the questions, the access keys on Post and Edit's Free box): one item per filled-in line, live
 * as it's typed, each with its own count (x / max, red over it) and a mark when the same line is typed twice. Clicking an item (or Enter / Space on it) puts the
 * cursor in the box at the end of that line (focusLine). `aside`: what sits at an item's right (the questions' Required tick).
 */
export function LineList({ box, text, max, label, mono = false, overLine, aside, countAttr, ...attrs }: {
  /** The box's id. */
  box: string;
  text: string;
  max: number;
  /** "Question" / "Key": the item's name ("Key 2", and "Go to question 2 in the box"). */
  label: string;
  mono?: boolean;
  /** The red line under an item over its limit (the server's words). */
  overLine?: string;
  aside?: (item: ListedLine) => ReactNode;
  /** The counter's data attribute ("data-question-count"). */
  countAttr?: string;
} & Record<`data-${string}`, string>) {
  const lines = linesOf(text);
  if (!lines.length) return null;
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l.text, (seen.get(l.text) ?? 0) + 1);
  const items: ListedLine[] = lines.map((l, i) => ({ ...l, n: i + 1, dup: (seen.get(l.text) ?? 0) > 1 }));
  const pick = (line: number) => focusLine(document.getElementById(box) as HTMLTextAreaElement | null, line);
  return (
    <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto" data-line-list={box} {...attrs}>
      {items.map((it) => {
        const over = trimmedLength(it.text) > max;
        return (
          <li key={it.line} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm" data-line={it.line}>
            {/* (Batch 15 sections 3 and 32) A long one scrolls in its own box (about 6 lines); its counter, and the red line when it's over. */}
            <span className="min-w-0 flex-1 text-ink-200">
              <div role="button" tabIndex={0} title={`Go to ${label.toLowerCase()} ${it.n} in the box`} aria-label={`${label} ${it.n}: go to its line in the box`}
                className={`max-w-full cursor-pointer overflow-y-auto whitespace-pre-wrap break-words rounded pr-1 [overflow-wrap:anywhere] hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${mono ? "font-mono text-xs" : ""}`}
                style={{ maxHeight: "9em" }} data-scroll-text="" data-line-pick={it.line}
                onClick={() => pick(it.line)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(it.line); } }}>
                {it.text}
              </div>
              <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
                <span className="text-slate-500">{label} {it.n}</span>
                {it.dup && <span className="rounded border border-rose-300/50 px-1 text-[10px] uppercase tracking-wide text-rose-200" data-line-dup="">Typed twice</span>}
                <CharacterCount value={it.text} max={max} {...(countAttr ? { [countAttr]: "" } : {})} />
              </span>
              {over && overLine && <span className="err-field block" data-line-red="">{overLine}</span>}
            </span>
            {aside?.(it)}
          </li>
        );
      })}
    </ul>
  );
}
