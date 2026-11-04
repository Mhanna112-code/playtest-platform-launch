import { NameLink } from "@/components/Cut";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtTimeIn } from "@/lib/format";
import { hasPerks } from "@/lib/server/subscription";
import { CALL_MIN_AHEAD_MINUTES } from "@/lib/callLead";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDateIn, fmtDateTimeIn, fmtStampIn, money, pronouns } from "@/lib/server/dateFormat";
import { IN_PROGRESS_DEV, WAITING_TO_CONNECT, callInProgress, chargeOpensAt, callJoinable, bookedLateLabel, isBookedLate, callReference, cancelNeedsReason, chargeAmount, choiceNoteLine, closesInLine, termsLine, paidZeroLine } from "@/lib/rules";
import { callIsOver, callLengthLine, callMinutesOf, callOverBadge, MEASURING_LINE } from "@/lib/callMeasure";
import { callsLeftCents } from "@/lib/server/callMoney";
import { callsLeftWarning } from "@/lib/callMeasure";

import { ReasonQuote } from "@/components/ScrollText";
import { requireOpenPage } from "@/lib/server/page-auth";
import { PageLoaded } from "@/components/PageLoaded";
import { devRestricted } from "@/lib/restricted";
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
import { callEndProps, devRateLabel, pageRows, rateLabel } from "@/lib/server/requests";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeSide } from "./DisputeSide";
import { OwedBox } from "@/components/OwedBox";
import { HOLD_APPROVAL_AFTER, inviteBlocked, rateNeedsLine, NOT_LISTED, callListed, deletedNoPayoutsLine, joiningClosedLine, closeOutSoon, closedNotPaidLine, payClosesLine, testerPayable, stopReasonOf, workDeadlineOf } from "@/lib/rules";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { PayBox } from "./PayBox";
import { CONFIRM_WITH_BANK, autoChargeLine, bankAnchor, joinerDays, paidMostLine, pausedUntil } from "@/lib/rules";
import { closedOut, payMoreClosesAt, pieceCloseOut } from "@/lib/server/closeOut";
import { BankWaiting } from "@/components/BankWaiting";
import { bankWaitingOnTest } from "@/lib/server/confirm";
import { ListingPanel } from "./ListingPanel";
import { ListingSeeIt, SeeItTarget } from "@/components/ListingInfo";
import { panelRows } from "@/lib/listingPanel";
import { lastListingSave } from "@/lib/server/listingPanel";
import { Fold, ResizeBox } from "@/components/Panel";
import { SentWork } from "@/components/SentWork";
import { additionsOf, answersByQuestion } from "@/lib/additions";
import { bankWaitsLine, pieceOf, pieceRoom } from "@/lib/server/payments";
import { TopPanel } from "./TopPanel";
import { NeedsYou } from "./NeedsYou";
import { KeysNotice } from "./KeysNotice";
import { keyBoxes } from "@/lib/server/accessKeys";
import { SavedNote } from "@/components/SavedNote";
import { TestersJoined } from "./TestersJoined";
import { ChatWithButton } from "@/components/ChatWithButton";
import { ClampText } from "@/components/ClampText";
import { RowsBox } from "./RowsBox";
import { testerStats } from "@/lib/server/profileStats";
import { ByQuestion } from "./ByQuestion";
import { LIST_PANEL, PAST_CALLS_SHOWN, PanelWhen } from "@/components/ScrollList";
import { PartPayments } from "@/components/PartPayments";
import { partPaymentLines } from "@/lib/server/partPayments";
import { byQuestion } from "@/lib/byQuestion";
import { PrevSetFolds } from "@/components/AnswerSets";
import { prevSetsOf } from "@/lib/answerSets";
import { qStored } from "@/lib/questions";
import { pendingForDeveloper } from "@/lib/server/excerpts";
import { ExcerptQuestion, ExcerptReplaces } from "@/components/ExcerptList"; // (batch 16 section 37) the question above each excerpt request
import { ExcerptDecision } from "@/components/Excerpts";
import { UPDATED_AT_CAP, pieceDay, teamClosedLine, updateRowLine, updateWaiting } from "@/lib/moneyLines";

