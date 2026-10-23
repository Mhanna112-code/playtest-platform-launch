import { notFound } from "next/navigation";
import { CheckCircle2, CircleDot, Clapperboard, ExternalLink, FileSignature, MessagesSquare, Users, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { callLengthText, callOutcome, joinedWords, callJoinable, bookedLateLabel, isBookedLate, chargeAmount, choiceLine, callReference, cancelNeedsReason, canDispute, closesInLine, DELAYED_CALL_LINE, isLate, PAUSED_FOR_TESTERS, lateLabel, termsLine, testerShare } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
import { sweepHeldCalls } from "@/lib/server/holds";
import { paidLines } from "@/lib/server/paid";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeForm, LeaveButton, WrittenForm } from "./SessionActions";
import { RecordingUpload } from "./RecordingUpload";
import { TesterCallPanel } from "./TesterCallPanel";
import { LivePanel } from "@/components/LivePanel";
import { ChoiceBox } from "./ChoiceBox";
import { TesterTop } from "./TesterTop";
import { CallRequests } from "@/components/CallRequests";
import { rateLabel } from "@/lib/server/requests";
import { unreadCount } from "@/lib/server/messages";
import { PersonHover } from "@/components/PersonHover";
import { BlockButton } from "@/components/BlockButton";
import { LiveTop } from "@/components/LiveTop";
import { qOptional, qText } from "@/lib/questions";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateBlocker, rateWarning, ratingSummary } from "@/lib/server/ratings";
import { openOffer } from "@/lib/server/terms";

export const metadata = { title: "Your session · Playtest" };
export const dynamic = "force-dynamic";

