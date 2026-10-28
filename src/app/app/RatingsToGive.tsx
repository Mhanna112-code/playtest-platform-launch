import Link from "next/link";
import { Star } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollList } from "@/components/ScrollList";
import { ratingsToGive } from "@/lib/server/ratings";

/**
 * (Owner, Oct 28, batch 17 section 17) "Ratings to give": a small box on each dashboard, in a plain scroll box (batch 16 section 14), each row opening the rating box
 * (highlighted by HashJump). It updates live (its own poll) and is hidden while the viewer's own side is suspended (or a developer is on a hold).
 */
export async function RatingsToGive({ user, side }: { user: { id: string; testerSuspendedAt: Date | null; devSuspendedAt: Date | null; holdStartedAt: Date | null }; side: "tester" | "developer" }) {
  const rows = await ratingsToGive(user, side);
  return (
    <>
      <AutoRefresh query={`rates=${side}`} v={rows.map((r) => `${r.id}:${r.text}`).join(",")} />
      {rows.length > 0 && (
        <section className="space-y-3" id="ratings-to-give" aria-label="Ratings to give" data-ratings-to-give="">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Star className="h-5 w-5 text-amber-300" /> Ratings to give <span className="text-sm font-normal text-slate-400">{rows.length}</span>
          </h2>
          <ScrollList className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={r.href} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline" data-rate-row="">
                  <span className="min-w-0 flex-1 truncate text-slate-200" title={r.text}>{r.text}</span>
                </Link>
              </li>
            ))}
          </ScrollList>
        </section>
      )}
    </>
  );
}
