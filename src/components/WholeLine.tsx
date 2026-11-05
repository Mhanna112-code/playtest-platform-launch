"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { keepAmounts } from "@/components/Amounts";
import { OwnPanel, ResizeBox } from "@/components/Panel";

/** (Owner, Nov 5, §220) The shown line split at each "…": the cut text, and what each "…" stands for in the whole line (null: they don't line up). */
export function cutPieces(shown: string, full: string): { text: string; hidden?: string }[] | null {
  const parts = shown.split("…");
  if (parts.length < 2 || !full.startsWith(parts[0])) return null;
  const out: { text: string; hidden?: string }[] = [{ text: parts[0] }];
  let at = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const end = i === parts.length - 1 ? (full.endsWith(part) ? full.length - part.length : -1) : part ? full.indexOf(part, at) : -1;
    if (end < at) return null;
    out.push({ text: "", hidden: full.slice(at, end) }, { text: part });
    at = end + part.length;
  }
  return at === full.length ? out : null;
}

/**
 * (Owner, Nov 5, §216; §220 replaces the copy under it) A payment row (or a bell line) whose names are cut. Closed: the row as it is, names cut at 20 with "…", and
 * each "…" opens just that name in place. The arrow opens the WHOLE row in place, every name whole, in the draggable panel (it starts small and the grip drags it
 * taller, to half the screen); the arrow again closes it. A row with nothing cut is plain. `href` links the words; `after` follows them (amounts, how it was paid).
 */
export function WholeLine({ shown, full, href, after, className = "", children }: { shown: string; full?: string | null; href?: string; after?: ReactNode; className?: string; /** (older callers) the closed row as given */ children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<number[]>([]);
  const id = useId();
  const cut = !!full && full !== shown;
  const words = (t: ReactNode) => (href ? <a className="hover:underline" href={href}>{t}</a> : <span className={className}>{t}</span>);
  if (!cut) return children ? <>{children}</> : <>{href ? <a className="hover:underline" href={href}>{shown}</a> : className ? <span className={className}>{shown}</span> : shown}{after}</>;
  const pieces = cutPieces(shown, full!);
  const closed = pieces
    ? pieces.map((p, i) => p.hidden == null ? <span key={i}>{keepAmounts(p.text)}</span> : names.includes(i) ? <span key={i} data-name-open="">{p.hidden}</span>
      : <button key={i} type="button" className="rounded px-0.5 text-sky-300 hover:bg-white/10" aria-label="Show the whole name" data-name-toggle="" onClick={() => setNames([...names, i])}>…</button>)
    : keepAmounts(shown);
  const arrow = (
    <button type="button" className="ml-1 inline-flex rounded p-0.5 align-middle text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-expanded={open}
      aria-label={open ? "Hide the whole line" : "Show the whole line"} data-whole-toggle="" onClick={() => setOpen(!open)}>
      <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
  if (!open) return <>{words(closed)}{after}{arrow}</>;
  return (
    <span className="block" data-whole-line="">
      <OwnPanel>
        <ResizeBox id={`whole-${id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>
          <span className="block whitespace-pre-wrap break-words font-normal">{words(keepAmounts(full!))}{after}</span>
        </ResizeBox>
      </OwnPanel>
      {arrow}
    </span>
  );
}
