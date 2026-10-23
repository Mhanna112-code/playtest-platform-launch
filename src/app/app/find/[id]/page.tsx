import { notFound, redirect } from "next/navigation";
import { CalendarClock, FileSignature, HelpCircle, Languages, Monitor, Users } from "lucide-react";
import { CategoryBadges } from "@/components/Category";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, needsLines } from "@/lib/server/tests";
import { JoinBox } from "./JoinBox";
import { gapsOf } from "@/lib/gaps";
import { LiveTop } from "@/components/LiveTop";
import { qOptional, qText } from "@/lib/questions";
import { ratingSummary } from "@/lib/server/ratings";
import { Chat } from "@/components/Chat";
import { chatMessages } from "@/lib/server/messages";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

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
  const chatClosed = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const l = asListing(t);
  const devRating = await ratingSummary(t.developerId);
  const ratedHere = mine ? (await db.rating.count({ where: { contractId: mine.id } })) > 0 : false;
  const invite = await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } });
  const seenAt = new Date().toISOString();
  const closed = t.status !== "open" || testersIn >= t.spots || (t.openUntil && t.openUntil < new Date());
  const dev = displayName(t.developer);
  // The full app's test page: the header card (title, by, badges, description), "<dev> wants to know", then "Your deal"
  // with what joining means and the Join box.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p><a href="/app/find">← All tests</a></p>
      {t.developerId !== u.id && <LiveTop scope={`listing:${t.id}`} seenAt={seenAt} seeIt="#listing" />}
      <section className="card space-y-4" id="listing">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">{t.title}</h1>
          <p className="text-sm text-slate-400">
            by <a href={`/app/developers/${t.developerId}`} className="text-slate-200">{dev}</a>{devRating.line && ` · ${devRating.line}`}
            {invite ? <span className="badge ml-2 border-emerald-400/40 text-emerald-200">Invited</span> : t.joinMode === "apply" && <span className="badge ml-2 border-sky-300/40 text-sky-200">{dev} approves each tester</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CategoryBadges categories={t.categories} />
          {t.devices.length > 0 && <span className="badge"><Monitor className="h-3.5 w-3.5" /> {t.devices.join(", ")}</span>}
          {t.languages.length > 0 && <span className="badge"><Languages className="h-3.5 w-3.5" /> {t.languages.join(", ")}</span>}
          {t.status === "open" && <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"} to finish</span>}
          <span className="badge"><Users className="h-3.5 w-3.5" /> {testersIn} tester{testersIn === 1 ? "" : "s"} on this test</span>
        </div>
        {t.description && <p className="whitespace-pre-wrap text-slate-300">{t.description}</p>}
        {devRating.comments.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">What testers said</summary>
            <ul className="list-disc pl-5">{devRating.comments.map((cm, i) => <li key={i}>“{cm}”</li>)}</ul>
          </details>
        )}
      </section>

      {l.questions.length > 0 && (
        <section className="card space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-white"><HelpCircle className="h-5 w-5 text-indigo-300" /> {dev} wants to know</h2>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {l.questions.map((q) => <li key={q} className="flex gap-2"><span className="text-indigo-300">•</span><span>{qText(q)}{qOptional(q) && <span className="text-ink-500"> · not required</span>}</span></li>)}
          </ul>
        </section>
      )}

      <section className="card space-y-4 border-indigo-400/30">
        <h2 className="flex items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your deal</h2>
        <p className="text-sm"><b>What you get:</b> {termsLine(l, true)}</p>
        <p className="note">
          Your deadline counts from when you join: {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"}.
          {t.openUntil && ` New testers can join until ${fmtDate(t.openUntil)}.`} {t.spots - testersIn} spot{t.spots - testersIn === 1 ? "" : "s"} left.
        </p>
        <p className="note">Everything above is fixed in your contract when you join. If the developer changes the listing later, they can offer you the new terms: you choose Switch or Keep.</p>
        {ratedHere && <p className="info">{mine?.status === "left" && mine.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again."}</p>}
        {mine && mine.status === "left" && !ratedHere && <p className="info">You left this test. Joining again restores your session: work you sent, payments and chat stay; new work is on the current listing.</p>}
        {t.developerId === u.id ? (
          <p className="note">This is your test.</p>
        ) : !u.isTester ? (
          <p className="note">Turn on “test apps, games and more” in your <a href="/app/profile">profile</a> to join.</p>
        ) : blocked ? (
          <p className="note">This test isn&apos;t taking new testers right now.</p>
        ) : closed && invite && t.status === "open" && testersIn >= t.spots ? (
          <p className="info">{t.title} is full right now. Your invite stays open; we&apos;ll tell you when a spot opens.</p>
        ) : closed ? (
          <p className="err">{t.status === "stopped" ? "This test was stopped." : testersIn >= t.spots ? "This test is full." : "This test isn't taking new testers any more."}</p>
        ) : (
          <>{gaps.map((g) => <p key={g} className="info">{g}</p>)}</>
        )}
        {t.developerId === u.id || !u.isTester || closed || blocked || ratedHere ? null : (
          <JoinBox
            testId={t.id}
            seenAt={seenAt}
            mode={t.joinMode}
            invited={!!invite}
            inviteId={invite?.id ?? null}
            missing={gapsOf(t, profile)}
            application={await db.application.findUnique({ where: { testId_testerId: { testId: t.id, testerId: u.id } } }).then((a) => (a ? { status: a.status, changed: !!a.changedAt } : null))}
          />
        )}
      </section>

      {canChat && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold text-white">Chat with {dev}</summary>
          <div className="pt-3">
            <Chat
              closed={chatClosed}
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
