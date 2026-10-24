import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime, money, pronouns, toCents } from "@/lib/format";
import { checkCallMinutes, checkCancel } from "@/lib/rules";
import { FOREVER_AHEAD, MAX_ROWS, occurrences, rowsOf, stepMs, toJson, type CallRow, type RowRepeat } from "@/lib/callRows";
import type { Prisma } from "@prisma/client";
import { PAUSED_FOR_TESTERS } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { devGate, recordEvent } from "./tests";
import { testerGate } from "./testerGate";

// Calls are ALWAYS requests (owner rules). Every call starts as a request from one side and is booked only when the
// other side accepts, or by auto-match. A request is ONE of:
//   "Choose one": up to 3 possible times; the other side picks one → 1 call.
//   "Daily"/"Weekly": 1 time repeated 2–8 times; accepting books them all (each an ordinary call afterwards).
// The developer requests with one or more ticked testers (the first tester to accept takes the whole request); the
// developer never sets a price. The tester can "Ask $___/h" on their own requests only; a different ask never books on
// the tester's side. Limit: 3 items per tester per test (both sides' pending requests and booked calls; a daily/weekly set = 1). Clash checks:
// sending refuses overlaps with calls/requests between the same two; accepting refuses overlaps with anyone's calls.

type Side = "developer" | "tester";
type U = { id: string; email: string; name: string };
const DAY_MS = 86_400_000;
/** Limits per tester per test: up to 3 booked times (a single call = 1, a daily/weekly set = 1) and up to 3 pending
 * requests (both sides together). */
export const MAX_BOOKED = 3;
export const MAX_REQUESTS = 3;

async function ctx(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const side: Side | null = c?.testerId === userId ? "tester" : c?.test.developerId === userId ? "developer" : null;
  if (!c || !side) throw new HttpError(404, "not_found", "That session doesn't exist.");
  return { c, side, other: side === "tester" ? c.test.developer : c.tester, me: side === "tester" ? c.tester : c.test.developer };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

function readAsk(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const c = toCents(v);
  if (c == null || c < 0) throw new HttpError(400, "bad_ask", "Enter the rate you ask like 50.00, or leave it empty.");
  return c;
}
const askMatches = (ask: number | null, contractRate: number | null) => ask == null || ask === contractRate;
export const rateLabel = (rateCents: number | null, contractRate: number | null) =>
  rateCents == null ? "Not in your contract" : `${rateCents === contractRate ? "Contract" : "Agreed"} ${money(rateCents).replace(/\.00$/, "")}/h`;

/** Every call time a request covers: each row's calls (a Forever row: the next 4 ahead). */
export const requestTimes = (r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat?: string }) => rowsOf(r).flatMap(occurrences);
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
 */
function readRows(body: Record<string, unknown>): CallRow[] {
  const future = (d: Date) => {
    if (isNaN(d.getTime())) throw new HttpError(400, "bad_time", "Pick a time in the future.");
    if (d.getTime() < Date.now() + 5 * 60_000) throw new HttpError(400, "bad_time", "Pick times in the future.");
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
      if (!forever && (!Number.isInteger(n) || n < 2 || n > 8)) throw new HttpError(400, "bad_weeks", `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times, or Forever.`);
      return { startsAt, repeat, count: forever ? 0 : n };
    });
  } else {
    const weeks = Number(body.weeks ?? body.count ?? 0) || 0;
    const repeat: RowRepeat = weeks ? (body.repeat === "daily" ? "daily" : "weekly") : "once";
    const raw = Array.isArray(body.times) ? body.times : body.startsAt ? [body.startsAt] : [];
    const times = raw.map((x) => new Date(String(x))).filter((d) => !isNaN(d.getTime()));
    if (!times.length) throw new HttpError(400, "bad_time", "Pick a time in the future.");
    times.forEach(future);
    if (weeks) {
      if (times.length !== 1) throw new HttpError(400, "bad_kind", `A ${repeat} request has exactly one time.`);
      if (weeks < 2 || weeks > 8) throw new HttpError(400, "bad_weeks", `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.`);
      rows = [{ startsAt: times[0], repeat, count: weeks }];
    } else rows = times.map((startsAt) => ({ startsAt, repeat: "once" as const, count: 1 }));
  }
  if (!rows.length) throw new HttpError(400, "bad_time", "Pick a time in the future.");
  if (rows.length > MAX_ROWS) throw new HttpError(400, "bad_kind", "Offer up to 3 times to choose from.");
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function readKind(body: Record<string, unknown>) {
  const rows = readRows(body);
  // The older columns keep their meaning for a single counted repeating row (what the rest of the app reads).
  const single = rows.length === 1 && rows[0].repeat !== "once" && rows[0].count > 0 ? rows[0] : null;
  return { rows, startsAt: rows[0].startsAt, times: rows.map((r) => r.startsAt), weeks: single?.count ?? 0, repeat: single?.repeat ?? "" };
}
type Kind = ReturnType<typeof readKind>;
const unitOf = (repeat: string) => (repeat === "daily" ? "daily" : "weekly");
/** "weekly calls (4 weeks)" / "daily calls (until cancelled)" for a one-row repeat, else "a call". */
const kindWords = (rows: CallRow[]) => {
  const r = rows.length === 1 && rows[0].repeat !== "once" ? rows[0] : null;
  return r ? `${unitOf(r.repeat)} calls (${r.count ? `${r.count} ${r.repeat === "daily" ? "days" : "weeks"}` : "until cancelled"})` : "a call";
};

