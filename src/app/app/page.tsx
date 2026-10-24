import Link from "next/link";
import { ArrowRight, Award, CalendarClock, CheckCircle2, Clock, Compass, Hourglass, Inbox, LayoutGrid, ListTodo, MessagesSquare, PlusCircle, Users, Wallet, XCircle, AppWindow } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { sideFor } from "@/lib/sides";
import { ProfileForm } from "./profile/ProfileForm";
import { NoThanks } from "./NoThanks";
import { CapacityCard, DeveloperTiles } from "@/components/ProfileTiles";
import { StatTile } from "@/components/StatTile";
import { CategoryBadges } from "@/components/Category";
import { CategoryChips, CategoryTile, daysLeft, FeedbackBar, mainCategory, PartBadges, Seats, StatusPill } from "@/components/Ui";
import { termsLine, testerShare } from "@/lib/rules";
import { ratingSummary } from "@/lib/server/ratings";
import { unreadCount } from "@/lib/server/messages";
import { asListing, findTests } from "@/lib/server/tests";

export const metadata = { title: "Home · Playtest" };
export const dynamic = "force-dynamic";

/** A card's one link, stretched over the whole card (the full app's CARD_LINK). */
const CARD_LINK = "after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-volt-300";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const wordsOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** What the tester gets, without the days ("Written $8.00 · Recording $9.60"). */
const pays = (t: Parameters<typeof termsLine>[0]) => termsLine(t, true).split(" · ").slice(0, -1).join(" · ");

