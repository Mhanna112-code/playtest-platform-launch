"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/client";

export type BellLine = { id: string; text: string; href: string; read: boolean; ago: string };
export type BellEntry = { key: string; title?: string; day?: string; lines: BellLine[] };

/**
 * (Design doc 9) The bell list. Lines about the same test on the same day stack into one entry ("Harbor Run · 4 updates today",
 * the newest line shown, an unread count); opening it shows every line of that day, each linking to its place, and marks them read.
 */
export function BellList({ entries }: { entries: BellEntry[] }) {
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isRead = (l: BellLine) => l.read || read[l.id];
  function toggle(e: BellEntry) {
    const now = !open[e.key];
    setOpen({ ...open, [e.key]: now });
    if (now) {
      const ids = e.lines.filter((l) => !isRead(l)).map((l) => l.id);
      if (ids.length) {
        setRead((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, true])) }));
        void api("/api/notifications/read", { ids }).catch(() => null);
      }
    }
  }
  const line = (l: BellLine) => (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead(l) ? "bg-transparent" : "bg-indigo-400"}`} />
      {l.href ? <Link href={l.href} className={`flex-1 no-underline hover:underline ${isRead(l) ? "text-slate-400" : "text-slate-100"}`}>{l.text}</Link> : <span className={`flex-1 ${isRead(l) ? "text-slate-400" : "text-slate-100"}`}>{l.text}</span>}
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
                <span className="block font-medium text-slate-100">{e.title} · {e.lines.length} updates {e.day}</span>
                <span className="block truncate text-sm text-slate-400">{e.lines[0].text}</span>
              </span>
              {e.lines.some((l) => !isRead(l)) && <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs text-white">{e.lines.filter((l) => !isRead(l)).length}</span>}
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open[e.key] ? "rotate-180" : ""}`} />
            </button>
            {open[e.key] && <ul className="mt-2 space-y-2 border-l border-white/10 pl-3">{e.lines.map((l) => <li key={l.id}>{line(l)}</li>)}</ul>}
          </li>
        ),
      )}
    </ul>
  );
}
