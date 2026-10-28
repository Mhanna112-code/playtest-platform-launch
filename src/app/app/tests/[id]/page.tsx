import { hasPerks } from "@/lib/server/subscription";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, pronouns } from "@/lib/format";
import { chargeOpensAt, callJoinable, bookedLateLabel, isBookedLate, callReference, cancelNeedsReason, chargeAmount, choiceNoteLine, closesInLine, lateLabel, termsLine, paidZeroLine } from "@/lib/rules";
import { callIsOver, callLengthLine, callMinutesOf, callOverBadge, MEASURING_LINE } from "@/lib/callMeasure";
import { callsLeftCents } from "@/lib/server/callMoney";
import { callsLeftWarning } from "@/lib/callMeasure";
import { fmtTime } from "@/lib/format";
import { ReasonQuote } from "@/components/ScrollText";
import { requireOpenPage } from "@/lib/server/page-auth";
import { devRestricted } from "@/lib/restricted";
import { PAUSED_ALERTS, STOPPED_ALERTS } from "@/lib/alerts";
import { TestBanner, allowedLine, type BannerCause } from "./TestBanner";
import { RestrictedCalls } from "./RestrictedCalls";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { unreadCount } from "@/lib/server/messages";
import { DevCallPanel, type DevCall, type DevTester } from "./DevCallPanel";