/** Sending: a time overlapping a booked call or a pending request between the same two people is refused. */
async function sendClash(contractId: string, times: Date[], minutes: number, otherName: string, exceptId?: string, mine?: { side: Side; otherPoss: string }) {
  const [calls, reqs] = await Promise.all([
    db.call.findMany({ where: { contractId, status: "booked", startsAt: { gt: new Date(Date.now() - 6 * 3_600_000) } } }),
    db.callRequest.findMany({ where: { contractId, status: "pending", ...(exceptId ? { id: { not: exceptId } } : {}) } }),
  ]);
  for (const t of times) {
    const call = calls.find((x) => overlaps(t, minutes, x.startsAt, x.minutes));
    if (call) return `You already have a call with ${otherName} at ${fmtDateTime(call.startsAt)}.`;
    for (const r of reqs) {
      const hit = requestTimes(r).find((x) => overlaps(t, minutes, x, r.minutes));
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

/** Booked times still ahead with this tester (a single call = 1, a daily/weekly set = 1). */
export async function bookedTimes(contractId: string) {
  const calls = await db.call.findMany({ where: { contractId, status: "booked", startsAt: { gt: new Date() } }, select: { setId: true, id: true } });
  return new Set(calls.map((c) => c.setId ?? c.id)).size;
}
/** Pending requests with this tester (both sides together). */
export const pendingRequests = (contractId: string) => db.callRequest.count({ where: { contractId, status: "pending", startsAt: { gt: new Date() } } });
const requestLimitLine = (name: string) => `You already have ${MAX_REQUESTS} requests waiting with ${name}. Withdraw one or wait for an answer.`;
const bookedLimit = (side: Side, testerName: string) =>
  side === "developer" ? `${testerName} already has ${MAX_BOOKED} booked times with you. Wait until one is over or cancel one.` : `You already have ${MAX_BOOKED} booked times in this test.`;

/** Book one call at this time between the two, at the agreed rate. */
async function bookAt(contractId: string, startsAt: Date, minutes: number, rateCents: number | null, setId: string | null = null, byDeveloper = false, quiet = false) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true, tester: true } });
  const slot = await db.callSlot.create({ data: { testId: c.testId, startsAt, minutes, allowedTesterIds: [c.testerId], status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes, rateCents, setId } });
  if (!quiet) await db.$transaction((tx) => recordEvent(tx, c.testId, "booked", byDeveloper ? `You booked a call with ${displayName(c.tester)} for ${fmtDateTime(startsAt)}` : `${displayName(c.tester)} booked a call for ${fmtDateTime(startsAt)}`, false, {}, contractId));
  return call;
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
  if (r.status === "withdrawn") return mine ? "You already withdrew this request." : `${otherName} withdrew this request at ${fmtTime(r.updatedAt)}.`;
  if (r.status === "declined") return mine ? `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` : "You already declined this request.";
  if (r.status === "booked") return `This time was booked at ${fmtTime(r.updatedAt)}.`;
  if (!mine && r.fromSide === "developer") return `The call time ${fmtDateTime(r.startsAt)} is no longer available.`;
  return `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.`;
};

