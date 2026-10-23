import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { bookedLateLabel, isBookedLate, chargeAmount, choiceLine, callReference, cancelNeedsReason, canDispute, closesInLine, DELAYED_CALL_LINE, isLate, PAUSED_FOR_TESTERS, lateLabel, termsLine, testerShare } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
import { sweepHeldCalls } from "@/lib/server/holds";
import { paidLines } from "@/lib/server/paid";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeForm, LeaveButton, WrittenForm } from "./SessionActions";
import { Chat } from "@/components/Chat";
import { RecordingUpload } from "./RecordingUpload";
import { TesterCallPanel } from "./TesterCallPanel";
import { ChoiceBox } from "./ChoiceBox";
import { TesterTop } from "./TesterTop";
import { CallRequests } from "@/components/CallRequests";
import { rateLabel } from "@/lib/server/requests";
import { chatMessages } from "@/lib/server/messages";
import { BlockButton } from "@/components/BlockButton";
import { LiveTop } from "@/components/LiveTop";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateBlocker, rateWarning } from "@/lib/server/ratings";
import { openOffer } from "@/lib/server/terms";

export const metadata = { title: "Your session · Playtest" };
export const dynamic = "force-dynamic";

const label = (inContract: boolean) => (inContract ? "In your contract" : "Not in your contract");
/** Listing (or "Not in your contract"), the amount asked, and what's been paid for this part. */
const partLine = (listing: number | null, asked: number | null | undefined, paid: number) =>
  `${listing == null ? "Not in your contract" : `Listing: ${money(listing)}`}${asked != null ? ` · You asked ${money(asked)}` : ""} · Paid so far for this part: ${money(paid)} (you get 80%)`;

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
    },
  });
  if (!c || c.testerId !== u.id) notFound();
  const dev = displayName(c.test.developer);
  const refusal = sessionRefusal(c, c.test, dev);
  const written = c.submissions.find((s) => s.kind === "written");
  const recording = c.submissions.find((s) => s.kind === "recording");
  const now = new Date();
  const seenAt = now.toISOString();
  await sweepHeldCalls(c.test.developerId);
  const offer = await openOffer(c.id);
  const blockedPair = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: u.id }] } })) > 0;
  const partPaid = new Map((await db.payment.groupBy({ by: ["submissionId", "callId"], where: { contractId: c.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } })).map((g) => [g.submissionId ?? g.callId ?? "", g._sum.amountCents ?? 0]));
  const delayedSubs = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "failed", settledAt: null, owedUntil: { not: null }, submissionId: { not: null } }, select: { submissionId: true } })).map((p) => p.submissionId!));
  const owedCalls = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "failed", settledAt: null, owedUntil: { not: null }, callId: { not: null } }, select: { callId: true } })).map((p) => p.callId!));
  const failedCalls = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "failed", callId: { not: null } }, select: { callId: true } })).map((p) => p.callId!));
  const cancelledText = (x: { status: string; cancelledBy: string | null }) => (x.status !== "cancelled" ? "" : x.cancelledBy === "tester" ? "you cancelled it" : `cancelled by ${x.cancelledBy === "developer" ? dev : "the site"}`);
  // (NEWEST+5) Rating the developer.
  const rated = await contractRatings(c.id);
  const myRating = rated.tester;
  const rateBlock = myRating ? "rated" : await rateBlocker(c.id, "tester");
  const rateWarn = await rateWarning(c.id);
  // Live calls: the request panel shows only when there's something to do or see.
  const canRequestCall = !refusal && !blockedPair && !c.test.developer.holdStartedAt;
  const pendingReqs = await db.callRequest.findMany({ where: { contractId: c.id, status: "pending", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  const infoChanged = (await db.testEvent.count({ where: { testId: c.testId, kind: "info", createdAt: { gt: c.joinedAt } } })) > 0;
  return (
    <>
      <AutoRefresh query={`session=${c.id}`} />
      <LiveTop scope={`session:${c.id}`} seenAt={seenAt} seeIt="#listing" />
      <TesterTop sessionId={c.id} seenAt={seenAt} devName={dev} offer={offer && !refusal ? { id: offer.id, diff: offer.diff } : null} />
      {refusal && <p className="info">{refusal}</p>}
      {!refusal && c.test.developer.holdStartedAt && <p className="info">{PAUSED_FOR_TESTERS}</p>}
      {!refusal && c.test.openUntil && c.test.openUntil > now && c.test.openUntil.getTime() - now.getTime() < 3 * 86_400_000 && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(c.title, c.test.openUntil, now)}</p>
      )}
      <div className="panel">
        <h1>{c.title}</h1>
        <p className="note">by {dev} · joined {fmtDate(c.joinedAt)} · due {fmtDate(c.dueAt)}{isLate(c.dueAt, now) && !refusal ? " (late work is still accepted and marked late)" : ""}</p>
        <p className="text-sm"><b>Your contract:</b> {termsLine(c, true)} (what you get)</p>
        <p className="text-sm">{(await paidLines([c.id])).get(c.id)}</p>
        {c.buildUrl && <p className="text-sm">Build: <a href={c.buildUrl} target="_blank" rel="noreferrer">{c.buildUrl}</a></p>}
        {c.description && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
        {infoChanged && (
          <details id="listing" className="text-sm">
            <summary className="cursor-pointer">{dev} updated the listing since you joined: see it now</summary>
            <div className="space-y-1 pt-1">
              <p><b>Title:</b> {c.test.title}</p>
              <p className="whitespace-pre-wrap"><b>Description:</b> {c.test.description || "(none)"}</p>
              <p><b>Devices:</b> {c.test.devices.join(", ") || "any"}</p>
              <p><b>Languages:</b> {c.test.languages.join(", ") || "any"}</p>
              <p className="note">Your contract&apos;s terms stay as they are.</p>
            </div>
          </details>
        )}
        {c.keepPrivate && <p className="note">You agreed to keep this build and what you see private.</p>}
        {c.status === "working" && <LeaveButton sessionId={c.id} seenAt={seenAt} />}
        {myRating && !rated.testerRevealed && <p className="note">You rated {dev}.</p>}
        {myRating && rated.testerRevealed && <p className="note">You rated {dev}: {myRating.stars} ★{myRating.comment ? ` · “${myRating.comment}”` : ""}</p>}
        {rated.developer && <p className="note">{dev} rated you: {rated.developer.stars} ★{rated.developer.comment ? ` · “${rated.developer.comment}”` : ""}</p>}
        {rateBlock === "" && (
          <RateBox
            path={`/api/sessions/${c.id}/rate`}
            seenAt={seenAt}
            name={dev}
            working={rateWarn.working}
            headline={rateWarn.working ? `Rating ends your part in ${c.title}. You won't be able to send more work, book calls or join this test again.` : `Once you rate, you won't be able to join ${c.title} again.`}
            lines={rateWarn.lines}
          />
        )}
        {c.status === "left" && c.endKind !== "rated" && !myRating && c.test.status === "open" && (
          <section id="rejoin" className="panel scroll-mt-24 border-emerald-400/30 text-sm">
            <p className="font-semibold text-white">Join {c.title} again</p>
            <p className="text-ink-300">You join on the current listing: your session comes back with everything in it (work you sent, payments and chat).</p>
            <a className="btn" href={`/app/find/${c.testId}`}>Join again</a>
          </section>
        )}
        {!(await db.block.count({ where: { blockerId: u.id, blockedId: c.test.developerId } })) && (
          <BlockButton seenAt={seenAt} sessionId={c.id} userId={c.test.developerId} name={dev} effect="Your session with them ends now (work you sent stays payable), calls between you are cancelled, and chat closes." />
        )}
      </div>

      <TesterCallPanel
        sessionId={c.id}
        seenAt={seenAt}
        refusal={refusal}
        label={c.liveRateCents != null ? `Live call: ${money(c.liveRateCents).replace(/\.00$/, "")}/h` : "Live call: not in your contract"}
        mine={c.calls.map((x) => ({ id: x.id, when: x.startsAt.toISOString(), minutes: x.minutes, room: roomUrl(x, x.slot), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, reported: !!x.noShowBy, cancelled: blockedPair && x.status !== "cancelled" ? "not available" : cancelledText(x), rate: rateLabel(x.rateCents, c.liveRateCents), late: isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined }))}
        lateNote={now > c.dueAt ? `Your deadline was ${fmtDate(c.dueAt).replace(/, \d{4}$/, "")} (a guide, not a limit): a call you book now reads “${bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, ""))}”.` : undefined}
      />
      {(canRequestCall || pendingReqs.length > 0) && (
        <section className="panel" aria-label="Call requests">
          <h2>Live call requests</h2>
          <CallRequests
            side="tester"
            path={`/api/sessions/${c.id}`}
            seenAt={seenAt}
            canRequest={canRequestCall}
            targets={[{ contractId: c.id, name: dev, rate: "" }]}
            requests={pendingReqs.map((r) => ({ id: r.id, times: (r.times.length ? r.times : [r.startsAt]).map((d) => d.toISOString()), weeks: r.weeks, repeat: r.repeat, mine: r.fromSide === "tester", who: dev, contractId: c.id, rate: r.askRateCents != null ? `you ask ${money(r.askRateCents).replace(/\.00$/, "")}/h` : rateLabel(c.liveRateCents, c.liveRateCents) }))}
          />
        </section>
      )}
      {c.calls.filter((x) => !x.review && x.status === "booked" && x.startsAt <= now).map((x) => (
        <p key={x.id} className="info">
          Live call on {fmtDateTime(x.startsAt)}: waiting for {dev} to pay. {partLine(callReference(x.rateCents, x.actualMinutes ?? x.minutes).cents, x.askedCents, partPaid.get(x.id) ?? 0)}{failedCalls.has(x.id) && ` ${DELAYED_CALL_LINE}`}
        </p>
      ))}
      {c.calls.filter((x) => x.review).map((x) => (
        <section key={x.id} className="panel">
          <h3>Live call on {fmtDateTime(x.startsAt)}</h3>
          {owedCalls.has(x.id) ? <p className="info">{DELAYED_CALL_LINE}</p> : <TesterReview sessionId={c.id} kind="call" id={x.id} review={x.review!} dispute={x.dispute} />}
        </section>
      ))}

      <section className="panel" id="written">
        <h2>Written answers</h2>
        <p className="note">{label(c.writtenCents != null)}{c.writtenCents != null && ` · ${c.writtenCents === 0 ? "free" : money(testerShare(c.writtenCents)) + " for you"}`}</p>
        {written && <p className="text-sm">{partLine(written.agreedCents, written.askedCents, partPaid.get(written.id) ?? 0)}</p>}
        {written && (
          <p className="text-sm">
            Sent {fmtDateTime(written.updatedAt)}
            {written.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
          </p>
        )}
        {written && !written.review && written.choiceOfferedAt && written.choiceBy && !c.test.developer.holdStartedAt && chargeAmount(written.agreedCents, written.askedCents, partPaid.get(written.id) ?? 0) > 0 && (
          <ChoiceBox seenAt={seenAt} sessionId={c.id} submissionId={written.id} devName={dev} cents={chargeAmount(written.agreedCents, written.askedCents, partPaid.get(written.id) ?? 0)} line={choiceLine(dev, "written", chargeAmount(written.agreedCents, written.askedCents, partPaid.get(written.id) ?? 0))} />
        )}
        {written && delayedSubs.has(written.id) ? <p className="info">Payment for this part may be delayed.</p> : written?.review && <TesterReview sessionId={c.id} kind="submission" id={written.id} review={written.review} dispute={written.dispute} />}
        {written?.review ? (
          writtenQuestions(c).map((q, i) => (
            <div key={i} className="text-sm">
              <p className="font-medium text-ink-200">{q}</p>
              <p className="whitespace-pre-wrap">{(written.answers as string[])[i]}</p>
            </div>
          ))
        ) : refusal ? (
          !written && <p className="note">Nothing sent.</p>
        ) : (
          <WrittenForm seenAt={seenAt} sessionId={c.id} questions={writtenQuestions(c)} initial={(written?.answers as string[]) ?? []} initialNotes={written?.notes ?? ""} update={!!written} />
        )}
      </section>

      <section className="panel" id="recording">
        <h2>Screen recording</h2>
        <p className="note">{label(c.recordingCents != null)}{c.recordingCents != null && ` · ${c.recordingCents === 0 ? "free" : money(testerShare(c.recordingCents)) + " for you"}`}</p>
        {recording && <p className="text-sm">{partLine(recording.agreedCents, recording.askedCents, partPaid.get(recording.id) ?? 0)}</p>}
        {recording && (
          <p className="text-sm">
            Sent {fmtDateTime(recording.updatedAt)}
            {recording.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
          </p>
        )}
        {recording && !recording.review && recording.choiceOfferedAt && recording.choiceBy && !c.test.developer.holdStartedAt && chargeAmount(recording.agreedCents, recording.askedCents, partPaid.get(recording.id) ?? 0) > 0 && (
          <ChoiceBox seenAt={seenAt} sessionId={c.id} submissionId={recording.id} devName={dev} cents={chargeAmount(recording.agreedCents, recording.askedCents, partPaid.get(recording.id) ?? 0)} line={choiceLine(dev, "recording", chargeAmount(recording.agreedCents, recording.askedCents, partPaid.get(recording.id) ?? 0))} />
        )}
        {recording && delayedSubs.has(recording.id) ? <p className="info">Payment for this part may be delayed.</p> : recording?.review && <TesterReview sessionId={c.id} kind="submission" id={recording.id} review={recording.review} dispute={recording.dispute} />}
        <RecordingUpload
          seenAt={seenAt}
          sessionId={c.id}
          canSend={!refusal && !recording?.review}
          sentBefore={!!recording}
          recordings={c.recordings.map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt }))}
        />
      </section>

      <section className="panel" id="chat">
        <h2>Chat with {dev}</h2>
        <Chat
          closed={blockedPair}
          path={`/api/sessions/${c.id}/message`}
          other={dev}
          messages={(await chatMessages(c.testId, c.testerId)).map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
        />
      </section>
    </>
  );
}

type Rev = { amountCents: number; agreedCents: number | null; rejected: boolean; reason: string; createdAt: Date };
type Disp = { status: string; decidedCents: number | null; decisionNote: string; devSide: string } | null;

/** What the developer did with a piece, as the tester reads it (they see what they get; never holds or chargebacks). */
function TesterReview({ sessionId, kind, id, review, dispute }: { sessionId: string; kind: "submission" | "call"; id: string; review: Rev; dispute: Disp }) {
  const may = canDispute(review.amountCents, review.agreedCents, !!dispute).ok;
  return (
    <div className="space-y-2 rounded-lg bg-white/[0.03] p-3 text-sm">
      {review.rejected ? (
        <p><b>Not accepted</b> ({fmtDateTime(review.createdAt)}): “{review.reason}”</p>
      ) : (
        <p>
          <b>Paid {money(review.amountCents)}</b>: you get {money(testerShare(review.amountCents))} ({fmtDateTime(review.createdAt)})
          {review.reason && <> · “{review.reason}”</>}
        </p>
      )}
      {review.agreedCents == null && <p className="note">This wasn&apos;t in your contract, so the developer&apos;s amount is final.</p>}
      {dispute && <p>{dispute.status === "open" ? "You disputed this: waiting for the team." : `The team decided: ${money(dispute.decidedCents)} in all${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : ""}.`}</p>}
      {dispute?.devSide && <p>The developer&apos;s side: “{dispute.devSide}”</p>}
      {may && <DisputeForm sessionId={sessionId} kind={kind} id={id} seenAt={new Date().toISOString()} />}
    </div>
  );
}
