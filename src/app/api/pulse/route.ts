import { db } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// A small fingerprint of what an open page shows (events, payments, holds, disputes): pages poll it every ~20 s and
// refresh themselves when it changes (paid/rejected, paused/resumed, stop-once live lines, dispute status).
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    await (await import("@/lib/server/calls")).sweepNobodyJoined(); // (NEWEST+8) minute-accurate while a page is open
    const q = new URL(req.url).searchParams;
    // (Owner, Oct 29, batch 10) Payments: "Pay what you owe" updates live (a declined payment, a chargeback, a tester's Charge during the hold, or a payment from another tab).
    if (q.get("owed")) {
      const { owedLines } = await import("@/lib/server/holds");
      const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true, holdApprovedAt: true } });
      const lines = await owedLines(u.id);
      const paid = await db.payment.count({ where: { developerId: u.id } });
      const v = [lines.map((l) => `${l.id}:${l.amountCents}`).join(","), me.holdStartedAt?.getTime() ?? 0, me.holdReason, me.chargebackCardVerifiedAt?.getTime() ?? 0, me.chargebackApprovedAt?.getTime() ?? 0, me.holdApprovedAt?.getTime() ?? 0, paid].join("|");
      // Payments stays open during a hold or suspension, so it always refreshes.
      return ok({ v, restricted: false });
    }
    // (Owner, Oct 28, batch 16 section 32) The tester's invitations (dashboard and join page): any invite of theirs closing, re-sent or its test filling refreshes the page.
    if (q.get("invites")) {
      const invs = await db.invite.findMany({ where: { testerId: u.id }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, status: true, updatedAt: true, testId: true, test: { select: { spots: true, status: true } } } });
      const open = invs.filter((i) => i.status === "sent");
      const working = open.length ? await db.contract.groupBy({ by: ["testId"], where: { testId: { in: open.map((i) => i.testId) }, status: "working" }, _count: { _all: true } }) : [];
      const full = open.filter((i) => (working.find((w) => w.testId === i.testId)?._count._all ?? 0) >= i.test.spots).map((i) => i.id);
      return ok({ v: [invs.map((i) => `${i.id}:${i.status}:${i.updatedAt.getTime()}:${i.test.status}`).join(","), full.join(",")].join("|"), restricted: false });
    }
    // (Batch 17 section 17) "Ratings to give" on a dashboard: a row appearing or going (a dispute opening, a rating given, a window ending) refreshes it.
    const rates = q.get("rates");
    if (rates === "tester" || rates === "developer") {
      const { ratingsToGive } = await import("@/lib/server/ratings");
      return ok({ v: (await ratingsToGive(u, rates)).map((r) => `${r.id}:${r.text}`).join(","), restricted: false });
    }
    // (Batch 17 §18) The tester dashboard's "Tests visited": a listed test's state changing (filling, pausing, stopping, an invite or application of theirs…), a card
    // removed in another tab or a test joined refreshes it.
    if (q.get("visited")) {
      const { visitedTestsV } = await import("@/lib/server/testVisits");
      return ok({ v: await visitedTestsV(u.id), restricted: false });
    }
    // (Owner, Oct 28, batch 17 section 9) A developer's profile seen by someone else: its "Open tests" as this viewer may see them (a test filling up, pausing,
    // stopping, passing Open until, turning invite only for them or their invite closing leaves the list; a newly open test appears).
    const profileId = q.get("profile");
    if (profileId) {
      const { profileOpenTestsV } = await import("@/lib/server/profileOpenTests");
      const { isAdmin } = await import("@/lib/server/session");
      return ok({ v: await profileOpenTestsV(profileId, u, isAdmin(u)), restricted: false });
    }
    let testId = q.get("test") ?? "";
    const sessionId = q.get("session") ?? "";
    if (sessionId) {
      const c = await db.contract.findUnique({ where: { id: sessionId } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "Not found.");
      testId = c.testId;
    }
    const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true } } } });
    if (!t || (!sessionId && t.developerId !== u.id)) throw new HttpError(404, "not_found", "Not found.");
    const ids = (await db.contract.findMany({ where: { testId }, select: { id: true } })).map((c) => c.id);
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
    const own = sessionId ? null : await db.actionLog.findFirst({ where: { userId: u.id, testId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
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
    const rateV = sessionId ? (await (await import("@/lib/server/ratings")).testerRateState(sessionId)).line : "";
    // (Batch 10) The developer's suspension and the team's pause are in it too, so a tester's session page shows (or drops) the paused banner live.
    const v = [ev?.createdAt.getTime() ?? 0, pay.n, pay.last, t.developer.holdStartedAt?.getTime() ?? 0, t.status, disp.map((d) => d.status + (d.devSideAt?.getTime() ?? 0)).join(","), inv?.updatedAt.getTime() ?? 0, sus, msg?.createdAt.getTime() ?? 0, t.developer.devSuspendedAt?.getTime() ?? 0, t.adminPausedAt?.getTime() ?? 0, keysV, own?.createdAt.getTime() ?? 0, reqV?.updatedAt.getTime() ?? 0, profV?.getTime() ?? 0, ratingsN, rateV].join("|");
    // (Owner, Oct 28) Whether the team stopped the test: an open test page or Edit moves to the top of the test page at once.
    // (Batch 10) A tester's session page isn't restricted by the developer's hold (only the developer's own pages are): it keeps refreshing, so the paused banner shows live.
    // (Batch 15 section 16) Each side's own suspension: the tester side on a session page, the developer side on a test page.
    // (Batch 20 section 8) The viewer's own Alerts setting (the developer's ignored types, the tester's Off): an Alerts menu, toggle or stop box chip open in another
    // tab or browser follows a change made elsewhere on this poll (no refresh needed).
    const alerts = sessionId ? { testerOff: u.testerAlertsOff } : { ignored: u.ignoredAlerts };
    return ok({ v, adminStopped: !!t.adminStoppedAt, restricted: !!(sessionId ? u.testerSuspendedAt : u.devSuspendedAt || t.developer.holdStartedAt), alerts });
  });
}
