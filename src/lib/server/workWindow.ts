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
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    return closeWorkIfDueIn(tx, testId, now);
  });
  if (!result) return false;
  await afterWorkClosed(testId, result, now);
  return true;
}

/**
 * THE TEST CLOSING ON ITS OWN (the work window ended: the latest tester deadline, no earlier than Open until). The closure itself, in a transaction that already
 * holds the test's lock ((Owner, Nov 11, §375) a tester's Send / Add closes the work there, in its own pass, never with a second lock). Returns what
 * afterWorkClosed tells once the transaction is committed, or null when nothing was due.
 *   0. nothing due: a draft, stopped, already closed, paused, or the deadline not reached → null
 *   1. working sessions end ("closed"), keys released, calls ahead cancelled, offers / call requests / open call slots closed
 *   2. open invites cancelled, pending applications and asks closed ("stopped")
 *   3. the test closed ("The test was closed")
 */
export async function closeWorkIfDueIn(tx: Prisma.TransactionClient, testId: string, now = new Date()) {
  const { recordEvent, cancelCallsAhead } = await import("./tests");
  const t = await tx.test.findUnique({ where: { id: testId }, include: { developer: true, contracts: { select: { id: true, status: true, dueAt: true } } } });
  if (!t || t.status === "draft" || t.status === "stopped" || t.workEndedAt || testPaused(t.developer, t)) return null;
  const at = workDeadlineOf(t, t.contracts);
  if (!at || at > now) return null;
  const ids = t.contracts.map((c) => c.id);
  // 1. (Owner, Nov 6, §286) The testers whose work this ends: their top box reads "This test ended", so their bell does too (below).
  const endingSelect = { id: true, title: true, testerId: true, tester: { select: { email: true } }, test: { select: { title: true } } } as const;
  const ending = await tx.contract.findMany({ where: { testId, status: "working" }, select: endingSelect });
  await tx.contract.updateMany({ where: { testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: at, endReason: "The test ended." } });
  await (await import("./accessKeys")).releaseInactiveKeys(tx, testId);
  const cancelled = await cancelCallsAhead(tx, ids, "The test ended.", at);
  await closeOffersOfEnded(tx, ids, at); // (batch 35 §118) the part ended: its offer closes
  await tx.callRequest.updateMany({ where: { contractId: { in: ids }, status: "pending" }, data: { status: "closed", closedReason: "the test ended", decidedAt: at } });
  await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
  // 2. (Owner, Dec 10 2026) Its open invites close; each invitee is told (afterWorkClosed), like every other closure.
  const invitesClosed = await (await import("./invites")).openInviteIds({ testId }, tx);
  await tx.invite.updateMany({ where: { id: { in: invitesClosed }, status: "sent" }, data: { status: "cancelled" } });
  // (Owner, Nov 22 2026) Its pending applications and asks close too; each applicant is told (afterWorkClosed).
  const appsClosed = await (await import("./blocks")).pendingAppIds(testId, tx);
  await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: at } });
  // 3. The test closed.
  await recordEvent(tx, testId, "stopped", "The test was closed", true, { status: "closed", workEndedAt: at });
  return { at, cancelled, ending, appsClosed, invitesClosed };
}

/**
 * What a closure tells once its transaction is committed: the testers' bells, the calls at the deadline, the cancelled calls, then "Your invite to “<test>” was
 * closed." for each closed invite and "“<test>” closed, so your application was closed." for each closed application.
 */
export async function afterWorkClosed(testId: string, result: NonNullable<Awaited<ReturnType<typeof closeWorkIfDueIn>>>, now = new Date()) {
  // (§286) In the words of the same closure's other bells (a pause running out, pauseClosure): "“Harbor Run” ended", in the day's "Tests stopped or ended" stack.
  // (Owner, Nov 2026) `always`: emailed whatever the setting.
  const { notify } = await import("./notify");
  for (const c of result.ending) {
    const lines = [`“${c.test.title}” ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled.`];
    await notify(c.tester.email, `“${c.test.title}” ended`, lines, `/app/sessions/${c.id}`, { recipientId: c.testerId, group: "tstopped", always: true });
  }
  await (await import("./calls")).endCallsAtWorkDeadline(testId, result.at, now);
  await (await import("./tests")).tellCancelled(result.cancelled, "closed");
  // (Owner, Nov 11, §390 a) The developer didn't cause it either: their bell names each call.
  await (await import("./tests")).tellDevCancelled(result.cancelled, "the test ended");
  await (await import("./invites")).tellInvitesClosed(result.invitesClosed); // (Owner, Dec 10 2026) "Your invite to “<test>” was closed."
  await (await import("./blocks")).tellAppsClosed(result.appsClosed, "closed"); // (Owner, Nov 22 2026) like invited testers
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
