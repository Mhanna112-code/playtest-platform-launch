import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { linesFor, notify } from "./notify";
import { T, renderTimes } from "@/lib/tz";

// (Owner, Oct 22, NEWEST+6; batch 15 section 10) Outages come from the uptime service's own alerts (POST /api/health/alert?key=...): a "down" is stored and the
// matching "up" records the outage when it lasted 15 minutes or more. It is recorded once (unique start) and then every timer that was running moves later by its
// length; calls inside it are cancelled as "missed because the site was down" (never a no-show, no charge). Heartbeats from GET /api/health are information only.
// (Owner, Oct 29, batch 26 section 1) A real full stop must always be recorded, although the "down" alert can't reach a site that is down:
// - the "up" alert carries how long the monitor was down (UptimeRobot's *alertDuration*, in seconds): an up with no stored down records the outage from it (start = the
//   up's arrival minus the duration);
// - the app's own heartbeat is the backup: the 5-minute sweep stores when it last ran (SWEEP_LAST_KEY), and a gap of 15 minutes or more since then (found by the next
//   sweep, or at server start) is recorded as an outage for the gap;
// - never twice for the same downtime: an outage overlapping one already recorded is merged into it (the union; only the part not yet applied moves the clocks, and the
//   bell line sent for it is reworded to the merged times). The usual rules hold: 15 minutes or more, and over 24 hours waits for an admin's Approve.
// (Owner, Oct 29, batch 28 sections 1 and 2) The heartbeat never moves anything on its own: a paused monitor, a lapsed plan or a local server restarted after 15 minutes
// would otherwise move every timer. A heartbeat gap is only LISTED for the admins ("Possible outage: no checks from 3:10 PM to 3:42 PM (32 min). Nothing has moved."),
// with Approve (move every timer, any length) and Dismiss. Any server activity counts as a heartbeat (page loads, API calls, the daily job, the sweep: touchHeartbeat),
// so a gap means the server really answered nothing. An outage the uptime service reports is applied as before, with ITS span (never widened by a heartbeat gap); a
// gap it overlaps is closed as covered by it. Two reports that overlap merge, and an extension of an applied outage that brings it over 24 hours waits for Approve.

export const OUTAGE_MIN_MS = 15 * 60_000;
const HEARTBEAT_EVERY_MS = 60_000;

/** (GATED) Detection runs only with OUTAGE_CHECKS=1; only the outside checker's keyed ping writes heartbeats. */
export const outageChecksOn = () => process.env.OUTAGE_CHECKS === "1";
/** (Batch 15 section 41, M4) The key, compared in constant time. */
export function healthKeyOk(key: string | null) {
  const want = process.env.HEALTH_KEY ?? "";
  if (!want || !key) return false;
  const a = Buffer.from(key), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** The key from the request: the `x-health-key` header, or `?key=` in the URL. */
export const healthKeyOf = (req: Request) => req.headers.get("x-health-key") ?? new URL(req.url).searchParams.get("key");

export const lengthText = (ms: number) => {
  const m = Math.round(ms / 60_000), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
};
/**
 * "The site was down from 2:10 PM EST to 4:40 PM EST. Deadlines and payment dates moved 2 h 30 min later." (Batch 15 section 11) The times are tokens, written in each
 * reader's own time zone; pages render them in the viewer's (renderTimes).
 */
export const outageLine = (start: Date, end: Date, ms: number) =>
  `The site was down from ${start.toDateString() === end.toDateString() ? T(start, "time") : T(start, "datetime")} to ${T(end, "time")}. Deadlines and payment dates moved ${lengthText(ms)} later.`;

/**
 * (Batch 15 section 10) The outside checker's keyed ping writes a heartbeat, for information only (at most one a minute, unless `force`). Missing pings NEVER create an
 * outage any more: a paused monitor or an expired plan changes nothing. Outages come only from the uptime service's own down/up alerts (recordAlert).
 */
export async function heartbeat(now = new Date(), force = false) {
  if (!outageChecksOn()) return null; // without the setting nothing is written
  const last = await db.heartbeat.findFirst({ orderBy: { at: "desc" } });
  if (force || !last || now.getTime() - last.at.getTime() >= HEARTBEAT_EVERY_MS) await db.heartbeat.create({ data: { at: now } });
  return null;
}

/** The stored "down" alert (AppState): when the uptime service said the site went down, until the matching "up". */
export const DOWN_KEY = "outage-down";

/**
 * One UptimeRobot alert webhook, read from its JSON (or form) body and the URL's query: alertType 1 = down, 2 = up, the time the service says it sent it, and (batch 26
 * section 1) on an up alert how long the monitor was down: alertDuration, in seconds (UptimeRobot's *alertDuration*; a variable it didn't fill in reads as none).
 */
export function parseAlert(fields: Record<string, unknown>): { type: "down" | "up" | null; sentAt: Date | null; durationMs: number | null } {
  const v = (k: string) => (fields[k] ?? fields[k.toLowerCase()]) as string | number | undefined;
  const t = Number(v("alertType"));
  const secs = Number(v("alertDateTime") ?? v("alertTime"));
  const dur = Number(v("alertDuration"));
  return { type: t === 1 ? "down" : t === 2 ? "up" : null, sentAt: Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000) : null, durationMs: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) : null };
}
/** (Batch 15 section 41, M4) An alert whose own time is more than 10 minutes from the server's clock is refused (a replayed or forged one). */
export const ALERT_SKEW_MS = 10 * 60_000;
export const alertRefusal = (a: ReturnType<typeof parseAlert>, now = new Date()) =>
  a.sentAt && Math.abs(a.sentAt.getTime() - now.getTime()) > ALERT_SKEW_MS ? "That alert's time is more than 10 minutes from the server's clock, so it was ignored." : "";
