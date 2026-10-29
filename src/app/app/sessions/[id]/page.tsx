import { notFound, redirect } from "next/navigation";
import { LET_GO_BY_TESTER, chargedByTester, LIMITED_VIEW_LINE, WORK_OVER_PRESSES, stillWorksLine, workOver, devDeletedLine, NOT_LISTED, byTesterChoice, PAUSE_DEFAULTS, chargedDelayedLine, disputeLimitText, testerPaused, STOP_NOTE_KIND, stopReasonOf } from "@/lib/rules";
import { CheckCircle2, CircleDot, Clapperboard, ExternalLink, FileSignature, MessagesSquare, Users, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { IN_PROGRESS_TESTER, switchQuestionsLine, callJoinable, bookedLateLabel, isBookedLate, chargeAmount, choiceLine, cancelNeedsReason, canDispute, closesInLine, DELAYED_CALL_LINE, isLate, pausedForTesters, callListed, lateLabel, termsLine, testPaused, testerShare, canAskToRejoin, leftText, paidZeroLine } from "@/lib/rules";
import { callIsOver, callLengthLine, callMinutesOf, callOverBadge, callsLeftWarning, MEASURING_LINE } from "@/lib/callMeasure";
import { callsLeftCents } from "@/lib/server/callMoney";
import { callChargeCap, callChoiceLine } from "@/lib/server/holds";
import { chargeClosesLine, closeOutSoon, notPaidClosedLine } from "@/lib/rules";
import { closedOut, pieceCloseOut } from "@/lib/server/closeOut";
import { fmtTime } from "@/lib/format";
import { renderTimes } from "@/lib/tz";
import { ReasonQuote } from "@/components/ScrollText";
import { TesterAlertsToggle } from "@/components/TesterAlertsToggle";
import { requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
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
import { rowsOf, toJson } from "@/lib/callRows";
import { unreadCount } from "@/lib/server/messages";
import { PersonHover } from "@/components/PersonHover";
import { ChatWithButton } from "@/components/ChatWithButton";
import { LiveTop } from "@/components/LiveTop";
import { qText } from "@/lib/questions";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateWarning, ratingSummary, testerRateState } from "@/lib/server/ratings";
import { openOffer } from "@/lib/server/terms";
import { keyOf } from "@/lib/server/accessKeys";
import { KeyBox } from "./KeyBox";
import { WrittenAttachments } from "./WrittenAttachments";
import { Formatted } from "@/components/Formatted";
import { AttachmentList } from "@/components/AttachmentList";
import { PageLoaded } from "@/components/PageLoaded";
import { NdaBox } from "@/components/NdaBox";
import { PlusMore } from "@/components/PlusMore";
import { QuestionList } from "@/components/QuestionList";
import { ScrollText } from "@/components/ScrollText";
import { PrevSetFolds, SetView } from "@/components/AnswerSets";
import { carryOver, itemsOf, prevSetsOf } from "@/lib/answerSets";
import { ExcerptPicker } from "@/components/Excerpts";
import { excerptChoices } from "@/lib/server/excerpts";

export const metadata = { title: "Your session · Playtest" };
export const dynamic = "force-dynamic";

const label = (inContract: boolean) => (inContract ? "In your contract" : NOT_LISTED);
/** Listing (or "Not listed") and what's been paid for this part. */
const partLine = (listing: number | null, paid: number) =>
  `${listing == null ? NOT_LISTED : `Listing: ${money(listing)}`} · Paid so far for this part: ${money(paid)} (you get 80%)`;
const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-400/40 text-rose-200" } as const;

export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ failed?: string }> }) {
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
  const { id } = await params;
  // (Owner, Oct 28) Closed to a restricted account (it moves to the dashboard top), except (batch 16 section 28) the limited view of a test a suspended tester was removed from.
  const u = await requirePageUser();
  await (await import("@/lib/server/recovery")).checkStuck({ contractId: id }); // (batch 15 section 9) payments stuck "in progress"
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
  // (Batch 16 section 28) A suspended tester side opens only the tests they were removed from, in a limited view: their parts, what each was paid, the work sent,
  // and Dispute, Charge, Let it go and Rate. Everything else (sending, drafts, calls, chat, the key box, Leave, excerpt requests) stays hidden.
  const limited = !!u.testerSuspendedAt && c.status !== "working" && c.endKind === "suspended";
  if (u.testerSuspendedAt && !limited) redirect("/app");
  const dev = displayName(c.test.developer);
  // (Batch 12 section 1) A developer who deleted their account.
  const devGone = !!c.test.developer.deletedAt;
  const devRealName = displayName({ ...c.test.developer, deletedAt: null });
  const refusal = sessionRefusal(c, c.test, dev);
  // (Owner, Oct 28, batch 16 section 24) The test stopped (the developer or the team), closed, or this tester's work was ended early: the work is over. What's gone
  // (the offer, Send, uploads, the call tools, the key box, Leave) is hidden; a press of it from an old page comes back here, at the top, named in the stopped line.
  const over = workOver(c);
  const failedAsked = (await searchParams)?.failed ?? "";
  const failedPress = over && (WORK_OVER_PRESSES as readonly string[]).includes(failedAsked) ? failedAsked : "";
  const written = c.submissions.find((s) => s.kind === "written");
  const recording = c.submissions.find((s) => s.kind === "recording");
  // (Owner, Oct 29, batch 13 section 8) The written part as SETS: what was last sent (under the questions it answered), the form's current questions with carried-over
  // answers, and the previous sets kept when the tester switched to changed questions.
  const sentItems = written ? itemsOf(written.answers, writtenQuestions(c)) : [];
  const prevSets = prevSetsOf(c.prevSets);
  // (Batch 13) "Show an excerpt on your profile": paid written answers, never while the test has an NDA, one pending request per part.
  const excerptPending = written ? (await db.excerpt.count({ where: { submissionId: written.id, status: "pending" } })) > 0 : false;
  const excerptPicks = written && !c.test.ndaText && !excerptPending && !u.testerSuspendedAt ? await excerptChoices(written) : [];
  const now = new Date();
  const seenAt = now.toISOString();
  const offer = await openOffer(c.id);
  const invitedBack = c.status !== "working" && (await db.invite.count({ where: { testId: c.testId, testerId: u.id, status: "sent" } })) > 0;
  const key = c.status === "working" ? await keyOf(c.id) : null;
  // A key the developer gave after one was reported: shown as new on the session page.
  const freshKey = key && key.status === "inuse" && (await db.accessKey.count({ where: { contractId: c.id, status: "retired" } })) > 0;
  // (Design doc 9) Terms history: what they joined on, every offer and what they chose (previous questions, answers and NDAs stay here).
  const offers = await db.termsOffer.findMany({ where: { contractId: c.id }, orderBy: { createdAt: "asc" } });
  // (Owner, Oct 30, batch 15 sections 24 and 43) Their own deal history, in order: renames, previous question sets and payments too (never other testers' choices).
  const contractNotes = await db.contractNote.findMany({ where: { contractId: c.id }, orderBy: { createdAt: "asc" } });
  const historyPays = await db.payment.findMany({ where: { contractId: c.id, status: { in: ["charged", "not_set_up"] }, kind: { notIn: ["chargeback", "subscription"] } }, orderBy: { createdAt: "asc" }, select: { id: true, amountCents: true, createdAt: true, kind: true, callId: true, submissionId: true } });
  const subKinds = new Map(c.submissions.map((x) => [x.id, x.kind === "recording" ? "recording" : "written answers"]));
  const blockedPair = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: u.id }] } })) > 0;
  const partPaid = new Map((await db.payment.groupBy({ by: ["submissionId", "callId"], where: { contractId: c.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } })).map((g) => [g.submissionId ?? g.callId ?? "", g._sum.amountCents ?? 0]));
  // (Batch 11) A charge waiting for the developer's bank confirmation reads "Payment may be delayed" too.
  const delayedSubs = new Set((await db.payment.findMany({ where: { contractId: c.id, submissionId: { not: null }, kind: { not: "dispute" }, OR: [{ status: "failed", settledAt: null, owedUntil: { not: null } }, { status: "needs_confirmation" }] }, select: { submissionId: true } })).map((p) => p.submissionId!));
  // (Batch 11 / 12 section 5) A Pay whose bank confirmation is still open isn't a payment yet: the part still reads "Under review".
  const confirming = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "needs_action", kind: { in: ["review", "call"] } }, select: { submissionId: true, callId: true } })).map((p) => p.submissionId ?? p.callId ?? ""));
  for (const x of [...c.submissions, ...c.calls]) if (confirming.has(x.id)) (x as { review: unknown }).review = null;
  // (Owner, Oct 28 afternoon) A Charge pressed (or a dispute decided for them) while the developer was on a hold: added to what the developer owes, paid when they pay it.
  const owedRows = await db.payment.findMany({ where: { contractId: c.id, OR: [{ status: "owed" }, { status: "failed", settledAt: null, owedUntil: { not: null }, kind: "dispute" }, { status: "needs_confirmation", kind: "dispute" }] }, select: { submissionId: true, callId: true, kind: true, amountCents: true } });
  const chargedOwed = new Map(owedRows.filter((p) => p.kind === "review" && p.submissionId).map((p) => [p.submissionId!, p.amountCents]));
  // (Batch 9) Extra pays, with the developer's notes.
  const extraRows = await db.payment.findMany({ where: { contractId: c.id, kind: "extra", status: { in: ["charged", "not_set_up"] } }, select: { submissionId: true, callId: true, amountCents: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const disputeOwed = new Set(owedRows.filter((p) => p.kind === "dispute").map((p) => p.submissionId ?? p.callId ?? ""));
  const owedCalls = new Set((await db.payment.findMany({ where: { contractId: c.id, callId: { not: null }, kind: { not: "dispute" }, OR: [{ status: "failed", settledAt: null, owedUntil: { not: null } }, { status: "needs_confirmation" }] }, select: { callId: true } })).map((p) => p.callId!));
  const failedCalls = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "failed", callId: { not: null } }, select: { callId: true } })).map((p) => p.callId!));
  const cancelledText = (x: { status: string; cancelledBy: string | null }) => (x.status !== "cancelled" ? "" : x.cancelledBy === "tester" ? "you cancelled it" : `cancelled by ${x.cancelledBy === "developer" ? dev : "the site"}`);
  // (NEWEST+5) Rating the developer.
  const rated = await contractRatings(c.id);
  const myRating = rated.tester;
  // (Batch 17 sections 1, 2 and 19) The Rate box: open, disabled with its grey line, "Rating closed on <date>." after close-out, or hidden (incl. while suspended).
  const rateState = myRating ? { kind: "rated" as const, line: "" } : await testerRateState(c.id);
  const rateBlock = rateState.kind === "open" ? "" : rateState.kind === "rated" ? "rated" : rateState.line;
  const rateWarn = await rateWarning(c.id);
  // Live calls: the request panel shows only when there's something to do or see.
  const paused = testPaused(c.test.developer, c.test);
  // (Owner, Oct 28 afternoon) The paused-test rules (a hold, a chargeback hold or a suspension of the developer; the team's pause too by default): no sending (drafts still
  // saved); Charge / Let it go, disputes, rating, leaving and cancelling calls carry on. Testers read only "paused". (Batch 15 section 1) Chat stays open: it pauses
  // only while a person is restricted, and the chat page itself says so.
  const rulesPaused = testerPaused(c.test.developer, c.test);
  const draftsShown = !rulesPaused || PAUSE_DEFAULTS.draftsEditable;
  const meOff = !!u.testerSuspendedAt;
  // What a suspended tester can still press in the limited view (section 28): Dispute, Charge, Let it go, Rate.
  const canAct = !meOff || limited;
  // (Batch 17 section 10) In the limited view Dispute is the only press: Charge and Let it go wait for the reinstatement (Rate is hidden too).
  const canChoose = !meOff;
  // (Owner, Oct 28 afternoon) Calls can be requested whether or not a live call is a listed part (one that isn't says so: its pay is up to the developer).
  const canRequestCall = !refusal && !blockedPair && !paused;
  const listedCall = callListed(c.test, c);
  const pendingReqs = await db.callRequest.findMany({ where: { contractId: c.id, status: "pending", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  const unread = await unreadCount(u.id, c.testId, c.testerId);
  const blockedByMe = (await db.block.count({ where: { blockerId: u.id, blockedId: c.test.developerId } })) > 0;
  const devRating = (await ratingSummary(c.test.developerId)).line;
  const testersIn = await db.contract.count({ where: { testId: c.testId, status: "working" } });
  // (NEXT-UI 24) The same contract line at the top of the Written answers, Recording and Live session panels:
  // "Written answers: $8 · Required" / "Recording: Not listed", then "Paid so far $Y" if any.
  const whole = (cents: number) => money(cents).replace(/\.00$/, "");
  const termLine = (name: string, cents: number | null, required: boolean, perHour: boolean, paid: number) => (
    <p className="note" data-term-line={name}>
      {name}: {cents == null ? NOT_LISTED : `${cents === 0 ? "free" : `${whole(testerShare(cents))}${perHour ? "/h" : ""}`} · ${required ? "Required" : "Not required"}`}
      {paid > 0 && ` · Paid so far ${whole(paid)}`}
    </p>
  );
  const liveCalls = c.calls.filter((x) => x.status === "booked");
  // (Batch 15 sections 31 and 40) "held" became "done": a call that took place (its length is final).
  const heldCalls = liveCalls.filter((x) => callMinutesOf(x) != null);
  const aheadCalls = liveCalls.filter((x) => x.startsAt > now);
  // (Batch 15 section 42) Calls that are over (took place, cancelled, nobody joined, missed …) go in "Call history"; the Live session keeps the ones ahead or in progress.
  const overCalls = c.calls.filter((x) => callIsOver(x) || blockedPair).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const callsWarning = callsLeftWarning(await callsLeftCents(c.id), listedCall ? c.liveRateCents : null, "tester", displayName(u));
  const callCaps = new Map(await Promise.all(c.calls.filter((x) => x.choiceOfferedAt && !x.review).map(async (x) => [x.id, await callChargeCap(x)] as const)));
  // (Batch 17 §19) Each unpaid piece's own closing date for the tester (the test's close-out, or 14 days after its Charge opened if later, plus the time their tester side
  // was suspended): Charge and Let it go end then and the piece reads "Not paid (closed on <date>)"; its Charge box says when in its last 7 days.
  const openKeys: { submissionId?: string; callId?: string }[] = [...c.submissions.filter((x) => !x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((x) => !x.review && x.status === "booked").map((x) => ({ callId: x.id }))];
  const chargeCloses = new Map(await Promise.all(openKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, "tester", now)] as const)));
  const chargeShut = (pieceId?: string) => !!pieceId && closedOut(chargeCloses.get(pieceId) ?? null, now);
  const shutOn = (pieceId: string) => fmtDate(chargeCloses.get(pieceId)!);
  const chargeSoon = (pieceId?: string) => (pieceId && closeOutSoon(chargeCloses.get(pieceId) ?? null, now) ? chargeClosesLine(fmtDate(chargeCloses.get(pieceId)!)) : "");
  const infoChanged = (await db.testEvent.count({ where: { testId: c.testId, kind: "info", createdAt: { gt: c.joinedAt } } })) > 0;
  // (NEXT-UI 7) The calls, and the booked daily / weekly sets as one line each ("Weekly · Mon 3:00 PM (3 left)").
  // (Batch 15 section 42) The Live session: only calls ahead and calls in progress ("Call in progress / measuring" once started).
  const mineCalls = c.calls.filter((x) => x.status === "booked" && !callIsOver(x) && !blockedPair).map((x) => ({ id: x.id, setId: x.setId, joinable: !paused && !refusal && callJoinable(x, now), when: x.startsAt.toISOString(), minutes: x.minutes, room: roomUrl(x), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, ended: false, report: x.noShowBy ? { byMe: x.noShowBy === "tester", note: x.noShowNote } : null, lengthText: x.startsAt <= now ? (paused || refusal ? IN_PROGRESS_TESTER : MEASURING_LINE) : "", reported: !!x.noShowBy, cancelled: cancelledText(x), rate: rateLabel(x.rateCents, c.liveRateCents), late: isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined }));
  const callSets = await db.callSet.findMany({ where: { contractId: c.id } });
  const mineSets = [...new Set(c.calls.filter((x) => x.setId && x.status === "booked" && !x.review).map((x) => x.setId!))].flatMap((sid) => {
    const cs = c.calls.filter((x) => x.setId === sid && x.status === "booked" && !x.review).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const row = callSets.find((x) => x.id === sid);
    const daily = row ? row.repeat === "daily" : cs.length > 1 && cs[1].startsAt.getTime() - cs[0].startsAt.getTime() < 2 * 86_400_000;
    const left = cs.filter((x) => x.startsAt > now).length;
    if (!left) return [];
    const next = cs.find((x) => x.startsAt > now)!;
    return [{ id: sid, label: `${daily ? "Daily" : "Weekly"} · ${cs[0].startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}${row?.count === 0 ? "" : ` (${left} left)`}`, minutes: cs[0].minutes, rate: rateLabel(cs[0].rateCents, c.liveRateCents), needsReason: cancelNeedsReason(next.startsAt, now), callIds: cs.map((x) => x.id) }];
  });
  // (Owner, Oct 29, batch 10) A paused test hides what doesn't work right now (Send, the call-request tools, Join call, chat's message box) and says at the top what still
  // works, built from what is actually on the page (the server refusals stay as a backstop).
  const choiceOpen = (sub: typeof written) => !!(sub && !sub.review && sub.choiceOfferedAt && sub.choiceBy && canChoose && !chargeShut(sub.id) && chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0) > 0);
  const disputable = (r: { amountCents: number; agreedCents: number | null; reason: string } | null | undefined, d: unknown) => !!r && canAct && canDispute(r.amountCents, r.agreedCents, !!d, byTesterChoice(r.reason)).ok;
  const unpaidPart = !written?.review || !recording?.review;
  const pausedBanner = rulesPaused ? pausedForTesters({
    drafts: draftsShown && !refusal && !meOff && unpaidPart,
    charge: choiceOpen(written) || choiceOpen(recording),
    dispute: [written, recording].some((x) => x && !chargedOwed.has(x.id) && !delayedSubs.has(x.id) && disputable(x.review, x.dispute)) || c.calls.some((x) => !owedCalls.has(x.id) && disputable(x.review, x.dispute)),
    rate: rateBlock === "" && !meOff,
    leave: c.status === "working" && !meOff,
    cancelCalls: aheadCalls.length > 0 && !blockedPair && !meOff,
    send: !refusal && !meOff && unpaidPart,
    requestCalls: !refusal && !meOff && !blockedPair && c.test.status !== "stopped",

    deadline: c.status === "working", // (batch 11) a working tester's deadline moves with the pause
  }) : "";
  // (Batch 16 section 24) What still works once the work is over, built from what is actually on the page (as the paused banner does).
  const stillWorks = {
    charge: !meOff && !devGone && ([written, recording].some((x) => !!x && !x.review && !chargeShut(x.id) && (x.agreedCents ?? 0) > 0 && chargeAmount(x.agreedCents, partPaid.get(x.id) ?? 0) > 0) || c.calls.some((x) => !x.review && !chargeShut(x.id) && x.status === "booked" && callMinutesOf(x) != null && callListed(c.test, c))),
    dispute: [written, recording].some((x) => x && !chargedOwed.has(x.id) && !delayedSubs.has(x.id) && disputable(x.review, x.dispute)) || c.calls.some((x) => !owedCalls.has(x.id) && disputable(x.review, x.dispute)),
    rate: rateBlock === "" && !meOff,
    excerpt: excerptPicks.length > 0,
    chat: !meOff && !blockedPair,
  };
  // The full app's session page: one centred column; the header card (title, by, badges, Chat, Open the product), then a
  // card per part.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh query={`session=${c.id}`} />
      {/* (Batch 16 section 38B) Call changes stop a press once even after a refresh showed them: counted from when the page first loaded here. */}
      <PageLoaded at={seenAt} />
      {/* (Design doc 8, owner Oct 26) The top, in this order: the test name, the access-key box, the live updates box (every change except the
          contract's), and right below it the Switch / Keep offer box. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {c.test.productName && <p className="kicker">{c.test.productName}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-white">{c.title}</h1>
        </div>
        {/* (Batch 15 section 26) The tester's one-press Alerts, at the top right. */}
        {/* (Batch 16 section 24) After the work is over, only while something left on the page can still stop (Charge / Let it go, Dispute, Rate). */}
        {!meOff && (!over || stillWorks.charge || stillWorks.dispute || stillWorks.rate) && <TesterAlertsToggle off={u.testerAlertsOff} />}
      </div>
      {pausedBanner && <p className="info" data-paused="">{pausedBanner}</p>}
      {key && <KeyBox canReport={!meOff} sessionId={c.id} seenAt={seenAt} value={key.value} broken={key.status === "broken"} fresh={!!freshKey} fixed={!!key.fixedAt} />}
      <LiveTop scope={`session:${c.id}`} seenAt={seenAt} seeIt="#listing" />
      <TesterTop sessionId={c.id} seenAt={seenAt} devName={dev} offer={offer && !refusal ? {
        id: offer.id, diff: offer.diff, ndaText: offer.ndaText, fromNdaText: c.ndaText, questions: ((offer.questions as string[]) ?? []).map(qText), fromQuestions: ((c.questions as string[]) ?? []).map(qText),
        answers: sentItems.map((x) => x.answer),
        // (Batch 18 section 8) Switching means answering the new questions; answers already sent stay payable at their price.
        switchNote: switchQuestionsLine(written),
      } : null} />
      {limited && <p className="info" data-limited-view="">{LIMITED_VIEW_LINE}</p>}
      {refusal && !limited && <div className="info space-y-1" id="stopped-line" data-stopped-line="" {...(failedPress ? { "data-work-over-failed": failedPress } : {})}><p>{over ? stillWorksLine(c, dev, fmtDate, stillWorks, failedPress) : refusal}</p>
        {/* (Batch 15 sections 20 and 22) The developer's End early reason, in italics, scrolling when long (never in the bell line). */}
        {c.status === "ended" && c.endKind === "early" && c.endReason && <ReasonQuote text={c.endReason} />}
        {/* (Batch 17 §15) The developer's Stop reason, the same way (only the developer's own Stop writes the note; the team's Stop reason is never shown here). */}
        {c.status === "ended" && c.endKind === "stopped" && c.endReason && contractNotes.some((n) => n.kind === STOP_NOTE_KIND) && <ReasonQuote text={c.endReason} />}
      </div>}
      {/* (Batch 15 section 18) The tester's OWN deadline, not the test's Open until (the last day to join). */}
      {!refusal && c.status === "working" && c.dueAt > now && c.dueAt.getTime() - now.getTime() < 3 * 86_400_000 && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(c.title, c.dueAt, now)}</p>
      )}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm text-slate-400">by{" "}
              <PersonHover name={dev} href={`/app/developers/${c.test.developerId}`} summary={[devRating || "No ratings yet"]} chat={!meOff ? <ChatWithButton contractId={c.id} name={dev} /> : undefined} />
              {" "}· joined {fmtDate(c.joinedAt)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {c.test.status === "stopped" && <span className="badge border-sky-300/40 text-sky-200"><span className="h-2 w-2 rounded-sm bg-sky-300" /> Stopped</span>}
              <span className={`badge ${c.status === "working" ? "border-emerald-400/40 text-emerald-200" : ""}`}>{c.status === "working" ? "Working" : c.status === "left" ? "You left" : "Ended"}</span>
              {c.writtenCents != null && <span className="badge">Written answers</span>}
              {c.recordingCents != null && <span className="badge">Screen recording</span>}
              {c.liveRateCents != null && <span className="badge">Live call</span>}
              <span className="badge"><Users className="h-3.5 w-3.5" /> {testersIn} tester{testersIn === 1 ? "" : "s"} on this test</span>
              {c.test.mature && <span className="badge border-rose-300/40 text-rose-200" title={c.test.matureWhy}>Mature (18+)</span>}
            </div>
          </div>
          {!meOff && <a href={`/app/chat/${c.id}`} className="btn-secondary relative min-w-0 max-w-full no-underline hover:no-underline"><MessagesSquare className="h-4 w-4 shrink-0" /> <span className="truncate">Chat with {dev}</span>
            {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unread} unread`}>{unread}</span>}
          </a>}
        </div>
        {/* (Batch 15 section 17) The steps in a scroll box about 6 lines tall. */}
        {c.description && <ScrollText text={c.description} className="text-slate-300" label="What to do" />}
        <p className="text-sm text-slate-400">Due {fmtDate(c.dueAt)}{c.status === "working" && c.dueAt > now && c.dueAt.getTime() - now.getTime() < 24 * 3_600_000 ? ` · ${leftText(c.dueAt.getTime() - now.getTime())} left` : ""}{isLate(c.dueAt, now) && !refusal ? ": your deadline has passed, late work is still accepted and marked late." : ""}</p>
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
        {c.ndaText && c.ndaAcceptedAt && (
          <details className="text-sm" data-nda="">
            <summary className="cursor-pointer text-slate-300">NDA accepted {fmtDate(c.ndaAcceptedAt)}</summary>
            <div className="mt-1"><NdaBox text={c.ndaText} /></div>
          </details>
        )}

      </section>

      {myRating && !rated.testerRevealed && <p className="note">You rated {dev}.</p>}
      {myRating && rated.testerRevealed && <p className="note">You rated {dev}: {myRating.stars} ★{myRating.comment ? ` · “${myRating.comment}”` : ""}</p>}
      {rated.developer && <p className="note">{dev} rated you: {rated.developer.stars} ★{rated.developer.comment ? ` · “${rated.developer.comment}”` : ""}</p>}
      {rateState.kind === "closed" && !meOff && <p className="note" data-rating-closed="">{rateState.line}</p>}
      {(rateState.kind === "open" || rateState.kind === "disabled") && !meOff && (
        <RateBox
          disabledLine={rateState.kind === "disabled" ? rateState.line : ""}
          path={`/api/sessions/${c.id}/rate`}
          seenAt={seenAt}
          name={dev}
          working={rateWarn.working}
          headline={rateWarn.working ? `Rating ends your part in ${c.title}. You won't be able to send more work, book calls or join this test again.` : `Once you rate, you won't be able to join ${c.title} again.`}
          lines={rateWarn.lines}
        />
      )}
      {/* (Design doc 8) Back in: an invite brings a Join here; otherwise an ask the developer accepts (before the deadline, never after a stop or a rating). */}
      {c.status !== "working" && !myRating && !meOff && c.test.status === "open" && (invitedBack || canAskToRejoin(c, false)) && (
        <section id="rejoin" className="card space-y-3 scroll-mt-24 border-emerald-400/30 text-sm">
          <p className="font-semibold text-white">{invitedBack ? `${dev} invited you back to ${c.title}` : `Ask to rejoin ${c.title}`}</p>
          <p className="text-ink-300">{invitedBack ? "Join to get your session back, with everything in it (work you sent, payments and chat)." : `If ${dev} accepts, your session comes back with everything in it (work you sent, payments and chat) on the current listing, with the time you had left.`}</p>
          <a className="btn" href={`/app/find/${c.testId}`}>{invitedBack ? "Join" : "Ask to rejoin"}</a>
        </section>
      )}

      {/* The full app's "Your agreed scope" fold: what the contract says. */}
      <details className="card">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your agreed scope</summary>
        <ul className="mt-3 space-y-1 text-sm text-slate-300">
          <li>Deliverables: {[c.writtenCents != null ? "written answers" : "", c.recordingCents != null ? "screen recording" : "", c.liveRateCents != null ? "live call" : ""].filter(Boolean).join(", ") || "none in your contract"}</li>
          <li>Prices (what you get): {termsLine(c, true)}</li>
          <li>Due {fmtDate(c.dueAt)}</li>
          {writtenQuestions(c).length > 0 && <li>Questions: <PlusMore items={writtenQuestions(c).map((q) => `“${qText(q)}”`)} /></li>}
          <li>Agreed {fmtDate(c.joinedAt)}. Everything above is fixed in your contract; if {dev} changes the listing later you choose Switch or Keep.</li>
        </ul>
        {/* (Design doc 9) The terms history: every offer and what you chose, with the questions and NDA you were on. */}
        <div className="mt-3 space-y-2 text-sm" data-terms-history="">
          <p className="font-medium text-white">Terms history</p>
          <ul className="space-y-1.5 text-slate-300">
            <li>{fmtDate(c.joinedAt)}: you joined on {termsLine(c, true)}{c.ndaAcceptedAt ? ` and accepted the NDA` : ""}.</li>
            {[
              ...offers.map((o) => ({ at: o.createdAt, key: o.id, node: (<li key={o.id}>
                {fmtDate(o.createdAt)}: {dev} offered new terms ({o.diff}) · {o.status === "switched" ? `you switched${o.decidedAt ? ` on ${fmtDate(o.decidedAt)}` : ""}` : o.status === "kept" ? `you kept your terms${o.decidedAt ? ` on ${fmtDate(o.decidedAt)}` : ""}` : o.status === "open" ? "waiting for your answer" : "replaced by a newer offer"}
                {Array.isArray(o.fromQuestions) && JSON.stringify(o.fromQuestions) !== JSON.stringify(o.questions) && (
                  <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">Questions then and now</summary>
                    {/* (Batch 13 section 9) 3 questions, then "+N more". */}
                    {/* (Batch 15 section 3) Each question cut to 3 lines with Show more; 3 then +N more. */}
                    <div>Then: <QuestionList items={(o.fromQuestions as string[]).map(qText)} /></div>
                    <div>Offered: <QuestionList items={((o.questions as string[]) ?? []).map(qText)} /></div></details>
                )}
                {o.fromNdaText !== o.ndaText && (
                  <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">NDA then and now</summary>
                    <div className="mt-1 space-y-2"><NdaBox label="Before" text={o.fromNdaText} /><NdaBox label="Offered" text={o.ndaText} /></div></details>
                )}
              </li>) })),
              ...contractNotes.map((n) => ({ at: n.createdAt, key: n.id, node: n.kind === STOP_NOTE_KIND
                ? <li key={n.id} data-history-line="">{`${fmtDateTime(n.createdAt)}: Test stopped`}<ReasonQuote text={stopReasonOf(n.text)} /></li> // (Batch 17 §15) the reason in its scroll box
                : <li key={n.id} data-history-line="">{`${fmtDateTime(n.createdAt)}: ${n.text}`}</li> })),
              ...prevSetsOf(c.prevSets).map((p) => ({ at: new Date(p.until), key: `set-${p.until}`, node: <li key={`set-${p.until}`} data-history-line="">{`${fmtDate(new Date(p.until))}: your questions changed; your earlier answers are kept under “Previous questions and answers”`}</li> })),
              ...historyPays.map((p) => ({ at: p.createdAt, key: p.id, node: <li key={p.id} data-history-line="">{`${fmtDate(p.createdAt)}: ${p.kind === "extra" ? "paid more" : p.kind === "dispute" ? "the team raised the pay by" : "paid"} ${money(p.amountCents)} for your ${p.callId ? "live call" : subKinds.get(p.submissionId ?? "") ?? "work"} (you get ${money(testerShare(p.amountCents))})`}</li> })),
            ].sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => x.node)}
          </ul>
        </div>
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
                {sub && !sub.review && !chargedOwed.has(sub.id) && (devGone && !sub.choiceOfferedAt
                  // (Batch 15 section 32) The developer deleted their account: not "Under review" any more.
                  ? <span className="badge border-rose-300/40 text-rose-200" data-part-status="gone">Can&apos;t be paid: {devRealName} deleted their account</span>
                  : chargeShut(sub.id) ? <span className="badge" data-part-status="closed">{notPaidClosedLine(shutOn(sub.id))}</span> // (Batch 17 §19)
                  : <span className="badge border-amber-300/40 text-amber-200" data-part-status="review">Under review</span>)}
                <span className="text-slate-200">{sub ? <>Sent {fmtDateTime(sub.updatedAt)}{sub.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}</> : "Not sent yet"}</span>
                {cents != null && <span className={`badge ${required ? "border-amber-300/40 text-amber-200" : ""}`}>{required ? "Required" : "Not required"}</span>}
              </p>
              <p className="text-slate-400">{cents == null ? NOT_LISTED : `In your contract · ${cents === 0 ? "free" : `${money(testerShare(cents))} for you`}`}{` · Paid so far ${money(sub ? partPaid.get(sub.id) ?? 0 : 0)}`}</p>
              {sub && <p className="text-xs text-slate-500">{partLine(sub.agreedCents, partPaid.get(sub.id) ?? 0)}</p>}
              {sub && !sub.review && sub.choiceOfferedAt && sub.choiceBy && canChoose && !chargeShut(sub.id) && chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0) > 0 && (
                <ChoiceBox paused={rulesPaused} seenAt={seenAt} sessionId={c.id} submissionId={sub.id} devName={dev} cents={chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0)} line={choiceLine(dev, key, chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0))} />
              )}
              {/* (Batch 17 §19) Its last 7 days before close-out. */}
              {chargeSoon(sub?.id) && choiceOpen(sub) && <p className="note" data-charge-closes="">{chargeSoon(sub?.id)}</p>}
              {/* (Batch 12 section 1) The developer deleted their account before Charge opened: this part can't be paid. */}
              {sub && !sub.review && !sub.choiceOfferedAt && devGone && <p className="info" data-dev-deleted="">{devDeletedLine(devRealName)}</p>}
              {sub && chargedOwed.has(sub.id) ? <p className="info" data-charged-delayed="">{chargedDelayedLine(chargedOwed.get(sub.id)!)}</p> : sub && delayedSubs.has(sub.id) ? <p className="info">Payment for this part may be delayed.</p> : sub?.review && <TesterReview dev={dev} extras={extraRows.filter((p) => p.submissionId === sub.id)} off={meOff && !limited} delayed={disputeOwed.has(sub.id)} sessionId={c.id} kind="submission" id={sub.id} review={sub.review} dispute={sub.dispute} />}
            </li>
          ))}
          <li id="part-live" data-part="live" className="scroll-mt-24 space-y-1.5 rounded-xl border border-white/[0.08] p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-white">
              <CircleDot className={`h-4 w-4 ${heldCalls.length ? "text-amber-300" : "text-slate-400"}`} />
              <strong>Live call:</strong>
              <span className="text-slate-200">{heldCalls.length ? `${heldCalls.length} done` : aheadCalls.length ? `${aheadCalls.length} booked` : "Not booked yet"}</span>
              {c.liveRateCents != null && <span className={`badge ${c.liveRequired ? "border-amber-300/40 text-amber-200" : ""}`}>{c.liveRequired ? "Required" : "Not required"}</span>}
            </p>
            <p className="text-slate-400">{c.liveRateCents == null ? NOT_LISTED : `In your contract · ${c.liveRateCents === 0 ? "free" : `${money(testerShare(c.liveRateCents))}/h for you`}`}{` · Paid so far ${money(liveCalls.reduce((a, x) => a + (partPaid.get(x.id) ?? 0), 0))}`}</p>
            {callsWarning && <p className="text-xs text-amber-200" data-calls-warning="">{callsWarning}</p>}
            {c.calls.filter((x) => !x.review && x.status === "booked" && callMinutesOf(x) != null).map((x) => devGone ? <p key={x.id} className="info" data-dev-deleted="">Live call on {fmtDateTime(x.startsAt)}: {devDeletedLine(devRealName)}</p> : (
              <div key={x.id} className="space-y-1">
                {/* (Owner, Oct 28, batch 16 section 40) One short grey line per call (the part line above has the rate and what's paid so far); blue only for a real notice. */}
                <p className="text-xs text-slate-400" data-call-row="" data-call-length="">{fmtDateTime(x.startsAt)} · {callMinutesOf(x)} min · {chargeShut(x.id) ? notPaidClosedLine(shutOn(x.id)) : <>waiting for {dev} to pay</>}</p>
                {failedCalls.has(x.id) && <p className="info">{DELAYED_CALL_LINE}</p>}
                {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                {/* (Batch 15 section 15) A listed call left unpaid past its review date: Charge or Let it go, as a sent part. */}
                {x.choiceOfferedAt && canChoose && !chargeShut(x.id) && (callCaps.get(x.id)?.cents ?? 0) > 0 && (
                  <ChoiceBox paused={rulesPaused} seenAt={seenAt} sessionId={c.id} callId={x.id} devName={dev} cents={callCaps.get(x.id)!.cents} line={renderTimes(callChoiceLine(dev, x.startsAt, callCaps.get(x.id)!.cents, callCaps.get(x.id)!.capped), u.timeZone)} />
                )}
                {chargeSoon(x.id) && x.choiceOfferedAt && canChoose && (callCaps.get(x.id)?.cents ?? 0) > 0 && <p className="note" data-charge-closes="">{chargeSoon(x.id)}</p>}
              </div>
            ))}
            {c.calls.filter((x) => x.review).map((x) => (
              <div key={x.id} className="space-y-2">
                <p className="text-xs text-slate-400" data-call-row="">{fmtDateTime(x.startsAt)} · {callMinutesOf(x) ?? x.minutes} min · {callOutcome(x.review!)}</p>
                {owedCalls.has(x.id) ? <p className="info">{DELAYED_CALL_LINE}</p> : <TesterReview dev={dev} extras={extraRows.filter((p) => p.callId === x.id)} off={meOff && !limited} delayed={disputeOwed.has(x.id)} sessionId={c.id} kind="call" id={x.id} review={x.review!} dispute={x.dispute} />}
              </div>
            ))}
          </li>
        </ul>
      </section>

      {/* The full app's ONE Live session panel: the rate, Booked, Past calls and Requests (calls are always requests). */}
      {!limited && (c.calls.length > 0 || canRequestCall || pendingReqs.length > 0) && (
        <LivePanel minutes={c.calls.filter((x) => x.status === "booked" && x.startsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]?.minutes ?? null}>
          {termLine("Live call", c.liveRateCents, c.liveRequired, true, liveCalls.reduce((a, x) => a + (partPaid.get(x.id) ?? 0), 0))}
          {!listedCall && c.liveRateCents != null && <p className="note" data-unlisted-call="">New calls: {NOT_LISTED}</p>}
          {callsWarning && <p className="text-xs text-amber-200" data-calls-warning="">{callsWarning}</p>}
          <TesterCallPanel
            sessionId={c.id}
            seenAt={seenAt}
            refusal={refusal}
            devName={dev}
            mine={mineCalls}
            sets={mineSets}
            noReport={meOff}
            lateNote={now > c.dueAt ? `Your deadline was ${fmtDate(c.dueAt).replace(/, \d{4}$/, "")} (a guide, not a limit): a call you book now reads “${bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, ""))}”.` : undefined}
          />
          {(canRequestCall || (pendingReqs.length > 0 && !paused && !refusal)) && (
            <section className="space-y-1.5" aria-label="Call requests" data-live-section="Requests">
              <h3 className="text-sm font-semibold text-white">Requests</h3>
              <CallRequests
                side="tester"
                path={`/api/sessions/${c.id}`}
                seenAt={seenAt}
                canRequest={canRequestCall}
                targets={[{ contractId: c.id, name: dev, rate: "" }]}
                requests={pendingReqs.map((r) => ({ id: r.id, minutes: r.minutes, rows: toJson(rowsOf(r)), mine: r.fromSide === "tester", who: dev, contractId: c.id, rate: rateLabel(listedCall ? c.liveRateCents : null, c.liveRateCents) }))}
                // (Batch 16 section 33) The clash checks while the form is filled: the calls between you, your other calls, and the limits.
                clash={{
                  calls: liveCalls.filter((x) => x.startsAt > new Date(now.getTime() - 6 * 3_600_000)).map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes })),
                  elsewhere: (await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, contract: { testerId: u.id, id: { not: c.id } } }, include: { contract: { include: { test: { include: { developer: true } } } } } }))
                    .map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes, name: displayName(x.contract.test.developer) })),
                  pending: pendingReqs.length,
                  booked: new Set(liveCalls.filter((x) => x.startsAt > now).map((x) => x.setId ?? x.id)).size,
                  leftCents: await callsLeftCents(c.id),
                  rateCents: listedCall ? c.liveRateCents : null,
                }}
              />
            </section>
          )}
        </LivePanel>
      )}
      {/* (Batch 15 section 42) Call history: every call that's over, newest first, with its outcome badge (the same badges as the developer's tester row). */}
      {overCalls.length > 0 && (
        <details className="card text-sm" id="call-history" data-call-history="">
          <summary className="fold-chevron cursor-pointer font-semibold text-white">Call history ({overCalls.length})</summary>
          <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
            {overCalls.map((x) => {
              const shown = blockedPair && x.status !== "cancelled" ? { ...x, status: "cancelled", cancelledBy: "system", cancelNote: "not available" } : x;
              const badge = callOverBadge(shown, { developer: dev, tester: displayName(u) }, "tester", fmtTime, partPaid.get(x.id) ?? 0, callMinutesOf(x));
              return (
                <li key={x.id} id={`call-${x.id}`} data-over-call={x.id} className="scroll-mt-24 space-y-1 rounded-lg border border-white/5 p-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                    <span className={`badge ${TONE[badge.tone]}`} data-call-badge="">{badge.label}</span>
                  </div>
                  {shown.status !== "cancelled" && <p className="text-xs text-slate-400">{callLengthLine(x, fmtTime)}</p>}
                  {badge.reason && <ReasonQuote text={badge.reason} />}
                  {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {/* The full app's "Your recordings" card, then "The written part" (a card of its own). */}
      <section className="card space-y-3" id="recording">
        <h2 className="flex flex-wrap items-center gap-2 font-semibold text-white"><Clapperboard className="h-5 w-5 text-fuchsia-300" /> Your recordings
          <span className="text-sm font-normal text-slate-400">{c.recordingCents != null ? "(the recorded session part)" : "(clips, if you like)"}</span></h2>
        {termLine("Recording", c.recordingCents, c.recordingRequired, false, recording ? partPaid.get(recording.id) ?? 0 : 0)}
        <RecordingUpload
          seenAt={seenAt}
          sessionId={c.id}
          canSend={!refusal && !recording?.review && !meOff && draftsShown}
          sendable={!rulesPaused}
          sentBefore={!!recording}
          recordings={c.recordings.filter((r) => r.part === "recording").map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt, sent: !!r.submissionId }))}
        />
      </section>

      <section className="card space-y-3" id="written">
        <h2 className="font-semibold text-white">The written part</h2>
        {termLine("Written answers", c.writtenCents, c.writtenRequired, false, written ? partPaid.get(written.id) ?? 0 : 0)}
        {/* (Owner, Oct 28 evening) Paid, or the test stopped / their work ended: the answers they sent stay readable (no Send). */}
        {written && (written.review || refusal || meOff) ? (
          <div className="space-y-2" data-sent-answers="">
            {written.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(written.setUntil)}</p>}
            <SetView items={sentItems} />
            {written.notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><Formatted text={written.notes} /></div>}
            <AttachmentList items={c.recordings.filter((r) => r.part === "written" && r.uploadedAt && r.submissionId === written.id)} />
          </div>
        ) : refusal || meOff || !draftsShown ? (
          !written ? <p className="note">Nothing sent.</p> : null
        ) : (
          <>
            {written?.setUntil && <p className="note" data-set-until="">What you sent is for the questions until {fmtDate(written.setUntil)}: {dev} reviews it at the price it was sent at. Send again to send these questions instead.</p>}
            <WrittenForm canSend={!rulesPaused} seenAt={seenAt} sessionId={c.id} questions={writtenQuestions(c)} initial={carryOver(sentItems, writtenQuestions(c))} initialNotes={written?.notes ?? ""} update={!!written} />
            {/* (Batch 11) Files and recordings attached to the written part (drafts: they can be added while the test is paused). */}
            <WrittenAttachments sessionId={c.id} canAdd items={c.recordings.filter((r) => r.part === "written").map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt, video: r.contentType.startsWith("video/"), sent: !!r.submissionId }))} />
          </>
        )}
        {/* (Batch 13 section 8) The previous sets of questions and answers, newest first, read-only. */}
        <PrevSetFolds sets={prevSets} sentPart={!!written} />
        {/* (Batch 13) Show an excerpt of paid written answers on the profile (the developer allows or denies it). */}
        {written && excerptPicks.length > 0 && <ExcerptPicker submissionId={written.id} choices={excerptPicks} />}
        {excerptPending && <p className="note" data-excerpt-pending="">Your excerpt request is waiting for {dev}.</p>}
      </section>

      {/* (NEXT-UI 4) Leaving, in its own card as in the full app. */}
      {c.status === "working" && !meOff && (
        <section className="card space-y-3 text-sm" id="leave">
          <h2 className="font-semibold text-white">Can&apos;t finish?</h2>
          <p className="text-slate-400">You can leave this test: what you sent is still reviewed and paid as usual, the parts you haven&apos;t sent close with no pay, and calls ahead are cancelled. You can join again later while the test is open: your session comes back.</p>
          <LeaveButton sessionId={c.id} seenAt={seenAt} title={c.title} />
        </section>
      )}

    </div>
  );
}

type Rev = { amountCents: number; agreedCents: number | null; rejected: boolean; reason: string; createdAt: Date; rateCents?: number | null };
/** (Batch 16 section 40) A reviewed call's word on its grey line: "paid $X", "charged", "let go" (an older rejection: "rejected"). */
const callOutcome = (r: Rev) => (r.rejected ? "rejected" : r.reason === LET_GO_BY_TESTER ? "let go" : chargedByTester(r.reason) ? "charged" : `paid ${money(r.amountCents)}`);
type Disp = { status: string; decidedCents: number | null; decisionNote: string; devSide: string } | null;

/** What the developer did with a piece, as the tester reads it (they see what they get; never holds or chargebacks). */
function TesterReview({ sessionId, kind, id, review, dispute, delayed = false, off = false, dev = "The developer", extras = [] }: { dev?: string; /** (Batch 9) extra pays on this piece, with their notes */ extras?: { amountCents: number; note: string; createdAt: Date }[]; off?: boolean; /** A raise decided while the developer was on a hold: owed, paid when they pay it. */ delayed?: boolean; sessionId: string; kind: "submission" | "call"; id: string; review: Rev; dispute: Disp }) {
  // (Batch 10) Every part the developer reviewed can be disputed once, listed or not (not the tester's own Charge or Let it go).
  const may = canDispute(review.amountCents, review.agreedCents, !!dispute, byTesterChoice(review.reason)).ok;
  return (
    <div className="space-y-2 rounded-lg bg-white/[0.03] p-3 text-sm">
      {review.rejected ? (
        // (Batch 15 section 30) Old rejections stay, and read "Rejected".
        <p><b>Rejected</b> ({fmtDateTime(review.createdAt)}): “{review.reason}”</p>
      ) : review.amountCents === 0 && review.reason && !byTesterChoice(review.reason) ? (
        <p data-paid-zero="">{paidZeroLine(review.reason)} ({fmtDateTime(review.createdAt)})</p>
      ) : review.amountCents === 0 ? (
        <p data-paid-zero="">{dev} paid $0 for this ({fmtDateTime(review.createdAt)})</p>
      ) : (
        <p>
          <b>Paid {money(review.amountCents)}</b>{review.rateCents != null && <> ({money(review.rateCents)}/h)</>}: you get {money(testerShare(review.amountCents))} ({fmtDateTime(review.createdAt)})
          {review.reason && <> · “{review.reason}”</>}
        </p>
      )}
      {extras.map((x, i) => <p key={i} data-extra-line="">Extra {money(x.amountCents)}: you get {money(testerShare(x.amountCents))} ({fmtDateTime(x.createdAt)}){x.note && <> · “{x.note}”</>}</p>)}
      {dispute && <p>{dispute.status === "open" ? "You disputed this: waiting for the team." : `The team decided: ${money(dispute.decidedCents)} in all${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : ""}.`}</p>}
      {delayed && <p className="info" data-dispute-delayed="">Payment may be delayed until the test resumes.</p>}
      {dispute?.devSide && <p>The developer&apos;s side: “{dispute.devSide}”</p>}
      {may && !off && <DisputeForm sessionId={sessionId} kind={kind} id={id} seenAt={new Date().toISOString()} limit={disputeLimitText(review.agreedCents, kind)} />}
    </div>
  );
}
