import Link from "next/link";
import { ArrowRight, Award, CalendarClock, CheckCircle2, Clock, Compass, FileSignature, Hourglass, Inbox, KeyRound, LayoutGrid, ListTodo, MessagesSquare, PlusCircle, RotateCcw, Users, Wallet, XCircle, AppWindow, Banknote } from "lucide-react";
import { db } from "@/lib/db";
import { compact, compactMoney, displayName, fmtDate, fmtDateTime, money, num } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { sideFor } from "@/lib/sides";
import { ProfileForm } from "./profile/ProfileForm";
import { NoThanks } from "./NoThanks";
import { DeveloperTiles } from "@/components/ProfileTiles";
import { StatTile } from "@/components/StatTile";
import { CategoryBadges } from "@/components/Category";
import { CategoryChips, CategoryTile, daysLeft, FeedbackBar, mainCategory, PartBadges, Seats, StatusPill } from "@/components/Ui";
import { callJoinable, canAskToRejoin, chargeAmount, termsLine, testerShare, testPaused } from "@/lib/rules";
import { ratingSummary } from "@/lib/server/ratings";
import { unreadCount } from "@/lib/server/messages";
import { asListing, findTests } from "@/lib/server/tests";
import { RestrictedBox } from "@/components/RestrictedBox";
import { devRestricted, restrictionsOf } from "@/lib/restricted";
import { PayoutBanner } from "@/components/PayoutBanner";
import { CallsBox } from "./CallsBox";
import { DismissRemoved } from "./DismissRemoved";
import { LongList } from "@/components/LongList";
import { rejoinAskLine } from "@/lib/server/joining";
import { pronouns } from "@/lib/format";
import { chargebackSteps } from "@/lib/server/chargeback";
import { PAUSE_CLOSE_DAYS } from "@/lib/pause";
import { HOLD_APPROVAL_AFTER } from "@/lib/rules";

export const metadata = { title: "Home · Playtest" };
export const dynamic = "force-dynamic";

/** A card's one link, stretched over the whole card (the full app's CARD_LINK). */
const CARD_LINK = "after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-volt-300";
const plural = (n: number, w: string) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;
/** What the tester gets, without the days ("Written $8.00 · Recording $9.60"). */
const pays = (t: Parameters<typeof termsLine>[0]) => termsLine(t, true).split(" · ").slice(0, -1).join(" · ");
const DAY = 86_400_000;

