import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DEV_STOP_KINDS, type TestEventLike } from "@/lib/rules";

type Tx = Prisma.TransactionClient;

// (Owner, Oct 22, NEWEST+3) Reason E: anything a person did themselves in ANOTHER tab since this page loaded stops the
// first press once ("You also did this in another tab: sent your written answers at 3:10 PM"). Every action is logged
// with the browser tab (page load) that sent it; that same tab never stops for its own presses.

export const OWN_PREFIX = "You also did this in another tab: ";

export const tabOf = (body: Record<string, unknown>) => (typeof body.tab === "string" ? body.tab.slice(0, 64) : "");

/** Log one thing a person did on a test (any button that changes something). */
export async function logAction(userId: string, testId: string, body: Record<string, unknown>, text: string) {
  await db.actionLog.create({ data: { userId, testId, text, tab: tabOf(body) } });
}

export function seenOf(v: unknown): Date | null {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

/** This person's own actions on the test since `since`, from other tabs. */
export async function ownChanges(userId: string, testId: string, since: Date, tab: string, tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const rows = await tx.actionLog.findMany({ where: { userId, testId, createdAt: { gt: since }, ...(tab ? { tab: { not: tab } } : { tab: { not: "" } }) }, orderBy: { createdAt: "asc" }, take: 50 });
  return rows.map((r) => ({ kind: "own", text: OWN_PREFIX + r.text, createdAt: r.createdAt }));
}

/**
 * The developer's stop-once reasons on a test since `since`: what testers did (joined, left, sent, calls, requests,
 * charges...) plus the developer's own actions in another tab. The developer's own events ("You paid ...") come only
 * through the action log, so the tab that did them never stops for them.
 */
export async function devChanges(devId: string, testId: string, since: Date, tab: string, tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const events = await tx.testEvent.findMany({ where: { testId, createdAt: { gt: since }, kind: { in: [...DEV_STOP_KINDS] } }, orderBy: { createdAt: "asc" }, take: 100 });
  const theirs = events.filter((e) => !e.text.startsWith("You "));
  return [...theirs, ...(await ownChanges(devId, testId, since, tab, tx))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** A line on the test's event list (what the developer's stop-once reasons and live top box read). */
export async function logEvent(testId: string, kind: string, text: string, contractId: string | null = null) {
  await db.testEvent.create({ data: { testId, kind, text, contractId } });
}

export const asLines = (changes: TestEventLike[]) => changes.map((e) => ({ text: e.text, at: e.createdAt, ...(e.kind === "info" ? { kind: "info" } : {}) }));