async function refusals(c: Ctx["c"], side: Side) {
  if (c.status !== "working") throw new HttpError(409, "closed", side === "tester" ? "Your session has ended." : `${displayName(c.tester)}'s session has ended.`);
  if (c.test.developer.holdStartedAt) throw new HttpError(409, "paused", side === "tester" ? PAUSED_FOR_TESTERS : "Pay what you owe first.");
  if (c.test.status !== "open") throw new HttpError(409, "closed", "This test isn't open.");
  if (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) throw new HttpError(409, "gone", "This time isn't available.");
}

// (Owner) Call REQUESTS (requested, withdrawn, declined, closed) are not bell lines: they show in Needs you, the Live session
// panel and the live top box. Booked and cancelled calls are bell lines (and stack there).

/** Developer: Request a time with one or more ticked working testers. */
export async function devRequestTime(dev: U, testId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.contractIds) ? body.contractIds.map(String) : body.contractId ? [String(body.contractId)] : [];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  const kind = readKind(body);
  const reqMinutes = readMinutes(body);
  const all: Ctx[] = [];
  for (const id of ids) {
    const x = await ctx(dev.id, id);
    if (x.side !== "developer" || x.c.testId !== testId) throw new HttpError(404, "not_found", "That tester isn't in this test.");
    await refusals(x.c, "developer");
    all.push(x);
  }
  await db.$transaction((tx) => devGate(tx, testId, body));
  // Auto-match ("choose one" only): a tester already requested one of these exact times at the contract rate.
  const onceStarts = kind.rows.filter((r) => r.repeat === "once").map((r) => r.startsAt);
  if (onceStarts.length) {
    for (const { c } of all) {
      const match = await db.callRequest.findFirst({ where: { contractId: c.id, status: "pending", fromSide: "tester", weeks: 0, minutes: reqMinutes, startsAt: { gt: new Date() } } });
      const hit = match && askMatches(match.askRateCents, c.liveRateCents) ? onceTimes(match).find((t) => onceStarts.some((x) => x.getTime() === t.getTime())) : undefined;
      if (match && hit) {
        const clash = await acceptClash(c, "developer", [hit], match.minutes);
        if (clash.length) throw new HttpError(409, "clash", clash[0]);
        if ((await bookedTimes(c.id)) >= MAX_BOOKED) throw new HttpError(409, "limit", bookedLimit("developer", displayName(c.tester)));
        const call = await bookAt(c.id, hit, match.minutes, c.liveRateCents, null, true);
        await db.callRequest.update({ where: { id: match.id }, data: { status: "booked", callId: call.id, decidedAt: new Date(), closedReason: "matched" } });
        const line = `Booked: you both picked ${fmtDateTime(hit)}`;
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
        return { booked: true, callId: call.id, message: line };
      }
    }
  }
  // Clashes and the 2-pending limit, per tester.
  const blocked: string[] = [], atLimit: string[] = [], ok: Ctx[] = [];
  for (const x of all) {
    const minutes = reqMinutes;
    const clash = await sendClash(x.c.id, requestTimes(kind), minutes, displayName(x.c.tester), undefined, all.length === 1 ? { side: "developer", otherPoss: pronouns(x.c.tester.pronoun).poss } : undefined);
    if (clash) blocked.push(clash);
    else if ((await pendingRequests(x.c.id)) >= MAX_REQUESTS) atLimit.push(displayName(x.c.tester));
    else ok.push(x);
  }
  if (all.length === 1 && blocked.length) throw new HttpError(409, "clash", blocked[0]);
  if (all.length === 1 && atLimit.length) throw new HttpError(409, "limit", requestLimitLine(atLimit[0]));
  if (!ok.length) throw new HttpError(409, "limit", [...blocked, ...atLimit.map(requestLimitLine)].join(" "));
  if (blocked.length || atLimit.length) {
    const text = [...blocked, ...(atLimit.length ? [`${atLimit.join(" and ")} already ${atLimit.length === 1 ? "has" : "have"} ${MAX_REQUESTS} requests waiting with you.`] : [])].join(" ");
    // (Owner, NEXT-UI 12b) The second press names what the box said (limitSeen); if who is blocked / at the limit changed
    // since, it stops again with the new line.
    if (body.confirmed !== true || body.limitSeen !== text) {
      throw new HttpError(409, "stop_once", "Press again to send to the others.", { changes: [{ text, at: new Date() }], tail: `Press again to send to the others (${ok.map((x) => displayName(x.c.tester)).join(", ")}).`, limit: true, limitSeen: text });
    }
  }
  const batchId = randomBytes(8).toString("hex");
  for (const { c } of ok) {
    const minutes = reqMinutes;
    await db.callRequest.create({ data: { testId, contractId: c.id, fromSide: "developer", startsAt: kind.startsAt, times: kind.times, weeks: kind.weeks, repeat: kind.repeat, rows: toJson(kind.rows) as Prisma.InputJsonValue, minutes, batchId } });
  }
  await db.$transaction((tx) => recordEvent(tx, testId, "requested", `You requested ${kindWords(kind.rows)} from ${fmtDateTime(kind.startsAt)} with ${ok.length} tester${ok.length === 1 ? "" : "s"}`, false));
  return { requested: ok.length, batchId };
}

