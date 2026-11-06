import { assertWorkOpen, finishWorkIfDue, workEndOf } from "./workWindow";
import { randomBytes } from "node:crypto";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, money, pronouns } from "@/lib/server/dateFormat";
import { andList, checkCallMinutes, checkCancel, workDeadlineOf } from "@/lib/rules";
import { FOREVER_AHEAD, MAX_ROWS, cutRow, occurrences, rowsOf, stepMs, toJson, type CallRow, type RowRepeat } from "@/lib/callRows";
import type { Prisma } from "@prisma/client";
import { NOT_LISTED, PAUSED_RIGHT_NOW, callListed, testPaused } from "@/lib/rules";
import { DEV_SUSPENDED } from "./users";
import { HttpError, readText } from "./http";
import { LIMITS } from "@/lib/limits";
import { bell, notify } from "./notify";
import { devGate, recordEvent } from "./tests";
import { FINISHED_PART_REASON, finishedPartReason, testerGate } from "./testerGate";
import { answerTermsFirst } from "./terms";
import { CALL_MIN_AHEAD_MINUTES, farEnoughAhead } from "@/lib/callLead";
import { afterEndToBookLine, beforeEndLine, leadLine, tooSoonToBookLine, windowShut, windowShutLine, type CallEnd } from "@/lib/callWindow";

/** (Batch 27 section 1) The tester's call presses: an open new-terms offer blocks them (answerTermsFirst), so new terms are no longer a stop-once for them. */
const CALL_PRESS = { skipTerms: true } as const;
import { callsLeftCents, ceilingRefusal, checkCeiling } from "./callMoney";
import { CALL_MIN_MINUTES } from "@/lib/rules";
import { bookableMinutes, lengthCapLine } from "@/lib/callMeasure";
import { CALL_ACTS } from "./live";
import { MAX_CALLS, MAX_SENT_PER_DAY, callLimitLine, callRoomLine, clashNotes, localFmt, sentRoomLine } from "@/lib/callClash";
import { dayIn } from "@/lib/rules";
import { renderTimes, safeZone } from "@/lib/tz";
import { dateZone } from "./dateZone";
import { DROP_BOTH, DROP_DEV_BUSY, DROP_TESTER_BUSY, dropLine, dropReasonFor, isDropReason } from "@/lib/requestDrop";

/**
 * (Batch 15 section 34) The calls a request books if accepted: the most of any one row (an older "choose one" row books 1; a set books all of its calls, up to the
 * end). (§208) For a press's rows (each its own request): the most any one of them books, each checked as it would be accepted.
 */
const callsIfAccepted = (rows: CallRow[], end: Date | null) => Math.max(1, ...rows.map((r) => occurrences(r, end).length));

/**
 * (Owner, Nov 2, batch 35 §132) What a page with a call request form passes down besides its lead: when testers' work on the test ends, in the reader's words (the
 * page runs in the reader's zone). The form's time box takes no later time, and its calls drop-down only what fits before it.
 */
export const callEndProps = (end: Date | null): CallEnd => (end ? { at: end.toISOString(), text: fmtDateTime(end), day: endDay(end) } : null);
/** "Dec 3": the end's day for "until testers' work ends (Dec 3)". */
const endDay = (end: Date) => fmtDate(end).replace(/, \d{4}$/, "");
/** (Batch 35 §132) A request's rows as a page shows them: each repeating row with the end, so its words say how many calls it covers. */
export const pageRows = (r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat?: string }, end: Date | null) => toJson(rowsOf(r), end ? { at: end, day: endDay(end) } : null);

// Calls are ALWAYS requests (owner rules). Every call starts as a request from one side and is booked only when the
// other side accepts, or by auto-match. A request is ONE of:
//   "Once": one time → 1 call.
//   "Daily"/"Weekly": 1 time repeated 2–8 times; accepting books them all (each an ordinary call afterwards).
// (Owner, Nov 5, §208) "+ Another time" (up to 3 rows) sends each row as its OWN request: they count separately toward the limits and are answered separately.
// Older "choose one" requests (several times in one request; the other side picks one, the rest close) still waiting keep working as they were; none is made now.
// The developer requests with one or more ticked testers (the first tester to accept takes the whole request); the
// developer never sets a price, and neither does the tester (the "Ask $" was removed; every call is at the contract rate). Limit (§185): 3 in total per tester per test (both sides' pending requests and booked times; a daily/weekly set = 1). Clash checks:
// sending refuses overlaps with calls/requests between the same two; accepting refuses overlaps with anyone's calls.
// (Owner, Nov 4, §184) And the moment a call is booked (any path: Accept, auto-match, the Forever top-up; all through bookAt), every other waiting request of
// either person in it that overlaps it is dropped in the same transaction (dropOverlapping): an Accept on one afterwards is a single "already closed" refusal.

type Side = "developer" | "tester";
type U = { id: string; email: string; name: string; pronoun?: string };
const DAY_MS = 86_400_000;
// (Owner, Nov 4, §185) The limit per developer–tester pair on a test is MAX_CALLS (3) in total: booked times + waiting requests, both sides together (it replaces
// "up to 3 booked + up to 3 requests"). Checked on every press that makes a request or a booking (send, auto-match, Accept), before the press's stop-once gate (a
// single refusal, never a stop first) and again where it books or creates. A booking that answers a request (Accept, auto-match) turns one request into one booked
// time, so it never raises the count; the Forever top-up adds calls to a set that already counts as one booked time, so it never does either.
export { MAX_CALLS };

async function ctx(userId: string, contractId: string) {
  let c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const side: Side | null = c?.testerId === userId ? "tester" : c?.test.developerId === userId ? "developer" : null;
  if (!c || !side) throw new HttpError(404, "not_found", "That session doesn't exist.");
  if (await finishWorkIfDue(c.testId)) c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  return { c, side, other: side === "tester" ? c.test.developer : c.tester, me: side === "tester" ? c.tester : c.test.developer };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

/** A call's rate as both sides read it: "Contract $30/h" for a listed call; (owner, Oct 28 evening) "Not listed" for one that isn't a listed part of the contract. */
export const rateLabel = (rateCents: number | null, contractRate: number | null) =>
  rateCents == null ? NOT_LISTED : `${rateCents === contractRate ? "Contract" : "Agreed"} ${money(rateCents).replace(/\.00$/, "")}/h`;
/**
 * (Owner, Oct 29, batch 26 section 10, DEFAULT) The developer's call request row: a tester on older terms than the listing says so, "Their terms: $30/h (the listing
 * is now $24/h)"; otherwise the usual label.
 */
export const devRateLabel = (rateCents: number | null, contractRate: number | null, listingRate: number | null, /** (§162) the tester's: "Her terms" */ pronoun?: string | null) =>
  rateCents != null && rateCents === contractRate && listingRate != null && listingRate !== contractRate
    ? `${pronouns(pronoun).Poss} terms: ${money(rateCents).replace(/\.00$/, "")}/h (the listing is now ${money(listingRate).replace(/\.00$/, "")}/h)`
    : rateLabel(rateCents, contractRate);
/**
 * (Batch 26 section 10) A waiting call request that is no longer waiting, as its row says it live on an open page: "Closed: the tester finished their part",
 * "Withdrawn", "Declined", "Booked", or the taken line. "" while it waits.
 */
/** A waiting request whose time passed closes with this reason ("Closed: its time passed"). */
export const TIME_PASSED_REASON = "its time passed";
export function requestGoneLine(r: { status: string; closedReason: string }, /** (§162) the tester's: "the tester finished her part" */ testerPronoun?: string | null,
  /** (Owner, Nov 4, §184) the reader's side and the request's other person: a dropped request reads "Closed: fbbb is no longer free at that time" */ view?: { side: Side; other: string }) {
  if (r.status === "pending") return "";
  const reason = r.closedReason === FINISHED_PART_REASON ? finishedPartReason(testerPronoun) : view && isDropReason(r.closedReason) ? dropReasonFor(r.closedReason, view.side, view.other) : r.closedReason;
  if (r.status === "closed") return `Closed${reason ? `: ${reason}` : ""}`;
  if (r.status === "taken") return r.closedReason || "Taken";
  return r.status === "booked" ? "Booked" : r.status === "withdrawn" ? "Withdrawn" : r.status === "declined" ? "Declined" : "Closed";
}
/** The rate a call is booked at: the contract rate when the call is a listed part, else none (not a listed part: pay is up to the developer). */
export const bookRate = (test: { liveRateCents: number | null }, c: { liveRateCents: number | null }) => (callListed(test, c) ? c.liveRateCents : null);

/** Every call time a request covers: each row's calls (a Forever row: the next 4 ahead), (batch 35 §132) none after the end. */
export const requestTimes = (r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat?: string }, end: Date | null = null) => rowsOf(r).flatMap((x) => occurrences(x, end));
/** The single-call ("Once") times of a request: what auto-match compares. */
const onceTimes = (r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat?: string }) => rowsOf(r).filter((x) => x.repeat === "once").map((x) => x.startsAt);
const overlaps = (a: Date, am: number, b: Date, bm: number) => a.getTime() < b.getTime() + bm * 60_000 && b.getTime() < a.getTime() + am * 60_000;

