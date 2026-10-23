import { notFound, redirect } from "next/navigation";
import { ArrowRight, BarChart3, CalendarClock, CheckCircle2, Clock, FileSignature, FileText, HelpCircle, Languages, Lock, Monitor, Radio, Timer, Users, Video } from "lucide-react";
import { CategoryBadges } from "@/components/Category";
import { CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { db } from "@/lib/db";
import { displayName, fmtDate, money } from "@/lib/format";
import { termsLine, testerShare } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, needsLines } from "@/lib/server/tests";
import { JoinBox } from "./JoinBox";
import { LiveTop } from "@/components/LiveTop";
import { qOptional, qText } from "@/lib/questions";
import { ratingSummary } from "@/lib/server/ratings";
import { Chat } from "@/components/Chat";
import { chatMessages } from "@/lib/server/messages";
import { NoThanksButton } from "./NoThanksButton";
import { gapsOf } from "@/lib/gaps";
import { developerStats } from "@/lib/server/profileStats";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
// What each part adds to the session (the full app's "How it works").
const STEPS = {
  written: "Answer the questions in a short written report",
  recording: "Record your screen and talk out loud while you try it, then send the recording",
  live: "Request a call time, try it live while the developer watches",
};

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const t = await db.test.findUnique({ where: { id }, include: { developer: true } });
  if (!t || t.status === "draft") notFound();
  const mine = await db.contract.findUnique({ where: { testId_testerId: { testId: id, testerId: u.id } } });
  if (mine && mine.status === "working") redirect(`/app/sessions/${mine.id}`);
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const profile = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const gaps = needsLines(t, profile);
  const canChat = !!(await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } })) || !!(await db.application.findFirst({ where: { testId: t.id, testerId: u.id, status: "pending" } }));
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const chatClosed = blocked;
  const l = asListing(t);
  const devRating = await ratingSummary(t.developerId);
  const devStats = await developerStats(t.developerId);
  const ratedHere = mine ? (await db.rating.count({ where: { contractId: mine.id } })) > 0 : false;
  const invite = await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } });
  const seenAt = new Date().toISOString();
  const closed = t.status !== "open" || testersIn >= t.spots || (t.openUntil && t.openUntil < new Date());
  const dev = displayName(t.developer);
  const dueIfNow = fmtDate(new Date(Date.now() + t.deadlineDays * 86_400_000));
  const parts = [
    { key: "written" as const, on: t.writtenCents != null, cents: t.writtenCents, required: t.writtenRequired, title: "Written answers", icon: <FileText className="h-4 w-4" /> },
    { key: "recording" as const, on: t.recordingCents != null, cents: t.recordingCents, required: t.recordingRequired, title: "Screen recording", icon: <Video className="h-4 w-4" /> },
    { key: "live" as const, on: t.liveRateCents != null, cents: t.liveRateCents, required: t.liveRequired, title: "Live call", icon: <Radio className="h-4 w-4" /> },
  ].filter((p) => p.on);
  const fixed = [t.writtenCents, t.recordingCents].filter((c): c is number => c != null);
  const big = fixed.length ? money(testerShare(Math.min(...fixed))) : t.liveRateCents != null && t.liveRateCents > 0 ? `${money(testerShare(t.liveRateCents))}/h` : "Free";
  // The full app's test page: the header card (tile, title, by, price, badges, description), the invitation, how it works and
  // what the developer wants to know, "Your deal", how the developer reviews, then the Join box.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p><a href="/app/find">← All tests</a></p>
      {t.developerId !== u.id && <LiveTop scope={`listing:${t.id}`} seenAt={seenAt} seeIt="#listing" />}
      <section className="card space-y-4" id="listing">
        <div className="flex items-start gap-4">
          <CategoryTile category={mainCategory(t.categories)} size="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">{t.title}</h1>
            <p className="text-sm text-slate-400">
              by <a href={`/app/developers/${t.developerId}`} className="text-slate-200">{dev}</a>{devRating.line && ` · ${devRating.line}`}
              {invite ? <span className="badge ml-2 border-emerald-400/40 text-emerald-200">Invited</span> : t.joinMode === "apply" && <span className="badge ml-2 border-sky-300/40 text-sky-200">{dev} approves each tester</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-emerald-300">{(fixed.length > 1 || (fixed.length && t.liveRateCents != null)) && <span className="text-sm font-medium">from </span>}{big}</p>
            <p className="text-xs text-slate-500">paid when accepted</p>
            <p className="text-xs text-slate-500">You get 80% of each price</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CategoryBadges categories={t.categories} />
          <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
          {t.devices.length > 0 && <span className="badge"><Monitor className="h-3.5 w-3.5" /> {t.devices.join(" · ")}</span>}
          {t.languages.length > 0 && <span className="badge"><Languages className="h-3.5 w-3.5" /> {t.languages.join(", ")}</span>}
          {t.status === "open" && <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"} to finish</span>}
          <span className="badge"><Users className="h-3.5 w-3.5" /> {plural(testersIn, "tester")} on this test</span>
        </div>
        {t.description && <p className="whitespace-pre-wrap text-slate-300">{t.description}</p>}
        {devRating.comments.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">What testers said</summary>
            <ul className="list-disc pl-5">{devRating.comments.map((cm, i) => <li key={i}>“{cm}”</li>)}</ul>
          </details>
        )}
      </section>

      {/* (An invitation shows here, as in the full app: who invited you, how long you'd have, No thanks.) */}
      {invite && !blocked && (
        <section className="card flex flex-wrap items-start gap-3 border-emerald-400/30">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold text-white">{dev} invited you</p>
            <p className="text-sm text-slate-300">You&apos;ll have {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"} (until {dueIfNow} if you accept now).</p>
            <p className="text-xs text-slate-400">Join below straight away{t.joinMode === "apply" ? ", no need to apply" : ""}.</p>
          </div>
          <NoThanksButton inviteId={invite.id} seenAt={seenAt} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold text-white">How it works</h2>
          <ol className="space-y-2 text-sm text-slate-300">
            {["Join the test and open the product with the link", ...parts.map((p) => STEPS[p.key])].map((s, i) => (
              <li key={s} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs text-indigo-200">{i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="card space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-white"><HelpCircle className="h-5 w-5 text-indigo-300" /> {dev} wants to know</h2>
          {l.questions.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">{l.questions.map((q) => <li key={q}>{qText(q)}{qOptional(q) && <span className="text-ink-500"> · not required</span>}</li>)}</ul>
          ) : (
            <p className="text-sm text-slate-400">Where you got stuck, any bugs, and what you liked.</p>
          )}
        </div>
      </section>

      <section className="card space-y-4 border-indigo-400/30">
        <h2 className="flex items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your deal</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {parts.map((p) => (
            <div key={p.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-deal-part={p.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-white">{p.icon} {p.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${p.required ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-slate-400"}`}>{p.required ? "Required" : "Not required"}</span>
              </div>
              {p.cents === 0 ? (
                <p className="mt-2 text-lg font-bold text-sky-200">Free (unpaid)</p>
              ) : (
                <>
                  <p className="mt-2 text-lg font-bold text-emerald-300">{money(testerShare(p.cents!))}{p.key === "live" && <span className="text-sm font-normal text-slate-400">/h</span>}</p>
                  {p.key === "live" && <p className="text-xs text-slate-400">For the call&apos;s real length.</p>}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          <b>What you get:</b> {termsLine(l, true)}. You&apos;re paid for each part you deliver.
        </p>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          {t.status === "open" && <span className="chip" title="Your clock starts when you're in"><Clock className="h-3.5 w-3.5" /> {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"} to finish, counted from when you join</span>}
          {t.openUntil && <span className="chip"><CalendarClock className="h-3.5 w-3.5" /> New testers can join until {fmtDate(t.openUntil)}</span>}
          <span className="chip" title="If the developer doesn't review it in time, you choose: charge them, or let it go"><Timer className="h-3.5 w-3.5" /> Not reviewed in 14 days? You choose</span>
          <span className="chip" title="Later edits to the test come to you as a request: switch to the new terms or keep yours"><Lock className="h-3.5 w-3.5" /> Locked in when you join</span>
          <span className="chip"><CheckCircle2 className="h-3.5 w-3.5" /> {t.spots - testersIn} spot{t.spots - testersIn === 1 ? "" : "s"} left</span>
        </div>
        <p className="note">Everything above is fixed in your contract when you join. If the developer changes the listing later, they can offer you the new terms: you choose Switch or Keep.</p>
      </section>

      <section className="card space-y-2">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold text-white"><BarChart3 className="h-5 w-5 text-sky-300" /> How {dev} reviews</h2>
          <ul className="space-y-1 text-sm text-slate-300">
            <li>Pays on average: {devStats.pays.value} <span className="text-slate-500">· {devStats.pays.hint}</span></li>
            <li>Typical review: {devStats.review.value}</li>
            <li>Rating: {devRating.line || "no ratings yet"}</li>
          </ul>
          <a href={`/app/developers/${t.developerId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-sky-300">See their profile and other tests <ArrowRight className="h-4 w-4" /></a>
        </div>
      </section>

      {ratedHere && <p className="info">{mine?.status === "left" && mine.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again."}</p>}
      {mine && mine.status === "left" && !ratedHere && <p className="info">You left this test. Joining again restores your session: work you sent, payments and chat stay; new work is on the current listing.</p>}
      {t.developerId === u.id ? (
        <div className="card flex flex-wrap items-center gap-3">
          <p className="flex-1 text-slate-200">This is your own test: this is how testers see it. You can&apos;t test it yourself.</p>
          <a href={`/app/tests/${t.id}`} className="btn-secondary no-underline hover:no-underline">Manage it as the developer <ArrowRight className="h-4 w-4" /></a>
        </div>
      ) : !u.isTester ? (
        <p className="card note">Turn on “test apps, games and more” in your <a href="/app/profile">profile</a> to join.</p>
      ) : blocked ? (
        <p className="card note">This test isn&apos;t taking new testers right now.</p>
      ) : closed && invite && t.status === "open" && testersIn >= t.spots ? (
        <p className="info">{t.title} is full right now. Your invite stays open; we&apos;ll tell you when a spot opens.</p>
      ) : closed ? (
        <p className="err">{t.status === "stopped" ? "This test was stopped." : testersIn >= t.spots ? "This test is full." : "This test isn't taking new testers any more."}</p>
      ) : (
        <>{gaps.map((g) => <p key={g} className="info">{g}</p>)}</>
      )}
      {t.developerId === u.id || !u.isTester || closed || blocked || ratedHere ? null : (
        <section className="card space-y-3">
          <JoinBox
            testId={t.id}
            seenAt={seenAt}
            mode={t.joinMode}
            invited={!!invite}
            inviteId={invite?.id ?? null}
            missing={gapsOf(t, profile)}
            application={await db.application.findUnique({ where: { testId_testerId: { testId: t.id, testerId: u.id } } }).then((a) => (a ? { status: a.status, changed: !!a.changedAt } : null))}
          />
        </section>
      )}

      {canChat && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold text-white">Chat with {dev}</summary>
          <div className="pt-3">
            <Chat
              closed={chatClosed}
              keepKey={`chat:${t.id}:${u.id}`}
              path={`/api/tests/${t.id}/message`}
              extra={{ testerId: u.id }}
              other={dev}
              messages={(await chatMessages(t.id, u.id)).map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
            />
          </div>
        </details>
      )}
    </div>
  );
}
