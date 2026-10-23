import { BarChart3, CheckCircle2, Star, Timer } from "lucide-react";
import { StatTile } from "@/components/StatTile";
import { DEV_FOOTNOTE, TESTER_FOOTNOTE, developerStats, ratingTile, testerStats } from "@/lib/server/profileStats";
import { capacityCard } from "@/lib/capacity";
import { testerCapacity } from "@/lib/server/capacity";

/** A developer's tiles (their profile as testers see it, and their dashboard): the full app's three, plus the rating. */
export async function DeveloperTiles({ userId }: { userId: string }) {
  const [s, r] = await Promise.all([developerStats(userId), ratingTile(userId)]);
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="How this developer reviews">
        <StatTile icon={BarChart3} label="Reports reviewed" value={s.reviewed.value} hint={s.reviewed.hint} tone="indigo" />
        <StatTile icon={CheckCircle2} label="Pays on average" value={s.pays.value} hint={s.pays.hint} tone="emerald" />
        <StatTile icon={Timer} label="Typical review" value={s.review.value} hint={s.review.hint} tone="amber" />
        <StatTile icon={Star} label="Rating" value={r.value} hint={r.hint} tone="fuchsia" />
      </section>
      <p className="-mt-2 text-xs text-slate-500">{DEV_FOOTNOTE}</p>
    </>
  );
}

/** A tester's tiles as developers see them: Accepted parts and Rating. */
export async function TesterTiles({ userId }: { userId: string }) {
  const [s, r] = await Promise.all([testerStats(userId), ratingTile(userId)]);
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="How this tester's work went">
        <StatTile icon={CheckCircle2} label="Accepted parts" value={s.accepted.value} hint={s.accepted.hint} tone="indigo" />
        <StatTile icon={Star} label="Rating" value={r.value} hint={r.hint} tone="amber" />
      </section>
      <p className="-mt-2 text-xs text-slate-500">{TESTER_FOOTNOTE}</p>
    </>
  );
}

/** (NEWEST+9) The full app's tester-capacity card: shown ONLY to the developer (dashboard, own profile), never to testers. */
export async function CapacityCard({ userId }: { userId: string }) {
  const c = capacityCard(await testerCapacity(userId));
  return (
    <section id="tester-limit" className="card scroll-mt-24 space-y-1 text-sm" aria-label="Testers per test">
      <p className="font-semibold text-white">{c.limit}</p>
      <p className="text-slate-400">{c.next}. {c.rule}</p>
    </section>
  );
}
