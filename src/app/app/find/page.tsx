import Link from "next/link";
import { CalendarClock, SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { CategoryBadges } from "@/components/Category";
import { displayName } from "@/lib/format";
import { ratingSummary } from "@/lib/server/ratings";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, findTests, needsLines } from "@/lib/server/tests";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

export default async function FindPage() {
  const u = await requirePageUser();
  if (!u.isTester) redirect("/app/profile");
  const [tests, profile] = await Promise.all([findTests(u), db.testerProfile.findUnique({ where: { userId: u.id } })]);
  const devRatings = new Map(await Promise.all([...new Set(tests.map((t) => t.developerId))].map(async (id) => [id, (await ratingSummary(id)).line] as const)));
  // The full app's Find page: the heading and intro, then the tests as cards (badges for devices and the deadline).
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Find tests</h1>
        <p className="text-ink-400">Apps, websites and games looking for feedback. Prices show what you get (after the platform fee).</p>
      </div>
      {tests.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <SearchX className="h-10 w-10 text-ink-600" />
          <p className="font-medium text-ink-300">No open tests right now</p>
          <p className="text-sm text-ink-500">Check back soon, or <Link href="/app/profile">add more devices and languages</Link>.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tests.map((t) => {
            const gaps = needsLines(t, profile);
            const left = t.spots - t._count.contracts;
            return (
              <li key={t.id}>
                <Link href={`/app/find/${t.id}`} className="card card-hover block h-full space-y-2 text-ink-100 no-underline hover:no-underline">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{t.title}</p>
                      <p className="text-sm text-ink-400">by {displayName(t.developer)}{devRatings.get(t.developerId) && ` · ${devRatings.get(t.developerId)}`}</p>
                    </div>
                    <p className="text-right text-xs text-ink-500">{left} spot{left === 1 ? "" : "s"} open</p>
                  </div>
                  <p className="text-sm text-emerald-300">{termsLine(asListing(t), true)}</p>
                  <div className="flex flex-wrap gap-2">
                    <CategoryBadges categories={t.categories} />
                    {t.devices.map((d) => <span key={d} className="badge">{d}</span>)}
                    <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} days to finish</span>
                  </div>
                  {t.contracts.some((c) => c.status === "left") && <p className="note">You left this test</p>}
                  {gaps.map((g) => <p key={g} className="text-sm text-amber-300">{g}</p>)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