/** (Batch 15 section 41, M4) An outage longer than this is recorded but moves nothing until an admin approves it. */
export const OUTAGE_APPROVE_OVER_MS = 24 * 3_600_000;

/**
 * (Batch 15 sections 10 and 41) An alert from the uptime service, on the SERVER's clock: a "down" stores when it arrived; the matching "up" records an outage from then to
 * now when it lasted 15 minutes or more (recordOutage moves every running timer and cancels calls inside it); a shorter one only clears the stored down.
 * (Batch 26 section 1) An "up" with no stored down (the down alert was lost: the site was down) records the outage from the up's own duration, `durationMs`. Either way
 * an outage the heartbeat already recorded for the same downtime is merged, never recorded twice (recordGap).
 */
export async function recordAlert(type: "down" | "up" | null, now = new Date(), durationMs: number | null = null) {
  if (type === "down") {
    // The first down counts (a repeated down alert keeps the earlier start).
    await db.appState.upsert({ where: { key: DOWN_KEY }, create: { key: DOWN_KEY, value: now.toISOString() }, update: {} });
    return null;
  }
  if (type !== "up") return null;
  const stored = await db.appState.findUnique({ where: { key: DOWN_KEY } });
  await db.appState.deleteMany({ where: { key: DOWN_KEY } });
  const downAt = stored ? new Date(stored.value) : null;
  const start = downAt && !isNaN(downAt.getTime()) ? downAt : durationMs ? new Date(now.getTime() - durationMs) : null;
  if (!start) return null;
  return recordGap(start, now);
}