/** Read the request's kind and times from the form: times[] (1–3, choose one) or startsAt + weeks (2–8, weekly). */
/** (NEWEST+8) The length the requester typed (minutes); API callers without one get 30. */
function readMinutes(body: Record<string, unknown>) {
  if (body.minutes === undefined || body.minutes === null) return 30;
  if (body.minutes === "") throw new HttpError(400, "bad_minutes", "Enter the call's length in minutes.");
  const r = checkCallMinutes(body.minutes);
  if (!r.ok) throw new HttpError(400, "bad_minutes", r.message);
  return r.minutes;
}

/**
 * The rows of a request (NEXT-UI 7): `rows` [{ startsAt, repeat: once | daily | weekly, count }] (count 2-8, or 0 / "forever"),
 * 1-3 of them; the older shape (times[], or startsAt + weeks + repeat) still reads the same way.
 * (Owner, Nov 2, batch 35 §132) Every time is inside the call window: at least CALL_MIN_AHEAD_MINUTES ahead (24 hours on the live site, 1 minute by default when
 * testing locally) and no later than `end`, when testers' work on the test ends (refused with the form's lines). A Daily / Weekly row's calls after the end are
 * dropped (cutRow: one left is a single call; Forever stops there).
 */
function readRows(body: Record<string, unknown>, end: Date | null): CallRow[] {
  // (Batch 35 §132) Less than the lead left before the end: no time fits any more (the forms show this line instead of the time boxes).
  if (windowShut(end, CALL_MIN_AHEAD_MINUTES)) throw new HttpError(400, "bad_time", windowShutLine(fmtDateTime(end!), CALL_MIN_AHEAD_MINUTES));
  const future = (d: Date) => {
    // (Batch 29 section 20) the form's wording: "Pick a time at least 24 hours from now."
    if (isNaN(d.getTime()) || !farEnoughAhead(d)) throw new HttpError(400, "bad_time", leadLine(CALL_MIN_AHEAD_MINUTES));
    if (end && d.getTime() > end.getTime()) throw new HttpError(400, "bad_time", beforeEndLine(fmtDateTime(end)));
    return d;
  };
  let rows: CallRow[];
  if (Array.isArray(body.rows)) {
    rows = body.rows.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const repeat: RowRepeat = o.repeat === "daily" ? "daily" : o.repeat === "weekly" ? "weekly" : "once";
      const startsAt = future(new Date(String(o.startsAt ?? "")));
      if (repeat === "once") return { startsAt, repeat, count: 1 };
      const forever = o.count === 0 || o.count === "0" || o.count === "forever" || o.forever === true;
      const n = Number(o.count);
      // (Owner, Nov 3) With an end, any count from 2 that fits (the form lists them all; calls past the end are dropped below); with no end, 2 to 8 or Forever.
      if (!forever && (!Number.isInteger(n) || n < 2 || n > (end ? 366 : 8))) throw new HttpError(400, "bad_weeks", end ? `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat at least 2 times.` : `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.`);
      return { startsAt, repeat, count: forever ? 0 : n };
    });
  } else {
    const weeks = Number(body.weeks ?? body.count ?? 0) || 0;
    const repeat: RowRepeat = weeks ? (body.repeat === "daily" ? "daily" : "weekly") : "once";
    const raw = Array.isArray(body.times) ? body.times : body.startsAt ? [body.startsAt] : [];
    const times = raw.map((x) => new Date(String(x))).filter((d) => !isNaN(d.getTime()));
    if (!times.length) throw new HttpError(400, "bad_time", leadLine(CALL_MIN_AHEAD_MINUTES));
    times.forEach(future);
    if (weeks) {
      if (times.length !== 1) throw new HttpError(400, "bad_kind", `A ${repeat} request has exactly one time.`);
      if (weeks < 2 || weeks > 8) throw new HttpError(400, "bad_weeks", `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.`);
      rows = [{ startsAt: times[0], repeat, count: weeks }];
    } else rows = times.map((startsAt) => ({ startsAt, repeat: "once" as const, count: 1 }));
  }
  if (!rows.length) throw new HttpError(400, "bad_time", leadLine(CALL_MIN_AHEAD_MINUTES));
  if (rows.length > MAX_ROWS) throw new HttpError(400, "bad_kind", "Send up to 3 times at once."); // (§208) each its own request
  // (Batch 35 §132) A Daily / Weekly row's calls after the end are dropped, not refused (only its first one left: a single call); Forever runs until the end.
  return rows.map((r) => cutRow(r, end) ?? r).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** (Batch 35 §132) `end`: when testers' work on the test ends (the call window's end). One already passed isn't checked here: the press is refused as the work ended. */
function readKind(body: Record<string, unknown>, end: Date | null) {
  const rows = readRows(body, end && end.getTime() > Date.now() ? end : null);
  // (Owner, Nov 5, §208) "+ Another time" sends each row as its OWN request (never a "choose one" request any more): `each` is one request per row, in time order.
  return { rows, each: rows.map(kindOfRow) };
}
/** (§208) One row as its own request; the older columns keep their meaning for a counted repeating row (what the rest of the app reads). */
const kindOfRow = (r: CallRow) => {
  const single = r.repeat !== "once" && r.count > 0 ? r : null;
  return { rows: [r], startsAt: r.startsAt, times: [r.startsAt], weeks: single?.count ?? 0, repeat: single?.repeat ?? "" };
};
type Kind = ReturnType<typeof kindOfRow>;
/** (§208) A new request's stored columns. */
const kindData = (k: Kind) => ({ startsAt: k.startsAt, times: k.times, weeks: k.weeks, repeat: k.repeat, rows: toJson(k.rows) as Prisma.InputJsonValue });
const unitOf = (repeat: string) => (repeat === "daily" ? "daily" : "weekly");
/** "weekly calls (4 weeks)" / (batch 35 §132) "daily calls (until testers' work ends)" for a one-row repeat, else "a call". */
const kindWords = (rows: CallRow[]) => {
  const r = rows.length === 1 && rows[0].repeat !== "once" ? rows[0] : null;
  return r ? `${unitOf(r.repeat)} calls (${r.count ? `${r.count} ${r.repeat === "daily" ? "days" : "weeks"}` : "until testers' work ends"})` : "a call";
};

/** Sending: a time overlapping a booked call or a pending request between the same two people is refused. */
async function sendClash(contractId: string, times: Date[], minutes: number, otherName: string, /** (§208) the requests this press books (its auto-matches) */ exceptIds: string[] = [], mine?: { side: Side; otherPoss: string }, end: Date | null = null) {
  const [calls, reqs] = await Promise.all([
    db.call.findMany({ where: { contractId, status: "booked", startsAt: { gt: new Date(Date.now() - 6 * 3_600_000) } } }),
    db.callRequest.findMany({ where: { contractId, status: "pending", ...(exceptIds.length ? { id: { notIn: exceptIds } } : {}) } }),
  ]);
  for (const t of times) {
    const call = calls.find((x) => overlaps(t, minutes, x.startsAt, x.minutes));
    if (call) return `You already have a call with ${otherName} at ${fmtDateTime(call.startsAt)}.`;
    for (const r of reqs) {
      const hit = requestTimes(r, end).find((x) => overlaps(t, minutes, x, r.minutes));
      if (!hit) continue;
      // (NEWEST+8) The other side's waiting request: name it; its Accept shows right there (no merging, no partial match).
      if (mine && r.fromSide !== mine.side) throw new HttpError(409, "their_request", `${otherName} already asked for ${fmtDateTime(hit)} (${r.minutes} min). Accept ${mine.otherPoss} request, or pick a time that doesn't overlap.`, { requestId: r.id, contractId });
      return `You already have a request with ${otherName} waiting for that time (${fmtDateTime(t)}).`;
    }
  }
  return "";
}

/** Accepting / auto-matching: the times may not overlap any booked call the accepter or the requester has, with anyone. */
async function acceptClash(c: Ctx["c"], side: Side, times: Date[], minutes: number) {
  const devId = c.test.developerId, testerId = c.testerId;
  const [devCalls, testerCalls] = await Promise.all([
    db.call.findMany({ where: { status: "booked", contract: { test: { developerId: devId } } }, include: { contract: { include: { tester: true, test: true } } } }),
    db.call.findMany({ where: { status: "booked", contract: { testerId } }, include: { contract: { include: { test: { include: { developer: true } } } } } }),
  ]);
  const clashes: string[] = [];
  for (const t of times) {
    const mine = side === "developer" ? devCalls : testerCalls;
    const theirs = side === "developer" ? testerCalls : devCalls;
    const a = mine.find((x) => overlaps(t, minutes, x.startsAt, x.minutes));
    if (a) {
      // The developer may see who; a tester only learns about their own calls.
      clashes.push(side === "developer" ? `You already have a call at ${fmtDateTime(a.startsAt)} (with ${displayName((a.contract as unknown as { tester: { name: string; email: string } }).tester)}).` : `You already have a call at ${fmtDateTime(a.startsAt)}.`);
      continue;
    }
    const b = theirs.find((x) => overlaps(t, minutes, x.startsAt, x.minutes));
    // Privacy: a tester never learns about the developer's calls with other testers.
    if (b) clashes.push(side === "tester" ? "This time is no longer free." : `${displayName(c.tester)} already has a call at ${fmtDateTime(b.startsAt)}.`);
  }
  return clashes;
}

