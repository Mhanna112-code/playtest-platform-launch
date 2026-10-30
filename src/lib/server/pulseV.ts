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
 * The test page's (`test=<id>`, the developer) or the session page's (`session=<id>`, the tester) fingerprint: events, payments, holds, disputes, invites, messages, keys,
 * the developer's own presses, call requests and calls, profiles, suspensions, ratings, ended sessions and blocks. "" when there's no such test (the caller checks access).
 */
export async function testV(viewerId: string, testId: string, sessionId = "") {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true } } } });
  if (!t) return "";
  const cons = await db.contract.findMany({ where: { testId }, select: { id: true, status: true, endedAt: true, testerId: true } });
  const ids = cons.map((c) => c.id);
  // (Owner, Oct 29, batch 29 §36; batch 28 §9's unchecked part) A block (either way) ends the session, cancels its calls and closes its requests without a test
  // event: the sessions' states, the calls' states and the block itself are in the fingerprint, so the session page drops Join call, Request a time and the call
  // requests on its normal poll (and the test page its rows' call buttons).
  const consV = cons.filter((c) => c.status !== "working").map((c) => `${c.id}:${c.status}:${c.endedAt?.getTime() ?? 0}`).sort().join(",");
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
  const pay = { n: payCount, last: (payLast?.createdAt.getTime() ?? 0) + (payLast?.status ?? "") };
  // (Batch 17 sections 1 and 16) A Rate box opening, greying or going as things are decided: ratings given, and (a session) the tester's own Rate state.
  const ratingsN = await db.rating.count({ where: { testId } });
  const rateV = sessionId ? (await (await import("./ratings")).testerRateState(sessionId)).line : "";
  // (Batch 10) The developer's suspension and the team's pause are in it too, so a tester's session page shows (or drops) the paused banner live.
  return [ev?.createdAt.getTime() ?? 0, pay.n, pay.last, t.developer.holdStartedAt?.getTime() ?? 0, t.status, disp.map((d) => d.status + (d.devSideAt?.getTime() ?? 0)).join(","), inv?.updatedAt.getTime() ?? 0, sus, msg?.createdAt.getTime() ?? 0, t.developer.devSuspendedAt?.getTime() ?? 0, t.adminPausedAt?.getTime() ?? 0, keysV, own?.createdAt.getTime() ?? 0, reqV?.updatedAt.getTime() ?? 0, profV?.getTime() ?? 0, ratingsN, rateV, consV, callsKey, blocksV].join("|");
}

/** (Owner, Oct 29, batch 10) Payments'"Pay what you owe": a declined payment, a chargeback, a tester's Charge during the hold, a payment from another tab, a reservation. */
export async function owedV(developerId: string) {
  const { owedLines } = await import("./holds");
  const me = await db.user.findUniqueOrThrow({ where: { id: developerId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true, holdApprovedAt: true } });
  const lines = await owedLines(developerId);
  const paid = await db.payment.count({ where: { developerId } });
  // (Batch 23 section 6) A reservation made, taken, released or lapsed (another tab, the team, the clock).
  const reserves = (await db.reservation.findMany({ where: { developerId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true } })).map((r) => `${r.id}:${r.status}`).join(",");
  return [lines.map((l) => `${l.id}:${l.amountCents}`).join(","), me.holdStartedAt?.getTime() ?? 0, me.holdReason, me.chargebackCardVerifiedAt?.getTime() ?? 0, me.chargebackApprovedAt?.getTime() ?? 0, me.holdApprovedAt?.getTime() ?? 0, paid, reserves].join("|");
}
