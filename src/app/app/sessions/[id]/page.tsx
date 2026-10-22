import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { canCancelCall, canDispute, headsUpLine, isLate, PAUSED_FOR_TESTERS, lateLabel, termsLine, testerShare } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
import { DisputeForm, LeaveButton, WrittenForm } from "./SessionActions";
import { Chat } from "@/components/Chat";
import { RecordingUpload } from "./RecordingUpload";
import { TesterCallPanel } from "./TesterCallPanel";

export const metadata = { title: "Your session · Playtest" };
export const dynamic = "force-dynamic";

const label = (inContract: boolean) => (inContract ? "In your contract" : "Extra (not in the listing): the developer decides what to pay");

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const c = await db.contract.findUnique({
    where: { id },
    include: {
      test: { include: { developer: true } },
      submissions: { include: { review: true, dispute: true, recordings: true } },
      calls: { include: { review: true, dispute: true, slot: true }, orderBy: { startsAt: "asc" } },
      recordings: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" }, include: { sender: true }, take: 300 },
    },
  });
  if (!c || c.testerId !== u.id) notFound();
  const dev = displayName(c.test.developer);
  const refusal = sessionRefusal(c, c.test, dev);
  const written = c.submissions.find((s) => s.kind === "written");
  const recording = c.submissions.find((s) => s.kind === "recording");
  const now = new Date();
  const seenAt = now.toISOString();
  const slots = await db.callSlot.findMany({ where: { testId: c.testId, status: "open", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  const visible = slots.filter((s) => s.allowedTesterIds.length === 0 || s.allowedTesterIds.includes(u.id));
  const cancelledText = (x: { status: string; cancelledBy: string | null }) => (x.status !== "cancelled" ? "" : x.cancelledBy === "tester" ? "you cancelled it" : `cancelled by ${x.cancelledBy === "developer" ? dev : "the site"}`);
  return (
    <>
      {refusal && <p className="info">{refusal}</p>}
      {!refusal && c.test.developer.holdStartedAt && <p className="info">{PAUSED_FOR_TESTERS}</p>}
      {!refusal && c.test.openUntil && c.test.openUntil.getTime() - now.getTime() < 3 * 86_400_000 && <p className="info">{headsUpLine(c.title, c.test.openUntil, fmtDate)}</p>}
      <div className="panel">
        <h1>{c.title}</h1>
        <p className="note">by {dev} · joined {fmtDate(c.joinedAt)} · due {fmtDate(c.dueAt)}{isLate(c.dueAt, now) && !refusal ? " (late work is still accepted and marked late)" : ""}</p>
        <p className="text-sm"><b>Your contract (what you get):</b> {termsLine(c, true)}</p>
        {c.buildUrl && <p className="text-sm">Build: <a href={c.buildUrl} target="_blank" rel="noreferrer">{c.buildUrl}</a></p>}
        {c.description && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
        {c.keepPrivate && <p className="note">You agreed to keep this build and what you see private.</p>}
        {c.status === "working" && <LeaveButton sessionId={c.id} />}
      </div>

      <TesterCallPanel
        sessionId={c.id}
        seenAt={seenAt}
        refusal={refusal}
        label={c.liveRateCents != null ? `In your contract · ${c.liveRateCents === 0 ? "free" : money(testerShare(c.liveRateCents)) + "/h for you"} · ${c.liveMinutes} min` : "Extra (not in the listing): the developer decides what to pay"}
        open={visible.map((s) => ({ id: s.id, when: s.startsAt.toISOString(), minutes: s.minutes }))}
        mine={c.calls.map((x) => ({ id: x.id, when: x.startsAt.toISOString(), minutes: x.minutes, room: roomUrl(x, x.slot), canCancel: canCancelCall(x.startsAt, now).ok, started: x.startsAt <= now, reported: !!x.noShowBy, cancelled: cancelledText(x) }))}
      />
      {c.calls.filter((x) => x.review).map((x) => (
        <section key={x.id} className="panel">
          <h3>Live call on {fmtDateTime(x.startsAt)}</h3>
          <TesterReview sessionId={c.id} kind="call" id={x.id} review={x.review!} dispute={x.dispute} />
        </section>
      ))}

      <section className="panel" id="written">
        <h2>Written answers</h2>
        <p className="note">{label(c.writtenCents != null)}{c.writtenCents != null && ` · ${c.writtenCents === 0 ? "free" : money(testerShare(c.writtenCents)) + " for you"}`}</p>
        {written && (
          <p className="text-sm">
            Sent {fmtDateTime(written.updatedAt)}
            {written.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
          </p>
        )}
        {written?.review && <TesterReview sessionId={c.id} kind="submission" id={written.id} review={written.review} dispute={written.dispute} />}
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

      <section className="panel" id="recording">
        <h2>Screen recording</h2>
        <p className="note">{label(c.recordingCents != null)}{c.recordingCents != null && ` · ${c.recordingCents === 0 ? "free" : money(testerShare(c.recordingCents)) + " for you"}`}</p>
        {recording && (
          <p className="text-sm">
            Sent {fmtDateTime(recording.updatedAt)}
            {recording.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
          </p>
        )}
        {recording?.review && <TesterReview sessionId={c.id} kind="submission" id={recording.id} review={recording.review} dispute={recording.dispute} />}
        <RecordingUpload
          sessionId={c.id}
          canSend={!refusal && !recording?.review}
          sentBefore={!!recording}
          recordings={c.recordings.map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt }))}
        />
      </section>

      <section className="panel" id="chat">
        <h2>Chat with {dev}</h2>
        <Chat
          path={`/api/sessions/${c.id}/message`}
          other={dev}
          messages={c.messages.map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
        />
      </section>
    </>
  );
}

type Rev = { amountCents: number; agreedCents: number | null; rejected: boolean; reason: string; createdAt: Date };
type Disp = { status: string; decidedCents: number | null; decisionNote: string } | null;

/** What the developer did with a piece, as the tester reads it (they see what they get; never holds or chargebacks). */
function TesterReview({ sessionId, kind, id, review, dispute }: { sessionId: string; kind: "submission" | "call"; id: string; review: Rev; dispute: Disp }) {
  const may = canDispute(review.amountCents, review.agreedCents, !!dispute).ok;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      {review.rejected ? (
        <p><b>Not accepted</b> ({fmtDateTime(review.createdAt)}): “{review.reason}”</p>
      ) : (
        <p>
          <b>Paid {money(review.amountCents)}</b>: you get {money(testerShare(review.amountCents))} ({fmtDateTime(review.createdAt)})
          {review.reason && <> · “{review.reason}”</>}
        </p>
      )}
      {review.agreedCents == null && <p className="note">This was extra work (not in the listing): the developer&apos;s amount is final.</p>}
      {dispute && <p>{dispute.status === "open" ? "You disputed this: waiting for the team." : `The team decided: ${money(dispute.decidedCents)} in all${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : ""}.`}</p>}
      {may && <DisputeForm sessionId={sessionId} kind={kind} id={id} />}
    </div>
  );
}
