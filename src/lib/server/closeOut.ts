import { db } from "@/lib/db";
import { workEndOf } from "@/lib/pause";
import { CLOSE_OUT_DAYS, RATED_NO_DISPUTE, chargeOpensAt, closeOutBase, disputeClosedLine, pieceDueAt, reviewDateOf } from "@/lib/rules";
import { fmtDate } from "@/lib/server/dateFormat";

/**
 * (Owner, Oct 28, batch 17 section 19, final) The CLOSE-OUT: 14 days after the test close (closeOutBase: the last tester's deadline, or the stop), moved later by
 * pauses and outages. Computed, never stored. (Owner, Dec 10 2026) There is no test-wide close-out date of its own any more: each date counts its 14 days from
 * the test close with its own spans. The tester's Rate (testerRatingClosesAt: her close-out) moves by the developer's side only (moneySpans) and her own open
 * disputes; pieces close at that close-out or 14 days after their own Charge opened, whichever is later (pieceCloseOut).
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

/**
 * The team's pauses of one test (from its events), plus the one on now. (Owner, Nov 4, §172) `stoppedAt`: the developer's Rate window pauses only while the pause is
 * in force (a stopped or closed test isn't paused any more), so a pause still recorded on a stopped test ends at its stop there.
 */
export async function teamPauseSpans(testId: string, adminPausedAt: Date | null, now: Date, stoppedAt?: Date | null): Promise<Span[]> {
  if (adminPausedAt && stoppedAt) {
    const spans = await teamPauseSpans(testId, adminPausedAt, stoppedAt);
    return spans.map((s) => (s.open ? { start: s.start, end: Math.max(s.start, stoppedAt.getTime()), open: false } : s));
  }
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

/** (Owner, Dec 2026) When one side's Rate last came back from a freeze: the end of the latest of these spans that ended at or before now (an open one is still on), or null. */
export function lastLift(spans: Span[], now: Date): Date | null {
  const ends = spans.filter((x) => !x.open && x.end <= now.getTime()).map((x) => x.end);
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/**
 * (Owner, Nov 11, §386 A; replaces §358 and §366 A for the money windows only) What moves each piece's money window (Pay, Pay more, Charge / Let it go): every span
 * the money was frozen (moneyFrozen), after the test closed or stopped too: the developer's holds and suspensions whenever they ran (not a deleted developer's
 * one still on ends at the deletion, §386 F), the team's pauses while in force (a stopped test's ends at its stop), and outages. Overlaps count once.
 * (Owner, Dec 10 2026) Both Rate windows count the close-out with these spans too (testerRatingClosesAt, devRateStates).
 */
export async function moneySpans(t: { id: string; adminPausedAt: Date | null; workEndedAt?: Date | null; pauseClosedAt?: Date | null; status?: string; stoppedAt?: Date | null; developer: { id: string; holdStartedAt: Date | null; devSuspendedAt: Date | null; deletedAt?: Date | null } }, from: Date, now: Date, /** (§386 G) false: the freeze alone (outages move a call's stored date themselves) */ withOutages = true) {
  const [devEvents, outages, team] = await Promise.all([
    db.accountEvent.findMany({ where: { userId: t.developer.id, kind: { in: ["hold", "hold-lifted", "suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } }),
    db.outage.findMany({ where: { endAt: { gt: from }, OR: [{ needsApproval: false }, { approvedAt: { not: null } }] }, select: { startAt: true, endAt: true } }),
    teamPauseSpans(t.id, t.adminPausedAt, now, t.status === "stopped" ? workEndOf(t) ?? now : null),
  ]);
  // (Owner, Nov 11, §386 F) A developer's deletion ends the freeze: every span still on then ends at the deletion (counted as lifted then).
  const gone = t.developer.deletedAt?.getTime();
  const upTo = (list: Span[]) => (gone == null ? list : list.filter((x) => x.start < gone).map((x) => ({ start: x.start, end: Math.min(x.open ? gone : x.end, gone), open: false })));
  return mergeSpans([...upTo(devPauseSpans(devEvents, t.developer, now)), ...upTo(team), ...(withOutages ? outages : []).map((o) => ({ start: o.startAt.getTime(), end: o.endAt.getTime(), open: false }))]);
}

export const CONTRACTS = { select: { status: true, dueAt: true, endedAt: true } } as const;

/** (Owner, Nov 11, §382) The tester's disputes on one contract as spans (an open one runs to now; a withdrawn one never counts). */
export function disputeSpansOf(rows: { createdAt: Date; decidedAt: Date | null; status: string }[], now: Date): Span[] {
  return rows.filter((d) => d.status !== "withdrawn").map((d) => ({ start: d.createdAt.getTime(), end: Math.min((d.status === "open" ? now : d.decidedAt ?? d.createdAt).getTime(), now.getTime()), open: d.status === "open" }));
}

/**
 * (Owner, Dec 10 2026; replaces §382 a and §386 E's clock) When the tester's Rate on this contract closes: HER close-out, 14 days after the test close
 * (closeOutBase), moved only by the developer's side (moneySpans: their holds and suspensions whenever they ran, the team's pause cut at the Stop, outages) and
 * her own disputes on this contract while they await the team. Her own tester-side suspension no longer moves it (her Rate is still hidden while she is
 * suspended). null while the test close isn't known. The developer's Rate opens at this date for a tester who never rated (devRateStates).
 */
export async function testerRatingClosesAt(contractId: string, now = new Date()) {
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testId: true } });
  if (!c) return null;
  const t = await db.test.findUnique({ where: { id: c.testId }, include: { developer: true, contracts: CONTRACTS } });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  const disputes = await db.dispute.findMany({ where: { contractId, createdAt: { lte: now } }, select: { createdAt: true, decidedAt: true, status: true } });
  return windowEnd(base, mergeSpans([...(await moneySpans(t, base, now)), ...disputeSpansOf(disputes, now)]), now, CLOSE_OUT_DAYS).end;
}

/**
 * (Owner, Dec 2026) When the tester's Rate on this contract last came back from a freeze (lastLift), for ratingReminders' one fresh line after a pause lifts.
 * (Owner, Dec 10 2026) Only a freeze that HID her Rate counts: her own tester-side suspensions (testerPauseSpans: her Rate is hidden all through one), and a
 * money freeze (moneySpans without outages: the team's pause while in force, the developer's holds and suspensions, during the test or after it closed) only
 * while she had work waiting for review in it (testerRateState: her Rate is open during a freeze otherwise, and her reminders go on). A piece was waiting during
 * a span when it was sent (a call: took place) before the span ended, wasn't reviewed by the later of the span's start and its sending, and its review date
 * (chargeOpensAt; none yet for a call still measured) was still ahead then. Nothing can be reviewed during a freeze, and a review date still ahead at its start
 * moves with it, so such a piece stays waiting until the lift. A dispute or a Charge to settle (Rate disabled) is no freeze.
 */
export async function testerRateLiftedAt(contractId: string, now = new Date()) {
  const piece = { sentAt: true, payBy: true, stintDueAt: true, review: { select: { createdAt: true } } } as const;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testId: true, status: true, dueAt: true, tester: { select: { id: true, testerSuspendedAt: true } }, submissions: { select: piece }, calls: { where: { status: "booked" }, select: { startsAt: true, payBy: true, stintDueAt: true, review: { select: { createdAt: true } } } } } });
  if (!c) return null;
  const t = await db.test.findUnique({ where: { id: c.testId }, include: { developer: true } });
  if (!t) return null;
  const pieces = [...c.submissions.map((x) => ({ ...x, sent: x.sentAt })), ...c.calls.map((x) => ({ ...x, sent: x.startsAt }))];
  const hidRate = (sp: Span) =>
    pieces.some((x) => {
      if (x.sent.getTime() >= sp.end) return false;
      const from = Math.max(sp.start, x.sent.getTime());
      if (x.review && x.review.createdAt.getTime() <= from) return false;
      const opens = chargeOpensAt(x, t, c);
      return !opens || opens.getTime() > from;
    });
  const tEvents = await db.accountEvent.findMany({ where: { userId: c.tester.id, kind: { in: ["suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } });
  return lastLift(mergeSpans([...(await moneySpans(t, now, now, false)).filter(hidRate), ...testerPauseSpans(tEvents, c.tester.testerSuspendedAt, now)]), now);
}

/**
 * (Owner, final) When one piece (a part or a listed call) closes. The test's close-out, except that each piece gets at least 14 days of Charge from when its Charge
 * opened (the later of its tester's deadline and 7 days after sending), moved by the same pauses and outages. A tester whose tester side was suspended gets that time
 * added (their Charge is hidden while suspended). null while the test's close-out isn't known.
 * (Owner, Nov 11, §378; replaces batch 17 §19's one Pay more date per test and the developer side's own date) ONE date per piece for all of them: the tester's
 * Charge / Let it go, the developer's Pay AND Pay more on that piece close together, on this date (the tester's suspension time included). (Owner, Nov 11, §386 A)
 * Moved by every span the money was frozen, after the test closed too (moneySpans). (Owner, Dec 9 2026; replaces §386 A's separate dispute window) The tester's
 * Dispute closes on this same date: one closing date per piece for everything.
 */
export async function pieceCloseOut(where: { submissionId?: string | null; callId?: string | null }, now = new Date()) {
  const piece = where.submissionId
    ? await db.submission.findUnique({ where: { id: where.submissionId }, select: { payBy: true, contractId: true, stintDueAt: true } })
    : where.callId
      ? await db.call.findUnique({ where: { id: where.callId }, select: { payBy: true, contractId: true, stintDueAt: true } })
      : null;
  if (!piece) return null;
  const c = await db.contract.findUnique({ where: { id: piece.contractId }, select: { testId: true, dueAt: true, tester: { select: { id: true, testerSuspendedAt: true } } } });
  if (!c) return null;
  const t = await db.test.findUnique({ where: { id: c.testId }, include: { developer: true, contracts: CONTRACTS } });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  const opens = piece.payBy ? reviewDateOf(piece.payBy, pieceDueAt(piece, c)) : null; // (§313c) an earlier stint's work keeps its deadline
  const tEvents = await db.accountEvent.findMany({ where: { userId: c.tester.id, kind: { in: ["suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } });
  const from = new Date(Math.min(base.getTime(), opens?.getTime() ?? Infinity));
  // (Owner, Nov 11, §386 A) The window moves by every frozen span, after the test closed too (moneySpans); (Owner, Dec 9 2026) Dispute's too.
  const spans = mergeSpans([...(await moneySpans(t, from, now)), ...testerPauseSpans(tEvents, c.tester.testerSuspendedAt, now)]);
  const testEnd = windowEnd(base, spans, now, CLOSE_OUT_DAYS).end;
  const own = opens ? windowEnd(opens, spans, now, CLOSE_OUT_DAYS).end : null;
  return own && own > testEnd ? own : testEnd;
}

/**
 * (Owner, Nov 11, §386 G) When a listed call is charged automatically (an unlisted one closes with $0): its stored date (payBy, already moved by a pause that began
 * during the test, when that pause lifted) moved on by the frozen time that began after the test's work ended and falls after the call's countdown started (its
 * measured length final, else its start). The same one clock as the piece windows: a span before the countdown never counts, nor one counted already. While a
 * freeze is still on, it moves day by day. null without a date.
 */
export async function callChargeAt(callId: string, now = new Date()) {
  const x = await db.call.findUnique({ where: { id: callId }, select: { payBy: true, startsAt: true, measuredAt: true, contractId: true } });
  if (!x?.payBy) return null;
  const c = await db.contract.findUnique({ where: { id: x.contractId }, select: { testId: true } });
  const t = c ? await db.test.findUnique({ where: { id: c.testId }, include: { developer: true } }) : null;
  if (!t) return x.payBy;
  const from = x.measuredAt && x.measuredAt > x.startsAt ? x.measuredAt : x.startsAt;
  const end = workEndOf(t)?.getTime() ?? Infinity;
  // (Owner, Dec 9 2026) A freeze that began after the work ended moves payBy itself when it lifts (shiftAfterPause), like one during the work: only one still ON
  // moves the date here, day by day, until its lift moves payBy. Outages move payBy themselves when recorded (left out).
  const spans = (await moneySpans(t, from, now, false)).filter((sp) => sp.open && sp.start >= end && sp.end > from.getTime());
  if (!spans.length || x.payBy <= from) return x.payBy;
  return windowEnd(from, mergeSpans(spans), now, (x.payBy.getTime() - from.getTime()) / DAY).end;
}

/** Has this test (or this piece) closed out? */
export const closedOut = (at: Date | null, now = new Date()) => !!at && at.getTime() <= now.getTime();

/**
 * (Owner, Nov 6, §288) Whether the tester can no longer open a dispute on these pieces of one contract, with the line saying why: they rated the test (rating ends
 * their part: every piece, a payment made after the rating included) or the piece's own closing date passed (pieceCloseOut, the tester's side: the date its Charge
 * and Let it go end, and the developer's Pay). A piece missing from the map is open. A dispute already open is not touched (it stays until the team decides it).
 */
export async function disputesClosed(contractId: string, pieces: { submissionId?: string | null; callId?: string | null }[], now = new Date()) {
  const out = new Map<string, string>();
  const keys = pieces.filter((p) => p.submissionId || p.callId);
  if (!keys.length) return out;
  const rated = await db.rating.findUnique({ where: { contractId_side: { contractId, side: "tester" } }, select: { id: true } });
  for (const k of keys) {
    const id = (k.submissionId ?? k.callId)!;
    if (rated) { out.set(id, RATED_NO_DISPUTE); continue; }
    const at = await pieceCloseOut(k, now); // (Owner, Dec 9 2026) the piece's one closing date, as Charge
    if (closedOut(at, now)) out.set(id, disputeClosedLine(fmtDate(at!)));
  }
  return out;
}

/** (Owner, Nov 6, §288) One piece of this contract: the line when its disputes are closed, or null (also null for a piece that isn't this contract's). */
export async function disputeClosedFor(contractId: string, where: { submissionId?: string | null; callId?: string | null }, now = new Date()) {
  const piece = where.submissionId
    ? await db.submission.findUnique({ where: { id: where.submissionId }, select: { contractId: true } })
    : where.callId
      ? await db.call.findUnique({ where: { id: where.callId }, select: { contractId: true } })
      : null;
  if (!piece || piece.contractId !== contractId) return null;
  return (await disputesClosed(contractId, [where], now)).get((where.submissionId ?? where.callId)!) ?? null;
}
