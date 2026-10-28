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
    const sus = sessionId ? 0 : await db.user.count({ where: { testerSuspendedAt: { not: null } } });
    // (Batch 14 section 6) The Access keys notice: keys added or deleted in Edit, or given at a join, refresh the page.
    const keyRows = sessionId ? [] : await db.accessKey.groupBy({ by: ["status"], where: { testId }, _count: { _all: true } });
    const keysV = keyRows.map((k) => `${k.status}:${k._count._all}`).sort().join(",");
    const pay = { n: payCount, last: (payLast?.createdAt.getTime() ?? 0) + (payLast?.status ?? "") };
    // (Batch 10) The developer's suspension and the team's pause are in it too, so a tester's session page shows (or drops) the paused banner live.
    const v = [ev?.createdAt.getTime() ?? 0, pay.n, pay.last, t.developer.holdStartedAt?.getTime() ?? 0, t.status, disp.map((d) => d.status + (d.devSideAt?.getTime() ?? 0)).join(","), inv?.updatedAt.getTime() ?? 0, sus, msg?.createdAt.getTime() ?? 0, t.developer.devSuspendedAt?.getTime() ?? 0, t.adminPausedAt?.getTime() ?? 0, keysV].join("|");
    // (Owner, Oct 28) Whether the team stopped the test: an open test page or Edit moves to the top of the test page at once.
    // (Batch 10) A tester's session page isn't restricted by the developer's hold (only the developer's own pages are): it keeps refreshing, so the paused banner shows live.
    // (Batch 15 section 16) Each side's own suspension: the tester side on a session page, the developer side on a test page.
    return ok({ v, adminStopped: !!t.adminStoppedAt, restricted: !!(sessionId ? u.testerSuspendedAt : u.devSuspendedAt || t.developer.holdStartedAt) });
  });
}
