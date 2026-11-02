import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { testPaused, workDeadlineOf } from "@/lib/rules";
import { HttpError } from "./http";

type Reader = Pick<Prisma.TransactionClient, "test">;
export const workEndedLine = (at: Date) => `This test ended on ${fmtDate(at)}. Work already sent can still be paid.`;

/** A stale press must refuse even before the background job has persisted the end. */
export async function assertWorkOpen(reader: Reader, testId: string, now = new Date()) {
  const t = await reader.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true, contracts: { select: { dueAt: true } } } });
  const at = t.workEndedAt ?? workDeadlineOf(t, t.contracts);
  if (t.workEndedAt || (t.status !== "draft" && !testPaused(t.developer, t) && at && at <= now)) throw new HttpError(409, "closed", workEndedLine(at!));
}

/** One normal work closure, under the same test lock as a send, booking or listing save. */
export async function finishWorkIfDue(testId: string, now = new Date()) {
  const peek = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true } }, contracts: { select: { dueAt: true } } } });
  if (!peek || peek.status === "draft" || peek.status === "stopped" || peek.workEndedAt || testPaused(peek.developer, peek)) return false;
  const deadline = workDeadlineOf(peek, peek.contracts);
  if (!deadline || deadline > now) return false;
  const { recordEvent, cancelCallsAhead, tellCancelled } = await import("./tests");
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const t = await tx.test.findUnique({ where: { id: testId }, include: { developer: true, contracts: { select: { id: true, status: true, dueAt: true } } } });
    if (!t || t.status === "draft" || t.status === "stopped" || t.workEndedAt || testPaused(t.developer, t)) return null;
    const at = workDeadlineOf(t, t.contracts);
    if (!at || at > now) return null;
    const ids = t.contracts.map((c) => c.id);
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: at, endReason: "The test ended." } });
    const cancelled = await cancelCallsAhead(tx, ids, "The test ended.", at);
    await tx.termsOffer.updateMany({ where: { contractId: { in: ids }, status: "open" }, data: { status: "superseded", decidedAt: at } });
    await tx.callRequest.updateMany({ where: { contractId: { in: ids }, status: "pending" }, data: { status: "closed", closedReason: "the test ended", decidedAt: at } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: at } });
    await recordEvent(tx, testId, "stopped", "The test was closed", true, { status: "closed", workEndedAt: at });
    return { at, cancelled };
  });
  if (!result) return false;
  await (await import("./calls")).endCallsAtWorkDeadline(testId, result.at, now);
  await tellCancelled(result.cancelled, "closed");
  return true;
}

/** Checked on the live beat as well as daily, so unattended tests also finish. */
export async function closeWorkAfterDeadlines(now = new Date(), userId?: string) {
  const tests = await db.test.findMany({ where: {
    status: { in: ["open", "closed"] }, workEndedAt: null, adminPausedAt: null,
    developer: { holdStartedAt: null, devSuspendedAt: null },
    OR: [{ openUntil: { lte: now } }, { openUntil: null }],
    contracts: { none: { dueAt: { gt: now } } },
    ...(userId ? { AND: [{ OR: [{ developerId: userId }, { contracts: { some: { testerId: userId } } }] }] } : {}),
  }, select: { id: true } });
  let closed = 0;
  for (const t of tests) if (await finishWorkIfDue(t.id, now)) closed++;
  return closed;
}