type Tx = Prisma.TransactionClient | typeof db;
/**
 * Booked times still ahead with this tester (a single call = 1, a daily/weekly set = 1). (Owner, Nov 4, §185) A Forever set counts as one booked time while it
 * runs, even when none of its calls is ahead at the moment (it waits at the end, or a pause): its top-up never adds a booked time past the limit.
 */
export async function bookedTimes(contractId: string, tx: Tx = db) {
  const [calls, forever] = await Promise.all([
    tx.call.findMany({ where: { contractId, status: "booked", startsAt: { gt: new Date() } }, select: { setId: true, id: true } }),
    tx.callSet.findMany({ where: { contractId, status: "active", count: 0 }, select: { id: true } }),
  ]);
  return new Set([...calls.map((c) => c.setId ?? c.id), ...forever.map((s) => s.id)]).size;
}
/** Pending requests with this tester (both sides together). */
export const pendingRequests = (contractId: string, tx: Tx = db) => tx.callRequest.count({ where: { contractId, status: "pending", startsAt: { gt: new Date() } } });
/**
 * (Owner, Nov 4, §185) The call requests `side` sent on this contract on the sender's calendar day (in their saved zone `tz`): every request row they created that
 * day, whatever became of it (withdrawn, declined, dropped, closed), plus each auto-match of theirs that day (it books the other side's request directly, which
 * is then marked "matched"). Withdrawing never counts. No schema change: read from the rows' createdAt / decidedAt.
 */
export async function sentToday(contractId: string, side: Side, tz: string | null | undefined, tx: Tx = db, now = new Date()) {
  const since = new Date(now.getTime() - 2 * DAY_MS); // wide enough for any zone's "today"; the day itself is compared in the sender's zone
  const today = dayIn(now, tz);
  const [made, matched] = await Promise.all([
    tx.callRequest.findMany({ where: { contractId, fromSide: side, createdAt: { gt: since } }, select: { createdAt: true } }),
    tx.callRequest.findMany({ where: { contractId, fromSide: side === "developer" ? "tester" : "developer", closedReason: "matched", decidedAt: { gt: since } }, select: { decidedAt: true } }),
  ]);
  return made.filter((r) => dayIn(r.createdAt, tz) === today).length + matched.filter((r) => r.decidedAt && dayIn(r.decidedAt, tz) === today).length;
}
/** (Owner, Nov 4, §185) What counts toward the pair's limit: booked times + waiting requests (both sides). */
export const callsTaken = async (contractId: string, tx: Tx = db) => (await bookedTimes(contractId, tx)) + (await pendingRequests(contractId, tx));
type Pending = Awaited<ReturnType<typeof db.callRequest.findMany>>[number];
/**
 * (§185) The exact matches an auto-match would book: the other side's waiting single-time request (same length) at a row's "once" time. The same test the
 * auto-match itself makes, read before the gate so a send that would only book their request is never refused for the limit. (§208) Per row, by the row's index:
 * each row is its own request, so each may book one of theirs (a request at most once).
 */
async function autoMatches(contractId: string, theirSide: Side, rows: CallRow[], minutes: number | null) {
  const out = new Map<number, { match: Pending; hit: Date }>();
  if (minutes == null || !rows.some((r) => r.repeat === "once")) return out;
  const reqs = await db.callRequest.findMany({ where: { contractId, status: "pending", fromSide: theirSide, weeks: 0, minutes, startsAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } });
  const used = new Set<string>();
  rows.forEach((r, i) => {
    if (r.repeat !== "once") return;
    for (const m of reqs) {
      if (used.has(m.id)) continue;
      const hit = onceTimes(m).find((t) => t.getTime() === r.startsAt.getTime());
      if (!hit) continue;
      out.set(i, { match: m, hit });
      used.add(m.id);
      return;
    }
  });
  return out;
}

/** (§208) Which §185 limit a press doesn't fit, and what the pair already has toward it (sent today / booked + waiting). */
type Room = { kind: "day" | "total"; have: number };
/**
 * (Owner, Nov 5, §208) A press's room under the §185 limits (null when it fits): `sends` requests sent (each new request and each auto-match counts toward the 3 a
 * day), `adds` of them new waiting requests (an auto-match turns their request into a booked time: nothing new). It is refused as a whole, naming how many more
 * can go: the tighter of the two limits (a tie: today's).
 */
function roomOf(now: { sent: number; taken: number }, sends: number, adds: number): Room | null {
  const dayOver = sends > 0 && now.sent + sends > MAX_SENT_PER_DAY;
  // Only auto-matches: refused only for a pair already over 3 (from before the limit).
  const totalOver = adds > 0 ? now.taken + adds > MAX_CALLS : sends > 0 && now.taken > MAX_CALLS;
  if (!dayOver && !totalOver) return null;
  return dayOver && (!totalOver || MAX_SENT_PER_DAY - now.sent <= MAX_CALLS - now.taken) ? { kind: "day", have: now.sent } : { kind: "total", have: now.taken };
}
/** The refusal's words; `short`: the developer's "Press again to send to the others" box (§185's shorter lines when nothing more can go). */
const roomText = (name: string, r: Room, short = false) =>
  r.kind === "day"
    ? short && r.have >= MAX_SENT_PER_DAY ? `You've sent ${MAX_SENT_PER_DAY} call requests to ${name} today.` : sentRoomLine(name, r.have)
    : short && r.have >= MAX_CALLS ? `You already have ${MAX_CALLS} calls booked or requested with ${name}.` : callRoomLine(name, r.have);
/** (§208) The press's refusal line for one person ("" when it fits). */
export function roomLine(name: string, now: { sent: number; taken: number }, sends: number, adds: number) {
  const r = roomOf(now, sends, adds);
  return r ? roomText(name, r) : "";
}

/**
 * A deadline crossed during the stop check cannot create a new request. (Owner, Nov 5, §208) A press's requests (one per row, per tester) are created together, under
 * the test's lock, and re-checked there as a whole: two sends at once (two tabs, both sides) never pass 3 together, nor 3 sent today; over either, nothing is made.
 */
async function createRequests(datas: Prisma.CallRequestUncheckedCreateInput[]) {
  if (!datas.length) return [];
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${datas[0].testId} FOR UPDATE`;
    await assertWorkOpen(tx, datas[0].testId);
    const per = new Map<string, Prisma.CallRequestUncheckedCreateInput[]>();
    for (const d of datas) per.set(d.contractId, [...(per.get(d.contractId) ?? []), d]);
    for (const [contractId, list] of per) {
      const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
      if (c.status !== "working") throw new HttpError(409, "closed", "This session has ended.");
      const side = list[0].fromSide as Side;
      const sender = side === "developer" ? c.test.developer : c.tester;
      const line = roomLine(displayName(side === "developer" ? c.tester : c.test.developer), { sent: await sentToday(c.id, side, sender.timeZone, tx), taken: await callsTaken(c.id, tx) }, list.length, list.length);
      if (line) throw new HttpError(409, "limit", line);
    }
    const made = [];
    for (const data of datas) made.push(await tx.callRequest.create({ data }));
    return made;
  });
}

/**
 * Book one call at this time between the two, at the agreed rate.
 * (Owner, Nov 4, §184) In the same transaction, every OTHER waiting request of either person that overlaps the call is dropped (`dropOverlapping`). `except`: the
 * request this booking answers (an auto-match's, still waiting here) and its batch (the other copies close as taken, `closeBatch`). Each person's bookings take
 * that person's lock first, so two bookings at once (on any tests) run one after the other and the second one's drop sees the first one's call and requests.
 */
async function bookAt(contractId: string, startsAt: Date, minutes: number, rateCents: number | null, setId: string | null = null, byDeveloper = false, quiet = false, except: DropExcept = {}) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true, tester: true } });
  const bells: DropBell[] = [];
  const booked = await db.$transaction(async (tx) => {
    // (Owner, Nov 4, §184) The two people's locks first, always in the same order, then the test's: two bookings sharing a person wait for each other before
    // either holds a test (the drop writes lines on other tests, so holding a test while waiting for a person could deadlock).
    for (const who of [...new Set([c.test.developerId, c.testerId])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"calls:" + who}))`;
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    await assertWorkOpen(tx, c.testId);
    const fresh = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (fresh.status !== "working") throw new HttpError(409, "closed", "This session has ended.");
    const slot = await tx.callSlot.create({ data: { testId: c.testId, startsAt, minutes, allowedTesterIds: [c.testerId], status: "booked" } });
    const call = await tx.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes, rateCents, setId } });
    if (!quiet) await recordEvent(tx, c.testId, "booked", byDeveloper ? `You booked a call with ${displayName(c.tester)} for ${T(startsAt)}` : `${displayName(c.tester)} booked a call for ${T(startsAt)}`, false, {}, contractId);
    await dropOverlapping(tx, { startsAt, minutes, people: [c.test.developerId, c.testerId] }, except, bells);
    return call;
  });
  // (Owner, Nov 4, §185) The bells for the requests it closed, once the booking is in (never for a booking that rolled back).
  for (const b of bells) await bell(b.userId, b.text, b.link, undefined, { testId: b.testId, group: `reqclosed:${b.testId}` });
  return booked;
}
/** (§185) A bell owed to the other person of a request a booking closed. */
type DropBell = { userId: string; text: string; link: string; testId: string };