/** Tester: Request a time (choose one or weekly) with an optional "Ask $___/h". A different ask never books. */
export async function testerRequestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const x = await ctx(user.id, contractId);
  const { c, side } = x;
  if (side !== "tester") throw new HttpError(404, "not_found", "That session doesn't exist.");
  await refusals(c, "tester");
  const kind = readKind(body);
  const ask = readAsk(body.ask);
  await testerGate(c.testerId, contractId, c.testId, body);
  const minutes = readMinutes(body);
  const devName = displayName(c.test.developer);
  // Auto-match ("choose one", rates match): a developer request with one of these exact times books it.
  const onceStarts = kind.rows.filter((r) => r.repeat === "once").map((r) => r.startsAt);
  if (onceStarts.length && askMatches(ask, c.liveRateCents)) {
    const devReqs = await db.callRequest.findMany({ where: { contractId, status: "pending", fromSide: "developer", weeks: 0, minutes } });
    for (const m of devReqs) {
      const hit = onceTimes(m).find((t) => onceStarts.some((k) => k.getTime() === t.getTime()));
      if (!hit) continue;
      const clash = await acceptClash(c, "tester", [hit], m.minutes);
      if (clash.length) throw new HttpError(409, "clash", clash[0]);
      if ((await bookedTimes(contractId)) >= MAX_BOOKED) throw new HttpError(409, "limit", bookedLimit("tester", displayName(c.tester)));
      const call = await bookAt(contractId, hit, m.minutes, c.liveRateCents);
      await db.callRequest.update({ where: { id: m.id }, data: { status: "booked", callId: call.id, decidedAt: new Date() } });
      await closeBatch(m.batchId, m.id);
      const line = `Booked: you both picked ${fmtDateTime(hit)}`;
      await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#calls`);
      return { booked: true, callId: call.id, message: line };
    }
  }
  // A different ask for a time the developer requested closes this tester's copy of that request (it isn't a clash).
  let closedCopy = "";
  if (!askMatches(ask, c.liveRateCents)) {
    const same = await db.callRequest.findMany({ where: { contractId, status: "pending", fromSide: "developer" } });
    for (const m of same) {
      if (requestTimes(m).some((t) => kind.times.some((k) => k.getTime() === t.getTime()))) {
        await db.callRequest.update({ where: { id: m.id }, data: { status: "closed", closedReason: "you asked a different rate", decidedAt: new Date() } });
        closedCopy = m.batchId;
      }
    }
  }
  const clash = await sendClash(contractId, requestTimes(kind), minutes, devName, undefined, { side: "tester", otherPoss: pronouns(c.test.developer.pronoun).poss });
  if (clash) throw new HttpError(409, "clash", clash);
  if ((await pendingRequests(contractId)) >= MAX_REQUESTS) throw new HttpError(409, "limit", requestLimitLine(devName));
  const r = await db.callRequest.create({
    data: { testId: c.testId, contractId, fromSide: "tester", startsAt: kind.startsAt, times: kind.times, weeks: kind.weeks, repeat: kind.repeat, rows: toJson(kind.rows) as Prisma.InputJsonValue, minutes, askRateCents: ask == null || ask === c.liveRateCents ? null : ask, batchId: closedCopy ? `ask-${closedCopy}` : "" },
  });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(c.tester)} requested ${kind.rows.length === 1 && kind.rows[0].repeat !== "once" ? `${kindWords(kind.rows)} from` : "a call for"} ${fmtDateTime(kind.startsAt)}${r.askRateCents != null ? ` and asks ${money(r.askRateCents)}/h` : ""}`, false, {}, contractId));
  return { requested: true, id: r.id };
}

/** Either side's Request a time (one contract). */
export async function requestTime(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side } = await ctx(user.id, contractId);
  return side === "developer" ? devRequestTime(user, c.testId, { ...body, contractIds: [contractId] }) : testerRequestTime(user, contractId, body);
}

/** Accept (the other side; "choose one": pick one time) / Decline / Withdraw (your own). */
export async function answerRequest(user: U, contractId: string, body: Record<string, unknown>) {
  const x = await ctx(user.id, contractId);
  const { c, side, other } = x;
  const r = await db.callRequest.findUnique({ where: { id: String(body.requestId ?? "") } });
  if (!r || r.contractId !== contractId) throw new HttpError(404, "not_found", "That request doesn't exist.");
  const action = String(body.action ?? "");
  const mine = r.fromSide === side;
  if (r.status === "pending" && r.startsAt < new Date()) await db.callRequest.update({ where: { id: r.id }, data: { status: "closed", closedReason: "its time passed" } });
  const fresh = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
  if (fresh.status !== "pending") throw new HttpError(409, "gone", refusalFor(fresh, displayName(other), mine));
  if (action === "withdraw" ? !mine : mine) throw new HttpError(409, "not_yours", mine ? "You can't answer your own request: withdraw it instead." : "Only the person who asked can withdraw it.");
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body));
  else await testerGate(c.testerId, contractId, c.testId, body);
  if (action === "accept") {
    await refusals(c, side);
    // A tester's Accept always books at the contract rate; the developer accepting a tester's priced request books at
    // the asked rate ("Agreed"). The rate is fixed at acceptance (every week of a weekly).
    const rate = side === "developer" && r.askRateCents != null ? r.askRateCents : c.liveRateCents;
    // The other side picks ONE row; a repeating row books its whole set (Forever: the next 4 ahead).
    const rowsR = rowsOf(r);
    let row: CallRow;
    if (rowsR.length === 1) row = rowsR[0];
    else {
      const pick = body.time ? new Date(String(body.time)) : null;
      const chosen = pick ? rowsR.find((x) => x.startsAt.getTime() === pick.getTime()) : undefined;
      if (!chosen) throw new HttpError(400, "pick", "Pick one of the times.");
      row = chosen;
    }
    const times = occurrences(row);
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
    if ((await bookedTimes(contractId)) >= MAX_BOOKED) throw new HttpError(409, "limit", bookedLimit(side, displayName(c.tester)));
    let first = null;
    // A repeating pick is one CallSet (it counts as 1 of the 3 booked times); Forever keeps the next 4 ahead.
    const set = row.repeat === "once" ? null : await db.callSet.create({ data: { testId: c.testId, contractId, repeat: row.repeat, count: row.count, minutes: r.minutes, rateCents: rate, nextAt: new Date(row.startsAt.getTime() + times.length * stepMs(row.repeat)) } });
    for (const t of times) {
      const call = await bookAt(contractId, t, r.minutes, rate, set?.id ?? null, side === "developer");
      first = first ?? call;
    }
    await db.callRequest.update({ where: { id: r.id }, data: { status: "booked", callId: first!.id, decidedAt: new Date() } });
    if (side === "tester") await closeBatch(r.batchId, r.id);
    else if (r.batchId.startsWith("ask-")) await closeBatch(r.batchId.slice(4), r.id); // the rest of the developer's batch
    const what = row.repeat === "once" ? fmtDateTime(times[0]) : row.count ? `${row.count} ${unitOf(row.repeat)} calls from ${fmtDateTime(times[0])}` : `${unitOf(row.repeat)} calls from ${fmtDateTime(times[0])} (until cancelled)`;
    await notify(other.email, `Booked: ${what}`, [`${displayName(user)} accepted the call request: ${what} (${rateLabel(rate, c.liveRateCents)}).`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
    return { booked: true, callId: first!.id, calls: times.length };
  }
  const status = action === "withdraw" ? "withdrawn" : "declined";
  await db.callRequest.update({ where: { id: r.id }, data: { status, decidedAt: new Date() } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, status === "withdrawn" ? "withdrew_req" : "declined_req", `${displayName(user)} ${status} a call request for ${fmtDateTime(r.startsAt)}`, false, {}, contractId));
  return { [status]: true };
}


// ---------- (NEXT-UI 7) Daily / weekly sets: cancel the rest, and Forever sets kept 4 ahead ----------

/**
 * CANCEL on a booked set's line: the only way to stop a repeating set. Cancels every call of it still ahead (a reason is
 * required if the next one is within 24 hours) and ends the set; the other side is told once.
 */
export async function cancelCallSet(user: U, contractId: string, body: Record<string, unknown>) {
  const { c, side, other } = await ctx(user.id, contractId);
  const setId = String(body.setId ?? "");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const now = new Date();
  const ahead = () => db.call.findMany({ where: { contractId, setId, status: "booked", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  const first = await ahead();
  if (!first.length) throw new HttpError(409, "cancelled", "The remaining calls of this set were already cancelled.");
  const ok = checkCancel(first[0].startsAt, now, reason);
  if (!ok.ok) throw new HttpError(400, "reason", ok.message);
  if (side === "developer") await db.$transaction((tx) => devGate(tx, c.testId, body));
  else await testerGate(c.testerId, contractId, c.testId, body);
  const calls = await ahead();
  if (!calls.length) throw new HttpError(409, "cancelled", "The remaining calls of this set were already cancelled.");
  const set = await db.callSet.findUnique({ where: { id: setId } });
  const unit = set ? unitOf(set.repeat) : calls.length > 1 && calls[1].startsAt.getTime() - calls[0].startsAt.getTime() < 2 * 86_400_000 ? "daily" : "weekly";
  await db.$transaction(async (tx) => {
    await tx.call.updateMany({ where: { id: { in: calls.map((x) => x.id) } }, data: { status: "cancelled", cancelledBy: side, cancelledAt: now, cancelNote: reason } });
    await tx.callSlot.updateMany({ where: { id: { in: calls.map((x) => x.slotId) } }, data: { status: "removed" } });
    if (set) await tx.callSet.update({ where: { id: set.id }, data: { status: "cancelled" } });
    await recordEvent(tx, c.testId, "cancelled", `${displayName(user)} cancelled the ${unit} calls from ${fmtDateTime(calls[0].startsAt)} (${calls.length} left)`, false, {}, contractId);
  });
  const line = `${displayName(user)} cancelled the remaining ${unit} calls (${calls.length}), starting ${fmtDateTime(calls[0].startsAt)}${reason ? `: ${reason}` : "."}`;
  await notify(other.email, line, [line], side === "developer" ? `/app/sessions/${contractId}` : `/app/tests/${c.testId}#calls`);
  return { cancelled: calls.length };
}

