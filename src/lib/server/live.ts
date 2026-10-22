import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
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
  return [...theirs, ...(await devPaymentChanges(testId, since, tx)), ...(await ownChanges(devId, testId, since, tab, tx))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function subKinds(ids: (string | null)[], tx: Tx | typeof db = db) {
  const subs = await tx.submission.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, kind: true } });
  return new Map(subs.map((s) => [s.id, s.kind]));
}
const pieceLabel = (p: { kind: string; callId: string | null; submissionId: string | null }, kinds: Map<string, string>) =>
  p.kind === "dispute" ? "dispute decision" : p.callId ? "live call" : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers";

/**
 * (NEWEST+3, payments) The developer's payment changes on THIS test only: a charge declined, a daily retry declined,
 * a delayed payment that went through. (Chargebacks and admin decisions are events; a hold shows as the paused banner.)
 */
export async function devPaymentChanges(testId: string, since: Date, tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const contracts = await tx.contract.findMany({ where: { testId }, select: { id: true, tester: true } });
  const name = new Map(contracts.map((c) => [c.id, displayName(c.tester)]));
  const pays = await tx.payment.findMany({
    where: { contractId: { in: contracts.map((c) => c.id) }, OR: [{ status: "failed", createdAt: { gt: since } }, { status: "failed", retriedAt: { gt: since } }, { settledAt: { gt: since } }] },
    take: 100,
  });
  const kinds = await subKinds(pays.map((p) => p.submissionId), tx);
  const out: TestEventLike[] = [];
  for (const p of pays) {
    const what = `your ${money(p.amountCents)} payment to ${name.get(p.contractId!) ?? "a tester"} for the ${pieceLabel(p, kinds)}`;
    if (p.settledAt && p.settledAt > since) out.push({ kind: "payment", text: `Your delayed ${money(p.amountCents)} payment to ${name.get(p.contractId!) ?? "a tester"} for the ${pieceLabel(p, kinds)} went through`, createdAt: p.settledAt });
    else if (p.status === "failed" && p.retriedAt && p.retriedAt > since) out.push({ kind: "payment", text: `Today's retry of ${what} was declined`, createdAt: p.retriedAt });
    else if (p.status === "failed" && p.createdAt > since) out.push({ kind: "payment", text: `${what[0].toUpperCase()}${what.slice(1)} was declined`, createdAt: p.createdAt });
  }
  return out;
}

/**
 * (NEWEST+3, payments) The tester's payment changes on their own session: a payment delayed (an owed charge or one
 * deferred by a hold; a declined Pay the developer must press again is not a payment yet), a delayed payment that
 * arrived, the team's decision on their dispute. Never the words "failed", "hold" or "chargeback".
 */
export async function testerPaymentChanges(contractId: string, since: Date): Promise<TestEventLike[]> {
  const [pays, disputes] = await Promise.all([
    db.payment.findMany({ where: { contractId, OR: [{ status: "failed", owedUntil: { not: null }, createdAt: { gt: since } }, { status: "deferred", createdAt: { gt: since } }, { settledAt: { gt: since } }] }, take: 50 }),
    db.dispute.findMany({ where: { contractId, decidedAt: { gt: since } } }),
  ]);
  const kinds = await subKinds(pays.map((p) => p.submissionId));
  const out: TestEventLike[] = [];
  for (const p of pays) {
    const what = `${money(p.amountCents)} for your ${pieceLabel(p, kinds) === "dispute decision" ? "dispute" : pieceLabel(p, kinds)}`;
    if (p.settledAt && p.settledAt > since) out.push({ kind: "payment", text: `A delayed payment of ${what} arrived`, createdAt: p.settledAt });
    else out.push({ kind: "payment", text: `The payment of ${what} is delayed`, createdAt: p.createdAt });
  }
  for (const d of disputes) {
    const r = await db.review.findFirst({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
    const raised = d.decidedCents != null && r && d.decidedCents > r.amountCents;
    out.push({ kind: "admin", text: raised ? `The team decided your dispute: the pay was raised to ${money(d.decidedCents!)}` : `The team decided your dispute: the pay stays at ${money(r?.amountCents ?? 0)}`, createdAt: d.decidedAt! });
  }
  return out;
}

/** A line on the test's event list (what the developer's stop-once reasons and live top box read). */
export async function logEvent(testId: string, kind: string, text: string, contractId: string | null = null) {
  await db.testEvent.create({ data: { testId, kind, text, contractId } });
}

export const asLines = (changes: TestEventLike[]) => changes.map((e) => ({ text: e.text, at: e.createdAt, ...(e.kind === "info" ? { kind: "info" } : {}) }));