type DropExcept = { id?: string; batchId?: string };
/** A "one of" request's times left, stored as a request sent with only them would be (readKind): §184's drop and (§187) a Decline / Withdraw of one time. */
const keptRowsData = (kept: CallRow[]) => {
  const single = kept.length === 1 && kept[0].repeat !== "once" && kept[0].count > 0 ? kept[0] : null;
  return { rows: toJson(kept) as Prisma.InputJsonValue, times: kept.map((x) => x.startsAt), startsAt: kept[0].startsAt, weeks: single?.count ?? 0, repeat: single?.repeat ?? "" };
};
/** (Owner, Nov 4, §187) The same time (a row's time as sent back by the page). */
const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime();
/** (§187) A Decline / Withdraw of a time no longer in the request (a booking dropped it, or it was declined or withdrawn meanwhile). */
export const TIME_GONE = "That time is no longer in this request.";
/** (§187) Pressed on another time of a "one of" request after one of its times was booked. */
export const OTHER_TIME_BOOKED = "Another time of this request was booked.";
/**
 * (Owner, Nov 4, §184) A call was just booked (inside its transaction): every other WAITING call request that involves either person in it (as the developer or as
 * the tester, sent by either side, on any test) and has a time overlapping the call is dropped. A single time (or a daily / weekly set: accepting it would refuse
 * the whole set) closes with a reason saying which of its two people is no longer free (never who the call is with); a "choose one" request loses only the
 * overlapping times, closing when none is left. Each of its two people gets one line on that request's test: the one with the call a quiet live-box line (their
 * booking, or the booking they were told about); the other one a Call changes line ("Ana Silva's request for … closed: she is no longer free at that time").
 * Requests between the same two people are dropped too (they would be refused anyway).
 */
async function dropOverlapping(tx: Prisma.TransactionClient, b: { startsAt: Date; minutes: number; people: string[] }, except: DropExcept, bells: DropBell[] = []) {
  const people = [...new Set(b.people)];
  // Every working session either person is in, on either side (an account can be a developer and a tester).
  const cons = new Map((await tx.contract.findMany({ where: { status: "working", OR: [{ testerId: { in: people } }, { test: { developerId: { in: people } } }] }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const reqs = cons.size
    ? await tx.callRequest.findMany({
        where: { contractId: { in: [...cons.keys()] }, status: "pending", ...(except.id ? { id: { not: except.id } } : {}), ...(except.batchId ? { NOT: { batchId: except.batchId } } : {}) },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const ends = new Map<string, Date | null>();
  const now = new Date();
  for (const r of reqs) {
    const con = cons.get(r.contractId)!;
    if (!ends.has(r.testId)) ends.set(r.testId, await workEndOf(tx, r.testId));
    const end = ends.get(r.testId) ?? null;
    const rows = rowsOf(r);
    const hit = rows.filter((x) => occurrences(x, end).some((t) => overlaps(t, r.minutes, b.startsAt, b.minutes)));
    if (!hit.length) continue;
    const kept = rows.filter((x) => !hit.includes(x));
    const dev = con.test.developer, tester = con.tester;
    const devBusy = people.includes(dev.id), testerBusy = people.includes(tester.id);
    const reason = devBusy && testerBusy ? DROP_BOTH : devBusy ? DROP_DEV_BUSY : DROP_TESTER_BUSY;
    const partial = rows.length > 1 && kept.length > 0;
    if (partial) {
      // The times left, stored as a request sent with only them would be (readKind).
      const done = await tx.callRequest.updateMany({ where: { id: r.id, status: "pending" }, data: keptRowsData(kept) });
      if (!done.count) continue;
    } else {
      const done = await tx.callRequest.updateMany({ where: { id: r.id, status: "pending" }, data: { status: "closed", closedReason: reason, decidedAt: now } });
      if (!done.count) continue;
    }
    const when = partial ? andList(hit.map((x) => T(x.startsAt))) : T(r.startsAt);
    // The developer's line and the tester's (both on the request's test, for its contract): each names the request's other person, with their pronoun (§162).
    const devText = dropLine({ reason, side: "developer", fromReader: r.fromSide === "developer", other: displayName(tester), otherPronoun: tester.pronoun, when, partial });
    const testerText = dropLine({ reason, side: "tester", fromReader: r.fromSide === "tester", other: displayName(dev), otherPronoun: dev.pronoun, when, partial });
    await recordEvent(tx, r.testId, devBusy ? "req_dropped" : "req_closed", `${devText}`, false, {}, r.contractId);
    await recordEvent(tx, r.testId, testerBusy ? "t_req_dropped" : "t_req_closed", `${testerText}`, false, {}, r.contractId);
    // (Owner, Nov 4, §185) The request's other person (the one without the call) is no longer stopped by it (req_closed / t_req_closed are quiet live-box lines
    // now, like the person with the call's): they get a bell instead (and its email, per their settings), stacked per test and day ("Call requests · 3 closed today").
    if (!devBusy) bells.push({ userId: dev.id, text: devText, link: `/app/tests/${r.testId}`, testId: r.testId });
    if (!testerBusy) bells.push({ userId: tester.id, text: testerText, link: `/app/sessions/${r.contractId}`, testId: r.testId });
  }
}

/** One request = one call (or one weekly run): once a copy of a developer batch books, the other copies close. */
async function closeBatch(batchId: string, exceptId: string) {
  if (!batchId) return;
  await db.callRequest.updateMany({ where: { batchId, id: { not: exceptId }, status: "pending" }, data: { status: "taken", closedReason: `Another tester took this time at ${fmtTime(new Date())}`, decidedAt: new Date() } });
}

/** Close pending requests (time passed, block, hold, Stop, End early, Leave). */
export async function closeRequests(where: { contractIds?: string[] }, reason: string) {
  const rows = await db.callRequest.findMany({ where: { status: "pending", ...(where.contractIds ? { contractId: { in: where.contractIds } } : {}) } });
  if (rows.length) await db.callRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "closed", closedReason: reason, decidedAt: new Date() } });
  return rows;
}

const refusalFor = (r: { status: string; updatedAt: Date; closedReason: string; fromSide: string; startsAt: Date }, otherName: string, mine: boolean) => {
  if (r.status === "taken") return `${r.closedReason}.`;
  // (Owner, Nov 4, §184) Dropped when a call was booked: "This request closed: fbbb is no longer free at that time." (never with whom), or the reader's own
  // "… you have another call at that time." The reader's side: the request's sender when it's theirs.
  if (r.status === "closed" && isDropReason(r.closedReason)) return `This request closed: ${dropReasonFor(r.closedReason, (mine ? r.fromSide : r.fromSide === "developer" ? "tester" : "developer") as Side, otherName)}.`;
  // (Owner, Nov 4, §185) The other side's withdrawal is said only here, once: "Ana Silva withdrew this request."
  if (r.status === "withdrawn") return mine ? "You already withdrew this request." : `${otherName} withdrew this request.`;
  if (r.status === "declined") return mine ? `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` : "You already declined this request.";
  // (Owner, Nov 3, §157) Only the side that didn't ask books a request: booked when it isn't yours means your other tab's Accept.
  if (r.status === "booked") return mine ? `This time was booked at ${fmtTime(r.updatedAt)}.` : `You already accepted this request at ${fmtTime(r.updatedAt)}.`;
  if (!mine && r.fromSide === "developer") return `The call time ${fmtDateTime(r.startsAt)} is no longer available.`;
  return `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.`;
};

/** (§157) Decide a request only while it is still pending (one claim); a press that lost to another tab or the other side reads what happened. */
async function claimRequest(id: string, status: string, other: Parameters<typeof displayName>[0], mine: boolean) {
  if ((await db.callRequest.updateMany({ where: { id, status: "pending" }, data: { status, decidedAt: new Date() } })).count === 1) return;
  throw new HttpError(409, "gone", refusalFor(await db.callRequest.findUniqueOrThrow({ where: { id } }), displayName(other), mine));
}

async function refusals(c: Ctx["c"], side: Side) {
  if (c.status !== "working") throw new HttpError(409, "closed", side === "tester" ? "Your session has ended." : `${displayName(c.tester)}'s session has ended.`);
  if (testPaused(c.test.developer, c.test)) throw new HttpError(409, "paused", side === "tester" ? `${PAUSED_RIGHT_NOW} You can request calls once it resumes.` : c.test.developer.devSuspendedAt ? DEV_SUSPENDED : c.test.developer.holdStartedAt ? "Pay what you owe first." : "The team paused this test.");
  // (Owner) "Closed" only means no NEW testers: testers already in carry on, so calls work. Only a stopped test refuses.
  if (c.test.status === "stopped") throw new HttpError(409, "closed", "This test was stopped.");
  await assertWorkOpen(db, c.testId);
  // (Owner, Oct 28 afternoon) Calls are allowed whether or not a live call is a listed part: one that isn't reads "Not listed" and its pay is up to the developer.
  if (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) throw new HttpError(409, "gone", "This time isn't available.");
}

// (Owner) Call REQUESTS (requested, withdrawn, declined, closed) are not bell lines: they show in Needs you, the Live session
// panel and the live top box. Booked and cancelled calls are bell lines (and stack there).

/**
 * (Owner, Oct 28, batch 16 section 33) The server's re-check of what the form shows red that the older checks don't cover: the requester's OTHER calls (another
 * person, any test: "You have a call with Ana Silva then (1:30–2:00 PM).") and two times in the request overlapping each other. The same lines as the form.
 */
async function ownCallClash(side: Side, who: { id: string; timeZone?: string | null }, contractIds: string[], rows: CallRow[], minutes: number, end: Date | null = null) {
  const since = new Date(Date.now() - 6 * 3_600_000);
  const others = side === "developer"
    ? (await db.call.findMany({ where: { status: "booked", startsAt: { gt: since }, contractId: { notIn: contractIds }, contract: { test: { developerId: who.id } } }, include: { contract: { include: { tester: true } } } })).map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes, name: displayName(x.contract.tester) }))
    : (await db.call.findMany({ where: { status: "booked", startsAt: { gt: since }, contractId: { notIn: contractIds }, contract: { testerId: who.id } }, include: { contract: { include: { test: { include: { developer: true } } } } } })).map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes, name: displayName(x.contract.test.developer) }));
  // (Batch 35 §132) A Daily / Weekly row's calls stop at the end, as the form checks them.
  const n = clashNotes({ rows: toJson(rows, end ? { at: end, day: "" } : null), minutes, side, targets: [], elsewhere: others, fmt: localFmt(safeZone(who.timeZone)) });
  return n.rows.flat().find((x) => x.tone === "red")?.text ?? "";
}

