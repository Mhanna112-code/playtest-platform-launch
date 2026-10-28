import { db } from "@/lib/db";
import { CLOSE_OUT_DAYS, closeOutBase, reviewDateOf } from "@/lib/rules";
import { callMinutesOf } from "@/lib/callMeasure";

/**
 * (Owner, Oct 28, batch 17 section 19, final) Each test's CLOSE-OUT date: 14 days after the last tester's deadline (closeOutBase), moved later by every pause after that
 * (the team's pause, the developer's payment or chargeback hold or developer-side suspension) and every recorded outage, as deadlines move. Computed, never stored.
 * Pieces close at the close-out or 14 days after their own Charge opened, whichever is later (pieceCloseOut).
 */

const DAY = 86_400_000;
export type Span = { start: number; end: number; open: boolean };

/** Merge overlapping stretches (an open one runs to now). */
export function mergeSpans(list: Span[]): Span[] {
  const merged: Span[] = [];
  for (const x of [...list].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && x.start <= last.end) {
      last.end = Math.max(last.end, x.end);
      last.open = last.open || x.open;
    } else merged.push({ ...x });
  }
  return merged;
}

/** The end of a window of `days` from `from` that pauses during `spans`; `paused` while one is on now (the end then moves on day by day). */
export function windowEnd(from: Date, spans: Span[], now: Date, days: number) {
  let left = days * DAY;
  let t = from.getTime();
  for (const x of spans) {
    if (x.end <= t && !x.open) continue;
    if (x.start > t) {
      if (x.start - t >= left) return { end: new Date(t + left), paused: false };
      left -= x.start - t;
      t = x.start;
    }
    if (x.open) return { end: new Date(Math.max(now.getTime(), t) + left), paused: true };
    t = Math.max(t, x.end);
  }
  return { end: new Date(t + left), paused: false };
}

/** A developer's holds and developer-side suspensions, from the account history plus what is on now. */
export function devPauseSpans(events: { kind: string; side: string; createdAt: Date }[], dev: { holdStartedAt: Date | null; devSuspendedAt: Date | null }, now: Date): Span[] {
  const out: Span[] = [];
  let hold: number | null = null;
  let sus: number | null = null;
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const at = e.createdAt.getTime();
    const devSide = e.side === "developer" || e.side === "";
    if (e.kind === "hold" && hold == null) hold = at;
    else if (e.kind === "hold-lifted" && hold != null) {
      out.push({ start: hold, end: at, open: false });
      hold = null;
    } else if (e.kind === "suspended" && devSide && sus == null) sus = at;
    else if (e.kind === "reinstated" && devSide && sus != null) {
      out.push({ start: sus, end: at, open: false });
      sus = null;
    }
  }
  if (dev.holdStartedAt) out.push({ start: Math.min(hold ?? Infinity, dev.holdStartedAt.getTime()), end: now.getTime(), open: true });
  if (dev.devSuspendedAt) out.push({ start: Math.min(sus ?? Infinity, dev.devSuspendedAt.getTime()), end: now.getTime(), open: true });
  return mergeSpans(out);
}

/** A tester's own tester-side suspensions. */
export function testerPauseSpans(events: { kind: string; side: string; createdAt: Date }[], suspendedAt: Date | null, now: Date): Span[] {
  const out: Span[] = [];
  let on: number | null = null;
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (e.side !== "tester" && e.side !== "") continue;
    if (e.kind === "suspended" && on == null) on = e.createdAt.getTime();
    else if (e.kind === "reinstated" && on != null) {
      out.push({ start: on, end: e.createdAt.getTime(), open: false });
      on = null;
    }
  }
  if (suspendedAt) out.push({ start: Math.min(on ?? Infinity, suspendedAt.getTime()), end: now.getTime(), open: true });
  return mergeSpans(out);
}

/** The team's pauses of one test (from its events), plus the one on now. */
async function teamPauseSpans(testId: string, adminPausedAt: Date | null, now: Date): Promise<Span[]> {
  const evs = await db.testEvent.findMany({ where: { testId, OR: [{ kind: "paused", text: "The team paused this test" }, { kind: "resumed", text: "The team lifted the pause on this test" }] }, orderBy: { createdAt: "asc" }, select: { kind: true, createdAt: true } });
  const out: Span[] = [];
  let on: number | null = null;
  for (const e of evs) {
    if (e.kind === "paused" && on == null) on = e.createdAt.getTime();
    else if (e.kind === "resumed" && on != null) {
      out.push({ start: on, end: e.createdAt.getTime(), open: false });
      on = null;
    }
  }
  if (adminPausedAt) out.push({ start: Math.min(on ?? Infinity, adminPausedAt.getTime()), end: now.getTime(), open: true });
  return out;
}

