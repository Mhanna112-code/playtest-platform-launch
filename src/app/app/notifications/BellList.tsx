"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/client";
import { LongList } from "@/components/LongList";
import { refreshBell } from "@/components/BellLink";

export type BellLine = { id: string; text: string; href: string; read: boolean; ago: string };
export type BellEntry = { key: string; title?: string; day?: string; lines: BellLine[]; /** (batch 14) the title already counts: no "N updates" */ counted?: boolean };

/**
 * (Design doc 9) The bell list. Lines about the same test on the same day stack into one entry ("Harbor Run · 4 updates today",
 * the newest line shown, an unread count); opening it shows every line of that day, each linking to its place, and marks them read.
 * (Owner, Oct 29, batch 29 §28) Read only when opened: a single line when it's clicked; a stack when it's expanded (all its lines) or one of its lines is clicked.
 * Unread entries keep the dot and bold until then; the header's bell number follows at once.
 */
export function BellList({ entries }: { entries: BellEntry[] }) {
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
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
  const line = (l: BellLine) => (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead(l) ? "bg-transparent" : "bg-indigo-400"}`} />
      {l.href ? <Link href={l.href} onClick={() => markRead([l])} data-bell-line={l.id} className={`flex-1 no-underline hover:underline ${isRead(l) ? "text-slate-400" : "font-semibold text-slate-100"}`}>{l.text}</Link> : <button type="button" onClick={() => markRead([l])} data-bell-line={l.id} className={`flex-1 text-left ${isRead(l) ? "text-slate-400" : "font-semibold text-slate-100"}`}>{l.text}</button>}
      <span className="shrink-0 text-xs text-slate-500">{l.ago}</span>
    </div>
  );
  return (
    <ul className="card divide-y divide-white/5 p-0">
      {entries.map((e) =>
        e.lines.length === 1 ? (
          <li key={e.key} className="px-4 py-3 hover:bg-white/[0.03]">{line(e.lines[0])}</li>
        ) : (
          <li key={e.key} className="px-4 py-3" data-bell-stack={e.key}>
            <button type="button" className="flex w-full items-start gap-3 text-left" aria-expanded={!!open[e.key]} onClick={() => toggle(e)}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.lines.some((l) => !isRead(l)) ? "bg-indigo-400" : "bg-transparent"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-slate-100 ${e.lines.some((l) => !isRead(l)) ? "font-semibold" : "font-medium"}`}>{e.counted ? `${e.title} ${e.day}` : `${e.title} · ${e.lines.length} updates ${e.day}`}</span>
                <span className="block truncate text-sm text-slate-400">{e.lines[0].text}</span>
              </span>
              {e.lines.some((l) => !isRead(l)) && <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs text-white">{e.lines.filter((l) => !isRead(l)).length}</span>}
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open[e.key] ? "rotate-180" : ""}`} />
            </button>
            {/* An opened stack shows 3 lines, then "Show N more" opening a scroll box. */}
            {open[e.key] && <LongList shown={3} tall="max-h-72" className="mt-2 space-y-2 border-l border-white/10 pl-3">{e.lines.map((l) => <li key={l.id}>{line(l)}</li>)}</LongList>}
          </li>
        ),
      )}
    </ul>
  );
}