/**
 * The daily job's top-up: every active Forever set keeps its next 4 calls booked (each checked for clashes with either
 * side's other calls: a clashing one is skipped and both are told). A set ends when the tester's part ends (left, rated,
 * ended) or the test stops; a payment hold waits.
 */
export async function topUpForeverSets(now = new Date()) {
  const sets = await db.callSet.findMany({ where: { status: "active", count: 0 }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  let booked = 0, skipped = 0;
  for (const set of sets) {
    const c = set.contract;
    if (c.status !== "working" || c.test.status !== "open") {
      await db.callSet.update({ where: { id: set.id }, data: { status: "ended" } });
      continue;
    }
    if (c.test.developer.holdStartedAt) continue;
    let ahead = await db.call.count({ where: { setId: set.id, status: "booked", startsAt: { gt: now } } });
    let nextAt = set.nextAt;
    for (let guard = 0; ahead < FOREVER_AHEAD && guard < FOREVER_AHEAD * 2; guard++) {
      const at = nextAt;
      nextAt = new Date(at.getTime() + stepMs(set.repeat));
      if (at.getTime() <= now.getTime()) continue; // (an old occurrence: never booked back in time)
      const clash = await acceptClash(c, "developer", [at], set.minutes);
      if (clash.length) {
        skipped++;
        const line = `The ${unitOf(set.repeat)} call on ${fmtDateTime(at)} was skipped: ${displayName(c.tester)} or ${displayName(c.test.developer)} already has a call at that time.`;
        await notify(c.test.developer.email, line, [line], `/app/tests/${c.testId}#calls`);
        await notify(c.tester.email, line, [line], `/app/sessions/${c.id}`);
        continue;
      }
      await bookAt(c.id, at, set.minutes, set.rateCents, set.id, true, true);
      booked++;
      ahead++;
    }
    await db.callSet.update({ where: { id: set.id }, data: { nextAt } });
  }
  return { booked, skipped };
}
