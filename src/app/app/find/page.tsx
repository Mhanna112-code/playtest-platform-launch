import Link from "next/link";
import { Languages, Monitor, SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { CategoryBadges } from "@/components/Category";
import { CategoryChips, CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { displayName, fmtDate, money } from "@/lib/format";
import { DEVICES } from "@/lib/options";
import { ratingSummary } from "@/lib/server/ratings";
import { byMostTimeToFinish, perTesterLine, termsLine, testerDaysOf, testerShare } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, findTests, needsLines } from "@/lib/server/tests";
import { exactFirst } from "@/lib/nameSearch";
import { isAdmin } from "@/lib/server/session";
import { adminFindTests, ADMIN_FIND_LIMIT } from "@/lib/server/findSearch";
import { findQuery, noFindMatchLine, statesFrom, type TestState } from "@/lib/findSearch";
import { FindSearch, StateTicks } from "./FindSearch";
import { otherSideNotice } from "@/components/OtherSideNotice";
import { ScrollList } from "@/components/ScrollList";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const PARTS = { written: "Written answers", recording: "Screen recording", live: "Live call" } as const;

type Sp = { category?: string; device?: string; part?: string; sort?: string; mine?: string; q?: string; states?: string };

/** (Batch 17 section 8) The state badge on an admin's card. */
const STATE_TONE: Record<TestState, string> = {
  Open: "border-emerald-400/40 text-emerald-200",
  Full: "border-amber-300/40 text-amber-200",
  "Joining closed": "border-amber-300/40 text-amber-200",
  Paused: "border-sky-300/40 text-sky-200",
  Stopped: "border-rose-300/40 text-rose-200",
  Closed: "border-rose-300/40 text-rose-200",
  Draft: "border-white/20 text-slate-300",
  "Invite only": "border-indigo-400/40 text-indigo-200",
};

/** The cheapest fixed part (what the tester gets), else the live rate: the big "from $8.00" figure on a card. */
function fromText(t: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }) {
  const fixed = [t.writtenCents, t.recordingCents].filter((c): c is number => c != null);
  if (fixed.length) return `from ${money(testerShare(Math.min(...fixed)))}`.replace("from $0.00", "free");
  return t.liveRateCents != null ? (t.liveRateCents === 0 ? "free" : `${money(testerShare(t.liveRateCents))}/h`) : "free";
}
const topPrice = (t: { writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null }) => Math.max(t.writtenCents ?? 0, t.recordingCents ?? 0, t.liveRateCents ?? 0);

