import { renderTimes } from "@/lib/tz";
import { NameLink } from "@/components/Cut";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtTimeIn } from "@/lib/format";
import { notFound, redirect } from "next/navigation";
import { PAYOUT_SETUP_HINT } from "@/lib/payout";
import { CALL_MIN_AHEAD_MINUTES } from "@/lib/callLead";
import { LIMITED_VIEW_LINE, WORK_OVER_PRESSES, stillWorksLine, workOver, NOT_LISTED, byTesterChoice, PAUSE_DEFAULTS, disputeLimitText, testerPaused, STOP_NOTE_KIND, stopReasonOf, chargeOpensNote, chargeOpensAt } from "@/lib/rules";
import { CheckCircle2, CircleDot, Clapperboard, ExternalLink, FileSignature, Languages, MessagesSquare, Monitor, Users, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDateIn, fmtDateTimeIn, fmtStampIn, money, stopTimeIn } from "@/lib/server/dateFormat";
import { LISTING_VALUES, historyRows, infoLines, parseValues } from "@/lib/listingInfo";
import { ListingSeeIt, UpdatedTag } from "@/components/ListingInfo";
import { CategoryBadges } from "@/components/Category";
import { PartBadges } from "@/components/Ui";
import { TesterPaymentTag } from "@/components/TesterPaymentTag";
import { IN_PROGRESS_TESTER, switchQuestionsLine, callJoinable, bookedLateLabel, isBookedLate, chargeAmount, choiceLine, cancelNeedsReason, canDispute, NOTHING_TO_DISPUTE, closesInLine, isLate, pausedForTesters, callListed, termsLine, testPaused, testerShare, leftText, paidZeroLine } from "@/lib/rules";
import { disputeRoom, paidAndCap } from "@/lib/server/payments";
import { payMoreClosesAt } from "@/lib/server/closeOut";
import { payClosedLine, testerPaidMostLine, testerPayMoreLine } from "@/lib/rules";
import { callIsOver, callLengthLine, callMinutesOf, callOverBadge, callsLeftWarning, MEASURING_LINE } from "@/lib/callMeasure";
import { callsLeftCents } from "@/lib/server/callMoney";
import { testerAutoChargeLine } from "@/lib/rules";
import { chargeClosesLine, closeOutSoon } from "@/lib/rules";
import { closedOut, pieceCloseOut } from "@/lib/server/closeOut";

