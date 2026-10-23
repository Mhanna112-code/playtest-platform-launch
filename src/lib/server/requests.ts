import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime, money, pronouns, toCents } from "@/lib/format";
import { checkCallMinutes } from "@/lib/rules";
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

/** The times a request covers: its options ("choose one") or every week ("weekly"). */
export const requestTimes = (r: { times: Date[]; startsAt: Date; weeks: number; repeat?: string }) =>
  r.weeks > 0 ? Array.from({ length: r.weeks }, (_, k) => new Date(r.startsAt.getTime() + k * (r.repeat === "daily" ? 1 : 7) * DAY_MS)) : r.times.length ? r.times : [r.startsAt];
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

function readKind(body: Record<string, unknown>) {
  const weeks = Number(body.weeks ?? body.count ?? 0) || 0;
  const repeat = weeks ? (body.repeat === "daily" ? "daily" : "weekly") : "";
  const raw = Array.isArray(body.times) ? body.times : body.startsAt ? [body.startsAt] : [];
  const times = raw.map((x) => new Date(String(x))).filter((d) => !isNaN(d.getTime()));
  if (!times.length) throw new HttpError(400, "bad_time", "Pick a time in the future.");
  if (times.some((d) => d.getTime() < Date.now() + 5 * 60_000)) throw new HttpError(400, "bad_time", "Pick times in the future.");
  if (weeks) {
    if (times.length !== 1) throw new HttpError(400, "bad_kind", `A ${repeat} request has exactly one time.`);
    if (weeks < 2 || weeks > 8) throw new HttpError(400, "bad_weeks", `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.`);
  } else if (times.length > 3) throw new HttpError(400, "bad_kind", "Offer up to 3 times to choose from.");
  times.sort((a, b) => a.getTime() - b.getTime());
  return { weeks, repeat, times, startsAt: times[0] };
}

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
async function bookAt(contractId: string, startsAt: Date, minutes: number, rateCents: number | null, setId: string | null = null, byDeveloper = false) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: true, tester: true } });
  const slot = await db.callSlot.create({ data: { testId: c.testId, startsAt, minutes, allowedTesterIds: [c.testerId], status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes, rateCents, setId } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "booked", byDeveloper ? `You booked a call with ${displayName(c.tester)} for ${fmtDateTime(startsAt)}` : `${displayName(c.tester)} booked a call for ${fmtDateTime(startsAt)}`, false, {}, contractId));
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