/** "You already requested this time with Ben Okafor." */
export const alreadyRequestedLine = (names: string[]) => `You already requested this time with ${andList(names)}.`;

/**
 * (Batch 18 section 6) A length longer than what's left of the $1,000 allows for these testers' calls (the smallest applies, named): "At most 95 minutes: the $1,000 for
 * calls with Ana on this test." Under 10 minutes left, the existing "can't be booked" line takes over.
 */
async function lengthOverCap(minutes: number, targets: { contractId: string; rateCents: number | null; name: string }[]) {
  let best: { max: number; name: string } | null = null;
  for (const t of targets) {
    const max = bookableMinutes(t.rateCents, await callsLeftCents(t.contractId));
    if (!best || max < best.max) best = { max, name: t.name };
  }
  return best && best.max >= CALL_MIN_MINUTES && minutes > best.max ? lengthCapLine(best.max, best.name) : "";
}

/** (§208) Who a press can't go to for the limits, and why: grouped into one line per kind and room ("You can send 1 more request to Ana Silva and Ben Carter today."). */
type Limited = { name: string; room: Room };
function limitText(list: Limited[], order: Room["kind"][], short = false) {
  const groups = new Map<string, { room: Room; names: string[] }>();
  for (const k of order) for (const l of list.filter((x) => x.room.kind === k)) {
    const key = `${l.room.kind}:${l.room.have}`;
    groups.set(key, { room: l.room, names: [...(groups.get(key)?.names ?? []), l.name] });
  }
  return [...groups.values()].map((g) => roomText(andList(g.names), g.room, short)).join(" ");
}

/**
 * Developer: Request a time with one or more ticked working testers. (Owner, Nov 5, §208) Each row of the form is its OWN request: one batch per row, sent to every
 * ticked tester (the first tester to accept a row's request takes it and that row's other copies close, as before); the rows never close each other. Each counts
 * toward the §185 limits (3 in total, 3 sends a day): a tester the whole press doesn't fit is refused for all of it, saying how many more can go.
 */
export async function devRequestTime(dev: U, testId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.contractIds) ? body.contractIds.map(String) : body.contractId ? [String(body.contractId)] : [];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  // (Batch 35 §132) Every time inside the call window: at least the lead ahead, and no later than when testers' work on this test ends.
  const end = await workEndOf(db, testId, dev.id);
  const kind = readKind(body, end);
  const reqMinutes = readMinutes(body);
  const all: Ctx[] = [];
  for (const id of ids) {
    const x = await ctx(dev.id, id);
    if (x.side !== "developer" || x.c.testId !== testId) throw new HttpError(404, "not_found", "That tester isn't in this test.");
    await refusals(x.c, "developer");
    all.push(x);
  }
  // (Batch 18 section 6) The Length is at most what's left of the $1,000 for each ticked tester's calls (red at the box).
  const overCap = await lengthOverCap(reqMinutes, all.map((x) => ({ contractId: x.c.id, rateCents: bookRate(x.c.test, x.c), name: displayName(x.c.tester) })));
  if (overCap) throw new HttpError(400, "bad_minutes", overCap);
  // (Batch 16 section 21) A time of this press already requested with them (e.g. in another tab meanwhile): already done, said plainly after the gate.
  const starts = kind.rows.map((r) => r.startsAt);
  const sameAgain = async (contractId: string) => !!(await db.callRequest.findFirst({ where: { contractId, fromSide: "developer", status: "pending", startsAt: { in: starts } } }));
  const devZone = all[0].me.timeZone;
  /**
   * (§208) Who the press goes to: each "once" row that is exactly a ticked tester's waiting request books it (the first such tester, in tick order: an auto-match,
   * as before) and is sent to nobody else; every other row is a new request to each tester. A tester whose share doesn't fit the limits (§185: `roomOf`) is left
   * out, which can hand their auto-match to the next tester, so it is worked out until nothing changes. `exempt`: never left out here (said after the gate).
   */
  const plan = async (exempt: Set<string>) => {
    const now = new Map<string, { sent: number; taken: number }>();
    const cands = new Map<string, Map<number, { match: Pending; hit: Date }>>();
    for (const { c } of all) {
      now.set(c.id, { sent: await sentToday(c.id, "developer", devZone), taken: await callsTaken(c.id) });
      cands.set(c.id, await autoMatches(c.id, "tester", kind.rows, reqMinutes));
    }
    const refused = new Map<string, Limited>();
    for (;;) {
      const match = new Map<number, { x: Ctx; match: Pending; hit: Date }>();
      kind.rows.forEach((_, i) => {
        for (const x of all) {
          const m = refused.has(x.c.id) ? undefined : cands.get(x.c.id)!.get(i);
          if (m && ![...match.values()].some((v) => v.match.id === m.match.id)) return void match.set(i, { x, ...m });
        }
      });
      let more = false;
      for (const x of all) {
        if (refused.has(x.c.id) || exempt.has(x.c.id)) continue;
        const mine = [...match.values()].filter((m) => m.x === x).length;
        const sends = kind.rows.length - (match.size - mine); // a row booked with another tester isn't sent to them
        const room = roomOf(now.get(x.c.id)!, sends, sends - mine);
        if (room) {
          refused.set(x.c.id, { name: displayName(x.c.tester), room });
          more = true;
        }
      }
      if (!more) return { match, refused };
    }
  };
  // (Owner, Nov 4, §185) Every ticked tester over the limits (3 in total, 3 sent today): refused on the first press, never a stop first. (§208) With several times,
  // the line says how many more can go: "You already have 2 calls or requests with Ana Silva: you can send 1 more." / "You can send 1 more request to Ana Silva today."
  const exempt = new Set<string>();
  for (const { c } of all) if (await sameAgain(c.id)) exempt.add(c.id);
  {
    const first = await plan(exempt);
    if (first.refused.size === all.length) throw new HttpError(409, "limit", limitText([...first.refused.values()], ["day", "total"]));
  }
  // (Batch 16 section 21) Another tab's call action with any of these testers stops it once.
  await db.$transaction((tx) => devGate(tx, testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: ids.map((id) => `c:${id}`) }));
  // (Batch 16 section 21) The same time again (e.g. requested in another tab meanwhile): already done, said plainly; the request shows in the panel.
  const again: string[] = [];
  for (const { c } of all) if (await sameAgain(c.id)) again.push(displayName(c.tester));
  if (again.length) throw new HttpError(409, "already", alreadyRequestedLine(again));
  const p = await plan(new Set());
  // Auto-matches: a row exactly a tester's waiting request books it (checked as the Accept would be: clashes with anyone's calls, the $1,000).
  for (const m of p.match.values()) {
    const clash = await acceptClash(m.x.c, "developer", [m.hit], m.match.minutes);
    if (clash.length) throw new HttpError(409, "clash", clash[0]);
    await checkCeiling(m.x.c.id, bookRate(m.x.c.test, m.x.c), m.match.minutes, 1, displayName(m.x.c.tester));
  }
  // (Batch 16 section 33) Your other calls, and (§208) two times of this press overlapping each other: refused at the row.
  {
    const own = await ownCallClash("developer", dev, all.map((x) => x.c.id), kind.rows, reqMinutes, end);
    if (own) throw new HttpError(409, "clash", own);
  }
  const sendRows = kind.each.filter((_, i) => !p.match.has(i));
  const matchIds = [...p.match.values()].map((m) => m.match.id);
  // Clashes and the $1,000, per tester; (§185) the limits from the plan.
  const blocked: string[] = [], limited: Limited[] = [], ok: Ctx[] = [];
  for (const x of all) {
    const lim = p.refused.get(x.c.id);
    if (lim) {
      limited.push(lim);
      continue;
    }
    if (sendRows.length) {
      const clash = await sendClash(x.c.id, sendRows.flatMap((k) => requestTimes(k, end)), reqMinutes, displayName(x.c.tester), matchIds, all.length === 1 ? { side: "developer", otherPoss: pronouns(x.c.tester.pronoun).poss } : undefined, end);
      // (Batch 15 section 34) Over the $1,000 for this tester's calls: refused for them (named with what's left). Each request on its own, as it would be accepted.
      const ceiling = clash ? "" : await ceilingRefusal(x.c.id, bookRate(x.c.test, x.c), reqMinutes, callsIfAccepted(sendRows.flatMap((k) => k.rows), end), displayName(x.c.tester));
      if (clash || ceiling) {
        blocked.push(clash || ceiling);
        continue;
      }
    }
    ok.push(x);
  }
  if (all.length === 1 && blocked.length) throw new HttpError(409, "clash", blocked[0]);
  if (all.length === 1 && limited.length) throw new HttpError(409, "limit", limitText(limited, ["total", "day"]));
  if (!ok.length) throw new HttpError(409, "limit", [...blocked, ...(limited.length ? [limitText(limited, ["total", "day"])] : [])].join(" "));
  if (blocked.length || limited.length) {
    // (§185) "You already have 3 calls booked or requested with Ana Silva and Ben Carter." / "You've sent 3 call requests to Cara Diaz today." (§208) / "You can send
    // 1 more request to Cara Diaz today." (the others go on the second press).
    const text = [...blocked, ...(limited.length ? [limitText(limited, ["total", "day"], true)] : [])].join(" ");
    // (Owner, NEXT-UI 12b) The second press names what the box said (limitSeen); if who is blocked / at the limit changed
    // since, it stops again with the new line.
    if (body.confirmed !== true || body.limitSeen !== text) {
      throw new HttpError(409, "stop_once", "Press again to send to the others.", { changes: [{ text, at: new Date() }], tail: `Press again to send to the others (${ok.map((x) => displayName(x.c.tester)).join(", ")}).`, limit: true, limitSeen: text });
    }
  }
  // The auto-matches book first (each turns their request into one booked time; §184: its own match is booked here, never dropped).
  const callIds: string[] = [];
  let bookedLine = "";
  for (const m of p.match.values()) {
    if (!ok.includes(m.x)) continue;
    const c = m.x.c;
    const call = await bookAt(c.id, m.hit, m.match.minutes, bookRate(c.test, c), null, true, false, { id: m.match.id });
    await db.callRequest.update({ where: { id: m.match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date(), closedReason: "matched" } });
    const line = `Booked: you both picked ${T(m.hit)}`;
    await notify(c.tester.email, line, [line], `/app/sessions/${c.id}#call-${call.id}`, { about: c.test.developerId });
    callIds.push(call.id);
    bookedLine ||= line;
  }
  // (§208) Then one request per row: a batch per row (the first tester to accept it takes it), all created together under the test's lock.
  const batchIds = sendRows.map(() => randomBytes(8).toString("hex"));
  const made = await createRequests(sendRows.flatMap((k, i) => ok.map(({ c }) => ({ testId, contractId: c.id, fromSide: "developer", ...kindData(k), minutes: reqMinutes, batchId: batchIds[i] }))));
  // One live line per request (per row), as a single send writes it.
  for (const k of sendRows) await db.$transaction((tx) => recordEvent(tx, testId, "requested", `You requested ${kindWords(k.rows)} from ${T(k.startsAt)} with ${ok.length} tester${ok.length === 1 ? "" : "s"}`, false));
  // (Batch 20 section 7) The new requests' ids (and a booked call's): the form never counts them as a clash with itself.
  return {
    requested: sendRows.length ? ok.length : 0, batchId: batchIds[0] ?? "", batchIds, ids: made.map((r) => r.id),
    // (§177) the page shows it: the time written, never its token
    ...(callIds.length ? { booked: true, callId: callIds[0], callIds, message: renderTimes(bookedLine, dateZone()) } : {}),
  };
}

