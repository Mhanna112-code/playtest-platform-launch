import { MAX_ACTIVE_TESTS, workDeadlineOf } from "@/lib/rules";
import { revealedRatingsWhere } from "./ratings";
import { db } from "@/lib/db";

/**
 * (Batch 30 §8) The fingerprints the pages' AutoRefresh polls (/api/pulse), computed in one place so the page can render with the SAME value: AutoRefresh's baseline is
 * what the server rendered, not its first poll, and a change between the render and that first poll (an invite created right after the page loaded) refreshes the page.
 */

/** (Owner, Oct 28, batch 16 section 32) The tester's invitations (dashboard): any invite of theirs created, closing, re-sent or its test filling. */
export async function invitesV(testerId: string) {
  const invs = await db.invite.findMany({ where: { testerId }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, status: true, updatedAt: true, testId: true, test: { select: { spots: true, status: true } } } });
  const open = invs.filter((i) => i.status === "sent");
  const working = open.length ? await db.contract.groupBy({ by: ["testId"], where: { testId: { in: open.map((i) => i.testId) }, status: "working" }, _count: { _all: true } }) : [];
  const full = open.filter((i) => (working.find((w) => w.testId === i.testId)?._count._all ?? 0) >= i.test.spots).map((i) => i.id);
  return [invs.map((i) => `${i.id}:${i.status}:${i.updatedAt.getTime()}:${i.test.status}`).join(","), full.join(",")].join("|");
}

/**
 * (Owner's repro, Oct 29, batch 30 §8) The join page follows the tester's own application or ask to rejoin (`join=<testId>`): accepted, declined, closed or withdrawn,
 * and their session there starting (an accepted ask, an invite meeting the ask); (batch 34 §16) and an invite to it arriving.
 */
