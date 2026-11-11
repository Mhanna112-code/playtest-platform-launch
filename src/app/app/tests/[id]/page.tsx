import { developerNeedsRows } from "@/lib/server/dashboardNeeds";
import { RejoinTag } from "@/components/RejoinTag";
import { withLineLinks } from "@/components/LineLinks";
import { NameLink } from "@/components/Cut";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtTimeIn } from "@/lib/format";
import { UNLISTED_CALL_CLOSED, dayIn } from "@/lib/rules";
import { hasPerks } from "@/lib/server/subscription";
import { CALL_MIN_AHEAD_MINUTES } from "@/lib/callLead";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDateIn, fmtDateTimeIn, fmtStampIn, money, pronouns } from "@/lib/server/dateFormat";
import { IN_PROGRESS_DEV, WAITING_TO_CONNECT, callInProgress, chargeOpensAt, callJoinable, bookedLateLabel, isBookedLate, callReference, cancelNeedsReason, chargeAmount, choiceNoteLine, closesInLine, termsLine, PAID_ZERO_LABEL } from "@/lib/rules";
import { callIsOver, callLengthLine, callMinutesOf, callOverBadge, MEASURING_LINE } from "@/lib/callMeasure";
import { callsLeftCents } from "@/lib/server/callMoney";
import { callsLeftWarning } from "@/lib/callMeasure";

import { LabeledReason, ReasonQuote } from "@/components/ScrollText";
import { requireOpenPage } from "@/lib/server/page-auth";
import { PageLoaded } from "@/components/PageLoaded";
import { OnePage } from "@/components/OnePage";
import { testScope } from "@/lib/pageClaim";
import { devRestricted, payGoesOn } from "@/lib/restricted";
import { PAUSED_ALERTS, STOPPED_ALERTS } from "@/lib/alerts";
import { TestBanner, allowedLine, type BannerCause } from "./TestBanner";
import { RestrictedCalls } from "./RestrictedCalls";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { unreadCount } from "@/lib/server/messages";
import { DevCallPanel, type DevCall, type DevTester } from "./DevCallPanel";

import { InvitePanel } from "./InvitePanel";
import { inviteExpired, invitePanel, testerRowInfo } from "@/lib/server/invites";
import { owedForBox } from "@/lib/server/holds";
import { termsRowLines } from "@/lib/server/terms";
import { answerable, rejoinAskLine } from "@/lib/server/joining";
import { RateBox } from "@/components/RateBox";
import { contractRatings, devRateStates, ratingSummary } from "@/lib/server/ratings";
import { LiveTop } from "@/components/LiveTop";
import { MessagesSquare } from "lucide-react";
import { Applications } from "./Applications";
import { NeedsRequests } from "./NeedsRequests";
import { CallRequestsBox } from "./CallRequestsBox";
import { callEndProps, devRateLabel, pageRows, rateLabel } from "@/lib/server/requests";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeSide } from "./DisputeSide";
import { PayOwedLink } from "@/components/PayOwedLink";
import { inviteBlocked, rateNeedsLine, NOT_LISTED, callListed, deletedNoPayoutsLine, joiningClosedLine, closeOutSoon, closedNotPaidLine, payClosesLine, testerPayable, stopReasonOf, workDeadlineOf } from "@/lib/rules";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { PayBox } from "./PayBox";
import { CONFIRM_WITH_BANK, autoChargeLine, unlistedCloseLine, bankAnchor, joinerDays, paidMostLine, pausedUntil } from "@/lib/rules";
import { closedOut, pieceCloseOut } from "@/lib/server/closeOut";
import { BankWaiting } from "@/components/BankWaiting";
import { HoldFold } from "@/components/HoldFold";
import type { ReactNode } from "react";
import { disputePart } from "@/lib/lineAnchors";
import { bankWaitingOnTest } from "@/lib/server/confirm";
import { ListingPanel } from "./ListingPanel";
import { ListingSeeIt, SeeItTarget } from "@/components/ListingInfo";
import { panelRows } from "@/lib/listingPanel";
import { lastListingSave } from "@/lib/server/listingPanel";
import { Fold, OwnPanel, ResizeBox } from "@/components/Panel";
import { PART_PANEL } from "@/lib/panelStyle"; // (§351) not from the client module: its constant reached this server page as a function
import { SentWork } from "@/components/SentWork";
import { lastPaidAt } from "@/lib/paidCut";
import { additionsOf, answersByQuestion } from "@/lib/additions";
import { bankWaitsOf, pieceOf, pieceRoom } from "@/lib/server/payments";
import { TopPanel } from "./TopPanel";
import { NeedsYou } from "./NeedsYou";
import { KeysNotice } from "./KeysNotice";
import { keyBoxes } from "@/lib/server/accessKeys";
import { TestersJoined } from "./TestersJoined";
import { ChatWithButton } from "@/components/ChatWithButton";
import { RowsBox } from "./RowsBox";
import { testerStats } from "@/lib/server/profileStats";
import { ByQuestion } from "./ByQuestion";
import { LIST_PANEL, PAST_CALLS_SHOWN, PanelWhen } from "@/components/ScrollList";
import { PartPayments } from "@/components/PartPayments";
import { PaidSoFar } from "@/components/PaidSoFar";
import { paidForWork } from "@/lib/server/paymentRows";
import { partPaymentLines } from "@/lib/server/partPayments";
import { byQuestion } from "@/lib/byQuestion";
import { QuestionsChangedEntry } from "@/components/QuestionsHistory";
import { questionChanges } from "@/lib/questionHistory";
import { qStored } from "@/lib/questions";
import { pendingForDeveloper } from "@/lib/server/excerpts";
import { ExcerptQuestion, ExcerptQuote, ExcerptReplaces } from "@/components/ExcerptList"; // (batch 16 section 37) the question above each excerpt request
import { ExcerptDecision } from "@/components/Excerpts";
import { TEAM_CLOSED_LABEL, UPDATED_AT_CAP, pieceDay, teamDecidedLabel, updateWaiting } from "@/lib/moneyLines";

import { testV } from "@/lib/server/pulseV";
import { otherSideNotice } from "@/components/OtherSideNotice";
export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