export default async function AppHome({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const u = await requirePageUser();
  const { category } = await searchParams;
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
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Welcome back,</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{u.name || u.email}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {side === "developer" && <Link className="btn" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
          {side === "tester" && <Link className="btn" href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
        </div>
      </div>
      {/* (NEXT-UI 6) One side at a time: the dashboard of the side in use (the header switch changes it). */}
      {side === "developer" && <DeveloperDashboard userId={u.id} now={now} category={category} />}
      {side === "tester" && <TesterDashboard userId={u.id} now={now} />}
    </div>
  );
}

// ---------------------------------------------------------------- developer (the full app's dev/page.tsx)

async function DeveloperDashboard({ userId, now, category }: { userId: string; now: Date; category?: string }) {
  const allTests = await db.test.findMany({
    where: { developerId: userId },
    orderBy: { createdAt: "desc" },
    include: { contracts: { include: { tester: true, submissions: { include: { review: true } }, calls: { include: { review: true } } } } },
  });
  const testIds = allTests.map((t) => t.id);
  const [apps, reqs, spent, unreadList] = await Promise.all([
    db.application.findMany({ where: { testId: { in: testIds }, status: "pending" }, orderBy: { createdAt: "asc" } }),
    db.callRequest.findMany({ where: { testId: { in: testIds }, status: "pending", fromSide: "tester", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } }),
    db.payment.aggregate({ where: { developerId: userId, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }),
    Promise.all(allTests.flatMap((t) => t.contracts.map(async (c) => [c.id, await unreadCount(userId, t.id, c.testerId)] as const))),
  ]);
  const unread = new Map(unreadList);
  const applicants = new Map((await db.user.findMany({ where: { id: { in: apps.map((a) => a.testerId) } } })).map((x) => [x.id, displayName(x)]));
  const categoryCounts: Record<string, number> = {};
  for (const t of allTests) for (const c of t.categories) categoryCounts[c] = (categoryCounts[c] ?? 0) + 1;
  const tests = category ? allTests.filter((t) => t.categories.includes(category)) : allTests;
  // Each part sent and waiting for review (written answers, a recording, a held live call), oldest first.
  const toReview = allTests
    .flatMap((t) => t.contracts.flatMap((c) => [
      ...c.submissions.filter((s) => !s.review).map((s) => ({ test: t, c, at: s.sentAt, id: s.id, what: s.kind === "recording" ? "recording" : "written answers" })),
      ...c.calls.filter((x) => x.status === "booked" && x.startsAt <= now && !x.review).map((x) => ({ test: t, c, at: x.startsAt, id: x.id, what: "live call" })),
    ]))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const testersTotal = allTests.reduce((n, t) => n + t.contracts.filter((c) => c.status === "working").length, 0);
  const contractTest = new Map(allTests.flatMap((t) => t.contracts.map((c) => [c.id, { t, c }] as const)));
  const initial = (name: string) => name.trim().charAt(0).toUpperCase();
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Inbox} label="Parts to review" value={String(toReview.length)} hint="written answers, recordings, calls" tone="amber" />
        <StatTile icon={Users} label="Testers joined" value={String(testersTotal)} hint={`across ${allTests.length} test${allTests.length === 1 ? "" : "s"}`} tone="indigo" />
        <StatTile icon={Wallet} label="Spent so far" value={money(spent._sum.amountCents ?? 0)} hint="accepted work" tone="emerald" />
      </section>
      <div className="space-y-4">
        <DeveloperTiles userId={userId} />
        <CapacityCard userId={userId} />
      </div>

      {(toReview.length > 0 || apps.length > 0 || reqs.length > 0) && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Needs your attention
          </h2>
          <ul className="space-y-2">
            {toReview.map((r) => (
              <li key={r.id}>
                <Link href={`/app/tests/${r.test.id}#tester-${r.c.id}`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950">{initial(displayName(r.c.tester))}</span>
                  <p className="min-w-0 flex-1 text-slate-300">
                    <span className="font-medium text-white">{displayName(r.c.tester)}</span> sent their {r.what} for <span className="font-medium text-white">{r.test.title}</span>
                  </p>
                  <span className="flex items-center gap-1 text-sm text-indigo-300">Review <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
            {apps.map((a) => {
              const t = allTests.find((x) => x.id === a.testId)!;
              const name = applicants.get(a.testerId) ?? "A tester";
              return (
                <li key={a.id}>
                  <Link href={`/app/tests/${t.id}`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950">{initial(name)}</span>
                    <p className="min-w-0 flex-1 text-slate-300"><span className="font-medium text-white">{name}</span> applied to join · <span className="font-medium text-white">{t.title}</span></p>
                    <span className="flex items-center gap-1 text-sm text-indigo-300">Answer <ArrowRight className="h-4 w-4" /></span>
                  </Link>
                </li>
              );
            })}
            {reqs.map((r) => {
              const x = contractTest.get(r.contractId);
              if (!x) return null;
              const name = displayName(x.c.tester);
              return (
                <li key={r.id}>
                  <Link href={`/app/tests/${x.t.id}#calls`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-sm font-semibold text-ink-950">{initial(name)}</span>
                    <p className="min-w-0 flex-1 text-slate-300"><span className="font-medium text-white">{name}</span> asked for a live call · <span className="font-medium text-white">{x.t.title}</span></p>
                    <span className="flex items-center gap-1 text-sm text-indigo-300">Answer <ArrowRight className="h-4 w-4" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
            <Link href="/app/tests/new" className="btn mt-2"><PlusCircle className="h-4 w-4" /> Post a test</Link>
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {tests.map((t) => {
              const inIt = t.contracts.filter((c) => c.status === "working");
              const accepted = t.contracts.filter((c) => c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const waiting = t.contracts.filter((c) => c.submissions.some((s) => !s.review) && !c.submissions.some((s) => s.review && !s.review.rejected)).length;
              const messages = t.contracts.reduce((n, c) => n + (unread.get(c.id) ?? 0), 0);
              return (
                <li key={t.id}>
                  {/* The whole card opens the test: its title's link stretches over it. */}
                  <div className="card card-hover relative block h-full space-y-4">
                    <div className="flex items-start gap-3">
                      <CategoryTile category={mainCategory(t.categories)} />
                      <div className="min-w-0 space-y-2">
                        <p className="text-lg font-semibold text-white"><Link href={`/app/tests/${t.id}`} className={`${CARD_LINK} no-underline hover:no-underline`}>{t.title}</Link></p>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill status={t.status} />
                          <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
                          <span className="badge" title="Each tester's deadline counts from when they join"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} days per tester</span>
                          {messages > 0 && <span className="badge border-fuchsia-300/40 text-fuchsia-200"><MessagesSquare className="h-3.5 w-3.5" /> {plural(messages, "unread message")}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Testers · {inIt.length} of {t.spots}</p>
                      <Seats total={t.spots} people={inIt.map((c) => ({ id: c.testerId, name: displayName(c.tester) }))} />
                    </div>
                    <div className="space-y-1.5">
                      <p className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                        <span>Feedback</span>
                        <span className="flex items-center gap-1 normal-case">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {accepted}
                          <Inbox className="ml-2 h-3.5 w-3.5 text-amber-300" /> {waiting}
                        </span>
                      </p>
                      <FeedbackBar accepted={accepted} waiting={waiting} total={t.spots} />
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

async function TesterDashboard({ userId, now }: { userId: string; now: Date }) {
  const contracts = await db.contract.findMany({
    where: { testerId: userId },
    orderBy: { joinedAt: "desc" },
    include: { test: { include: { developer: true } }, submissions: { include: { review: true } } },
  });
  const ids = contracts.map((c) => c.id);
  const me = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const [offers, devReqs, apps, paid, rating, invites, unreadList, recommended] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId: { in: ids }, status: "open" } }),
    db.callRequest.findMany({ where: { contractId: { in: ids }, status: "pending", fromSide: "developer", startsAt: { gt: now } } }),
    db.application.findMany({ where: { testerId: userId, status: "pending" }, orderBy: { createdAt: "asc" } }),
    db.payment.aggregate({ where: { testerId: userId, status: { in: ["charged", "not_set_up"] } }, _sum: { testerCents: true } }),
    ratingSummary(userId),
    db.invite.findMany({ where: { testerId: userId, status: "sent", test: { status: "open" } }, include: { test: { include: { developer: true } } } }),
    Promise.all(contracts.map(async (c) => [c.id, await unreadCount(userId, c.testId, c.testerId)] as const)),
    findTests(me),
  ]);
  const unread = new Map(unreadList);
  const appTests = new Map((await db.test.findMany({ where: { id: { in: apps.map((a) => a.testId) } } })).map((t) => [t.id, t]));
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const working = contracts.filter((c) => c.status === "working");
  const history = contracts.filter((c) => c.status !== "working");
  const toSend = (c: (typeof contracts)[number]) => [
    ...(c.writtenCents != null && !c.submissions.some((s) => s.kind === "written") ? ["written answers"] : []),
    ...(c.recordingCents != null && !c.submissions.some((s) => s.kind === "recording") ? ["recording"] : []),
  ];
  // Sent and waiting for the developer's review.
  const waiting = contracts.flatMap((c) => c.submissions.filter((s) => !s.review).map((s) => ({ c, s })));
  const pendingCents = waiting.reduce((n, { s }) => n + (s.agreedCents != null ? testerShare(s.agreedCents) : 0), 0);
  const todo = working.filter((c) => toSend(c).length > 0);
  const answers = [
    ...offers.flatMap((o) => { const c = byId.get(o.contractId); return c ? [{ key: `offer-${o.id}`, c, text: `${displayName(c.test.developer)} offered new terms: ${o.diff}`, href: `/app/sessions/${c.id}`, cta: "Switch or keep your terms" }] : []; }),
    ...devReqs.flatMap((r) => { const c = byId.get(r.contractId); return c ? [{ key: `req-${r.id}`, c, text: `${displayName(c.test.developer)} asked for a live call`, href: `/app/sessions/${c.id}#calls`, cta: "Accept or decline" }] : []; }),
  ];
  const more = recommended.filter((t) => !t.contracts.some((c) => c.status === "working")).slice(0, 4);
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Wallet} label="Earned" value={money(paid._sum.testerCents ?? 0)} hint="what you got for accepted work" tone="emerald" />
        <StatTile icon={Hourglass} label="Waiting for review" value={money(pendingCents)} hint={`${waiting.length} part${waiting.length === 1 ? "" : "s"}`} tone="amber" />
        <StatTile icon={Award} label="Rating" value={rating.n ? `${rating.avg.toFixed(1)} ★` : "-"} hint={rating.n ? `${rating.n} rating${rating.n === 1 ? "" : "s"}` : "no ratings yet"} tone="fuchsia" />
        <StatTile icon={ListTodo} label="To do" value={String(todo.reduce((n, c) => n + toSend(c).length, 0) + answers.length)} hint={answers.length ? `${answers.length} waiting for your answer` : "parts to send"} tone="indigo" />
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><ListTodo className="h-5 w-5 text-indigo-300" /> To do</h2>
        {invites.map((i) => (
          <div key={i.id} className="info flex flex-wrap items-center gap-2">
            <Link href={`/app/find/${i.testId}`} className="mr-auto">
              {displayName(i.test.developer)} invited you to “{i.test.title}”. Open it and press Join.
            </Link>
            <NoThanks inviteId={i.id} />
          </div>
        ))}
        {todo.length === 0 && answers.length === 0 ? (
          <p className="card text-sm text-slate-400">Nothing to finish. Pick up a new test below.</p>
        ) : (
          <ul className="space-y-2">
            {answers.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="card card-hover flex flex-wrap items-center gap-3 border-sky-300/40 p-4 no-underline hover:no-underline">
                  <CategoryTile category={mainCategory(a.c.test.categories)} size="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{a.c.title}</p>
                    <p className="text-sm text-slate-400">{a.text}</p>
                  </div>
                  <span className="btn px-3 py-1.5 text-sm">{a.cta} <ArrowRight className="h-4 w-4" /></span>
                </Link>
              </li>
            ))}
            {todo.map((c) => {
              const due = daysLeft(c.dueAt);
              const messages = unread.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <Link href={`/app/sessions/${c.id}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                    <CategoryTile category={mainCategory(c.test.categories)} size="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">{c.title}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <PartBadges written={c.writtenCents != null} recording={c.recordingCents != null} live={c.liveRateCents != null} />
                        {due && <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> {due}</span>}
                        <span className="badge text-slate-200">To send: {wordsOf(toSend(c))}</span>
                        {messages > 0 && <span className="badge border-fuchsia-300/40 text-fuchsia-200"><MessagesSquare className="h-3.5 w-3.5" /> {plural(messages, "unread message")}</span>}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-emerald-300">{pays(c)}</span>
                    <span className="btn px-3 py-1.5 text-sm">Open <ArrowRight className="h-4 w-4" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(waiting.length > 0 || apps.length > 0) && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Hourglass className="h-5 w-5 text-amber-300" /> Waiting for the developer</h2>
          <ul className="space-y-2">
            {apps.map((a) => (
              <li key={a.id}>
                <Link href={`/app/find/${a.testId}`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                  <p className="min-w-0 flex-1 font-medium text-white">{appTests.get(a.testId)?.title ?? "A test"}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> Application waiting</span>
                </Link>
              </li>
            ))}
            {waiting.map(({ c, s }) => (
              <li key={s.id}>
                <Link href={`/app/sessions/${c.id}#parts`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                  <p className="min-w-0 flex-1 font-medium text-white">{c.title}</p>
                  <span className="badge text-amber-300"><Clock className="h-3.5 w-3.5" /> {s.kind === "recording" ? "Screen recording" : "Written answers"} sent: waiting for review</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <Link href={`/app/find/${t.id}`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                  <CategoryTile category={mainCategory(t.categories)} size="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{t.title}</p>
                    <div className="mt-1 flex flex-wrap gap-2"><PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} /><CategoryBadges categories={t.categories} /></div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-emerald-300">{pays(asListing(t))}</p>
                    <p className="text-xs text-slate-500">{plural(t.spots - t._count.contracts, "spot")} left</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">History</h2>
          <ul className="space-y-2">
            {history.map((c) => {
              const rejected = c.submissions.some((s) => s.review?.rejected) && !c.submissions.some((s) => s.review && !s.review.rejected);
              return (
                <li key={c.id}>
                  <Link href={`/app/sessions/${c.id}#parts`} className="card card-hover flex flex-wrap items-center gap-3 p-4 no-underline hover:no-underline">
                    <p className="min-w-0 flex-1 font-medium text-white">
                      {c.title}
                      <span className="block text-sm font-normal text-slate-400">{c.status === "left" ? `You left this test (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.` : `Ended (${fmtDate(c.endedAt ?? c.joinedAt)}): what you sent is still reviewed and paid.`}</span>
                    </p>
                    <span className="flex flex-wrap gap-1.5 text-xs"><PartBadges written={c.writtenCents != null} recording={c.recordingCents != null} live={c.liveRateCents != null} /></span>
                    {rejected && <span className="badge text-rose-300"><XCircle className="h-3.5 w-3.5" /> Not accepted</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
