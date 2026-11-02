import type { ReactNode } from "react";
import { ScrollList } from "@/components/ScrollList";

/** §106: the same Needs you presentation, whether the developer is restricted or active. */
export function DashboardActionBox({ id, title, count, kind, children }: { id: string; title: string; count: number; kind: "bank" | "disputes" | "excerpts"; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="card space-y-3" id={id} aria-label={title} data-bank-top={kind === "bank" ? "" : undefined} data-dispute-box={kind === "disputes" ? "" : undefined} data-excerpt-box={kind === "excerpts" ? "" : undefined}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <span className="h-2 w-2 rounded-full bg-amber-400" /> {title} <span className="text-sm font-normal text-slate-400">{count}</span>
      </h2>
      <ScrollList className="space-y-2" label={title}>{children}</ScrollList>
    </section>
  );
}
