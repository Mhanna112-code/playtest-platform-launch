import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, needsLines } from "@/lib/server/tests";
import { JoinBox } from "./JoinBox";
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
  const gaps = needsLines(t, await db.testerProfile.findUnique({ where: { userId: u.id } }));
  const canChat = !!(await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } })) || !!(await db.application.findFirst({ where: { testId: t.id, testerId: u.id, status: "pending" } }));
  const chatClosed = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const l = asListing(t);
  const devRating = await ratingSummary(t.developerId);
  const ratedHere = mine ? (await db.rating.count({ where: { contractId: mine.id } })) > 0 : false;
  const invite = await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } });
  const seenAt = new Date().toISOString();
  const closed = t.status !== "open" || testersIn >= t.spots || (t.openUntil && t.openUntil < new Date());
  return (
    <>
      <p><a href="/app/find">← All tests</a></p>
      {t.developerId !== u.id && <LiveTop scope={`listing:${t.id}`} seenAt={seenAt} seeIt="#listing" />}
      <div className="panel" id="listing">
        <h1>{t.title}</h1>
        <p className="note">by {displayName(t.developer)}{devRating.line && ` · ${devRating.line}`}{t.category && ` · ${t.category}`}</p>
        {devRating.comments.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">What testers said</summary>
            <ul className="list-disc pl-5">{devRating.comments.map((cm, i) => <li key={i}>“{cm}”</li>)}</ul>
          </details>
        )}
        {t.description && <p className="whitespace-pre-wrap text-sm">{t.description}</p>}
        <p className="text-sm"><b>What you get:</b> {termsLine(l, true)}</p>
        <p className="note">
          Your deadline counts from when you join: {t.deadlineDays} day{t.deadlineDays === 1 ? "" : "s"}.
          {t.openUntil && ` New testers can join until ${fmtDate(t.openUntil)}.`} {t.spots - testersIn} spot{t.spots - testersIn === 1 ? "" : "s"} left.
        </p>
        {t.devices.length > 0 && <p className="note">Devices: {t.devices.join(", ")}</p>}
        {t.languages.length > 0 && <p className="note">Languages: {t.languages.join(", ")}</p>}
        {l.questions.length > 0 && (
          <>
            <h3>Questions</h3>
            <ul className="list-disc pl-5 text-sm">
              {l.questions.map((q) => <li key={q}>{qText(q)}{qOptional(q) && <span className="text-ink-500"> · not required</span>}</li>)}
            </ul>
          </>
        )}
        <p className="note">Everything above is fixed in your contract when you join: neither side can change it later.</p>
        {ratedHere && <p className="info">{mine?.status === "left" && mine.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again."}</p>}
        {mine && mine.status === "left" && !ratedHere && <p className="info">You left this test. Joining again restores your session: work you sent, payments and chat stay; new work is on the current listing.</p>}
        {canChat && (
          <details className="text-sm">
            <summary className="cursor-pointer">Chat with {displayName(t.developer)}</summary>
            <div className="pt-2">
              <Chat
                closed={chatClosed}
                path={`/api/tests/${t.id}/message`}
                extra={{ testerId: u.id }}
                other={displayName(t.developer)}
                messages={(await chatMessages(t.id, u.id)).map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
              />
            </div>
          </details>
        )}
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
            application={await db.application.findUnique({ where: { testId_testerId: { testId: t.id, testerId: u.id } } }).then((a) => (a ? { status: a.status, changed: !!a.changedAt } : null))}
          />
        )}
      </div>
    </>
  );
}
