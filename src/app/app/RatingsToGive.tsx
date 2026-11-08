import { ScopedPanelSearch } from "@/components/ScopedPanelSearch";
import { withDateZone } from "@/lib/server/dateZone";
import Link from "next/link";
import { Star } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollList } from "@/components/ScrollList";
import { ratingsToGive } from "@/lib/server/ratings";
import { WholeLine } from "@/components/WholeLine";
import { cutNamesIn } from "@/lib/cutNames";

/**
 * (Owner, Oct 28, batch 17 section 17) "Ratings to give": a small box on each dashboard, in a plain scroll box (batch 16 section 14), each row opening the rating box
 * (highlighted by HashJump). It updates live (its own poll) and is hidden while the viewer's own side is suspended (or a developer is on a hold).
 */
export async function RatingsToGive({ user, side }: { user: { timeZone?: string | null; id: string; testerSuspendedAt: Date | null; devSuspendedAt: Date | null; holdStartedAt: Date | null }; side: "tester" | "developer" }) {
  const rows = await withDateZone(user.timeZone, () => ratingsToGive(user, side));
  return (
    <>
      <AutoRefresh query={`rates=${side}`} v={rows.map((r) => `${r.id}:${r.text}`).join(",")} />
      {rows.length > 0 && (
        <section className="card space-y-3" id="ratings-to-give" aria-label="Ratings to give" data-ratings-to-give="">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Star className="h-5 w-5 text-amber-300" /> Ratings to give <span className="text-sm font-normal text-slate-400">{rows.length}</span>
          </h2>
          <ScopedPanelSearch label="Ratings to give"><ScrollList className="space-y-2">
            {rows.map((r) => (
              // (Owner, Nov 5, §238) The names cut at 20 with "…" and the arrow (WholeLine), no hover: the row opens through a link laid over it, and the
              // line's "…" and arrow sit above that link.
              <li key={r.id} data-panel-search={r.text} className="relative flex items-center gap-3 rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/5" data-rate-row="">
                <Link href={r.href} aria-label={r.text} className="absolute inset-0 rounded-lg no-underline hover:no-underline" />
                <div className="min-w-0 flex-1 text-slate-200 [overflow-wrap:anywhere] [&_[data-whole-line]]:relative [&_[data-whole-line]]:z-10 [&_button]:relative [&_button]:z-10" data-rate-line="">{(() => { const x = cutNamesIn(r.text, r.names); return <WholeLine shown={x.shown} full={x.full} />; })()}</div>
              </li>
            ))}
          </ScrollList></ScopedPanelSearch>
        </section>
      )}
    </>
  );
}
