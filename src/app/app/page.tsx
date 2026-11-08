import { TodoTestRow } from "@/components/TodoTestRow";
import { developerNeedsRows } from "@/lib/server/dashboardNeeds";
import { ScopedPanelSearch } from "@/components/ScopedPanelSearch";



import { FindTestCard } from "@/components/FindTestCard";
import { SearchPanel } from "@/components/SearchPanel";
import { PREVIOUS_TEST_FILTERS, previousTestGroup, developerTestGroups } from "@/lib/dashboardPanels";
import { Cut, NameLink, TestName } from "@/components/Cut";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateTimeIn } from "@/lib/format";
import { owed } from "@/lib/server/holds";
import { dashboardV } from "@/lib/server/pageFreshness";
import { DashboardActionBox } from "./DashboardActionBox";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Award, CalendarClock, CheckCircle2, Clock, Compass, FileSignature, Hourglass, Inbox, KeyRound, LayoutGrid, ListTodo, MessagesSquare, PlusCircle, Users, Wallet, AppWindow, Banknote } from "lucide-react";
import { db } from "@/lib/db";
import { compact, compactMoney, displayName, fmtDate, fmtDateTime, money, num } from "@/lib/server/dateFormat";
import { AutoRefresh } from "@/components/AutoRefresh";
import { invitesV } from "@/lib/server/pulseV";
import { RatingsToGive } from "./RatingsToGive";