const label = (inContract: boolean) => (inContract ? "In your contract" : "Not in your contract");
/** Listing (or "Not in your contract"), the amount asked, and what's been paid for this part. */
const partLine = (listing: number | null, asked: number | null | undefined, paid: number) =>
  `${listing == null ? "Not in your contract" : `Listing: ${money(listing)}`}${asked != null ? ` · You asked ${money(asked)}` : ""} · Paid so far for this part: ${money(paid)} (you get 80%)`;

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
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
  const unread = await unreadCount(u.id, c.testId, c.testerId);
  const blockedByMe = (await db.block.count({ where: { blockerId: u.id, blockedId: c.test.developerId } })) > 0;
  const devRating = (await ratingSummary(c.test.developerId)).line;
  const testersIn = await db.contract.count({ where: { testId: c.testId, status: "working" } });
  const liveCalls = c.calls.filter((x) => x.status === "booked");
  const heldCalls = liveCalls.filter((x) => x.startsAt <= now);
  const aheadCalls = liveCalls.filter((x) => x.startsAt > now);
  const infoChanged = (await db.testEvent.count({ where: { testId: c.testId, kind: "info", createdAt: { gt: c.joinedAt } } })) > 0;
  // The full app's session page: one centred column; the header card (title, by, badges, Chat, Open the product), then a
  // card per part.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh query={`session=${c.id}`} />
      <LiveTop scope={`session:${c.id}`} seenAt={seenAt} seeIt="#listing" />
      <TesterTop sessionId={c.id} seenAt={seenAt} devName={dev} offer={offer && !refusal ? { id: offer.id, diff: offer.diff } : null} />
      {refusal && <p className="info">{refusal}</p>}
      {!refusal && c.test.developer.holdStartedAt && <p className="info">{PAUSED_FOR_TESTERS}</p>}
      {!refusal && c.test.openUntil && c.test.openUntil > now && c.test.openUntil.getTime() - now.getTime() < 3 * 86_400_000 && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(c.title, c.test.openUntil, now)}</p>
      )}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[12rem] flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">{c.title}</h1>
            <p className="text-sm text-slate-400">by{" "}
              <PersonHover name={dev} href={`/app/developers/${c.test.developerId}`} summary={[devRating || "No ratings yet"]} />
              {" "}· joined {fmtDate(c.joinedAt)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <span className={`badge ${c.status === "working" ? "border-emerald-400/40 text-emerald-200" : ""}`}>{c.status === "working" ? "Working" : c.status === "left" ? "You left" : "Ended"}</span>
              {c.writtenCents != null && <span className="badge">Written answers</span>}
              {c.recordingCents != null && <span className="badge">Screen recording</span>}
              {c.liveRateCents != null && <span className="badge">Live call</span>}
              <span className="badge"><Users className="h-3.5 w-3.5" /> {testersIn} tester{testersIn === 1 ? "" : "s"} on this test</span>
            </div>
          </div>
          <a href={`/app/chat/${c.id}`} className="btn-secondary relative min-w-0 max-w-full no-underline hover:no-underline"><MessagesSquare className="h-4 w-4 shrink-0" /> <span className="truncate">Chat with {dev}</span>
            {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unread} unread`}>{unread}</span>}
          </a>
        </div>
        {c.description && <p className="whitespace-pre-wrap text-slate-300">{c.description}</p>}
        <p className="text-sm text-slate-400">Due {fmtDate(c.dueAt)}{isLate(c.dueAt, now) && !refusal ? ": your deadline has passed, late work is still accepted and marked late." : ""}</p>
        {c.buildUrl && (
          <a href={c.buildUrl} target="_blank" rel="noreferrer" className="btn w-fit no-underline hover:no-underline">
            Open the product <ExternalLink className="h-4 w-4" />
          </a>
        )}
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
      </section>

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
        <section id="rejoin" className="card space-y-3 scroll-mt-24 border-emerald-400/30 text-sm">
          <p className="font-semibold text-white">Join {c.title} again</p>
          <p className="text-ink-300">You join on the current listing: your session comes back with everything in it (work you sent, payments and chat).</p>
          <a className="btn" href={`/app/find/${c.testId}`}>Join again</a>
        </section>
      )}

      {/* The full app's "Your agreed scope" fold: what the contract says. */}
      <details className="card">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your agreed scope</summary>
        <ul className="mt-3 space-y-1 text-sm text-slate-300">
          <li>Deliverables: {[c.writtenCents != null ? "written answers" : "", c.recordingCents != null ? "screen recording" : "", c.liveRateCents != null ? "live call" : ""].filter(Boolean).join(", ") || "none in your contract"}</li>
          <li>Prices (what you get): {termsLine(c, true)}</li>
          <li>Time: {c.deadlineDays} day{c.deadlineDays === 1 ? "" : "s"} · due {fmtDate(c.dueAt)}</li>
          {writtenQuestions(c).length > 0 && <li>Questions: {writtenQuestions(c).map((q) => `“${qText(q)}”`).join(", ")}</li>}
          <li>Agreed {fmtDate(c.joinedAt)}. Everything above is fixed in your contract; if {dev} changes the listing later you choose Switch or Keep.</li>
        </ul>
      </details>

      {/* The full app's "Your parts" card: each part on its own, sent, reviewed and paid in any order. */}
      <section id="parts" className="card scroll-mt-24 space-y-3">
        <h2 className="font-semibold text-white">Your parts</h2>
        <p className="text-sm text-slate-400">Each part is sent, reviewed and paid on its own, in any order: you don&apos;t have to wait for one to send another.</p>
        <ul className="space-y-3">
          {([
            { key: "written", name: "Written answers", cents: c.writtenCents, required: c.writtenRequired, sub: written },
            { key: "recording", name: "Screen recording", cents: c.recordingCents, required: c.recordingRequired, sub: recording },
          ] as const).map(({ key, name, cents, required, sub }) => (
            <li key={key} id={`part-${key}`} data-part={key} className="scroll-mt-24 space-y-1.5 rounded-xl border border-white/[0.08] p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-white">
                {sub?.review ? (sub.review.rejected ? <XCircle className="h-4 w-4 text-rose-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />) : <CircleDot className={`h-4 w-4 ${sub ? "text-amber-300" : "text-slate-400"}`} />}
                <strong>{name}:</strong>
                <span className="text-slate-200">{sub ? <>Sent {fmtDateTime(sub.updatedAt)}{sub.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}</> : "Not sent yet"}</span>
                {cents != null && <span className={`badge ${required ? "border-amber-300/40 text-amber-200" : ""}`}>{required ? "Required" : "Not required"}</span>}
              </p>
              <p className="text-slate-400">{cents == null ? "Not in your contract" : `In your contract · ${cents === 0 ? "free" : `${money(testerShare(cents))} for you`}`}{sub?.askedCents != null && ` · You asked ${money(sub.askedCents)}`}{` · Paid so far ${money(sub ? partPaid.get(sub.id) ?? 0 : 0)}`}</p>
              {sub && <p className="text-xs text-slate-500">{partLine(sub.agreedCents, sub.askedCents, partPaid.get(sub.id) ?? 0)}</p>}
              {sub && !sub.review && sub.choiceOfferedAt && sub.choiceBy && !c.test.developer.holdStartedAt && chargeAmount(sub.agreedCents, sub.askedCents, partPaid.get(sub.id) ?? 0) > 0 && (
                <ChoiceBox seenAt={seenAt} sessionId={c.id} submissionId={sub.id} devName={dev} cents={chargeAmount(sub.agreedCents, sub.askedCents, partPaid.get(sub.id) ?? 0)} line={choiceLine(dev, key, chargeAmount(sub.agreedCents, sub.askedCents, partPaid.get(sub.id) ?? 0))} />
              )}
              {sub && delayedSubs.has(sub.id) ? <p className="info">Payment for this part may be delayed.</p> : sub?.review && <TesterReview sessionId={c.id} kind="submission" id={sub.id} review={sub.review} dispute={sub.dispute} />}
            </li>
          ))}
          <li id="part-live" data-part="live" className="scroll-mt-24 space-y-1.5 rounded-xl border border-white/[0.08] p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-white">
              <CircleDot className={`h-4 w-4 ${heldCalls.length ? "text-amber-300" : "text-slate-400"}`} />
              <strong>Live call:</strong>
              <span className="text-slate-200">{heldCalls.length ? `${heldCalls.length} held` : aheadCalls.length ? `${aheadCalls.length} booked` : "Not booked yet"}</span>
              {c.liveRateCents != null && <span className={`badge ${c.liveRequired ? "border-amber-300/40 text-amber-200" : ""}`}>{c.liveRequired ? "Required" : "Not required"}</span>}
            </p>
            <p className="text-slate-400">{c.liveRateCents == null ? "Not in your contract" : `In your contract · ${c.liveRateCents === 0 ? "free" : `${money(testerShare(c.liveRateCents))}/h for you`}`}{heldCalls.some((x) => x.askedCents != null) && ` · You asked ${heldCalls.filter((x) => x.askedCents != null).map((x) => money(x.askedCents)).join(", ")}`}{` · Paid so far ${money(liveCalls.reduce((a, x) => a + (partPaid.get(x.id) ?? 0), 0))}`}</p>
            {c.calls.filter((x) => !x.review && x.status === "booked" && x.startsAt <= now).map((x) => (
              <p key={x.id} className="info">
                Live call on {fmtDateTime(x.startsAt)}: waiting for {dev} to pay. {partLine(callReference(x.rateCents, x.actualMinutes ?? x.minutes).cents, x.askedCents, partPaid.get(x.id) ?? 0)}{failedCalls.has(x.id) && ` ${DELAYED_CALL_LINE}`}
              </p>
            ))}
            {c.calls.filter((x) => x.review).map((x) => (
              <div key={x.id} className="space-y-2">
                <p className="text-slate-300">Live call on {fmtDateTime(x.startsAt)}</p>
                {owedCalls.has(x.id) ? <p className="info">{DELAYED_CALL_LINE}</p> : <TesterReview sessionId={c.id} kind="call" id={x.id} review={x.review!} dispute={x.dispute} />}
              </div>
            ))}
          </li>
        </ul>
      </section>

      {/* The full app's ONE Live session panel: the rate, Booked, Past calls and Requests (calls are always requests). */}
      {(c.calls.length > 0 || canRequestCall || pendingReqs.length > 0) && (
        <LivePanel minutes={c.calls.filter((x) => x.status === "booked" && x.startsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]?.minutes ?? null}>
          <p className="note">{c.liveRateCents != null ? `Live call: ${money(c.liveRateCents).replace(/\.00$/, "")}/h` : "Live call: not in your contract"}</p>
          <TesterCallPanel
            sessionId={c.id}
            seenAt={seenAt}
            refusal={refusal}
            devName={dev}
            mine={c.calls.map((x) => ({ id: x.id, joinable: !blockedPair && callJoinable(x, now), when: x.startsAt.toISOString(), minutes: x.minutes, room: roomUrl(x, x.slot), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, ended: x.startsAt.getTime() + x.minutes * 60_000 <= now.getTime(), joined: joinedWords(x, "tester", dev, now), outcome: callOutcome({ ...x, cancelledBy: blockedPair && x.status !== "cancelled" ? "site" : x.cancelledBy, status: blockedPair ? "cancelled" : x.status, cancelNote: blockedPair && x.status !== "cancelled" ? "not available" : x.cancelNote }, dev, "tester"), logged: x.actualMinutes, report: x.noShowBy ? { byMe: x.noShowBy === "tester", note: x.noShowNote } : null, lengthText: callLengthText(x, dev, fmtDateTime, now), devJoinedAt: x.devJoinedAt?.toISOString() ?? null, testerJoinedAt: x.testerJoinedAt?.toISOString() ?? null, reported: !!x.noShowBy, cancelled: blockedPair && x.status !== "cancelled" ? "not available" : cancelledText(x), rate: rateLabel(x.rateCents, c.liveRateCents), late: isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined }))}
            lateNote={now > c.dueAt ? `Your deadline was ${fmtDate(c.dueAt).replace(/, \d{4}$/, "")} (a guide, not a limit): a call you book now reads “${bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, ""))}”.` : undefined}
          />
          {(canRequestCall || pendingReqs.length > 0) && (
            <section className="space-y-1.5" aria-label="Call requests" data-live-section="Requests">
              <h3 className="text-sm font-semibold text-white">Requests</h3>
              <CallRequests
                side="tester"
                path={`/api/sessions/${c.id}`}
                seenAt={seenAt}
                canRequest={canRequestCall}
                targets={[{ contractId: c.id, name: dev, rate: "" }]}
                requests={pendingReqs.map((r) => ({ id: r.id, minutes: r.minutes, times: (r.times.length ? r.times : [r.startsAt]).map((d) => d.toISOString()), weeks: r.weeks, repeat: r.repeat, mine: r.fromSide === "tester", who: dev, contractId: c.id, rate: r.askRateCents != null ? `you ask ${money(r.askRateCents).replace(/\.00$/, "")}/h` : rateLabel(c.liveRateCents, c.liveRateCents) }))}
              />
            </section>
          )}
        </LivePanel>
      )}
      {/* The full app's "Your recordings" card, then "The written part" (a card of its own). */}
      <section className="card space-y-3" id="recording">
        <h2 className="flex flex-wrap items-center gap-2 font-semibold text-white"><Clapperboard className="h-5 w-5 text-fuchsia-300" /> Your recordings
          <span className="text-sm font-normal text-slate-400">{c.recordingCents != null ? "(the recorded session part)" : "(clips, if you like)"}</span></h2>
        <RecordingUpload
          seenAt={seenAt}
          sessionId={c.id}
          canSend={!refusal && !recording?.review}
          sentBefore={!!recording}
          recordings={c.recordings.map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt }))}
        />
      </section>

      <section className="card space-y-3" id="written">
        <h2 className="font-semibold text-white">The written part</h2>
        {written?.review ? (
          writtenQuestions(c).map((q, i) => (
            <div key={i} className="text-sm">
              <p className="font-medium text-ink-200">{qText(q)}{qOptional(q) && <span className="ml-1 font-normal text-ink-500">· not required</span>}</p>
              <p className="whitespace-pre-wrap">{(written.answers as string[])[i]}</p>
            </div>
          ))
        ) : refusal ? (
          !written && <p className="note">Nothing sent.</p>
        ) : (
          <WrittenForm seenAt={seenAt} sessionId={c.id} questions={writtenQuestions(c)} initial={(written?.answers as string[]) ?? []} initialNotes={written?.notes ?? ""} update={!!written} />
        )}
      </section>

      {/* (NEXT-UI 4) Leaving, in its own card as in the full app. */}
      {c.status === "working" && (
        <section className="card space-y-3 text-sm" id="leave">
          <h2 className="font-semibold text-white">Can&apos;t finish?</h2>
          <p className="text-slate-400">You can leave this test: what you sent is still reviewed and paid as usual, the parts you haven&apos;t sent close with no pay, and calls ahead are cancelled. You can join again later while the test is open: your session comes back.</p>
          <LeaveButton sessionId={c.id} seenAt={seenAt} title={c.title} />
        </section>
      )}

      {/* Block the developer, as in the full app: a small link at the bottom; gone once they blocked them. */}
      {!blockedByMe && (
        <div className="text-right text-xs text-slate-500">
          <BlockButton plain seenAt={seenAt} sessionId={c.id} userId={c.test.developerId} name={dev} effect="Your session with them ends now (work you sent stays payable), calls between you are cancelled, and chat closes." />
        </div>
      )}
    </div>
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
