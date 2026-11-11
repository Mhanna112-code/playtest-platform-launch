import { db } from "@/lib/db";
import { workEndOf } from "@/lib/pause";
import { CLOSE_OUT_DAYS, RATED_NO_DISPUTE, closeOutBase, disputeClosedLine, pieceDueAt, reviewDateOf } from "@/lib/rules";
import { fmtDate } from "@/lib/server/dateFormat";

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

/** Everything that moves a test's close-out: the team's pauses, the developer's holds and suspensions, and outages. */
export async function testSpans(t: { id: string; adminPausedAt: Date | null; workEndedAt?: Date | null; pauseClosedAt?: Date | null; status?: string; stoppedAt?: Date | null; developer: { id: string; holdStartedAt: Date | null; devSuspendedAt: Date | null } }, from: Date, now: Date) {
  const [devEvents, outages, team] = await Promise.all([
    db.accountEvent.findMany({ where: { userId: t.developer.id, kind: { in: ["hold", "hold-lifted", "suspended", "reinstated"] } }, select: { kind: true, side: true, createdAt: true } }),
    db.outage.findMany({ where: { endAt: { gt: from }, OR: [{ needsApproval: false }, { approvedAt: { not: null } }] }, select: { startAt: true, endAt: true } }),
    teamPauseSpans(t.id, t.adminPausedAt, now),
  ]);
  // (Owner, Nov 9, §358) A hold, suspension or team pause that began after the test's work ended (closed, or the 7-day pause closure) moves none of its dates.
  const end = workEndOf(t)?.getTime() ?? Infinity;
  // (Owner, Nov 9, §366 A) On a stopped test (the developer's or the team's Stop, the 7-day closure) a pause still recorded (adminPausedAt is kept on purpose; a
  // hold or suspension still on) ends counting at the stop, as the developer's Rate window already did: the close-out arrives instead of moving on every day.
  const stop = t.status === "stopped" ? end : Infinity;
  const clip = (s: Span): Span => (s.end > stop || s.open ? { start: s.start, end: Math.max(s.start, Math.min(s.end, stop)), open: s.open && stop === Infinity } : s);
  return mergeSpans([...[...devPauseSpans(devEvents, t.developer, now), ...team].filter((s) => s.start < end).map(clip), ...outages.map((o) => ({ start: o.startAt.getTime(), end: o.endAt.getTime(), open: false }))]);
}

/**
 * (Owner, Nov 11, §386 A; replaces §358 and §366 A for the money windows only) What moves each piece's money window (Pay, Pay more, Charge / Let it go): every span
 * the money was frozen (moneyFrozen), after the test closed or stopped too: the developer's holds and suspensions whenever they ran (not a deleted developer's
 * one still on ends at the deletion, §386 F), the team's pauses while in force (a stopped test's ends at its stop), and outages. Overlaps count once.
 * The test's close-out, Rate and Dispute windows keep testSpans.
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

/**
 * The test's close-out date: 14 days after the test close, moved by pauses and outages (null while testers can still join or work: it isn't known yet). Pay, Pay
 * more and Charge close on each piece's own date (pieceCloseOut, §378), and the Rate windows follow §382 (they count from this date).
 */
export async function closeOutOf(testId: string, now = new Date()) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true, contracts: CONTRACTS } });
  if (!t) return null;
  const base = closeOutBase(t, t.contracts, now);
  if (!base) return null;
  return windowEnd(base, await testSpans(t, base, now), now, CLOSE_OUT_DAYS).end;
}

/** The tester's rating countdown pauses while their disputes await a team decision. Payment and dispute close-outs are unchanged. */
export async function testerRatingClosesAt(contractId: string, now = new Date()) {
 const c=await db.contract.findUnique({where:{id:contractId},select:{testId:true,tester:{select:{id:true,testerSuspendedAt:true}}}});
 if(!c)return null;
 const t=await db.test.findUnique({where:{id:c.testId},include:{developer:true,contracts:CONTRACTS}});
 if(!t)return null;
 const base=closeOutBase(t,t.contracts,now);
 if(!base)return null;
 const disputes=await db.dispute.findMany({where:{contractId,createdAt:{lte:now}},select:{createdAt:true,decidedAt:true,status:true}});
 const disputeSpans=disputes.filter(d=>d.status!=="withdrawn").map(d=>({start:d.createdAt.getTime(),end:Math.min((d.status === "open" ? now : d.decidedAt ?? d.createdAt).getTime(),now.getTime()),open:d.status==="open"}));
 // (Owner, Nov 11, §382 a) The tester's own suspension extends their Rate like Charge (§378, pieceCloseOut): its spans pause the same window, so only the part after
 // test close can move it past the close-out.
 const tEvents=await db.accountEvent.findMany({where:{userId:c.tester.id,kind:{in:["suspended","reinstated"]}},select:{kind:true,side:true,createdAt:true}});
 // (Owner, Nov 11, §386 E; replaces §358 for this window only) The developer-side freeze (moneySpans: the team's pause, the developer's holds and suspensions)
 // pauses it after the test closed too, on the same one clock from the test close (so only the part after it counts); the close-out itself doesn't move.
 const spans=mergeSpans([...await moneySpans(t,base,now),...disputeSpans,...testerPauseSpans(tEvents,c.tester.testerSuspendedAt,now)]);
 return windowEnd(base,spans,now,CLOSE_OUT_DAYS).end;
}

/**
 * (Owner, final) When one piece (a part or a listed call) closes. The test's close-out, except that each piece gets at least 14 days of Charge from when its Charge
 * opened (the later of its tester's deadline and 7 days after sending), moved by the same pauses and outages. A tester whose tester side was suspended gets that time
 * added (their Charge is hidden while suspended). null while the test's close-out isn't known.
 * (Owner, Nov 11, §378; replaces batch 17 §19's one Pay more date per test and the developer side's own date) ONE date per piece for all of them: the tester's
 * Charge / Let it go, the developer's Pay AND Pay more on that piece close together, on this date (the tester's suspension time included). (Owner, Nov 11, §386 A)
 * Moved by every span the money was frozen, after the test closed too (moneySpans). `dispute`: the dispute window, which keeps the test's spans (testSpans).
 */
export async function pieceCloseOut(where: { submissionId?: string | null; callId?: string | null }, now = new Date(), /** (§386 A) the dispute window: testSpans, as before */ opts: { dispute?: boolean } = {}) {
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
  // (Owner, Nov 11, §386 A) The money window moves by every frozen span, after the test closed too (moneySpans); a dispute keeps the test's spans (§358).
  const spans = mergeSpans([...(await (opts.dispute ? testSpans(t, from, now) : moneySpans(t, from, now))), ...testerPauseSpans(tEvents, c.tester.testerSuspendedAt, now)]);
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
  // Only what shiftAfterPause never moved: a freeze that began after the work ended (outages move payBy themselves when recorded: left out).
  const spans = (await moneySpans(t, from, now, false)).filter((sp) => sp.start >= end && sp.end > from.getTime());
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
    const at = await pieceCloseOut(k, now, { dispute: true }); // (§386 A) unchanged by the money freeze
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
