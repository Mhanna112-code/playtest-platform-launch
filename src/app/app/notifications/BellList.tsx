"use client";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/client";
import { LongList } from "@/components/LongList";
import { refreshBell } from "@/components/BellLink";
import { keepAmounts } from "@/components/Amounts";
import { TestName } from "@/components/Cut";
import { bellShort, opensInBox } from "@/lib/bell";
import { LINE_LINK_CLASS, withLineLinks, type LineLink } from "@/components/LineLinks";

export type BellLine = { id: string; text: string; href: string; read: boolean; ago: string; /** (§245) the test it is about: its name in the line is green */ test?: string;
  /** (Owner, Nov 5, §270) the people and tests the line names, each its own green link (the rest of the line still opens `href`) */ links?: LineLink[] };

/** (Owner, Nov 5, batch 35 §245) A bell line's words, its test's name green (like a person's green name) wherever it appears whole; amounts kept whole. */
export function bellWords(text: string, test?: string): ReactNode {
  if (!test || !text.includes(test)) return keepAmounts(text);
  return text.split(test).map((part, i) => <Fragment key={i}>{i > 0 && <span className="text-volt-300" data-test-name="">{test}</span>}{keepAmounts(part)}</Fragment>);
}
export type BellEntry = { key: string; title?: string; day?: string; lines: BellLine[]; /** (batch 14) the title already counts: no "N updates" */ counted?: boolean; /** (Owner, Nov 3) the title is a test's name (cut at NAME_CUT, 20 characters; owner, Nov 5, §203: was 12), not a kind of update */ test?: boolean;
  /** (Owner, Nov 5, §270) where the title's test name opens (its own green link) */ testHref?: string };

/**
 * (Design doc 9) The bell list. Lines about the same test on the same day stack into one entry ("Harbor Run · 4 updates today",
 * the newest line shown, an unread count); opening it shows every line of that day, each linking to its place, and marks them read.
 * (Owner, Oct 29, batch 29 §28) Read only when opened: a single line when it's clicked; a stack when it's expanded (all its lines) or one of its lines is clicked.
 * Unread entries keep the dot and bold until then; the header's bell number follows at once.
 * (Owner, Nov 5, §202) Each line, alone or inside a stack, shows its first 50 characters (§251; was 30) then "…" (bellShort); its arrow opens the whole line in place (§246:
 * inline, wrapped; the draggable box only over LINE_BOX_OVER, 200 characters).
 * Stack headings are unchanged.
 */
