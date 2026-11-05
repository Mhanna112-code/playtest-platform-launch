"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { keepAmounts } from "@/components/Amounts";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { bellShort, opensInBox } from "@/lib/bell";

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
export function WholeLine({ shown, full, href, after, className = "", render, children }: { shown: string; full?: string | null; href?: string; after?: ReactNode; className?: string;
  /** (§230) how a piece of the text is drawn (the confirm lists link the quoted test names) */ render?: (t: string) => ReactNode; /** (older callers) the closed row as given */ children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<number[]>([]);
  const id = useId();
  const cut = !!full && full !== shown;
  const draw = render ?? keepAmounts;
  const words = (t: ReactNode) => (href ? <a className="hover:underline" href={href}>{t}</a> : <span className={className}>{t}</span>);
  if (!cut) return children ? <>{children}</> : <>{href ? <a className="hover:underline" href={href}>{render ? render(shown) : shown}</a> : className ? <span className={className}>{render ? render(shown) : shown}</span> : render ? render(shown) : shown}{after}</>;
  const pieces = cutPieces(shown, full!);
  const closed = pieces
    ? pieces.map((p, i) => p.hidden == null ? <span key={i}>{draw(p.text)}</span> : names.includes(i) ? <span key={i} data-name-open="">{p.hidden}</span>
      : <button key={i} type="button" className="rounded px-0.5 text-sky-300 hover:bg-white/10" aria-label="Show the whole name" data-name-toggle="" onClick={() => setNames([...names, i])}>…</button>)
    : draw(shown);
  const arrow = (
    <button type="button" className="ml-1 inline-flex rounded p-0.5 align-middle text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-expanded={open}
      aria-label={open ? "Hide the whole line" : "Show the whole line"} data-whole-toggle="" onClick={() => setOpen(!open)}>
      <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
  // (Owner, Nov 5, §244) A mouse hover shows the whole line too (the arrow and "…" still open it in place).
  if (!open) return <><span title={full!}>{words(closed)}</span>{after}{arrow}</>;
  return (
    <span className="block" data-whole-line="">
      <OwnPanel>
        <ResizeBox id={`whole-${id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>
          <span className="block whitespace-pre-wrap break-words font-normal">{words(draw(full!))}{after}</span>
        </ResizeBox>
      </OwnPanel>
      {arrow}
    </span>
  );
}

/**
 * (Owner, Nov 5, §236) WholeLine for a server page (a function can't be handed from a server page to this client component): a line whose names are cut, with one
 * person's whole name (`name`) linked to `href` wherever it appears whole (the Terms history's developer).
 */
export function NameLine({ shown, full, name, href }: { shown: string; full: string | null; name?: string; href?: string | null }) {
  const linked = (t: string): ReactNode => (name && href && t.includes(name) ? t.split(name).flatMap((part, i) => (i ? [<a key={i} href={href} data-name-link="person">{name}</a>, part] : [part])) : t);
  return <WholeLine shown={shown} full={full} render={linked} />;
}

/**
 * (Owner, Nov 5, batch 35 §246) A payment row's, a confirm row's (and, the same way, a bell line's) "what": closed, its first 30 characters (bellShort: never inside a
 * word or an amount) with "…" and the arrow beside it; the arrow opens the whole "what" IN PLACE as plain text, wrapped, no box (only a line over LINE_BOX_OVER,
 * 200 characters, opens in the draggable box). A "what" of 30 characters or fewer shows whole, with no arrow. Nothing else is cut (names and test titles are at most
 * 20 characters), so there are no per-name "…" toggles. The amount, dates, the marks and every button sit OUTSIDE it (`after`, or the row around it), always shown.
 * A mouse hover shows the whole "what" (§244). `href` links the words; `render` draws a piece of the text (the confirm rows' green test-name links, §245).
 */
export function WhatLine({ text, href, after, className = "", render, startOpen = false }: { text: string; href?: string; after?: ReactNode; className?: string; render?: (t: string) => ReactNode;
  /** drawn opened at first (the arrow still closes it) */ startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const draw = render ?? keepAmounts;
  const short = bellShort(text);
  const words = (t: ReactNode) => (href ? <a className="hover:underline" href={href} data-what-text="">{t}</a> : <span className={className || undefined} data-what-text="">{t}</span>);
  if (!short) return <>{words(draw(text))}{after}</>;
  const arrow = (
    <button type="button" className="ml-1 inline-flex rounded p-0.5 align-middle text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-expanded={open}
      aria-label={open ? "Hide the whole line" : "Show the whole line"} data-whole-toggle="" onClick={() => setOpen(!open)}>
      <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
  if (!open) return <><span title={text} data-what-cut="">{words(draw(short))}</span>{arrow}{after}</>;
  if (opensInBox(text)) return (
    <span className="block" data-whole-line="" data-what-box="">
      <OwnPanel>
        <ResizeBox id={`what-${id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>
          <span className="block whitespace-pre-wrap break-words font-normal">{words(draw(text))}</span>
        </ResizeBox>
      </OwnPanel>
      {arrow}{after}
    </span>
  );
  return <><span className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-what-open="">{words(draw(text))}</span>{arrow}{after}</>;
}
