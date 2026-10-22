import { db } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// A small fingerprint of what an open page shows (events, payments, holds, disputes): pages poll it every ~20 s and
// refresh themselves when it changes (paid/rejected, paused/resumed, stop-once live lines, dispute status).
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const q = new URL(req.url).searchParams;
    let testId = q.get("test") ?? "";
    const sessionId = q.get("session") ?? "";
    if (sessionId) {
      const c = await db.contract.findUnique({ where: { id: sessionId } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "Not found.");
      testId = c.testId;
    }
    const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true } } } });
    if (!t || (!sessionId && t.developerId !== u.id)) throw new HttpError(404, "not_found", "Not found.");
    const ids = (await db.contract.findMany({ where: { testId }, select: { id: true } })).map((c) => c.id);
    const [ev, payCount, payLast, disp] = await Promise.all([
      db.testEvent.findFirst({ where: { testId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.payment.count({ where: { contractId: { in: ids } } }),
      db.payment.findFirst({ where: { contractId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
      db.dispute.findMany({ where: { contractId: { in: ids } }, select: { status: true, devSideAt: true } }),
    ]);
    const inv = await db.invite.findFirst({ where: { testId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    const sus = sessionId ? 0 : await db.user.count({ where: { suspendedAt: { not: null } } });
    const pay = { n: payCount, last: (payLast?.createdAt.getTime() ?? 0) + (payLast?.status ?? "") };
    const v = [ev?.createdAt.getTime() ?? 0, pay.n, pay.last, t.developer.holdStartedAt?.getTime() ?? 0, t.status, disp.map((d) => d.status + (d.devSideAt?.getTime() ?? 0)).join(","), inv?.updatedAt.getTime() ?? 0, sus].join("|");
    return ok({ v });
  });
}