/** (Owner, Nov 9, §356) A disputed part's payments and decision note, the place a "{tester} disputed …" line falls back to (lineFallbacks). */
function DisputedPart({ dispute, children }: { dispute: { id: string } | null; children: ReactNode }) {
  if (!dispute) return <>{children}</>;
  // The jump target's classes (MARKABLE, written out: markJump is a client module).
  return <div id={disputePart(dispute.id)} className="space-y-2 scroll-mt-24 rounded-xl transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-jump-open-all="" data-disputed-part={dispute.id}>{children}</div>;
}
function DecisionNote({ dispute }: { dispute: { id: string; status: string; decidedCents: number | null; decisionNote: string } | null }) {
  if (dispute?.status !== "decided" || !dispute.decisionNote.trim()) return null;
  return <LabeledReason data={{ "data-team-decided": "" }} line={teamDecidedLabel(money(dispute.decidedCents))} label="The team's decision" id={`decision-note-${dispute.id}`} text={dispute.decisionNote} />;
}

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ failed?: string }> }) {
  const { id } = await params;
  // First: a restricted developer may open a test page only in its restricted view (batch 15 section 29); every other page sends them to the dashboard top.
  const u = await requireOpenPage(`/app/tests/${id}`);
  const previousTesterNames = await (await import("@/lib/server/previousNames")).previousNamesFor(u.id);
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
  const fmtTime = (d: Date | string) => fmtTimeIn(d, u.timeZone);
  // (Owner, Nov 6, §300) Today: the time; another day: the date and time (a cancelled call's "Cancelled by … · …").
  const fmtWhen = (d: Date) => (dayIn(d, u.timeZone) === dayIn(new Date(), u.timeZone) ? fmtTime(d) : fmtDateTime(d));
  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
  await (await import("@/lib/server/confirm")).expireActions(new Date(), { developerId: u.id });
  await (await import("@/lib/server/recovery")).checkStuck({ testId: id }); // (batch 15 section 9) payments stuck "in progress"
  // (Owner, Nov 6, §283) A left or ended tester's contract that no Save reached is brought onto the listing's questions (its Terms history keeps the old ones).
  { const lt = await db.test.findUnique({ where: { id }, select: { questions: true } }); if (lt) await (await import("@/lib/server/terms")).syncEndedQuestions(id, lt.questions); }
  const { failed } = await searchParams; // (Owner, Nov 5, §275 revised) the Save's note is on Edit now: no saved/offered/closed/resent/skipped here
  const seenAt = new Date().toISOString();
  // (Batch 30 §8) The poll's fingerprint as of BEFORE the page reads what it shows: AutoRefresh starts from it, so a change right after this render is caught.
  const pageV = await testV(u.id, id);
  const t = await db.test.findUnique({
    where: { id },
    include: {
      contracts: {
        orderBy: { joinedAt: "asc" },
        include: {
          tester: { include: { profile: true } },
          submissions: { include: { review: true, dispute: true, recordings: true }, orderBy: { sentAt: "asc" } },
          calls: { include: { review: true, dispute: true, slot: true }, orderBy: { startsAt: "asc" } },
        },
      },
    },
  });
  if (!t || t.developerId !== u.id) notFound();
  // (Owner, Oct 28 evening) A draft is not a test page: it opens in Post a test.
  if (t.status === "draft") redirect(`/app/tests/new?draft=${t.id}`);
  // (Batch 8) The free plan: the perk buttons show a "Subscribers" tag (a press is refused with a Payments link).
  const perks = await hasPerks(u);
  // (Batch 14 section 6) The read-only Access keys notice (only when the test uses keys).
  const keysView = await keyBoxes(id);
  const rejoined = await (await import("@/lib/server/rejoinHistory")).rejoinLabels(id, t.contracts);
  const participationHistory = await (await import("@/lib/server/contractHistory")).contractHistory(id, t.contracts, true);
  // (Owner, Oct 30, batch 15 sections 23, 29 and 37) ANY pause (the team's, a payment or chargeback hold, a developer-side suspension) shows the restricted view: the
  // overview with Stop and End early, Booked calls with Cancel, the excerpt requests and the disputes. Only the banner's title and reason differ by cause.
  const accountPaused = devRestricted(u, "developer");
  const teamPaused = !!t.adminPausedAt && t.status !== "stopped";
  const restricted = accountPaused || teamPaused;
  // (Owner, Nov 9, §368) Paying goes on in the restricted view during a team pause or a developer suspension (as the tester's Charge does); a hold still stops it.
  const restrictedPays = restricted && payGoesOn(u);
  const bannerCause: BannerCause | null = t.adminStoppedAt ? "team-stopped" : teamPaused ? "team-paused" : u.devSuspendedAt ? "suspended" : u.holdStartedAt ? (u.holdReason === "chargeback" ? "chargeback" : "hold") : t.status === "stopped" ? "stopped" : null;
  const bannerCauseReason = bannerCause === "team-paused" || bannerCause === "team-stopped" ? t.adminNote : bannerCause === "suspended" ? u.devSuspendNote : "";
  const keysEver = await db.accessKey.count({ where: { testId: id } });
  const keysLeft = keysEver > 0 ? await db.accessKey.count({ where: { testId: id, status: "free" } }) : null;
  const working = t.contracts.filter((c) => c.status === "working");
  // (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (every tester's deadline, no earlier than Open until): no call time later. The request form's
  // time box stops there, its calls drop-down offers only what fits, and a waiting request's words say how many calls it covers.
  const callEnd = t.workEndedAt ?? workDeadlineOf(t, t.contracts);
  // (Owner, Nov 4, §195) What the developer has paid for each tester's work on this test (paymentRows.paidForWork: never a repayment's fee; a reversal not paid back
  // taken off), shown once by the tester's name: Needs you's person, the Testers row, the Call requests box's person. Read with the page, so every live redraw has it.
  const paidWork = await paidForWork(t.contracts.map((c) => c.id));
  const paidSoFar = (id: string) => paidWork.get(id) ?? 0;
  const termsRows = await termsRowLines(t.contracts.map((c) => c.id));
  const callSets = await db.callSet.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } } });
  const reqs = await db.callRequest.findMany({ where: { testId: id, status: "pending", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  // A developer batch sent to several testers shows once per tester; that's fine: each copy is that tester's.
  // (Batch 34 §16) An applicant who holds a sent invite isn't answered here: they're in the Invited list, and joining closes the application.
  const pendingApps = await answerable((t.status === "stopped" ? [] : await db.application.findMany({ where: { testId: id, status: "pending" }, orderBy: { createdAt: "asc" } })));
  const appUsers = await db.user.findMany({ where: { id: { in: pendingApps.map((a) => a.testerId) } }, include: { profile: true } });
  const appInfo = await testerRowInfo(u.id, t, appUsers);
  const apps = pendingApps.map((a) => {
    const x = appUsers.find((y) => y.id === a.testerId)!;
    const old = a.kind === "rejoin" ? t.contracts.find((c) => c.testerId === a.testerId) : undefined;
    // (Owner, Nov 4, §181) `contractId`: an ask to rejoin goes in the drop-down of the person it is (their contract here); `at`: when it was sent.
    return { id: a.id, contractId: t.contracts.find((c) => c.testerId === a.testerId)?.id, at: a.createdAt, kind: a.kind, line: old ? rejoinAskLine(displayName(x), pronouns(x.pronoun), old, u.timeZone) : undefined, userId: x.id, name: displayName(x), note: a.note, ...appInfo.get(x.id)! };
  });
  // (NEXT-UI 4) Chat is its own page per session: each tester's row links to it with an unread badge.
  const unread = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await unreadCount(u.id, t.id, c.testerId)] as const)));
  const blockedIds = new Set((await db.block.findMany({ where: { blockerId: u.id } })).map((b) => b.blockedId));
  // (B16) Pay more is refused while either side blocks the other ("This payment isn't available."): the page doesn't offer it then.
  const blockedEither = new Set((await db.block.findMany({ where: { OR: [{ blockerId: u.id }, { blockedId: u.id }] }, select: { blockerId: true, blockedId: true } })).map((b) => (b.blockerId === u.id ? b.blockedId : b.blockerId)));
  const [invitePanelData, invites, owedList] = await Promise.all([restricted || t.status === "stopped" ? null : invitePanel(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owedForBox(u.id)]);
  const inviteUsers = await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } }, include: { profile: true } });
  const people = new Map(inviteUsers.map((x) => [x.id, displayName(x)]));
  const inviteInfo = await testerRowInfo(u.id, t, inviteUsers);
  const expired = inviteExpired(t);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const now = new Date();
  // (Owner, Nov 11, §378; replaces batch 17 §19's one date per test) Pay more on a piece closes on that piece's own date, with its Pay and the tester's Charge
  // (pieceCloseOut); in its last 7 days that piece's box says "Pay more closes on <date>.".
  const paidKeys: { submissionId?: string; callId?: string }[] = t.contracts.flatMap((c) => [...c.submissions.filter((x) => x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((x) => x.review).map((x) => ({ callId: x.id }))]);
  const moreCloses = new Map(await Promise.all(paidKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, now)] as const)));
  const payMore = (pieceId: string) => {
    const at = moreCloses.get(pieceId) ?? null;
    return { open: !closedOut(at, now), line: closeOutSoon(at, now) ? payClosesLine(fmtDate(at!), true) : "" };
  };
  // (Owner, Oct 26) A chargeback hold's steps. (A paused test's closing date is told by bell and shown to the admin, not on the page.)
  const cbSteps = await chargebackSteps(u.id);
  // (Batch 17 §11) Charges made while the developer was away that their bank wants confirmed: "Confirm with your bank" under the affected piece (Payments and the bell link here).
  const bankRows = await bankWaitingOnTest(u.id, t.id);
  const confirmingPays = await db.payment.findMany({ where: { developerId: u.id, contractId: { in: t.contracts.map((c) => c.id) }, kind: { in: ["review", "call"] }, status: "needs_action" }, select: { id: true, submissionId: true, callId: true } });
  const confirmingPay = (id: string) => confirmingPays.find((p) => (p.submissionId ?? p.callId) === id)?.id;
  // (Owner, Nov 3, §159) Pay more waits while a payment on its part waits for the bank: its box is greyed with the line saying which.
  // (Owner bug, Nov 4, §174) With the waiting payment's id: the Pay more box whose OWN bank check that is never greys itself for it.
  const bankWaits = new Map<string, Awaited<ReturnType<typeof bankWaitsOf>>>();
  for (const w of await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) }, kind: { in: ["review", "call", "extra", "dispute"] }, status: { in: ["needs_confirmation", "needs_action"] }, settledAt: null }, select: { submissionId: true, callId: true, contractId: true } })) {
    const piece = w.submissionId ?? w.callId;
    const c = t.contracts.find((x) => x.id === w.contractId);
    if (piece && c && !bankWaits.has(piece)) bankWaits.set(piece, await bankWaitsOf(db, { submissionId: w.submissionId, callId: w.callId }, displayName(c.tester)));
  }
  const waitsOf = (id: string) => bankWaits.get(id)?.line || undefined;
  const waitsIdOf = (id: string) => bankWaits.get(id)?.id || undefined;
  // (Owner, Nov 4, §188 B) What the greyed Pay more box offers next to its line: Cancel this check (the developer's own press) or Confirm with your bank (away).
  const waitsKindOf = (id: string) => ((w) => (w ? { kind: w.kind, cents: w.cents } : undefined))(bankWaits.get(id));
  // (Batch 23 section 9) "Confirm with your bank" stops once like Pay: it sends this page's seen marker.
  // (Owner, Oct 31, batch 35 §80) Confirmed in Needs you (where the dashboard's box, Payments and the bell link); under the piece only a link up to it.
  // (Owner, Nov 4, §199) "Confirm with your bank" only in Needs you, never as a working box in the Testers list: the link up in every view (the restricted branch
  // that drew the full box here is gone; the restricted view lists the charges in its Needs you, bankKind, and has no Testers list of its own).
  const bankUp = (b: (typeof bankRows)[number]) => <a key={b.id} href={`#${bankAnchor(b.id)}`} className="block text-xs" data-bank-up={b.id}>{CONFIRM_WITH_BANK} in Needs you ↑</a>;
  const bankAt = (pieceId: string) => bankRows.filter((b) => b.pieceId === pieceId).map(bankUp);
  // (Owner, Nov 6, §301) The Testers list's separate "Pay more" drop-down ("Pay" before anything was paid) right under a part's content panel (a written part, a
  // recording, a call): closed at first, kept open or closed per part (Fold's keptFold), opened by a jump into it (markJump's jumpTo opens every fold above its
  // target) or to its part (§139). Inside: the Pay more box and the lines that sat with it (closed unpaid, at its cap, paid $0, closed by the team). Its summary line
  // carries what must be seen without opening it: the link up to a charge waiting for the bank in Needs you, else "waiting for your bank" while the box is greyed
  // for a check (bankWaits). Nothing inside: no drop-down (only the bank link, when there is one).
  const payFold = (foldId: string, label: "Pay more" | "Pay", inside: ReactNode[], pieceId: string) => {
    const bank = bankAt(pieceId);
    if (!inside.length) return bank.length ? <div className="space-y-1" data-pay-fold-bank={pieceId}>{bank}</div> : null;
    const waits = !bank.length && bankWaits.has(pieceId);
    return (
      <Fold id={foldId} defaultOpen={false} className={`w-full ${PART_PANEL}`} summaryClassName="flex flex-wrap items-center gap-x-2 gap-y-1 !text-sm font-medium !text-white"
        data={{ "data-part-panel": "pay", "data-pay-fold": label }}
        summary={<><span data-pay-fold-label="">{label}</span>{waits && <span className="text-xs font-normal text-amber-200" data-pay-fold-waits="">· waiting for your bank</span>}{bank}</>}>
        <div className="space-y-2">{inside}</div>
      </Fold>
    );
  };
  // (Owner, Nov 4, §175, §180; §181) Needs you lists the waiting charges under each tester's name, inside that person's drop-down (needsPeople below), oldest first
  // (bankRows comes oldest first), each with its own Confirm with your bank. The links up from the tester's row still land on the charge itself, inside its drop-down.
  const bankOf = (contractId: string) => bankRows.filter((b) => b.contractId === contractId);
  // (Batch 23, a batch 21 leftover) A call whose two browsers never connected reads "Waiting to connect", not "In progress".
  const connectedCalls = new Set((await db.callPresence.findMany({ where: { call: { contract: { testId: t.id } } }, select: { callId: true }, distinct: ["callId"] })).map((p) => p.callId));
  // (Owner, Oct 27) While a failed payment is owed, Pay (part Pay, extra pay) is disabled: "Pay what you owe first."; the room above the listing prices for extra pay.
  const owesNow = owedList.some((o) => o.retry);
  // (Batch 9 section 6) Extra pay's "up to $Y", per piece: every sent part and every call that took place (batch 15 section 40: its length is final).
  const tookPlace = (x: { status: string; actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) => x.status === "booked" && callMinutesOf(x) != null;
  const pieceKeys: { submissionId?: string; callId?: string }[] = t.contracts.flatMap((c) => [...c.submissions.map((x) => ({ submissionId: x.id })), ...c.calls.filter(tookPlace).map((x) => ({ callId: x.id }))]);
  const rooms = new Map(await Promise.all(pieceKeys.map(async (k) => {
    const piece = (await pieceOf(k))!;
    const r = await pieceRoom(piece);
    return [k.submissionId ?? k.callId!, { room: r.roomCents, paid: r.paidCents, listed: r.listed, pool: r.callPoolRoomCents, box: { roomCents: r.roomCents, aboveRoomCents: r.aboveRoomCents, ceilingBinds: r.ceilingBinds, totalCapCents: r.totalCapCents } }] as const;
  })));
  // (Batch 15 section 34) What's left of the $500 for each tester's calls, and the small warning when under an hour (or under $200 unlisted).
  const callsLeft = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await callsLeftCents(c.id)] as const)));
  // (Batch 17 §19) Each unpaid piece's Pay closes on its own date (the test's close-out, or 14 days after its Charge opened if later): then it leaves Needs you and its
  // place reads "Closed on <date>: not paid."; in its last 7 days its Needs you row says "Pay closes on <date>.".
  const unpaidKeys: { submissionId?: string; callId?: string }[] = t.contracts.flatMap((c) => [...c.submissions.filter((x) => !x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((x) => tookPlace(x) && !x.review).map((x) => ({ callId: x.id }))]);
  const payCloses = new Map(await Promise.all(unpaidKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, now)] as const)));
  const payShut = (pieceId: string) => closedOut(payCloses.get(pieceId) ?? null, now);
  const shutOn = (pieceId: string) => fmtDate(payCloses.get(pieceId)!);
  const paySoon = (pieceId: string) => (closeOutSoon(payCloses.get(pieceId) ?? null, now) ? fmtDate(payCloses.get(pieceId)!) : "");
  const callsWarn = new Map(t.contracts.map((c) => [c.id, callsLeftWarning(callsLeft.get(c.id) ?? 0, callListed(t, c) ? c.liveRateCents : null, "developer", displayName(c.tester))] as const));
  // (Owner, Oct 28, batch 16 section 33) The developer's other booked calls still ahead (any tester, any test), for the clash checks while Request a time is filled.
  const otherCalls = (await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, contract: { test: { developerId: u.id } } }, include: { contract: { include: { tester: true } } } }))
    .map((x) => ({ contractId: x.contractId, name: displayName(x.contract.tester), start: x.startsAt.toISOString(), minutes: x.minutes }));
  const lengthOf = (x: Parameters<typeof callLengthLine>[0]) => callLengthLine(x, fmtTime);
  const lateOf = (c: { dueAt: Date; tester: { name: string; email: string } }, x: { createdAt: Date }) => (isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(c.tester), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined);
  const partPaid = (id: string) => payments.filter((p) => (p.submissionId === id || p.callId === id) && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const payments = await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
  // (Owner, Nov 3, batch 35 §152) Each part's payments, listed under it (Payments' "What you've paid" lines, with their date, amount and status).
  const partPays = await partPaymentLines(payments, fmtDateTime);
  // (Owner, Nov 5, §226) A part's cut-off: its last Pay or Pay more (lib/paidCut.ts). The Testers list shows the part up to it; Needs you only what came after it.
  const paidCut = (s: { id: string; review?: { amountCents: number; createdAt: Date } | null; paidUpdateZeroAt?: Date | null }) => lastPaidAt(s, payments);
  // The developer's live-call panel: one row per working tester (terms like the parts listing) and their calls/requests.
  const whole = (c: number | null) => money(c).replace(/\.00$/, "");
  // One booked call as the Live session's row shows it (with Join call / Cancel). (Owner, Nov 5, §209) Only there: the tester rows list calls that are over.
  const devCallOf = (c: (typeof t.contracts)[number], x: (typeof t.contracts)[number]["calls"][number]): DevCall => ({ id: x.id, joinable: callJoinable(x, now), report: x.noShowBy ? { byMe: x.noShowBy === "developer", note: x.noShowNote } : null, when: x.startsAt.toISOString(), minutes: x.minutes, rate: rateLabel(x.rateCents, c.liveRateCents), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, reported: !!x.noShowBy, late: lateOf(c, x), measuring: x.startsAt <= now ? (restricted ? (connectedCalls.has(x.id) ? IN_PROGRESS_DEV : WAITING_TO_CONNECT) : MEASURING_LINE) : undefined }); // (batch 18 section 9) a pause doesn't cut a call in progress
  // (Owner, Nov 6, §292) Each working tester's calls booked with someone else (another developer, or another test), for the form's red line: bare time ranges,
  // never who with. The server checks the same on the press (requests.ts recipientBusyClash).
  const testerBusy = await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, contract: { testerId: { in: working.map((c) => c.testerId) } } }, select: { startsAt: true, minutes: true, contractId: true, contract: { select: { testerId: true } } }, orderBy: { startsAt: "asc" } });
  const devTesters: DevTester[] = working.map((c) => {
    const subOf = (kind: string) => c.submissions.find((x) => x.kind === kind);
    const part = (label: string, cents: number | null, kind: string) => {
      if (cents == null) return null;
      const sub = subOf(kind);
      return sub ? `${label} sent, paid ${whole(partPaid(sub.id))} of ${whole(cents)}` : `${label} not sent`;
    };
    const callPaid = payments.filter((x) => x.contractId === c.id && x.callId && (x.status === "charged" || x.status === "not_set_up")).reduce((a, x) => a + x.amountCents, 0);
    const terms = [
      `due ${fmtDate(c.dueAt).replace(/, \d{4}$/, "")}`,
      part("Written", c.writtenCents, "written"),
      part("Recording", c.recordingCents, "recording"),
      // (Owner, Oct 28 afternoon) A call that isn't a listed part (not in the listing, or not in this tester's contract) can still be requested: its pay is up to the developer.
      callListed(t, c) ? `Live call ${whole(c.liveRateCents)}/h, ${whole(callPaid)} paid so far` : `Live call: ${NOT_LISTED}`,
    ].filter(Boolean).join(" · ");
    const toCall = (x: (typeof c.calls)[number]): DevCall => devCallOf(c, x);
    // (Batch 15 section 42) The Live session shows only calls ahead and calls in progress; a call that's over moves to the tester's row.
    const live = c.calls.filter((x) => x.status === "booked" && !callIsOver(x));
    const setIds = [...new Set(live.filter((x) => x.setId).map((x) => x.setId!))];
    // (NEXT-UI 7) A set's line: "Weekly · Mon 3:00 PM (3 left)", or no count for Forever.
    const sets = setIds.flatMap((sid) => {
      const cs = live.filter((x) => x.setId === sid).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const row = callSets.find((x) => x.id === sid);
      const daily = row ? row.repeat === "daily" : cs.length > 1 && cs[1].startsAt.getTime() - cs[0].startsAt.getTime() < 2 * 86_400_000;
      const left = cs.filter((x) => x.startsAt > now).length;
      if (!left) return [];
      const next = cs.find((x) => x.startsAt > now)!;
      return [{ id: sid, label: `${daily ? "Daily" : "Weekly"} · ${cs[0].startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: u.timeZone || "UTC" })}${row?.count === 0 ? " (until testers' work ends)" : ` (${left} left)`}`, minutes: cs[0].minutes, rate: rateLabel(cs[0].rateCents, c.liveRateCents), needsReason: cancelNeedsReason(next.startsAt, now), calls: cs.map(toCall) }];
    });
    // (Owner, Nov 4, §185) As the server counts it: a Forever set while it runs is one booked time even with none of its calls ahead.
    const booked = new Set([...c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => x.setId ?? x.id), ...callSets.filter((s) => s.contractId === c.id && s.status === "active" && s.count === 0).map((s) => s.id)]).size;
    return {
      contractId: c.id, name: displayName(c.tester), testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, terms, booked, warning: callsWarn.get(c.id) ?? "",
      calls: live.filter((x) => !x.setId).map(toCall),
      sets,
      busy: testerBusy.filter((x) => x.contract.testerId === c.testerId && x.contractId !== c.id).map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes })),
      // (Batch 16 section 33) Their waiting requests and yours, as they arrive (answered in the Call requests panel).
      pending: reqs.filter((r) => r.contractId === c.id).length, // (Owner, Nov 6, §280) what's left of the $500 no longer goes to the form: booking isn't checked against it
      requests: reqs.filter((r) => r.contractId === c.id).map((r) => ({
        id: r.id, minutes: r.minutes, rows: pageRows(r, callEnd), mine: r.fromSide === "developer",
        rate: devRateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents, t.liveRateCents, c.tester.pronoun),
      })),
    };
  });
  // (NEWEST+5) Rating a tester: only after they rated you (14 days); their rating shows once you rate (or the window closes).
  // (Batch 17 sections 1, 14, 16 and 19) The developer's Rate box per tester: shown once the tester rated and everything they sent is settled (or, for a tester who never
  // rated, from the close-out), disabled while a dispute with them is open, hidden while the developer is held or suspended.
  const rateStates = await devRateStates(t.contracts.map((c) => c.id), now);
  const rateBoxOf = (c: { id: string; tester: Parameters<typeof displayName>[0] }) => {
    const st = rateStates.get(c.id);
    if (!st || (st.kind !== "open" && st.kind !== "disabled")) return null;
    const name = displayName(c.tester);
    return <RateBox key={`rate-${c.id}`} anchor={`rate-${c.id}`} path={`/api/tests/${t.id}/rate`} body={{ contractId: c.id }} seenAt={seenAt} name={name} working={false} disabledLine={st.kind === "disabled" ? st.line : ""} headline={`Your rating of ${name} is final. Both ratings show once you rate.`} lines={[]} />;
  };
  // (Owner, Nov 6, §288) Testers who rated this test: their disputes are closed, so nothing on this page says they can dispute.
  const ratedTesters = new Set((await db.rating.findMany({ where: { testId: t.id, side: "tester" }, select: { contractId: true } })).map((r) => r.contractId));
  const rateInfo = new Map(
    await Promise.all(
      t.contracts.map(async (c) => [c.id, { ...(await contractRatings(c.id, now)), state: rateStates.get(c.id)! }] as const),
    ),
  );
  // (NEXT-UI 21) Needs you: sent work and held calls waiting for Pay / Reject, the testers' call requests, disputes waiting for the developer's side.
  const pieces = t.contracts
    // (Owner, Oct 29, batch 11) A tester who deleted their account: their sent work stays here when their payout account was connected; without one it leaves (their row says why).
    .filter((c) => testerPayable(c.tester))
    .flatMap((c) => [
      ...c.submissions.filter((x) => !x.review).map((x) => ({ kind: "sub" as const, id: x.id, c, s: x, x: null, at: x.sentAt })),
      ...c.calls.filter((x) => tookPlace(x) && !x.review).map((x) => ({ kind: "call" as const, id: x.id, c, s: null, x, at: x.startsAt })),
    ])
    .filter((x) => confirmingPay(x.id) || !payShut(x.id)) // An already-started bank check can finish after Pay closes.
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const needsRequests = reqs.filter((r) => r.fromSide === "tester").flatMap((r) => {
    const c = t.contracts.find((x) => x.id === r.contractId);
    return c ? [{ id: r.id, contractId: c.id, at: r.createdAt, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, name: displayName(c.tester), rows: pageRows(r, callEnd), minutes: r.minutes, rate: devRateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents, t.liveRateCents, c.tester.pronoun), warning: callsWarn.get(c.id) }] : [];
  });
  // (Batch 35 §162) "her written answers", "Her reason": the tester's recorded pronoun.
  const disputesWaiting = t.contracts.flatMap((c) => [
    ...c.submissions.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, contractId: c.id, at: x.dispute!.createdAt, name: displayName(c.tester), Poss: pronouns(c.tester.pronoun).Poss, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, what: `${pronouns(c.tester.pronoun).poss} ${x.kind === "written" ? "written answers" : "recording"}`, reason: x.dispute!.reason })),
    ...c.calls.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, contractId: c.id, at: x.dispute!.createdAt, name: displayName(c.tester), Poss: pronouns(c.tester.pronoun).Poss, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, what: `the call on ${fmtDateTime(x.startsAt)}`, reason: x.dispute!.reason })),
  ]);
  // (Owner, Oct 29, batch 13) Excerpt requests waiting for Allow or Deny (hidden while the test has an NDA), and excerpts shown from this test (batch 29 section 30: only the tester removes one; owner, Nov 3, §166: listed only in the restricted view, no longer in the tester's row).
  const excerptReqs = await pendingForDeveloper(u.id, t.id);
  const shownEx = await db.excerpt.findMany({ where: { testId: t.id, status: "shown" }, orderBy: { decidedAt: "desc" } });
  // (Owner, Oct 30, batch 34 §14) The Listing panel (it replaces the Contract changes fold): the current listing, the fields the most recent save changed tagged.
  // (Batch 35 §32) The tester deadline as a tester joining now gets it (the same helper as the join page): an Open until moved later grows it (batch 15 §18).
  const listingNow = { ...asListing(t), deadlineDays: joinerDays(t, u.timeZone) };
  const lastSave = await lastListingSave(t.id);
  const listingRows = panelRows(listingNow, lastSave, "developer", u.timeZone);
  // (Batch 17 §15) The developer's own Stop and its reason (the team's Stop has its own): (batch 34 §14, the Contract changes fold gone) in the red banner.
  const stopEvent = t.status === "stopped" && !t.adminStoppedAt ? await db.testEvent.findFirst({ where: { testId: id, kind: "stopped" }, orderBy: { createdAt: "desc" } }) : null;
  const stopEntry = stopEvent && stopReasonOf(stopEvent.text) ? { at: stopEvent.createdAt.toISOString(), reason: stopReasonOf(stopEvent.text) } : null;
  const bannerReason = bannerCause === "stopped" && stopEntry ? stopEntry.reason : bannerCauseReason;
  // (Batch 15 section 29) The restricted view: Booked calls (ahead) with Cancel, and the open disputes waiting for the developer's side.
  const bookedAhead = t.contracts.flatMap((c) => c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => ({ id: x.id, contractId: c.id, at: x.createdAt, who: displayName(c.tester), whoHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, when: x.startsAt.toISOString(), minutes: x.minutes, needsReason: cancelNeedsReason(x.startsAt, now) }))).sort((a, b) => a.when.localeCompare(b.when));
  // (Owner, Nov 4, §181) "Is it possible in Needs you to have all notifications about the same person under each name" ("expandable"): Needs you (and the restricted
  // view's) is one drop-down per person (HoldFold: closed at first; the summary is the green name, then "· N things"), holding everything in Needs you about them,
  // with a small sub-heading over each kind only when they have more than one kind. The person whose oldest waiting thing waits longest comes first; inside, each
  // kind keeps its order. An applicant who hasn't joined is a person of their own (keyed by the application). Nothing in Needs you is about no one.
  // (Owner, Nov 4, §199) Each kind under a person is now its own drop-down ("Pay (2)"), Rate excepted; applications and asks to rejoin left the people for one
  // "Applications (N)" drop-down above all the names (needsApplications below).
  // (Owner, Nov 4, §195) `paidCents`: a tester's (someone with a contract here) paid so far, on the right of their summary; an applicant who hasn't joined has none.
  type NeedsWho = { key: string; name: string; href: string | null; paidCents?: number };
  type NeedsKind = { kind: string; label: string; ats: Date[]; node: ReactNode; data?: Record<string, string>; /** how many things it is, when not one per time in `ats` */ count?: number };
  const whoOf = (c: (typeof t.contracts)[number]): NeedsWho => ({ key: c.id, name: displayName(c.tester), href: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, paidCents: paidSoFar(c.id) });
  const needsPeople = (entries: (NeedsKind & { who: NeedsWho })[]) => {
    const people: (NeedsWho & { kinds: NeedsKind[] })[] = [];
    for (const { who, ...k } of entries) {
      if (!k.ats.length) continue;
      const p = people.find((x) => x.key === who.key);
      if (p) p.kinds.push(k);
      else people.push({ ...who, kinds: [k] });
    }
    const oldest = (p: (typeof people)[number]) => Math.min(...p.kinds.flatMap((k) => k.ats.map((d) => d.getTime())));
    return people.sort((a, b) => oldest(a) - oldest(b)).map((p) => {
      const count = p.kinds.reduce((n, k) => n + (k.count ?? k.ats.length), 0);
      return (
        <HoldFold key={p.key} data={{ "data-needs-person": p.key, "data-needs-who": p.name /* (Owner, Nov 5, §274) Search testers matches it */ }} toggleData={{ "data-needs-person-toggle": "" }}
          // (Owner, Nov 4, §187) The whole name, cut with "…" only when the row is full (it was cut at 12 characters with room to spare); "· N things" never cut.
          // (Owner, Nov 4, §195) A tester's paid so far on the right of the row ("paid $15.00 so far"), never cut either.
          summary={<span className="flex min-w-0 flex-1 items-baseline gap-1"><span className="min-w-0" data-needs-person-name=""><NameLink fit text={p.name} href={p.href} /></span><span className="shrink-0 whitespace-nowrap font-normal text-slate-400" data-needs-person-count="">· {count} thing{count === 1 ? "" : "s"}</span>{p.paidCents != null && <PaidSoFar cents={p.paidCents} />}</span>}>
          {/* (Owner, Nov 3) Each name's drop-down is its own panel (it scrolls inside; the grip drags it taller). (Owner, Nov 4, §187) Inside Needs you's panel it is
              plain: only Needs you's panel scrolls (Panel.tsx's nesting rule). */}
          <ResizeBox id={`needs-person-${p.key}`} label={`${p.name}: Needs you`} defaultMax="min(30rem, 60vh)">
            <div className="min-w-0 space-y-2">
              {/* (Owner, Nov 4, §199; replaces §181's sub-headings) Each kind is a drop-down of its own, even when it is the person's only kind: closed at first,
                  "Pay (2)", "Confirm with your bank (1)", "Disputes (1)" (the count is how many items it holds: parts, charges, disputes, requests…). It is a HoldFold
                  like the person's: a link to anything inside opens it, and it stays open while a bank box, a press, a stop box or a refusal shows inside. No border
                  or padding of its own (no extra indent on a phone, §187) and no panel of its own (only Needs you's panel scrolls). Rate is the exception: its line
                  stays plain under the name, no drop-down. */}
              {p.kinds.map((k) => k.kind === "rate" ? (
                <div key={k.kind} className="min-w-0 space-y-2" data-needs-kinds={k.kind} {...k.data}>{k.node}</div>
              ) : (
                <HoldFold key={k.kind} className="min-w-0" summaryClassName="flex items-center gap-2 text-sm font-semibold text-slate-200" bodyClassName="mt-2 min-w-0 space-y-2"
                  data={{ "data-needs-kinds": k.kind, "data-needs-kind-fold": k.kind, ...k.data }}
                  summary={<span data-needs-kind={k.kind}>{k.label} ({k.ats.length})</span>}>
                  {k.node}
                </HoldFold>
              ))}
            </div>
          </ResizeBox>
        </HoldFold>
      );
    });
  };
  // The kinds both views share: a person's charges waiting for the bank, their disputes waiting for your side, their excerpt requests.
  const bankKind = (c: (typeof t.contracts)[number], extra: Record<string, string> = {}) => ({ who: whoOf(c), kind: "bank", label: CONFIRM_WITH_BANK, ats: bankOf(c.id).map((b) => b.at), data: { "data-bank-group": c.id, ...extra },
    node: bankOf(c.id).map((b) => <BankWaiting key={b.id} paymentId={b.id} cents={b.cents} line={withLineLinks(b.line, b.links, { draw: (t) => t }) /* (Owner, Nov 5, §270) */} full={b.full} seenAt={seenAt} />) });
  const disputeKind = (c: (typeof t.contracts)[number], extra: Record<string, string> = {}) => {
    const mine = disputesWaiting.filter((d) => d.contractId === c.id);
    return { who: whoOf(c), kind: "disputes", label: "Disputes", ats: mine.map((d) => d.at), data: extra, node: mine.map((d) => (
      <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-2 rounded-lg border border-white/10 p-2 text-sm sm:p-3">
        {/* (Owner, Nov 5, §252) The whole dispute is one drop-down (its line the summary); inside, the reason sits right under the line, in its box (no drop-down of its
            own), then "Add your side". */}
        <Fold id={`needs-dispute-${d.id}`} summary={<span className="text-slate-300"><b className="text-white"><NameLink fit text={d.name} href={d.testerHref} /></b> disputed what you paid for {d.what} · waiting for the team</span>}>
        {/* (Owner, Nov 5, §237) The reason in one box (it was a fixed scroll box inside a panel): the draggable reason box itself. */}
        <ReasonQuote id={`dispute-${d.id}`} label={`${d.Poss} reason`} text={d.reason} />
        <DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />
        </Fold>
      </div>
    )) };
  };
  const excerptKind = (c: (typeof t.contracts)[number], extra: Record<string, string> = {}) => {
    const mine = excerptReqs.filter((x) => x.contractId === c.id);
    return { who: whoOf(c), kind: "excerpts", label: "Excerpt requests", ats: mine.map((x) => x.at), data: extra, node: mine.map((x) => (
      <div key={x.id} id={`excerpt-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-2 text-sm scroll-mt-24 sm:p-3" data-excerpt-request="">
        {/* (Owner, Nov 3, batch 35 §140) Each request its own fold: the one-line summary, then (open) the full content in a panel; its buttons stay under it. */}
        <Fold id={`needs-excerpt-${x.id}`} summary={<span className="text-slate-300"><b className="text-white">Excerpt request</b> · <NameLink fit text={x.tester} href={x.testerHref} /> would like to show this on {x.testerPoss} profile</span>}>
        <ResizeBox id={`excerpt-${x.id}`} label="Excerpt request">
          {x.ndaNote && <p className="note" data-excerpt-nda="">{x.ndaNote}</p>}
          <ExcerptQuestion id={x.id} question={x.question} />
          <ExcerptQuote id={`excerpt-text-${x.id}`} text={x.text} />
          <ExcerptReplaces id={x.id} texts={x.replaces} />
        </ResizeBox>
        </Fold>
        <ExcerptDecision excerptId={x.id} seenAt={seenAt} />
      </div>
    )) };
  };
  // (Batch 30 §2) Updated versions sent after a piece was paid, below its cap while Pay more is open: each its own Needs you row with the piece's Pay more box.
  const updates = restricted && !restrictedPays ? [] : t.contracts.filter((c) => testerPayable(c.tester) && !blockedEither.has(c.testerId)).flatMap((c) => c.submissions.filter((x) => updateWaiting(x) && payMore(x.id).open && (rooms.get(x.id)?.room ?? 0) > 0).map((x) => ({ c, s: x })))
    .sort((a, b) => a.s.paidUpdateAt!.getTime() - b.s.paidUpdateAt!.getTime());
  const needsCount = (await developerNeedsRows(u.id,[t.id],now))[0]?.n??0;
  // (Owner, Nov 4, §181) "the parts should have big drop down with their name then part and pay/pay more as own dropdowns": in the person's drop-down each part is a
  // drop-down of its own (closed; the plain part name: "Written answers", "Recording", "Live call on <date>"), holding what it held before (its sent / updated
  // line, its payments, the answers or recordings with their "Added · date" lines) and, last, its Pay (or Pay more, for an update sent after paying) as one more
  // drop-down. A link to the part ("#piece-<id>", "#call-<id>", "#update-<id>") opens it and its Pay box (as §139); the tester's name is on the drop-down above, once.
  const partNode = (x: (typeof pieces)[number]) => {
    const anchor = x.kind === "sub" ? `piece-${x.id}` : `call-${x.id}`;
    return (
      // (Owner, Nov 4, §187) Each level of the stack indents at most 8px on a phone.
      <div key={x.id} id={anchor} className="rounded-lg border border-white/10 p-2 scroll-mt-24 sm:p-3">
        <HoldFold openOn={[anchor]} className="min-w-0" summaryClassName="text-sm font-medium text-white" data={{ "data-fold": `needs-part-${x.id}` }}
          summary={x.kind === "sub" ? (x.s!.kind === "written" ? "Written answers" : "Recording") : `Live call on ${fmtDateTime(x.x!.startsAt)}`}>
          <p className="text-xs text-slate-400" data-part-when="">
            {x.kind === "sub" ? `${additionsOf(x.s!.additions).length ? "Updated" : "Sent"} ${fmtDateTime(x.s!.updatedAt)}` : `${x.x!.minutes} min booked`} · {(x.kind === "sub" ? x.s!.agreedCents : x.x!.rateCents) == null ? NOT_LISTED : `In ${pronouns(x.c.tester.pronoun).poss} contract`}
          </p>
          {/* (Batch 17 §19) The last 7 days before close-out. */}
          {paySoon(x.id) && <p className="note" data-pay-closes="">{payClosesLine(paySoon(x.id))}</p>}
          {/* (Owner, Nov 5, §225; was §152's payments list here too) A part's individual payments are listed only in the Testers list, never in Needs you. */}
          {x.kind === "sub" ? (
            <>
              {/* (Owner, Nov 3, batch 35 §139; was batch 10's 16-line box) Inside the part's drop-down: the answers or recordings in a small panel (about 12rem)
                  that drags taller or shorter and scrolls inside, so the Pay box under it is in view; then the Pay box. */}
              {/* (Owner, Nov 6, §282) Two panels: first the content (a written part: its questions in ONE "Questions (N)" drop-down, SentWork's
                  questionsFold, open at first since the developer is about to pay; (Owner, Nov 6, §289) a plain drop-down with no scroll of its own, the
                  person's panel the only scroll; a recording: its recordings in their panel, flat inside the person's, §187), then right under it the Pay panel. */}
              {((body: ReactNode) => <div className={`${PART_PANEL} space-y-2`} data-part-panel="content">{x.s!.kind === "written" ? body
                : <ResizeBox id={`needs-${x.s!.id}`} label="Recordings">{body}</ResizeBox>}</div>)(<>
                {/* (Batch 13 section 8) What was last sent, under the questions it answered; an earlier set says so (reviewed and paid at the price it was sent at). */}
                {x.s!.kind === "written" && x.s!.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(x.s!.setUntil)}</p>}
                {/* (Owner, Nov 5, §226) Only what is new: never paid, every answered question (not the unanswered ones). (Owner, Nov 5, §255) No "new question" tag.
                    (Owner, Nov 5, §263) A new, unpaid answer or addition to a question that has since changed shows too, after the current ones, with a small
                    "Old" tag beside the question, so it can be paid; once paid it is only in Terms history. */}
                <SentWork id={`needs-${x.s!.id}`} timeZone={u.timeZone} kind={x.s!.kind} answers={x.s!.answers} questions={writtenQuestions(x.c)} notes={x.s!.notes} additions={x.s!.additions} files={x.s!.recordings} newOnly={{ since: paidCut(x.s!) }} questionsFold={{ open: true, ownScroll: false }} />
              </>)}
              <HoldFold openOn={[anchor]} className={PART_PANEL} summaryClassName="text-sm font-medium text-white" data={{ "data-fold": `needs-pay-${x.id}`, "data-part-panel": "pay" }} summary="Pay">
              <PayBox owes={owesNow} disputable={!ratedTesters.has(x.c.id)} key={x.s!.id} kind="submission" fromNeeds id={x.s!.id} name={displayName(x.c.tester)} seenAt={seenAt} room={rooms.get(x.s!.id)?.box} confirming={confirmingPay(x.s!.id)}
                /* (Batch 30 §3) Late work never opens Charge: no "<tester> can charge" line. */
                note={x.s!.agreedCents != null && !x.s!.late && chargeOpensAt(x.s!, t, x.c, now) && !x.s!.choiceOfferedAt ? choiceNoteLine(pieceDay(chargeOpensAt(x.s!, t, x.c, now)!, u.timeZone), displayName(x.c.tester), chargeAmount(x.s!.agreedCents, partPaid(x.s!.id)), pronouns(x.c.tester.pronoun).poss) : undefined}
                listingCents={x.s!.agreedCents} listingText={`${money(x.s!.agreedCents)} for ${x.s!.kind === "written" ? "written answers" : "a recording"}`} />
              </HoldFold>
            </>
          ) : (
            <>
              {/* (Owner, Nov 6, §282) A call too: its details panel, then the Pay panel right under it. */}
              <div className={`${PART_PANEL} space-y-2`} data-part-panel="content">
                {/* (Batch 15 section 40) The measured length: "Length: 29 min (both in the call 2:21–2:50 PM)"; a lowered one says so, with the reason. */}
                <p className="text-sm text-slate-200" data-call-length="">{lengthOf(x.x!)}</p>
                {x.x!.actualMinutes != null && x.x!.lengthNote && <ReasonQuote text={x.x!.lengthNote} />}
              </div>
              <HoldFold openOn={[anchor]} className={PART_PANEL} summaryClassName="text-sm font-medium text-white" data={{ "data-fold": `needs-pay-${x.id}`, "data-part-panel": "pay" }} summary="Pay">
              <PayBox owes={owesNow} disputable={!ratedTesters.has(x.c.id)} key={`${x.x!.actualMinutes ?? 0}`} kind="call" fromNeeds id={x.x!.id} name={displayName(x.c.tester)} seenAt={seenAt} room={rooms.get(x.x!.id)?.box} confirming={confirmingPay(x.x!.id)}
                /* (Owner, Oct 29, batch 28 §21) A listed call is charged automatically 7 days after it if it is not paid. (Owner, Nov 6, §311e) An unlisted one closes
                   with nothing paid then: the same note, in its words. */
                note={x.x!.payBy && x.x!.payBy > now ? (x.x!.rateCents != null ? autoChargeLine(pieceDay(x.x!.payBy, u.timeZone), Math.min(callReference(x.x!.rateCents, callMinutesOf(x.x!)!).cents ?? 0, callsLeft.get(x.c.id) ?? Infinity), callMinutesOf(x.x!)!, x.x!.rateCents) : unlistedCloseLine(pieceDay(x.x!.payBy, u.timeZone))) : undefined}
                minutes={callMinutesOf(x.x!)!} rateCents={x.x!.rateCents} warning={callsWarn.get(x.c.id)}
                listingCents={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).cents}
                listingText={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
              </HoldFold>
            </>
          )}
        </HoldFold>
      </div>
    );
  };
  // (Batch 30 §2) An updated version sent after its part was paid (below its cap while Pay more is open): (§181) that part's drop-down, with Pay more.
  const updateNode = ({ c, s: x }: (typeof updates)[number]) => (
    <div key={`update-${x.id}`} id={`update-${x.id}`} className="rounded-lg border border-white/10 p-2 scroll-mt-24 sm:p-3" data-update-row={x.id}>
      <HoldFold openOn={[`update-${x.id}`]} className="min-w-0" summaryClassName="text-sm font-medium text-white" data={{ "data-fold": `update-part-${x.id}` }} summary={x.kind === "written" ? "Written answers" : "Recording"}>
        <p className="text-xs text-slate-400" data-part-when="">Updated {fmtDateTime(x.paidUpdateAt!)}</p>
        {/* (Owner, Nov 5, §224) No "<name> added to this after you paid ($X paid · up to $Y more)" line here: the part's payments and Pay more say it. */}
        {/* (Owner, Nov 5, §225) Its payments are listed only in the Testers list, never in Needs you. */}
        {/* (Owner, Nov 6, §282) Two panels: the content (a written part's "Questions (N)" drop-down, open at first, §289: no scroll of its own in Needs you; a
            recording's panel), then the Pay panel. */}
        {((body: ReactNode) => <div className={`${PART_PANEL} space-y-2`} data-part-panel="content">{x.kind === "written" ? body
          : <ResizeBox id={`update-${x.id}`} label="Recordings">{body}</ResizeBox>}</div>)(<>
          {/* (Owner, Nov 5, §226) Only what came after the last payment: the questions answered or added to since, with just the new parts. */}
          {/* (Owner, Nov 5, §263; replaces §234's "never a past question in Needs you") An old question's new answer or addition shows, tagged "Old".
              (Owner, Nov 5, §255) No "new question" tag on the developer's side. */}
          <SentWork id={`update-${x.id}`} timeZone={u.timeZone} kind={x.kind} answers={x.answers} questions={writtenQuestions(c)} notes={x.notes} additions={x.additions} files={x.recordings} newOnly={{ since: paidCut(x) }} questionsFold={{ open: true, ownScroll: false }} />
        </>)}
        {/* (Owner, Nov 5, §226) In Needs you the press for what's new on a paid part is "Pay" (Pay more's route, checks and stops; the Testers list keeps Pay more). */}
        <HoldFold openOn={[`update-${x.id}`]} className={PART_PANEL} summaryClassName="text-sm font-medium text-white" data={{ "data-fold": `update-pay-${x.id}`, "data-part-panel": "pay" }} summary="Pay">
        <PayBox more={{ testId: t.id, contractId: c.id }} moreLabel="Pay" update owes={owesNow} fromNeeds kind="submission" id={x.id} name={displayName(c.tester)} seenAt={seenAt} bankWaits={waitsOf(x.id)} bankWaitsId={waitsIdOf(x.id)} bankWaitsKind={waitsKindOf(x.id)} note={payMore(x.id).line || undefined}
          room={rooms.get(x.id)?.box} listingCents={x.agreedCents} listingText={`${money(x.agreedCents)} for ${x.kind === "recording" ? "a recording" : "written answers"}`} />
        </HoldFold>
      </HoldFold>
    </div>
  );
  const banner = bannerCause ? (
    <TestBanner cause={bannerCause} reason={bannerReason} failed={failed}
      allowed={restricted ? allowedLine(true, { pay: restrictedPays && (pieces.length > 0 || updates.length > 0), stop: t.status !== "stopped", endEarly: t.status !== "stopped" && working.length > 0, cancelCalls: bookedAhead.length > 0, disputes: disputesWaiting.length > 0 }) : allowedLine(false, { nextRound: !t.adminStoppedAt })} />
  ) : null;
  if (restricted) {
    // (Owner, Nov 4, §172; replaces batch 17 §14) No Rate here: a test the team paused hides Rate as a suspension does.
    const restrictedNeeds = needsCount;
    const restrictedPeople = needsPeople(t.contracts.flatMap((c) => {
      const calls = bookedAhead.filter((x) => x.contractId === c.id);
      // (§368) Their parts to pay (and updates after paying), as in the full view, while paying goes on.
      const mine = restrictedPays ? pieces.filter((x) => x.c.id === c.id) : [], more = restrictedPays ? updates.filter((x) => x.c.id === c.id) : [];
      return [
        { who: whoOf(c), kind: "pay", label: "Pay", ats: [...mine.map((x) => x.at), ...more.map((x) => x.s.paidUpdateAt!)], data: { "data-restricted-pay": "" }, node: <div className="space-y-3">{mine.map(partNode)}{more.map(updateNode)}</div> },
        bankKind(c, { "data-restricted-bank": "" }),
        disputeKind(c, { "data-restricted-disputes": "" }),
        { who: whoOf(c), kind: "calls", label: "Booked calls", ats: calls.map((x) => x.at), node: <RestrictedCalls testId={t.id} seenAt={seenAt} calls={calls} embedded person={c.id} /> },
        excerptKind(c, { "data-restricted-excerpts": "" }),
      ];
    }));
    return (
      <>
        <AutoRefresh query={`test=${t.id}`} v={pageV} />
        <OnePage scope={testScope(t.id)} />
        {banner}
        <TopPanel timeZone={u.timeZone}
          id={t.id} title={t.title} productName={t.productName} ignoredAlerts={t.ignoredAlerts} alertsV={t.alertsV} restricted mature={t.mature} nda={!!t.ndaText} keysLeft={keysLeft}
          parts={{ written: t.writtenCents != null, recording: t.recordingCents != null, live: t.liveRateCents != null }} paused status={t.status} workEnded={!!t.workEndedAt}
          terms={termsLine({ ...asListing(t), testerDays: t.testerDays })} openUntil={t.openUntil ? t.openUntil.toISOString() : null} version={t.version} seenAt={seenAt}
          teamStopped={!!t.adminStoppedAt} perks={perks} spotsLine={`${working.length} of ${t.spots} spots used`} full={working.length >= t.spots}
          joinMode={t.joinMode} deadlineDays={t.deadlineDays} categories={t.categories}
          alertKeys={t.status === "stopped" ? [...STOPPED_ALERTS] : [...PAUSED_ALERTS]}
          doneTo={accountPaused ? "/app" : undefined}
          working={working.map((c) => ({
            contractId: c.id, name: displayName(c.tester),
            sent: [...(c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
            toSend: [...(c.writtenCents != null && !c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.recordingCents != null && !c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
            ahead: c.calls.filter((x) => x.status === "booked" && x.startsAt > now).length,
            waiting: [...c.submissions.filter((x) => !x.review && !payShut(x.id)).map((x) => (x.kind === "recording" ? "recording" : "written answers")), ...(c.calls.some((x) => tookPlace(x) && !x.review && !payShut(x.id)) ? ["live call"] : [])],
          }))}
        />
        <LiveTop scope={`test:${t.id}`} seenAt={seenAt} contractLink="scroll" />
        <PageLoaded at={seenAt} />
        {/* (Owner, Nov 4, §181) One drop-down per person: their charges waiting for the bank (Batch 17 §11: a charge made while away, e.g. a retry during the pause,
            confirmed here), their disputes (Batch 15 section 27: the developer's side is optional, never stopped, works while paused or restricted), their booked calls
            with Cancel, their excerpt requests (Batch 15 section 39: Allow / Deny go through anything; batch 29 section 30: no Take down). "#calls" lands on the list. */}
        {restrictedNeeds > 0 && <NeedsYou count={restrictedNeeds} people={restrictedPeople.length}>
          <div className="space-y-2" id={bookedAhead.length > 0 ? "calls" : undefined} data-needs-people="">
            {restrictedPeople}
          </div>
        </NeedsYou>}
        {shownEx.length > 0 && <section className="card space-y-2" aria-label="Shown excerpts">
            {shownEx.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm" data-shown-excerpt="">
                <div className="min-w-0 flex-1 space-y-1"><span className="block text-slate-400">On a tester&apos;s profile:</span><ExcerptQuote id={`shown-excerpt-${e.id}`} text={e.text} /></div>
              </div>
            ))}
        </section>}
      </>
    );
  }
  // (Owner, Oct 28, batch 20 section 24) Each open Rate in Needs you: "Rate ff · 14 days left", linking to that tester's Rate box (the page's poll brings it).
  const rateNeeds = restricted ? [] : t.contracts.flatMap((c) => {
    const st = rateStates.get(c.id);
    // (§181) `at`: when the window opened (its end when that isn't known), for the order of the drop-downs.
    return st?.kind === "open" && st.endsAt ? [{ id: c.id, at: st.opensAt ?? st.endsAt, line: rateNeedsLine(displayName(c.tester), st.endsAt, now) }] : [];
  });
  // (Owner, Nov 4, §181) Everything in Needs you, by person, each person's kinds in this order: their parts to pay (and updates after paying), their charges waiting
  // for the bank, their disputes (Add your side), their call requests (the row opens the Live session's Call requests panel there, as before), their excerpt
  // requests (Allow / Deny), their Rate. (Owner, Nov 4, §199) Applications and asks to rejoin are in the one Applications drop-down above the names instead.
  // (Batch 16 sections 33 and 35) Every waiting call request, both directions: (Owner, Nov 4, §181) the page's own Call requests box (CallRequestsBox), by person.
  const callRequests = restricted ? [] : reqs.flatMap((r) => {
    const c = working.find((x) => x.id === r.contractId);
    return c ? [{ id: r.id, at: r.createdAt.toISOString(), contractId: c.id, tester: displayName(c.tester), testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, asker: r.fromSide === "developer" ? "you" : displayName(c.tester), rows: pageRows(r, callEnd), minutes: r.minutes, mine: r.fromSide === "developer", rate: devRateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents, t.liveRateCents, c.tester.pronoun), warning: callsWarn.get(c.id) || undefined, paidCents: paidSoFar(c.id) }] : [];
  });
  const needsEntries = [
    ...t.contracts.flatMap((c) => {
      const mine = pieces.filter((x) => x.c.id === c.id), more = updates.filter((x) => x.c.id === c.id);
      const asks = needsRequests.filter((r) => r.contractId === c.id), rate = rateNeeds.filter((r) => r.id === c.id);
      return [
        { who: whoOf(c), kind: "pay", label: "Pay", ats: [...mine.map((x) => x.at), ...more.map((x) => x.s.paidUpdateAt!)], node: <div className="space-y-3">{mine.map(partNode)}{more.map(updateNode)}</div> },
        bankKind(c),
        disputeKind(c),
        // (Owner, Nov 4, §181) Their call requests are answered in the Call requests box: here one line, "2 call requests ↓", jumping to them there (one thing).
        { who: whoOf(c), kind: "requests", label: "Call requests", ats: asks.map((r) => r.at), count: 1, node: <NeedsRequests contractId={c.id} count={asks.length} /> },
        excerptKind(c),
        { who: whoOf(c), kind: "rate", label: "Rate", ats: rate.map((r) => r.at), node: rate.map((r) => <p key={`rate-need-${r.id}`} className="text-sm" data-rate-need={r.id}><a href={`#rate-${r.id}`}>{r.line}</a></p>) },
      ];
    }),
  ];
  // (Owner, Nov 5, §274) The people, rendered once: NeedsYou shows its "Search testers" box only when there is more than one.
  const needsPeopleShown = needsPeople(needsEntries);
  // (Owner, Nov 4, §199) One "Applications (N)" drop-down above all the names: every pending application and ask to rejoin on this test, oldest first, each with its
  // own Accept / Decline exactly as before (one Applications per request, so a press on one never greys the others, §181). They are no longer in the people's
  // drop-downs: an applicant who hasn't joined is no longer a name of their own; a rejoiner with other things keeps those under their name. Closed at first, a
  // HoldFold like the people's (a link to "#item-app-<id>" opens it; a press or its result inside holds it open). Needs you's count is unchanged.
  const needsApplications = apps.length > 0 && (
    <HoldFold data={{ "data-needs-applications": String(apps.length) }} toggleData={{ "data-needs-applications-toggle": "" }}
      summary={<span>Applications ({apps.length})</span>}>
      <div className="min-w-0 space-y-2">
        {[...apps].sort((a, b) => a.at.getTime() - b.at.getTime()).map((a) => (
          <div key={a.id} className="min-w-0 rounded-lg border border-white/10 p-2 sm:p-3" data-needs-application={a.id}>
            <Applications embedded testId={t.id} seenAt={seenAt} apps={[a]} />
          </div>
        ))}
      </div>
    </HoldFold>
  );
  return (
    // (Batch 34 §14) Every stop box under any button on this page: a listing line's See it goes to the Listing panel.
    <SeeItTarget target="#listing">
      <AutoRefresh query={`test=${t.id}`} v={pageV} />
        <OnePage scope={testScope(t.id)} />
      {t.workEndedAt && <p className="info" data-work-ended="">This test ended on {fmtDate(t.workEndedAt)}. You can still pay for work already sent and use the remaining rating and dispute windows.</p>}
      <TopPanel timeZone={u.timeZone}
        id={t.id}
        title={t.title}
        productName={t.productName}
        ignoredAlerts={t.ignoredAlerts}
        alertsV={t.alertsV}
        restricted={restricted}
        alertKeys={t.status === "stopped" ? [...STOPPED_ALERTS] : undefined}
        mature={t.mature}
        nda={!!t.ndaText}
        keysLeft={keysLeft}
        parts={{ written: t.writtenCents != null, recording: t.recordingCents != null, live: t.liveRateCents != null }}
        paused={!!(u.holdStartedAt || t.adminPausedAt)}
        status={t.status} workEnded={!!t.workEndedAt}
        terms={termsLine({ ...asListing(t), testerDays: t.testerDays })}
        openUntil={t.openUntil ? t.openUntil.toISOString() : null}
        joinClosedLine={t.openUntil && t.openUntil < new Date() ? joiningClosedLine(t.contracts.filter((c) => c.status === "working" && c.dueAt > new Date()).reduce<Date | null>((m, c) => (!m || c.dueAt > m ? c.dueAt : m), null), (d) => fmtDate(d).replace(/, \d{4}$/, "")) : ""}
        version={t.version}
        seenAt={seenAt}
        teamStopped={!!t.adminStoppedAt}
        perks={perks}
        spotsLine={`${working.length} of ${t.spots} spots used`}
        full={working.length >= t.spots}
        joinMode={t.joinMode}
        deadlineDays={t.deadlineDays}
        categories={t.categories}
        working={working.map((c) => ({
          contractId: c.id,
          name: displayName(c.tester),
          sent: [...(c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
          toSend: [...(c.writtenCents != null && !c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.recordingCents != null && !c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
          ahead: c.calls.filter((x) => x.status === "booked" && x.startsAt > now).length,
          // (Owner, Oct 28) Everything still waiting for Pay or Reject: unreviewed parts and held calls (started, not paid).
          waiting: [...c.submissions.filter((x) => !x.review && !payShut(x.id)).map((x) => (x.kind === "recording" ? "recording" : "written answers")), ...(c.calls.some((x) => tookPlace(x) && !x.review && !payShut(x.id)) ? ["live call"] : [])],
        }))}
      />
      {t.pauseClosedAt && <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" data-pause-closed="">{t.pauseClosedReason}</p>}
      {/* (Batch 15 section 37) A stopped test (the developer's or the team's): the one red banner, with what still works at the bottom. */}
      {banner}
      {/* (Design doc 6) The order: overview, the live updates box, the yellow keys notice, then the panels. */}
      {/* (Batch 34 §14) A listing line's See it jumps to the Listing panel and marks what that save changed. */}
      <LiveTop scope={`test:${t.id}`} seenAt={seenAt} contractLink="scroll" seeIt="#listing" />
      <ListingSeeIt box="listing" />
      {/* (Batch 30) The seen marker starts at this page's first load in the tab: a redraw never skips a change the page hasn't shown. */}
      <PageLoaded at={seenAt} />
      <KeysNotice testId={t.id} keys={keysView.uses && !restricted ? keysView : null} canEdit={t.status !== "stopped" && t.status !== "closed"} />
      {/* (Owner, Oct 30, batch 34 §14) The first panel under the overview (and its notices): the current listing, as testers see it. */}
      <ListingPanel rows={listingRows} listing={listingNow} when={(d) => fmtDateTimeIn(d, u.timeZone)} savedAt={lastSave?.at.toISOString() ?? ""} />
      {/* (NEXT-UI 21) NEEDS YOU: everything waiting for the developer, the full app's pattern. Every Pay box for sent work and calls that took place lives here. */}
      {needsCount > 0 && !restricted && (
        <NeedsYou count={needsCount} people={needsPeopleShown.length}>
          {/* (Owner, Nov 4, §181) One drop-down per person, holding everything in Needs you about them (needsEntries). */}
          {/* (Owner, Nov 4, §199) The Applications drop-down first, above all the names. */}
          <div className="space-y-2">
            {needsApplications}
            <div className="space-y-2" data-needs-people="">{needsPeopleShown}</div>
          </div>
        </NeedsYou>
      )}

      {/* (Owner) The full app's "Testers joined" right after the header: avatars with their hover cards (Block inside). */}
      <TestersJoined timeZone={u.timeZone}
        testId={t.id}
        rows={t.contracts.length}
        spots={t.spots}
        status={t.status}
        seats={await Promise.all(working.map(async (c) => ({
          testerId: c.testerId,
          name: displayName(c.tester),
          pronoun: c.tester.pronoun,
          summary: [
            [...(c.tester.profile?.devices ?? []), ...(c.tester.profile?.languages ?? [])].join(", "),
            (await ratingSummary(c.testerId, "tester")).line || "No ratings yet", // (Owner, Nov 5, §276) their tester-side ratings only
            `Accepted parts: ${(await testerStats(c.testerId)).accepted.value} ${(await testerStats(c.testerId)).accepted.hint}`,
          ].filter(Boolean),
          block: null, // (Owner, Oct 27) Block and Report live only on profiles
          chat: <ChatWithButton contractId={c.id} name={displayName(c.tester)} />, // (Owner, Oct 27) "Chat with <name>" on every hover card
          // (Owner, Oct 28, batch 16 section 23) No excerpts on the hover card: they stay on the tester's profile.
        })))}
        gone={t.contracts.filter((c) => c.status !== "working").map((c) => ({ contractId: c.id, name: displayName(c.tester), how: c.endKind === "stopped" || c.endKind === "closed" ? "Stopped" : c.endKind === "suspended" || c.endKind === "deleted" ? "Removed" : c.endKind === "rated" ? "Left" : c.status === "left" ? "Left" : "Ended early", at: c.endedAt }))}
      >
      {/* (NEXT-UI 21; owner, Oct 27) TESTERS JOINED, one row per tester: parts sent (Required / Not required), paid per part and in total, the call summary and the agreed scope (their current contract only: no history fold for developers). No Pay boxes here. */}
      {t.contracts.length > 0 && (
        <RowsBox id={`tester-rows-${t.id}`}>
          {t.contracts.map((c) => {
            const name = displayName(c.tester);
            // (Batch 35 §137) Their name in a sentence links to their profile (cut, with its hover and tap pop-up).
            const personHref = c.tester.deletedAt ? null : `/app/testers/${c.testerId}`;
            const ri = rateInfo.get(c.id);
            const unreadN = unread.get(c.id) ?? 0;
            const callPaid = payments.filter((p) => p.contractId === c.id && p.callId && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
            // (Batch 15 section 31) "held" became "done": a call that took place.
            const done = c.calls.filter(tookPlace).length;
            // (Batch 15 section 42) Every call that's over, newest first (oldest last).
            const overCalls = c.calls.filter(callIsOver).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
            const writtenSub = c.submissions.find((s) => s.kind === "written"); // (§283) its Terms history, at the bottom
            const partRows = [
              { name: "Written answers", on: c.writtenCents != null, required: c.writtenRequired, sub: c.submissions.find((s) => s.kind === "written"), cents: c.writtenCents },
              { name: "Recording", on: c.recordingCents != null, required: c.recordingRequired, sub: c.submissions.find((s) => s.kind === "recording"), cents: c.recordingCents },
            ];
            return (
              <div key={c.id} className="panel space-y-2" id={`tester-${c.id}`} data-tester-name={name} data-tester-id={c.testerId} data-tester-working={c.status === "working" && !c.tester.deletedAt ? "" : undefined} data-previous-names={JSON.stringify(previousTesterNames.get(c.testerId) ?? [])}>
                {/* (Owner, Nov 3, batch 35 §140) Each tester folds by their name: closed, only the summary under it (paid in all, ratings, Rate); open, all their
                    parts, each in its own panel. Kept open or closed through the live redraws; a link into it (#part-, #call-…) opens it. */}
                <Fold id={`tester-${c.id}`} defaultOpen={t.contracts.length === 1} className="space-y-2" summaryClassName="flex flex-wrap items-baseline gap-2 !text-base" summary={<>
                  {/* (Owner, Nov 3, §166) The name is the green link to their profile (no "See her profile" any more). A press on the name opens the profile; a press
                      anywhere else on the heading (the arrow, the badges, the space after the name) still opens or closes the fold. */}
                  {/* (Owner, Nov 4, §199; the §187 rule) The whole name, cut with "…" only when the row is actually full (it was cut at 12 characters with room to
                      spare): `NameLink fit`, the heading `min-w-0` so it can shrink, never wider than the row less the arrow (so the arrow stays beside it); the badges and the paid figure (§195) never cut (they wrap below on a phone). */}
                  <h3 className="mr-auto min-w-0 max-w-[calc(100%-1.25rem)] font-semibold text-white" data-tester-fold-name=""><NameLink fit text={name} href={personHref} /><span hidden className="text-xs font-normal text-slate-400" data-previous-name-match="" /></h3>
                  <RejoinTag label={rejoined.get(c.id)} />
                  <span className="badge shrink-0 whitespace-nowrap">{c.status === "working" ? `Working · due ${fmtDate(c.dueAt)}` : c.status === "left" ? "Left the test" : "Work ended"}</span>
                  {/* (Owner, Nov 4, §195) Paid so far for their work on this test, once, on the right of the name row (it was the first line of the summary under the row). */}
                  <PaidSoFar cents={paidSoFar(c.id)} className="!ml-0" />
                </>}>
                <p className="note">{pronouns(c.tester.pronoun).Poss} contract: {termsLine(c)} · joined {fmtDate(c.joinedAt)}</p>
                <ul className="space-y-1 text-sm" data-parts-sent="">
                  {partRows.filter((r) => r.on || r.sub).map((r) => (
                    // (Batch 35 §7) A bell or email link to a piece ("#piece-<id>") that has left Needs you (paid) lands on this line (HashJump's fallback).
                    <li key={r.name} className={`scroll-mt-24 rounded-lg transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300 ${r.sub ? "border border-white/10 p-3" : ""}`} {...(r.sub ? { id: `part-${r.sub.id}` } : {})}>
                      {(() => {
                      const line = <>
                      <b className="text-white">{r.name}</b>
                      <span className={`badge ${r.required ? "border-amber-300/40 text-amber-200" : ""}`}>{r.required ? "Required" : "Not required"}</span>
                      <span className={r.sub ? "text-emerald-200" : "text-slate-400"}>{r.sub ? (additionsOf(r.sub.additions).length ? `Updated ${fmtDate(r.sub.updatedAt)}` : `Sent ${fmtDate(r.sub.sentAt)}`) : "Not sent yet"}</span>
                      {r.sub && <span className="text-slate-300">· paid {money(partPaid(r.sub.id))} of {r.sub.agreedCents != null ? money(r.sub.agreedCents) : `(${NOT_LISTED.toLowerCase()})`}</span>}
                      {r.sub?.review?.rejected && <span className="badge border-rose-400/40 text-rose-200">Rejected</span>}
                      </>;
                      // (Owner, Nov 3) A part that wasn't sent is its line only; a sent part is its own drop-down like Needs you's (open at first). (Owner, Nov 6,
                      // §301; replaces §282's content panel then pay panel) Inside, top to bottom: its "Payments (N)" drop-down (none without payments), its content
                      // panel (the answers or recordings), then a separate "Pay more" drop-down ("Pay" before anything was paid) holding the Pay more box.
                      if (!r.sub) return <div className="flex flex-wrap items-center gap-2">{line}</div>;
                      // (Owner, Nov 6, §301) What sat with Pay more goes inside its drop-down: the closed-unpaid line, the box, the at-cap line and badge, the $0
                      // and team-closed reasons. The bank line ("Confirm with your bank in Needs you ↑") must be seen without opening it: it is on the drop-down's
                      // summary line, as is "waiting for your bank" while the box itself is greyed for a check (bankWaits).
                      const inPay = [
                        // (Batch 17 §19) Unpaid at close-out: it stays unpaid.
                        !r.sub.review && payShut(r.sub.id) && testerPayable(c.tester) && <span key="shut" className="block w-full text-sm text-slate-300" data-closed-not-paid="">{closedNotPaidLine(shutOn(r.sub.id))}</span>,
                        // (Owner, Oct 29, batch 11 section 6 / batch 12 section 3) A paid piece keeps its Pay box as "Pay more" until its cap is reached.
                        r.sub && r.sub.review && !r.sub.review.rejected && !restricted && !blockedEither.has(c.testerId) && !r.sub.review.teamClosedById && payMore(r.sub.id).open && (rooms.get(r.sub.id)?.room ?? 0) > 0 && (
                          <div key="box" className="w-full space-y-1" data-part-pay-more="">
                          <PayBox more={{ testId: t.id, contractId: c.id }} awayInNeeds owes={owesNow} kind="submission" id={r.sub.id} name={name} seenAt={seenAt} bankWaits={waitsOf(r.sub.id)} bankWaitsId={waitsIdOf(r.sub.id)} bankWaitsKind={waitsKindOf(r.sub.id)} note={payMore(r.sub.id).line || undefined}
                            room={rooms.get(r.sub.id)?.box} listingCents={r.sub.agreedCents} listingText={`${money(r.sub.agreedCents)} for ${r.name === "Recording" ? "a recording" : "written answers"}`} />
                          </div>
                        ),
                        // (Owner, Oct 29, batch 28 §14) At its cap, where Pay more was (grey).
                        r.sub.review && !r.sub.review.rejected && !restricted && !r.sub.review.teamClosedById && payMore(r.sub.id).open && rooms.has(r.sub.id) && (rooms.get(r.sub.id)?.room ?? 0) <= 0 && <span key="most" className="block w-full text-sm text-slate-400" data-paid-most="">{paidMostLine(rooms.get(r.sub.id)!.paid)}</span>,
                        // (Batch 30 §2) An update the tester sent at the cap: nothing more can be paid, so it isn't in Needs you.
                        r.sub.paidUpdateAt && r.sub.review && !r.sub.review.rejected && !r.sub.review.teamClosedById && rooms.has(r.sub.id) && (rooms.get(r.sub.id)?.room ?? 0) <= 0 && <span key="upd" className="badge" data-updated-at-cap="">{UPDATED_AT_CAP}</span>,
                        // (Batch 30 §5) The team closed it for $0, with its reason. (Owner, Nov 6, §281) The reason (the team's, or your note when paying $0) in the
                        // draggable reason box under its line ("Paid $0 · <when>"), never inline.
                        r.sub.review?.teamClosedById ? <LabeledReason key="team" className="w-full text-sm text-slate-300" data={{ "data-team-closed": "" }} line={TEAM_CLOSED_LABEL} id={`review-note-${r.sub.id}`} text={r.sub.review.reason} />
                          : r.sub.review && r.sub.review.amountCents === 0 && !r.sub.review.rejected && r.sub.review.reason && <LabeledReason key="zero" className="w-full text-sm text-slate-300" data={{ "data-paid-zero": "" }} line={`${PAID_ZERO_LABEL} · ${fmtDateTime(r.sub.review.createdAt)}`} label={PAID_ZERO_LABEL} id={`review-note-${r.sub.id}`} text={r.sub.review.reason} />,
                      ].filter(Boolean);
                      return (
                      <Fold id={`row-part-${r.sub.id}`} className="space-y-2" summaryClassName="flex flex-wrap items-center gap-2 !text-sm !font-normal" summary={line}>
                      <div className="space-y-2">
                      {/* (Owner, Nov 6, §301) Right under the heading, above the content: the part's payments (§225) in "Payments (N)", closed at first. */}
                      {/* (Owner, Nov 9, §356) A "{tester} disputed …" line lands here once Needs you no longer shows the dispute. */}
                      <DisputedPart dispute={r.sub.dispute}><PartPayments id={r.sub.id} lines={partPays.get(r.sub.id)} />
                      <DecisionNote dispute={r.sub.dispute} /></DisputedPart>
                      {/* (Batch 35 §139; owner, Nov 3) Inside the part's drop-down: the answers or recordings in a small panel.
                          (Owner, Nov 5, §226) Only what was paid for: the part up to its last payment (newer additions wait in Needs you); before the first
                          payment, what was sent. */}
                      <div className={`w-full space-y-2 ${PART_PANEL}`} data-part-panel="content" data-paid-part-content="" data-paid-until={paidCut(r.sub)?.toISOString() ?? ""}>
                        {/* (Owner, Nov 6, §282) A written part: its questions in ONE "Questions (N)" drop-down (its own draggable scroll panel), closed at first,
                            kept open or closed per part; a recording: its recordings in their panel. */}
                        {((body: ReactNode) => r.sub!.kind === "written" ? body
                          : <ResizeBox id={`row-${r.sub!.id}`} label="Recordings">{body}</ResizeBox>)(<>
                          {r.sub.kind === "written" && r.sub.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(r.sub.setUntil)}</p>}
                          {/* (Owner, Nov 5, §263, final; replaces §234's Past questions box under it and §254's earlier-set answers there) As paid (§226), the
                              tester's current questions only: an old question is in the Terms history below. A question that comes back is current again by itself.
                              (Owner, Nov 5, §255) No "new question" tag on the developer's side. */}
                          <SentWork id={`row-${r.sub.id}`} timeZone={u.timeZone} kind={r.sub.kind} answers={r.sub.answers} questions={writtenQuestions(c)} notes={r.sub.notes} additions={r.sub.additions} files={r.sub.recordings} until={paidCut(r.sub)} questionsFold={{ open: false }} />
                        </>)}
                      </div>
                      {payFold(`row-pay-${r.sub.id}`, r.sub.review ? "Pay more" : "Pay", inPay, r.sub.id)}
                      </div>
                      </Fold>
                      );
                      })()}
                    </li>
                  ))}
                  {/* (Batch 15 section 31) The Live call part: the total paid for all calls on the right, like the other parts; "held" is now "done". */}
                  {(c.liveRateCents != null || c.calls.length > 0) && (
                    <li className="flex flex-wrap items-center gap-2" data-live-part="">
                      <b className="text-white">Live call</b>
                      <span className={`badge ${c.liveRequired ? "border-amber-300/40 text-amber-200" : ""}`}>{c.liveRequired ? "Required" : "Not required"}</span>
                      <span className={done ? "text-emerald-200" : "text-slate-400"}>{done ? `${done} done` : "None done yet"}</span>
                      <span className="ml-auto whitespace-nowrap text-slate-300">paid {money(callPaid)}</span>
                    </li>
                  )}
                </ul>
                {/* (Batch 18 section 9) Their work ended (left, End early, Stop, a block, a suspension) during a call. (Batch 21) The server ends it; (batch 23) "Waiting to connect" until the two browsers connect. */}
                {c.status !== "working" && c.calls.filter((x) => callInProgress(x, now)).map((x) => (
                  <p key={x.id} id={`call-${x.id}`} className="text-sm" data-in-progress-call=""><span className="text-slate-200">{fmtDateTime(x.startsAt)}</span> <span className="badge border-sky-300/40 text-sky-200">{connectedCalls.has(x.id) ? IN_PROGRESS_DEV : WAITING_TO_CONNECT}</span></p>
                ))}
                {/* (Owner, Nov 5, §209; replaces §186's "Booked (N)", which also listed the calls ahead) The tester's calls that are over in two drop-downs, both
                    closed at first (each opens by itself for a jump into it, and for a call whose charge waits for your bank): "Had (N)", the calls that took place
                    (in any form that can be paid or disputed, a no-show report's 0-minute call too), newest first, each with its length, its payments and its Pay
                    more as before; and "Cancelled (N)": the calls actually cancelled (by either side, or by the app: nobody joined, couldn't connect, the site was
                    down, the test was paused …), newest first, with the length they were booked for and who cancelled and why. The calls ahead (or in progress)
                    are only in the Live session, with Join call and Cancel (as before §186). Call requests never show here. Past 3 rows, each list is the §152
                    draggable panel (§187: the only panel that scrolls; the payments' panels inside it are flat). */}
                {(() => {
                  const had = overCalls.filter((x) => x.status !== "cancelled");
                  const cancelled = overCalls.filter((x) => x.status === "cancelled");
                  if (!had.length && !cancelled.length) return null;
                  const bankIn = (xs: typeof overCalls) => xs.some((x) => bankRows.some((b) => b.pieceId === x.id)) || undefined;
                  const overRow = (x: (typeof overCalls)[number]) => {
                    const m = callMinutesOf(x);
                    const badge = callOverBadge(x, { developer: displayName(u), tester: name }, "developer", fmtTime, partPaid(x.id), m, fmtWhen);
                    const inNeeds = tookPlace(x) && !x.review && !restricted && testerPayable(c.tester) && !payShut(x.id);
                    return (
                      <li key={x.id} id={inNeeds ? `callrow-${x.id}` : `call-${x.id}`} className={`space-y-1 rounded-lg border border-white/5 p-2 ${"scroll-mt-24 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300"}`} data-over-call={x.id}>
                        {/* (Owner, Nov 3) Each call is its own drop-down, like a part: its line, then inside its length, payments and Pay more. */}
                        <Fold id={`row-call-${x.id}`} className="space-y-1" summaryClassName="flex flex-wrap items-center gap-2 !text-sm !font-normal" summary={<>
                          <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                            {/* (Owner, Nov 4, §186) A cancelled call: the length it was booked for. */}
                            {x.status === "cancelled" && <span className="text-slate-400" data-call-booked-length="">· {x.minutes} min</span>}
                          <span className={`badge ${badge.tone === "green" ? "border-emerald-400/40 text-emerald-200" : badge.tone === "amber" ? "border-amber-300/40 text-amber-200" : badge.tone === "rose" ? "border-rose-400/40 text-rose-200" : ""}`} data-call-badge="">{badge.label}</span>
                          {/* (Owner, Nov 4, batch 35 §170) The paid amount once: not repeated here when the badge already reads "paid $15.00". */}
                          <span className="ml-auto text-slate-300" data-call-paid="">{tookPlace(x) && !("paidShown" in badge) ? `paid ${money(partPaid(x.id))}` : ""}</span>
                        </>}>
                        {/* (Owner, Nov 6, §301; replaces §282's two panels) As a part: its "Payments (N)" drop-down (none without payments), the call's details
                            panel, then a separate "Pay more" drop-down ("Pay" before it was paid). */}
                        <div className="space-y-2">
                        {/* (Owner, Nov 3, batch 35 §152) This call's payments (a panel above 4). */}
                        <DisputedPart dispute={x.dispute}><PartPayments id={x.id} lines={partPays.get(x.id)} />
                        <DecisionNote dispute={x.dispute} /></DisputedPart>
                        <div className={`space-y-1 ${PART_PANEL} empty:hidden`} data-part-panel="content">
                          {tookPlace(x) && <p className="text-xs text-slate-400" data-call-length="">{lengthOf(x)} · {x.rateCents == null ? NOT_LISTED : `In ${pronouns(c.tester.pronoun).poss} contract`}</p>}
                          {badge.reason && <ReasonQuote text={badge.reason} />}
                          {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                        </div>
                        {payFold(`row-pay-${x.id}`, x.review ? "Pay more" : "Pay", [
                          inNeeds && <a key="needs" href={`#call-${x.id}`} className="block text-xs">Pay it in Needs you ↑</a>,
                          tookPlace(x) && !x.review && payShut(x.id) && testerPayable(c.tester) && <p key="shut" className="text-xs text-slate-300" data-closed-not-paid="">{closedNotPaidLine(shutOn(x.id))}</p>,
                          x.review?.teamClosedById && <LabeledReason key="team" className="text-sm text-slate-300" data={{ "data-team-closed": "" }} line={TEAM_CLOSED_LABEL} id={`review-note-${x.id}`} text={x.review.reason} />, // (Owner, Nov 6, §281)
                          // (Owner, Nov 6, §311e) An unlisted call closed with $0 at its pay date is final: it says so, and has no Pay more.
                          x.review?.reason === UNLISTED_CALL_CLOSED && <p key="unlisted" className="text-sm text-slate-300" data-unlisted-closed="">{UNLISTED_CALL_CLOSED}</p>,
                          x.review && !x.review.rejected && !restricted && !blockedEither.has(c.testerId) && !x.review.teamClosedById && x.review.reason !== UNLISTED_CALL_CLOSED && payMore(x.id).open && (rooms.get(x.id)?.room ?? 0) > 0 && (
                            <div key="box" className="space-y-1" data-call-pay-more="">
                            <PayBox more={{ testId: t.id, contractId: c.id }} awayInNeeds owes={owesNow} kind="call" id={x.id} name={name} seenAt={seenAt} bankWaits={waitsOf(x.id)} bankWaitsId={waitsIdOf(x.id)} bankWaitsKind={waitsKindOf(x.id)} note={payMore(x.id).line || undefined}
                              room={rooms.get(x.id)?.box} minutes={m ?? x.minutes} rateCents={x.rateCents} warning={callsWarn.get(c.id)}
                              listingCents={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).cents}
                              listingText={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                            </div>
                          ),
                          x.review && !x.review.rejected && !restricted && !x.review.teamClosedById && x.review.reason !== UNLISTED_CALL_CLOSED && payMore(x.id).open && rooms.has(x.id) && (rooms.get(x.id)?.room ?? 0) <= 0 && (
                            <p key="most" className="text-sm text-slate-400" data-paid-most="">{paidMostLine(rooms.get(x.id)!.paid)}</p>
                          ),
                        ].filter(Boolean), x.id)}
                        </div>
                        </Fold>
                      </li>
                    );
                  };
                  return (
                    <div className="space-y-2" data-calls-fold={c.id}>
                      <details open={bankIn(had)} id={`calls-had-${c.id}`} className="scroll-mt-24 rounded-lg border border-white/10 p-2 text-sm" data-calls-had={had.length}>
                        <summary className="fold-chevron cursor-pointer font-medium text-white">Had ({had.length})</summary>
                        <div className="mt-2">
                        {!had.length && <p className="note">No calls took place yet.</p>}
                        <PanelWhen on={had.length > PAST_CALLS_SHOWN} id={`had-calls-${c.id}`} label={`Calls with ${name}`} defaultMax={LIST_PANEL.pastDeveloper}>
                        <ul className="space-y-2" data-calls-history="" data-calls-scroll={had.length > PAST_CALLS_SHOWN ? had.length : undefined}>{had.map(overRow)}</ul>
                        </PanelWhen>
                        </div>
                      </details>
                      <details open={bankIn(cancelled)} id={`calls-cancelled-${c.id}`} className="scroll-mt-24 rounded-lg border border-white/10 p-2 text-sm" data-calls-cancelled={cancelled.length}>
                        <summary className="fold-chevron cursor-pointer font-medium text-white">Cancelled ({cancelled.length})</summary>
                        <div className="mt-2">
                        {!cancelled.length && <p className="note">No cancelled calls.</p>}
                        <PanelWhen on={cancelled.length > PAST_CALLS_SHOWN} id={`cancelled-calls-${c.id}`} label={`Cancelled calls with ${name}`} defaultMax={LIST_PANEL.pastTester}>
                        <ul className="space-y-2" data-calls-history="" data-calls-scroll={cancelled.length > PAST_CALLS_SHOWN ? cancelled.length : undefined}>{cancelled.map(overRow)}</ul>
                        </PanelWhen>
                        </div>
                      </details>
                    </div>
                  );
                })()}
                {/* (Batch 17 §11; batch 35 §80) A waiting charge whose piece isn't listed above: a link up to it in Needs you under the tester's row. */}
                {bankRows.filter((b) => b.contractId === c.id && !(b.pieceId && (partRows.some((r) => r.on && r.sub?.id === b.pieceId) || overCalls.some((x) => x.id === b.pieceId)))).map(bankUp)}
                {termsRows.get(c.id) && <p className="note">{termsRows.get(c.id)}</p>}
                {/* (Owner, Oct 31, batch 35 §33) Only the terms line: the contract changes (renames, a Stop's note…) are still recorded for the tester's own page, never
                    listed under the developer's row. */}
                {/* (Batch 13 section 8) Earlier SENT sets this tester replaced after switching to changed questions. */}
                {/* (Owner, Nov 5, §234) The earlier sets' folds are gone; (§263) their answers no thread holds are in the written part's one list, tagged "Old question". */}
                {/* (Owner, Nov 3, §166) No "On <name>'s profile: “…”" lines here any more: the excerpts stay on the tester's profile (and the requests in Needs you). */}
                {/* (Batch 11, DEFAULT) A tester who deleted their account with no payout account: their unreviewed work left Needs you. */}
                {!testerPayable(c.tester) && (c.submissions.some((x) => !x.review) || c.calls.some((x) => tookPlace(x) && !x.review)) && <p className="note" data-deleted-no-payouts="">{deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null }), c.tester.pronoun)}</p>}
                {/* (Owner, Nov 6, §283; was under the written answers, in their content panel) The Terms history sits at the very bottom of the tester's
                    drop-down, below all their part panels (written answers, recording, calls and their Pay panels). */}
                {/* (Owner, Nov 5, §263) The tester's Terms history for the questions, as on their session page: each change, Then (with what they SENT for
                    each question, never a draft) → Now, the files drawn from this part's uploads. */}
                {((hist) => (hist.length > 0 || (participationHistory.get(c.id)?.length ?? 0) > 0) && (
                  <details className="mt-2 space-y-2 text-sm" data-terms-history="" data-dev-terms-history={c.id}>
                    <summary className="fold-chevron cursor-pointer font-medium text-white">Terms history</summary>
                    <OwnPanel><ResizeBox id={`dev-terms-history-${c.id}`} label="Terms history">
                      <ul className="space-y-1.5 text-slate-300">{[...hist.map((q) => ({ at: new Date(q.at), id: `q-${q.at}`, node: <QuestionsChangedEntry key={q.at} id={`dev-history-q-${c.id}-${new Date(q.at).getTime()}`} change={q} files={writtenSub?.recordings ?? []} timeZone={u.timeZone} /> })), ...(participationHistory.get(c.id) ?? []).map((e) => ({ at: e.at, id: e.id, node: <li key={e.id} data-participation-history="">{fmtDateTime(e.at)}: {e.label}{e.value && <>: <span className="break-all">{e.value}</span></>}</li> }))].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).map((e) => e.node)}</ul>
                    </ResizeBox></OwnPanel>
                  </details>
                ))(writtenSub ? questionChanges(c.prevSets, writtenQuestions(c), writtenSub, { drafts: false }) : [])}
                </Fold>
                <div className="space-y-1" data-tester-summary="">
                  <div className="flex flex-wrap items-center gap-2">
                    {!restricted && <a href={`/app/chat/${c.id}`} className="btn-secondary relative px-3 py-1 text-xs no-underline hover:no-underline"><MessagesSquare className="h-3.5 w-3.5" /> Chat
                      {unreadN > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unreadN} unread`}>{unreadN}</span>}
                    </a>}
                    {/* (Owner, Nov 3, §166) No "See her profile": the name above is the link. */}
                  </div>
                  {/* (Owner, Nov 4, §195) What was paid is no longer a line here: it is shown once, on the right of the name row. (Owner, Nov 6, §301) Nor the
                      calls line ("Calls: 3 cancelled"): the Live call part shows Had (N) and Cancelled (N), and the calls ahead are in the Live session (§209). */}
                  {/* (Owner, Nov 3, §166) No "<name>: 1.0 ★ (1 rating)" line here any more: the circle's hover card and the profile show the rating. */}
                  {ri?.tester && (ri.testerRevealed ? (
                    // (Owner, Nov 5, §237) The line stays; the comment is in its reason box under it.
                    <div className="note" data-rated-you=""><NameLink text={name} href={personHref} /> rated you: {ri.tester.stars} ★{ri.tester.comment && <ReasonQuote id={`rated-you-${c.id}`} label="Their comment" text={ri.tester.comment} className="mt-1" />}</div>
                  ) : (
                    <p className="note"><NameLink text={name} href={personHref} /> rated you: you&apos;ll see it after you rate {pronouns(c.tester.pronoun).obj} (or on {fmtDate(ri.revealOn!)}).</p>
                  ))}
                  {ri?.developer && <p className="note">You rated <NameLink text={name} href={personHref} />: {ri.developer.stars} ★</p>}
                  {!restricted && rateBoxOf(c)}
                  {blockedIds.has(c.testerId) && <p className="note">You blocked <NameLink text={name} href={personHref} />. Unblock in Account → Blocked people.</p>}
                </div>
              </div>
            );
          })}
        </RowsBox>
      )}
      </TestersJoined>
      {cbSteps && <ChargebackSteps steps={cbSteps} />}
      {/* (Owner, Nov 5, §227; was OwedBox here) Pay what you owe never shows on the test page: it is on Payments (and the dashboard, and the bell). A failed
          payment owed before any pause: one line linking there (the paused banner links there itself). */}
      {!u.holdStartedAt && !u.devSuspendedAt && owedList.length > 0 && <p className="info text-sm" data-owed-on-payments="">A payment didn&apos;t go through, so you owe it. <PayOwedLink /></p>}
      {soon && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(t.title, t.openUntil!, new Date(), "developer")}</p>}
      <DevCallPanel
        leadMinutes={CALL_MIN_AHEAD_MINUTES}
        end={callEndProps(callEnd)}
        testId={t.id}
        seenAt={seenAt}
        canRequest={t.status !== "stopped" && t.status !== "draft" && !u.holdStartedAt && !restricted}
        noRequestReason={t.status === "stopped" ? "" : u.holdStartedAt ? `${pausedUntil(u.holdReason === "chargeback")}: calls wait meanwhile.` : ""}
        testers={restricted ? devTesters.map((x) => ({ ...x, requests: [] })) : devTesters}
        elsewhere={otherCalls}
      />
      {/* (Owner, Nov 5, §229; was right under Needs you, §181) Call requests sit right under the Live session panel. (§185) Two boxes: "Requests to you" (Needs
          you's "2 call requests ↓" lines jump here) and "Your requests". (Owner, Nov 5, §228 fix) Always drawn: it draws nothing with no request, and keeps a
          request the page just dropped for its 6 seconds. */}
      <CallRequestsBox testId={t.id} seenAt={seenAt} requests={callRequests} leadMinutes={CALL_MIN_AHEAD_MINUTES} />
      {!t.workEndedAt && t.status !== "stopped" && !restricted && (
        <InvitePanel
          testId={t.id}
          userId={u.id}
          seenAt={seenAt}
          options={{ devices: t.devices, languages: t.languages }}
          perks={perks}
          // (Batch 20 section 10) Full, paused or joining closed: Invite is disabled with its line (the page's poll brings a spot opening or filling); Open until
          // passing while the page is open closes it at that moment.
          blocked={inviteBlocked({ ...t, testersIn: working.length, paused: !!u.holdStartedAt, chargeback: u.holdReason === "chargeback" }, now, fmtDate)}
          closes={t.openUntil && t.openUntil > now ? { at: t.openUntil.toISOString(), line: inviteBlocked({ ...t, testersIn: working.length, paused: !!u.holdStartedAt, chargeback: u.holdReason === "chargeback" }, new Date(t.openUntil.getTime() + 1000), fmtDate)?.line ?? "" } : undefined}
          initial={invitePanelData ?? { worked: [], suggested: [], found: [], foundTotal: 0, capLine: "", searched: false }}
          sent={expired ? [] : invites.filter((i) => i.status === "sent").map((i) => ({ id: i.id, testerId: i.testerId, name: people.get(i.testerId) ?? "?", status: `waiting for ${pronouns(inviteUsers.find((x) => x.id === i.testerId)?.pronoun).obj} to join`, ...inviteInfo.get(i.testerId)! }))}
        />
      )}

      <section className="space-y-3">
        <ByQuestion testId={t.id} timeZone={u.timeZone}
          blocks={byQuestion(
            (t.questions as string[]) ?? [],
            t.contracts.flatMap((c) =>
              c.submissions
                .filter((s) => s.kind === "written")
                .map((s) => ({
                  // (Batch 13 section 8) Grouped by the exact text of the question each answer was sent for.
                  // (Batch 35 §136) The latest answers per question. (§167) What was added to a question follows its answer, dated; (Owner, Nov 4, §188) Anything else last: the notes and what was added there, dated.
                  // (Owner, Nov 5, §263) Only the tester's current questions: an old one is in their Terms history.
                  ...((w) => ({ questions: w.items.map((i) => qStored(i.question, i.required)), answers: w.answers, notes: w.notes }))(answersByQuestion(s, writtenQuestions(c), (at) => fmtStampIn(at, u.timeZone), writtenQuestions(c))),
                  contractId: c.id, tester: displayName(c.tester), sentAt: s.updatedAt,
                  attachments: s.recordings.filter((r) => r.uploadedAt).map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType })),
                  status: (!s.review ? "waiting" : s.review.rejected && !(s.dispute?.decidedCents) ? "rejected" : "paid") as "paid" | "rejected" | "waiting",
                  paidCents: Math.max(s.review?.amountCents ?? 0, s.dispute?.decidedCents ?? 0),
                })),
            ),
          )}
        />
      </section>
    </SeeItTarget>
  );

  });
}
