import type { ReactNode } from "react";
import { Radio } from "lucide-react";

// The full app's ONE live-session panel (components/live-panel.tsx there), the same shell on both sides: "Live session ·
// <length>", then its sections (Booked, Requests, Past calls). Lean: calls are always requests, so "Requests" takes the
// place of the full app's "Times you can book".

export const LIVE_SECTIONS = { booked: "Booked", requests: "Requests", past: "Past calls" } as const;

/** The panel: "Live session · 30 min" (the next booked call's length), a fold on the test page. */
export function LivePanel({ minutes, children, id = "live", fold = false }: { minutes: number | null; children: ReactNode; id?: string; fold?: boolean }) {
  const title = <><Radio className="h-5 w-5 text-amber-300" /> <h2 className="inline">Live session{minutes ? ` · ${minutes} min` : ""}</h2></>;
  return fold ? (
    <details id={id} className="card scroll-mt-24 space-y-4" data-live-panel="" open>
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white">{title}</summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  ) : (
    <section id={id} className="card scroll-mt-24 space-y-4" data-live-panel="">
      <div className="flex items-center gap-2 font-semibold text-white">{title}</div>
      {children}
    </section>
  );
}

/** One section of it, by name (nothing when it has nothing to show and no `empty` line). */
export function LiveSection({ title, children, empty, show = true, id }: { title: string; children?: ReactNode; empty?: string; show?: boolean; id?: string }) {
  if (!show && !empty) return null;
  return (
    <section className="space-y-1.5" data-live-section={title} id={id}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {show ? <ul className="divide-y divide-white/5">{children}</ul> : <p className="text-sm text-slate-400">{empty}</p>}
    </section>
  );
}