export async function joinPageV(testerId: string, testId: string) {
  const [a, c, i] = await Promise.all([
    db.application.findUnique({ where: { testId_testerId: { testId, testerId } }, select: { id: true, status: true, decidedAt: true, changedAt: true } }),
    db.contract.findUnique({ where: { testId_testerId: { testId, testerId } }, select: { id: true, status: true } }),
    // (Batch 34 §16) An invite arriving while the page is open: the page redraws to the invite card and Join (Apply / Ask to rejoin go).
    db.invite.findFirst({ where: { testId, testerId, status: "sent" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  const listing = await db.test.findUnique({ where: { id: testId }, select: { developerId: true, updatedAt: true, status: true, spots: true, openUntil: true, developer: { select: { holdStartedAt: true, devSuspendedAt: true } }, _count: { select: { contracts: { where: { status: "working" } } } } } });
  const [capacity, blocked, profile] = await Promise.all([
    db.contract.count({ where: { testerId, status: "working" } }),
    db.block.count({ where: { OR: [{ blockerId: testerId, blockedId: listing?.developerId ?? "" }, { blockedId: testerId, blockerId: listing?.developerId ?? "" }] } }),
    db.testerProfile.findUnique({ where: { userId: testerId }, select: { updatedAt: true } }),
  ]);
  const listingV = listing ? [listing.updatedAt.getTime(), listing.status, listing.spots, listing._count.contracts, listing.openUntil?.getTime() ?? 0, listing.developer.holdStartedAt?.getTime() ?? 0, listing.developer.devSuspendedAt?.getTime() ?? 0].join(":") : "";
  return [capacity >= MAX_ACTIVE_TESTS, blocked, profile?.updatedAt.getTime() ?? 0, listingV, listing?.openUntil && listing.openUntil <= new Date() ? "closed" : "open", a ? `${a.id}:${a.status}:${a.decidedAt?.getTime() ?? 0}:${a.changedAt?.getTime() ?? 0}` : "", c ? `${c.id}:${c.status}` : "", i?.id ?? ""].join("|");
}

/** (Batch 30 §8) The line the join page shows once its tester is in the test (an accepted application or ask), with their session. */
export async function joinedFromPage(testerId: string, testId: string) {
  const c = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } }, include: { test: { select: { title: true } } } });
  if (!c || c.status !== "working") return null;
  const a = await db.application.findUnique({ where: { testId_testerId: { testId, testerId } }, select: { kind: true } });
  const { T } = await import("@/lib/tz");
  return { line: a?.kind === "rejoin" ? joinBackLine(c.test.title, T(c.dueAt)) : joinInLine(c.test.title), href: `/app/sessions/${c.id}` };
}
/** "You're back in “Harbor Run”: your deadline is Nov 12, 3:00 PM." */
export const joinBackLine = (title: string, due: string) => `You're back in “${title}”: your deadline is ${due}.`;
/** "You're in: “Harbor Run”." (the accepted application's line, quoted) */
export const joinInLine = (title: string) => `You're in: “${title}”.`;
/** On the join page while their latest ask is declined. */
export const rejoinDeclinedLine = "Your ask to rejoin wasn't accepted.";
export const applyDeclinedLine = (title: string) => `Your application to “${title}” wasn't accepted.`;

/**
 * The test page's (`test=<id>`, the developer) or the session page's (`session=<id>`, the tester) fingerprint: events, payments, holds, disputes, invites, messages, keys,
 * the developer's own presses, call requests and calls, profiles, suspensions, ratings, ended sessions and blocks. "" when there's no such test (the caller checks access).
 */
export async function testV(viewerId: string, testId: string, sessionId = "") {
  await (await import("./workWindow")).finishWorkIfDue(testId);
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true, pronoun: true } } } });
  if (!t) return "";
  const cons = await db.contract.findMany({ where: { testId }, orderBy: { id: "asc" }, select: { id: true, status: true, endedAt: true, testerId: true, dueAt: true, tester: { select: { pronoun: true } } } });
  // (Owner, Nov 3, batch 35 §162) Every line about a person reads their recorded pronoun: a pronoun changed on the profile (the developer's, a tester's in the
  // test, or an applicant's) redraws the open test and session pages on the next poll.
  const applicants = sessionId ? [] : (await db.application.findMany({ where: { testId, status: "pending" }, select: { testerId: true } })).map((a) => a.testerId);
  const appPronouns = applicants.length ? await db.user.findMany({ where: { id: { in: applicants } }, orderBy: { id: "asc" }, select: { pronoun: true } }) : [];
  const pronounsV = [t.developer.pronoun, ...cons.map((c) => c.tester.pronoun), ...appPronouns.map((a) => a.pronoun)].join(",");
  const ids = cons.map((c) => c.id);
  // (Owner, Nov 2, batch 35 §132) When testers' work on the test ends: the call request forms' latest time and their calls drop-downs. It moves (Open until extended, a
  // tester joining with a later deadline, a pause lifted) without a test event, so it's in the fingerprint and the forms' limits follow on the normal poll.
  const workEnd = (t.workEndedAt ?? workDeadlineOf(t, cons))?.getTime() ?? 0;
  // (Owner, Oct 29, batch 29 §36; batch 28 §9's unchecked part) A block (either way) ends the session, cancels its calls and closes its requests without a test
  // event: the sessions' states, the calls' states and the block itself are in the fingerprint, so the session page drops Join call, Request a time and the call
  // requests on its normal poll (and the test page its rows' call buttons).
  const consV = cons.filter((c) => c.status !== "working").map((c) => `${c.id}:${c.status}:${c.endedAt?.getTime() ?? 0}`).sort().join(",");
  // Each tester's displayed deadline can move without changing the overall work window or recording an edit event.
  const deadlinesV = cons.map((c) => `${c.id}:${c.dueAt.getTime()}`).join(",");
  const callsV = await db.call.aggregate({ where: { contractId: { in: ids } }, _count: { _all: true }, _max: { cancelledAt: true, endedAt: true } });
  const callsKey = `${callsV._count._all}:${callsV._max.cancelledAt?.getTime() ?? 0}:${callsV._max.endedAt?.getTime() ?? 0}`;
  const sessionTester = sessionId ? cons.find((c) => c.id === sessionId)?.testerId ?? "" : "";
  const blocksV = sessionId ? await db.block.count({ where: { OR: [{ blockerId: sessionTester, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: sessionTester }] } }) : 0;
  const [ev, payCount, payLast, disp] = await Promise.all([
    db.testEvent.findFirst({ where: { testId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.payment.count({ where: { contractId: { in: ids } } }),
    db.payment.findFirst({ where: { contractId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
    db.dispute.findMany({ where: { contractId: { in: ids } }, select: { status: true, devSideAt: true } }),
  ]);
  const msg = await db.message.findFirst({ where: { testId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const inv = await db.invite.findFirst({ where: { testId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  // (Owner, Oct 28, batch 16 section 21) What the developer did in another tab (a call request, a Pay, an End early…): this tab's page updates on its poll
  // (most of those give no live line). Call requests and calls are in it too, whoever changed them.
  const own = sessionId ? null : await db.actionLog.findFirst({ where: { userId: viewerId, testId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const reqV = await db.callRequest.findFirst({ where: { testId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  // (Batch 16 section 31) A tester's devices or languages changed: the developer's invite panel recomputes its tags, greys and Suggested order.
  const profV = sessionId ? null : (await db.testerProfile.aggregate({ _max: { updatedAt: true } }))._max.updatedAt;
  const sus = sessionId ? 0 : await db.user.count({ where: { testerSuspendedAt: { not: null } } });
  // (Batch 14 section 6) The Access keys notice: keys added or deleted in Edit, or given at a join, refresh the page.
  const keyRows = sessionId ? [] : await db.accessKey.groupBy({ by: ["status"], where: { testId }, _count: { _all: true } });
  const keysV = keyRows.map((k) => `${k.status}:${k._count._all}`).sort().join(",");
  // (Batch 34 §12, owner's finding) The session's own key (given by the developer's Save, held, given back): the tester's page redraws at once and the key box shows.
  // (Owner, Nov 6, §304) No "reported" / "fixed" states any more, so no fixedAt.
  const myKeys = sessionId ? await db.accessKey.findMany({ where: { contractId: sessionId }, orderBy: { id: "asc" }, select: { id: true, status: true } }) : [];
  const myKeyV = myKeys.map((k) => `${k.id}:${k.status}`).join(",");
  const bankActions = await db.payment.findMany({ where: { contractId: { in: ids }, status: "needs_action" }, orderBy: { id: "asc" }, select: { id: true, actionBy: true } });
  const bankActionsV = bankActions.map((p) => `${p.id}:${p.actionBy && p.actionBy.getTime() > Date.now() ? "waiting" : "expired"}`).join(",");
  const elsewhere = await db.call.findMany({ where: { status: "booked", startsAt: { gt: new Date(Date.now() - 6 * 3_600_000) }, contract: sessionId ? { testerId: viewerId, id: { not: sessionId } } : { test: { developerId: viewerId, id: { not: testId } } } }, orderBy: { id: "asc" }, select: { id: true, startsAt: true, minutes: true, contract: { select: { tester: { select: { name: true, email: true } }, test: { select: { developer: { select: { name: true, email: true } } } } } } } });
  const elsewhereV = JSON.stringify(elsewhere);
  const pay = { n: payCount, last: (payLast?.createdAt.getTime() ?? 0) + (payLast?.status ?? "") };
  // (Batch 17 sections 1 and 16) A Rate box opening, greying or going as things are decided: ratings given, and (a session) the tester's own Rate state.
  const ratingsN = await db.rating.count({ where: { testId } });
  const allRatings = sessionId ? null : await db.rating.aggregate({ where: revealedRatingsWhere(), _count: { _all: true }, _sum: { stars: true }, _max: { revealedAt: true, createdAt: true } });
  const ratingRowsV = allRatings ? `${allRatings._count._all}:${allRatings._sum.stars ?? 0}:${allRatings._max.revealedAt?.getTime() ?? 0}:${allRatings._max.createdAt?.getTime() ?? 0}` : "";
  const rateV = sessionId ? (await (await import("./ratings")).testerRateState(sessionId)).line : "";
  // (Owner, Nov 2, batch 35 §126) Excerpt requests and decisions record no test event: a request arriving, Allowed, Denied or Removed redraws the developer's
  // Needs you and Shown excerpts, and the tester's session page (its "waiting for" note and Show an excerpt), on the normal poll. No live line.
  const excerpts = await db.excerpt.findMany({ where: sessionId ? { contractId: sessionId } : { testId }, orderBy: { id: "asc" }, select: { id: true, status: true } });
  const excerptsV = excerpts.map((x) => `${x.id}:${x.status}`).join(",");
  // (Owner, Nov 5, §272) The test page shows the developer's own chargeback steps: Verify a card done in another tab or device (or the team's approval)
  // redraws it on the next poll, the step ticked and the button gone.
  const cbV = sessionId ? "" : await (await import("./pageFreshness")).chargebackStateV(viewerId);
  // (Batch 10) The developer's suspension and the team's pause are in it too, so a tester's session page shows (or drops) the paused banner live.
  return [ev?.createdAt.getTime() ?? 0, pay.n, pay.last, bankActionsV, elsewhereV, t.developer.holdStartedAt?.getTime() ?? 0, t.status, disp.map((d) => d.status + (d.devSideAt?.getTime() ?? 0)).join(","), inv?.updatedAt.getTime() ?? 0, sus, msg?.createdAt.getTime() ?? 0, t.developer.devSuspendedAt?.getTime() ?? 0, t.adminPausedAt?.getTime() ?? 0, keysV, own?.createdAt.getTime() ?? 0, reqV?.updatedAt.getTime() ?? 0, profV?.getTime() ?? 0, ratingsN, ratingRowsV, rateV, consV, deadlinesV, callsKey, blocksV, excerptsV, cbV, workEnd, pronounsV, myKeyV].join("|");
}

/** (Owner, Oct 29, batch 10) Payments'"Pay what you owe": a declined payment, a chargeback, a tester's Charge during the hold, a payment from another tab, a reservation. */
export async function owedV(developerId: string) {
  const { owedLines } = await import("./holds");
  const me = await db.user.findUniqueOrThrow({ where: { id: developerId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true, holdApprovedAt: true } });
  // (Batch 35 §117) A line locked by a bank check, or unlocked by Cancel this check, redraws too.
  const lines = await owedLines(developerId);
  const paid = await db.payment.count({ where: { developerId } });
  // (Batch 23 section 6) A reservation made, taken, released or lapsed (another tab, the team, the clock).
  const reserves = (await db.reservation.findMany({ where: { developerId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true } })).map((r) => `${r.id}:${r.status}`).join(",");
  return [lines.map((l) => `${l.id}:${l.amountCents}${l.checkId ? `:${l.checkId}` : ""}`).join(","), me.holdStartedAt?.getTime() ?? 0, me.holdReason, me.chargebackCardVerifiedAt?.getTime() ?? 0, me.chargebackApprovedAt?.getTime() ?? 0, me.holdApprovedAt?.getTime() ?? 0, paid, reserves].join("|");
}

/**
 * (Owner, Oct 30, batch 33 §7) A profile's admin box (`adminPerson=<id>`): that account's suspension, deletion and hold state and its account history (a suspend,
 * reinstate, delete or $0 close-out by another admin), so a second admin's open profile redraws without a reload.
 */
export async function adminPersonV(userId: string) {
  const [u, ev, acted] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { devSuspendedAt: true, testerSuspendedAt: true, deletedAt: true, holdStartedAt: true, holdApprovedAt: true, pronoun: true } }),
    db.accountEvent.aggregate({ where: { userId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.adminAction.aggregate({ where: { targetId: userId }, _count: { _all: true }, _max: { createdAt: true } }),
  ]);
  const t = (d: Date | null | undefined) => d?.getTime() ?? 0;
  return u ? [t(u.devSuspendedAt), t(u.testerSuspendedAt), t(u.deletedAt), t(u.holdStartedAt), t(u.holdApprovedAt), ev._count._all, t(ev._max.createdAt), acted._count._all, t(acted._max.createdAt), u.pronoun /* (§162) the box titles' pronoun */].join(":") : "";
}

/**
 * (Owner, Oct 30, batch 33 §7) The admin console (`adminConsole=1`): the newest rows of its lists and every admin's latest action (a pause lifted, a dispute decided,
 * a hold approved, an account suspended or reinstated elsewhere), so the console redraws when another admin changed something.
 */
export async function adminConsoleV() {
  const t = (d: Date | null | undefined) => d?.getTime() ?? 0;
  const [acts, events, disputes, reports, contact, replied, noShows, holds, cbs, outages, gaps, suspended] = await Promise.all([
    db.adminAction.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    db.accountEvent.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    db.dispute.aggregate({ _count: { _all: true }, _max: { createdAt: true, decidedAt: true, devSideAt: true } }),
    db.report.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    db.contactMessage.aggregate({ _count: { _all: true }, _max: { createdAt: true, repliedAt: true } }),
    db.contactMessage.count({ where: { repliedById: { not: null } } }),
    db.call.aggregate({ where: { noShowBy: { not: null } }, _count: { _all: true }, _max: { noShowAt: true } }),
    db.user.aggregate({ where: { holdStartedAt: { not: null } }, _count: { _all: true }, _max: { holdStartedAt: true } }),
    db.payment.aggregate({ where: { chargeback: "open" }, _count: { _all: true }, _max: { chargebackAt: true, settledAt: true }, _sum: { reversedCents: true } }), // (§133) a dispute amount changing
    db.outage.aggregate({ _count: { _all: true }, _max: { recordedAt: true, approvedAt: true } }),
    db.appState.count({ where: { key: { startsWith: "gap:" } } }), // heartbeat gaps waiting (outages.ts GAP_PREFIX)
    db.user.count({ where: { OR: [{ devSuspendedAt: { not: null } }, { testerSuspendedAt: { not: null } }] } }),
  ]);
  return [
    acts._count._all, t(acts._max.createdAt), events._count._all, t(events._max.createdAt),
    disputes._count._all, t(disputes._max.createdAt), t(disputes._max.decidedAt), t(disputes._max.devSideAt),
    reports._count._all, t(reports._max.createdAt), contact._count._all, t(contact._max.createdAt), t(contact._max.repliedAt), replied,
    noShows._count._all, t(noShows._max.noShowAt), holds._count._all, t(holds._max.holdStartedAt), cbs._count._all, t(cbs._max.chargebackAt), t(cbs._max.settledAt), cbs._sum.reversedCents ?? 0,
    outages._count._all, t(outages._max.recordedAt), t(outages._max.approvedAt), gaps, suspended,
  ].join(":");
}
