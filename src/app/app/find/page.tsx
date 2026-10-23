import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { ratingSummary } from "@/lib/server/ratings";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, findTests, needsGap } from "@/lib/server/tests";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

export default async function FindPage() {
  const u = await requirePageUser();
  if (!u.isTester) redirect("/app/profile");
  const [tests, profile] = await Promise.all([findTests(u), db.testerProfile.findUnique({ where: { userId: u.id } })]);
  const devRatings = new Map(await Promise.all([...new Set(tests.map((t) => t.developerId))].map(async (id) => [id, (await ratingSummary(id)).line] as const)));
  return (
    <>
      <h1>Find tests</h1>
      <p className="note">Prices show what you get (after the platform fee).</p>
      {tests.length === 0 && <p className="note">No open tests right now. Check back soon.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {tests.map((t) => {
          const gap = needsGap(t, profile);
          return (
            <Link key={t.id} href={`/app/find/${t.id}`} className="panel block text-slate-900 no-underline hover:border-indigo-300 hover:no-underline">
              <h3>{t.title}</h3>
              <p className="note">by {displayName(t.developer)}{devRatings.get(t.developerId) && ` · ${devRatings.get(t.developerId)}`}{t.category && ` · ${t.category}`}</p>
              <p className="text-sm">{termsLine(asListing(t), true)}</p>
              <p className="note">{t.spots - t._count.contracts} spot{t.spots - t._count.contracts === 1 ? "" : "s"} left{t.devices.length ? ` · ${t.devices.join(", ")}` : ""}</p>
              {gap && <p className="text-sm text-amber-700">{gap}</p>}
            </Link>
          );
        })}
      </div>
    </>
  );
}