import { ReasonQuote } from "@/components/ScrollText";
import { TesterAlertsToggle } from "@/components/TesterAlertsToggle";
import { adminAway, requirePageUser } from "@/lib/server/page-auth";
import { sessionRefusal, writtenQuestions } from "@/lib/server/tests";
import { paidLines } from "@/lib/server/paid";
import { AutoRefresh } from "@/components/AutoRefresh";
import { testV } from "@/lib/server/pulseV";
import { LIST_PANEL, PAST_CALLS_SHOWN, PanelWhen, PayLinesBox } from "@/components/ScrollList";
import { Fold, ResizeBox } from "@/components/Panel";
import { DisputeForm, LeaveButton, WrittenAddForm, WrittenForm } from "./SessionActions";
import { SentWork } from "@/components/SentWork";
import { ANYTHING_ELSE_KEY, additionsOf, addsCounted, carriedAnswers, isPastQuestion, latestItems, noAnswerYet, pastThreads, questionKeys } from "@/lib/additions";
import { RecordingUpload } from "./RecordingUpload";
import { TesterCallPanel } from "./TesterCallPanel";
import { LivePanel } from "@/components/LivePanel";
import { ChoiceBox } from "./ChoiceBox";
import { TesterTop } from "./TesterTop";
import { CallRequests } from "@/components/CallRequests";
import { callEndProps, pageRows, rateLabel } from "@/lib/server/requests";
import { workEndOf } from "@/lib/server/workWindow";
import { unreadCount } from "@/lib/server/messages";
import { PersonHover } from "@/components/PersonHover";
import { ChatWithButton } from "@/components/ChatWithButton";
import { LiveTop } from "@/components/LiveTop";
import { qRequired, qText } from "@/lib/questions";
import { FieldLabel, FieldValue } from "@/components/FieldLines";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateWarning, ratingSummary, testerRateState } from "@/lib/server/ratings";
import { openOffer } from "@/lib/server/terms";
import { TEAM_CLOSED_NO_DISPUTE, pieceDay, canSendAgain, lateBeforeSendLine, lateSentLine, teamClosedLine, updateAboveSendLine, updateClosedZeroLine } from "@/lib/moneyLines";
import { keyOf } from "@/lib/server/accessKeys";
import { KeyBox } from "./KeyBox";
import { PageLoaded } from "@/components/PageLoaded";
import { NdaBox } from "@/components/NdaBox";
import { QuestionTexts, ValueText } from "@/components/QA";
/** (Owner, Nov 5, §231) The listing information lines whose value can be long: each in the shared box (the others are short lines). */
const LONG_INFO: string[] = ["title", "productName", "mature"];
import { PrevSetFolds } from "@/components/AnswerSets";
import { PastQuestions, pastCount } from "@/components/PastQuestions";
import { NameLine } from "@/components/WholeLine";
import { cutNamesIn } from "@/lib/cutNames";
import { carryOver, itemsFor, prevSetsOf, sameQuestions, versionsOf } from "@/lib/answerSets";
import { ExcerptPicker } from "@/components/Excerpts";
import { excerptChoices } from "@/lib/server/excerpts";
import { otherSideNotice } from "@/components/OtherSideNotice";

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
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
  const fmtTime = (d: Date | string) => fmtTimeIn(d, u.timeZone);
  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  adminAway(u, "/app/sessions"); // (batch 20 section 16) admin only
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  await (await import("@/lib/server/recovery")).checkStuck({ contractId: id }); // (batch 15 section 9) payments stuck "in progress"
  // (Batch 30 §8) The poll's fingerprint as of BEFORE the page reads what it shows: AutoRefresh starts from it, so a change right after this render is caught.
  const head = await db.contract.findUnique({ where: { id }, select: { testId: true, testerId: true } });
  if (head?.testerId === u.id) await (await import("@/lib/server/confirm")).expireActions(new Date(), { contractId: id });
  if (head?.testerId === u.id) await (await import("@/lib/server/workWindow")).finishWorkIfDue(head.testId);
  const pageV = head && head.testerId === u.id ? await testV(u.id, head.testId, id) : "";
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
  // (Batch 35 §137) The developer's name in a sentence links to their profile (cut, with its hover and tap pop-up); a deleted account stays plain.
  const devHref = devGone ? null : `/app/developers/${c.test.developerId}`;
  // (Batch 28 §3) A team Stop reads "This test was stopped at 3:10 PM." here too (the reader's saved zone).
  const refusal = sessionRefusal(c, c.test, dev, new Date(), u.timeZone);
  // (Owner, Oct 28, batch 16 section 24) The test stopped (the developer or the team), closed, or this tester's work was ended early: the work is over. What's gone
  // (the offer, Send, uploads, the call tools, the key box, Leave) is hidden; a press of it from an old page comes back here, at the top, named in the stopped line.
  const over = workOver(c);
  const failedAsked = (await searchParams)?.failed ?? "";
  const failedPress = over && (WORK_OVER_PRESSES as readonly string[]).includes(failedAsked) ? failedAsked : "";
  const written = c.submissions.find((s) => s.kind === "written");
  const recording = c.submissions.find((s) => s.kind === "recording");
  // (Owner, Oct 29, batch 13 section 8) The written part as SETS: what was last sent (under the questions it answered), the form's current questions with carried-over
  // answers, and the previous sets kept when the tester switched to changed questions.
  // (Batch 35 §136) The latest set sent (answers to changed questions are added under the first ones); the form after a switch carries its answers over.
  const sentItems = written ? latestItems(written, writtenQuestions(c)) : [];
  const newQuestions = !!written && (!!written.setUntil || !sameQuestions(sentItems, itemsFor(writtenQuestions(c))));
  // (§167) Adding, per question of the current set: its keys, and how many of the part's 10 additions were made.
  const currentKeys = questionKeys(sentItems);
  const prevSets = prevSetsOf(c.prevSets);
  // (Owner, Nov 5, §236) A Terms history line: its names (the developer's, yours, the test's titles, any long quoted name) cut at 20, each "…" opening its name in
  // place and the arrow the whole line (WholeLine, §220); the developer's whole name links to their profile.
  const histLine = (text: string) => {
    const x = cutNamesIn(text, [dev, displayName(u), c.title, c.test.title]);
    return <NameLine shown={x.shown} full={x.full} name={dev} href={devHref} />;
  };
  // (Owner, Nov 5, §234) Everything past in one box: the questions no longer in the contract (with what was sent and added to them) and the earlier sets' folds
  // (only their unsent drafts here: what was sent shows once, as a past question). N counts each past question once, by its words.
  const draftSets = prevSets.filter((s) => versionsOf(s, !!written).some((v) => v.kind === "draft"));
  const pastN = pastCount(written ? pastThreads(written.answers, writtenQuestions(c), written.additions).map((t) => t.question) : [], draftSets.flatMap((s) => s.items.map((x) => x.question)), (q) => isPastQuestion(q, writtenQuestions(c)), qText);
  const writtenUploads = c.recordings.filter((r) => r.part === "written" && r.uploadedAt).map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType }));
  // (Owner, Nov 5, §235) The current questions with no answer yet (none answered after the first send: all of them); the form below the answers holds only these.
  const openQs = written ? writtenQuestions(c).filter((_, i) => carriedAnswers(written, writtenQuestions(c))[i] == null) : writtenQuestions(c);
  // (§235; replaces §182's rows below the panel) "Add to this answer" sits in each answered question's fold, right under its answer and additions (and Anything
  // else's), with its own 5, "N of 5 additions left" and its full note. A question with no answer yet is answered in the form below instead.
  const addUnder = (key: string, question: string) => {
    if (!written || (key !== ANYTHING_ELSE_KEY && !currentKeys.includes(key))) return null;
    if (key !== ANYTHING_ELSE_KEY && noAnswerYet(sentItems, currentKeys, written.additions, key)) return <p className="note" data-answer-below="">Answer it in the form below.</p>;
    return <WrittenAddForm key={key} sessionId={c.id} seenAt={seenAt} canSend={!rulesPaused} lines={sendLines(written, c.writtenCents)} questionKey={key} question={question} made={addsCounted(written.additions, key)}
      known={c.recordings.filter((r) => r.part === "written" && r.uploadedAt && !r.submissionId).map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType }))} />;
  };
  const pastBox = (
    <PastQuestions id={`own-past-${c.id}`} count={pastN}>
      {written && <SentWork id={`own-past-${written.id}`} part="past" timeZone={u.timeZone} kind="written" answers={written.answers} questions={writtenQuestions(c)} notes={written.notes} additions={written.additions} files={c.recordings.filter((r) => r.part === "written" && r.submissionId === written.id)} />}
      <PrevSetFolds id={`own-prev-${c.id}`} draftsOnly timeZone={u.timeZone} sets={prevSets} sentPart={!!written} attachments={writtenUploads} />
    </PastQuestions>
  );
  // (Batch 13) "Show an excerpt on your profile": paid written answers, never while the test has an NDA, one pending request per part.
  const excerptPending = written ? (await db.excerpt.count({ where: { submissionId: written.id, status: "pending" } })) > 0 : false;
  const excerptPicks = written && !c.test.ndaText && !excerptPending && !u.testerSuspendedAt ? await excerptChoices(written) : [];
  const now = new Date();
  const seenAt = now.toISOString();
  const offer = await openOffer(c.id);
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
  // A Pay waiting for the bank is not paid yet: hide its reserved review; §97 shows Payment delayed.
  const confirming = new Set((await db.payment.findMany({ where: { contractId: c.id, status: "needs_action", kind: { in: ["review", "call"] } }, select: { submissionId: true, callId: true } })).map((p) => p.submissionId ?? p.callId ?? ""));
  for (const x of [...c.submissions, ...c.calls]) if (confirming.has(x.id)) (x as { review: unknown }).review = null;
  // (Owner, Oct 28 afternoon) A Charge pressed (or a dispute decided for them) while the developer was on a hold: added to what the developer owes, paid when they pay it.
  const owedRows = await db.payment.findMany({ where: { contractId: c.id, OR: [{ status: "owed" }, { status: "failed", settledAt: null, owedUntil: { not: null }, kind: "dispute" }, { status: "needs_confirmation", kind: "dispute" }] }, select: { submissionId: true, callId: true, kind: true, amountCents: true } });
  const chargedOwed = new Map(owedRows.filter((p) => p.kind === "review" && p.submissionId).map((p) => [p.submissionId!, p.amountCents]));
  // (Batch 9) Extra pays, with the developer's notes.
  const extraRows = await db.payment.findMany({ where: { contractId: c.id, kind: "extra", status: { in: ["charged", "not_set_up"] } }, select: { submissionId: true, callId: true, amountCents: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const disputeOwed = new Set(owedRows.filter((p) => p.kind === "dispute").map((p) => p.submissionId ?? p.callId ?? ""));
  // (Batch 29 §37) A listed call charged automatically during a hold ("owed") or a suspension ("deferred") isn't paid yet either: "may be delayed", never "paid".
  const owedCalls = new Set((await db.payment.findMany({ where: { contractId: c.id, callId: { not: null }, kind: { not: "dispute" }, OR: [{ status: "failed", settledAt: null, owedUntil: { not: null } }, { status: { in: ["needs_confirmation", "owed", "deferred"] } }] }, select: { callId: true } })).map((p) => p.callId!));
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
  // (§167) The tester can add under a question: sent, still open, the questions unchanged since.
  const canAdd = !!written && canSendAgain(written) && !refusal && !meOff && draftsShown && !newQuestions;
  const recAdds = recording ? additionsOf(recording.additions) : [];
  const addedGroup = (id: string) => { const i = recAdds.findIndex((a) => a.files.includes(id)); return { group: i + 1, ...(i >= 0 ? { addedOn: fmtStampIn(recAdds[i].at, u.timeZone) } : {}) }; };
  // What a suspended tester can still press in the limited view (section 28): Dispute, Charge, Let it go, Rate.
  const canAct = !meOff || limited;
  // (Batch 17 section 10) In the limited view Dispute is the only press: Charge and Let it go wait for the reinstatement (Rate is hidden too).
  const canChoose = !meOff;
  // (Owner, Oct 28 afternoon) Calls can be requested whether or not a live call is a listed part (one that isn't says so: its pay is up to the developer).
  const canRequestCall = !refusal && !blockedPair && !paused;
  const listedCall = callListed(c.test, c);
  const pendingReqs = await db.callRequest.findMany({ where: { contractId: c.id, status: "pending", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  // (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (the latest tester deadline, no earlier than Open until): no call time later. The request
  // form's time box stops there, its calls drop-down offers only what fits, and a waiting request's words say how many calls it covers.
  const callEnd = await workEndOf(db, c.testId);
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
  // (Owner, Nov 4, §179) "Live call: N done"'s calls, each with its payment box: the ones done and not yet paid, then the paid (reviewed) ones. More than 3 sit
  // in the draggable panel (`live-calls-<sessionId>`), like past calls.
  const unpaidLive = c.calls.filter((x) => !x.review && x.status === "booked" && callMinutesOf(x) != null);
  const paidLive = c.calls.filter((x) => x.review);
  const liveRowCount = unpaidLive.length + paidLive.length;
  // (Batch 15 section 42) Calls that are over (took place, cancelled, nobody joined, missed …) leave the calls ahead or in progress: (Owner, Nov 5, §209) to the
  // Live session's "Had (N)" / "Cancelled (N)" (no "Call history" card any more).
  const overCalls = c.calls.filter((x) => callIsOver(x) || blockedPair).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const callsWarning = callsLeftWarning(await callsLeftCents(c.id), listedCall ? c.liveRateCents : null, "tester", displayName(u));

  // (Batch 17 §19) Each unpaid piece's own closing date for the tester (the test's close-out, or 14 days after its Charge opened if later, plus the time their tester side
  // was suspended): Charge and Let it go end then and the piece reads "Not paid (closed on <date>)"; its Charge box says when in its last 7 days.
  const openKeys: { submissionId?: string; callId?: string }[] = [...c.submissions.filter((x) => !x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((x) => !x.review && x.status === "booked").map((x) => ({ callId: x.id }))];
  const chargeCloses = new Map(await Promise.all(openKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, "tester", now)] as const)));
  const chargeShut = (pieceId?: string) => !!pieceId && closedOut(chargeCloses.get(pieceId) ?? null, now);
  const shutOn = (pieceId: string) => fmtDate(chargeCloses.get(pieceId)!);
  const chargeSoon = (pieceId?: string) => (pieceId && closeOutSoon(chargeCloses.get(pieceId) ?? null, now) ? chargeClosesLine(fmtDate(chargeCloses.get(pieceId)!)) : "");
  // (Batch 30 §15) The listing information is always the CURRENT listing (title, product name, what to do, build link, devices, languages, categories, Mature), in
  // the header and in the contract box; each line changed since joining carries "Updated <time>" (before → now). The contract itself stays fixed until Switch.
  const infoChanges = (await db.testEvent.findMany({ where: { testId: c.testId, kind: LISTING_VALUES, createdAt: { gt: c.joinedAt } }, orderBy: { createdAt: "asc" } }))
    .flatMap((e) => { const x = parseValues(e); return x ? [{ ...x, id: e.id }] : []; });
  const infoFallbackAt = (await db.testEvent.findFirst({ where: { testId: c.testId, kind: { in: ["info", "renamed"] }, createdAt: { gt: c.joinedAt } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }))?.createdAt ?? null;
  const info = infoLines(c.test, infoChanges, { title: c.title, description: c.description, buildUrl: c.buildUrl }, infoFallbackAt);
  const title = c.test.title;
  // (NEXT-UI 7) The calls, and the booked daily / weekly sets as one line each ("Weekly · Mon 3:00 PM (3 left)").
  // (Batch 15 section 42) The Live session: only calls ahead and calls in progress ("Call in progress / measuring" once started).
  const mineCalls = c.calls.filter((x) => x.status === "booked" && !callIsOver(x) && !blockedPair).map((x) => ({ id: x.id, setId: x.setId, joinable: !paused && !refusal && callJoinable(x, now), when: x.startsAt.toISOString(), minutes: x.minutes, canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, ended: false, report: x.noShowBy ? { byMe: x.noShowBy === "tester", note: x.noShowNote } : null, lengthText: x.startsAt <= now ? (paused || refusal ? IN_PROGRESS_TESTER : MEASURING_LINE) : "", reported: !!x.noShowBy, cancelled: cancelledText(x), rate: rateLabel(x.rateCents, c.liveRateCents), late: isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(u), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined }));
  const callSets = await db.callSet.findMany({ where: { contractId: c.id } });
  const mineSets = [...new Set(c.calls.filter((x) => x.setId && x.status === "booked" && !x.review).map((x) => x.setId!))].flatMap((sid) => {
    const cs = c.calls.filter((x) => x.setId === sid && x.status === "booked" && !x.review).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const row = callSets.find((x) => x.id === sid);
    const daily = row ? row.repeat === "daily" : cs.length > 1 && cs[1].startsAt.getTime() - cs[0].startsAt.getTime() < 2 * 86_400_000;
    const left = cs.filter((x) => x.startsAt > now).length;
    if (!left) return [];
    const next = cs.find((x) => x.startsAt > now)!;
    return [{ id: sid, label: `${daily ? "Daily" : "Weekly"} · ${cs[0].startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: u.timeZone || "UTC" })}${row?.count === 0 ? " (until testers' work ends)" : ` (${left} left)`}`, minutes: cs[0].minutes, rate: rateLabel(cs[0].rateCents, c.liveRateCents), needsReason: cancelNeedsReason(next.startsAt, now), callIds: cs.map((x) => x.id) }];
  });
  // (Owner, Oct 29, batch 10) A paused test hides what doesn't work right now (Send, the call-request tools, Join call, chat's message box) and says at the top what still
  // works, built from what is actually on the page (the server refusals stay as a backstop).
  // (Batch 30 §3) Never for late work (also a piece that went late before this rule).
  const choiceOpen = (sub: typeof written) => !!(sub && !sub.review && !sub.late && sub.choiceOfferedAt && sub.choiceBy && canChoose && !chargeShut(sub.id) && chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0) > 0);
  // (Batch 20 section 15) What a team decision could still add to each reviewed piece without a dispute (the admin form's max): at 0, Dispute is disabled with its line.
  const room = await disputeRoom([...[written, recording].filter((x) => x?.review && !x.dispute).map((x) => ({ submissionId: x!.id })), ...c.calls.filter((x) => x.review && !x.dispute).map((x) => ({ callId: x.id }))]);
  // (Batch 28 §14) Each paid piece: what it was paid and what Pay more can still bring it to in all; and when Pay more closed (close-out).
  const caps = await paidAndCap([...[written, recording].filter((x) => x?.review && !x.review.rejected).map((x) => ({ submissionId: x!.id })), ...c.calls.filter((x) => x.review && !x.review.rejected).map((x) => ({ callId: x.id }))]);
  const payMoreAt = await payMoreClosesAt(c.testId, now);
  const payMoreShut = closedOut(payMoreAt, now) ? fmtDate(payMoreAt!) : null;
  // (Owner, Oct 31, batch 35 §88) "has paid" counts only money that went through: a payment waiting for the developer's bank, or owed during a hold, is left out
  // (the cap still counts it, so "up to … in all" doesn't move).
  const notYetPaid = new Map<string, number>();
  const pendingBase = new Set<string>();
  const confirmingBase = new Set<string>();
  for (const p of await db.payment.findMany({ where: { contractId: c.id, OR: [{ status: { in: ["needs_confirmation", "needs_action", "owed", "paying", "deferred"] } }, { status: "failed", settledAt: null, owedUntil: { not: null } }] }, select: { submissionId: true, callId: true, amountCents: true, kind: true, status: true } })) {
    const k = p.submissionId ?? p.callId ?? "";
    if (p.status === "needs_action" && (p.kind === "review" || p.kind === "call")) confirmingBase.add(k);
    notYetPaid.set(k, (notYetPaid.get(k) ?? 0) + p.amountCents);
    if (p.kind === "review" || p.kind === "call") pendingBase.add(k);
  }
  const paymentDelayed = (id: string) => (!confirmingBase.has(id) && notYetPaid.has(id)) || delayedSubs.has(id) || chargedOwed.has(id) || disputeOwed.has(id) || owedCalls.has(id);
  const moreOf = (id: string) => (caps.has(id) ? { ...caps.get(id)!, paidCents: Math.max(0, caps.get(id)!.paidCents - (notYetPaid.get(id) ?? 0)), closedOn: payMoreShut } : null);
  const disputable = (r: { amountCents: number; agreedCents: number | null; reason: string; teamClosedById?: string | null } | null | undefined, d: unknown, id = "") => !!r && !r.teamClosedById && canAct && canDispute(r.amountCents, r.agreedCents, !!d, byTesterChoice(r.reason), room.get(id) ?? null).ok;
  // (Batch 30 §2) A part can be sent again after it's paid (not an old rejection or the team's $0 closure).
  const unpaidPart = canSendAgain(written) || canSendAgain(recording);
  // (Batch 30 §2, §3) The grey line above a part's Send: a paid part's update (what it can still be paid), or the deadline passed (no Charge for late work).
  const sendLines = (sub: typeof written, cents: number | null) => {
    if (sub?.review) {
      const m = canSendAgain(sub) ? moreOf(sub.id) : null;
      return m ? [updateAboveSendLine(dev, m.paidCents, m.allCents, m.closedOn)] : [];
    }
    return cents != null && cents > 0 && now > c.dueAt ? [lateBeforeSendLine(fmtDate(c.dueAt), dev)] : [];
  };
  const pausedBanner = rulesPaused ? pausedForTesters({
    drafts: draftsShown && !refusal && !meOff && unpaidPart,
    charge: choiceOpen(written) || choiceOpen(recording),
    dispute: [written, recording].some((x) => x && !chargedOwed.has(x.id) && !delayedSubs.has(x.id) && disputable(x.review, x.dispute, x.id)) || c.calls.some((x) => !owedCalls.has(x.id) && disputable(x.review, x.dispute, x.id)),
    rate: rateBlock === "" && !meOff,
    leave: c.status === "working" && !meOff,
    cancelCalls: aheadCalls.length > 0 && !blockedPair && !meOff,
    send: !refusal && !meOff && unpaidPart,
    requestCalls: !refusal && !meOff && !blockedPair && c.test.status !== "stopped",

    deadline: c.status === "working", // (batch 11) a working tester's deadline moves with the pause
  }) : "";
  // (Batch 16 section 24) What still works once the work is over, built from what is actually on the page (as the paused banner does).
  const stillWorks = {
    charge: !meOff && !devGone && ([written, recording].some((x) => !!x && !x.review && !x.late && !chargeShut(x.id) && (x.agreedCents ?? 0) > 0 && chargeAmount(x.agreedCents, partPaid.get(x.id) ?? 0) > 0)),
    dispute: [written, recording].some((x) => x && !chargedOwed.has(x.id) && !delayedSubs.has(x.id) && disputable(x.review, x.dispute, x.id)) || c.calls.some((x) => !owedCalls.has(x.id) && disputable(x.review, x.dispute, x.id)),
    rate: rateBlock === "" && !meOff,
    excerpt: excerptPicks.length > 0,
    chat: !meOff && !blockedPair,
  };
  // The full app's session page: one centred column; the header card (title, by, badges, Chat, Open the product), then a
  // card per part.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh query={`session=${c.id}`} v={pageV} />
      {/* (Batch 16 section 38B) Call changes stop a press once even after a refresh showed them: counted from when the page first loaded here. */}
      <PageLoaded at={seenAt} />
      {/* (Design doc 8, owner Oct 26) The top, in this order: the test name, the access-key box, the live updates box (every change except the
          contract's), and right below it the Switch / Keep offer box. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {c.test.productName && <p className="kicker">{c.test.productName}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          {/* (Batch 34 §13) The test's own page (where a tester who left asks to rejoin). (Owner, Nov 5) Not while they're working on the test: they're in it. */}
          {c.status !== "working" && <a className="text-sm" href={`/app/find/${c.testId}`} data-test-page-link="">Open the test&apos;s page</a>}
        </div>
        {/* (Batch 15 section 26) The tester's one-press Alerts, at the top right. */}
        {/* (Batch 16 section 24) After the work is over, only while something left on the page can still stop (Charge / Let it go, Dispute, Rate). */}
        {!meOff && (!over || stillWorks.charge || stillWorks.dispute || stillWorks.rate) && <TesterAlertsToggle off={u.testerAlertsOff} />}
      </div>
      {pausedBanner && <p className="info" data-paused="">{pausedBanner}</p>}
      {key && <KeyBox canReport={!meOff} sessionId={c.id} seenAt={seenAt} value={key.value} broken={key.status === "broken"} fresh={!!freshKey} fixed={!!key.fixedAt} devPronoun={c.test.developer.pronoun} />}
      <LiveTop scope={`session:${c.id}`} seenAt={seenAt} seeIt="#scope" />
      <ListingSeeIt box="scope" />
      <TesterTop sessionId={c.id} seenAt={seenAt} devName={dev} offer={offer && !refusal ? {
        id: offer.id, diff: offer.diff, ndaText: offer.ndaText, fromNdaText: c.ndaText, questions: ((offer.questions as string[]) ?? []).map((q) => ({ text: qText(q), required: qRequired(q) })), fromQuestions: ((c.questions as string[]) ?? []).map((q) => ({ text: qText(q), required: qRequired(q) })),
        answers: sentItems.map((x) => x.answer),
        // (Batch 18 section 8) Switching means answering the new questions; answers already sent stay payable at their price.
        switchNote: switchQuestionsLine(written),
      } : null} />
      {limited && <p className="info" data-limited-view="">{LIMITED_VIEW_LINE}</p>}
      {refusal && !limited && <div className="info space-y-1" id="stopped-line" data-stopped-line="" {...(failedPress ? { "data-work-over-failed": failedPress } : {})}><p>{over ? stillWorksLine({ ...c, teamTime: c.endedAt ? stopTimeIn(c.endedAt, u.timeZone, now) : undefined }, dev, fmtDate, stillWorks, failedPress) : refusal}</p>{c.status === "left" && c.endKind !== "rated" && <p data-rejoin-link="">{/* (Owner, Oct 30) The way back after leaving: the test's page asks the developer. */}<a href={`/app/find/${c.testId}`}>Ask to rejoin on the test&apos;s page →</a></p>}
        {/* (Batch 15 sections 20 and 22) The developer's End early reason, in italics, scrolling when long (never in the bell line). */}
        {c.status === "ended" && c.endKind === "early" && c.endReason && <ReasonQuote text={c.endReason} />}
        {/* (Batch 17 §15) The developer's Stop reason, the same way (only the developer's own Stop writes the note; the team's Stop reason is never shown here). */}
        {c.status === "ended" && c.endKind === "stopped" && c.endReason && contractNotes.some((n) => n.kind === STOP_NOTE_KIND) && <ReasonQuote text={c.endReason} />}
      </div>}
      {/* (Batch 15 section 18) The tester's OWN deadline, not the test's Open until (the last day to join). */}
      {!refusal && c.status === "working" && c.dueAt > now && c.dueAt.getTime() - now.getTime() < 3 * 86_400_000 && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(title, c.dueAt, now)}</p>
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
              {/* (Batch 30 §15) The current listing, live: its categories (with their icons), parts, devices and languages, as on the join page and Find cards. */}
              <CategoryBadges categories={c.test.categories} />
              <PartBadges written={c.test.writtenCents != null} recording={c.test.recordingCents != null} live={c.test.liveRateCents != null} />
              {c.test.devices.length > 0 && <span className="badge" data-badge="devices"><Monitor className="h-3.5 w-3.5" /> {c.test.devices.join(" · ")}</span>}
              {c.test.languages.length > 0 && <span className="badge" data-badge="languages"><Languages className="h-3.5 w-3.5" /> {c.test.languages.join(", ")}</span>}
              {/* (Batch 30 §20) No "0 testers on this test" (a stopped or emptied test). */}
              {testersIn > 0 && <span className="badge"><Users className="h-3.5 w-3.5" /> {testersIn} tester{testersIn === 1 ? "" : "s"} on this test</span>}
              {c.test.mature && <span className="badge border-rose-300/40 text-rose-200" title={c.test.matureWhy}>Mature (18+)</span>}
            </div>
          </div>
          {!meOff && <a href={`/app/chat/${c.id}`} className="btn-secondary relative min-w-0 max-w-full no-underline hover:no-underline"><MessagesSquare className="h-4 w-4 shrink-0" /> <span className="min-w-0 [overflow-wrap:anywhere]">Chat with {dev}</span>
            {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unread} unread`}>{unread}</span>}
          </a>}
        </div>
        {/* (Batch 15 section 17) The steps in a scroll box about 6 lines tall. */}
        {/* (Batch 30 §15) The current steps and build link. */}
        {/* (Owner, Nov 5, §231) In the shared box for listing texts (drags taller). */}
        {c.test.description && <ValueText id={`head-what-${c.id}`} label="What to do">{c.test.description}</ValueText>}
        <p className="text-sm text-slate-400">Due {fmtDate(c.dueAt)}{c.status === "working" && c.dueAt > now && c.dueAt.getTime() - now.getTime() < 24 * 3_600_000 ? ` · ${leftText(c.dueAt.getTime() - now.getTime())} left` : ""}{isLate(c.dueAt, now) && !refusal ? ": your deadline has passed. You can still send work; the developer decides what to pay." : ""}</p>
        {c.test.buildUrl && (
          <a href={c.test.buildUrl} target="_blank" rel="noreferrer" className="btn w-fit no-underline hover:no-underline">
            Open the product <ExternalLink className="h-4 w-4" />
          </a>
        )}

      </section>

      {myRating && !rated.testerRevealed && <p className="note">You rated <NameLink text={dev} href={devHref} />.</p>}
      {myRating && rated.testerRevealed && <p className="note">You rated <NameLink text={dev} href={devHref} />: {myRating.stars} ★{myRating.comment ? ` · “${myRating.comment}”` : ""}</p>}
      {rated.developer && <p className="note"><NameLink text={dev} href={devHref} /> rated you: {rated.developer.stars} ★{rated.developer.comment ? ` · “${rated.developer.comment}”` : ""}</p>}
      {rateState.kind === "closed" && !meOff && <p className="note" data-rating-closed="">{rateState.line}</p>}
      {(rateState.kind === "open" || rateState.kind === "disabled") && !meOff && (
        <RateBox
          disabledLine={rateState.kind === "disabled" ? rateState.line : ""}
          path={`/api/sessions/${c.id}/rate`}
          seenAt={seenAt}
          name={dev}
          working={rateWarn.working}
          headline={rateWarn.working ? `Rating ends your part in ${title}. You won't be able to send more work, book calls or join this test again.` : `Once you rate, you won't be able to join ${title} again.`}
          lines={rateWarn.lines}
        />
      )}
      {/* (Batch 34 §13, owner) No "Ask to rejoin" / "invited you back" card here: the tester asks to rejoin (or joins on an invite back) from the test's own page,
          linked under the title, whose join box reads "Ask to rejoin" (or "Join"). */}

      {/* (Owner, Oct 29, batch 32 §1) Payout setup not done: payments wait for it. */}
      {!(u.stripeAccountId && u.payoutsReady) && <p className="text-sm text-slate-400" data-payout-hint="">{PAYOUT_SETUP_HINT} <a href="/app/payments#payout" className="underline">Finish setup</a></p>}

      {/* The full app's "Your agreed scope" fold. (Batch 30 §15) Two parts: the contract (fixed at joining, changed only through Switch / Keep) and the listing
          information (always the current listing, live; a line changed since joining carries "Updated <time>": before → now). The top box's See it opens it. */}
      <details className="card scroll-mt-24" id="scope" data-scope="">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your agreed scope</summary>
        {/* (Owner, Oct 31, batch 35 §91) The whole scope in one scroll box (about 32rem tall), so the page below stays close. */}
        <div className="mt-1 max-h-[32rem] overflow-y-auto pr-1" data-scope-scroll="">
        {/* (Owner, Oct 31, batch 35 §29) Both parts list their fields as the Listing panel does (§15): the label small, muted and uppercase on its own line (with its
            "Updated" tag), the value bright below it; the questions numbered with "Required" as a small tag; long texts in their scroll boxes. */}
        <p className="mt-3 text-sm font-medium text-white">Your contract</p>
        <ul className="mt-1 space-y-2.5 text-sm" data-scope-contract="">
          {([
            { name: "Written answers", cents: c.writtenCents, required: c.writtenRequired, perHour: false },
            { name: "Screen recording", cents: c.recordingCents, required: c.recordingRequired, perHour: false },
            { name: "Live call", cents: c.liveRateCents, required: c.liveRequired, perHour: true },
          ] as const).map((x) => (
            <li key={x.name} data-scope-part={x.name}>
              <FieldLabel>{x.name}</FieldLabel>
              <FieldValue>
                {x.cents == null ? NOT_LISTED : `${x.cents === 0 ? "Free" : `${money(testerShare(x.cents))}${x.perHour ? "/h" : ""} for you`} · ${x.required ? "Required" : "Not required"}`}
                {x.perHour && x.cents != null && c.liveMinutes != null && ` · ${c.liveMinutes}-minute calls`}
              </FieldValue>
            </li>
          ))}
          {/* (Owner, Nov 5, §231; was batch 20's one scroll box for all the questions) The contract's questions, each in its own question box ("Question N",
              "Required" a tag), the same look as the answers' (components/QA.tsx). */}
          {writtenQuestions(c).length > 0 && <li data-scope-questions=""><FieldLabel>Questions</FieldLabel><FieldValue><QuestionTexts id={`scope-q-${c.id}`} items={writtenQuestions(c).map((q) => ({ text: qText(q), required: qRequired(q) }))} /></FieldValue></li>}
          {c.ndaText && c.ndaAcceptedAt ? (
            <li data-nda="">
              <FieldLabel>NDA</FieldLabel>
              <FieldValue><details><summary className="cursor-pointer">Accepted {fmtDate(c.ndaAcceptedAt)}</summary><div className="mt-1"><NdaBox id={`scope-nda-${c.id}`} text={c.ndaText} /></div></details></FieldValue>
            </li>
          ) : <li><FieldLabel>NDA</FieldLabel><FieldValue>None</FieldValue></li>}
          <li data-scope-due=""><FieldLabel>Due</FieldLabel><FieldValue>{fmtDate(c.dueAt)}</FieldValue></li>
          <li className="text-slate-400">Agreed {fmtDate(c.joinedAt)}. Your contract stays as it is: if <NameLink text={dev} href={devHref} /> changes these terms later, you choose Switch or Keep.</li>
        </ul>
        <p className="mt-3 text-sm font-medium text-white">The listing information</p>
        <p className="text-xs text-slate-400">Always the current listing: it follows <NameLink text={dev} href={devHref} />&apos;s changes as they&apos;re made.</p>
        <ul className="mt-1 space-y-2.5 text-sm" data-scope-info="">
          {info.filter((l) => l.key !== "productName" || l.now !== "(none)" || l.before != null).filter((l) => l.key !== "mature" || c.test.mature || l.before != null).map((l) => (
            <li key={l.key} className="scroll-mt-24 rounded-lg px-1 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-info-line={l.key} {...(l.before != null ? { "data-updated-at": l.updatedAt?.toISOString() ?? "" } : {})}>
              <FieldLabel tag={l.before != null ? <UpdatedTag id={`scope-info-${c.id}-${l.key}`} when={l.updatedAt ? fmtDateTimeIn(l.updatedAt, u.timeZone) : ""} before={l.before} now={l.now} /> : null}>{l.label}</FieldLabel>
              <FieldValue>
                {/* (Owner, Nov 5, §231) A text that can be long (the title, the product name, what to do, the build link, the Mature reason) in the shared box
                    (ValueText: drags taller, its own scroll inside this fold's scroll); the link stays a link. Short lists (devices, languages) stay plain. */}
                {l.key === "description" && l.now !== "(none)" ? (
                  <ValueText id={`scope-info-${c.id}-description`} label="What to do">{c.test.description}</ValueText>
                ) : l.key === "buildUrl" && c.test.buildUrl ? (
                  <ValueText id={`scope-info-${c.id}-buildUrl`} label="Build link"><a href={c.test.buildUrl} target="_blank" rel="noreferrer" className="break-all">{c.test.buildUrl}</a></ValueText>
                ) : LONG_INFO.includes(l.key) && l.now !== "(none)" && l.now !== "No" ? (
                  <ValueText id={`scope-info-${c.id}-${l.key}`} label={l.label}>{l.now}</ValueText>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{l.now}</span>
                )}
              </FieldValue>
            </li>
          ))}
        </ul>
        {/* (Design doc 9) The terms history: every offer and what you chose, with the questions and NDA you were on. */}
        {/* (Batch 35 §91) Folded shut by default: the Updated tags above already show what changed; this keeps the full record. */}
        <details className="mt-3 space-y-2 text-sm" data-terms-history="">
          <summary className="fold-chevron cursor-pointer font-medium text-white">Terms history</summary>
          {/* (Owner, Nov 5, §236) The whole history in its own draggable scroll panel; the boxes inside (questions, NDA, before / after, an opened line) keep their
              own scroll (OwnPanel). Every name in a line is cut at 20 (NAME_CUT): each "…" opens that name in place, the arrow the whole line (WholeLine, §220). */}
          <ResizeBox id={`terms-history-${c.id}`} label="Terms history">
          <ul className="space-y-1.5 text-slate-300" data-terms-history-list="">
            <li>{fmtDate(c.joinedAt)}: you joined on {termsLine(c, true)}{c.ndaAcceptedAt ? ` and accepted the NDA` : ""}.</li>
            {[
              ...offers.map((o) => ({ at: o.createdAt, key: o.id, node: (<li key={o.id}>
                {histLine(`${fmtDate(o.createdAt)}: ${dev} offered new terms (${o.diff}) · ${o.status === "switched" ? `you switched${o.decidedAt ? ` on ${fmtDate(o.decidedAt)}` : ""}` : o.status === "kept" ? `you kept your terms${o.decidedAt ? ` on ${fmtDate(o.decidedAt)}` : ""}` : o.status === "closed" || (o.status === "open" && c.status !== "working") ? "closed when your part ended" : o.status === "open" ? "waiting for your answer" : "replaced by a newer offer"}`)}
                {Array.isArray(o.fromQuestions) && JSON.stringify(o.fromQuestions) !== JSON.stringify(o.questions) && (
                  <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">Questions then and now</summary>
                    {/* (Batch 15 section 3) Each question cut to 3 lines with Show more. (Batch 20 section 1) More than 3: a scroll box about 3 questions tall. */}
                    {/* (Batch 35 §29) Labels apart from the questions, numbered with their Required tags. */}
                    {/* (Owner, Nov 5, §231) Each question in its own question box (components/QA.tsx). */}
                    <div className="mt-1"><FieldLabel>Then</FieldLabel><FieldValue><QuestionTexts id={`history-${o.id}-then`} items={(o.fromQuestions as string[]).map((q) => ({ text: qText(q), required: qRequired(q) }))} /></FieldValue></div>
                    <div className="mt-1"><FieldLabel>Offered</FieldLabel><FieldValue><QuestionTexts id={`history-${o.id}-offered`} items={((o.questions as string[]) ?? []).map((q) => ({ text: qText(q), required: qRequired(q) }))} /></FieldValue></div></details>
                )}
                {o.fromNdaText !== o.ndaText && (
                  <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">NDA then and now</summary>
                    <div className="mt-1 space-y-2"><NdaBox id={`history-${o.id}-nda-before`} label="Before" text={o.fromNdaText} /><NdaBox id={`history-${o.id}-nda-offered`} label="Offered" text={o.ndaText} /></div></details>
                )}
              </li>) })),
              ...contractNotes.map((n) => ({ at: n.createdAt, key: n.id, node: n.kind === STOP_NOTE_KIND
                ? <li key={n.id} data-history-line="">{`${fmtDateTime(n.createdAt)}: Test stopped`}<ReasonQuote text={stopReasonOf(n.text)} /></li> // (Batch 17 §15) the reason in its scroll box
                : <li key={n.id} data-history-line="">{histLine(`${fmtDateTime(n.createdAt)}: ${renderTimes(n.text, u.timeZone)}`)}</li> })),
              // (Batch 30 §15) Older versions of the listing information: each save's changes, before → after (renames have their own "Renamed" line).
              ...infoChanges.flatMap((ch) => {
                const rows = historyRows(ch);
                return rows ? [{ at: ch.createdAt, key: ch.id, node: (<li key={ch.id} data-history-line="" data-history-info="">
                  {histLine(`${fmtDateTimeIn(ch.createdAt, u.timeZone)}: ${dev} updated the listing information (${rows.map((r) => r.name).join(", ")})`)}
                  <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">Before and after</summary>
                    {/* (Batch 32 §14) each side in its own scroll box; (Owner, Nov 5, §231) the shared box for listing texts (ValueText). */}
                    <ul className="mt-1 space-y-1.5">{rows.map((r) => <li key={r.name} className="space-y-0.5"><b>{r.name}:</b><div data-diff-scroll=""><ValueText id={`history-${ch.id}-${r.name}-before`} label={`${r.name}: before`}>{r.before}</ValueText></div><span aria-hidden="true">↓</span><div data-diff-scroll=""><ValueText id={`history-${ch.id}-${r.name}-after`} label={`${r.name}: after`}>{r.after}</ValueText></div></li>)}</ul>
                  </details>
                </li>) }] : [];
              }),
              ...prevSetsOf(c.prevSets).map((p) => ({ at: new Date(p.until), key: `set-${p.until}`, node: <li key={`set-${p.until}`} data-history-line="">{`${fmtDate(new Date(p.until))}: your questions changed; your earlier answers are kept under “Past questions”`}</li> })),
              ...historyPays.map((p) => ({ at: p.createdAt, key: p.id, node: <li key={p.id} data-history-line="">{`${fmtDate(p.createdAt)}: ${p.kind === "extra" ? "paid more" : p.kind === "dispute" ? "the team raised the pay by" : "paid"} ${money(p.amountCents)} for your ${p.callId ? "live call" : subKinds.get(p.submissionId ?? "") ?? "work"} (you get ${money(testerShare(p.amountCents))})`}</li> })),
            ].sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => x.node)}
          </ul>
          </ResizeBox>
        </details>
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
                {sub && <TesterPaymentTag review={sub.review} confirming={confirmingBase.has(sub.id)} delayed={paymentDelayed(sub.id)} paidCents={partPaid.get(sub.id) ?? 0}
                  developerDeleted={devGone && !sub.choiceOfferedAt ? devRealName : null} developerPronoun={c.test.developer.pronoun} closedOn={chargeShut(sub.id) ? shutOn(sub.id) : null} />}
                <span className="text-slate-200">{sub ? <>{additionsOf(sub.additions).length ? "Updated" : "Sent"} {fmtDateTime(sub.updatedAt)}</> : "Not sent yet"}</span>
                {cents != null && <span className={`badge ${required ? "border-amber-300/40 text-amber-200" : ""}`}>{required ? "Required" : "Not required"}</span>}
              </p>
              <p className="text-slate-400">{cents == null ? NOT_LISTED : `In your contract · ${cents === 0 ? "free" : `${money(testerShare(cents))} for you`}`}{` · Paid so far ${money(sub ? partPaid.get(sub.id) ?? 0 : 0)}`}</p>
              {/* (Batch 28 §5) A sent, listed part waiting for the developer: when Charge opens (like the dashboard rows and listed call rows). */}
              {/* (Batch 30 §3) Sent after the deadline: no Charge; the developer decides what to pay. */}
              {sub && !sub.review && sub.late && sub.agreedCents != null && sub.agreedCents > 0 && !devGone && !chargeShut(sub.id) && <p className="text-xs text-slate-400" data-sent-late="">{lateSentLine(fmtDate(c.dueAt), dev)}</p>}
              {sub && !sub.review && !sub.late && sub.agreedCents != null && sub.agreedCents > 0 && !devGone && !chargeShut(sub.id) && !sub.choiceOfferedAt && (() => {
                const opens = chargeOpensAt(sub, c.test, c, now);
                return opens && opens > now ? <p className="text-xs text-slate-400" data-charge-opens="">{chargeOpensNote(dev, pieceDay(opens, u.timeZone))}</p> : null;
              })()}
              {sub && <p className="text-xs text-slate-500">{partLine(sub.agreedCents, partPaid.get(sub.id) ?? 0)}</p>}
              {sub && !sub.review && !sub.late && sub.choiceOfferedAt && sub.choiceBy && canChoose && !chargeShut(sub.id) && chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0) > 0 && (
                <ChoiceBox paused={rulesPaused} seenAt={seenAt} sessionId={c.id} submissionId={sub.id} devName={dev} cents={chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0)} line={choiceLine(dev, key, chargeAmount(sub.agreedCents, partPaid.get(sub.id) ?? 0), (() => { const o = chargeOpensAt(sub, c.test, c, now); return o ? fmtDate(o) : undefined; })())} />
              )}
              {/* (Batch 17 §19) Its last 7 days before close-out. */}
              {chargeSoon(sub?.id) && choiceOpen(sub) && <p className="note" data-charge-closes="">{chargeSoon(sub?.id)}</p>}
              {sub?.review && !chargedOwed.has(sub.id) && !delayedSubs.has(sub.id) && !pendingBase.has(sub.id) && <TesterReview timeZone={u.timeZone} update={sub.paidUpdateZeroAt ? { at: sub.paidUpdateZeroAt, note: sub.paidUpdateNote } : null} dev={dev} extras={extraRows.filter((p) => p.submissionId === sub.id)} off={meOff && !limited} sessionId={c.id} kind="submission" id={sub.id} review={sub.review} dispute={sub.dispute} room={room.get(sub.id) ?? null} more={moreOf(sub.id)} />}

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
            {/* (Owner, Nov 4, §186; replaces §179's list here) Each call with its payments is listed once; this part keeps its count, rate and "Paid so far".
                (Owner, Nov 5, §209) The list is the Live session's "Had (N)" (no Call history any more): the link opens it. */}
            {liveRowCount > 0 && <a href={`#calls-had-${c.id}`} className="block text-xs" data-live-calls-below={liveRowCount}>Each call and what it was paid: Live session, Had ↓</a>}
          </li>
        </ul>
      </section>

      {/* The full app's ONE Live session panel: the rate, Booked, the calls that are over and Requests (calls are always requests).
          (Owner, Nov 5, §209; replaces §186's "Call history" card) The calls ahead (or running) are back here in "Booked" with Join call and Cancel, and under
          them "Had (N)" and "Cancelled (N)": the calls that are over. Shown whenever there is one, even when nothing else here works (a closed tester side:
          only those two). */}
      {((!limited && (c.calls.length > 0 || canRequestCall || pendingReqs.length > 0)) || overCalls.length > 0) && (
        <LivePanel minutes={c.calls.filter((x) => x.status === "booked" && x.startsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]?.minutes ?? null}>
          {!limited && <>
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
          </>}
          {/* (Owner, Nov 5, §209; replaces §186's Call history "Booked (N)" / "Cancelled (N)") Under the calls ahead, two drop-downs, both closed at first.
              "Had (N)": the calls that took place (in any form that can be paid or disputed: a no-show report's 0-minute call too), newest first, each with its
              length and its payments (what was paid, the payment lines, Dispute the pay, as §179's "Live call" list had them). "Cancelled (N)": the calls
              actually cancelled (by either of you, or by the app: nobody joined, couldn't connect, missed …), newest first, with the length they were booked for
              and who cancelled and why; requests never show here. A blocked pair's calls read "Cancelled: not available", except one that took place: it stays in
              Had with its payments. Past 3 rows each list is the draggable panel (§187: the only panel that scrolls; the payment lines' panels inside are flat). */}
          {(() => {
            const had = overCalls.filter((x) => x.status !== "cancelled" && !(blockedPair && callMinutesOf(x) == null));
            const cancelled = overCalls.filter((x) => !had.includes(x));
            if (!had.length && !cancelled.length) return null;
            const pastRow = (x: (typeof overCalls)[number]) => {
              const m = callMinutesOf(x);
              const badge = callOverBadge(x, { developer: dev, tester: displayName(u) }, "tester", fmtTime, partPaid.get(x.id) ?? 0, m);
              const reviewShown = !!x.review && !owedCalls.has(x.id) && !pendingBase.has(x.id);
              return (
                <li key={x.id} id={`call-${x.id}`} data-over-call={x.id} className="scroll-mt-24 space-y-1 rounded-lg border border-white/5 p-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
                  <div className="flex flex-wrap items-center gap-2" data-call-row="" data-call-length="">
                    <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                    {/* The payment is said once: by its tag (and the paid line below), not again in the badge. */}
                    <span className={`badge ${TONE[badge.tone]}`} data-call-badge="">{`Took place${m != null ? ` · ${m} min` : ""}`}</span>
                    {x.review ? <TesterPaymentTag review={x.review} confirming={confirmingBase.has(x.id)} delayed={paymentDelayed(x.id)} paidCents={partPaid.get(x.id) ?? 0} />
                      : <TesterPaymentTag review={x.review} confirming={confirmingBase.has(x.id)} delayed={paymentDelayed(x.id) || failedCalls.has(x.id)} paidCents={partPaid.get(x.id) ?? 0}
                          developerDeleted={devGone && !(x.rateCents != null && c.test.developer.stripePaymentMethodId) ? devRealName : null} developerPronoun={c.test.developer.pronoun} closedOn={chargeShut(x.id) ? shutOn(x.id) : null} />}
                  </div>
                  <p className="text-xs text-slate-400" data-call-length-line="">{callLengthLine(x, fmtTime)}</p>
                  {/* A listed call is charged automatically after its review date; no Charge or Let it go. */}
                  {!x.review && <>{x.rateCents != null && x.payBy && x.payBy > now && (!devGone || !!c.test.developer.stripePaymentMethodId) && <p className="text-xs text-slate-400" data-auto-charge="">{testerAutoChargeLine(dev, pieceDay(x.payBy, u.timeZone))}</p>}</>}
                  {badge.reason && !reviewShown && <ReasonQuote text={badge.reason} />}
                  {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                  {reviewShown && <TesterReview timeZone={u.timeZone} dev={dev} extras={extraRows.filter((p) => p.callId === x.id)} off={meOff && !limited} sessionId={c.id} kind="call" id={x.id} review={x.review!} dispute={x.dispute} room={room.get(x.id) ?? null} more={moreOf(x.id)} />}
                </li>
              );
            };
            const cancelledRow = (x: (typeof overCalls)[number]) => {
              const shown = x.status !== "cancelled" ? { ...x, status: "cancelled", cancelledBy: "system", cancelNote: "not available" } : x;
              const badge = callOverBadge(shown, { developer: dev, tester: displayName(u) }, "tester", fmtTime, partPaid.get(x.id) ?? 0, callMinutesOf(x));
              return (
                <li key={x.id} id={`call-${x.id}`} data-over-call={x.id} className="scroll-mt-24 space-y-1 rounded-lg border border-white/5 p-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                    <span className="text-slate-400" data-call-booked-length="">· {x.minutes} min</span>
                    <span className={`badge ${TONE[badge.tone]}`} data-call-badge="">{badge.label}</span>
                  </div>
                  {badge.reason && <ReasonQuote text={badge.reason} />}
                </li>
              );
            };
            return (
              <div className="space-y-2 text-sm" data-calls-fold={c.id}>
                <details id={`calls-had-${c.id}`} className="scroll-mt-24 rounded-lg border border-white/10 p-2" data-calls-had={had.length}>
                  <summary className="fold-chevron cursor-pointer font-medium text-white">Had ({had.length})</summary>
                  <div className="mt-2">
                  {!had.length && <p className="note">No calls took place yet.</p>}
                  <PanelWhen on={had.length > PAST_CALLS_SHOWN} id={`had-calls-${c.id}`} label="Calls you had and their payments" defaultMax={LIST_PANEL.liveTester}>
                  <ul className="space-y-2" data-calls-history="" data-live-calls={had.length} data-calls-scroll={had.length > PAST_CALLS_SHOWN ? had.length : undefined}>{had.map(pastRow)}</ul>
                  </PanelWhen>
                  </div>
                </details>
                <details id={`calls-cancelled-${c.id}`} className="scroll-mt-24 rounded-lg border border-white/10 p-2" data-calls-cancelled={cancelled.length}>
                  <summary className="fold-chevron cursor-pointer font-medium text-white">Cancelled ({cancelled.length})</summary>
                  <div className="mt-2">
                  {!cancelled.length && <p className="note">No cancelled calls.</p>}
                  <PanelWhen on={cancelled.length > PAST_CALLS_SHOWN} id={`cancelled-calls-${c.id}`} label="Cancelled calls" defaultMax={LIST_PANEL.pastTester}>
                  <ul className="space-y-2" data-calls-history="" data-calls-scroll={cancelled.length > PAST_CALLS_SHOWN ? cancelled.length : undefined}>{cancelled.map(cancelledRow)}</ul>
                  </PanelWhen>
                  </div>
                </details>
              </div>
            );
          })()}
          {!limited && <>
          {(canRequestCall || (pendingReqs.length > 0 && !paused && !refusal)) && (
            <section className="space-y-1.5" aria-label="Call requests" data-live-section="Requests">
              <h3 className="text-sm font-semibold text-white">Requests</h3>
              <CallRequests
                leadMinutes={CALL_MIN_AHEAD_MINUTES}
                end={callEndProps(callEnd)}
                side="tester"
                path={`/api/sessions/${c.id}`}
                seenAt={seenAt}
                canRequest={canRequestCall}
                targets={[{ contractId: c.id, name: dev, rate: "" }]}
                requests={pendingReqs.map((r) => ({ id: r.id, minutes: r.minutes, rows: pageRows(r, callEnd), mine: r.fromSide === "tester", who: dev, contractId: c.id, rate: rateLabel(listedCall ? c.liveRateCents : null, c.liveRateCents) }))}
                // (Batch 16 section 33) The clash checks while the form is filled: the calls between you, your other calls, and the limits.
                clash={{
                  calls: liveCalls.filter((x) => x.startsAt > new Date(now.getTime() - 6 * 3_600_000)).map((x) => ({ id: x.id, start: x.startsAt.toISOString(), minutes: x.minutes })),
                  elsewhere: (await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, contract: { testerId: u.id, id: { not: c.id } } }, include: { contract: { include: { test: { include: { developer: true } } } } } }))
                    .map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes, name: displayName(x.contract.test.developer) })),
                  pending: pendingReqs.length,
                  // (Owner, Nov 4, §185) As the server counts it: a running Forever set is one booked time even with none of its calls ahead.
                  booked: new Set([...liveCalls.filter((x) => x.startsAt > now).map((x) => x.setId ?? x.id), ...callSets.filter((s) => s.status === "active" && s.count === 0).map((s) => s.id)]).size,
                  leftCents: await callsLeftCents(c.id),
                  rateCents: listedCall ? c.liveRateCents : null,
                }}
              />
            </section>
          )}
          </>}
        </LivePanel>
      )}
      {/* The full app's "Your recordings" card, then "The written part" (a card of its own). */}
      <section className="card space-y-3" id="recording">
        <h2 className="flex flex-wrap items-center gap-2 font-semibold text-white"><Clapperboard className="h-5 w-5 text-fuchsia-300" /> Your recordings
          {c.recordingCents != null && <span className="text-sm font-normal text-slate-400">(the recorded session part)</span>}</h2>
        {termLine("Recording", c.recordingCents, c.recordingRequired, false, recording ? partPaid.get(recording.id) ?? 0 : 0)}
        <RecordingUpload
          seenAt={seenAt}
          sessionId={c.id}
          canSend={!refusal && canSendAgain(recording) && !meOff && draftsShown}
          lines={sendLines(recording, c.recordingCents)}
          sendable={!rulesPaused}
          sentBefore={!!recording}
          // (Batch 35 §136) Each sent recording's group: 0 = sent first, n = the nth addition ("Added").
          // (§167) With the addition's date: "Added · Nov 3, 2026, 11:29 PM".
          recordings={c.recordings.filter((r) => r.part === "recording").map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, uploaded: !!r.uploadedAt, sent: !!r.submissionId, ...addedGroup(r.id) }))}
        />
      </section>

      <section className="card space-y-3" id="written">
        <h2 className="font-semibold text-white">The written part</h2>
        {termLine("Written answers", c.writtenCents, c.writtenRequired, false, written ? partPaid.get(written.id) ?? 0 : 0)}
        {/* (Owner, Nov 3, batch 35 §136) What was sent is locked, never edited. (§167) Shown as the developer reads it, a fold per question with its answer and
            what was added to it (dated); while adding is open, each current question's fold ends with the place its "Add to this answer" box opens.
            (Owner, Nov 4, §182) In "Your written answers", a fold: every question in ONE panel (scrolls inside, the grip drags it); the Add to this answer
            buttons sit below the panel, and a pressed one opens its box in the panel, directly under that question's latest part. (Owner, Nov 5, §223) Inside
            it, each question's text, its answer and each addition sit in their own small box that scrolls and drags taller (SentWork). */}
        {written && (
          <div className="space-y-2" data-sent-answers="">
            {written.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(written.setUntil)}</p>}
            <Fold id={`own-answers-${written.id}`} summary={<span className="font-medium text-white" data-own-answers-title="">Your written answers</span>}>
              <div className="space-y-2">
                <ResizeBox id={`own-answers-list-${written.id}`} label="Your written answers" defaultMax={LIST_PANEL.ownAnswers}>
                  {/* (§234) Only the contract's current questions and Anything else: the past ones are in the Past questions box below. */}
                  <SentWork id={`own-${written.id}`} part="current" timeZone={u.timeZone} kind="written" answers={written.answers} questions={writtenQuestions(c)} notes={written.notes} additions={written.additions} files={c.recordings.filter((r) => r.part === "written" && r.submissionId === written.id)}
                    addTo={canAdd ? ({ key, question }) => addUnder(key, question) : undefined} />
                </ResizeBox>
                {/* (Owner, Nov 5, §234) The Past questions box, directly under the panel: read-only, no Add. */}
                {pastBox}
              </div>
            </Fold>
          </div>
        )}
        {!written && (refusal || meOff || !draftsShown) && <p className="note">Nothing sent.</p>}
        {/* Not sent yet: the form for the current questions. (Owner, Nov 5, §235; replaces the "update" form that refilled every question, and §222's Answer this
            question rows) Once sent: one form below the answers with a box for each current question that has no answer yet, and only those (an answered one is
            added to in its fold, a past one is in Past questions); after a switch to changed questions it also moves the part onto them. Always "Send Answers". */}
        {canSendAgain(written) && !refusal && !meOff && draftsShown && (!written || newQuestions || openQs.length > 0) && (
          <div className="space-y-2" data-answer-form={written ? "open" : "first"}>
            {written?.setUntil && <p className="note" data-set-until-form="">What you sent is for the questions until {fmtDate(written.setUntil)}. Send your answers to these questions: they&apos;re added under what you sent.</p>}
            {written && openQs.length > 0 && <p className="text-sm font-medium text-white" data-open-questions-title="">Questions you haven&apos;t answered yet</p>}
            <WrittenForm key={written ? `open:${openQs.join("|")}` : "first"} only={!!written} needOne={!written || !newQuestions} canSend={!rulesPaused} lines={sendLines(written, c.writtenCents)} seenAt={seenAt} sessionId={c.id} questions={openQs} initial={written ? openQs.map(() => "") : carryOver(sentItems, writtenQuestions(c))} initialNotes={written?.notes ?? ""} update={false}
              initialAttachments={c.recordings.filter((r) => r.part === "written" && r.uploadedAt).map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType }))} />
          </div>
        )}
        {/* (Batch 13 section 8) The previous sets of questions and answers, newest first, read-only. (Owner, Nov 5, §234) Inside the Past questions box: under
            "Your written answers" once something was sent, else here. */}
        {!written && pastBox}
        {/* (Batch 13) Show an excerpt of paid written answers on the profile (the developer allows or denies it). */}
        {written && excerptPicks.length > 0 && <ExcerptPicker submissionId={written.id} choices={excerptPicks} />}
        {excerptPending && <p className="note" data-excerpt-pending="">Your excerpt request is waiting for <NameLink text={dev} href={devHref} />.</p>}
      </section>

      {/* (NEXT-UI 4) Leaving, in its own card as in the full app. */}
      {c.status === "working" && !meOff && (
        <section className="card space-y-3 text-sm" id="leave">
          <h2 className="font-semibold text-white">Can&apos;t finish?</h2>
          <p className="text-slate-400">You can leave this test: what you sent is still reviewed and paid as usual, the parts you haven&apos;t sent close with no pay, and calls ahead are cancelled. You can join again later while the test is open: your session comes back.</p>
          <LeaveButton sessionId={c.id} seenAt={seenAt} title={title} />
        </section>
      )}

    </div>
  );

  });
}