export default async function AppHome({ searchParams }: { searchParams: Promise<{ category?: string; failed?: string }> }) {
  const u = await requirePageUser();
  const { category, failed } = await searchParams;
  if (!u.isDeveloper && !u.isTester)
    return (
      <>
        <h1>Welcome to Playtest</h1>
        <p className="note">Tell us who you are. You can change this later in Profile.</p>
        <ProfileForm first init={{ name: u.name, pronoun: u.pronoun, isDeveloper: false, isTester: false, devices: [], categories: [], languages: [], bio: "" }} />
      </>
    );
  const now = new Date();
  const side = sideFor(u, "/app");
  // (Owner, Oct 27) A suspension, a payment hold and a chargeback hold are one state for the developer's pages: ONE blue box at the very top says what happened and how to resume.
  const devOff = side === "developer" && u.isDeveloper && devRestricted(u, side);
  const testerOff = side === "tester" && u.isTester && !!u.suspendedAt;
  const cbSteps = devOff && u.holdStartedAt ? await chargebackSteps(u.id) : null;
  return (
    <div className="space-y-8">
      {(devOff || testerOff) && (
        <RestrictedBox failed={failed} developer={devOff} tester={testerOff} kinds={restrictionsOf(u)} steps={cbSteps?.remaining} review={!!(u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER)} />
      )}
      {!u.suspendedAt && u.reinstatedAt && now.getTime() - u.reinstatedAt.getTime() < 3 * DAY && (
        <p className="ok rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2" role="status" data-reinstated-box="">Your account is active again · {fmtDateTime(u.reinstatedAt)}</p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Welcome back,</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{u.name || u.email}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {side === "developer" && !devOff && <Link className="btn" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
          {side === "tester" && !u.suspendedAt && <Link className="btn" href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
        </div>
      </div>
      {/* (NEXT-UI 6) One side at a time: the dashboard of the side in use (the header switch changes it). */}
      {side === "developer" && <DeveloperDashboard user={u} now={now} category={category} restricted={devOff} />}
      {side === "tester" && <TesterDashboard user={u} now={now} />}
    </div>
  );
}

type Viewer = Awaited<ReturnType<typeof requirePageUser>>;

// ---------------------------------------------------------------- developer (the full app's dev/page.tsx)

async function DeveloperDashboard({ user, now, category, restricted }: { user: Viewer; now: Date; category?: string; restricted: boolean }) {
  const userId = user.id;
  const allTests = await db.test.findMany({
    where: { developerId: userId },
    orderBy: { createdAt: "desc" },
    include: { contracts: { include: { tester: true, submissions: { include: { review: true, dispute: true } }, calls: { include: { review: true, dispute: true } } } }, _count: { select: { accessKeys: true } } },
  });
  const testIds = allTests.map((t) => t.id);
  const [apps, reqs, spent, unreadList, invites, owedPays, freeKeys, nextCalls] = await Promise.all([
    db.application.findMany({ where: { testId: { in: testIds }, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.callRequest.findMany({ where: { testId: { in: testIds }, status: "pending", fromSide: "tester", startsAt: { gt: now } }, orderBy: { createdAt: "desc" } }),
    db.payment.aggregate({ where: { developerId: userId, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }),
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
  type Item = { key: string; at: Date; href: string; who: string; text: React.ReactNode; cta: string };
  const items: Item[] = [];
  for (const t of allTests)
    for (const c of t.contracts) {
      const who = displayName(c.tester);
      // (Owner, Oct 28) A tester who deleted their account: their unpaid work can no longer be paid, charged or disputed, so it isn't waiting for review.
      if (c.tester.deletedAt) continue;
      for (const s of c.submissions.filter((x) => !x.review)) items.push({ key: `s-${s.id}`, at: s.sentAt, href: `/app/tests/${t.id}#piece-${s.id}`, who, text: <>sent their {s.kind === "recording" ? "recording" : "written answers"} for <b className="text-white">{t.title}</b></>, cta: "Review" });
      for (const x of c.calls.filter((y) => y.status === "booked" && y.startsAt <= now && !y.review)) items.push({ key: `c-${x.id}`, at: x.startsAt, href: `/app/tests/${t.id}#call-${x.id}`, who, text: <>held a live call for <b className="text-white">{t.title}</b>: enter its length and pay</>, cta: "Review" });
      for (const s of c.submissions.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide)) items.push({ key: `d-${s.id}`, at: s.dispute!.createdAt, href: `/app/tests/${t.id}#item-dispute-${s.dispute!.id}`, who, text: <>disputed what you paid on <b className="text-white">{t.title}</b>: add your side</>, cta: "Answer" });
    }
  for (const a of apps) {
    const t = allTests.find((x) => x.id === a.testId)!;
    const x = applicants.get(a.testerId);
    const name = x ? displayName(x) : "A tester";
    if (a.kind === "rejoin") {
      const old = await oldOf(a);
      items.push({ key: `a-${a.id}`, at: a.createdAt, href: `/app/tests/${t.id}#needs-you`, who: name, text: <>{old && x ? rejoinAskLine(name, pronouns(x.pronoun), old).replace(`${name} asks`, "asks") : "asks to rejoin"} · <b className="text-white">{t.title}</b></>, cta: "Answer" });
    } else items.push({ key: `a-${a.id}`, at: a.createdAt, href: `/app/tests/${t.id}#needs-you`, who: name, text: <>applied to join <b className="text-white">{t.title}</b></>, cta: "Answer" });
  }
  for (const r of reqs) {
    const x = contractTest.get(r.contractId);
    if (x) items.push({ key: `r-${r.id}`, at: r.createdAt, href: `/app/tests/${x.t.id}#calls`, who: displayName(x.c.tester), text: <>asked for a live call · <b className="text-white">{x.t.title}</b></>, cta: "Answer" });
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const toReview = items.filter((i) => i.key.startsWith("s-") || i.key.startsWith("c-")).length;
  // (Owner, Oct 27) Sent work and held calls waiting for Pay / Reject are in the "Needs review" box (one row per test); Needs you keeps the answers. Under a suspension or a hold
  // the pages these lead to are closed: neither box is shown.
  const shown = restricted ? [] : items.filter((i) => !/^s-|^c-/.test(i.key));
  const reviewRows = restricted ? [] : allTests
    .map((t) => {
      const mine = items.filter((i) => /^s-|^c-/.test(i.key) && i.href.startsWith(`/app/tests/${t.id}#`));
      return { id: t.id, title: t.title, n: mine.length, at: mine.reduce((m, i) => (i.at > m ? i.at : m), new Date(0)) };
    })
    .filter((r) => r.n > 0)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const testersTotal = allTests.reduce((n, t) => n + t.contracts.filter((c) => c.status === "working").length, 0);
  const initial = (name: string) => name.trim().charAt(0).toUpperCase();
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
      <DeveloperTiles userId={userId} />

      {reviewRows.length > 0 && (
        <section className="space-y-3" id="needs-review" aria-label="Needs review">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Needs review <span className="text-sm font-normal text-slate-400">{num(reviewRows.length)}</span>
          </h2>
          {/* Newest first: 3 rows, then "Show N more" opening a scroll box. Each row opens that test's Needs you. */}
          <LongList shown={3} tall="max-h-72" className="space-y-2">
            {reviewRows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/tests/${r.id}#needs-you`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                  <p className="min-w-0 flex-1 truncate text-slate-300" title={`${r.title} · ${plural(r.n, "part")} to pay or reject`}><b className="text-white">{r.title}</b> · {plural(r.n, "part")} to pay or reject</p>
                  <span className="flex shrink-0 items-center gap-1 text-sm text-indigo-300">Review <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
          </LongList>
        </section>
      )}

      {shown.length > 0 && (
        <section className="space-y-3" id="needs-you">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Needs you <span className="text-sm font-normal text-slate-400">{num(shown.length)}</span>
          </h2>
          {/* More than 4 items: a scroll box (newest first). */}
          <ul className={`space-y-2 ${shown.length > 4 ? "max-h-[22rem] overflow-y-auto pr-1" : ""}`} data-needs-list={shown.length > 4 ? "scroll" : "plain"}>
            {shown.map((r) => {
              const inner = (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950">{initial(r.who)}</span>
                  <p className="min-w-0 flex-1 text-slate-300"><span className="font-medium text-white">{r.who}</span> {r.text}</p>
                  <span className="flex items-center gap-1 text-sm text-indigo-300">{r.cta} <ArrowRight className="h-4 w-4" /></span>
                </>
              );
              return (
                <li key={r.key}>
                  <Link href={r.href} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">{inner}</Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <CallsBox calls={calls} seenAt={seenAt} restricted={restricted} />

      <section className="space-y-3">
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
          <ul className="grid gap-4 md:grid-cols-2">
            {tests.map((t) => {
              const inIt = t.contracts.filter((c) => c.status === "working");
              const accepted = t.contracts.filter((c) => c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const waiting = t.contracts.filter((c) => c.submissions.some((s) => !s.review) && !c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const messages = t.contracts.reduce((n, c) => n + (unread.get(c.id) ?? 0), 0);
              const paused = !!(user.holdStartedAt || user.suspendedAt || t.adminPausedAt);
              const why = user.suspendedAt ? "account suspended" : user.holdStartedAt ? (user.holdReason === "chargeback" ? "chargeback hold" : "payment hold") : t.adminPausedAt ? "paused by the team" : "";
              const nInvited = invitesBy.get(t.id) ?? 0, nApps = appsBy.get(t.id) ?? 0;
              const title = <span className="text-lg font-semibold text-white">{t.title}</span>;
              return (
                <li key={t.id}>
                  {/* The whole card opens the test (its title's link stretches over it); a suspended developer's cards don't open. */}
                  <div className="card card-hover relative block h-full space-y-4" data-test-card={t.status === "stopped" ? "stopped" : paused ? "paused" : t.status}>
                    <div className="flex items-start gap-3">
                      <CategoryTile category={mainCategory(t.categories)} />
                      <div className="min-w-0 space-y-2">
                        {t.productName && <p className="kicker">{t.productName}</p>}
                        {/* Under a suspension or a hold the test pages are closed: the card doesn't open. */}
                        <p>{restricted ? title : <Link href={`/app/tests/${t.id}`} className={`${CARD_LINK} no-underline hover:no-underline`}>{title}</Link>}</p>
                        <div className="flex flex-wrap gap-2">
                          {t.status === "stopped" ? <StatusPill status="stopped" /> : paused ? <span className="badge border-amber-300/40 text-amber-200"><span className="h-2 w-2 rounded-full bg-amber-300" /> Paused{why ? `: ${why}` : ""}</span> : t.status === "open" ? null : <StatusPill status={t.status} />} {/* (Owner, Oct 28) the doc: an Open test has no label (a full one too); Draft, Paused, Stopped and Closed do */}
                          {owedTests.has(t.id) && <span className="badge border-rose-300/40 text-rose-200">Payment failed</span>}
                          {t.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
                          {t.ndaText && <span className="badge"><FileSignature className="h-3.5 w-3.5" /> NDA</span>}
                        </div>
                        {t.pauseClosedAt && <p className="text-xs text-rose-200" data-pause-closed="">Closed after {PAUSE_CLOSE_DAYS} days paused</p>}
                        {/* Tags describing the terms. */}
                        <div className="flex flex-wrap gap-2">
                          <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                          <span className="badge">{t.joinMode === "invite" ? "Invite only" : t.joinMode === "apply" ? "Approved only" : "Anyone can join"}</span>
                          <span className="badge" title="Each tester's deadline counts from when they join"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} days per tester</span>
                          {t.openUntil && <span className="badge">Open until {fmtDate(t.openUntil)}</span>}
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- tester (the full app's tester/page.tsx)

/** (Owner, Oct 27) The "Paused" tag on a test the team, a hold or a suspension has paused (testers never read why). */
const PausedTag = () => <span className="badge border-amber-300/40 text-amber-200" data-paused-tag="">Paused</span>;

async function TesterDashboard({ user, now }: { user: Viewer; now: Date }) {
  const userId = user.id;
  const suspended = !!user.suspendedAt;
  const contracts = await db.contract.findMany({
    where: { testerId: userId },
    orderBy: { joinedAt: "desc" },
    include: { test: { include: { developer: true } }, submissions: { include: { review: true } }, calls: { where: { status: "booked", startsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } } } },
  });
  const ids = contracts.map((c) => c.id);
  const [offers, allOffers, devReqs, apps, paid, rating, invites, unreadList, recommended, ratedIds, payments] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId: { in: ids }, status: "open" } }),
    db.termsOffer.findMany({ where: { contractId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    db.callRequest.findMany({ where: { contractId: { in: ids }, status: "pending", fromSide: "developer", startsAt: { gt: now } } }),
    db.application.findMany({ where: { testerId: userId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.payment.aggregate({ where: { testerId: userId, status: { in: ["charged", "not_set_up"] } }, _sum: { testerCents: true } }),
    ratingSummary(userId),
    db.invite.findMany({ where: { testerId: userId, status: "sent", test: { status: "open" } }, orderBy: { createdAt: "desc" }, include: { test: { include: { developer: true } } } }),
    Promise.all(contracts.map(async (c) => [c.id, await unreadCount(userId, c.testId, c.testerId)] as const)),
    suspended ? Promise.resolve([] as Awaited<ReturnType<typeof findTests>>) : findTests(user),
    db.rating.findMany({ where: { contractId: { in: ids }, side: "tester" }, select: { contractId: true } }),
    db.payment.findMany({ where: { contractId: { in: ids } }, orderBy: { createdAt: "asc" } }),
  ]);
  const unread = new Map(unreadList);
  const rated = new Set(ratedIds.map((r) => r.contractId));
  const appTests = new Map((await db.test.findMany({ where: { id: { in: apps.map((a) => a.testId) } }, include: { developer: true } })).map((t) => [t.id, t]));
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const working = contracts.filter((c) => c.status === "working");
  const history = contracts.filter((c) => c.status !== "working");
  const pausedTest = (t: { adminPausedAt: Date | null; developer: { holdStartedAt: Date | null; suspendedAt: Date | null } }) => testPaused(t.developer, t);
  const byEnd = (a: (typeof contracts)[number], b: (typeof contracts)[number]) => (b.endedAt ?? b.joinedAt).getTime() - (a.endedAt ?? a.joinedAt).getTime();
  // (Owner, Oct 28) Tests the team's suspension removed the tester from: while suspended a read-only list; after reinstatement (no automatic re-invite) they sit at the top with
  // "You were removed from this test" and Ask to rejoin (only while the test is open, has a spot and isn't paused), until they ask or dismiss them. The developer can also invite
  // them again as usual (the invite shows under Invitations). Other left / removed tests (before the deadline, not stopped, not rated) are in "Tests you left".
  const removed = history.filter((c) => c.endKind === "suspended" && !c.removedDismissedAt && !apps.some((a) => a.testId === c.testId && a.kind === "rejoin")).sort(byEnd);
  const inRemoved = new Map((await db.contract.groupBy({ by: ["testId"], where: { testId: { in: removed.map((c) => c.testId) }, status: "working" }, _count: { _all: true } })).map((g) => [g.testId, g._count._all]));
  const hasSpot = (c: (typeof contracts)[number]) => (inRemoved.get(c.testId) ?? 0) < c.test.spots && (!c.test.openUntil || c.test.openUntil > now);
  const askable = (c: (typeof contracts)[number]) => canAskToRejoin(c, rated.has(c.id)) && c.test.status !== "stopped" && !apps.some((a) => a.testId === c.testId && a.kind === "rejoin");
  const left = history.filter((c) => c.endKind !== "suspended" && askable(c)).sort(byEnd);
  const toSend = (c: (typeof contracts)[number]) => [
    ...(c.writtenCents != null && !c.submissions.some((s) => s.kind === "written") ? [{ key: "written", name: "Written answers", cents: c.writtenCents }] : []),
    ...(c.recordingCents != null && !c.submissions.some((s) => s.kind === "recording") ? [{ key: "recording", name: "Screen recording", cents: c.recordingCents }] : []),
  ];
  // Sent and waiting for the developer's review.
  const waiting = contracts.flatMap((c) => c.submissions.filter((s) => !s.review).map((s) => ({ c, s }))).sort((a, b) => b.s.sentAt.getTime() - a.s.sentAt.getTime());
  const pendingCents = waiting.reduce((n, { s }) => n + (s.agreedCents != null ? testerShare(s.agreedCents) : 0), 0);
  // "To do": every part not sent yet (newest test first), each with a Send work button that opens the part. A test can be here and in Charge or cancel at once.
  const todoParts = working.flatMap((c) => toSend(c).map((p) => ({ c, p })));
  // "Charge or cancel": unreviewed parts where Charge has opened (14 days and the test's Open until), by test, newest first; hidden while suspended.
  const paidFor = (sid: string) => payments.filter((p) => p.submissionId === sid && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const chargeable = suspended ? [] : contracts
    .map((c) => ({ c, parts: c.submissions.filter((s) => !s.review && s.choiceOfferedAt && chargeAmount(s.agreedCents, paidFor(s.id)) > 0) }))
    .filter((x) => x.parts.length > 0)
    .sort((a, b) => Math.max(...b.parts.map((s) => s.sentAt.getTime())) - Math.max(...a.parts.map((s) => s.sentAt.getTime())));
  // (Owner, Oct 28) A suspended tester's session pages are closed: nothing here links to them.
  const answers = suspended ? [] : [
    ...offers.flatMap((o) => { const c = byId.get(o.contractId); return c ? [{ key: `offer-${o.id}`, c, text: `${displayName(c.test.developer)} offered new terms: ${o.diff}`, href: `/app/sessions/${c.id}`, cta: "Switch or keep your terms" }] : []; }),
    ...devReqs.flatMap((r) => { const c = byId.get(r.contractId); return c ? [{ key: `req-${r.id}`, c, text: `${displayName(c.test.developer)} asked for a live call`, href: `/app/sessions/${c.id}#calls`, cta: "Accept or decline" }] : []; }),
  ];
  const upcoming = suspended ? [] : contracts.flatMap((c) => c.calls.map((x) => ({ c, x }))).sort((a, b) => a.x.startsAt.getTime() - b.x.startsAt.getTime());
  const more = recommended.filter((t) => !t.contracts.some((c) => c.status === "working")).slice(0, 4);
  const removedCard = (c: (typeof contracts)[number]) => {
    const may = !suspended && c.test.status === "open" && !pausedTest(c.test) && hasSpot(c) && askable(c);
    return (
      <li key={c.id} className="card flex flex-wrap items-center gap-3 p-4" data-removed={c.id}>
        <CategoryTile category={mainCategory(c.test.categories)} size="h-10 w-10" />
        <div className="min-w-[12rem] flex-1">
          <p className="truncate font-semibold text-white" title={c.title}>{c.title} {pausedTest(c.test) && <PausedTag />}</p>
          <p className="text-sm text-slate-400" data-removed-label="">You were removed from this test.</p>
        </div>
        {may && (
          <Link href={`/app/find/${c.testId}`} className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" data-rejoin={c.id}><RotateCcw className="h-4 w-4" /> Ask to rejoin</Link>
        )}
        {!suspended && <DismissRemoved contractId={c.id} />}
      </li>
    );
  };
  const leftCard = (c: (typeof contracts)[number]) => (
    <li key={c.id}>
      <Link href={`/app/find/${c.testId}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline" data-rejoin={c.id}>
        <CategoryTile category={mainCategory(c.test.categories)} size="h-10 w-10" />
        <div className="min-w-[12rem] flex-1">
          <p className="truncate font-semibold text-white" title={c.title}>{c.title} {pausedTest(c.test) && <PausedTag />}</p>
          <p className="text-sm text-slate-400">{c.status === "left" ? `You left this test (${fmtDate(c.endedAt ?? c.joinedAt)}).` : `Your work ended (${fmtDate(c.endedAt ?? c.joinedAt)}).`} Your deadline is {fmtDate(c.dueAt)}.</p>
        </div>
        {!pausedTest(c.test) && <span className="btn-secondary px-3 py-1.5 text-sm"><RotateCcw className="h-4 w-4" /> Ask to rejoin</span>}
      </Link>
    </li>
  );
  const sectionTitle = (icon: React.ReactNode, text: string, n?: number) => (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-white">{icon} {text} {n != null && <span className="text-sm font-normal text-slate-400">{num(n)}</span>}</h2>
  );
  return (
    <>
      {user.payoutProblemAt && <PayoutBanner />}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Your numbers">
        <StatTile icon={Wallet} label="Earned" value={compactMoney(paid._sum.testerCents ?? 0)} hint="what you got for accepted work" tone="emerald" />
        <StatTile icon={Hourglass} label="Waiting for review" value={compactMoney(pendingCents)} hint={`${plural(waiting.length, "part")}`} tone="amber" />
        <StatTile icon={Award} label="Rating" value={rating.n ? `${rating.avg.toFixed(1)} ★` : "-"} hint={rating.n ? `${plural(rating.n, "rating")}` : "no ratings yet"} tone="fuchsia" />
        <StatTile icon={ListTodo} label="To do" value={compact(todoParts.length + answers.length)} hint={answers.length ? `${answers.length} waiting for your answer` : "parts to send"} tone="indigo" />
      </section>

      {removed.length > 0 && (
        <section className="space-y-3" id="suspended-tests">
          {sectionTitle(<RotateCcw className="h-5 w-5 text-rose-300" />, "Tests you were removed from", removed.length)}
          <LongList shown={3} tall="max-h-72" className="space-y-2">{removed.map((c) => removedCard(c))}</LongList>
        </section>
      )}

      {chargeable.length > 0 && (
        <section className="space-y-3" id="charge-or-cancel">
          {sectionTitle(<Banknote className="h-5 w-5 text-amber-300" />, "Charge or cancel", chargeable.length)}
          <p className="note">Parts the developer hasn&apos;t reviewed once 14 days have passed since you sent them and the test&apos;s Open until has passed: charge for them, or let them go.</p>
          <LongList shown={3} tall="max-h-72" className="space-y-2">
            {chargeable.map(({ c, parts }) => (
              <li key={c.id}>
                <Link href={`/app/sessions/${c.id}#part-${parts[0].kind}`} className="card card-hover flex flex-wrap items-center gap-3 border-amber-400/30 p-4 no-underline hover:no-underline">
                  <p className="min-w-[12rem] flex-1 truncate font-medium text-white" title={`${c.title} · ${plural(parts.length, "part")}`}>{c.title} · {plural(parts.length, "part")} {pausedTest(c.test) && <PausedTag />}</p>
                  <span className="btn px-3 py-1.5 text-sm">Charge or let it go <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
          </LongList>
        </section>
      )}

      <section className="space-y-3" id="to-do">
        {sectionTitle(<ListTodo className="h-5 w-5 text-indigo-300" />, "To do")}
        {todoParts.length === 0 && answers.length === 0 ? (
          <p className="card text-sm text-slate-400">{suspended ? "Nothing to do while your account is suspended." : "Nothing to finish. Pick up a new test below."}</p>
        ) : (
          <LongList shown={3} tall="max-h-96" className="space-y-2">
            {answers.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="card card-hover flex flex-wrap items-center gap-3 border-sky-300/40 p-4 no-underline hover:no-underline">
                  <CategoryTile category={mainCategory(a.c.test.categories)} size="h-10 w-10" />
                  <div className="min-w-[12rem] flex-1">
                    <p className="flex min-w-0 items-center gap-1 font-semibold text-white"><span className="truncate" title={a.c.title}>{a.c.title}</span> {pausedTest(a.c.test) && <span className="shrink-0"><PausedTag /></span>}</p>
                    <p className="text-sm text-slate-400">{a.text}</p>
                  </div>
                  <span className="btn px-3 py-1.5 text-sm">{a.cta} <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
            {todoParts.map(({ c, p }) => {
              const due = daysLeft(c.dueAt);
              const messages = unread.get(c.id) ?? 0;
              return (
                <li key={`${c.id}-${p.key}`} className="card flex flex-wrap items-center gap-3 p-4" data-todo-part={`${c.id}:${p.key}`}>
                  <CategoryTile category={mainCategory(c.test.categories)} size="h-10 w-10" />
                  <div className="min-w-[12rem] flex-1">
                    <p className="flex min-w-0 items-center gap-1 font-semibold text-white"><span className="truncate" title={`${c.title} · ${p.name}`}>{c.title} · {p.name}</span> {pausedTest(c.test) && <span className="shrink-0"><PausedTag /></span>}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> Due {fmtDate(c.dueAt)}{due ? ` · ${due}` : ""}</span>
                      {messages > 0 && <span className="badge border-fuchsia-300/40 text-fuchsia-200"><MessagesSquare className="h-3.5 w-3.5" /> {plural(messages, "unread message")}</span>}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-emerald-300">{p.cents === 0 ? "free" : money(testerShare(p.cents))}</span>
                  <Link href={`/app/sessions/${c.id}#part-${p.key}`} className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Send work <ArrowRight className="h-4 w-4" /></Link>
                </li>
              );
            })}
          </LongList>
        )}
      </section>

      {(waiting.length > 0 || apps.length > 0) && (
        <section className="space-y-3">
          {sectionTitle(<Hourglass className="h-5 w-5 text-amber-300" />, "Waiting for the developer")}
          <LongList shown={3} tall="max-h-72" className="space-y-2">
            {apps.map((a) => (
              <li key={a.id}>
                <Link href={`/app/find/${a.testId}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                  <p className="min-w-[12rem] flex-1 truncate font-medium text-white" title={appTests.get(a.testId)?.title ?? "A test"}>{appTests.get(a.testId)?.title ?? "A test"} {appTests.get(a.testId) && pausedTest(appTests.get(a.testId)!) && <PausedTag />}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> {a.kind === "rejoin" ? "Ask to rejoin waiting" : "Application waiting"}</span>
                </Link>
              </li>
            ))}
            {waiting.map(({ c, s }) => {
              const inner = (
                <>
                  <p className="min-w-[12rem] flex-1 truncate font-medium text-white" title={c.title}>{c.title} {pausedTest(c.test) && <PausedTag />}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> {s.kind === "recording" ? "Screen recording" : "Written answers"} sent: waiting for review</span>
                </>
              );
              return (
                <li key={s.id}>
                  {/* (Owner, Oct 28) Suspended: the session page is closed, so the row doesn't open. */}
                  {suspended ? <div className="card flex flex-wrap items-center gap-3 p-4" data-waiting-plain="">{inner}</div> : <Link href={`/app/sessions/${c.id}#parts`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">{inner}</Link>}
                </li>
              );
            })}
          </LongList>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3" id="upcoming-calls">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="h-5 w-5 text-amber-300" /> Upcoming calls <span className="text-sm font-normal text-slate-400">next 7 days</span></h2>
          <div className="card p-3">
            <LongList shown={4} tall="max-h-72" className="divide-y divide-white/5">
              {upcoming.map(({ c, x }) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/app/sessions/${c.id}#live`} className="mr-auto min-w-0 truncate text-slate-200 no-underline hover:underline" title={`${displayName(c.test.developer)} · ${c.title}`}><b className="text-white">{displayName(c.test.developer)}</b> · {c.title} · {fmtDateTime(x.startsAt)} · {x.minutes} min <ArrowRight className="inline h-4 w-4 text-indigo-300" /></Link>
                </li>
              ))}
            </LongList>
          </div>
        </section>
      )}

      {!suspended && invites.length > 0 && (
        <section className="space-y-3" id="invitations">
          {sectionTitle(<Inbox className="h-5 w-5 text-emerald-300" />, "Invitations", invites.length)}
          <LongList shown={3} tall="max-h-64" className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="info flex flex-wrap items-center gap-2">
                <Link href={`/app/find/${i.testId}`} className="mr-auto min-w-0 truncate" title={`${displayName(i.test.developer)} invited you to “${i.test.title}”`}>
                  {displayName(i.test.developer)} invited you to “{i.test.title}”. Accept opens the test page. {pausedTest(i.test) && <PausedTag />}
                </Link>
                <Link href={`/app/find/${i.testId}`} className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Accept</Link>
                <NoThanks inviteId={i.id} />
              </li>
            ))}
          </LongList>
        </section>
      )}

      {!suspended && left.length > 0 && (
        <section className="space-y-3" id="rejoin">
          {sectionTitle(<RotateCcw className="h-5 w-5 text-sky-300" />, "Tests you left", left.length)}
          <LongList shown={3} tall="max-h-72" className="space-y-2">{left.map((c) => leftCard(c))}</LongList>
        </section>
      )}

      {!suspended && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Compass className="h-5 w-5 text-fuchsia-300" /> New tests for you</h2>
            <Link href="/app/find" className="text-sm text-indigo-300 hover:underline">See all</Link>
          </div>
          {more.length === 0 ? (
            <p className="card text-sm text-slate-400">
              No new matches right now. <Link href="/app/profile" className="text-indigo-300 hover:underline">Add more devices or languages</Link> to see more.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {more.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/find/${t.id}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                    <CategoryTile category={mainCategory(t.categories)} size="h-10 w-10" />
                    <div className="min-w-[12rem] flex-1">
                      {t.productName && <p className="kicker truncate" title={t.productName}>{t.productName}</p>}
                      <p className="truncate font-semibold text-white" title={t.title}>{t.title}</p>
                      <div className="mt-1 flex flex-wrap gap-2"><PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} /><CategoryBadges categories={t.categories} /></div>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-sm font-semibold text-emerald-300">{pays(asListing(t))}</p>
                      <p className="text-xs text-slate-500">{plural(t.spots - t._count.contracts, "spot")} left</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">History</h2>
          <LongList shown={3} tall="max-h-96" className="space-y-2">
            {history.sort(byEnd).map((c) => {
              const rejected = c.submissions.some((s) => s.review?.rejected) && !c.submissions.some((s) => s.review && !s.review.rejected);
              const mine = allOffers.filter((o) => o.contractId === c.id);
              const pays = payments.filter((p) => p.contractId === c.id && (p.status === "charged" || p.status === "not_set_up"));
              return (
                <li key={c.id}>
                  <details className="card p-4" data-history={c.id}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1 font-medium text-white">
                        <span className="block truncate" title={c.title}>{c.title}</span>
                        <span className="block text-sm font-normal text-slate-400">{c.endKind === "stopped" ? `The test was stopped (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.` : c.endKind === "closed" ? `The test ended (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.` : c.status === "left" ? `You left this test (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.` : `Ended (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.`}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5 text-xs"><PartBadges written={c.writtenCents != null} recording={c.recordingCents != null} live={c.liveRateCents != null} /></span>
                      {rejected && <span className="badge text-rose-300"><XCircle className="h-3.5 w-3.5" /> Not accepted</span>}
                    </summary>
                    {/* (Design doc 5) The deal history: the terms joined on, every offer and what was chosen, and the payments. */}
                    <ul className="mt-3 space-y-1 border-l border-white/10 pl-3 text-sm text-slate-300" data-deal-history="">
                      <li>{fmtDate(c.joinedAt)}: joined on {termsLine(c, true)}{c.ndaAcceptedAt ? ` · NDA accepted ${fmtDate(c.ndaAcceptedAt)}` : ""}</li>
                      {mine.map((o) => <li key={o.id}>{fmtDate(o.createdAt)}: new terms offered ({o.diff}): {o.status === "switched" ? "you switched" : o.status === "kept" ? "you kept yours" : o.status === "open" ? "waiting for your answer" : "replaced by a newer offer"}</li>)}
                      {pays.map((p) => <li key={p.id}>{fmtDate(p.createdAt)}: paid {money(testerShare(p.amountCents))} to you</li>)}
                    </ul>
                    {!suspended && <p className="mt-2 text-sm"><Link href={`/app/sessions/${c.id}#parts`}>Open the session</Link></p>}
                  </details>
                </li>
              );
            })}
          </LongList>
        </section>
      )}
    </>
  );
}