/**
 * Tester: Request a time, always at the contract rate. (Owner, Nov 5, §208) Each row of the form is its OWN request (once, or a daily / weekly set): the developer
 * answers each on its own. A row exactly at one of the developer's waiting single times books it (auto-match), as before.
 */
export async function testerRequestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const x = await ctx(user.id, contractId);
  const { c, side } = x;
  if (side !== "tester") throw new HttpError(404, "not_found", "That session doesn't exist.");
  await refusals(c, "tester");
  await answerTermsFirst(contractId);
  // (Batch 35 §132) Every time inside the call window: at least the lead ahead, and no later than when testers' work on this test ends.
  const end = await workEndOf(db, c.testId);
  const kind = readKind(body, end);
  const devName = displayName(c.test.developer);
  const n = kind.rows.length;
  // (Owner, Nov 4, §185) Over the limits with the developer (3 in total, both sides; 3 sent today): refused on the first press, never a stop first (a row that only
  // auto-matches the developer's own request at that time books it, which adds nothing to the total). The form's own mistakes (the length, red at its box) come
  // first, now before the gate as on the developer's side. (§208) Each row is a request: the press is refused as a whole, saying how many more can go.
  const minutes = readMinutes(body);
  // (Batch 18 section 6) The Length is at most what's left of the $1,000 for their calls (red at the box).
  const overCap = await lengthOverCap(minutes, [{ contractId, rateCents: bookRate(c.test, c), name: devName }]);
  if (overCap) throw new HttpError(400, "bad_minutes", overCap);
  const limitNow = async (matches: number) => roomLine(devName, { sent: await sentToday(contractId, "tester", x.me.timeZone), taken: await callsTaken(contractId) }, n, n - matches);
  {
    const line = await limitNow((await autoMatches(contractId, "developer", kind.rows, minutes)).size);
    if (line) throw new HttpError(409, "limit", line);
  }
  await testerGate(c.testerId, contractId, c.testId, body, undefined, CALL_PRESS);
  // Auto-match (rates match): a row at exactly one of the developer's waiting single times books it.
  const match = await autoMatches(contractId, "developer", kind.rows, minutes);
  for (const m of match.values()) {
    const clash = await acceptClash(c, "tester", [m.hit], m.match.minutes);
    if (clash.length) throw new HttpError(409, "clash", clash[0]);
    await checkCeiling(contractId, bookRate(c.test, c), m.match.minutes, 1, devName);
  }
  const own = await ownCallClash("tester", user, [contractId], kind.rows, minutes, end); // (batch 16 section 33; §208: two rows overlapping each other too)
  if (own) throw new HttpError(409, "clash", own);
  const sendRows = kind.each.filter((_, i) => !match.has(i));
  if (sendRows.length) {
    const clash = await sendClash(contractId, sendRows.flatMap((k) => requestTimes(k, end)), minutes, devName, [...match.values()].map((m) => m.match.id), { side: "tester", otherPoss: pronouns(c.test.developer.pronoun).poss }, end);
    if (clash) throw new HttpError(409, "clash", clash);
  }
  {
    const line = await limitNow(match.size); // (§185) changed since the first check
    if (line) throw new HttpError(409, "limit", line);
  }
  if (sendRows.length) await checkCeiling(contractId, bookRate(c.test, c), minutes, callsIfAccepted(sendRows.flatMap((k) => k.rows), end), devName);
  const callIds: string[] = [];
  let bookedLine = "";
  for (const m of match.values()) {
    const call = await bookAt(contractId, m.hit, m.match.minutes, bookRate(c.test, c), null, false, false, { id: m.match.id, batchId: m.match.batchId }); // (Owner, Nov 4, §184) its batch closes as taken below
    // (Owner, Nov 4, §185) "matched": the tester's auto-match counts as one of her sends today (sentToday), as the developer's does.
    await db.callRequest.update({ where: { id: m.match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date(), closedReason: "matched" } });
    await closeBatch(m.match.batchId, m.match.id);
    const line = `Booked: you both picked ${T(m.hit)}`;
    await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#call-${call.id}`, { about: c.testerId });
    callIds.push(call.id);
    bookedLine ||= line;
  }
  const made = await createRequests(sendRows.map((k) => ({ testId: c.testId, contractId, fromSide: "tester", ...kindData(k), minutes })));
  for (const [i, r] of made.entries()) {
    const k = sendRows[i];
    await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(c.tester)} requested ${k.rows[0].repeat !== "once" ? `${kindWords(k.rows)} from` : "a call for"} ${T(k.startsAt)}`, false, {}, contractId, "", `req-${r.id}`));
    // (Batch 15 section 35) The developer's bell: "<name> asked for a call: <time>", stacked with the day's other request lines; each time in the reader's own zone.
    // (Batch 17 section 4) It opens the Live session's Call requests panel with this request highlighted. (§208) One per request, so each links to its own.
    const row = k.rows[0];
    await bell(c.test.developerId, `${displayName(c.tester)} asked for a call: ${T(row.startsAt)}${row.repeat === "once" ? "" : row.repeat === "daily" ? " (daily)" : " (weekly)"}`, `/app/tests/${c.testId}#req-${r.id}`, c.testerId, { group: "callrequests" });
  }
  return {
    requested: made.length > 0, id: made[0]?.id, ids: made.map((r) => r.id),
    // (§177) the page shows it: the time written, never its token
    ...(callIds.length ? { booked: true, callId: callIds[0], callIds, message: renderTimes(bookedLine, dateZone()) } : {}),
  };
}

