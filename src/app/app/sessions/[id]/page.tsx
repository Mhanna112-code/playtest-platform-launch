import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { isLate, lateLabel, termsLine, testerShare } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { LeaveButton, WrittenForm } from "./SessionActions";

export const metadata = { title: "Your session · Playtest" };
export const dynamic = "force-dynamic";

const label = (inContract: boolean) => (inContract ? "In your contract" : "Extra (not in the listing): the developer decides what to pay");

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const c = await db.contract.findUnique({
    where: { id },
    include: { test: { include: { developer: true } }, submissions: { include: { review: true, dispute: true, recordings: true } } },
  });
  if (!c || c.testerId !== u.id) notFound();
  const dev = displayName(c.test.developer);
  const refusal = sessionRefusal(c, c.test, dev);
  const written = c.submissions.find((s) => s.kind === "written");
  const now = new Date();
  return (
    <>
      {refusal && <p className="info">{refusal}</p>}
      <div className="panel">
        <h1>{c.title}</h1>
        <p className="note">by {dev} · joined {fmtDate(c.joinedAt)} · due {fmtDate(c.dueAt)}{isLate(c.dueAt, now) && !refusal ? " (late work is still accepted and marked late)" : ""}</p>
        <p className="text-sm"><b>Your contract (what you get):</b> {termsLine(c, true)}</p>
        {c.buildUrl && <p className="text-sm">Build: <a href={c.buildUrl} target="_blank" rel="noreferrer">{c.buildUrl}</a></p>}
        {c.description && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
        {c.keepPrivate && <p className="note">You agreed to keep this build and what you see private.</p>}
        {c.status === "working" && <LeaveButton sessionId={c.id} />}
      </div>

      <section className="panel" id="written">
        <h2>Written answers</h2>
        <p className="note">{label(c.writtenCents != null)}{c.writtenCents != null && ` · ${c.writtenCents === 0 ? "free" : money(testerShare(c.writtenCents)) + " for you"}`}</p>
        {written && (
          <p className="text-sm">
            Sent {fmtDateTime(written.updatedAt)}
            {written.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
          </p>
        )}
        {written?.review ? (
          writtenQuestions(c).map((q, i) => (
            <div key={i} className="text-sm">
              <p className="font-medium text-slate-700">{q}</p>
              <p className="whitespace-pre-wrap">{(written.answers as string[])[i]}</p>
            </div>
          ))
        ) : refusal ? (
          !written && <p className="note">Nothing sent.</p>
        ) : (
          <WrittenForm sessionId={c.id} questions={writtenQuestions(c)} initial={(written?.answers as string[]) ?? []} initialNotes={written?.notes ?? ""} update={!!written} />
        )}
      </section>
    </>
  );
}