/** Everything that moves a test's close-out: the team's pauses, the developer's holds and suspensions, and outages. */
async function testSpans(t: { id: string; adminPausedAt: Date | null; developer: { id: string; holdStartedAt: Date | null; devSuspendedAt: Date | null } }, from: Date, now: Date) {
  const [devEvents, outages, team] = await Promise.all([
    db.accountEvent.findMany({ where: { userId: t.developer.id, kind: { in: ["hold", "hold-lifted", "suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } }),
    db.outage.findMany({ where: { endAt: { gt: from }, OR: [{ needsApproval: false }, { approvedAt: { not: null } }] }, select: { startAt: true, endAt: true } }),
    teamPauseSpans(t.id, t.adminPausedAt, now),
  ]);
  return mergeSpans([...devPauseSpans(devEvents, t.developer, now), ...team, ...outages.map((o) => ({ start: o.startAt.getTime(), end: o.endAt.getTime(), open: false }))]);
}

const CONTRACTS = { select: { status: true, dueAt: true, endedAt: true } } as const;

/** The test's close-out date: Pay more and the testers' Rate close then (null while testers can still join or work: it isn't known yet). */
export async function closeOutOf(testId: string, now = new Date()) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true, contracts: CONTRACTS } });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  return windowEnd(base, await testSpans(t, base, now), now, CLOSE_OUT_DAYS).end;
}

/**
 * (Owner, final; Batch 17 §19) When Pay more closes: together with the last Pay / Charge on the test. One date per test: the test's close-out, or, when a piece's own
 * window runs later (14 days after its Charge opened, the developer's side as pieceCloseOut: the later of its tester's deadline and 7 days after sending), that later
 * date. Over the test's sent pieces (parts, and calls that took place), moved by the same pauses and outages. null while the close-out isn't known.
 */
export async function payMoreClosesAt(testId: string, now = new Date()) {
  const t = await db.test.findUnique({
    where: { id: testId },
    include: {
      developer: true,
      contracts: {
        select: {
          status: true, dueAt: true, endedAt: true,
          submissions: { select: { payBy: true } },
          calls: { where: { status: "booked" }, select: { payBy: true, actualMinutes: true, measuredMinutes: true, measuredAt: true } },
        },
      },
    },
  });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  const opens = t.contracts.flatMap((c) => [...c.submissions, ...c.calls.filter((x) => callMinutesOf(x) != null)].flatMap((x) => (x.payBy ? [reviewDateOf(x.payBy, c.dueAt).getTime()] : [])));
  const spans = await testSpans(t, new Date(Math.min(base.getTime(), ...opens)), now);
  const ends = [base.getTime(), ...opens].map((from) => windowEnd(new Date(from), spans, now, CLOSE_OUT_DAYS).end.getTime());
  return new Date(Math.max(...ends));
}

/**
 * (Owner, final) When one piece (a part or a listed call) closes: Charge / Let it go for the tester (`side` "tester") and Pay for the developer ("developer"). The test's
 * close-out, except that each piece gets at least 14 days of Charge from when its Charge opened (the later of its tester's deadline and 7 days after sending), moved by
 * the same pauses and outages. A tester whose tester side was suspended gets that time added to their pieces' Charge windows (their Charge is hidden while suspended).
 * null while the test's close-out isn't known.
 */
export async function pieceCloseOut(where: { submissionId?: string | null; callId?: string | null }, side: "tester" | "developer", now = new Date()) {
  const piece = where.submissionId
    ? await db.submission.findUnique({ where: { id: where.submissionId }, select: { payBy: true, contractId: true } })
    : where.callId
      ? await db.call.findUnique({ where: { id: where.callId }, select: { payBy: true, contractId: true } })
      : null;
  if (!piece) return null;
  const c = await db.contract.findUnique({ where: { id: piece.contractId }, select: { testId: true, dueAt: true, tester: { select: { id: true, testerSuspendedAt: true } } } });
  if (!c) return null;
  const t = await db.test.findUnique({ where: { id: c.testId }, include: { developer: true, contracts: CONTRACTS } });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  const opens = piece.payBy ? reviewDateOf(piece.payBy, c.dueAt) : null;
  let spans = await testSpans(t, new Date(Math.min(base.getTime(), opens?.getTime() ?? Infinity)), now);
  if (side === "tester") {
    const tEvents = await db.accountEvent.findMany({ where: { userId: c.tester.id, kind: { in: ["suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } });
    spans = mergeSpans([...spans, ...testerPauseSpans(tEvents, c.tester.testerSuspendedAt, now)]);
  }
  const testEnd = windowEnd(base, spans, now, CLOSE_OUT_DAYS).end;
  const own = opens ? windowEnd(opens, spans, now, CLOSE_OUT_DAYS).end : null;
  return own && own > testEnd ? own : testEnd;
}

/** Has this test (or this piece) closed out? */
export const closedOut = (at: Date | null, now = new Date()) => !!at && at.getTime() <= now.getTime();