/** Either side's Request a time (one contract). */
export async function requestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side } = await ctx(user.id, contractId);
  return side === "developer" ? devRequestTime(user, c.testId, { ...body, contractIds: [contractId] }) : testerRequestTime(user, contractId, body);
}

/**
 * Accept (the other side; "choose one": pick one time) / Decline / Withdraw (your own).
 * (Owner, Nov 4, §187, option A) A "one of" request shows ONE ROW PER TIME, each with its own buttons, and the press names its time (`time`): Accept books that
 * time (the request's other times close with it: it is one request); Decline (theirs) or Withdraw (yours) on a row takes out just that time, and the last time
 * taken out declines / withdraws the request. It stays one request for the limits (3 in total, 3 sends a day). A press on a time no longer in a waiting request:
 * Accept "Pick one of the times." (as before), Decline / Withdraw TIME_GONE; on another time of a request already booked: OTHER_TIME_BOOKED.
 */
export async function answerRequest(user: U, contractId: string, body: Record<string, unknown>) {
  const x = await ctx(user.id, contractId);
  const { c, side, other } = x;
  const r = await db.callRequest.findUnique({ where: { id: String(body.requestId ?? "") } });
  if (!r || r.contractId !== contractId) throw new HttpError(404, "not_found", "That request doesn't exist.");
  if (side === "tester") await answerTermsFirst(contractId);
  const action = String(body.action ?? "");
  const mine = r.fromSide === side;
  if (r.status === "pending" && r.startsAt < new Date()) await db.callRequest.update({ where: { id: r.id }, data: { status: "closed", closedReason: TIME_PASSED_REASON } });
  const fresh = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
  // (Batch 16 section 21) Answered or withdrawn in another tab: the developer's press stops once naming it, then it's already done.
  // (Owner, Nov 4, §184) A request dropped when a call was booked: refused at once (a single refusal), never a stop first.
  // (Owner, Nov 4, §185) Likewise one the OTHER side withdrew: never a stop for anyone; answering it is ONE refusal, "Ana Silva withdrew this request."
  const theyWithdrew = fresh.status === "withdrawn" && !mine;
  if (fresh.status !== "pending" && side === "developer" && !(fresh.status === "closed" && isDropReason(fresh.closedReason)) && !theyWithdrew) await db.$transaction((tx) => devGate(tx, c.testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: [`req:${r.id}`, `c:${contractId}`] }));
  // (§187) The press names a time: on a request booked at another of its times, the line says so (not "This time was booked").
  const pick = body.time ? new Date(String(body.time)) : null;
  if (pick && isNaN(pick.getTime())) throw new HttpError(400, "pick", "Pick one of the times.");
  if (fresh.status === "booked" && pick && fresh.callId) {
    const call = await db.call.findUnique({ where: { id: fresh.callId }, select: { startsAt: true } });
    if (call && !sameTime(call.startsAt, pick) && rowsOf(fresh).length > 1) throw new HttpError(409, "gone", mine ? OTHER_TIME_BOOKED : `You already accepted another time of this request at ${fmtTime(fresh.updatedAt)}.`);
  }
  if (fresh.status !== "pending") throw new HttpError(409, "gone", refusalFor(fresh, displayName(other), mine));
  if (action === "withdraw" ? !mine : mine) throw new HttpError(409, "not_yours", mine ? "You can't answer your own request: withdraw it instead." : "Only the person who asked can withdraw it.");
  // (Owner, Nov 4, §185) Accepting with the pair already over 3 (booked + waiting, from before the limit): refused at once, before the gate. An Accept turns this
  // request into one booked time, so it never raises the count.
  if (action === "accept" && (await callsTaken(contractId)) > MAX_CALLS) throw new HttpError(409, "limit", callLimitLine(displayName(other)));
  // (Batch 35 §79) Accept / Decline never stops for the line about this request itself (the developer's: the tester's "requested …" on this contract).
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: [`req:${r.id}`, `c:${contractId}`], answers: { item: r.id, kinds: ["requested"], contractId } }));
  else await testerGate(c.testerId, contractId, c.testId, body, undefined, { ...CALL_PRESS, answers: { item: r.id } });
  if (action === "accept") {
    await refusals(c, side);
    // (Owner, Nov 3, §157) Claimed before anything is checked or booked: of two Accepts (two tabs), or an Accept and a Withdraw / Decline at the same moment,
    // exactly one goes through; the other reads what happened (refusalFor), never the first one's booking as a clash. A check or a booking that fails afterwards
    // puts the request back as it was.
    await claimRequest(r.id, "booked", other, mine);
    let first: Awaited<ReturnType<typeof bookAt>> | null = null;
    let times: Date[] = [];
    let row: CallRow;
    const rate = bookRate(c.test, c);
    try {
      // Every call books at the contract rate, fixed at acceptance (every week of a weekly); a call that isn't a listed part has none (`rate`, above).
      // The other side picks ONE row; a repeating row books its whole set (Forever: the next 4 ahead).
      // (§187) Read as claimed (a Decline / Withdraw of another time may have taken times out meanwhile); a named time must still be in it.
      const rowsR = rowsOf(await db.callRequest.findUniqueOrThrow({ where: { id: r.id } }));
      if (rowsR.length === 1 && (!pick || sameTime(rowsR[0].startsAt, pick))) row = rowsR[0];
      else {
        const chosen = pick ? rowsR.find((x) => sameTime(x.startsAt, pick)) : undefined;
        if (!chosen) throw new HttpError(400, "pick", "Pick one of the times.");
        row = chosen;
      }
      // (Owner, Nov 2, batch 35 §132) The time must still be inside the call window: at least the lead ahead NOW (a request from 2 days ago for tomorrow can't be booked
      // once it's less than 24 hours away) and no later than when testers' work on this test ends; a set's calls after the end are dropped (as when it was sent).
      const end = await workEndOf(db, c.testId);
      if (!farEnoughAhead(row.startsAt)) throw new HttpError(409, "too_soon", tooSoonToBookLine(fmtDateTime(row.startsAt), CALL_MIN_AHEAD_MINUTES));
      const inWindow = cutRow(row, end);
      if (!inWindow) throw new HttpError(409, "after_end", afterEndToBookLine(fmtDateTime(row.startsAt), fmtDateTime(end!)));
      row = inWindow;
      times = occurrences(row, end);
      if (row.repeat !== "once") {
        // Every call is checked; any clash refuses the whole request and names the week(s) / day(s).
        const bad: string[] = [];
        for (const [i, t] of times.entries()) {
          const cl = await acceptClash(c, side, [t], r.minutes);
          if (cl.length) bad.push(`${row.repeat === "daily" ? "day" : "week"} ${i + 1} (${fmtDateTime(t)}): ${cl[0]}`);
        }
        if (bad.length) throw new HttpError(409, "clash", `These ${row.repeat === "daily" ? "days" : "weeks"} clash: ${bad.join(" ")}`);
      } else {
        const clashes = await acceptClash(c, side, times, r.minutes);
        if (clashes.length) throw new HttpError(409, "clash", clashes[0]);
      }
      // (Owner, Nov 4, §185) Claimed, this request no longer counts as waiting: booking it makes one more booked time, so the others must leave room for it.
      if ((await callsTaken(contractId)) >= MAX_CALLS) throw new HttpError(409, "limit", callLimitLine(displayName(other)));
      // (Batch 18 section 6) A request longer than what's left of the $1,000 allows: "At most 95 minutes: ...".
      const overCap = await lengthOverCap(r.minutes, [{ contractId, rateCents: rate, name: side === "developer" ? displayName(c.tester) : displayName(c.test.developer) }]);
      if (overCap) throw new HttpError(409, "calls_ceiling", overCap);
      // (Batch 15 section 34) A pending request over the $1,000 for calls can't be accepted.
      await checkCeiling(contractId, rate, r.minutes, times.length, side === "developer" ? displayName(c.tester) : displayName(c.test.developer));
      // A repeating pick is one CallSet (it counts as 1 of the 3 booked times); Forever keeps the next 4 ahead.
      const set = row.repeat === "once" ? null : await db.callSet.create({ data: { testId: c.testId, contractId, repeat: row.repeat, count: row.count, minutes: r.minutes, rateCents: rate, nextAt: new Date(row.startsAt.getTime() + times.length * stepMs(row.repeat)) } });
      for (const t of times) {
        const call = await bookAt(contractId, t, r.minutes, rate, set?.id ?? null, side === "developer", false, { id: r.id, batchId: r.batchId }); // (Owner, Nov 4, §184) not this request, nor its batch (taken)
        first = first ?? call;
      }
    } catch (e) {
      if (!first) await db.callRequest.updateMany({ where: { id: r.id, status: "booked", callId: null }, data: { status: "pending", decidedAt: null } });
      throw e;
    }
    await db.callRequest.update({ where: { id: r.id }, data: { callId: first!.id } });
    if (side === "tester") await closeBatch(r.batchId, r.id);
    const what = row.repeat === "once" ? T(times[0]) : row.count ? `${times.length} ${unitOf(row.repeat)} calls from ${T(times[0])}` : `${unitOf(row.repeat)} calls from ${T(times[0])} (until testers' work ends)`;
    await notify(other.email, `Booked: ${what}`, [`${displayName(user)} accepted the call request: ${what} (${rateLabel(rate, c.liveRateCents)}).`], side === "tester" ? `/app/tests/${c.testId}#call-${first!.id}` : `/app/sessions/${c.id}#call-${first!.id}`, { about: user.id });
    return { booked: true, callId: first!.id, calls: times.length };
  }
  const status = action === "withdraw" ? "withdrawn" : "declined";
  // (Owner, Nov 4, §187) A Decline / Withdraw on one row of a "one of" request takes out just that time; the last one left declines / withdraws the request.
  const rowsNow = rowsOf(fresh);
  const hit = pick ? rowsNow.find((x) => sameTime(x.startsAt, pick)) : undefined;
  if (pick && !hit) throw new HttpError(409, "gone", TIME_GONE);
  if (hit && rowsNow.length > 1) {
    const kept = rowsNow.filter((x) => x !== hit);
    // Only over the times as read (a booking, a drop or another press changing them meanwhile wins; this press then reads what happened).
    const done = await db.callRequest.updateMany({ where: { id: r.id, status: "pending", times: { equals: fresh.times } }, data: keptRowsData(kept) });
    if (!done.count) {
      const now = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
      throw new HttpError(409, "gone", now.status !== "pending" ? refusalFor(now, displayName(other), mine) : rowsOf(now).some((x) => sameTime(x.startsAt, pick!)) ? "This request changed meanwhile. Press again." : TIME_GONE);
    }
    await timeAnswered(user, c, side, other, status, hit.startsAt);
    return { [status]: true, time: hit.startsAt.toISOString(), left: kept.length };
  }
  await claimRequest(r.id, status, other, mine);
  await timeAnswered(user, c, side, other, status, hit?.startsAt ?? r.startsAt);
  return { [status]: true };
}