/** (Batch 26 section 1) The AppState key holding when the 5-minute sweep last ran (the app's own heartbeat; batch 28 §1: any server activity). */
export const SWEEP_LAST_KEY = "sweep-last";
/** (Batch 28 §1) A heartbeat gap waiting for the admins: AppState `gap:<start ISO>` holding its end (ISO). */
export const GAP_PREFIX = "gap:";
export type Gap = { id: string; startAt: Date; endAt: Date; ms: number };
const gapOf = (row: { key: string; value: string }): Gap | null => {
  const s = new Date(row.key.slice(GAP_PREFIX.length)), e = new Date(row.value);
  return isNaN(s.getTime()) || isNaN(e.getTime()) ? null : { id: row.key, startAt: s, endAt: e, ms: e.getTime() - s.getTime() };
};
/** The heartbeat gaps waiting for the admins, oldest first. */
export async function pendingGaps() {
  const rows = await db.appState.findMany({ where: { key: { startsWith: GAP_PREFIX } } });
  return rows.map(gapOf).filter((g): g is Gap => !!g).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
/** "Possible outage: no checks from 3:10 PM to 3:42 PM (32 min). Nothing has moved." (time tokens: the reader's zone) */
export const gapLine = (g: { startAt: Date; endAt: Date; ms: number }) =>
  `Possible outage: no checks from ${g.startAt.toDateString() === g.endAt.toDateString() ? T(g.startAt, "time") : T(g.startAt, "datetime")} to ${T(g.endAt, "time")} (${lengthText(g.ms)}). Nothing has moved.`;

/**
 * (Batch 28 §1) A heartbeat gap [start, end): never applied. Covered by an outage the uptime service reported: nothing. Otherwise listed for the admins (merged with a
 * listed gap it overlaps). Returns the gap listed, or null.
 */
export async function noteGap(start: Date, end: Date): Promise<Gap | null> {
  if (end.getTime() - start.getTime() < OUTAGE_MIN_MS) return null;
  if (await db.outage.findFirst({ where: { startAt: { lte: end }, endAt: { gte: start } } })) return null; // covered by a reported outage
  let s = start, e = end;
  for (const g of await pendingGaps()) {
    if (g.startAt > e || g.endAt < s) continue;
    s = new Date(Math.min(s.getTime(), g.startAt.getTime()));
    e = new Date(Math.max(e.getTime(), g.endAt.getTime()));
    await db.appState.deleteMany({ where: { key: g.id } });
  }
  const key = `${GAP_PREFIX}${s.toISOString()}`;
  await db.appState.upsert({ where: { key }, create: { key, value: e.toISOString() }, update: { value: e.toISOString() } });
  return { id: key, startAt: s, endAt: e, ms: e.getTime() - s.getTime() };
}

/** (Batch 28 §1) An admin approves a listed gap: it becomes an outage and every timer moves by it (whatever its length: the admin decided). Once. */
export async function approveGap(adminId: string, id: string) {
  const row = id.startsWith(GAP_PREFIX) ? await db.appState.findUnique({ where: { key: id } }) : null;
  const g = row ? gapOf(row) : null;
  const HttpError = (await import("./http")).HttpError;
  if (!g || (await db.appState.deleteMany({ where: { key: id, value: row!.value } })).count !== 1) throw new HttpError(409, "done", "That possible outage was already approved or dismissed.");
  const long = g.ms > OUTAGE_APPROVE_OVER_MS;
  let o;
  try {
    o = await db.outage.create({ data: { startAt: g.startAt, endAt: g.endAt, ms: g.ms, needsApproval: long, ...(long ? { approvedAt: new Date(), approvedById: adminId } : {}) } });
  } catch {
    throw new HttpError(409, "done", "An outage is already recorded from that time.");
  }
  await applyOutage(o);
  return { ok: true };
}

/** (Batch 28 §1) An admin dismisses a listed gap: nothing moves, and it leaves the list. */
export async function dismissGap(id: string) {
  if (!id.startsWith(GAP_PREFIX) || (await db.appState.deleteMany({ where: { key: id } })).count !== 1) throw new (await import("./http")).HttpError(409, "done", "That possible outage was already approved or dismissed.");
  return { ok: true };
}

/** (Batch 28 §1) Any server activity is a heartbeat: checked at most once a minute per server process (the sweep checks every run). */
let lastTouch = 0;
export function touchHeartbeat(now = Date.now(), force = false) {
  // (Tests drive the heartbeat themselves: their own API calls don't touch it unless forced.)
  if (!outageChecksOn() || (!force && (process.env.VITEST === "true" || now - lastTouch < HEARTBEAT_EVERY_MS))) return null;
  lastTouch = now;
  return sweepGap(new Date(now)).catch((e) => (console.error("[outage] heartbeat:", (e as Error).message), null));
}

/**
 * (Batch 26 section 1) The app's own heartbeat, checked by every sweep (and at server start; batch 28 §1: any server activity): it stores this time, and when the
 * previous one was 15 minutes or more ago the gap is listed for the admins (noteGap: batch 28 §1, never applied on its own). Only with OUTAGE_CHECKS=1. Two at once:
 * only the one that moved the stored time on notes the gap. Returns the gap listed, or null.
 */
export async function sweepGap(now = new Date()) {
  if (!outageChecksOn()) return null;
  const row = await db.appState.findUnique({ where: { key: SWEEP_LAST_KEY } });
  if (!row) {
    await db.appState.create({ data: { key: SWEEP_LAST_KEY, value: now.toISOString() } }).catch(() => null);
    return null;
  }
  const last = new Date(row.value);
  if (!isNaN(last.getTime()) && now.getTime() <= last.getTime()) return null;
  const moved = await db.appState.updateMany({ where: { key: SWEEP_LAST_KEY, value: row.value }, data: { value: now.toISOString() } });
  if (moved.count !== 1 || isNaN(last.getTime())) return null;
  return noteGap(last, now);
}

/**
 * An outage the uptime service reported, [start, end). (Batch 28 §1) Heartbeat gaps it overlaps are closed as covered by it; its own span is applied (batch 28 §2:
 * never widened by a gap). Overlapping an outage already recorded (another report): merged into it (the union): the part not yet applied moves the clocks (when the
 * outage was applied) and its bell lines are reworded, except (batch 28 §2) an extension that brings an applied outage over 24 hours: that part waits for Approve as
 * its own row. Already covered: nothing. Otherwise recorded when 15 minutes or more.
 */
export async function recordGap(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) return null;
  for (const g of await pendingGaps()) if (g.startAt <= end && g.endAt >= start) await db.appState.deleteMany({ where: { key: g.id } });
  const over = await db.outage.findFirst({ where: { startAt: { lte: end }, endAt: { gte: start } }, orderBy: { startAt: "asc" } });
  if (!over) return end.getTime() - start.getTime() >= OUTAGE_MIN_MS ? recordOutage(start, end) : null;
  const s = new Date(Math.min(over.startAt.getTime(), start.getTime())), e = new Date(Math.max(over.endAt.getTime(), end.getTime()));
  if (s.getTime() === over.startAt.getTime() && e.getTime() === over.endAt.getTime()) return over; // the same downtime: recorded once
  const ms = e.getTime() - s.getTime();
  const applied = !over.needsApproval || !!over.approvedAt;
  if (applied && ms > OUTAGE_APPROVE_OVER_MS) {
    // (Batch 28 §2) The new parts wait for an admin's Approve, each as its own row; the applied outage stays as it was.
    if (s < over.startAt) await db.outage.create({ data: { startAt: s, endAt: over.startAt, ms: over.startAt.getTime() - s.getTime(), needsApproval: true } }).catch(() => null);
    if (e > over.endAt) await db.outage.create({ data: { startAt: over.endAt, endAt: e, ms: e.getTime() - over.endAt.getTime(), needsApproval: true } }).catch(() => null);
    return db.outage.findUnique({ where: { id: over.id } });
  }
  let claimed;
  try {
    claimed = await db.outage.updateMany({ where: { id: over.id, startAt: over.startAt, endAt: over.endAt }, data: { startAt: s, endAt: e, ms, ...(applied ? {} : { needsApproval: ms > OUTAGE_APPROVE_OVER_MS }) } });
  } catch {
    return null; // another outage starts exactly there
  }
  if (claimed.count !== 1) return null; // merged meanwhile by another request
  if (applied) {
    // Only the new parts move the clocks (the rest already did), with no second bell: the one sent is reworded to the merged times.
    if (s < over.startAt) await applyOutage({ startAt: s, endAt: over.startAt, ms: over.startAt.getTime() - s.getTime() }, { quiet: true });
    if (e > over.endAt) await applyOutage({ startAt: over.endAt, endAt: e, ms: e.getTime() - over.endAt.getTime() }, { quiet: true });
    await rewordBells(over, { startAt: s, endAt: e, ms });
  }
  return db.outage.findUnique({ where: { id: over.id } });
}

