import { FindTestCard } from "@/components/FindTestCard";

import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateIn } from "@/lib/format";
import { discoveryV } from "@/lib/server/pageFreshness";
import { AutoRefresh } from "@/components/AutoRefresh";
import { fmtIn } from "@/lib/tz";
import Link from "next/link";

import { SearchX } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";


import { displayName } from "@/lib/server/dateFormat";
import { ratingSummary } from "@/lib/server/ratings";
import { byMostTimeToFinish, perTesterLine, termsLine, testerDaysOf } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, findTests, joinedContract, needsLines } from "@/lib/server/tests";
import { exactFirst } from "@/lib/nameSearch";
import { isAdmin } from "@/lib/server/session";
import { adminFindTests, ADMIN_FIND_LIMIT } from "@/lib/server/findSearch";
import { findQuery, noFindMatchLine, statesFrom } from "@/lib/findSearch";
import { FindSearch, StateTicks } from "./FindSearch";
import { CategoryTicks, FindFilters } from "./FindFilters";
import { filtersHidLine, findEmpty, findHref, oneOf, passesTicks, profileHidLine, profileTicks, ticksFrom, type FindLink, type FindSp } from "@/lib/findFilters";
import { otherSideNotice } from "@/components/OtherSideNotice";

export const metadata = { title: "Find tests · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** (Batch 17 section 8) The state badge on an admin's card. */
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
              <li key={t.id} className="min-w-0"><FindTestCard test={t} href={mine?`/app/sessions/${mine.id}`:`/app/find/${t.id}`} developerName={displayName(t.developer)} previousName={"previousName" in t && typeof t.previousName==="string"?t.previousName:undefined} rating={devRatings.get(t.developerId)} terms={termsLine(asListing(t),true)} state={state??undefined} joined={!!mine} invited={invitedTo.has(t.id)} spots={mine?undefined:admin?`${Math.max(0,left)} of ${t.spots} spots open`:`${plural(left,"spot")} open to you`} gaps={gaps} days={t.openUntil?perTesterLine(t.testerDays??testerDaysOf(t.createdAt,t.openUntil,t.developer.timeZone),t.openUntil,d=>fmtIn(t.developer.timeZone,d,"date")):undefined} footer={<>{admin&&<p className="text-xs text-slate-500">Posted {fmtDate(t.createdAt)}</p>}{!mine&&"contracts" in t&&t.contracts.some(c=>c.status==="left")&&<p className="note">You left this test</p>}</>}/></li>
            );
          })}
        </ul>
      )}
    </div>
  );

  });
}
