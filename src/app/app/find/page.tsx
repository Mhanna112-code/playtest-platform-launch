import Link from "next/link";
import { Languages, Monitor, SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { CategoryBadges } from "@/components/Category";
import { CategoryChips, CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { displayName, fmtDate, money } from "@/lib/format";
import { DEVICES } from "@/lib/options";
import { ratingSummary } from "@/lib/server/ratings";
import { perTesterLine, termsLine, testerDaysOf, testerShare } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, findTests, needsLines } from "@/lib/server/tests";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const PARTS = { written: "Written answers", recording: "Screen recording", live: "Live call" } as const;

type Sp = { category?: string; device?: string; part?: string; sort?: string; mine?: string };

/** The cheapest fixed part (what the tester gets), else the live rate: the big "from $8.00" figure on a card. */
function fromText(t: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }) {
  const fixed = [t.writtenCents, t.recordingCents].filter((c): c is number => c != null);
  if (fixed.length) return `from ${money(testerShare(Math.min(...fixed)))}`.replace("from $0.00", "free");
  return t.liveRateCents != null ? (t.liveRateCents === 0 ? "free" : `${money(testerShare(t.liveRateCents))}/h`) : "free";
}
const topPrice = (t: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }) => Math.max(t.writtenCents ?? 0, t.recordingCents ?? 0, t.liveRateCents ?? 0);

export default async function FindPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const u = await requireOpenPage("/app/find"); // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  if (!u.isTester) redirect("/app/profile");
  const sp = await searchParams;
  const [open, profile] = await Promise.all([findTests(u), db.testerProfile.findUnique({ where: { userId: u.id } })]);
  const devRatings = new Map(await Promise.all([...new Set(open.map((t) => t.developerId))].map(async (id) => [id, (await ratingSummary(id)).line] as const)));
  const invitedTo = new Set((await db.invite.findMany({ where: { testerId: u.id, status: "sent", testId: { in: open.map((t) => t.id) } } })).map((i) => i.testId));
  // The full app's filters: category chips, then Device / Part / Sort by / Show. "Everything" is the default (a test the
  // profile doesn't fit is listed with what it needs).
  const matchMine = sp.mine === "1";
  const counts: Record<string, number> = {};
  for (const t of open) for (const c of t.categories) counts[c] = (counts[c] ?? 0) + 1;
  const shown = open
    .filter((t) => (!sp.category || t.categories.includes(sp.category)) && (!sp.device || t.devices.length === 0 || t.devices.includes(sp.device)))
    .filter((t) => !sp.part || (sp.part === "written" ? t.writtenCents != null : sp.part === "recording" ? t.recordingCents != null : sp.part === "live" ? t.liveRateCents != null : true))
    .filter((t) => !matchMine || needsLines(t, profile).length === 0);
  if (sp.sort === "pay") shown.sort((a, b) => topPrice(b) - topPrice(a));
  // (Batch 12 section 6) The deadline is Open until: the latest first.
  else if (sp.sort === "deadline") shown.sort((a, b) => (b.openUntil?.getTime() ?? 0) - (a.openUntil?.getTime() ?? 0));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Find tests</h1>
        <p className="text-slate-400">Apps, websites and games looking for feedback. You earn the amount shown as each part of your work is accepted.</p>
      </div>

      <CategoryChips basePath="/app/find" params={{ ...sp }} counts={counts} total={open.length} />

      <form className="card flex flex-wrap items-end gap-3 p-4">
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        <div>
          <label className="label" htmlFor="device">Device</label>
          <select className="input w-44" id="device" name="device" defaultValue={sp.device ?? ""}>
            <option value="">Any</option>
            {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="part">Part</label>
          <select className="input w-44" id="part" name="part" defaultValue={sp.part ?? ""}>
            <option value="">Any</option>
            {Object.entries(PARTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sort">Sort by</label>
          <select className="input w-40" id="sort" name="sort" defaultValue={sp.sort ?? ""}>
            <option value="">Newest</option>
            <option value="pay">Highest pay</option>
            <option value="deadline">Most time to finish</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="mine">Show</label>
          <select className="input w-52" id="mine" name="mine" defaultValue={matchMine ? "1" : "0"}>
            <option value="1">Matching my profile</option>
            <option value="0">Everything</option>
          </select>
        </div>
        <button className="btn">Apply</button>
      </form>

      {shown.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <SearchX className="h-10 w-10 text-slate-600" />
          <p className="font-medium text-slate-300">No open tests match right now</p>
          <p className="text-sm text-slate-500">
            {matchMine ? <>Try <Link href="/app/find?mine=0">showing everything</Link>, or </> : "Try "}
            <Link href="/app/profile">adding more devices and languages</Link>.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((t) => {
            const gaps = needsLines(t, profile);
            const left = t.spots - t._count.contracts;
            return (
              <li key={t.id}>
                <Link href={`/app/find/${t.id}`} className="card card-hover flex h-full gap-4 text-ink-100 no-underline hover:no-underline">
                  <CategoryTile category={mainCategory(t.categories)} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {t.productName && <p className="kicker">{t.productName}</p>}
                        <p className="truncate font-semibold text-white" title={t.title}>{t.title}</p>
                        <p className="truncate text-sm text-slate-400">by {displayName(t.developer)}{devRatings.get(t.developerId) && ` · ${devRatings.get(t.developerId)}`}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-emerald-300">{fromText(t)}</p>
                        <p className="text-xs text-slate-400">{termsLine(asListing(t), true)}</p>
                        <p className="text-xs text-slate-500">{plural(left, "spot")} open to you</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CategoryBadges categories={t.categories} />
                      <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                      {t.devices.length > 0 && <span className="badge" title={t.devices.join(" · ")}><Monitor className="h-3.5 w-3.5" /> {t.devices.slice(0, 3).join(" · ")}{t.devices.length > 3 ? ` +${t.devices.length - 3} more` : ""}</span>}
                      {t.languages.length > 0 && <span className="badge" title={t.languages.join(" · ")}><Languages className="h-3.5 w-3.5" /> {t.languages.slice(0, 3).join(" · ")}{t.languages.length > 3 ? ` +${t.languages.length - 3} more` : ""}</span>}
                      <span className="badge">{t.joinMode === "invite" ? "Invitation only" : t.joinMode === "apply" ? "Approved only" : "Anyone can join"}</span>
                      {/* (Batch 15 section 18) "14 days per tester · join by Nov 20" */}
                      {t.openUntil && <span className="badge" data-per-tester="">{perTesterLine(t.testerDays ?? testerDaysOf(t.createdAt, t.openUntil), t.openUntil, (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))}</span>}
                      {t.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
                      {t.ndaText && <span className="badge">NDA</span>}
                      {invitedTo.has(t.id) && <span className="badge border-emerald-400/40 text-emerald-200">Invited</span>}
                    </div>
                    {t.contracts.some((c) => c.status === "left") && <p className="note">You left this test</p>}
                    {gaps.slice(0, 3).map((g) => <p key={g} className="text-sm text-amber-300" title={g}>{g}</p>)}
                    {gaps.length > 3 && <p className="text-sm text-amber-300">+{gaps.length - 3} more</p>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
