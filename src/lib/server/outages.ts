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

/** (Batch 26 section 1) The AppState key holding when the 5-minute sweep last ran (the app's own heartbeat). */
export const SWEEP_LAST_KEY = "sweep-last";

/**
 * (Batch 26 section 1) The app's own heartbeat, checked by every sweep (and at server start): it stores this run's time, and when the previous run was 15 minutes or more
 * ago the gap is recorded as an outage (merged with one the up alert already recorded). Only with OUTAGE_CHECKS=1. Two runs at once: only the one that moved the stored
 * time on records the gap. Returns the outage recorded or merged, or null.
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
  return recordGap(last, now);
}

/**
 * (Batch 26 section 1) A downtime [start, end) from either source. Overlapping an outage already recorded: merged into it (the union): the row grows, the part not yet
 * applied moves the clocks (when the outage was applied), and its bell lines are reworded; already covered: nothing. Otherwise recorded when 15 minutes or more.
 */
export async function recordGap(start: Date, end: Date) {
  if (end.getTime() <= start.getTime()) return null;
  const over = await db.outage.findFirst({ where: { startAt: { lte: end }, endAt: { gte: start } }, orderBy: { startAt: "asc" } });
  if (!over) return end.getTime() - start.getTime() >= OUTAGE_MIN_MS ? recordOutage(start, end) : null;
  const s = new Date(Math.min(over.startAt.getTime(), start.getTime())), e = new Date(Math.max(over.endAt.getTime(), end.getTime()));
  if (s.getTime() === over.startAt.getTime() && e.getTime() === over.endAt.getTime()) return over; // the same downtime: recorded once
  const ms = e.getTime() - s.getTime();
  const applied = !over.needsApproval || !!over.approvedAt;
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
  return { downSince: down ? new Date(down.value) : null, rows };
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