/** The live lines (and a withdrawal's bell) for a declined or withdrawn request, or (§187) one time of it: "You declined Ana Silva's call request for …". */
async function timeAnswered(user: U, c: Ctx["c"], side: Side, other: Ctx["other"], status: "withdrawn" | "declined", at: Date) {
  const contractId = c.id;
  // (Owner bug, Oct 31, batch 35 §74) The developer's own withdraw / decline is theirs ("You …": never a stop from the same page; another tab's is the action log's
  // "You withdrew a call request for … in another tab"), and the past tense is "withdrew" (it read "dev withdrawn a call request").
  const verb = status === "withdrawn" ? "withdrew" : "declined";
  const when = T(at);
  const text = side === "developer" ? `You ${verb} ${status === "withdrawn" ? "a" : `${displayName(other)}'s`} call request for ${when}` : `${displayName(user)} ${verb} a call request for ${when}`;
  // (Owner, Nov 4, §185) A tester's withdrawal ("withdrew_req") is a quiet live-box line for the developer (DEV_QUIET_KINDS), never a stop; a decline (an answer
  // to the developer's request) stops as a Call change.
  await db.$transaction((tx) => recordEvent(tx, c.testId, status === "withdrawn" ? "withdrew_req" : "declined_req", text, false, {}, contractId));
  // (Owner, Nov 4, §185) A withdrawal is never a stop for the other person (a quiet live-box line): they get a bell instead (and its email, per their settings),
  // stacked per test and day with the requests a booking closed ("Call requests · 3 closed today").
  if (status === "withdrawn") {
    const line = `${displayName(user)} withdrew a call request for ${when}`;
    await bell(other.id, line, side === "developer" ? `/app/sessions/${c.id}` : `/app/tests/${c.testId}`, undefined, { testId: c.testId, group: `reqclosed:${c.testId}` });
  }
}


// ---------- (NEXT-UI 7) Daily / weekly sets: cancel the rest, and Forever sets kept 4 ahead ----------

/**
 * CANCEL on a booked set's line: the only way to stop a repeating set. Cancels every call of it still ahead (a reason is
 * required if the next one is within 24 hours) and ends the set; the other side is told once.
 */
export async function cancelCallSet(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side, other } = await ctx(user.id, contractId);
  if (side === "tester") await answerTermsFirst(contractId);
  const setId = String(body.setId ?? "");
  const reason = readText(body.reason, LIMITS.reason, "reason"); // (batch 15 section 20) refused over 1,000, never cut
  const now = new Date();
  const ahead = () => db.call.findMany({ where: { contractId, setId, status: "booked", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  const first = await ahead();
  if (!first.length) throw new HttpError(409, "cancelled", "The remaining calls of this set were already cancelled.");
  const ok = checkCancel(first[0].startsAt, now, reason);
  if (!ok.ok) throw new HttpError(400, "reason", ok.message);
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body, {}, [], undefined, { acts: CALL_ACTS, keys: [`set:${setId}`, `c:${contractId}`] }));
  else await testerGate(c.testerId, contractId, c.testId, body, undefined, CALL_PRESS);
  const calls = await ahead();
  if (!calls.length) throw new HttpError(409, "cancelled", "The remaining calls of this set were already cancelled.");
  const set = await db.callSet.findUnique({ where: { id: setId } });
  const unit = set ? unitOf(set.repeat) : calls.length > 1 && calls[1].startsAt.getTime() - calls[0].startsAt.getTime() < 2 * 86_400_000 ? "daily" : "weekly";
  await db.$transaction(async (tx) => {
    await tx.call.updateMany({ where: { id: { in: calls.map((x) => x.id) } }, data: { status: "cancelled", cancelledBy: side, cancelledAt: now, cancelNote: reason } });
    await tx.callSlot.updateMany({ where: { id: { in: calls.map((x) => x.slotId) } }, data: { status: "removed" } });
    if (set) await tx.callSet.update({ where: { id: set.id }, data: { status: "cancelled" } });
    await recordEvent(tx, c.testId, "cancelled", `${side === "developer" ? "You" : displayName(user)} cancelled the ${unit} calls from ${T(calls[0].startsAt)} (${calls.length} left)`, false, {}, contractId);
  });
  // (Batch 15 sections 11 and 20) The time in the reader's own zone; the reason only in the email, never in the bell line.
  const line = `${displayName(user)} cancelled the remaining ${unit} calls (${calls.length}), starting ${T(calls[0].startsAt)}.`;
  await notify(other.email, line, [line, ...(reason ? [`${pronouns(user.pronoun).Poss} reason: “${reason}”`] : [])], side === "developer" ? `/app/sessions/${contractId}#call-${calls[0].id}` : `/app/tests/${c.testId}#call-${calls[0].id}`, { about: user.id });
  return { cancelled: calls.length };
}

/**
 * The daily job's top-up: every active Forever set keeps its next 4 calls booked (each checked for clashes with either
 * side's other calls: a clashing one is skipped and both are told). A set ends when the tester's part ends (left, rated,
 * ended) or the test stops; a payment hold waits.
 * (Owner, Nov 2, batch 35 §132) Forever runs until testers' work on the test ends: no call is added after the end. The set waits there (an end that moves later, e.g.
 * Open until extended or a pause lifted, lets it go on), and ends with the work.
 */
export async function topUpForeverSets(now = new Date()) {
  const sets = await db.callSet.findMany({ where: { status: "active", count: 0 }, include: { contract: { include: { tester: true, test: { include: { developer: true, contracts: { select: { dueAt: true } } } } } } } });
  let booked = 0, skipped = 0;
  for (const set of sets) {
    const c = set.contract;
    if (c.status !== "working" || c.test.status === "stopped") {
      await db.callSet.update({ where: { id: set.id }, data: { status: "ended" } });
      continue;
    }
    if (testPaused(c.test.developer, c.test)) continue;
    const end = c.test.workEndedAt ?? workDeadlineOf(c.test, c.test.contracts);
    let ahead = await db.call.count({ where: { setId: set.id, status: "booked", startsAt: { gt: now } } });
    let nextAt = set.nextAt;
    for (let guard = 0; ahead < FOREVER_AHEAD && guard < FOREVER_AHEAD * 2; guard++) {
      const at = nextAt;
      if (end && at.getTime() > end.getTime()) break; // (batch 35 §132) the next call would be after the end: it waits there
      nextAt = new Date(at.getTime() + stepMs(set.repeat));
      if (at.getTime() <= now.getTime()) continue; // (an old occurrence: never booked back in time)
      const clash = await acceptClash(c, "developer", [at], set.minutes);
      // (Batch 15 section 34) Over the $1,000 for this tester's calls: skipped, both told.
      const ceiling = clash.length ? "" : await ceilingRefusal(c.id, set.rateCents, set.minutes, 1, displayName(c.tester));
      if (ceiling) {
        skipped++;
        const line = `The ${unitOf(set.repeat)} call on ${T(at)} was skipped: calls on this test can come to at most $1,000.`;
        await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#calls`);
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
        continue;
      }
      if (clash.length) {
        skipped++;
        const line = `The ${unitOf(set.repeat)} call on ${T(at)} was skipped: ${displayName(c.tester)} or ${displayName(c.test.developer)} already has a call at that time.`;
        await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#calls`);
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
        continue;
      }
      // (Owner, Nov 4, §185) No limit check: the set already counts as one booked time while it runs (bookedTimes), so a call added to it never goes past 3.
      await bookAt(c.id, at, set.minutes, set.rateCents, set.id, true, true);
      booked++;
      ahead++;
    }
    await db.callSet.update({ where: { id: set.id }, data: { nextAt } });
  }
  return { booked, skipped };
}