import { testV } from "@/lib/server/pulseV";
import { otherSideNotice } from "@/components/OtherSideNotice";
export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ failed?: string; saved?: string; offered?: string; skipped?: string; closed?: string; resent?: string; spotclosed?: string; spots?: string }> }) {
  const { id } = await params;
  // First: a restricted developer may open a test page only in its restricted view (batch 15 section 29); every other page sends them to the dashboard top.
  const u = await requireOpenPage(`/app/tests/${id}`);
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
  const fmtTime = (d: Date | string) => fmtTimeIn(d, u.timeZone);
  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
  await (await import("@/lib/server/confirm")).expireActions(new Date(), { developerId: u.id });
  await (await import("@/lib/server/recovery")).checkStuck({ testId: id }); // (batch 15 section 9) payments stuck "in progress"
  const { saved, offered, skipped, closed, resent, failed } = await searchParams;
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
  // (Owner, Oct 30, batch 15 sections 23, 29 and 37) ANY pause (the team's, a payment or chargeback hold, a developer-side suspension) shows the restricted view: the
  // overview with Stop and End early, Booked calls with Cancel, the excerpt requests and the disputes. Only the banner's title and reason differ by cause.
  const accountPaused = devRestricted(u, "developer");
  const teamPaused = !!t.adminPausedAt && t.status !== "stopped";
  const restricted = accountPaused || teamPaused;
  const bannerCause: BannerCause | null = t.adminStoppedAt ? "team-stopped" : teamPaused ? "team-paused" : u.devSuspendedAt ? "suspended" : u.holdStartedAt ? (u.holdReason === "chargeback" ? "chargeback" : "hold") : t.status === "stopped" ? "stopped" : null;
  const bannerCauseReason = bannerCause === "team-paused" || bannerCause === "team-stopped" ? t.adminNote : bannerCause === "suspended" ? u.devSuspendNote : "";
  const keysEver = await db.accessKey.count({ where: { testId: id } });
  const keysLeft = keysEver > 0 ? await db.accessKey.count({ where: { testId: id, status: "free" } }) : null;
  const working = t.contracts.filter((c) => c.status === "working");
  // (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (every tester's deadline, no earlier than Open until): no call time later. The request form's
  // time box stops there, its calls drop-down offers only what fits, and a waiting request's words say how many calls it covers.
  const callEnd = t.workEndedAt ?? workDeadlineOf(t, t.contracts);
  const paid = await db.payment.groupBy({ by: ["contractId"], where: { contractId: { in: t.contracts.map((c) => c.id) }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  const paidSoFar = (id: string) => paid.find((p) => p.contractId === id)?._sum.amountCents ?? 0;
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
    return { id: a.id, kind: a.kind, line: old ? rejoinAskLine(displayName(x), pronouns(x.pronoun), old, u.timeZone) : undefined, userId: x.id, name: displayName(x), note: a.note, ...appInfo.get(x.id)! };
  });
  // (NEXT-UI 4) Chat is its own page per session: each tester's row links to it with an unread badge.
  const unread = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await unreadCount(u.id, t.id, c.testerId)] as const)));
  const blockedIds = new Set((await db.block.findMany({ where: { blockerId: u.id } })).map((b) => b.blockedId));
  const [invitePanelData, invites, owedList] = await Promise.all([restricted || t.status === "stopped" ? null : invitePanel(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owedForBox(u.id)]);
  const inviteUsers = await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } }, include: { profile: true } });
  const people = new Map(inviteUsers.map((x) => [x.id, displayName(x)]));
  const inviteInfo = await testerRowInfo(u.id, t, inviteUsers);
  const expired = inviteExpired(t);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const now = new Date();
  // (Batch 17 §19, replacing batch 16 section 22) Pay more closes together with the last Pay / Charge on the test (payMoreClosesAt); in its
  // last 7 days the box says "Pay more closes on <date>.".
  const payMoreAt = await payMoreClosesAt(t.id, now);
  const payMore = { open: !closedOut(payMoreAt, now), line: closeOutSoon(payMoreAt, now) ? payClosesLine(fmtDate(payMoreAt!), true) : "" };
  // (Owner, Oct 26) A chargeback hold's steps. (A paused test's closing date is told by bell and shown to the admin, not on the page.)
  const cbSteps = await chargebackSteps(u.id);
  // (Batch 17 §11) Charges made while the developer was away that their bank wants confirmed: "Confirm with your bank" under the affected piece (Payments and the bell link here).
  const bankRows = await bankWaitingOnTest(u.id, t.id);
  const confirmingPays = await db.payment.findMany({ where: { developerId: u.id, contractId: { in: t.contracts.map((c) => c.id) }, kind: { in: ["review", "call"] }, status: "needs_action" }, select: { id: true, submissionId: true, callId: true } });
  const confirmingPay = (id: string) => confirmingPays.find((p) => (p.submissionId ?? p.callId) === id)?.id;
  // (Owner, Nov 3, §159) Pay more waits while a payment on its part waits for the bank: its box is greyed with the line saying which.
  const bankWaits = new Map<string, string>();
  for (const w of await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) }, kind: { in: ["review", "call", "extra", "dispute"] }, status: { in: ["needs_confirmation", "needs_action"] }, settledAt: null }, select: { submissionId: true, callId: true, contractId: true } })) {
    const piece = w.submissionId ?? w.callId;
    const c = t.contracts.find((x) => x.id === w.contractId);
    if (piece && c && !bankWaits.has(piece)) bankWaits.set(piece, (await bankWaitsLine(db, { submissionId: w.submissionId, callId: w.callId }, displayName(c.tester))) ?? "");
  }
  const waitsOf = (id: string) => bankWaits.get(id) || undefined;
  // (Batch 23 section 9) "Confirm with your bank" stops once like Pay: it sends this page's seen marker.
  // (Owner, Oct 31, batch 35 §80) Confirmed in Needs you (where the dashboard's box, Payments and the bell link); under the piece only a link up to it.
  const bankAt = (pieceId: string) => bankRows.filter((b) => b.pieceId === pieceId).map((b) => restricted ? <BankWaiting key={b.id} paymentId={b.id} cents={b.cents} line={b.line} full={b.full} seenAt={seenAt} /> : <a key={b.id} href={`#${bankAnchor(b.id)}`} className="block text-xs" data-bank-up={b.id}>{CONFIRM_WITH_BANK} in Needs you ↑</a>);
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
  // (Batch 15 section 34) What's left of the $1,000 for each tester's calls, and the small warning when under an hour (or under $200 unlisted).
  const callsLeft = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await callsLeftCents(c.id)] as const)));
  // (Batch 17 §19) Each unpaid piece's Pay closes on its own date (the test's close-out, or 14 days after its Charge opened if later): then it leaves Needs you and its
  // place reads "Closed on <date>: not paid."; in its last 7 days its Needs you row says "Pay closes on <date>.".
  const unpaidKeys: { submissionId?: string; callId?: string }[] = t.contracts.flatMap((c) => [...c.submissions.filter((x) => !x.review).map((x) => ({ submissionId: x.id })), ...c.calls.filter((x) => tookPlace(x) && !x.review).map((x) => ({ callId: x.id }))]);
  const payCloses = new Map(await Promise.all(unpaidKeys.map(async (k) => [k.submissionId ?? k.callId!, await pieceCloseOut(k, "developer", now)] as const)));
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
  // The developer's live-call panel: one row per working tester (terms like the parts listing) and their calls/requests.
  const whole = (c: number | null) => money(c).replace(/\.00$/, "");
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
    const toCall = (x: (typeof c.calls)[number]): DevCall => ({ id: x.id, joinable: callJoinable(x, now), report: x.noShowBy ? { byMe: x.noShowBy === "developer", note: x.noShowNote } : null, when: x.startsAt.toISOString(), minutes: x.minutes, rate: rateLabel(x.rateCents, c.liveRateCents), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, reported: !!x.noShowBy, late: lateOf(c, x), measuring: x.startsAt <= now ? (restricted ? (connectedCalls.has(x.id) ? IN_PROGRESS_DEV : WAITING_TO_CONNECT) : MEASURING_LINE) : undefined }); // (batch 18 section 9) a pause doesn't cut a call in progress
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
    const booked = new Set(c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => x.setId ?? x.id)).size;
    return {
      contractId: c.id, name: displayName(c.tester), testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, terms, booked, warning: callsWarn.get(c.id) ?? "",
      calls: live.filter((x) => !x.setId).map(toCall),
      sets,
      // (Batch 16 section 33) Their waiting requests and yours, as they arrive (answered in the Call requests panel).
      pending: reqs.filter((r) => r.contractId === c.id).length, leftCents: callsLeft.get(c.id) ?? null, rateCents: callListed(t, c) ? c.liveRateCents : null,
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
    return c ? [{ id: r.id, contractId: c.id, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, name: displayName(c.tester), rows: pageRows(r, callEnd), minutes: r.minutes, rate: devRateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents, t.liveRateCents, c.tester.pronoun), warning: callsWarn.get(c.id) }] : [];
  });
  // (Batch 35 §162) "her written answers", "Her reason": the tester's recorded pronoun.
  const disputesWaiting = t.contracts.flatMap((c) => [
    ...c.submissions.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, name: displayName(c.tester), Poss: pronouns(c.tester.pronoun).Poss, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, what: `${pronouns(c.tester.pronoun).poss} ${x.kind === "written" ? "written answers" : "recording"}`, reason: x.dispute!.reason })),
    ...c.calls.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, name: displayName(c.tester), Poss: pronouns(c.tester.pronoun).Poss, testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, what: `the call on ${fmtDateTime(x.startsAt)}`, reason: x.dispute!.reason })),
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
  const bookedAhead = t.contracts.flatMap((c) => c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => ({ id: x.id, who: displayName(c.tester), whoHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, when: x.startsAt.toISOString(), minutes: x.minutes, needsReason: cancelNeedsReason(x.startsAt, now) }))).sort((a, b) => a.when.localeCompare(b.when));
  const banner = bannerCause ? (
    <TestBanner cause={bannerCause} reason={bannerReason} failed={failed}
      allowed={restricted ? allowedLine(true, { stop: t.status !== "stopped", endEarly: t.status !== "stopped" && working.length > 0, cancelCalls: bookedAhead.length > 0, rate: !accountPaused && t.contracts.some((c) => rateStates.get(c.id)?.kind === "open") }) : allowedLine(false, { nextRound: !t.adminStoppedAt })} />
  ) : null;
  if (restricted) {
    const restrictedNeeds = bankRows.length + bookedAhead.length + excerptReqs.length + (!accountPaused ? t.contracts.filter((c) => rateBoxOf(c)).length : 0) + disputesWaiting.length;
    return (
      <>
        <AutoRefresh query={`test=${t.id}`} v={pageV} />
        {banner}
        <TopPanel timeZone={u.timeZone}
          id={t.id} title={t.title} productName={t.productName} ignoredAlerts={t.ignoredAlerts} restricted mature={t.mature} nda={!!t.ndaText} keysLeft={null}
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
        {restrictedNeeds > 0 && <NeedsYou count={restrictedNeeds}>
          {/* (Batch 17 §11) A charge made while away (e.g. a retry during the pause) that the bank wants confirmed: confirmed here, each line naming its piece. */}
          {bankRows.length > 0 && (
            <section className="space-y-2" data-restricted-bank="">
              <h2 className="font-semibold text-white">Your bank wants you to confirm</h2>
              {bankRows.map((b) => <BankWaiting key={b.id} paymentId={b.id} cents={b.cents} line={b.line} full={b.full} seenAt={seenAt} />)}
            </section>
          )}
          {bookedAhead.length > 0 && <RestrictedCalls testId={t.id} seenAt={seenAt} calls={bookedAhead} embedded />}
          {/* (Batch 15 section 39) Excerpts go through anything: Allow / Deny (hidden while the test has an NDA, as always). (Batch 29 section 30) No Take down: only the tester removes an excerpt. */}
          {excerptReqs.length > 0 && (
            <section className="space-y-2" data-restricted-excerpts="">
              <h2 className="font-semibold text-white">Excerpts</h2>
              {excerptReqs.map((x) => (
                <div key={x.id} id={`excerpt-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm" data-excerpt-request="">
                  {/* (Owner, Nov 3, batch 35 §140) Each request its own fold: the one-line summary, then (open) the full content in a panel; its buttons stay under it. */}
                  <Fold id={`needs-excerpt-${x.id}`} summary={<span className="text-slate-300"><b className="text-white">Excerpt request</b> · <NameLink text={x.tester} href={x.testerHref} /> would like to show this on {x.testerPoss} profile</span>}>
                  <ResizeBox id={`excerpt-${x.id}`} label="Excerpt request">
                    {x.ndaNote && <p className="note" data-excerpt-nda="">{x.ndaNote}</p>}
                    <ExcerptQuestion question={x.question} />
                    <ClampText text={`“${x.text}”`} className="text-slate-200" />
                    <ExcerptReplaces texts={x.replaces} />
                  </ResizeBox>
                  </Fold>
                  <ExcerptDecision excerptId={x.id} seenAt={seenAt} />
                </div>
              ))}

            </section>
          )}
          {/* (Batch 17 section 14) A test the team paused (nobody held or suspended): the developer still rates, straight through. */}
          {!accountPaused && t.contracts.some((c) => rateBoxOf(c)) && (
            <section className="space-y-2" data-restricted-rate="">
              <h2 className="font-semibold text-white">Rate your testers</h2>
              {t.contracts.map((c) => rateBoxOf(c))}
            </section>
          )}
          {/* (Batch 15 section 27) The developer's side of a dispute: optional, never stopped, works while paused or restricted. */}
          {disputesWaiting.length > 0 && (
            <section className="space-y-2" data-restricted-disputes="">
              <h2 className="font-semibold text-white">Disputes: add your side</h2>
              <div className="space-y-2">
                {disputesWaiting.map((d) => (
                  <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
                    <Fold id={`needs-dispute-${d.id}`} summary={<span className="text-slate-300"><b className="text-white"><NameLink text={d.name} href={d.testerHref} /></b> disputed what you paid for {d.what} · waiting for the team</span>}>
                    <ResizeBox id={`dispute-${d.id}`} label={`${d.Poss} reason`}><ReasonQuote text={d.reason} /></ResizeBox>
                    </Fold>
                    <DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </NeedsYou>}
        {shownEx.length > 0 && <section className="card space-y-2" aria-label="Shown excerpts">
            {shownEx.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm" data-shown-excerpt="">
                <span className="min-w-0 flex-1"><span className="text-slate-400">On a tester&apos;s profile: </span><ClampText text={`“${e.text}”`} className="text-slate-200" /></span>
              </div>
            ))}
        </section>}
      </>
    );
  }
  // (Owner, Oct 28, batch 20 section 24) Each open Rate in Needs you: "Rate ff · 14 days left", linking to that tester's Rate box (the page's poll brings it).
  const rateNeeds = restricted ? [] : t.contracts.flatMap((c) => {
    const st = rateStates.get(c.id);
    return st?.kind === "open" && st.endsAt ? [{ id: c.id, line: rateNeedsLine(displayName(c.tester), st.endsAt, now) }] : [];
  });
  // (Batch 30 §2) Updated versions sent after a piece was paid, below its cap while Pay more is open: each its own Needs you row with the piece's Pay more box.
  const updates = restricted || !payMore.open ? [] : t.contracts.filter((c) => testerPayable(c.tester)).flatMap((c) => c.submissions.filter((x) => updateWaiting(x) && (rooms.get(x.id)?.room ?? 0) > 0).map((x) => ({ c, s: x })))
    .sort((a, b) => a.s.paidUpdateAt!.getTime() - b.s.paidUpdateAt!.getTime());
  const needsCount = bankRows.length + updates.length + pieces.length + apps.length + needsRequests.length + disputesWaiting.length + excerptReqs.length + rateNeeds.length;
  return (
    // (Batch 34 §14) Every stop box under any button on this page: a listing line's See it goes to the Listing panel.
    <SeeItTarget target="#listing">
      <AutoRefresh query={`test=${t.id}`} v={pageV} />
      {t.workEndedAt && <p className="info" data-work-ended="">This test ended on {fmtDate(t.workEndedAt)}. You can still pay for work already sent and use the remaining rating and dispute windows.</p>}
      <TopPanel timeZone={u.timeZone}
        id={t.id}
        title={t.title}
        productName={t.productName}
        ignoredAlerts={t.ignoredAlerts}
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
        <NeedsYou count={needsCount}>
          {bankRows.map((b) => <BankWaiting key={b.id} paymentId={b.id} cents={b.cents} line={b.line} full={b.full} seenAt={seenAt} />)}
          <Applications needs={{ devices: t.devices, languages: t.languages }} testId={t.id} seenAt={seenAt} apps={apps} />
          <NeedsRequests testId={t.id} seenAt={seenAt} requests={needsRequests} />
          {rateNeeds.map((r) => <p key={`rate-need-${r.id}`} className="text-sm" data-rate-need={r.id}><a href={`#rate-${r.id}`}>{r.line}</a></p>)}
          {excerptReqs.map((x) => (
            <div key={x.id} id={`excerpt-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm scroll-mt-24" data-excerpt-request="">
              {/* (Owner, Nov 3, batch 35 §140) Each request its own fold: the one-line summary, then (open) the full content in a panel; its buttons stay under it. */}
              <Fold id={`needs-excerpt-${x.id}`} summary={<span className="text-slate-300"><b className="text-white">Excerpt request</b> · <NameLink text={x.tester} href={x.testerHref} /> would like to show this on {x.testerPoss} profile</span>}>
              <ResizeBox id={`excerpt-${x.id}`} label="Excerpt request">
                {x.ndaNote && <p className="note" data-excerpt-nda="">{x.ndaNote}</p>}
                <ExcerptQuestion question={x.question} />
                <ClampText text={`“${x.text}”`} className="text-slate-200" />
                <ExcerptReplaces texts={x.replaces} />
              </ResizeBox>
              </Fold>
              <ExcerptDecision excerptId={x.id} seenAt={seenAt} />
            </div>
          ))}
          {disputesWaiting.map((d) => (
            <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <Fold id={`needs-dispute-${d.id}`} summary={<span className="text-slate-300"><b className="text-white"><NameLink text={d.name} href={d.testerHref} /></b> disputed what you paid for {d.what} · waiting for the team</span>}>
              <ResizeBox id={`dispute-${d.id}`} label={`${d.Poss} reason`}><ReasonQuote text={d.reason} /></ResizeBox>
              </Fold>
              <DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />
            </div>
          ))}
          {[...new Set(pieces.map((x) => x.c.id))].map((cid) => {
            const mine = pieces.filter((x) => x.c.id === cid);
            const who = displayName(mine[0].c.tester);
            return (
              <details key={cid} open className="rounded-xl border border-white/10 p-2" data-needs-person={who}>
                {/* (Owner, Nov 3, long text) A long name wraps beside the arrow (never past the box); the count follows it, kept on one line. (Owner, Nov 3) The name is the
                    tester's link (green), shown here only, not again on each part. */}
                <summary className="fold-chevron flex cursor-pointer items-center gap-2 text-sm font-medium text-white"><span className="min-w-0 [overflow-wrap:anywhere]"><NameLink text={who} href={mine[0].c.tester.deletedAt ? null : `/app/testers/${mine[0].c.testerId}`} /> <span className="whitespace-nowrap font-normal text-slate-400">· {mine.length} part{mine.length === 1 ? "" : "s"} to pay</span></span></summary>
                {/* (Owner, Nov 3) Each name's drop-down is its own panel holding all their parts (it scrolls inside; the grip drags it taller). */}
                <div className="mt-2">
                <ResizeBox id={`needs-person-${cid}`} label={`${who}'s parts`} defaultMax="min(30rem, 60vh)">
                <div className="space-y-3">
          {mine.map((x) => (
            <div key={x.id} id={x.kind === "sub" ? `piece-${x.id}` : `call-${x.id}`} className="rounded-lg border border-white/10 p-3 scroll-mt-24">
              {/* (Owner, Nov 3) Each part is its own drop-down (open at first): its line, then inside its payments, the answers or recordings, and its Pay box. */}
              <Fold id={`needs-part-${x.id}`} className="space-y-2" summaryClassName="!text-sm" summary={<span className="font-medium">
                {/* (Owner, Nov 3) The tester's name (their link) is on the fold above, once; each part starts with what it is. */}
                {x.kind === "sub" ? (x.s!.kind === "written" ? "Written answers" : "Recording") : "Live call"} · {x.kind === "sub" ? `${additionsOf(x.s!.additions).length ? "updated" : "sent"} ${fmtDateTime(x.s!.updatedAt)}` : `${fmtDateTime(x.x!.startsAt)} · ${x.x!.minutes} min booked`} · {(x.kind === "sub" ? x.s!.agreedCents : x.x!.rateCents) == null ? NOT_LISTED : `In ${pronouns(x.c.tester.pronoun).poss} contract`}
              </span>}>
              {/* (Batch 17 §19) The last 7 days before close-out. */}
              {paySoon(x.id) && <p className="note" data-pay-closes="">{payClosesLine(paySoon(x.id))}</p>}
              {/* (Owner, Nov 3, batch 35 §152) Any payment already made on it (e.g. one declined or waiting for your bank). */}
              <PartPayments id={x.id} lines={partPays.get(x.id)} />
              {x.kind === "sub" ? (
                <>
                  {/* (Owner, Nov 3, batch 35 §139; was batch 10's 16-line box) Inside the part's drop-down: the answers or recordings in a small panel (about 12rem)
                      that drags taller or shorter and scrolls inside, so the Pay box under it is in view; then the Pay box. */}
                  <ResizeBox id={`needs-${x.s!.id}`} label={x.s!.kind === "written" ? "Written answers" : "Recordings"}>
                    {/* (Batch 13 section 8) What was last sent, under the questions it answered; an earlier set says so (reviewed and paid at the price it was sent at). */}
                    {x.s!.kind === "written" && x.s!.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(x.s!.setUntil)}</p>}
                    <SentWork id={`needs-${x.s!.id}`} timeZone={u.timeZone} kind={x.s!.kind} answers={x.s!.answers} questions={writtenQuestions(x.c)} notes={x.s!.notes} additions={x.s!.additions} files={x.s!.recordings} />
                  </ResizeBox>
                  <p className="text-sm font-medium text-white">Pay</p>
                  <PayBox owes={owesNow} key={x.s!.id} kind="submission" id={x.s!.id} name={displayName(x.c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(x.c.id)} room={rooms.get(x.s!.id)?.box} confirming={confirmingPay(x.s!.id)}
                    /* (Batch 30 §3) Late work never opens Charge: no "<tester> can charge" line. */
                    note={x.s!.agreedCents != null && !x.s!.late && chargeOpensAt(x.s!, t, x.c, now) && !x.s!.choiceOfferedAt ? choiceNoteLine(pieceDay(chargeOpensAt(x.s!, t, x.c, now)!, u.timeZone), displayName(x.c.tester), chargeAmount(x.s!.agreedCents, partPaid(x.s!.id)), pronouns(x.c.tester.pronoun).poss) : undefined}
                    listingCents={x.s!.agreedCents} listingText={`${money(x.s!.agreedCents)} for ${x.s!.kind === "written" ? "written answers" : "a recording"}`} />
                </>
              ) : (
                <>
                  {/* (Batch 15 section 40) The measured length: "Length: 29 min (both in the call 2:21–2:50 PM)"; a lowered one says so, with the reason. */}
                  <p className="text-sm text-slate-200" data-call-length="">{lengthOf(x.x!)}</p>
                  {x.x!.actualMinutes != null && x.x!.lengthNote && <ReasonQuote text={x.x!.lengthNote} />}
                  <p className="text-sm font-medium text-white">Pay</p>
                  <PayBox owes={owesNow} key={`${x.x!.actualMinutes ?? 0}`} kind="call" id={x.x!.id} name={displayName(x.c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(x.c.id)} room={rooms.get(x.x!.id)?.box} confirming={confirmingPay(x.x!.id)}
                    /* (Owner, Oct 29, batch 28 §21) A listed call is charged automatically 7 days after it if it is not paid. */
                    note={x.x!.rateCents != null && x.x!.payBy && x.x!.payBy > now ? autoChargeLine(pieceDay(x.x!.payBy, u.timeZone), Math.min(callReference(x.x!.rateCents, callMinutesOf(x.x!)!).cents ?? 0, callsLeft.get(x.c.id) ?? Infinity), callMinutesOf(x.x!)!, x.x!.rateCents) : undefined}
                    minutes={callMinutesOf(x.x!)!} rateCents={x.x!.rateCents} warning={callsWarn.get(x.c.id)}
                    listingCents={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).cents}
                    listingText={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                </>
              )}
              </Fold>
            </div>
          ))}
                </div>
                </ResizeBox>
                </div>
              </details>
            );
          })}
          {updates.map(({ c, s: x }) => (
            <div key={`update-${x.id}`} id={`update-${x.id}`} className="rounded-lg border border-white/10 p-3 scroll-mt-24" data-update-row={x.id}>
              <Fold id={`update-part-${x.id}`} className="space-y-2" summaryClassName="!text-sm" summary={<span className="font-medium"><NameLink text={displayName(c.tester)} href={c.tester.deletedAt ? null : `/app/testers/${c.testerId}`} /> · {x.kind === "written" ? "Written answers" : "Recording"} · updated {fmtDateTime(x.paidUpdateAt!)}</span>}>
              <p className="text-sm text-slate-200" data-update-line="">{updateRowLine(displayName(c.tester), rooms.get(x.id)!.paid, rooms.get(x.id)!.room)}</p>
              {/* (Owner, Nov 3, batch 35 §152) What was paid for it so far (a panel above 4). */}
              <PartPayments id={x.id} lines={partPays.get(x.id)} />
              <ResizeBox id={`update-${x.id}`} label={x.kind === "written" ? "Written answers" : "Recordings"}>
                <SentWork id={`update-${x.id}`} timeZone={u.timeZone} kind={x.kind} answers={x.answers} questions={writtenQuestions(c)} notes={x.notes} additions={x.additions} files={x.recordings} />
              </ResizeBox>
              <p className="text-sm font-medium text-white">Pay more</p>
              <PayBox more={{ testId: t.id, contractId: c.id }} update owes={owesNow} kind="submission" id={x.id} name={displayName(c.tester)} seenAt={seenAt} bankWaits={waitsOf(x.id)} paidSoFarCents={paidSoFar(c.id)} note={payMore.line || undefined}
                room={rooms.get(x.id)?.box} listingCents={x.agreedCents} listingText={`${money(x.agreedCents)} for ${x.kind === "recording" ? "a recording" : "written answers"}`} />
              </Fold>
            </div>
          ))}
        </NeedsYou>
      )}

      {/* (Owner) The full app's "Testers joined" right after the header: avatars with their hover cards (Block inside). */}
      <TestersJoined timeZone={u.timeZone}
        testId={t.id}
        spots={t.spots}
        status={t.status}
        seats={await Promise.all(working.map(async (c) => ({
          testerId: c.testerId,
          name: displayName(c.tester),
          pronoun: c.tester.pronoun,
          summary: [
            [...(c.tester.profile?.devices ?? []), ...(c.tester.profile?.languages ?? [])].join(", "),
            (await ratingSummary(c.testerId)).line || "No ratings yet",
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
        <RowsBox many={t.contracts.length > 6}>
          {t.contracts.map((c) => {
            const name = displayName(c.tester);
            // (Batch 35 §137) Their name in a sentence links to their profile (cut, with its hover and tap pop-up).
            const personHref = c.tester.deletedAt ? null : `/app/testers/${c.testerId}`;
            const ri = rateInfo.get(c.id);
            const unreadN = unread.get(c.id) ?? 0;
            const callPaid = payments.filter((p) => p.contractId === c.id && p.callId && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
            const bookedAhead = c.calls.filter((x) => x.status === "booked" && x.startsAt > now).length;
            // (Batch 15 section 31) "held" became "done": a call that took place.
            const done = c.calls.filter(tookPlace).length;
            const cancelledN = c.calls.filter((x) => x.status === "cancelled").length;
            // (Batch 15 section 42) Every call that's over, newest first (oldest last).
            const overCalls = c.calls.filter(callIsOver).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
            const partRows = [
              { name: "Written answers", on: c.writtenCents != null, required: c.writtenRequired, sub: c.submissions.find((s) => s.kind === "written"), cents: c.writtenCents },
              { name: "Recording", on: c.recordingCents != null, required: c.recordingRequired, sub: c.submissions.find((s) => s.kind === "recording"), cents: c.recordingCents },
            ];
            return (
              <div key={c.id} className="panel space-y-2" id={`tester-${c.id}`} data-tester-name={name} data-tester-id={c.testerId}>
                {/* (Owner, Nov 3, batch 35 §140) Each tester folds by their name: closed, only the summary under it (paid in all, ratings, Rate); open, all their
                    parts, each in its own panel. Kept open or closed through the live redraws; a link into it (#part-, #call-…) opens it. */}
                <Fold id={`tester-${c.id}`} defaultOpen={t.contracts.length === 1} className="space-y-2" summaryClassName="flex flex-wrap items-baseline gap-2 !text-base" summary={<>
                  {/* (Owner, Nov 3, §166) The name is the green link to their profile (no "See her profile" any more). A press on the name opens the profile; a press
                      anywhere else on the heading (the arrow, the badges, the space after the name) still opens or closes the fold. */}
                  <h3 className="mr-auto inline font-semibold text-white" data-tester-fold-name=""><NameLink text={name} href={personHref} /></h3>
                  <span className="badge">{c.status === "working" ? `Working · due ${fmtDate(c.dueAt)}` : c.status === "left" ? "Left the test" : "Work ended"}</span>
                  {c.ndaAcceptedAt && <span className="badge">NDA accepted {fmtDate(c.ndaAcceptedAt)}</span>}
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
                      // (Owner, Nov 3) A part that wasn't sent is its line only; a sent part is its own drop-down like Needs you's (open at first): its payments, the answers or
                      // recordings, then Pay more.
                      if (!r.sub) return <div className="flex flex-wrap items-center gap-2">{line}</div>;
                      return (
                      <Fold id={`row-part-${r.sub.id}`} className="space-y-2" summaryClassName="flex flex-wrap items-center gap-2 !text-sm !font-normal" summary={line}>
                      {/* (Owner, Nov 3, batch 35 §152) Under the paid total: this part's payments (a panel above 4). */}
                      {r.sub && <PartPayments id={r.sub.id} lines={partPays.get(r.sub.id)} />}
                      {/* (Batch 17 §19) Unpaid at close-out: it stays unpaid. */}
                      {r.sub && !r.sub.review && payShut(r.sub.id) && testerPayable(c.tester) && <span className="w-full text-sm text-slate-300" data-closed-not-paid="">{closedNotPaidLine(shutOn(r.sub.id))}</span>}
                      {/* (Batch 35 §139; owner, Nov 3) Inside the part's drop-down: the answers or recordings in a small panel, then its Pay more box. */}
                      {r.sub?.review && <div className="w-full" data-paid-part-content="">
                        <ResizeBox id={`row-${r.sub.id}`} label={r.sub.kind === "written" ? "Written answers" : "Recordings"}>
                          {r.sub.kind === "written" && r.sub.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(r.sub.setUntil)}</p>}
                          <SentWork id={`row-${r.sub.id}`} timeZone={u.timeZone} kind={r.sub.kind} answers={r.sub.answers} questions={writtenQuestions(c)} notes={r.sub.notes} additions={r.sub.additions} files={r.sub.recordings} />
                        </ResizeBox>
                      </div>}
                      {/* (Owner, Oct 29, batch 11 section 6 / batch 12 section 3) A paid piece keeps its Pay box as "Pay more" until its cap is reached. */}
                      {r.sub && r.sub.review && !r.sub.review.rejected && !restricted && !r.sub.review.teamClosedById && payMore.open && (rooms.get(r.sub.id)?.room ?? 0) > 0 && (
                        <div className="w-full space-y-1" data-part-pay-more="">
                        <p className="text-sm font-medium text-white">Pay more</p>
                        <PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="submission" id={r.sub.id} name={name} seenAt={seenAt} bankWaits={waitsOf(r.sub.id)} paidSoFarCents={paidSoFar(c.id)} note={payMore.line || undefined}
                          room={rooms.get(r.sub.id)?.box} listingCents={r.sub.agreedCents} listingText={`${money(r.sub.agreedCents)} for ${r.name === "Recording" ? "a recording" : "written answers"}`} />
                        </div>
                      )}
                      {/* (Owner, Oct 29, batch 28 §14) At its cap, where Pay more was (grey). */}
                      {r.sub && r.sub.review && !r.sub.review.rejected && !restricted && !r.sub.review.teamClosedById && payMore.open && rooms.has(r.sub.id) && (rooms.get(r.sub.id)?.room ?? 0) <= 0 && (
                        <span className="w-full text-sm text-slate-400" data-paid-most="">{paidMostLine(rooms.get(r.sub.id)!.paid)}</span>
                      )}
                      {/* (Batch 30 §2) An update the tester sent at the cap: nothing more can be paid, so it isn't in Needs you. */}
                      {r.sub?.paidUpdateAt && r.sub.review && !r.sub.review.rejected && !r.sub.review.teamClosedById && rooms.has(r.sub.id) && (rooms.get(r.sub.id)?.room ?? 0) <= 0 && <span className="badge" data-updated-at-cap="">{UPDATED_AT_CAP}</span>}
                      {/* (Batch 30 §5) The team closed it for $0, with its reason. */}
                      {r.sub?.review?.teamClosedById ? <span className="w-full text-sm text-slate-300" data-team-closed="">{teamClosedLine(r.sub.review.reason)}</span>
                        : r.sub?.review && r.sub.review.amountCents === 0 && !r.sub.review.rejected && r.sub.review.reason && <span className="w-full text-sm text-slate-300" data-paid-zero="">{paidZeroLine(r.sub.review.reason)}</span>}
                      {/* (Batch 17 §11) A charge on this part made while you were away, waiting for your bank. */}
                      {bankAt(r.sub.id)}
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
                {/* (Batch 15 sections 31 and 42) "Calls (N)": every call that's over, newest first, with its outcome badge; each call that took place has its own Pay more box. */}
                {overCalls.length > 0 && (
                  <details open={overCalls.some((x) => bankRows.some((b) => b.pieceId === x.id)) || undefined} className="rounded-lg border border-white/10 p-2 text-sm" data-calls-fold={c.id}>
                    <summary className="fold-chevron cursor-pointer font-medium text-white">Calls ({overCalls.length})</summary>
                    {/* (Batch 20 section 11) More than 3: a scroll box about 3 calls tall (each call's Pay / Pay more / dispute controls inside it). (Owner, Nov 3,
                        §152) It is the draggable panel. */}
                    <div className="mt-2">
                    <PanelWhen on={overCalls.length > PAST_CALLS_SHOWN} id={`past-calls-${c.id}`} label={`Calls with ${name}`} defaultMax={LIST_PANEL.pastDeveloper}>
                    <ul className="space-y-2" data-calls-history="" data-calls-scroll={overCalls.length > PAST_CALLS_SHOWN ? overCalls.length : undefined}>
                      {overCalls.map((x) => {
                        const m = callMinutesOf(x);
                        const badge = callOverBadge(x, { developer: displayName(u), tester: name }, "developer", fmtTime, partPaid(x.id), m);
                        const inNeeds = tookPlace(x) && !x.review && !restricted && testerPayable(c.tester) && !payShut(x.id);
                        return (
                          <li key={x.id} id={inNeeds ? `callrow-${x.id}` : `call-${x.id}`} className={`space-y-1 rounded-lg border border-white/5 p-2 ${"scroll-mt-24 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300"}`} data-over-call={x.id}>
                            {/* (Owner, Nov 3) Each call is its own drop-down, like a part: its line, then inside its length, payments and Pay more. */}
                            <Fold id={`row-call-${x.id}`} className="space-y-1" summaryClassName="flex flex-wrap items-center gap-2 !text-sm !font-normal" summary={<>
                              <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                              <span className={`badge ${badge.tone === "green" ? "border-emerald-400/40 text-emerald-200" : badge.tone === "amber" ? "border-amber-300/40 text-amber-200" : badge.tone === "rose" ? "border-rose-400/40 text-rose-200" : ""}`} data-call-badge="">{badge.label}</span>
                              <span className="ml-auto text-slate-300">{tookPlace(x) ? `paid ${money(partPaid(x.id))}` : ""}</span>
                            </>}>
                            {tookPlace(x) && <p className="text-xs text-slate-400" data-call-length="">{lengthOf(x)} · {x.rateCents == null ? NOT_LISTED : `In ${pronouns(c.tester.pronoun).poss} contract`}</p>}
                            {/* (Owner, Nov 3, batch 35 §152) This call's payments (a panel above 4). */}
                            <PartPayments id={x.id} lines={partPays.get(x.id)} />
                            {badge.reason && <ReasonQuote text={badge.reason} />}
                            {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                            {inNeeds && <a href={`#call-${x.id}`} className="text-xs">Pay it in Needs you ↑</a>}
                            {tookPlace(x) && !x.review && payShut(x.id) && testerPayable(c.tester) && <p className="text-xs text-slate-300" data-closed-not-paid="">{closedNotPaidLine(shutOn(x.id))}</p>}
                            {bankAt(x.id)}
                            {x.review?.teamClosedById && <p className="text-sm text-slate-300" data-team-closed="">{teamClosedLine(x.review.reason)}</p>}
                            {x.review && !x.review.rejected && !restricted && !x.review.teamClosedById && payMore.open && (rooms.get(x.id)?.room ?? 0) > 0 && (
                              <div className="space-y-1" data-call-pay-more="">
                              <p className="text-sm font-medium text-white">Pay more</p>
                              <PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="call" id={x.id} name={name} seenAt={seenAt} bankWaits={waitsOf(x.id)} paidSoFarCents={paidSoFar(c.id)} note={payMore.line || undefined}
                                room={rooms.get(x.id)?.box} minutes={m ?? x.minutes} rateCents={x.rateCents} warning={callsWarn.get(c.id)}
                                listingCents={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).cents}
                                listingText={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                              </div>
                            )}
                            {x.review && !x.review.rejected && !restricted && !x.review.teamClosedById && payMore.open && rooms.has(x.id) && (rooms.get(x.id)?.room ?? 0) <= 0 && (
                              <p className="text-sm text-slate-400" data-paid-most="">{paidMostLine(rooms.get(x.id)!.paid)}</p>
                            )}
                            </Fold>
                          </li>
                        );
                      })}
                    </ul>
                    </PanelWhen>
                    </div>
                  </details>
                )}
                {/* (Batch 17 §11; batch 35 §80) A waiting charge whose piece isn't listed above: a link up to it in Needs you under the tester's row. */}
                {bankRows.filter((b) => b.contractId === c.id && !(b.pieceId && (partRows.some((r) => r.on && r.sub?.id === b.pieceId) || overCalls.some((x) => x.id === b.pieceId)))).map((b) => restricted ? <BankWaiting key={b.id} paymentId={b.id} cents={b.cents} line={b.line} full={b.full} seenAt={seenAt} /> : <a key={b.id} href={`#${bankAnchor(b.id)}`} className="block text-xs" data-bank-up={b.id}>{CONFIRM_WITH_BANK} in Needs you ↑</a>)}
                {termsRows.get(c.id) && <p className="note">{termsRows.get(c.id)}</p>}
                {/* (Owner, Oct 31, batch 35 §33) Only the terms line: the contract changes (renames, a Stop's note…) are still recorded for the tester's own page, never
                    listed under the developer's row. */}
                {/* (Batch 13 section 8) Earlier SENT sets this tester replaced after switching to changed questions. */}
                <PrevSetFolds timeZone={u.timeZone} developer attachments={c.submissions.flatMap((s) => s.recordings).filter((r) => r.uploadedAt).map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType }))} sets={prevSetsOf(c.submissions.find((s) => s.kind === "written")?.prevSets)} />
                {/* (Owner, Nov 3, §166) No "On <name>'s profile: “…”" lines here any more: the excerpts stay on the tester's profile (and the requests in Needs you). */}
                {/* (Batch 11, DEFAULT) A tester who deleted their account with no payout account: their unreviewed work left Needs you. */}
                {!testerPayable(c.tester) && (c.submissions.some((x) => !x.review) || c.calls.some((x) => tookPlace(x) && !x.review)) && <p className="note" data-deleted-no-payouts="">{deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null }), c.tester.pronoun)}</p>}
                </Fold>
                <div className="space-y-1" data-tester-summary="">
                  <div className="flex flex-wrap items-center gap-2">
                    {!restricted && <a href={`/app/chat/${c.id}`} className="btn-secondary relative px-3 py-1 text-xs no-underline hover:no-underline"><MessagesSquare className="h-3.5 w-3.5" /> Chat
                      {unreadN > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unreadN} unread`}>{unreadN}</span>}
                    </a>}
                    {/* (Owner, Nov 3, §166) No "See her profile": the name above is the link. */}
                  </div>
                  <p className="text-sm"><b>Paid in all:</b> {money(paidSoFar(c.id))}{(bookedAhead || done || cancelledN) ? ` · Calls: ${[bookedAhead ? `${bookedAhead} booked ahead` : "", done ? `${done} done` : "", cancelledN ? `${cancelledN} cancelled` : ""].filter(Boolean).join(", ")}` : ""}</p>
                  {/* (Owner, Nov 3, §166) No "<name>: 1.0 ★ (1 rating)" line here any more: the circle's hover card and the profile show the rating. */}
                  {ri?.tester && (ri.testerRevealed ? (
                    <p className="note"><NameLink text={name} href={personHref} /> rated you: {ri.tester.stars} ★{ri.tester.comment ? ` · “${ri.tester.comment}”` : ""}</p>
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
      {(u.holdStartedAt || (owedList.length > 0 && !u.devSuspendedAt)) && <OwedBox onHold={!!u.holdStartedAt} owed={owedList} ranOut={await (await import("@/lib/server/owedOnce")).ranOutLine(u.id)} chargeback={!!cbSteps && !cbSteps.reviewFirst} reviewFirst={cbSteps?.reviewFirst && !cbSteps.approved ? (await import("@/lib/rules")).reviewFirstLine(cbSteps.count) : ""} verifyFirst={!!cbSteps && !cbSteps.cardVerified} reservedCents={cbSteps?.reservedCents ?? 0} reserveExpired={cbSteps?.expired ?? false} review={!!(u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER)} />}
      {soon && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(t.title, t.openUntil!, new Date(), "developer")}</p>}
      <DevCallPanel
        leadMinutes={CALL_MIN_AHEAD_MINUTES}
        end={callEndProps(callEnd)}
        testId={t.id}
        seenAt={seenAt}
        canRequest={t.status !== "stopped" && t.status !== "draft" && !u.holdStartedAt && !restricted}
        noRequestReason={t.status === "stopped" ? "" : u.holdStartedAt ? `${pausedUntil(u.holdReason === "chargeback")}: calls wait meanwhile.` : ""}
        testers={restricted ? devTesters.map((x) => ({ ...x, requests: [] })) : devTesters}
        // (Batch 16 sections 33 and 35) The one Call requests panel: every waiting request, both directions (Needs you's rows open it here).
        requests={restricted ? [] : reqs.flatMap((r) => {
          const c = working.find((x) => x.id === r.contractId);
          return c ? [{ id: r.id, contractId: c.id, tester: displayName(c.tester), testerHref: c.tester.deletedAt ? null : `/app/testers/${c.testerId}`, asker: r.fromSide === "developer" ? "you" : displayName(c.tester), rows: pageRows(r, callEnd), minutes: r.minutes, mine: r.fromSide === "developer", rate: devRateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents, t.liveRateCents, c.tester.pronoun), warning: callsWarn.get(c.id) || undefined }] : [];
        })}
        elsewhere={otherCalls}
      />
      {!t.workEndedAt && t.status !== "stopped" && !restricted && (
        <InvitePanel
          testId={t.id}
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
      {saved && (
        <SavedNote><p className="ok">
          {Number(offered) > 0 ? `Saved. Offered the new terms to ${offered} working tester${Number(offered) === 1 ? "" : "s"}.` : "Saved. New testers join on the new listing; testers already in keep their contract."}
          {closed && ` Closed ${closed.split(", ").length} application${closed.split(", ").length === 1 ? "" : "s"}: ${closed.slice(0, 500)}.`}
          {resent && ` Invites re-sent on the new listing: ${resent.slice(0, 500)}.`}
          {skipped && ` Not re-invited: ${skipped.slice(0, 500)}.`}
        </p></SavedNote>
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
                  // (Batch 35 §136) The latest answers per question. (§167) What was added to a question follows its answer, dated; other additions join "Other notes".
                  ...((w) => ({ questions: w.items.map((i) => qStored(i.question, i.required)), answers: w.answers, notes: w.notes }))(answersByQuestion(s, writtenQuestions(c), (at) => fmtStampIn(at, u.timeZone))),
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
