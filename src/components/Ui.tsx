import Link from "next/link";
import type { ReactNode } from "react";
import { FileText, Radio, Video } from "lucide-react";
import { CategoryIcon, CATEGORY_STYLE } from "@/components/Category";

// The full app's small cards parts (components/ui.tsx and category.tsx there), on lean's data.

/** The parts a test (or a contract) has, as badges: Written answers · Screen recording · Live call. */
export function PartBadges({ written, recording, live }: { written: boolean; recording: boolean; live: boolean }) {
  return (
    <>
      {written && <span className="badge"><FileText className="h-3.5 w-3.5" /> Written answers</span>}
      {recording && <span className="badge"><Video className="h-3.5 w-3.5" /> Screen recording</span>}
      {live && <span className="badge"><Radio className="h-3.5 w-3.5" /> Live call</span>}
    </>
  );
}

/** Big rounded icon tile used as a test's "avatar". */
export function CategoryTile({ category, size = "h-12 w-12" }: { category: string; size?: string }) {
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02]`}>
      <CategoryIcon category={category} className="h-6 w-6" />
    </div>
  );
}
export const mainCategory = (categories: string[]) => (categories[0] && CATEGORY_STYLE[categories[0]] ? categories[0] : "Other");

/** "Accepting testers" (green, pulsing), "Not accepting testers" (grey), "Stopped", or a draft. */
export function StatusPill({ status }: { status: string }) {
  if (status === "stopped") return <span className="badge border-sky-300/40 text-sky-200"><span className="h-2 w-2 rounded-sm bg-sky-300" /> Stopped</span>;
  if (status === "draft") return <span className="badge"><span className="h-2 w-2 rounded-full bg-slate-500" /> Draft</span>;
  return status === "open" ? (
    <span className="badge border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      Accepting testers
    </span>
  ) : (
    <span className="badge">
      <span className="h-2 w-2 rounded-full bg-slate-500" /> Not accepting testers
    </span>
  );
}

/** One circle per spot: a tester's initial (linking to their profile), or a dashed empty seat. */
export function Seats({ total, people }: { total: number; people: { id: string; name: string }[] }) {
  const shown = Math.min(total, 12);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: shown }, (_, i) => {
        const p = people[i];
        return p ? (
          <Link key={p.id} href={`/app/testers/${p.id}`} title={p.name} aria-label={`${p.name}: profile`}
            className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950 no-underline ring-2 ring-slate-950 hover:no-underline hover:ring-sky-300">
            {p.name.trim().charAt(0).toUpperCase()}
          </Link>
        ) : (
          <span key={i} className="h-9 w-9 rounded-full border-2 border-dashed border-slate-600" />
        );
      })}
      {total > shown && <span className="text-sm text-slate-400">+{total - shown} more</span>}
    </div>
  );
}

/** Stacked bar: accepted (solid) and waiting for review (lighter) out of `total`. */
export function FeedbackBar({ accepted, waiting, total }: { accepted: number; waiting: number; total: number }) {
  const pct = (n: number) => `${total ? Math.min(100, (n / total) * 100) : 0}%`;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="flex h-full">
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: pct(accepted) }} />
        <div className="bg-amber-400/70" style={{ width: pct(waiting) }} />
      </div>
    </div>
  );
}

export function daysLeft(deadline: Date | null): string | null {
  if (!deadline) return null;
  const days = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Deadline passed";
  if (days === 0) return "Due today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** Clickable filter chips ("All", then one per category with a count); each is a link that sets ?category=… */
export function CategoryChips({ basePath, params, counts, total }: { basePath: string; params: Record<string, string | undefined>; counts: Record<string, number>; total: number }) {
  const href = (category?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "category") q.set(k, v);
    if (category) q.set("category", category);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const active = params.category;
  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition no-underline hover:no-underline ${on ? "border-indigo-400/60 bg-indigo-500/15 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={href()} className={chip(!active)}>All <span className="text-slate-500">{total}</span></Link>
      {Object.entries(counts).filter(([, n]) => n > 0).map(([category, n]) => (
        <Link key={category} href={href(active === category ? undefined : category)} aria-current={active === category ? "true" : undefined} className={chip(active === category)}>
          <CategoryIcon category={category} className="h-3.5 w-3.5" /> {category} <span className="text-slate-500">{n}</span>
        </Link>
      ))}
    </div>
  );
}

export type { ReactNode };
