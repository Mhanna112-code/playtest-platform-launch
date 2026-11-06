import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { REQUEST_BOXES, appRow, callRow, devPartRow, requestRow, testerRow } from "@/lib/lineAnchors";

type Tx = Prisma.TransactionClient;

/**
 * (Owner, Nov 6, §284) The developer's top-box lines each open what they are about, ignored (greyed) lines too. New events store their place when they are
 * recorded (recordEvent's `link`); an older one with none gets it here, at read time, from its kind, its contract and the row changed with it (the same
 * transaction: within a minute of the event):
 * - a tester joining, leaving, rating, switching terms, reporting a key, a bank reversal: that tester's row in the Testers list;
 * - a tester's call request: its row in Call requests (the box once it has left); one withdrawn, declined or dropped: the same;
 * - a call booked: the call's row; a call cancelled: the call's row;
 * - the team's decision on a dispute: the part it decided;
 * - an application ("applied to join", "asks to rejoin"): its Needs you Applications row.
 */
export const TESTER_ROW_KINDS = new Set(["joined", "auto_joined", "left", "rated", "key", "terms", "chargeback"]);
const REQUEST_KINDS = new Set(["requested", "withdrew_req", "declined_req", "req_dropped", "req_closed"]);
const NEAR_MS = 60_000;
type Ev = { kind: string; text: string; createdAt: Date; contractId: string | null; link: string };

/** The row whose time (`when`) is closest to `at`, within a minute. */
function nearest<T>(rows: T[], at: Date, when: (r: T) => Date | null | undefined): T | undefined {
  let best: T | undefined, gap = NEAR_MS + 1;
  for (const r of rows) {
    const w = when(r);
    const d = w ? Math.abs(w.getTime() - at.getTime()) : Infinity;
    if (d < gap) { best = r; gap = d; }
  }
  return best;
}
const isTeamDecision = (e: { kind: string; text: string }) => e.kind === "admin" && e.text.startsWith("The team decided ");

/** (§284) `events` with a `link` on each one that has a place and stored none. */
export async function withEventLinks<T extends Ev>(testId: string, events: T[], tx: Tx | typeof db = db): Promise<T[]> {
  const need = events.filter((e) => !e.link);
  if (!need.length) return events;
  const contracts = [...new Set(need.map((e) => e.contractId).filter((x): x is string => !!x))];
  const times = need.map((e) => e.createdAt.getTime());
  const lo = new Date(Math.min(...times) - NEAR_MS), hi = new Date(Math.max(...times) + NEAR_MS);
  const span = { gte: lo, lte: hi };
  const wants = (f: (e: T) => boolean) => need.some(f);
  const [reqs, calls, disputes, apps] = await Promise.all([
    contracts.length && wants((e) => REQUEST_KINDS.has(e.kind) || e.kind === "booked")
      ? tx.callRequest.findMany({ where: { contractId: { in: contracts }, OR: [{ createdAt: span }, { decidedAt: span }, { updatedAt: span }] }, select: { id: true, contractId: true, fromSide: true, createdAt: true, decidedAt: true, updatedAt: true, callId: true } })
      : [],
    contracts.length && wants((e) => e.kind === "cancelled") ? tx.call.findMany({ where: { contractId: { in: contracts }, cancelledAt: span }, select: { id: true, contractId: true, cancelledAt: true } }) : [],
    contracts.length && wants(isTeamDecision) ? tx.dispute.findMany({ where: { contractId: { in: contracts }, decidedAt: span }, select: { contractId: true, decidedAt: true, submissionId: true, callId: true } }) : [],
    wants((e) => e.kind === "applied") ? tx.application.findMany({ where: { testId, createdAt: span }, select: { id: true, createdAt: true } }) : [],
  ]);
  const linkOf = (e: T): string => {
    const cid = e.contractId;
    if (TESTER_ROW_KINDS.has(e.kind)) return cid ? testerRow(cid) : "";
    if (e.kind === "applied") {
      if (!/ (applied to join|asks to rejoin)$/.test(e.text)) return "";
      const a = nearest(apps, e.createdAt, (x) => x.createdAt);
      return a ? appRow(a.id) : "";
    }
    if (!cid) return "";
    const mine = <R extends { contractId: string }>(rows: R[]) => rows.filter((r) => r.contractId === cid);
    if (e.kind === "requested") {
      const r = nearest(mine(reqs).filter((x) => x.fromSide === "tester"), e.createdAt, (x) => x.createdAt);
      return r ? requestRow(r.id) : REQUEST_BOXES[1];
    }
    if (REQUEST_KINDS.has(e.kind)) {
      const r = nearest(mine(reqs), e.createdAt, (x) => x.decidedAt ?? x.updatedAt);
      return r ? requestRow(r.id) : REQUEST_BOXES[1];
    }
    if (e.kind === "booked") {
      const r = nearest(mine(reqs).filter((x) => x.callId), e.createdAt, (x) => x.decidedAt);
      return r?.callId ? callRow(r.callId) : testerRow(cid);
    }
    if (e.kind === "cancelled") {
      const c = nearest(mine(calls), e.createdAt, (x) => x.cancelledAt);
      return c ? callRow(c.id) : testerRow(cid);
    }
    if (isTeamDecision(e)) {
      const d = nearest(mine(disputes), e.createdAt, (x) => x.decidedAt);
      return (d && devPartRow(d)) || testerRow(cid);
    }
    return "";
  };
  return events.map((e) => {
    if (e.link) return e;
    const link = linkOf(e);
    return link ? { ...e, link } : e;
  });
}
