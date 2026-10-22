import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, needsGap } from "@/lib/server/tests";
import { JoinBox } from "./JoinBox";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const t = await db.test.findUnique({ where: { id }, include: { developer: true } });
  if (!t || t.status === "draft") notFound();
  const mine = await db.contract.findUnique({ where: { testId_testerId: { testId: id, testerId: u.id } } });
  if (mine) redirect(`/app/sessions/${mine.id}`);
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const gap = needsGap(t, await db.testerProfile.findUnique({ where: { userId: u.id } }));
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const l = asListing(t);
  const closed = t.status !== "open" || testersIn >= t.spots || (t.openUntil && t.openUntil < new Date());
  return (
    <>
      <p><a href="/app/find">← All tests</a></p>
      <div className="panel">
        <h1>{t.title}</h1>
        <p className="note">by {displayName(t.developer)}{t.category && ` · ${t.category}`}</p>
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
              {l.questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </>
        )}
        <p className="note">Everything above is fixed in your contract when you join: neither side can change it later.</p>
        {t.developerId === u.id ? (
          <p className="note">This is your test.</p>
        ) : !u.isTester ? (
          <p className="note">Turn on “test games” in your <a href="/app/profile">profile</a> to join.</p>
        ) : blocked ? (
          <p className="note">This test isn&apos;t taking new testers right now.</p>
        ) : closed ? (
          <p className="err">{t.status === "stopped" ? "This test was stopped." : testersIn >= t.spots ? "This test is full." : "This test isn't taking new testers any more."}</p>
        ) : gap ? (
          <p className="err">{gap}</p>
        ) : (
          <JoinBox
            testId={t.id}
            seenAt={new Date().toISOString()}
            mode={t.joinMode}
            invited={!!(await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } }))}
            application={await db.application.findUnique({ where: { testId_testerId: { testId: t.id, testerId: u.id } } }).then((a) => (a ? { status: a.status, changed: !!a.changedAt } : null))}
          />
        )}
      </div>
    </>
  );
}