export default async function FindPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const u = await requireOpenPage("/app/find"); // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  // (Owner, Oct 28, batch 17 section 8) Admins get Find tests too: every test, each card with its state, tick boxes for the states; never Join / Apply.
  const admin = isAdmin(u);
  if (!u.isTester && !admin) redirect("/app/profile");
  const sp = await searchParams;
  const typed = findQuery(sp.q);
  const ticked = admin ? statesFrom(sp.states) : [];
  const found = admin ? await adminFindTests(typed, ticked) : null;
  const [open, profile] = await Promise.all([found ? found.tests : findTests(u, typed), admin ? null : db.testerProfile.findUnique({ where: { userId: u.id } })]);
  const devRatings = new Map(await Promise.all([...new Set(open.map((t) => t.developerId))].map(async (id) => [id, (await ratingSummary(id)).line] as const)));
  // (Owner, Oct 31, batch 35 §81) "Tests you're in": every test the tester is working on, at the top, whatever the search and filters (Find lists only tests to join).
  const mineNow = admin ? [] : await db.contract.findMany({ where: { testerId: u.id, status: "working" }, orderBy: { joinedAt: "desc" }, select: { id: true, test: { select: { title: true, developer: { select: { name: true, email: true } } } } } });
  const invitedTo = admin ? new Set<string>() : new Set((await db.invite.findMany({ where: { testerId: u.id, status: "sent", testId: { in: open.map((t) => t.id) } } })).map((i) => i.testId));
  // The full app's filters: category chips, then Device / Part / Sort by / Show. "Everything" is the default (a test the
  // profile doesn't fit is listed with what it needs).
  const matchMine = !admin && sp.mine === "1";
  const counts: Record<string, number> = {};
  for (const t of open) for (const c of t.categories) counts[c] = (counts[c] ?? 0) + 1;
  const shown = open
    .filter((t) => (!sp.category || t.categories.includes(sp.category)) && (!sp.device || t.devices.length === 0 || t.devices.includes(sp.device)))
    .filter((t) => !sp.part || (sp.part === "written" ? t.writtenCents != null : sp.part === "recording" ? t.recordingCents != null : sp.part === "live" ? t.liveRateCents != null : true))
    .filter((t) => !matchMine || needsLines(t, profile).length === 0);
  if (sp.sort === "pay") shown.sort((a, b) => topPrice(b) - topPrice(a));
  // (Owner, Oct 28, batch 16 section 3) "Most time to finish": the days each new tester gets (the card's "N days per tester"), most first; ties: the later Open until
  // first (more time left to join); tests without Open until last.
  else if (sp.sort === "deadline") shown.sort(byMostTimeToFinish);
  // (Batch 20 section 9) An exact match (the test's name, its product or the developer's name) comes first.
  if (typed) shown.splice(0, shown.length, ...exactFirst(shown, typed, (t) => [t.title, t.productName ?? "", displayName(t.developer)]));
  // What the search box, the tick boxes and the chips keep from each other.
  const params: Record<string, string | undefined> = { category: sp.category, device: sp.device, part: sp.part, sort: sp.sort, mine: admin ? undefined : sp.mine, q: typed || undefined, states: admin ? sp.states : undefined };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Find tests</h1>
        <p className="text-slate-400">{admin ? "Every test, whatever its state. A card opens the test's page with the team's boxes." : "Apps, websites and games looking for feedback. You earn the amount shown as each part of your work is accepted."}</p>
      </div>

      {mineNow.length > 0 && (
        <section className="card space-y-3" data-find-mine="">
          <h2 className="font-semibold text-white">Tests you&apos;re in <span className="text-sm font-normal text-slate-400">{mineNow.length}</span></h2>
          <ScrollList size="three" className="space-y-2" label="Tests you're in">
            {mineNow.map((c) => (
              <li key={c.id}>
                <Link href={`/app/sessions/${c.id}`} className="flex items-center gap-3 rounded-lg border border-white/10 p-3 text-sm no-underline hover:no-underline" data-find-mine-row={c.id}>
                  <span className="min-w-0 flex-1 truncate text-slate-300" title={c.test.title}><b className="text-white">{c.test.title}</b> · by {displayName(c.test.developer)}</span>
                  <span className="shrink-0 text-indigo-300">Open →</span>
                </Link>
              </li>
            ))}
          </ScrollList>
        </section>
      )}

      {/* (Batch 17 section 8) The search box at the top; it works together with the chips and the filters (the search runs on the server). */}
      <FindSearch params={params} />
      {admin && <StateTicks params={params} ticked={ticked} />}

      <CategoryChips basePath="/app/find" params={params} counts={counts} total={open.length} />

      <form className="card flex flex-wrap items-end gap-3 p-4">
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        {typed && <input type="hidden" name="q" value={typed} />}
        {admin && sp.states && <input type="hidden" name="states" value={sp.states} />}
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
        {!admin && (
          <div>
            <label className="label" htmlFor="mine">Show</label>
            <select className="input w-52" id="mine" name="mine" defaultValue={matchMine ? "1" : "0"}>
              <option value="1">Matching my profile</option>
              <option value="0">Everything</option>
            </select>
          </div>
        )}
        <button className="btn">Apply</button>
      </form>

      {found?.more && <p className="text-xs text-slate-500" data-find-cap="">Showing the newest {ADMIN_FIND_LIMIT} tests: search to narrow.</p>}
      {shown.length === 0 && typed ? (
        <p className="card text-sm text-slate-400" data-find-none="">{noFindMatchLine(typed, admin)}</p>
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <SearchX className="h-10 w-10 text-slate-600" />
          <p className="font-medium text-slate-300">{admin ? "No tests match these ticks" : "No open tests match right now"}</p>
          {!admin && (
            <p className="text-sm text-slate-500">
              {matchMine ? <>Try <Link href="/app/find?mine=0">showing everything</Link>, or </> : "Try "}
              <Link href="/app/profile">adding more devices and languages</Link>.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((t) => {
            const gaps = admin ? [] : needsLines(t, profile);
            const left = t.spots - t._count.contracts;
            const state = "state" in t ? t.state : null;
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
                        <p className="text-xs text-slate-500">{admin ? `${Math.max(0, left)} of ${t.spots} spots open` : `${plural(left, "spot")} open to you`}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {state && <span className={`badge ${STATE_TONE[state]}`} data-test-state={state}>{state}</span>}
                      <CategoryBadges categories={t.categories} />
                      <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                      {t.devices.length > 0 && <span className="badge" title={t.devices.join(" · ")}><Monitor className="h-3.5 w-3.5" /> {t.devices.slice(0, 3).join(" · ")}{t.devices.length > 3 ? ` +${t.devices.length - 3} more` : ""}</span>}
                      {t.languages.length > 0 && <span className="badge" title={t.languages.join(" · ")}><Languages className="h-3.5 w-3.5" /> {t.languages.slice(0, 3).join(" · ")}{t.languages.length > 3 ? ` +${t.languages.length - 3} more` : ""}</span>}
                      {state !== "Invite only" && <span className="badge">{t.joinMode === "invite" ? "Invitation only" : t.joinMode === "apply" ? "Approved only" : "Anyone can join"}</span>}
                      {/* (Batch 15 section 18) "14 days per tester · join by Nov 20" */}
                      {t.openUntil && <span className="badge" data-per-tester="">{perTesterLine(t.testerDays ?? testerDaysOf(t.createdAt, t.openUntil), t.openUntil, (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))}</span>}
                      {t.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
                      {t.ndaText && <span className="badge">NDA</span>}
                      {invitedTo.has(t.id) && <span className="badge border-emerald-400/40 text-emerald-200">Invited</span>}
                    </div>
                    {admin && <p className="text-xs text-slate-500">Posted {fmtDate(t.createdAt)}</p>}
                    {"contracts" in t && t.contracts.some((c) => c.status === "left") && <p className="note">You left this test</p>}
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