/** (Batch 26 section 1) The bell line each person got for an outage, reworded to its merged times (each in their own zone). */
async function rewordBells(was: { startAt: Date; endAt: Date; ms: number; recordedAt: Date }, now: { startAt: Date; endAt: Date; ms: number }) {
  const old = outageLine(was.startAt, was.endAt, was.ms), next = outageLine(now.startAt, now.endAt, now.ms);
  const rows = await db.notification.findMany({ where: { createdAt: { gte: new Date(was.recordedAt.getTime() - 60_000) }, text: { startsWith: "The site was down from " } }, select: { id: true, userId: true, text: true, user: { select: { timeZone: true } } } });
  for (const r of rows) if (r.text === renderTimes(old, r.user.timeZone)) await db.notification.update({ where: { id: r.id }, data: { text: renderTimes(next, r.user.timeZone) } });
}

/** The admin dashboard: the stored down (if the site is down right now by the uptime service's account) and the latest outages. */
export async function adminOutages() {
  const down = await db.appState.findUnique({ where: { key: DOWN_KEY } });
  const rows = await db.outage.findMany({ orderBy: { startAt: "desc" }, take: 10 });
  // (Batch 28 §1) Heartbeat gaps waiting for Approve or Dismiss.
  return { downSince: down ? new Date(down.value) : null, rows, gaps: await pendingGaps() };
}