type Rev = { amountCents: number; agreedCents: number | null; rejected: boolean; reason: string; createdAt: Date; rateCents?: number | null; /** (batch 30 §5) */ teamClosedById?: string | null };
type Disp = { status: string; decidedCents: number | null; decisionNote: string; devSide: string } | null;

/** What the developer did with a piece, as the tester reads it (they see what they get; never holds or chargebacks). */
function TesterReview({ timeZone, sessionId, kind, id, review, dispute, off = false, dev = "The developer", extras = [], room = null, more = null, update = null }: { timeZone?: string | null; /** (Batch 30 §2) an update closed at $0 */ update?: { at: Date; note: string } | null; /** (Batch 28 §14) what this piece was paid, what Pay more can bring it to in all, and when Pay more closed */ more?: { paidCents: number; allCents: number; closedOn: string | null } | null; /** (Batch 20 section 15) what a decision could still add */ room?: number | null; dev?: string; /** (Batch 9) extra pays on this piece, with their notes */ extras?: { amountCents: number; note: string; createdAt: Date }[]; off?: boolean; sessionId: string; kind: "submission" | "call"; id: string; review: Rev; dispute: Disp }) {
  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, timeZone);
  // (Batch 10) Every part the developer reviewed can be disputed once, listed or not (not the tester's own Charge or Let it go).
  const check = canDispute(review.amountCents, review.agreedCents, !!dispute, byTesterChoice(review.reason), room);
  const may = check.ok && !review.teamClosedById;
  // (Batch 20 section 15) Nothing left to award: the button stays, greyed, with the line (the page's poll brings a Pay more).
  const full = !check.ok && check.message === NOTHING_TO_DISPUTE;
  // (Owner, Oct 29, batch 30 §16) More than 4 payment lines: a box about 4 lines tall (PayLinesBox); the lines under them stay outside it. (Owner, Nov 3, §152) The
  // box is the draggable panel.
  return (
    <div className="space-y-2 rounded-lg bg-white/[0.03] p-3 text-sm">
      <PayLinesBox id={id} count={1 + extras.length + (update ? 1 : 0)}>
      {review.rejected ? (
        // (Batch 15 section 30) Old rejections stay, and read "Rejected".
        <p><b>Rejected</b> ({fmtDateTime(review.createdAt)}): “{review.reason}”</p>
      ) : review.teamClosedById ? (
        // (Batch 30 §5) The team closed it for $0, with the team's reason.
        <p data-team-closed="">{teamClosedLine(review.reason)} ({fmtDateTime(review.createdAt)})</p>
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
      {/* (Batch 30 §2) The developer closed an update at $0 (with their note, if any). */}
      {update && <p data-update-closed="">{updateClosedZeroLine(dev)} ({fmtDateTime(update.at)}){update.note && <> · “{update.note}”</>}</p>}
      {extras.map((x, i) => <p key={i} data-extra-line="">Extra {money(x.amountCents)}: you get {money(testerShare(x.amountCents))} ({fmtDateTime(x.createdAt)}){x.note && <> · “{x.note}”</>}</p>)}
      </PayLinesBox>
      {dispute && <p>{dispute.status === "open" ? "You disputed this: waiting for the team." : `The team decided: ${money(dispute.decidedCents)} in all${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : "."}`}</p>}
      {/* (Owner, Oct 29, batch 28 §14) Whether this part can still be paid more (grey; not a stop). */}
      {more && !review.rejected && !review.teamClosedById && (
        <p className="note" data-pay-more-state="">{more.allCents <= more.paidCents ? testerPaidMostLine(more.paidCents) : more.closedOn ? payClosedLine(more.closedOn, true) : testerPayMoreLine(dev, more.paidCents, more.allCents)}</p>
      )}
      {dispute?.devSide && <p>The developer&apos;s side: “{dispute.devSide}”</p>}
      {may && !off && <DisputeForm sessionId={sessionId} kind={kind} id={id} seenAt={new Date().toISOString()} limit={disputeLimitText(room ?? 0)} />}
      {/* (Batch 30 §5) Final: no dispute on a team closure. */}
      {review.teamClosedById && !dispute && !off && (
        <div className="space-y-1" data-dispute-team-closed="">
          <button type="button" className="btn-ghost text-sm" disabled>Dispute the pay</button>
          <p className="note">{TEAM_CLOSED_NO_DISPUTE}</p>
        </div>
      )}
      {full && !off && (
        <div className="space-y-1" data-dispute-none="">
          <button type="button" className="btn-ghost text-sm" disabled>Dispute the pay</button>
          <p className="note">{NOTHING_TO_DISPUTE}</p>
        </div>
      )}
    </div>
  );
}