const bellFor = (name: string, k: { weeks: number; times: Date[]; repeat?: string }) =>
  k.weeks ? `${name} asked for ${k.repeat === "daily" ? "daily" : "weekly"} calls: ${k.times[0].toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}, ${k.weeks} ${k.repeat === "daily" ? "days" : "weeks"}`
  : k.times.length > 1 ? `${name} asked for a call: pick one of ${k.times.length} times`
  : `${name} asked for a call: ${fmtDateTime(k.times[0])}`;

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
  if (!kind.weeks) {
    for (const { c } of all) {
      const match = await db.callRequest.findFirst({ where: { contractId: c.id, status: "pending", fromSide: "tester", weeks: 0, minutes: reqMinutes, startsAt: { gt: new Date() } } });
      const hit = match && askMatches(match.askRateCents, c.liveRateCents) ? requestTimes(match).find((t) => kind.times.some((x) => x.getTime() === t.getTime())) : undefined;
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
  if ((blocked.length || atLimit.length) && body.limitConfirmed !== true && body.confirmed !== true) {
    const text = [...blocked, ...(atLimit.length ? [`${atLimit.join(" and ")} already ${atLimit.length === 1 ? "has" : "have"} ${MAX_REQUESTS} requests waiting with you.`] : [])].join(" ");
    throw new HttpError(409, "stop_once", "Press again to send to the others.", { changes: [{ text, at: new Date() }], tail: `Press again to send to the others (${ok.map((x) => displayName(x.c.tester)).join(", ")}).`, limit: true });
  }
  const batchId = randomBytes(8).toString("hex");
  for (const { c } of ok) {
    const minutes = reqMinutes;
    await db.callRequest.create({ data: { testId, contractId: c.id, fromSide: "developer", startsAt: kind.startsAt, times: kind.weeks ? [kind.startsAt] : kind.times, weeks: kind.weeks, repeat: kind.repeat, minutes, batchId } });
    const line = bellFor(displayName(dev), kind);
    await notify(c.tester.email, line, [line, `Rate: ${rateLabel(c.liveRateCents, c.liveRateCents)}. Accept or decline it on your session page.`], `/app/sessions/${c.id}`);
  }
  await db.$transaction((tx) => recordEvent(tx, testId, "requested", `You requested ${kind.weeks ? `weekly calls (${kind.weeks} weeks)` : "a call"} from ${fmtDateTime(kind.startsAt)} with ${ok.length} tester${ok.length === 1 ? "" : "s"}`, false));
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
  if (!kind.weeks && askMatches(ask, c.liveRateCents)) {
    const devReqs = await db.callRequest.findMany({ where: { contractId, status: "pending", fromSide: "developer", weeks: 0, minutes } });
    for (const m of devReqs) {
      const hit = requestTimes(m).find((t) => kind.times.some((k) => k.getTime() === t.getTime()));
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
    data: { testId: c.testId, contractId, fromSide: "tester", startsAt: kind.startsAt, times: kind.weeks ? [kind.startsAt] : kind.times, weeks: kind.weeks, repeat: kind.repeat, minutes, askRateCents: ask == null || ask === c.liveRateCents ? null : ask, batchId: closedCopy ? `ask-${closedCopy}` : "" },
  });
  await db.$transaction((tx) => recordEvent(tx, c.testId, "requested", `${displayName(c.tester)} requested ${kind.weeks ? `weekly calls (${kind.weeks} weeks) from` : "a call for"} ${fmtDateTime(kind.startsAt)}${r.askRateCents != null ? ` and asks ${money(r.askRateCents)}/h` : ""}`, false, {}, contractId));
  const line = bellFor(displayName(c.tester), kind);
  await notify(c.test.developer.email, line, [r.askRateCents != null ? `They ask ${money(r.askRateCents)}/h.` : `At their contract rate (${rateLabel(c.liveRateCents, c.liveRateCents)}).`, "Accept or decline it on the test page."], `/app/tests/${c.testId}#calls`);
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
    let times: Date[];
    if (r.weeks) times = requestTimes(r);
    else {
      const opts = requestTimes(r);
      const pick = body.time ? new Date(String(body.time)) : opts.length === 1 ? opts[0] : null;
      const chosen = pick ? opts.find((t) => t.getTime() === pick.getTime()) : undefined;
      if (!chosen) throw new HttpError(400, "pick", "Pick one of the times.");
      times = [chosen];
    }
    if (r.weeks) {
      // Weekly: every week is checked; any clash refuses the whole request and names the week(s).
      const bad: string[] = [];
      for (const [i, t] of times.entries()) {
        const cl = await acceptClash(c, side, [t], r.minutes);
        if (cl.length) bad.push(`week ${i + 1} (${fmtDateTime(t)}): ${cl[0]}`);
      }
      if (bad.length) throw new HttpError(409, "clash", `These weeks clash: ${bad.join(" ")}`);
    } else {
      const clashes = await acceptClash(c, side, times, r.minutes);
      if (clashes.length) throw new HttpError(409, "clash", clashes[0]);
    }
    if ((await bookedTimes(contractId)) >= MAX_BOOKED) throw new HttpError(409, "limit", bookedLimit(side, displayName(c.tester)));
    let first = null;
    for (const t of times) {
      const call = await bookAt(contractId, t, r.minutes, rate, r.weeks ? r.id : null, side === "developer");
      first = first ?? call;
    }
    await db.callRequest.update({ where: { id: r.id }, data: { status: "booked", callId: first!.id, decidedAt: new Date() } });
    if (side === "tester") await closeBatch(r.batchId, r.id);
    else if (r.batchId.startsWith("ask-")) await closeBatch(r.batchId.slice(4), r.id); // the rest of the developer's batch
    const what = r.weeks ? `${r.weeks} ${r.repeat === "daily" ? "daily" : "weekly"} calls from ${fmtDateTime(times[0])}` : fmtDateTime(times[0]);
    await notify(other.email, `Booked: ${what}`, [`${displayName(user)} accepted the call request: ${what} (${rateLabel(rate, c.liveRateCents)}).`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
    return { booked: true, callId: first!.id, calls: times.length };
  }
  const status = action === "withdraw" ? "withdrawn" : "declined";
  await db.callRequest.update({ where: { id: r.id }, data: { status, decidedAt: new Date() } });
  await db.$transaction((tx) => recordEvent(tx, c.testId, status === "withdrawn" ? "withdrew_req" : "declined_req", `${displayName(user)} ${status} a call request for ${fmtDateTime(r.startsAt)}`, false, {}, contractId));
  if (status === "declined") await notify(other.email, `${displayName(user)} declined your call request`, [`${displayName(user)} declined your request for ${fmtDateTime(r.startsAt)}.`], side === "tester" ? `/app/tests/${c.testId}#calls` : `/app/sessions/${c.id}`);
  return { [status]: true };
}