export function BellList({ entries }: { entries: BellEntry[] }) {
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [whole, setWhole] = useState<Record<string, boolean>>({});
  const isRead = (l: BellLine) => l.read || read[l.id];
  function markRead(lines: BellLine[]) {
    const ids = lines.filter((l) => !isRead(l)).map((l) => l.id);
    if (!ids.length) return;
    setRead((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    void api("/api/notifications/read", { ids }).then(refreshBell, () => null);
  }
  function toggle(e: BellEntry) {
    const now = !open[e.key];
    setOpen({ ...open, [e.key]: now });
    if (now) markRead(e.lines);
  }
  // (Owner, Nov 5, §202) A line longer than 50 characters (§251) shows its first 50 (bellShort: never inside a word or an amount) and "…"; the arrow beside it opens the
  // WHOLE line under it (names uncut), in a small scroll box when long. The words still follow the line's link; opening the whole line reads it, like a click.
  const line = (l: BellLine) => {
    const short = bellShort(l.text);
    const wide = !!short && !!whole[l.id];
    // (Owner, Nov 5, §246; was §220's draggable panel) Opened, the line itself shows whole, in place, wrapped, with no box; only a line over LINE_BOX_OVER (200
    // characters: a typed note) opens in the draggable panel (it starts small; the grip drags it taller). No copy under it.
    // (Owner, Nov 5, §270) A line naming people or tests: each is its own green link (opened and closed); closed, the rest of the words still open the line's place,
    // side by side with them (never nested); whichever piece is pressed marks the line read.
    const linked = !!l.links?.length;
    const all = <span className="block whitespace-pre-wrap break-words" data-bell-full={l.id}>{linked ? withLineLinks(l.text, l.links, { onClick: () => markRead([l]), Anchor: Link }) : bellWords(l.text, l.test)}</span>;
    const words = wide ? (opensInBox(l.text) ? <OwnPanel><ResizeBox id={`bell-${l.id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>{all}</ResizeBox></OwnPanel> : all) : bellWords(short ?? l.text, l.test);
    const look = `flex-1 min-w-0 ${isRead(l) ? "text-slate-400" : "font-semibold text-slate-100"}`;
    const pieces = linked && !wide ? withLineLinks(short ?? l.text, l.links, { rest: l.href || null, restClass: "text-inherit no-underline hover:underline", onClick: () => markRead([l]), Anchor: Link }) : null;
    return (
      <div>
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead(l) ? "bg-transparent" : "bg-indigo-400"}`} />
          {wide ? <div className={look} data-bell-line={l.id}>{words}</div> : pieces ? <span className={look} data-bell-line={l.id} data-bell-pieces="" title={short ? l.text : undefined} onClick={l.href ? undefined : () => markRead([l])}>{pieces}</span> : l.href ? <Link href={l.href} onClick={() => markRead([l])} data-bell-line={l.id} title={short ? l.text : undefined} className={`${look} no-underline hover:underline`}>{words}</Link> : <button type="button" onClick={() => markRead([l])} data-bell-line={l.id} className={`${look} text-left`}>{words}</button>}
          {short && (
            <button type="button" className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100" aria-expanded={wide} aria-label={wide ? "Hide the whole line" : "Show the whole line"} data-bell-toggle={l.id}
              onClick={() => { setWhole((w) => ({ ...w, [l.id]: !wide })); if (!wide) markRead([l]); }}>
              <ChevronDown className={`h-4 w-4 transition ${wide ? "rotate-180" : ""}`} />
            </button>
          )}
          <span className="shrink-0 text-xs text-slate-500">{l.ago}</span>
        </div>
      </div>
    );
  };
  return (
    <ul className="card divide-y divide-white/5 p-0">
      {entries.map((e) =>
        e.lines.length === 1 ? (
          <li key={e.key} className="px-4 py-3 hover:bg-white/[0.03]">{line(e.lines[0])}</li>
        ) : (
          <li key={e.key} className="px-4 py-3" data-bell-stack={e.key}>
            {/* (Owner, Nov 5, §270) The heading's test name and the preview's names are links of their own, so the heading toggles as a role="button" (a <button>
                can't hold a link); a press on a link opens it and doesn't toggle. */}
            <div role="button" tabIndex={0} className="flex w-full cursor-pointer items-start gap-3 text-left" aria-expanded={!!open[e.key]} onClick={() => toggle(e)} onKeyDown={(k) => { if (k.target === k.currentTarget && (k.key === "Enter" || k.key === " ")) { k.preventDefault(); toggle(e); } }} data-bell-stack-head="">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.lines.some((l) => !isRead(l)) ? "bg-indigo-400" : "bg-transparent"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-slate-100 ${e.lines.some((l) => !isRead(l)) ? "font-semibold" : "font-medium"}`}>{e.test && e.title ? <>{e.testHref ? <Link href={e.testHref} className={`${LINE_LINK_CLASS} [overflow-wrap:anywhere]`} data-line-link="test" onClick={(ev) => { ev.stopPropagation(); markRead(e.lines); }}>{e.title}</Link> : <TestName text={e.title} />} · {e.lines.length} updates {e.day}</> : e.counted ? `${e.title} ${e.day}` : `${e.title} · ${e.lines.length} updates ${e.day}`}</span>
                <span className="block truncate text-sm text-slate-400" onClick={e.lines[0].links?.length ? (ev) => { if ((ev.target as HTMLElement).closest("a")) { ev.stopPropagation(); markRead(e.lines); } } : undefined}>{e.lines[0].links?.length ? withLineLinks(bellShort(e.lines[0].text) ?? e.lines[0].text, e.lines[0].links, { Anchor: Link }) : keepAmounts(bellShort(e.lines[0].text) ?? e.lines[0].text)}</span>
              </span>
              {e.lines.some((l) => !isRead(l)) && <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs text-white">{e.lines.filter((l) => !isRead(l)).length}</span>}
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open[e.key] ? "rotate-180" : ""}`} />
            </div>
            {/* An opened stack shows 3 lines, then "Show N more" opening a scroll box. */}
            {open[e.key] && <LongList shown={3} tall="max-h-72" className="mt-2 space-y-2 border-l border-white/10 pl-3">{e.lines.map((l) => <li key={l.id}>{line(l)}</li>)}</LongList>}
          </li>
        ),
      )}
    </ul>
  );
}
