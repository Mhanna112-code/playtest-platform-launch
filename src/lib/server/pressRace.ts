import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { currentQuestionsFor } from "@/lib/additions";
import { qText } from "@/lib/questions";
import { HttpError } from "./http";

/**
 * (Owner, Nov 10, §369) "The result must never depend on timing." A tester's press that checks before the test's lock and writes under it (Send Answers, Add to
 * this answer, a recording's Send / Add, Dispute, Charge, Let it go) takes a FINGERPRINT at its first look: the contract's questions (by their words), its parts,
 * reviews, payments and disputes, the newest test event and the newest own action on the test. Under the lock it reads the fingerprint again, questions first:
 * any difference rolls everything back (PressChanged) and the press runs its whole check sequence once more from the top, outside the transaction, on fresh
 * data, so it ends exactly as a press made a moment later would: the normal stop-once box (the question changes, "You sent your written answers in another
 * tab", anything else since the page loaded, in ONE box), a refusal that is final whatever the timing, or the write. At most two reruns; the second rerun's
 * result stands (its lock still refuses a press whose questions changed, never writing answers to questions it didn't show).
 */

type Q = Prisma.TransactionClient | typeof db;

/** Something the press read before the lock changed by the time it held it: nothing was written; run the press again. */
export class PressChanged extends Error {
  constructor(readonly what: "questions" | "state") {
    super(`press changed: ${what}`);
  }
}

export type PressPrint = { questions: string; state: string };

/** The fingerprint of what a tester's press on this contract decides by. */
export async function pressPrint(q: Q, p: { testId: string; contractId: string; userId: string }): Promise<PressPrint> {
  const c = await q.contract.findUnique({ where: { id: p.contractId }, select: { questions: true, status: true } });
  const subs = await q.submission.findMany({ where: { contractId: p.contractId }, orderBy: { id: "asc" }, select: { id: true, kind: true, updatedAt: true } });
  const reviews = await q.review.findMany({ where: { contractId: p.contractId }, orderBy: { id: "asc" }, select: { id: true, amountCents: true } });
  const pays = await q.payment.findMany({ where: { contractId: p.contractId }, orderBy: { id: "asc" }, select: { id: true, status: true } });
  const disputes = await q.dispute.findMany({ where: { contractId: p.contractId }, orderBy: { id: "asc" }, select: { id: true, status: true, devSideAt: true } });
  const recs = await q.recording.findMany({ where: { contractId: p.contractId }, orderBy: { id: "asc" }, select: { id: true, submissionId: true, uploadedAt: true } });
  const event = await q.testEvent.findFirst({ where: { testId: p.testId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const own = await q.actionLog.findFirst({ where: { userId: p.userId, testId: p.testId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return {
    questions: JSON.stringify(c ? currentQuestionsFor(c).map(qText) : null),
    state: JSON.stringify({ status: c?.status, subs, reviews, pays, disputes, recs, event: event?.id ?? null, own: own?.id ?? null }),
  };
}

/**
 * Under the lock: the questions first, then the rest. `strict` false (the second rerun): only a questions change still stops the write, with `lastLine` (the
 * press's own refusal for it), so answers are never written to questions the page didn't show.
 */
export async function checkPrint(q: Q, p: { testId: string; contractId: string; userId: string }, first: PressPrint, strict: boolean, lastLine?: HttpError) {
  const now = await pressPrint(q, p);
  if (now.questions !== first.questions) {
    if (strict) throw new PressChanged("questions");
    if (lastLine) throw lastLine;
  }
  if (strict && now.state !== first.state) throw new PressChanged("state");
}

/** Runs the press; on PressChanged runs it again from the top (twice at most, the last one not strict). */
export async function rerunOnChange<T>(run: (strict: boolean) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt < 2);
    } catch (e) {
      if (e instanceof PressChanged && attempt < 2) continue;
      throw e;
    }
  }
}

/** (§369) Test hook: a pause between a press's checks and its lock (the window a race needs). Only when tests set it. */
export async function beforeLock(name: string) {
  const hook = (globalThis as { __pressHooks?: Record<string, () => Promise<void>> }).__pressHooks?.[name];
  if (hook) await hook();
}