/**
 * Record [start, end) once and move every running timer by its length. (Batch 15 section 41, M4) Longer than 24 hours: recorded as needing an admin's approval, and
 * nothing moves until an admin approves it (approveOutage).
 */
export async function recordOutage(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  let o;
  try {
    o = await db.outage.create({ data: { startAt: start, endAt: end, ms, needsApproval: ms > OUTAGE_APPROVE_OVER_MS } });
  } catch {
    return null; // already recorded (another request got there first)
  }
  if (o.needsApproval) return o;
  await applyOutage(o);
  return o;
}

/** (Batch 15 section 41, M4) An admin approves a long outage: then every timer moves by it, as for any other outage. */
export async function approveOutage(adminId: string, outageId: string) {
  const claimed = await db.outage.updateMany({ where: { id: outageId, needsApproval: true, approvedAt: null }, data: { approvedAt: new Date(), approvedById: adminId } });
  if (claimed.count !== 1) throw new (await import("./http")).HttpError(409, "done", "That outage was already approved, or doesn't need it.");
  const o = await db.outage.findUniqueOrThrow({ where: { id: outageId } });
  await applyOutage(o);
  return { ok: true };
}

async function applyOutage(o: { startAt: Date; endAt: Date; ms: number }, opts: { /** (batch 26) a merged outage's extra part: no second bell */ quiet?: boolean } = {}) {
  const start = o.startAt, end = o.endAt, ms = o.ms;
  const L = ms;
  await db.$transaction(async (tx) => {
    // Review clocks / Charge points and their reminders.
    await tx.$executeRaw`UPDATE "Submission" s SET "payBy" = "payBy" + ${L} * interval '1 millisecond' WHERE "payBy" > (${start}::timestamptz AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."submissionId" = s.id)`;
    await tx.$executeRaw`UPDATE "Submission" SET "choiceBy" = "choiceBy" + ${L} * interval '1 millisecond' WHERE "choiceBy" > (${start}::timestamptz AT TIME ZONE 'UTC')`;
    await tx.$executeRaw`UPDATE "Submission" SET "remindedAt" = "remindedAt" + ${L} * interval '1 millisecond' WHERE "remindedAt" IS NOT NULL`;
    await tx.$executeRaw`UPDATE "Submission" SET "devRemindedAt" = "devRemindedAt" + ${L} * interval '1 millisecond' WHERE "devRemindedAt" IS NOT NULL`;
    // (Batch 28 §21) A call's review date (when a listed call is charged automatically) moves too.
    await tx.$executeRaw`UPDATE "Call" c SET "payBy" = "payBy" + ${L} * interval '1 millisecond' WHERE "payBy" > (${start}::timestamptz AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."callId" = c.id)`;
    // Pay-by dates (3-day cut-off, which starts a hold) and daily retries.
    await tx.$executeRaw`UPDATE "Payment" SET "owedUntil" = "owedUntil" + ${L} * interval '1 millisecond' WHERE status = 'failed' AND "settledAt" IS NULL AND "owedUntil" > (${start}::timestamptz AT TIME ZONE 'UTC')`;
    await tx.$executeRaw`UPDATE "Payment" SET "retriedAt" = "retriedAt" + ${L} * interval '1 millisecond' WHERE status = 'failed' AND "settledAt" IS NULL AND "retriedAt" IS NOT NULL`;
    // A hold's 30-day clock.
    await tx.$executeRaw`UPDATE "User" SET "holdStartedAt" = "holdStartedAt" + ${L} * interval '1 millisecond' WHERE "holdStartedAt" IS NOT NULL`;
    // Tester deadlines and Open until.
    await tx.$executeRaw`UPDATE "Contract" SET "dueAt" = "dueAt" + ${L} * interval '1 millisecond' WHERE status = 'working' AND "dueAt" > (${start}::timestamptz AT TIME ZONE 'UTC')`;
    await tx.$executeRaw`UPDATE "Test" SET "openUntil" = "openUntil" + ${L} * interval '1 millisecond' WHERE "openUntil" > (${start}::timestamptz AT TIME ZONE 'UTC')`;
    // Rating windows (14 days from the tester's rating).
    await tx.$executeRaw`UPDATE "Rating" SET "createdAt" = "createdAt" + ${L} * interval '1 millisecond' WHERE side = 'tester' AND "revealedAt" IS NULL AND "createdAt" + interval '14 days' > (${start}::timestamptz AT TIME ZONE 'UTC')`;
    // Invite reminders.
    await tx.$executeRaw`UPDATE "Invite" SET "remindedAt" = COALESCE("remindedAt", "createdAt") + ${L} * interval '1 millisecond' WHERE status = 'sent'`;
    // Call requests whose time fell inside the outage stay open (moved later).
    await tx.$executeRaw`UPDATE "CallRequest" SET "startsAt" = "startsAt" + ${L} * interval '1 millisecond', times = ARRAY(SELECT t + ${L} * interval '1 millisecond' FROM unnest(times) t) WHERE status = 'pending' AND "startsAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND "startsAt" < (${end}::timestamptz AT TIME ZONE 'UTC')`;
  });
  // Calls inside the outage: missed because the site was down (never a no-show, no charge); both told.
  const calls = await db.call.findMany({ where: { status: "booked", startsAt: { gte: start, lt: end } }, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } });
  for (const c of calls) {
    await db.call.update({ where: { id: c.id }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "missed because the site was down" } });
    const line = `Your call on ${T(c.startsAt)} was missed because the site was down. Nothing is charged; you can request a new time.`;
    await notify(c.contract.tester.email, line, [line], `/app/sessions/${c.contractId}#call-${c.id}`);
    await notify(c.contract.test.developer.email, line.replace("Your call", `Your call with ${displayName(c.contract.tester)}`), [line], `/app/tests/${c.contract.testId}#call-${c.id}`);
  }
  // One bell for everyone with something running.
  if (opts.quiet) return;
  const line = outageLine(start, end, ms);
  const testers = await db.contract.findMany({ where: { status: "working" }, select: { testerId: true }, distinct: ["testerId"] });
  const devs = await db.test.findMany({ where: { status: "open" }, select: { developerId: true }, distinct: ["developerId"] });
  const ids = [...new Set([...testers.map((x) => x.testerId), ...devs.map((x) => x.developerId)])];
  const each = await linesFor(ids, line);
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, text: each.get(userId)!, link: "/app" })) });
}

/** The top-box lines: outages recorded since the page loaded. */
export async function outageLines(since: Date) {
  const rows = await db.outage.findMany({ where: { recordedAt: { gt: since }, OR: [{ needsApproval: false }, { approvedAt: { not: null } }] }, orderBy: { recordedAt: "asc" } });
  return rows.map((o) => ({ text: outageLine(o.startAt, o.endAt, o.ms), at: o.recordedAt }));
}