import { InvitePanel } from "./InvitePanel";
import { inviteExpired, invitePanel } from "@/lib/server/invites";
import { owedForBox } from "@/lib/server/holds";
import { termsRowLines } from "@/lib/server/terms";
import { rejoinAskLine } from "@/lib/server/joining";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateBlocker, ratingSummary } from "@/lib/server/ratings";
import { LiveTop } from "@/components/LiveTop";
import { MessagesSquare } from "lucide-react";
import { Applications } from "./Applications";
import { NeedsRequests } from "./NeedsRequests";
import { rateLabel } from "@/lib/server/requests";
import { rowsOf, toJson } from "@/lib/callRows";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeSide } from "./DisputeSide";
import { OwedBox } from "@/components/OwedBox";
import { HOLD_APPROVAL_AFTER, NOT_LISTED, callListed, deletedNoPayoutsLine, joiningClosedLine, payMoreState, testEndedAt, testerPayable } from "@/lib/rules";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { PayBox } from "./PayBox";
import { BankWaiting } from "@/components/BankWaiting";
import { bankWaitingOnTest } from "@/lib/server/confirm";
import { ContractChanges, type ChangeEntry } from "./ContractChanges";
import { AnswersBox } from "@/components/AnswersBox";
import { Formatted } from "@/components/Formatted";
import { AttachmentList } from "@/components/AttachmentList";
import { pieceOf, pieceRoom } from "@/lib/server/payments";
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
import { byQuestion } from "@/lib/byQuestion";
import { PrevSetFolds, SetView } from "@/components/AnswerSets";
import { itemsOf, prevSetsOf } from "@/lib/answerSets";
import { NOT_REQUIRED } from "@/lib/questions";
import { pendingForDeveloper } from "@/lib/server/excerpts";
import { ExcerptQuestion } from "@/components/ExcerptList"; // (batch 16 section 37) the question above each excerpt request
import { ExcerptDecision, ExcerptRemove } from "@/components/Excerpts";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ failed?: string; saved?: string; offered?: string; skipped?: string; closed?: string; resent?: string; spotclosed?: string; spots?: string }> }) {
  const { id } = await params;
  // First: a restricted developer may open a test page only in its restricted view (batch 15 section 29); every other page sends them to the dashboard top.
  const u = await requireOpenPage(`/app/tests/${id}`);
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
  await (await import("@/lib/server/recovery")).checkStuck({ testId: id }); // (batch 15 section 9) payments stuck "in progress"
  const { saved, offered, skipped, closed, resent, failed } = await searchParams;
  const seenAt = new Date().toISOString();
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
  const next = await db.test.findFirst({ where: { previousId: id }, select: { id: true } });
  // (Batch 14 section 6) The read-only Access keys notice (only when the test uses keys).
  const keysView = await keyBoxes(id);
  // (Owner, Oct 30, batch 15 sections 23, 29 and 37) ANY pause (the team's, a payment or chargeback hold, a developer-side suspension) shows the restricted view: the
  // overview with Stop and End early, Booked calls with Cancel, the excerpt requests and the disputes. Only the banner's title and reason differ by cause.
  const accountPaused = devRestricted(u, "developer");
  const teamPaused = !!t.adminPausedAt && t.status !== "stopped";
  const restricted = accountPaused || teamPaused;
  const bannerCause: BannerCause | null = t.adminStoppedAt ? "team-stopped" : teamPaused ? "team-paused" : u.devSuspendedAt ? "suspended" : u.holdStartedAt ? (u.holdReason === "chargeback" ? "chargeback" : "hold") : t.status === "stopped" ? "stopped" : null;
  const bannerReason = bannerCause === "team-paused" || bannerCause === "team-stopped" ? t.adminNote : bannerCause === "suspended" ? u.devSuspendNote : "";
  const keysEver = await db.accessKey.count({ where: { testId: id } });
  const keysLeft = keysEver > 0 ? await db.accessKey.count({ where: { testId: id, status: "free" } }) : null;
  const working = t.contracts.filter((c) => c.status === "working");
  const paid = await db.payment.groupBy({ by: ["contractId"], where: { contractId: { in: t.contracts.map((c) => c.id) }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  const paidSoFar = (id: string) => paid.find((p) => p.contractId === id)?._sum.amountCents ?? 0;
  const termsRows = await termsRowLines(t.contracts.map((c) => c.id));
  const callSets = await db.callSet.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } } });
  const reqs = await db.callRequest.findMany({ where: { testId: id, status: "pending", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  // A developer batch sent to several testers shows once per tester; that's fine: each copy is that tester's.
  const pendingApps = await db.application.findMany({ where: { testId: id, status: "pending" }, orderBy: { createdAt: "asc" } });
  const appUsers = await db.user.findMany({ where: { id: { in: pendingApps.map((a) => a.testerId) } }, include: { profile: true } });
  const appRatings = new Map(await Promise.all(appUsers.map(async (x) => [x.id, (await ratingSummary(x.id)).line] as const)));
  const apps = pendingApps.map((a) => {
    const x = appUsers.find((y) => y.id === a.testerId)!;
    const old = a.kind === "rejoin" ? t.contracts.find((c) => c.testerId === a.testerId) : undefined;
    return { id: a.id, kind: a.kind, line: old ? rejoinAskLine(displayName(x), pronouns(x.pronoun), old) : undefined, userId: x.id, name: displayName(x), note: a.note, profile: [...(x.profile?.devices ?? []), ...(x.profile?.languages ?? []), ...(appRatings.get(x.id) ? [appRatings.get(x.id)!] : [])].join(", ") };
  });
  // (NEXT-UI 4) Chat is its own page per session: each tester's row links to it with an unread badge.
  const unread = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await unreadCount(u.id, t.id, c.testerId)] as const)));
  const blockedIds = new Set((await db.block.findMany({ where: { blockerId: u.id } })).map((b) => b.blockedId));
  const [invitePanelData, invites, owedList] = await Promise.all([restricted || t.status === "stopped" ? null : invitePanel(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owedForBox(u.id)]);
  const people = new Map((await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } } })).map((x) => [x.id, displayName(x)]));
  const expired = inviteExpired(t);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const now = new Date();
  // (Owner, Oct 28, batch 16 section 22) Pay more closes 30 days after the test ended; the box says so in its last 7 days.
  const payMore = payMoreState(testEndedAt(t, t.contracts, now), now, fmtDate);
  // (Owner, Oct 26) A chargeback hold's steps. (A paused test's closing date is told by bell and shown to the admin, not on the page.)
  const cbSteps = await chargebackSteps(u.id);
  // (Batch 17 §11) Charges made while the developer was away that their bank wants confirmed: "Confirm with your bank" under the affected piece (Payments and the bell link here).
  const bankRows = await bankWaitingOnTest(u.id, t.id);
  const bankAt = (pieceId: string) => bankRows.filter((b) => b.pieceId === pieceId).map((b) => <BankWaiting key={b.id} paymentId={b.id} line={b.line} />);
  // (Owner, Oct 27) While a failed payment is owed, Pay (part Pay, extra pay) is disabled: "Pay what you owe first."; the room above the listing prices for extra pay.
  const owesNow = owedList.some((o) => o.retry);
  // (Batch 9 section 6) Extra pay's "up to $Y", per piece: every sent part and every call that took place (batch 15 section 40: its length is final).
  const tookPlace = (x: { status: string; actualMinutes: number | null; measuredMinutes: number | null; measuredAt: Date | null }) => x.status === "booked" && callMinutesOf(x) != null;
  const pieceKeys: { submissionId?: string; callId?: string }[] = t.contracts.flatMap((c) => [...c.submissions.map((x) => ({ submissionId: x.id })), ...c.calls.filter(tookPlace).map((x) => ({ callId: x.id }))]);
  const rooms = new Map(await Promise.all(pieceKeys.map(async (k) => {
    const piece = (await pieceOf(k))!;
    const r = await pieceRoom(piece);
    return [k.submissionId ?? k.callId!, { room: r.roomCents, listed: r.listed, pool: r.callPoolRoomCents, box: { roomCents: r.roomCents, aboveRoomCents: r.aboveRoomCents, ceilingBinds: r.ceilingBinds } }] as const;
  })));
  // (Batch 15 section 34) What's left of the $1,000 for each tester's calls, and the small warning when under an hour (or under $200 unlisted).
  const callsLeft = new Map(await Promise.all(t.contracts.map(async (c) => [c.id, await callsLeftCents(c.id)] as const)));
  const callsWarn = new Map(t.contracts.map((c) => [c.id, callsLeftWarning(callsLeft.get(c.id) ?? 0, callListed(t, c) ? c.liveRateCents : null, "developer", displayName(c.tester))] as const));
  // (Owner, Oct 28, batch 16 section 33) The developer's other booked calls still ahead (any tester, any test), for the clash checks while Request a time is filled.
  const otherCalls = (await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(now.getTime() - 6 * 3_600_000) }, contract: { test: { developerId: u.id } } }, include: { contract: { include: { tester: true } } } }))
    .map((x) => ({ contractId: x.contractId, name: displayName(x.contract.tester), start: x.startsAt.toISOString(), minutes: x.minutes }));
  const lengthOf = (x: Parameters<typeof callLengthLine>[0]) => callLengthLine(x, fmtTime);
  const lateOf = (c: { dueAt: Date; tester: { name: string; email: string } }, x: { createdAt: Date }) => (isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(c.tester), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined);
  const partPaid = (id: string) => payments.filter((p) => (p.submissionId === id || p.callId === id) && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const payments = await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
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
    const toCall = (x: (typeof c.calls)[number]): DevCall => ({ id: x.id, joinable: callJoinable(x, now), report: x.noShowBy ? { byMe: x.noShowBy === "developer", note: x.noShowNote } : null, when: x.startsAt.toISOString(), minutes: x.minutes, rate: rateLabel(x.rateCents, c.liveRateCents), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, reported: !!x.noShowBy, late: lateOf(c, x), measuring: x.startsAt <= now ? MEASURING_LINE : undefined });
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
      return [{ id: sid, label: `${daily ? "Daily" : "Weekly"} · ${cs[0].startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}${row?.count === 0 ? "" : ` (${left} left)`}`, minutes: cs[0].minutes, rate: rateLabel(cs[0].rateCents, c.liveRateCents), needsReason: cancelNeedsReason(next.startsAt, now), calls: cs.map(toCall) }];
    });
    const booked = new Set(c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => x.setId ?? x.id)).size;
    return {
      contractId: c.id, name: displayName(c.tester), terms, booked, warning: callsWarn.get(c.id) ?? "",
      calls: live.filter((x) => !x.setId).map(toCall),
      sets,
      // (Batch 16 section 33) Their waiting requests and yours, as they arrive (answered in the Call requests panel).
      pending: reqs.filter((r) => r.contractId === c.id).length, leftCents: callsLeft.get(c.id) ?? null, rateCents: callListed(t, c) ? c.liveRateCents : null,
      requests: reqs.filter((r) => r.contractId === c.id).map((r) => ({
        id: r.id, minutes: r.minutes, rows: toJson(rowsOf(r)), mine: r.fromSide === "developer",
        rate: rateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents),
      })),
    };
  });
  // (NEWEST+5) Rating a tester: only after they rated you (14 days); their rating shows once you rate (or the window closes).
  const rateInfo = new Map(
    await Promise.all(
      t.contracts.map(async (c) => [c.id, { ...(await contractRatings(c.id)), blocker: await rateBlocker(c.id, "developer"), avg: (await ratingSummary(c.testerId)).line }] as const),
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
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const needsRequests = reqs.filter((r) => r.fromSide === "tester").flatMap((r) => {
    const c = t.contracts.find((x) => x.id === r.contractId);
    return c ? [{ id: r.id, contractId: c.id, name: displayName(c.tester), rows: toJson(rowsOf(r)), minutes: r.minutes, rate: rateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents), warning: callsWarn.get(c.id) }] : [];
  });
  const disputesWaiting = t.contracts.flatMap((c) => [
    ...c.submissions.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, name: displayName(c.tester), what: x.kind === "written" ? "their written answers" : "their recording", reason: x.dispute!.reason })),
    ...c.calls.filter((x) => x.dispute && x.dispute.status === "open" && !x.dispute.devSide).map((x) => ({ id: x.dispute!.id, name: displayName(c.tester), what: `the call on ${fmtDateTime(x.startsAt)}`, reason: x.dispute!.reason })),
  ]);
  // (Owner, Oct 29, batch 13) Excerpt requests waiting for Allow or Deny (hidden while the test has an NDA), and excerpts shown from this test (Take down in the row).
  const excerptReqs = await pendingForDeveloper(u.id, t.id);
  const shownEx = await db.excerpt.findMany({ where: { testId: t.id, status: "shown" }, orderBy: { decidedAt: "desc" } });
  // (Batch 15 section 43) The developer's Contract changes: one entry per Save that changed the terms or the names, with who switched or kept.
  const notesByContract = await db.contractNote.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
  const dealChanges = await db.testChange.findMany({ where: { testId: id }, orderBy: { createdAt: "desc" }, take: 200 });
  const dealOffers = dealChanges.length ? await db.termsOffer.findMany({ where: { changeId: { in: dealChanges.map((x) => x.id) } } }) : [];
  const personOf = (cid: string) => { const c = t.contracts.find((x) => x.id === cid); return c ? { name: displayName(c.tester), contractId: c.id, left: c.status !== "working" } : null; };
  const changeEntries: ChangeEntry[] = dealChanges.map((x) => {
    const mine = dealOffers.filter((o) => o.changeId === x.id);
    const who = (st: string[]) => mine.filter((o) => st.includes(o.status)).map((o) => personOf(o.contractId)).filter((p): p is NonNullable<typeof p> => !!p);
    return { id: x.id, at: x.createdAt.toISOString(), fields: x.fields, before: x.before as Record<string, unknown>, after: x.after as Record<string, unknown>, effects: x.effects, chose: { switched: who(["switched"]), kept: who(["kept"]), undecided: who(["open"]) } };
  });
  // (Batch 15 section 29) The restricted view: Booked calls (ahead) with Cancel, and the open disputes waiting for the developer's side.
  const bookedAhead = t.contracts.flatMap((c) => c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => ({ id: x.id, who: displayName(c.tester), when: x.startsAt.toISOString(), minutes: x.minutes, needsReason: cancelNeedsReason(x.startsAt, now) }))).sort((a, b) => a.when.localeCompare(b.when));
  const banner = bannerCause ? (
    <TestBanner cause={bannerCause} reason={bannerReason} failed={failed}
      allowed={restricted ? allowedLine(true, { stop: t.status !== "stopped", endEarly: t.status !== "stopped" && working.length > 0, cancelCalls: bookedAhead.length > 0 }) : allowedLine(false, { nextRound: !t.adminStoppedAt && !next })} />
  ) : null;
  if (restricted) {
    return (
      <>
        <AutoRefresh query={`test=${t.id}`} />
        {banner}
        <TopPanel
          id={t.id} title={t.title} productName={t.productName} ignoredAlerts={u.ignoredAlerts} restricted mature={t.mature} nda={!!t.ndaText} keysLeft={null}
          parts={{ written: t.writtenCents != null, recording: t.recordingCents != null, live: t.liveRateCents != null }} paused status={t.status}
          terms={termsLine({ ...asListing(t), testerDays: t.testerDays })} openUntil={t.openUntil ? t.openUntil.toISOString() : null} version={t.version} seenAt={seenAt}
          nextRoundId={null} teamStopped={!!t.adminStoppedAt} perks={perks} spotsLine={`${working.length} of ${t.spots} spots used`} full={working.length >= t.spots}
          joinMode={t.joinMode} deadlineDays={t.deadlineDays} categories={t.categories}
          alertKeys={t.status === "stopped" ? [...STOPPED_ALERTS] : [...PAUSED_ALERTS]}
          doneTo={accountPaused ? "/app" : undefined}
          working={working.map((c) => ({
            contractId: c.id, name: displayName(c.tester),
            sent: [...(c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
            toSend: [...(c.writtenCents != null && !c.submissions.some((x) => x.kind === "written") ? ["written answers"] : []), ...(c.recordingCents != null && !c.submissions.some((x) => x.kind === "recording") ? ["recording"] : [])],
            ahead: c.calls.filter((x) => x.status === "booked" && x.startsAt > now).length,
            waiting: [...c.submissions.filter((x) => !x.review).map((x) => (x.kind === "recording" ? "recording" : "written answers")), ...(c.calls.some((x) => tookPlace(x) && !x.review) ? ["live call"] : [])],
          }))}
        />
        <LiveTop scope={`test:${t.id}`} seenAt={seenAt} contractLink="scroll" />
        <RestrictedCalls testId={t.id} seenAt={seenAt} calls={bookedAhead} />
        {/* (Batch 17 §11) A charge made while away (e.g. a retry during the pause) that the bank wants confirmed: confirmed here, each line naming its piece. */}
        {bankRows.length > 0 && (
          <section className="card space-y-2" data-restricted-bank="">
            <h2 className="font-semibold text-white">Your bank wants you to confirm</h2>
            {bankRows.map((b) => <BankWaiting key={b.id} paymentId={b.id} line={b.line} />)}
          </section>
        )}
        {/* (Batch 15 section 39) Excerpts go through anything: Allow / Deny (hidden while the test has an NDA, as always) and Take down. */}
        {(excerptReqs.length > 0 || shownEx.length > 0) && (
          <section className="card space-y-2" data-restricted-excerpts="">
            <h2 className="font-semibold text-white">Excerpts</h2>
            {excerptReqs.map((x) => (
              <div key={x.id} id={`excerpt-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm" data-excerpt-request="">
                <p className="text-slate-300"><b className="text-white">Excerpt request</b> · {x.tester} would like to show this on their profile ({x.named ? `names the product: ${x.source}` : "doesn't name the product"}):</p>
                <ExcerptQuestion question={x.question} />
                <ClampText text={`“${x.text}”`} className="text-slate-200" />
                <ExcerptDecision excerptId={x.id} seenAt={seenAt} />
              </div>
            ))}
            {shownEx.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm" data-shown-excerpt="">
                <span className="min-w-0 flex-1"><span className="text-slate-400">On a tester&apos;s profile: </span><ClampText text={`“${e.text}”`} className="text-slate-200" /></span>
                <ExcerptRemove excerptId={e.id} label="Take down" body="It leaves the tester's profile at once, and they're told." />
              </div>
            ))}
          </section>
        )}
        {/* (Batch 15 section 27) The developer's side of a dispute: optional, never stopped, works while paused or restricted. */}
        {disputesWaiting.length > 0 && (
          <section className="card space-y-2" data-restricted-disputes="">
            <h2 className="font-semibold text-white">Disputes: add your side</h2>
            <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
              {disputesWaiting.map((d) => (
                <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
                  <p className="text-slate-300"><b className="text-white">{d.name}</b> disputed what you paid for {d.what} · waiting for the team:</p>
                  <ReasonQuote text={d.reason} />
                  <DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />
                </div>
              ))}
            </div>
          </section>
        )}
      </>
    );
  }
  const needsCount = pieces.length + apps.length + needsRequests.length + disputesWaiting.length + excerptReqs.length;
  return (
    <>
      <AutoRefresh query={`test=${t.id}`} />
      <TopPanel
        id={t.id}
        title={t.title}
        productName={t.productName}
        ignoredAlerts={u.ignoredAlerts}
        restricted={restricted}
        alertKeys={t.status === "stopped" ? [...STOPPED_ALERTS] : undefined}
        mature={t.mature}
        nda={!!t.ndaText}
        keysLeft={keysLeft}
        parts={{ written: t.writtenCents != null, recording: t.recordingCents != null, live: t.liveRateCents != null }}
        paused={!!(u.holdStartedAt || t.adminPausedAt)}
        status={t.status}
        terms={termsLine({ ...asListing(t), testerDays: t.testerDays })}
        openUntil={t.openUntil ? t.openUntil.toISOString() : null}
        joinClosedLine={t.openUntil && t.openUntil < new Date() ? joiningClosedLine(t.contracts.filter((c) => c.status === "working" && c.dueAt > new Date()).reduce<Date | null>((m, c) => (!m || c.dueAt > m ? c.dueAt : m), null), (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) : ""}
        version={t.version}
        seenAt={seenAt}
        nextRoundId={next?.id ?? null}
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
          waiting: [...c.submissions.filter((x) => !x.review).map((x) => (x.kind === "recording" ? "recording" : "written answers")), ...(c.calls.some((x) => tookPlace(x) && !x.review) ? ["live call"] : [])],
        }))}
      />
      {t.pauseClosedAt && <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" data-pause-closed="">{t.pauseClosedReason}</p>}
      {/* (Batch 15 section 37) A stopped test (the developer's or the team's): the one red banner, with what still works at the bottom. */}
      {banner}
      {/* (Design doc 6) The order: overview, the live updates box, the yellow keys notice, then the panels. */}
      <LiveTop scope={`test:${t.id}`} seenAt={seenAt} contractLink="scroll" />
      <KeysNotice testId={t.id} keys={keysView.uses && !restricted ? keysView : null} />
      {/* (NEXT-UI 21) NEEDS YOU: everything waiting for the developer, the full app's pattern. Every Pay box for sent work and calls that took place lives here. */}
      {needsCount > 0 && !restricted && (
        <NeedsYou count={needsCount}>
          <Applications testId={t.id} seenAt={seenAt} apps={apps} />
          <NeedsRequests testId={t.id} seenAt={seenAt} requests={needsRequests} />
          {excerptReqs.map((x) => (
            <div key={x.id} id={`excerpt-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm scroll-mt-24" data-excerpt-request="">
              <p className="text-slate-300"><b className="text-white">Excerpt request</b> · {x.tester} would like to show this on their profile ({x.named ? `names the product: ${x.source}` : "doesn't name the product"}):</p>
              <ExcerptQuestion question={x.question} />
              <ClampText text={`“${x.text}”`} className="text-slate-200" />
              <ExcerptDecision excerptId={x.id} seenAt={seenAt} />
            </div>
          ))}
          {disputesWaiting.map((d) => (
            <div key={d.id} id={`item-dispute-${d.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <p className="text-slate-300"><b className="text-white">{d.name}</b> disputed what you paid for {d.what} · waiting for the team:</p>
              <ReasonQuote text={d.reason} />
              <DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />
            </div>
          ))}
          {[...new Set(pieces.map((x) => x.c.id))].map((cid) => {
            const mine = pieces.filter((x) => x.c.id === cid);
            const who = displayName(mine[0].c.tester);
            return (
              <details key={cid} open className="rounded-xl border border-white/10 p-2" data-needs-person={who}>
                <summary className="fold-chevron flex cursor-pointer items-center gap-2 text-sm font-medium text-white">{who} <span className="font-normal text-slate-400">· {mine.length} part{mine.length === 1 ? "" : "s"} to pay</span></summary>
                <div className="mt-2 space-y-3">
          {mine.map((x) => (
            <div key={x.id} id={x.kind === "sub" ? `piece-${x.id}` : `call-${x.id}`} className="space-y-2 rounded-lg border border-white/10 p-3 scroll-mt-24">
              <p className="text-sm font-medium">
                <a href={`/app/testers/${x.c.testerId}`}>{displayName(x.c.tester)}</a> · {x.kind === "sub" ? (x.s!.kind === "written" ? "Written answers" : "Recording") : "Live call"} · {x.kind === "sub" ? `sent ${fmtDateTime(x.s!.updatedAt)}` : `${fmtDateTime(x.x!.startsAt)} · ${x.x!.minutes} min booked`} · {(x.kind === "sub" ? x.s!.agreedCents : x.x!.rateCents) == null ? NOT_LISTED : "In their contract"}
                {x.kind === "sub" && x.s!.late && <span className="ml-2 badge">{lateLabel(x.c.dueAt, fmtDate)}</span>}
              </p>
              {x.kind === "sub" ? (
                <>
                  {/* (Owner, Oct 29, batch 10) One piece's answers in their own scroll box (about 16 lines) when longer; the Pay box below stays outside it. */}
                  {/* (Batch 11) Formatted answers, and the piece's files and recordings, inside the same scroll box. */}
                  <AnswersBox>
                    {/* (Batch 13 section 8) What was last sent, under the questions it answered; an earlier set says so (reviewed and paid at the price it was sent at). */}
                    {x.s!.kind === "written" && x.s!.setUntil && <p className="note" data-set-until="">Sent for the questions until {fmtDate(x.s!.setUntil)}</p>}
                    {x.s!.kind === "written" && <SetView items={itemsOf(x.s!.answers, writtenQuestions(x.c))} />}
                    {x.s!.notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><Formatted text={x.s!.notes} /></div>}
                    <AttachmentList items={x.s!.recordings.filter((r) => r.uploadedAt)} />
                  </AnswersBox>
                  <PayBox owes={owesNow} key={x.s!.id} kind="submission" id={x.s!.id} name={displayName(x.c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(x.c.id)} room={rooms.get(x.s!.id)?.box}
                    note={x.s!.agreedCents != null && chargeOpensAt(x.s!, t, x.c, now) && !x.s!.choiceOfferedAt ? choiceNoteLine(fmtDate(chargeOpensAt(x.s!, t, x.c, now)!).replace(/, \d{4}$/, ""), displayName(x.c.tester), chargeAmount(x.s!.agreedCents, partPaid(x.s!.id)), pronouns(x.c.tester.pronoun).poss) : undefined}
                    listingCents={x.s!.agreedCents} listingText={`${money(x.s!.agreedCents)} for ${x.s!.kind === "written" ? "written answers" : "a recording"}`} />
                </>
              ) : (
                <>
                  {/* (Batch 15 section 40) The measured length: "Length: 29 min (both in the call 2:21–2:50 PM)"; a lowered one says so, with the reason. */}
                  <p className="text-sm text-slate-200" data-call-length="">{lengthOf(x.x!)}</p>
                  {x.x!.actualMinutes != null && x.x!.lengthNote && <ReasonQuote text={x.x!.lengthNote} />}
                  <PayBox owes={owesNow} key={`${x.x!.actualMinutes ?? 0}`} kind="call" id={x.x!.id} name={displayName(x.c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(x.c.id)} room={rooms.get(x.x!.id)?.box}
                    minutes={callMinutesOf(x.x!)!} rateCents={x.x!.rateCents} warning={callsWarn.get(x.c.id)}
                    listingCents={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).cents}
                    listingText={callReference(x.x!.rateCents, callMinutesOf(x.x!)!, x.c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                </>
              )}
            </div>
          ))}
                </div>
              </details>
            );
          })}
        </NeedsYou>
      )}

      {/* (Owner) The full app's "Testers joined" right after the header: avatars with their hover cards (Block inside). */}
      <TestersJoined
        testId={t.id}
        spots={t.spots}
        status={t.status}
        seats={await Promise.all(working.map(async (c) => ({
          testerId: c.testerId,
          name: displayName(c.tester),
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
              <div key={c.id} className="panel" id={`tester-${c.id}`} data-tester-name={name}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="mr-auto"><a href={`/app/testers/${c.testerId}`}>{name}</a></h3>
                  <span className="badge">{c.status === "working" ? `Working · due ${fmtDate(c.dueAt)}` : c.status === "left" ? "Left the test" : "Work ended"}</span>
                  {c.ndaAcceptedAt && <span className="badge">NDA accepted {fmtDate(c.ndaAcceptedAt)}</span>}
                  {!restricted && <a href={`/app/chat/${c.id}`} className="btn-secondary relative px-3 py-1 text-xs no-underline hover:no-underline"><MessagesSquare className="h-3.5 w-3.5" /> Chat
                    {unreadN > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" aria-label={`${unreadN} unread`}>{unreadN}</span>}
                  </a>}
                </div>
                <p className="note">Their contract: {termsLine(c)} · joined {fmtDate(c.joinedAt)}</p>
                <ul className="space-y-1 text-sm" data-parts-sent="">
                  {partRows.filter((r) => r.on).map((r) => (
                    <li key={r.name} className="flex flex-wrap items-center gap-2">
                      <b className="text-white">{r.name}</b>
                      <span className={`badge ${r.required ? "border-amber-300/40 text-amber-200" : ""}`}>{r.required ? "Required" : "Not required"}</span>
                      <span className={r.sub ? "text-emerald-200" : "text-slate-400"}>{r.sub ? `Sent ${fmtDate(r.sub.sentAt)}` : "Not sent yet"}</span>
                      {r.sub && <span className="text-slate-300">· paid {money(partPaid(r.sub.id))} of {r.sub.agreedCents != null ? money(r.sub.agreedCents) : `(${NOT_LISTED.toLowerCase()})`}</span>}
                      {/* (Owner, Oct 29, batch 11 section 6 / batch 12 section 3) A paid piece keeps its Pay box as "Pay more" until its cap is reached. */}
                      {r.sub && r.sub.review && !r.sub.review.rejected && !restricted && payMore.open && (rooms.get(r.sub.id)?.room ?? 0) > 0 && (
                        <PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="submission" id={r.sub.id} name={name} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)} note={payMore.line || undefined}
                          room={rooms.get(r.sub.id)?.box} listingCents={r.sub.agreedCents} listingText={`${money(r.sub.agreedCents)} for ${r.name === "Recording" ? "a recording" : "written answers"}`} />
                      )}
                      {r.sub?.review && r.sub.review.amountCents === 0 && !r.sub.review.rejected && r.sub.review.reason && <span className="w-full text-sm text-slate-300" data-paid-zero="">{paidZeroLine(r.sub.review.reason)}</span>}
                      {r.sub?.review?.rejected && <span className="badge border-rose-400/40 text-rose-200">Rejected</span>}
                      {/* (Batch 17 §11) A charge on this part made while you were away, waiting for your bank. */}
                      {r.sub && bankAt(r.sub.id)}
                    </li>
                  ))}
                  {/* (Batch 15 section 31) The Live call part: the total paid for all calls on the right, like the other parts; "held" is now "done". */}
                  {(c.liveRateCents != null || c.calls.length > 0) && (
                    <li className="flex flex-wrap items-center gap-2" data-live-part="">
                      <b className="text-white">Live call</b>
                      <span className={`badge ${c.liveRequired ? "border-amber-300/40 text-amber-200" : ""}`}>{c.liveRequired ? "Required" : "Not required"}</span>
                      <span className={done ? "text-emerald-200" : "text-slate-400"}>{done ? `${done} done` : "None done yet"}</span>
                      <span className="ml-auto text-slate-300">paid {money(callPaid)}</span>
                    </li>
                  )}
                </ul>
                {/* (Batch 15 sections 31 and 42) "Calls (N)": every call that's over, newest first, with its outcome badge; each call that took place has its own Pay more box. */}
                {overCalls.length > 0 && (
                  <details open={overCalls.some((x) => bankRows.some((b) => b.pieceId === x.id)) || undefined} className="rounded-lg border border-white/10 p-2 text-sm" data-calls-fold={c.id}>
                    <summary className="fold-chevron cursor-pointer font-medium text-white">Calls ({overCalls.length})</summary>
                    <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1" data-calls-history="">
                      {overCalls.map((x) => {
                        const m = callMinutesOf(x);
                        const badge = callOverBadge(x, { developer: displayName(u), tester: name }, "developer", fmtTime, partPaid(x.id), m);
                        const inNeeds = tookPlace(x) && !x.review && !restricted && testerPayable(c.tester);
                        return (
                          <li key={x.id} id={inNeeds ? `callrow-${x.id}` : `call-${x.id}`} className={`space-y-1 rounded-lg border border-white/5 p-2 ${"scroll-mt-24 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300"}`} data-over-call={x.id}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-slate-200">{fmtDateTime(x.startsAt)}</span>
                              <span className={`badge ${badge.tone === "green" ? "border-emerald-400/40 text-emerald-200" : badge.tone === "amber" ? "border-amber-300/40 text-amber-200" : badge.tone === "rose" ? "border-rose-400/40 text-rose-200" : ""}`} data-call-badge="">{badge.label}</span>
                              <span className="ml-auto text-slate-300">{tookPlace(x) ? `paid ${money(partPaid(x.id))}` : ""}</span>
                            </div>
                            {tookPlace(x) && <p className="text-xs text-slate-400" data-call-length="">{lengthOf(x)} · {x.rateCents == null ? NOT_LISTED : "In their contract"}</p>}
                            {badge.reason && <ReasonQuote text={badge.reason} />}
                            {x.actualMinutes != null && x.lengthNote && <ReasonQuote text={x.lengthNote} />}
                            {inNeeds && <a href={`#call-${x.id}`} className="text-xs">Pay it in Needs you ↑</a>}
                            {bankAt(x.id)}
                            {x.review && !x.review.rejected && !restricted && payMore.open && (rooms.get(x.id)?.room ?? 0) > 0 && (
                              <PayBox more={{ testId: t.id, contractId: c.id }} owes={owesNow} kind="call" id={x.id} name={name} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)} note={payMore.line || undefined}
                                room={rooms.get(x.id)?.box} minutes={m ?? x.minutes} rateCents={x.rateCents} warning={callsWarn.get(c.id)}
                                listingCents={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).cents}
                                listingText={callReference(x.rateCents, m ?? x.minutes, c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
                <p className="text-sm"><b>Paid in all:</b> {money(paidSoFar(c.id))}{(bookedAhead || done || cancelledN) ? ` · Calls: ${[bookedAhead ? `${bookedAhead} booked ahead` : "", done ? `${done} done` : "", cancelledN ? `${cancelledN} cancelled` : ""].filter(Boolean).join(", ")}` : ""}</p>
                {/* (Batch 17 §11) A waiting charge whose piece isn't listed above (a dispute decision or retry with no part) sits under the tester's row. */}
                {bankRows.filter((b) => b.contractId === c.id && !(b.pieceId && (partRows.some((r) => r.on && r.sub?.id === b.pieceId) || overCalls.some((x) => x.id === b.pieceId)))).map((b) => <BankWaiting key={b.id} paymentId={b.id} line={b.line} />)}
                {termsRows.get(c.id) && <p className="note">{termsRows.get(c.id)}</p>}
                {/* (Batch 15 section 24) Renames are recorded in each tester's contract changes. */}
                {notesByContract.some((n) => n.contractId === c.id) && (
                  <ul className="note space-y-0.5" data-contract-notes="">
                    {notesByContract.filter((n) => n.contractId === c.id).map((n) => <li key={n.id}>{n.text} · {fmtDateTime(n.createdAt)}</li>)}
                  </ul>
                )}
                {/* (Batch 13 section 8) Earlier SENT sets this tester replaced after switching to changed questions. */}
                <PrevSetFolds developer sets={prevSetsOf(c.submissions.find((s) => s.kind === "written")?.prevSets)} />
                {/* (Batch 13) Excerpts shown from this test: the developer can take one down at any time. */}
                {shownEx.filter((e) => e.contractId === c.id).map((e) => (
                  <div key={e.id} className="flex flex-wrap items-start gap-2 text-sm" data-shown-excerpt="">
                    <span className="min-w-0 flex-1"><span className="text-slate-400">On {name}&apos;s profile{t.ndaText ? " (hidden while this test has an NDA)" : ""}: </span><ClampText text={`“${e.text}”`} className="text-slate-200" /></span>
                    {!restricted && <ExcerptRemove excerptId={e.id} label="Take down" body={`It leaves ${name}'s profile at once, and ${name} is told.`} />}
                  </div>
                ))}
                {/* (Batch 11, DEFAULT) A tester who deleted their account with no payout account: their unreviewed work left Needs you. */}
                {!testerPayable(c.tester) && (c.submissions.some((x) => !x.review) || c.calls.some((x) => tookPlace(x) && !x.review)) && <p className="note" data-deleted-no-payouts="">{deletedNoPayoutsLine(displayName({ ...c.tester, deletedAt: null }))}</p>}
                {ri?.avg && <p className="note">{name}: {ri.avg}</p>}
                {ri?.tester && (
                  <>
                    {ri.testerRevealed ? (
                      <p className="note">{name} rated you: {ri.tester.stars} ★{ri.tester.comment ? ` · “${ri.tester.comment}”` : ""}</p>
                    ) : (
                      <p className="note">{name} rated you: you&apos;ll see it after you rate {pronouns(c.tester.pronoun).obj} (or on {fmtDate(ri.revealOn!)}).</p>
                    )}
                    {ri.developer && <p className="note">You rated {name}: {ri.developer.stars} ★</p>}
                    {ri.blocker === "" && !restricted && (
                      <RateBox path={`/api/tests/${t.id}/rate`} body={{ contractId: c.id }} seenAt={seenAt} name={name} working={false} headline={`Your rating of ${name} is final. Both ratings show once you rate.`} lines={[]} />
                    )}
                  </>
                )}
                {blockedIds.has(c.testerId) && <p className="note">You blocked {name}. Unblock in Account → Blocked people.</p>}
              </div>
            );
          })}
        </RowsBox>
      )}
      </TestersJoined>
      {!restricted && <ContractChanges entries={changeEntries} fmt={(iso) => fmtDateTime(new Date(iso))} />}
      {cbSteps && <ChargebackSteps steps={cbSteps} />}
      {(u.holdStartedAt || (owedList.length > 0 && !u.devSuspendedAt)) && <OwedBox onHold={!!u.holdStartedAt} owed={owedList} chargeback={!!cbSteps} verifyFirst={!!cbSteps && !cbSteps.cardVerified} review={!!(u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER)} />}
      {soon && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(t.title, t.openUntil!, new Date(), "developer")}</p>}
      <DevCallPanel
        testId={t.id}
        seenAt={seenAt}
        canRequest={t.status !== "stopped" && t.status !== "draft" && !u.holdStartedAt && !restricted}
        noRequestReason={t.status === "stopped" ? "" : u.holdStartedAt ? "Your tests are paused until you pay what you owe: calls wait meanwhile." : ""}
        testers={restricted ? devTesters.map((x) => ({ ...x, requests: [] })) : devTesters}
        // (Batch 16 sections 33 and 35) The one Call requests panel: every waiting request, both directions (Needs you's rows open it here).
        requests={restricted ? [] : reqs.flatMap((r) => {
          const c = working.find((x) => x.id === r.contractId);
          return c ? [{ id: r.id, contractId: c.id, tester: displayName(c.tester), asker: r.fromSide === "developer" ? "you" : displayName(c.tester), rows: toJson(rowsOf(r)), minutes: r.minutes, mine: r.fromSide === "developer", rate: rateLabel(callListed(t, c) ? c.liveRateCents : null, c.liveRateCents), warning: callsWarn.get(c.id) || undefined }] : [];
        })}
        elsewhere={otherCalls}
      />
      {t.status !== "stopped" && !restricted && (
        <InvitePanel
          testId={t.id}
          seenAt={seenAt}
          options={{ devices: t.devices, languages: t.languages }}
          perks={perks}
          initial={invitePanelData ?? { worked: [], suggested: [], found: [], foundTotal: 0, capLine: "", searched: false }}
          sent={expired ? [] : invites.filter((i) => i.status === "sent").map((i) => ({ id: i.id, name: people.get(i.testerId) ?? "?", status: "waiting for them to join" }))}
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
        <ByQuestion
          blocks={byQuestion(
            (t.questions as string[]) ?? [],
            t.contracts.flatMap((c) =>
              c.submissions
                .filter((s) => s.kind === "written")
                .map((s) => ({
                  // (Batch 13 section 8) Grouped by the exact text of the question each answer was sent for.
                  ...((items) => ({ questions: items.map((i) => (i.required ? i.question : NOT_REQUIRED + i.question)), answers: items.map((i) => i.answer) }))(itemsOf(s.answers, writtenQuestions(c))),
                  contractId: c.id, tester: displayName(c.tester), notes: s.notes, sentAt: s.updatedAt,
                  status: (!s.review ? "waiting" : s.review.rejected && !(s.dispute?.decidedCents) ? "rejected" : "paid") as "paid" | "rejected" | "waiting",
                  paidCents: Math.max(s.review?.amountCents ?? 0, s.dispute?.decidedCents ?? 0),
                })),
            ),
          )}
        />
      </section>
    </>
  );
}
