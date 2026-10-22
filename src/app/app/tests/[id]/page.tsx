import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime } from "@/lib/format";
import { lateLabel, termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { TopPanel } from "./TopPanel";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const u = await requirePageUser();
  const seenAt = new Date().toISOString();
  const t = await db.test.findUnique({
    where: { id },
    include: {
      contracts: {
        orderBy: { joinedAt: "asc" },
        include: { tester: true, submissions: { include: { review: true, dispute: true, recordings: true }, orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!t || t.developerId !== u.id) notFound();
  const next = await db.test.findFirst({ where: { previousId: id }, select: { id: true } });
  const working = t.contracts.filter((c) => c.status === "working");
  return (
    <>
      <TopPanel
        id={t.id}
        title={t.title}
        status={t.status}
        terms={termsLine(asListing(t)) + (t.openUntil ? ` · open until ${fmtDate(t.openUntil)}` : "")}
        seenAt={seenAt}
        nextRoundId={next?.id ?? null}
        spotsLine={`${working.length} of ${t.spots} spots used`}
        working={working.map((c) => ({ contractId: c.id, name: displayName(c.tester) }))}
      />
      {saved && <p className="ok">Saved. New testers join on the new listing; testers already in keep their contract.</p>}

      <section className="space-y-3">
        <h2>Testers</h2>
        {t.contracts.length === 0 && <p className="note">Nobody has joined yet.</p>}
        {t.contracts.map((c) => (
          <div key={c.id} className="panel" id={`tester-${c.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="mr-auto">{displayName(c.tester)}</h3>
              <span className="badge">{c.status === "working" ? `Working · due ${fmtDate(c.dueAt)}` : c.status === "left" ? "Left the test" : "Work ended"}</span>
              {c.keepPrivate && <span className="badge">Keeps it private</span>}
            </div>
            <p className="note">
              Their contract: {termsLine(c)} · joined {fmtDate(c.joinedAt)}
            </p>
            {c.submissions.length === 0 && <p className="note">Nothing sent yet.</p>}
            {c.submissions.map((s) => (
              <div key={s.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">
                  {s.kind === "written" ? "Written answers" : "Recording"} · {s.agreedCents == null ? "Extra (not in the listing)" : "In their contract"} · sent{" "}
                  {fmtDateTime(s.updatedAt)}
                  {s.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
                </p>
                {s.kind === "written" &&
                  writtenQuestions(c).map((q, i) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-slate-700">{q}</p>
                      <p className="whitespace-pre-wrap">{(s.answers as string[])[i]}</p>
                    </div>
                  ))}
                {s.notes && <p className="whitespace-pre-wrap text-sm">Notes: {s.notes}</p>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
