import { CheckCircle2, Star, Timer } from "lucide-react";
import { StatTile } from "@/components/StatTile";
import { DEV_FOOTNOTE, DEV_FOOTNOTE_NO_PAYS, TESTER_FOOTNOTE, developerStats, ratingTile, testerStats } from "@/lib/server/profileStats";

/**
 * A developer's tiles (their profile as testers see it, and their dashboard): Typical review, Rating, and (owner, Oct 30, batch 35 §14) Pays on average ONLY on the
 * developer's own dashboard (`pays`): nothing testers see shows it (the profile, its "as testers see it" view, the join page).
 */
export async function DeveloperTiles({ userId, pays = false }: { userId: string; /** the developer's own dashboard */ pays?: boolean }) {
  const [s, r] = await Promise.all([developerStats(userId), ratingTile(userId)]);
  return (
    <>
      <section className={`grid gap-4 ${pays ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} aria-label="How this developer reviews">
        {pays && <StatTile icon={CheckCircle2} label="Pays on average" value={s.pays.value} hint={s.pays.hint} tone="emerald" />}
        <StatTile icon={Timer} label="Typical review" value={s.review.value} hint={s.review.hint} tone="amber" />
        <StatTile icon={Star} label="Rating" value={r.value} hint={r.hint} tone="fuchsia" />
      </section>
      <p className="-mt-2 text-xs text-slate-500">{pays ? DEV_FOOTNOTE : DEV_FOOTNOTE_NO_PAYS}</p>
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