import { BankToConfirm } from "./BankToConfirm";
import { LiveTop } from "@/components/LiveTop";
import { adminAway, requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";
import { sideFor } from "@/lib/sides";
import { ProfileForm } from "./profile/ProfileForm";
import { NoThanks } from "./NoThanks";
import { DeveloperTiles } from "@/components/ProfileTiles";
import { StatTile } from "@/components/StatTile";

import { CategoryChips, CategoryTile, FeedbackBar, mainCategory, PartBadges, Seats, StatusPill } from "@/components/Ui";
import { callCharge, callJoinable, canAskToRejoin, chargeAmount, termsLine, testerShare, testPaused, chargeOpensAt, chargeOpensNote } from "@/lib/rules";
import { ratingSummary } from "@/lib/server/ratings";
import { unreadCount } from "@/lib/server/messages";
import { asListing, profileSaved } from "@/lib/server/tests";
import { RestrictedBox } from "@/components/RestrictedBox";
import { ExcerptDecision } from "@/components/Excerpts";
import { pendingForDeveloper } from "@/lib/server/excerpts";
import { ExcerptQuestion, ExcerptQuote, ExcerptReplaces } from "@/components/ExcerptList";
import { devRestricted, restrictionsOf } from "@/lib/restricted";
import { PayoutBanner } from "@/components/PayoutBanner";
import { CallsBox } from "./CallsBox";
import { CallCheck } from "@/components/CallCheck";
import { JoinCall } from "@/components/JoinCall";
import { ReasonQuote } from "@/components/ScrollText";
import { DisputeSide } from "./tests/[id]/DisputeSide";
import { disputesForSide } from "@/lib/server/disputes";

import { LIST_PANEL, ScrollList } from "@/components/ScrollList";
import { Fold, ResizeBox } from "@/components/Panel";

import { YourTestsSearch } from "./YourTestsSearch";
import { TestsVisited } from "./TestsVisited";

import { answerable, rejoinAskLine } from "@/lib/server/joining";
import { pronouns } from "@/lib/format";
import { chargebackSteps } from "@/lib/server/chargeback";
import { PAUSE_CLOSE_DAYS, pauseReasons } from "@/lib/pause";
import { HOLD_APPROVAL_AFTER, REVIEW_DAYS, joiningClosedLine, testerPayable } from "@/lib/rules";
import { testTitleOf } from "@/lib/rules";
import { closeOutOf, closedOut, pieceCloseOut } from "@/lib/server/closeOut";
import { updateRoomLeft } from "@/lib/server/paidUpdates";
import { lateSentLine, pieceDay, updateWaiting } from "@/lib/moneyLines";
import { GetStarted } from "./GetStarted";



export const metadata = { title: "Home · Playtest" };
import { callMinutesOf } from "@/lib/callMeasure";

export const dynamic = "force-dynamic";

/** A card's one link, stretched over the whole card (the full app's CARD_LINK). */
const CARD_LINK = "after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-volt-300";
const plural = (n: number, w: string) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;
/** What the tester gets, without the days ("Written $8.00 · Recording $9.60"). */
const pays = (t: Parameters<typeof termsLine>[0]) => termsLine({ ...t, testerDays: null }, true); // (batch 15: termsLine adds days only when given)
const DAY = 86_400_000;

export default async function AppHome({ searchParams }: { searchParams: Promise<{ category?: string; failed?: string; done?: string }> }) {
  const u = await requirePageUser();
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
  const { category, failed, done } = await searchParams;
  // (Owner, Oct 28, batch 20 section 16) An admin account is only an admin: the setup asks only Name and Pronoun (until the name is set), then /admin is home.
  adminAway(u, "/app");
  // (Owner, Nov 3, batch 35 §134) Every other account gets its sides when it's made (email or Google sign-up), so this setup is the admin's only. An account that
  // somehow has no side chooses one in Profile, where it's required, instead of a separate Welcome screen.
  if (!isAdmin(u) && !u.isDeveloper && !u.isTester) redirect("/app/profile");
  if (isAdmin(u))
    return (
      <>
        <h1>Welcome to Playtest</h1>
        <p className="note">Tell us who you are. You can change this later in Profile.</p>
        <ProfileForm first admin={isAdmin(u)} init={{ name: u.name, pronoun: u.pronoun, isDeveloper: false, isTester: false, devices: [], categories: [], languages: [], bio: "" }} />
      </>
    );
  const now = new Date();
  await (await import("@/lib/server/workWindow")).closeWorkAfterDeadlines(new Date(), u.id);
  const side = sideFor(u, "/app");
  const freshV = await dashboardV(u);
  // (Owner, Oct 27) A suspension, a payment hold and a chargeback hold are one state for the developer's pages: ONE blue box at the very top says what happened and how to resume.
  const devOff = side === "developer" && u.isDeveloper && devRestricted(u, side);
  const testerOff = side === "tester" && u.isTester && !!u.testerSuspendedAt;
  const cbSteps = devOff && u.holdStartedAt ? await chargebackSteps(u.id) : null;
  const holdReview = !!(devOff && u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER);
  // A fourth-or-later hold waits for approval after its balance is paid; a bank check or an unresolved charge is still outstanding.
  const holdBalance = holdReview ? await Promise.all([owed(u.id), db.payment.count({ where: { developerId: u.id, status: { in: ["pending", "paying", "needs_action", "needs_confirmation"] } } })]) : null;
  const holdPaid = !!holdBalance && holdBalance[0].length === 0 && holdBalance[1] === 0;
  // (§106, revised Nov 1) The same action boxes below the name, whether restricted or active.
  const excerptBox = side === "developer" && u.isDeveloper ? await pendingForDeveloper(u.id) : [];
  // The developer's side remains optional and never stops.
  const disputeBox = side === "developer" && u.isDeveloper ? await disputesForSide(u.id) : [];
  return (
    <div className="space-y-8">
      <AutoRefresh query="fresh=dashboard" v={freshV} />
      {(devOff || testerOff) && (
        <RestrictedBox failed={failed} developer={devOff} tester={testerOff} kinds={restrictionsOf(u)} steps={cbSteps?.remaining} review={holdReview} paid={holdPaid} />
      )}
      {/* (Batch 15 section 29) After Stop or End early from a restricted test page. */}
      {done && /^Done: /.test(done) && <p className="ok rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2" role="status" data-done-line="">{done.slice(0, 300)}</p>}
      {/* (Batch 15 section 16) The side in use: its own reinstatement. */}
      {(() => {
        // (Owner, Oct 31, batch 35 §99) Gone while that side is suspended again or (developer) on a hold: "active again" would be wrong.
        const back = side === "tester" ? (!u.testerSuspendedAt ? u.testerReinstatedAt : null) : !u.devSuspendedAt && !u.holdStartedAt ? u.devReinstatedAt : null;
        return back && now.getTime() - back.getTime() < 3 * DAY ? <p className="ok rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2" role="status" data-reinstated-box="">Your {u.isDeveloper && u.isTester ? `${side === "tester" ? "tester" : "developer"} account` : "account"} is active again · {fmtDateTime(back)}</p> : null;
      })()}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Welcome back,</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{u.name || u.email}</h1>
          {side === "developer" && u.isDeveloper && <GetStarted steps={[{ label: "Add a card (needed to post a test)", done: !!u.stripePaymentMethodId }]} />}
          {/* (Owner, Nov 3, batch 35 §153) A tester or both ticks devices and languages at sign-up, so a new tester's profile is saved at once and the step is
              gone. It shows only while the profile isn't saved (an older account that never saved it, or a developer who added the tester side with Start
              testing too): Join stays gated for them, and the step goes once it's saved. */}
          {side === "tester" && u.isTester && <GetStarted steps={[...(profileSaved(await db.testerProfile.findUnique({ where: { userId: u.id } })) ? [] : [{ label: "Save your profile (needed to join a test)", done: false, href: "/app/profile" }]), { label: "Set up payouts (to receive your pay)", done: !!(u.payoutsReady && u.stripeAccountId) }]} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {side === "developer" && !devOff && <Link className="btn" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
          {side === "tester" && !u.testerSuspendedAt && <Link className="btn" href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
        </div>
      </div>
      {/* (Owner, Oct 29, batch 24 section 1) Charges the developer's bank wants confirmed: below their name, in active and restricted views (hidden when there are none). */}
      {side === "developer" && u.isDeveloper && <BankToConfirm userId={u.id} now={now} />}
      {disputeBox.length > 0 && (
        <DashboardActionBox id="dispute-sides" title="Disputes: add your side" count={disputeBox.length} kind="disputes">
            {/* (Owner, Nov 5, §253) One drop-down per person (their name, how many disputes); inside, one drop-down per dispute, as on the test page (§252): its line
                the summary, the reason right under it in its box (no drop-down of its own), then "Add your side". */}
            {[...disputeBox.reduce((m, d) => m.set(d.testerHref ?? `name:${d.name}`, [...(m.get(d.testerHref ?? `name:${d.name}`) ?? []), d]), new Map<string, typeof disputeBox>()).values()].map((ds) => (
              <li key={ds[0].id} id={`dispute-person-${ds[0].id}`} className="rounded-lg border border-white/10 p-3 text-sm" data-dispute-person="">
                <Fold id={`dispute-person-${ds[0].testerHref ?? ds[0].name}`} summary={<span><b className="text-white"><NameLink fit text={ds[0].name} href={ds[0].testerHref} /></b> · {ds.length === 1 ? "1 dispute" : `${ds.length} disputes`}</span>}>
                  <div className="space-y-2">
                    {ds.map((d) => (
                      <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-1.5 rounded-lg border border-white/10 p-2 sm:p-3" data-dispute-item="">
                        <Fold id={`dashboard-dispute-${d.id}`} summary={<span className="text-slate-300">Disputed what you paid for {d.what} on “<TestName text={d.testTitle} href={`/app/tests/${d.testId}`} />”</span>}>
                          <div className="space-y-1.5">
                            <ReasonQuote id={`dispute-reason-${d.id}`} label="Their reason" text={d.reason} />
                            <DisputeSide seenAt={now.toISOString()} testId={d.testId} disputeId={d.id} />
                          </div>
                        </Fold>
                      </div>
                    ))}
                  </div>
                </Fold>
              </li>
            ))}
        </DashboardActionBox>
      )}
      {excerptBox.length > 0 && (
        <DashboardActionBox id="excerpt-requests" title="Excerpt requests" count={excerptBox.length} kind="excerpts">
          {excerptBox.map((x) => (
            <li key={x.id} id={`excerpt-${x.id}`} className="space-y-1.5 rounded-lg border border-white/10 p-3 text-sm">
              <p className="text-slate-300"><b className="text-white"><NameLink text={x.tester} href={x.testerHref} /></b> would like to show this from “<NameLink text={x.testTitle} kind="test" href={`/app/tests/${x.testId}`} />” on {x.testerPoss} profile:</p>{/* (Owner, Nov 3) no "(names the product: …)" */}
              {x.ndaNote && <p className="note" data-excerpt-nda="">{x.ndaNote}</p>}
              {/* (Batch 16 section 37) The question it answers, above the quote. */}
              <ExcerptQuestion id={x.id} question={x.question} />
              <ExcerptQuote id={`excerpt-text-${x.id}`} text={x.text} />
              <ExcerptReplaces id={x.id} texts={x.replaces} />
              <ExcerptDecision excerptId={x.id} seenAt={now.toISOString()} />
            </li>
          ))}
        </DashboardActionBox>
      )}
      {/* (NEXT-UI 6) One side at a time: the dashboard of the side in use (the header switch changes it). */}
      {side === "developer" && <DeveloperDashboard user={u} now={now} category={category} restricted={devOff} />}
      {side === "tester" && <TesterDashboard user={u} now={now} />}
    </div>
  );

  });
}


type Viewer = Awaited<ReturnType<typeof requirePageUser>>;

// ---------------------------------------------------------------- developer (the full app's dev/page.tsx)

async function DeveloperDashboard({ user, now, category, restricted }: { user: Viewer; now: Date; category?: string; restricted: boolean }) {
  return withDateZone(user.timeZone, async () => {

  const userId = user.id;
  const allTests = await db.test.findMany({
    where: { developerId: userId },
    orderBy: { createdAt: "desc" },
    include: { contracts: { include: { tester: true, submissions: { include: { review: true, dispute: true } }, calls: { include: { review: true, dispute: true } } } }, _count: { select: { accessKeys: true } } },
  });
  const testIds = allTests.map((t) => t.id);
  const closedTests = new Map(await Promise.all(allTests.map(async t=>[t.id,closedOut(await closeOutOf(t.id,now),now)] as const)));
  // (Batch 17 §19) A piece whose Pay closed (its own closing date) has nothing left to pay: it leaves Needs review (and the count); in its last 7 days the test's row
  // says when Pay closes (the soonest such piece).
  const unpaidKeys: { submissionId?: string; callId?: string }[] = allTests.flatMap((t) => t.contracts.flatMap((c) => [...c.submissions.filter((x) => !x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((y) => y.status === "booked" && callMinutesOf(y) != null && !y.review).map((y) => ({ callId: y.id }))]));
  const payCloses = new Map(await Promise.all(unpaidKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, "developer", now)] as const)));
  const payShut = (pieceId: string) => closedOut(payCloses.get(pieceId) ?? null, now);
  const [apps, reqs, spent, unreadList, invites, owedPays, freeKeys, nextCalls] = await Promise.all([
    db.application.findMany({ where: { testId: { in: allTests.filter((t) => t.status !== "stopped").map((t) => t.id) }, status: "pending" }, orderBy: { createdAt: "desc" } }).then(answerable), // (batch 34 §16) not an invited applicant
    db.callRequest.findMany({ where: { testId: { in: testIds }, status: "pending", fromSide: "tester", startsAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
    db.payment.aggregate({ where: { developerId: userId, kind: { not: "subscription" }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }),
    Promise.all(allTests.flatMap((t) => t.contracts.map(async (c) => [c.id, await unreadCount(userId, t.id, c.testerId)] as const))),
    db.invite.groupBy({ by: ["testId"], where: { testId: { in: testIds }, status: "sent" }, _count: { _all: true } }),
    db.payment.findMany({ where: { developerId: userId, status: "failed", settledAt: null, owedUntil: { not: null } }, select: { contractId: true } }),
    db.accessKey.groupBy({ by: ["testId"], where: { testId: { in: testIds }, status: "free" }, _count: { _all: true } }),
    db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 4 * 3_600_000) }, contract: { test: { developerId: userId } } }, orderBy: { startsAt: "asc" }, include: { contract: { include: { tester: true, test: true } } } }),
  ]);
  const unread = new Map(unreadList);
  const applicants = new Map((await db.user.findMany({ where: { id: { in: apps.map((a) => a.testerId) } } })).map((x) => [x.id, x]));
  const categoryCounts: Record<string, number> = {};
  for (const t of allTests) for (const c of t.categories) categoryCounts[c] = (categoryCounts[c] ?? 0) + 1;
  const tests = category ? allTests.filter((t) => t.categories.includes(category)) : allTests;
  const contractTest = new Map(allTests.flatMap((t) => t.contracts.map((c) => [c.id, { t, c }] as const)));
  const oldOf = async (a: (typeof apps)[number]) => (a.kind === "rejoin" ? await db.contract.findUnique({ where: { testId_testerId: { testId: a.testId, testerId: a.testerId } } }) : null);
  // Each part sent and waiting for review (written answers, a recording, a held live call), a dispute waiting for the developer's side, an
  // application, a rejoin ask, a call request: every test's, newest first.
  type Item = { key: string; at: Date; href: string; who: string; /** (batch 35 §137) their profile */ whoHref?: string | null; text: React.ReactNode; cta: string };
  const items: Item[] = [];
  for (const t of allTests)
    for (const c of t.contracts) {
      const who = displayName(c.tester);
      const whoHref = c.tester.deletedAt ? null : `/app/testers/${c.testerId}`;
      const poss = pronouns(c.tester.pronoun).poss; // (batch 35 §162) "sent her recording"
      // (Owner, Oct 29, batch 11) A tester who deleted their account: their sent work still waits for review when their payout account was connected.
      if (!testerPayable(c.tester)) continue;
      for (const s of c.submissions.filter((x) => !x.review && !payShut(x.id))) items.push({ key: `s-${s.id}`, at: s.sentAt, href: `/app/tests/${t.id}#piece-${s.id}`, who, whoHref, text: <>sent {poss} {s.kind === "recording" ? "recording" : "written answers"} for <b className="text-white"><NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} /></b></>, cta: "Review" });
      // (Batch 30 §2; batch 35 §136) Something added to a piece after it was paid, while it can still be paid more: in Needs review too (it opens its row).
      for (const s of c.submissions.filter((x) => updateWaiting(x))) if (await updateRoomLeft(s.id, t.id)) items.push({ key: `s-u-${s.id}`, at: s.paidUpdateAt!, href: `/app/tests/${t.id}#update-${s.id}`, who, whoHref, text: <>added to {poss} {s.kind === "recording" ? "recording" : "written answers"} for <b className="text-white"><NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} /></b> after you paid</>, cta: "Review" });
      // (Batch 15 section 40) A call that took place, once its measured length is final: pay it.
      for (const x of c.calls.filter((y) => y.status === "booked" && callMinutesOf(y) != null && !y.review && !payShut(y.id))) items.push({ key: `c-${x.id}`, at: x.startsAt, href: `/app/tests/${t.id}#call-${x.id}`, who, whoHref, text: <>had a live call for <b className="text-white"><NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} /></b>: pay it</>, cta: "Review" });
    }
  for (const a of apps) {
    const t = allTests.find((x) => x.id === a.testId)!;
    const x = applicants.get(a.testerId);
    const name = x ? displayName(x) : "A tester";
    if (a.kind === "rejoin") {
      const old = await oldOf(a);
      items.push({ key: `a-${a.id}`, at: a.createdAt, href: `/app/tests/${t.id}#item-app-${a.id}`, who: name, whoHref: x && !x.deletedAt ? `/app/testers/${x.id}` : null, text: <>{old && x ? rejoinAskLine(name, pronouns(x.pronoun), old, user.timeZone).replace(`${name} asks`, "asks") : "asks to rejoin"} · <b className="text-white"><NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} /></b></>, cta: "Answer" });
    } else items.push({ key: `a-${a.id}`, at: a.createdAt, href: `/app/tests/${t.id}#item-app-${a.id}`, who: name, whoHref: x && !x.deletedAt ? `/app/testers/${x.id}` : null, text: <>applied to join <b className="text-white"><NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} /></b></>, cta: "Answer" });
  }
  // (§106) Excerpt requests and disputes use their own inline boxes above, in both account states.
  for (const r of reqs) {
    const x = contractTest.get(r.contractId);
    if (x) items.push({ key: `r-${r.id}`, at: r.createdAt, href: `/app/tests/${x.t.id}#req-${r.id}`, who: displayName(x.c.tester), whoHref: x.c.tester.deletedAt ? null : `/app/testers/${x.c.testerId}`, text: <>asked for a live call · <b className="text-white"><NameLink text={x.t.title} kind="test" href={`/app/tests/${x.t.id}`} /></b></>, cta: "Answer in Live session →" }); // (batch 16 section 35) opens the Call requests panel at it
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const toReview = items.filter((i) => i.key.startsWith("s-") || i.key.startsWith("c-")).length;
  // (Owner, Oct 27) Sent work and held calls waiting for Pay / Reject are in the "Needs review" box (one row per test); Needs you keeps the answers. Under a suspension or a hold
  // the pages these lead to are closed: neither box is shown.
  const reviewRows = (await developerNeedsRows(userId,testIds,now)).filter(r=>r.n>0).sort((a,b)=>b.at.getTime()-a.at.getTime());
  const testersTotal = allTests.reduce((n, t) => n + t.contracts.filter((c) => c.status === "working").length, 0);
  const invitesBy = new Map(invites.map((i) => [i.testId, i._count._all]));
  const appsBy = new Map<string, number>();
  for (const a of apps) appsBy.set(a.testId, (appsBy.get(a.testId) ?? 0) + 1);
  const keysFree = new Map(freeKeys.map((k) => [k.testId, k._count._all]));
  const owedTests = new Set(owedPays.map((p) => contractTest.get(p.contractId ?? "")?.t.id).filter(Boolean));
  // (Owner, Oct 27) The Calls box: every booked call that has not ended, soonest first. Join shows only while the call can be joined; the row links to the call on the test page, or (when the
  // test pages are closed) has Cancel itself.
  const calls = nextCalls.filter((c) => c.startsAt > now || callJoinable(c, now)).map((c) => ({ id: c.id, testId: c.contract.testId, test: c.contract.test.title, who: displayName(c.contract.tester), when: c.startsAt.toISOString(), minutes: c.minutes, needsReason: c.startsAt.getTime() - now.getTime() < 24 * 3_600_000, joinable: !restricted && callJoinable(c, now) }));
  const seenAt = now.toISOString();
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Your numbers">
        <StatTile icon={Inbox} label="Parts to review" value={compact(toReview)} hint="written answers, recordings, calls" tone="amber" />
        <StatTile icon={Users} label="Testers joined" value={compact(testersTotal)} hint={`across ${plural(allTests.length, "test")}`} tone="indigo" />
        <StatTile icon={Wallet} label="Spent so far" value={compactMoney(spent._sum.amountCents ?? 0)} hint="accepting work" tone="emerald" />
      </section>
      <DeveloperTiles userId={userId} pays />

      {/* (Batch 17 section 17) Every rating the developer can give now (hidden while suspended or on a hold). */}
      <RatingsToGive user={user} side="developer" />

      {reviewRows.length>0&&<SearchPanel id="needs-you" title="Needs you" placeholder="Search Needs you by test" items={reviewRows.map(r=>({key:r.id,search:r.title,node:<Link href={`/app/tests/${r.id}#needs-you`} className="flex items-center gap-3 rounded-lg border border-white/10 p-3 no-underline hover:bg-white/5"><span className="min-w-0 flex-1 font-bold"><TestName text={r.title}/></span><span>Review →</span></Link>}))}/>}

      <CallsBox calls={calls} seenAt={seenAt} restricted={restricted} />

      <section className="space-y-3" id="your-tests">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><LayoutGrid className="h-5 w-5 text-volt-300" /> Your tests</h2>
          {Object.keys(categoryCounts).length > 1 && <CategoryChips basePath="/app" params={{ category }} counts={categoryCounts} total={allTests.length} />}
        </div>
        {allTests.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-12 text-center">
            <AppWindow className="h-12 w-12 text-slate-600" />
            <p className="font-medium text-slate-300">No tests yet</p>
            <p className="max-w-sm text-sm text-slate-500">Post your app, site or game and choose how you want feedback.</p>
            {!restricted && <Link href="/app/tests/new" className="btn mt-2"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
          </div>
        ) : (
          // (Batch 16 section 14) Every test card, in a scroll box about 2 card rows tall (one column of about 3 on phones); the chips stay above it.
          // (Owner, Nov 5, §204) A search box above the cards: test name or product name, any part, any case, over every card (YourTestsSearch draws the box).
          <YourTestsSearch items={tests.map((t) => {
              const inIt = t.contracts.filter((c) => c.status === "working");
              const accepted = t.contracts.filter((c) => c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const waiting = t.contracts.filter((c) => c.submissions.some((s) => !s.review) && !c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const messages = t.contracts.reduce((n, c) => n + (unread.get(c.id) ?? 0), 0);
              const paused = !!(user.holdStartedAt || user.devSuspendedAt || t.adminPausedAt);
              // (Batch 9) Every reason: "Paused: payment hold · paused by the team".
              const why = pauseReasons(user, t);
              const nInvited = invitesBy.get(t.id) ?? 0, nApps = appsBy.get(t.id) ?? 0;
              // (Owner, Nov 3, batch 35 §168) A Next round's draft not named yet: "Untitled draft (round 2)".
              const title = <span className="text-lg font-semibold" {...(t.title.trim() ? {} : { "data-untitled-draft": "" })}><TestName text={testTitleOf(t)} /></span>;
              return {
                key: t.id, title: testTitleOf(t), product: t.productName, states: developerTestGroups(t, paused, closedTests.get(t.id)??false), node: (
                <>
                  {/* The whole card opens the test (its title's link stretches over it); a suspended developer's cards don't open. */}
                  <div className="card card-hover relative block h-full space-y-4" data-test-card={t.status === "stopped" ? "stopped" : paused ? "paused" : t.status}>
                    <div className="flex items-start gap-3">
                      <CategoryTile category={mainCategory(t.categories)} />
                      <div className="min-w-0 space-y-2">
                        {t.productName && <p className="kicker"><Cut text={t.productName} kind="product" /></p>}
                        {/* Under a suspension or a hold the test pages are closed: the card doesn't open. */}
                        {/* (Batch 15 section 29) A restricted developer's cards open the test's restricted view (a draft still doesn't open). */}
                        <p>{restricted && t.status === "draft" ? title : <Link href={t.status === "draft" ? `/app/tests/new?draft=${t.id}` : `/app/tests/${t.id}`} className={`${CARD_LINK} no-underline hover:no-underline`}>{title}</Link>}</p> {/* (Owner, Oct 28 evening) a draft opens in Post a test */}
                        <div className="flex flex-wrap gap-2">
                          {t.status === "stopped" ? <StatusPill status="stopped" /> : paused ? <span className="badge border-amber-300/40 text-amber-200"><span className="h-2 w-2 rounded-full bg-amber-300" /> Paused{why ? `: ${why}` : ""}</span> : <StatusPill status={t.status} full={inIt.length >= t.spots} />} {/* (Owner, Oct 28 afternoon) open with a free spot: "Accepting testers"; open and full: "Full"; Draft, Paused, Stopped and Closed as before */}
                          {owedTests.has(t.id) && <span className="badge border-rose-300/40 text-rose-200">Payment failed</span>}
                          {t.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
                          {t.ndaText && <span className="badge"><FileSignature className="h-3.5 w-3.5" /> NDA</span>}
                        </div>
                        {t.pauseClosedAt && <p className="text-xs text-rose-200" data-pause-closed="">Closed after {PAUSE_CLOSE_DAYS} days paused</p>}
                        {/* Tags describing the terms. */}
                        <div className="flex flex-wrap gap-2">
                          <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                          <span className="badge">{t.joinMode === "invite" ? "Invite only" : t.joinMode === "apply" ? "Approved only" : "Anyone can join"}</span>
                          {/* (Batch 15 section 18) After Open until: "Joining closed · testers working until Dec 3". */}
                          {t.openUntil && (t.openUntil < now ? <span className="badge border-amber-300/40 text-amber-200" data-joining-closed="">{joiningClosedLine(inIt.reduce<Date | null>((m, c) => (c.dueAt > now && (!m || c.dueAt > m) ? c.dueAt : m), null), (d: Date) => fmtDate(d).replace(/, \d{4}$/, ""))}</span> : <span className="badge">Open until (last day to join) {fmtDate(t.openUntil)}</span>)}
                          {t._count.accessKeys > 0 && <span className="badge"><KeyRound className="h-3.5 w-3.5" /> {plural(keysFree.get(t.id) ?? 0, "key")} left</span>}
                          {nInvited > 0 && <span className="badge">{plural(nInvited, "invite")} waiting</span>}
                          {nApps > 0 && <span className="badge border-sky-300/40 text-sky-200">{plural(nApps, "application")}</span>}
                          {messages > 0 && <span className="badge border-fuchsia-300/40 text-fuchsia-200"><MessagesSquare className="h-3.5 w-3.5" /> {plural(messages, "unread message")}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="grid items-end gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Testers · {num(inIt.length)} of {num(t.spots)}</p>
                        {/* (Owner, Oct 28) Restricted: names are plain text (no hover card: no Chat with, Report, Block or profile link). */}
                        <Seats total={t.spots} plain={restricted} people={inIt.map((c) => ({ id: c.testerId, name: displayName(c.tester), contractId: restricted ? undefined : c.id }))} />
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                          <span>Feedback</span>
                          <span className="flex items-center gap-1 normal-case">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {num(accepted)}
                            <Inbox className="ml-2 h-3.5 w-3.5 text-amber-300" /> {num(waiting)}
                          </span>
                        </p>
                        <FeedbackBar accepted={accepted} waiting={waiting} total={t.spots} />
                      </div>
                    </div>
                  </div>
                </>
              ) };
            })} />
        )}
      </section>
    </>
  );

  });
}

// ---------------------------------------------------------------- tester (the full app's tester/page.tsx)

/** (Owner, Oct 27) The "Paused" tag on a test the team, a hold or a suspension has paused (testers never read why). */
const PausedTag = () => <span className="badge border-amber-300/40 text-amber-200" data-paused-tag="">Paused</span>;

async function TesterDashboard({ user, now }: { user: Viewer; now: Date }) {
  return withDateZone(user.timeZone, async () => {

  const userId = user.id;
  const suspended = !!user.testerSuspendedAt;
  // (Batch 30 §8) The invitations fingerprint as of BEFORE the lists below are read: AutoRefresh starts from it, so an invite created after this render is caught.
  const invitesFp = suspended ? "" : await invitesV(userId);
  const contracts = await db.contract.findMany({
    where: { testerId: userId },
    orderBy: { joinedAt: "desc" },
    include: { test: { include: { developer: true } }, submissions: { include: { review: true } }, calls: { where: { status: "booked", startsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } } } },
  });
  const ids = contracts.map((c) => c.id);
  const [apps, paid, rating, invites, ratedIds, payments] = await Promise.all([
    db.application.findMany({ where: { testerId: userId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.payment.aggregate({ where: { testerId: userId, kind: { not: "subscription" }, status: { in: ["charged", "not_set_up"] } }, _sum: { testerCents: true } }),
    ratingSummary(userId, "tester"), // (Owner, Nov 5, §276) the tester dashboard's Rating tile: ratings they got as a tester only
    db.invite.findMany({ where: { testerId: userId, status: "sent", test: { status: "open" } }, orderBy: { createdAt: "desc" }, include: { test: { include: { developer: true, _count: { select: { contracts: { where: { status: "working" } } } } } } } }),
    db.rating.findMany({ where: { contractId: { in: ids }, side: "tester" }, select: { contractId: true } }),
    db.payment.findMany({ where: { contractId: { in: ids } }, orderBy: { createdAt: "asc" } }),
  ]);
  const rated = new Set(ratedIds.map((r) => r.contractId));
  // (Batch 16 section 32) An invite re-sent on a new listing (an earlier one of theirs on that test was replaced).
  const replacedOn = new Set((await db.invite.findMany({ where: { testerId: userId, status: "replaced", testId: { in: invites.map((i) => i.testId) } }, select: { testId: true } })).map((r) => r.testId));
  const resentIds = new Set(invites.filter((i) => replacedOn.has(i.testId)).map((i) => i.id));
  // (Owner, Oct 30, batch 15 section 38) A test the tester applied to that became invite only stays here, marked "Closed to new testers (invite only)" (an open invite of theirs still works).
  const inviteOnlyApps = (await db.application.findMany({ where: { testerId: userId, status: "closed", closedReason: "invite_only", decidedAt: { gt: new Date(now.getTime() - 30 * DAY) } }, orderBy: { decidedAt: "desc" }, take: 20 })).filter((a) => !apps.some((x) => x.testId === a.testId));
  // (Batch 34 §16) An application next to a sent invite isn't waiting: the test is under Invitations (Join).
  const waitingApps = apps.filter((a) => !invites.some((i) => i.testId === a.testId));
  const appTests = new Map((await db.test.findMany({ where: { id: { in: [...apps, ...inviteOnlyApps].map((a) => a.testId) } }, include: { developer: true } })).map((t) => [t.id, t]));
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const working = contracts.filter((c) => c.status === "working" && previousTestGroup(c)===null);
  const pausedTest = (t: { adminPausedAt: Date | null; developer: { holdStartedAt: Date | null; devSuspendedAt: Date | null } }) => testPaused(t.developer, t);
  const byEnd = (a: (typeof contracts)[number], b: (typeof contracts)[number]) => (b.endedAt ?? b.joinedAt).getTime() - (a.endedAt ?? a.joinedAt).getTime();
  // (Owner, Oct 28) Tests the team's suspension removed the tester from: while suspended a read-only list; after reinstatement (no automatic re-invite) they sit at the top with
  // "You were removed from this test" and Ask to rejoin (only while the test is open, has a spot and isn't paused), until they ask or dismiss them. The developer can also invite
  // them again as usual (the invite shows under Invitations). Other left / removed tests (before the deadline, not stopped, not rated) are in "Tests you left".
  const askable = (c: (typeof contracts)[number]) => canAskToRejoin(c, rated.has(c.id)) && c.test.status !== "stopped" && !c.test.workEndedAt && !apps.some((a) => a.testId === c.testId && a.kind === "rejoin");
  // Sent and waiting for the developer's review.
  // (Batch 17 §19) Work unpaid when its Charge closed (its own closing date, for the tester) stays unpaid: it leaves "Waiting for review" and "Charge or cancel".
  const chargeCloses = new Map(await Promise.all(contracts.flatMap((c) => c.submissions.filter((s) => !s.review)).map(async (s) => [s.id, await pieceCloseOut({ submissionId: s.id }, "tester", now)] as const)));
  const chargeShut = (pieceId: string) => closedOut(chargeCloses.get(pieceId) ?? null, now);
  const waiting = contracts.flatMap((c) => c.submissions.filter((s) => !s.review && !chargeShut(s.id)).map((s) => ({ c, s }))).sort((a, b) => b.s.sentAt.getTime() - a.s.sentAt.getTime());
  // (Owner, Nov 2, batch 35 §118) A call that took place and waits for the developer's Pay counts too: measured, still booked, no review, Pay not closed. A listed
  // call's amount is the tester's share of its rate × the measured minutes; an unlisted call shows no amount.
  const measuredCalls = (await db.call.findMany({ where: { contractId: { in: ids }, status: "booked", review: { is: null }, startsAt: { lte: now } }, orderBy: { startsAt: "desc" } })).filter((x) => callMinutesOf(x) != null);
  const callPayShut = new Map(await Promise.all(measuredCalls.map(async (x) => [x.id, closedOut(await pieceCloseOut({ callId: x.id }, "developer", now), now)] as const)));
  const waitingCalls = measuredCalls.filter((x) => !callPayShut.get(x.id) && byId.has(x.contractId)).map((x) => ({ c: byId.get(x.contractId)!, x, minutes: callMinutesOf(x)!, cents: x.rateCents != null ? testerShare(callCharge(x.rateCents, callMinutesOf(x)!)) : null }));
  const pendingCents = waiting.reduce((n, { s }) => n + (s.agreedCents != null ? testerShare(s.agreedCents) : 0), 0) + waitingCalls.reduce((n, w) => n + (w.cents ?? 0), 0);
  // "To do": every part not sent yet (newest test first), each with a Send work button that opens the part. A test can be here and in Charge or cancel at once.
  // (Owner, Oct 31, batch 35 §84) Every open test you're in has Send work in To do: a test with every part sent gets one row of its own (opening its parts).
  // "Charge or cancel": unreviewed parts where Charge has opened (7 days and the test's Open until), by test, newest first; hidden while suspended.
  const paidFor = (sid: string) => payments.filter((p) => p.submissionId === sid && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const chargeable = suspended ? [] : contracts
    .map((c) => ({ c, parts: c.submissions.filter((s) => !s.review && !s.late && s.choiceOfferedAt && !chargeShut(s.id) && chargeAmount(s.agreedCents, paidFor(s.id)) > 0) }))
    .filter((x) => x.parts.length > 0)
    .sort((a, b) => Math.max(...b.parts.map((s) => s.sentAt.getTime())) - Math.max(...a.parts.map((s) => s.sentAt.getTime())));
  // (Owner, Oct 28) A suspended tester's session pages are closed: nothing here links to them.
  const upcoming = suspended ? [] : contracts.flatMap((c) => c.calls.map((x) => ({ c, x }))).sort((a, b) => a.x.startsAt.getTime() - b.x.startsAt.getTime());
  const sectionTitle = (icon: React.ReactNode, text: string, n?: number) => (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-white">{icon} {text} {n != null && <span className="text-sm font-normal text-slate-400">{num(n)}</span>}</h2>
  );
  return (
    <>
      {user.payoutProblemAt && <PayoutBanner />}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Your numbers">
        <StatTile icon={Wallet} label="Earned" value={compactMoney(paid._sum.testerCents ?? 0)} hint="what you got for accepted work" tone="emerald" />
        <StatTile icon={Hourglass} label="Waiting for review" value={compactMoney(pendingCents)} hint={`${plural(waiting.length + waitingCalls.length, "part")}`} tone="amber" />
        <StatTile icon={Award} label="Rating" value={rating.n ? `${rating.avg.toFixed(1)} ★` : "-"} hint={rating.n ? `${plural(rating.n, "rating")}` : "no ratings yet"} tone="fuchsia" />
        <StatTile icon={ListTodo} label="To do" value={compact(suspended?0:working.length)} hint="tests you are working on" tone="indigo" />
      </section>

      <SearchPanel id="to-do" title="To do" placeholder="Search To do by developer or test" items={(suspended?[]:working).map(c=>({key:c.id,search:`${c.title} ${displayName(c.test.developer)}`,node:<TodoTestRow id={c.id} title={c.title} dueAt={c.dueAt} now={now} timeZone={user.timeZone}/>}))}/>

      {/* (Batch 17 section 17) Every rating the tester can give now (hidden while their tester side is suspended). */}
      {!suspended && <RatingsToGive user={user} side="tester" />}

      {(waiting.length > 0 || waitingCalls.length > 0 || waitingApps.length > 0 || inviteOnlyApps.length > 0) && (
        <section className="space-y-3">
          {sectionTitle(<Hourglass className="h-5 w-5 text-amber-300" />, "Waiting for the developer")}
          <ScopedPanelSearch label="Waiting for the developer"><ScrollList className="space-y-2" label="Waiting for the developer">
            {waitingApps.map((a) => (
              <li key={a.id} data-panel-search={`${appTests.get(a.testId)?.title??""} ${appTests.get(a.testId)?displayName(appTests.get(a.testId)!.developer):""}`}>
                <Link href={`/app/find/${a.testId}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                  <p className="min-w-[12rem] flex-1 font-medium text-white [overflow-wrap:anywhere]" data-app-waiting-title=""><TestName text={appTests.get(a.testId)?.title ?? "A test"} /> {appTests.get(a.testId) && pausedTest(appTests.get(a.testId)!) && <PausedTag />}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> {a.kind === "rejoin" ? "Ask to rejoin waiting" : "Application waiting"}</span>
                </Link>
              </li>
            ))}
            {inviteOnlyApps.map((a) => (
              <li key={a.id} data-panel-search={`${appTests.get(a.testId)?.title??""} ${appTests.get(a.testId)?displayName(appTests.get(a.testId)!.developer):""}`}>
                <Link href={`/app/find/${a.testId}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline" data-invite-only="">
                  <p className="min-w-[12rem] flex-1 font-medium text-white [overflow-wrap:anywhere]" data-invite-only-title=""><TestName text={appTests.get(a.testId)?.title ?? "A test"} /></p>
                  <span className="badge border-slate-400/40 text-slate-300">Closed to new testers (invite only)</span>
                </Link>
              </li>
            ))}
            {waiting.map(({ c, s }) => {
              // (Batch 26 section 6) A listed part: when Charge opens (its review date, moved by pauses like the date itself). Not for an unlisted part.
              const listed = (s.kind === "recording" ? c.recordingCents : c.writtenCents) != null;
              // (Batch 30 §3) Late listed work never opens Charge: it says so instead.
              const opens = listed && !s.late ? chargeOpensAt(s, c.test, c, now) : null;
              const inner = (
                <>
                  <p className="min-w-[12rem] flex-1 font-medium text-white [overflow-wrap:anywhere]"><TestName text={c.title} /> {pausedTest(c.test) && <PausedTag />}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> {s.kind === "recording" ? "Screen recording" : "Written answers"} sent: waiting for review</span>
                  {opens && opens > now && <p className="basis-full text-xs text-slate-400" data-charge-opens="">{chargeOpensNote(displayName(c.test.developer), pieceDay(opens, user.timeZone))}</p>}
                  {listed && s.late && <p className="basis-full text-xs text-slate-400" data-sent-late="">{lateSentLine(fmtDate(c.dueAt), displayName(c.test.developer))}</p>}
                </>
              );
              return (
                <li key={s.id} data-panel-search={`${c.title} ${displayName(c.test.developer)}`}>
                  {/* (Owner, Oct 28) Suspended: the session page is closed, so the row doesn't open. */}
                  {suspended ? <div className="card flex flex-wrap items-center gap-3 p-4" data-waiting-plain="">{inner}</div> : <Link href={`/app/sessions/${c.id}#parts`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">{inner}</Link>}
                </li>
              );
            })}
            {/* (Batch 35 §118) A call that took place, waiting for the developer's Pay: it opens that call on the session page ((Owner, Nov 5, §209) its row in the Live
                session's "Had (N)", which opens for the jump). */}
            {waitingCalls.map(({ c, x, minutes, cents }) => {
              const inner = (
                <>
                  <p className="min-w-[12rem] flex-1 font-medium text-white [overflow-wrap:anywhere]"><TestName text={c.title} /> {pausedTest(c.test) && <PausedTag />}</p>
                  <span className="badge text-amber-300" data-waiting-call-line=""><Clock className="h-3.5 w-3.5" /> Live call on {pieceDay(x.startsAt, user.timeZone)} · {minutes} min: waiting for review</span>
                  {cents != null && <span className="text-sm text-slate-300" data-waiting-call-amount="">{money(cents)}</span>}
                </>
              );
              return (
                <li key={x.id} data-panel-search={`${c.title} ${displayName(c.test.developer)}`} data-waiting-call={x.id}>
                  {suspended ? <div className="card flex flex-wrap items-center gap-3 p-4" data-waiting-plain="">{inner}</div> : <Link href={`/app/sessions/${c.id}#call-${x.id}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">{inner}</Link>}
                </li>
              );
            })}
          </ScrollList></ScopedPanelSearch>
        </section>
      )}


      {chargeable.length > 0 && (
        <section className="space-y-3" id="charge-or-cancel">
          {sectionTitle(<Banknote className="h-5 w-5 text-amber-300" />, "Charge or cancel", chargeable.length)}
          <p className="note">Parts the developer hasn&apos;t reviewed once {REVIEW_DAYS} days have passed since you sent them and your deadline has passed: charge for them, or let them go.</p>
          <ScopedPanelSearch label="Charge or cancel"><ScrollList className="space-y-2" label="Charge or cancel">
            {chargeable.map(({ c, parts }) => (
              <li key={c.id} data-panel-search={`${c.title} ${displayName(c.test.developer)}`}>
                <Link href={`/app/sessions/${c.id}#part-${parts[0].kind}`} className="card card-hover flex flex-wrap items-center gap-3 border-amber-400/30 p-4 no-underline hover:no-underline">
                  <p className="min-w-[12rem] flex-1 font-medium text-white [overflow-wrap:anywhere]"><TestName text={c.title} /> · {plural(parts.length, "part")} {pausedTest(c.test) && <PausedTag />}</p>
                  <span className="btn px-3 py-1.5 text-sm">Charge or let it go <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
          </ScrollList></ScopedPanelSearch>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3" id="upcoming-calls">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="h-5 w-5 text-amber-300" /> Upcoming calls <span className="text-sm font-normal text-slate-400">next 7 days</span></h2>
          <ScopedPanelSearch label="Upcoming calls">          <div className="card p-3">
            {/* (Owner, Nov 3, batch 35 §152) In the draggable panel, like the developer's Calls box. */}
            <ResizeBox id="dash-upcoming-calls" label="Upcoming calls" defaultMax={LIST_PANEL.dashCalls}>
            <ul className="divide-y divide-white/5" data-upcoming-calls="">
              {upcoming.map(({ c, x }) => (
                <li key={x.id} data-panel-search={`${c.title} ${displayName(c.test.developer)}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  {/* (Owner, Nov 3, long text) Only the names are cut with "…": the call's day, time and length always show (a line of their own when the names are long).
                      (Owner, Nov 5, §209; was §186's Call history "Booked (N)") It opens that call's own row in the session's Live session, with its Join call. */}
                  <Link href={`/app/sessions/${c.id}#call-${x.id}`} className="mr-auto flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 text-slate-200 no-underline hover:underline"><span className="min-w-0 max-w-full [overflow-wrap:anywhere]"><b className="text-white"><Cut text={displayName(c.test.developer)} /></b> · <TestName text={c.title} /></span> <span className="whitespace-nowrap">· {fmtDateTime(x.startsAt)} · {x.minutes} min <ArrowRight className="inline h-4 w-4 text-indigo-300" /></span></Link>
                  {/* (Batch 15 sections 35 and 38) Join wherever a call is listed, from 10 minutes before to 30 minutes after its booked end. */}
                  {callJoinable(x, now) && !testPaused(c.test.developer, c.test) && <JoinCall callId={x.id} />}
                  {/* (Batch 18 section 13; batch 21) The camera and microphone check, once per upcoming call. */}
                  <CallCheck className="w-full" />
                </li>
              ))}
            </ul>
            </ResizeBox>
          </div></ScopedPanelSearch>
        </section>
      )}

      {/* (Owner, Oct 28, batch 16 section 32) Invitations follow every close live: the page refreshes on its poll, and the live box says which invite closed. */}
      {!suspended && <AutoRefresh query="invites=1" v={invitesFp} />}
      {!suspended && <LiveTop scope="invites:me" seenAt={now.toISOString()} />}
      {!suspended && invites.length > 0 && (
        <section className="space-y-3" id="invitations">
          {sectionTitle(<Inbox className="h-5 w-5 text-emerald-300" />, "Invitations", invites.length)}
          <ScopedPanelSearch label="Invitations"><ScrollList className="space-y-2" label="Invitations">
            {invites.map((i) => (
              <li key={i.id} data-panel-search={`${i.test.title} ${displayName(i.test.developer)}`} className="info flex flex-wrap items-center gap-2">
                {/* (Batch 35 §137) The names in the sentence link: the developer's profile, the test's page. */}
                <span className="mr-auto min-w-0" title={`${displayName(i.test.developer)} invited you to “${i.test.title}”`}>
                  <NameLink text={displayName(i.test.developer)} href={i.test.developer.deletedAt ? null : `/app/developers/${i.test.developerId}`} /> invited you to “<NameLink text={i.test.title} kind="test" href={`/app/find/${i.testId}`} />”. {pausedTest(i.test) && <PausedTag />}
                </span>
                {/* (Batch 16 section 32) Re-sent on a new listing, or the test is full: said on the card. */}
                {resentIds.has(i.id) && <span className="badge" data-invite-resent="">Sent again on the new listing · {fmtDate(i.createdAt)}</span>}
                {i.test._count.contracts >= i.test.spots && <span className="badge" data-invite-full="">Full right now: your invite stays open</span>}
                <Link href={`/app/find/${i.testId}`} className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Accept</Link>
                <NoThanks inviteId={i.id} />
              </li>
            ))}
          </ScrollList></ScopedPanelSearch>
        </section>
      )}

      {/* (Batch 17 §18) Join pages opened but never joined, with each test's state now (live on the dashboard's poll). */}
      {!suspended && <TestsVisited testerId={userId} />}

      <SearchPanel id="previous-tests" title="Previous Tests" placeholder="Search previous tests by developer or test" filters={PREVIOUS_TEST_FILTERS} items={contracts.filter(c=>previousTestGroup(c)!==null).sort(byEnd).map(c=>({key:c.id,search:`${c.title} ${displayName(c.test.developer)}`,states:[previousTestGroup(c)!],node:<FindTestCard test={{...c.test,title:c.title}} href={`/app/sessions/${c.id}`} developerName={displayName(c.test.developer)} terms={pays(asListing(c.test))} state={previousTestGroup(c)!} footer={<div className="space-y-2"><p className="text-xs text-slate-400">{fmtDate(c.endedAt??c.joinedAt)}</p>{!suspended && askable(c) && !pausedTest(c.test) && <Link href={`/app/find/${c.testId}`} className="btn-secondary text-sm">Ask to rejoin</Link>}</div>}/>}))}/>
    </>
  );

  });
}
