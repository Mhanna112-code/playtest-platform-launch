import { Cut, TestName } from "@/components/Cut";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateIn } from "@/lib/format";
import { discoveryV } from "@/lib/server/pageFreshness";
import { AutoRefresh } from "@/components/AutoRefresh";
import { fmtIn } from "@/lib/tz";
import Link from "next/link";
import { keepAmounts } from "@/components/Amounts";
import { Languages, Monitor, SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { CategoryBadges } from "@/components/Category";
import { CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { displayName, money } from "@/lib/server/dateFormat";
import { ratingSummary } from "@/lib/server/ratings";
import { byMostTimeToFinish, perTesterLine, termsLine, testerDaysOf, testerShare } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, findTests, joinedContract, needsLines } from "@/lib/server/tests";
import { exactFirst } from "@/lib/nameSearch";
import { isAdmin } from "@/lib/server/session";
import { adminFindTests, ADMIN_FIND_LIMIT } from "@/lib/server/findSearch";
import { findQuery, noFindMatchLine, statesFrom, type TestState } from "@/lib/findSearch";
import { FindSearch, StateTicks } from "./FindSearch";
import { CategoryTicks, FindFilters } from "./FindFilters";
import { filtersHidLine, findEmpty, findHref, oneOf, passesTicks, profileHidLine, profileTicks, ticksFrom, type FindLink, type FindSp } from "@/lib/findFilters";
import { otherSideNotice } from "@/components/OtherSideNotice";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

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

export default async function FindPage({ searchParams }: { searchParams: Promise<FindSp> }) {
  const u = await requireOpenPage("/app/find");
  return withDateZone(u.timeZone, async () => {
 // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  // (Owner, Oct 28, batch 17 section 8) Admins get Find tests too: every test, each card with its state, tick boxes for the states; never Join / Apply.
  const admin = isAdmin(u);
  if (!u.isTester && !admin) redirect("/app/profile");
  const sp = await searchParams;
  const typed = findQuery(oneOf(sp.q));
  const states = admin ? oneOf(sp.states) : undefined;
  const ticked = admin ? statesFrom(states) : [];
  const freshV = await discoveryV(u, typed, ticked);
  const found = admin ? await adminFindTests(typed, ticked) : null;
  const [open, profile] = await Promise.all([found ? found.tests : findTests(u, typed), admin ? null : db.testerProfile.findUnique({ where: { userId: u.id } })]);
  const devRatings = new Map(await Promise.all([...new Set(open.map((t) => t.developerId))].map(async (id) => [id, (await ratingSummary(id, "developer")).line] as const))); // (Owner, Nov 5, §276) ratings they got as a developer only
  const invitedTo = admin ? new Set<string>() : new Set((await db.invite.findMany({ where: { testerId: u.id, status: "sent", testId: { in: open.map((t) => t.id) } } })).map((i) => i.testId));
  // (Owner, Nov 3, batch 35 §144) Tick-box filters: every ticked category (AND); one of the ticked devices, languages, parts (OR within a group);
  // the groups together (AND). "Everything" is the default; "Matching my profile" (mine=1) ticks the profile's devices and languages. Old links
  // with one category= or device= still work.
  const matchMine = !admin && oneOf(sp.mine) === "1";
  const ticks = ticksFrom(sp, matchMine, profile);
  const sort = oneOf(sp.sort);
  const counts: Record<string, number> = {};
  for (const t of open) for (const c of t.categories) counts[c] = (counts[c] ?? 0) + 1;
  const shown = open.filter((t) => passesTicks(t, ticks));
  if (sort === "pay") shown.sort((a, b) => topPrice(b) - topPrice(a));
  // (Owner, Oct 28, batch 16 section 3) "Most time to finish": the days each new tester gets (the card's "N days per tester"), most first; ties: the later Open until
  // first (more time left to join); tests without Open until last.
  else if (sort === "deadline") shown.sort(byMostTimeToFinish);
  // (Batch 20 section 9) An exact match (the test's name, its product or the developer's name) comes first.
  if (typed) shown.splice(0, shown.length, ...exactFirst(shown, typed, (t) => [t.title, t.productName ?? "", displayName(t.developer), ...("previousName" in t && typeof t.previousName === "string" ? [t.previousName] : [])]));
  // What the search box, the tick boxes and the chips keep from each other.
  const params: FindLink = { ...ticks, sort, mine: matchMine, q: typed || undefined, states };
  // (Owner, Nov 3) Why the list is empty: nothing open, the ticks, or Matching my profile alone (its N tests are one "Show them" away).
  const empty = !admin && shown.length === 0 ? findEmpty(open, ticks, matchMine) : null;
  return (
    <div className="space-y-6">
      <AutoRefresh query={`fresh=discovery&q=${encodeURIComponent(typed)}&states=${encodeURIComponent(oneOf(sp.states) ?? "")}`} v={freshV} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Find tests</h1>
        <p className="text-slate-400">{admin ? "Every test, whatever its state. A card opens the test's page with the team's boxes." : "Apps, websites and games looking for feedback. You earn the amount shown as each part of your work is accepted."}</p>
      </div>

      {/* (Batch 17 section 8) The search box at the top; it works together with the chips and the filters (the search runs on the server). */}
      <FindSearch params={params} />
      {admin && <StateTicks params={params} ticked={ticked} />}

      <CategoryTicks params={params} counts={counts} total={open.length} />
      {/* A new set of ticks from a link (Clear filters, Show them, a chip) starts the form afresh; typing in the search box doesn't. */}
      <FindFilters key={findHref({ ...params, q: undefined })} params={params} profile={admin ? null : profileTicks(profile)} />

      {found?.more && <p className="text-xs text-slate-500" data-find-cap="">Showing the newest {ADMIN_FIND_LIMIT} tests: search to narrow.</p>}
      {shown.length === 0 && typed && (admin || open.length === 0) ? (
        <p className="card text-sm text-slate-400" data-find-none="">{noFindMatchLine(typed, admin)}</p>
      ) : shown.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center" data-find-empty={empty?.kind ?? "admin"}>
          <SearchX className="h-10 w-10 text-slate-600" />
          {/* (Owner, Nov 3) The profile never hides tests by itself (it only orders them): each empty state says what did, and the one way back. */}
          {!empty ? (
            <p className="font-medium text-slate-300">No tests match these ticks</p>
          ) : empty.kind === "nothing" ? (
            <>
              <p className="font-medium text-slate-300">No open tests right now</p>
              <p className="text-sm text-slate-500">New tests show up here as soon as developers post them.</p>
            </>
          ) : empty.kind === "profile" ? (
            <>
              <p className="font-medium text-slate-300">No open tests match your profile</p>
              <p className="text-sm text-slate-500">{profileHidLine(empty.n)}</p>
              <Link href={findHref({ ...params, devices: [], languages: [], mine: false })} data-find-show-all="">Show them</Link>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-300">No open tests match your filters</p>
              <p className="text-sm text-slate-500">{filtersHidLine(empty.n)}</p>
              <Link href={findHref({ sort, q: typed || undefined })} data-find-clear="">Clear filters</Link>
            </>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((t) => {
            // (Owner, Nov 6, §279) A test they're working in: tagged "Joined", no spots / needs lines, and the card opens their session (never the join page).
            const mine = admin || !("contracts" in t) ? null : joinedContract(t);
            const gaps = admin || mine ? [] : needsLines(t, profile);
            const left = t.spots - t._count.contracts;
            const state = "state" in t ? t.state : null;
            return (
              // (Owner, Nov 3, long text) min-w-0: a long title is cut with "…" inside the card instead of widening the grid past the screen.
              <li key={t.id} className="min-w-0">
                <Link href={mine ? `/app/sessions/${mine.id}` : `/app/find/${t.id}`} data-find-card={mine ? "joined" : undefined} className="card card-hover flex h-full gap-4 text-ink-100 no-underline hover:no-underline">
                  <CategoryTile category={mainCategory(t.categories)} />
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* (Owner, Nov 3, long text) The pay never shrinks or splits: beside the title when there is room (at most half the card), under it on a
                        phone. The title keeps at least 10rem and is cut with "…". */}
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-[min(100%,10rem)] flex-1">
                        {t.productName && <p className="kicker"><Cut text={t.productName} kind="product" /></p>}
                        <p className="font-semibold"><TestName text={t.title} /></p>
                          <p className="text-sm text-slate-400 [overflow-wrap:anywhere]">by <Cut text={displayName(t.developer)} />{"previousName" in t && typeof t.previousName === "string" && <span> · previously {t.previousName}</span>}{devRatings.get(t.developerId) && ` · ${devRatings.get(t.developerId)}`}</p>
                      </div>
                      <div className="ml-auto max-w-full shrink-0 text-right sm:max-w-[50%]">
                        <p className="whitespace-nowrap text-lg font-bold text-emerald-300">{fromText(t)}</p>
                        <p className="text-xs text-slate-400">{keepAmounts(termsLine(asListing(t), true))}</p>
                        {!mine && <p className="text-xs text-slate-500">{admin ? `${Math.max(0, left)} of ${t.spots} spots open` : `${plural(left, "spot")} open to you`}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {state && <span className={`badge ${STATE_TONE[state]}`} data-test-state={state}>{state}</span>}
                      {mine && <span className="badge border-emerald-400/40 text-emerald-200" data-find-joined="">Joined</span>}
                      <CategoryBadges categories={t.categories} />
                      <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                      {t.devices.length > 0 && <span className="badge" title={t.devices.join(" · ")}><Monitor className="h-3.5 w-3.5" /> {t.devices.slice(0, 3).join(" · ")}{t.devices.length > 3 ? ` +${t.devices.length - 3} more` : ""}</span>}
                      {t.languages.length > 0 && <span className="badge" title={t.languages.join(" · ")}><Languages className="h-3.5 w-3.5" /> {t.languages.slice(0, 3).join(" · ")}{t.languages.length > 3 ? ` +${t.languages.length - 3} more` : ""}</span>}
                      {state !== "Invite only" && <span className="badge">{t.joinMode === "invite" ? "Invitation only" : t.joinMode === "apply" ? "Approved only" : "Anyone can join"}</span>}
                      {/* (Batch 15 section 18) "14 days per tester · join by Nov 20" */}
                      {t.openUntil && <span className="badge" data-per-tester="">{perTesterLine(t.testerDays ?? testerDaysOf(t.createdAt, t.openUntil, t.developer.timeZone), t.openUntil, (d) => fmtIn(t.developer.timeZone, d, "date"))}</span>}
                      {t.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
                      {t.ndaText && <span className="badge">NDA</span>}
                      {invitedTo.has(t.id) && <span className="badge border-emerald-400/40 text-emerald-200">Invited</span>}
                    </div>
                    {admin && <p className="text-xs text-slate-500">Posted {fmtDate(t.createdAt)}</p>}
                    {!mine && "contracts" in t && t.contracts.some((c) => c.status === "left") && <p className="note">You left this test</p>}
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

  });
}
