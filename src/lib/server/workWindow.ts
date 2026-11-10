import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { testPaused, workDeadlineOf } from "@/lib/rules";
import { HttpError } from "./http";
import { closeOffersOfEnded } from "./offerClose";

type Reader = Pick<Prisma.TransactionClient, "test">;
import { ENDED_CAUSE, pressRefused } from "@/lib/refusal";

/**
 * (Owner, Nov 2, batch 35 §132) When testers' work on this test ends (the latest tester deadline, no earlier than Open until; the recorded end once it ended): the end of
 * the call window, no call time later. null for a draft, or (`developerId`) a test of someone else (nothing about it is told).
 */
export async function workEndOf(reader: Reader, testId: string, developerId?: string) {
  const t = await reader.test.findUnique({ where: { id: testId }, select: { status: true, openUntil: true, workEndedAt: true, developerId: true, contracts: { select: { dueAt: true } } } });
  if (!t || (developerId && t.developerId !== developerId)) return null;
  return t.workEndedAt ?? workDeadlineOf(t, t.contracts);
}

/** A stale press must refuse even before the background job has persisted the end. */
export async function assertWorkOpen(reader: Reader, testId: string, now = new Date(), /** (§364 item 2) the press refused */ press = "") {
  const t = await reader.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true, contracts: { select: { dueAt: true } } } });
  const at = t.workEndedAt ?? workDeadlineOf(t, t.contracts);
  // (Owner, Nov 9, §364 item 2; was "This test ended on <date>. Work already sent can still be paid.") The session page's top line keeps the date and what's left.
  if (t.workEndedAt || (t.status !== "draft" && !testPaused(t.developer, t) && at && at <= now)) throw new HttpError(409, "closed", pressRefused(ENDED_CAUSE, press));
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
    // (Owner, Nov 6, §286) The testers whose work this ends: their top box reads "This test ended", so their bell does too (below).
    const ending = await tx.contract.findMany({ where: { testId, status: "working" }, select: { id: true, title: true, testerId: true, tester: { select: { email: true } }, test: { select: { title: true } } } });
    await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: at, endReason: "The test ended." } });
    await (await import("./accessKeys")).releaseInactiveKeys(tx, testId);
    const cancelled = await cancelCallsAhead(tx, ids, "The test ended.", at);
    await closeOffersOfEnded(tx, ids, at); // (batch 35 §118) the part ended: its offer closes
    await tx.callRequest.updateMany({ where: { contractId: { in: ids }, status: "pending" }, data: { status: "closed", closedReason: "the test ended", decidedAt: at } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } });
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: at } });
    await recordEvent(tx, testId, "stopped", "The test was closed", true, { status: "closed", workEndedAt: at });
    return { at, cancelled, ending };
  });
  if (!result) return false;
  // (§286) In the words of the same closure's other bells (a pause running out, pauseClosure): "“Harbor Run” ended", in the day's "Tests stopped or ended" stack.
  const { notify } = await import("./notify");
  for (const c of result.ending) await notify(c.tester.email, `“${c.test.title}” ended`, [`“${c.test.title}” ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`], `/app/sessions/${c.id}`, { recipientId: c.testerId, group: "tstopped" });
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
