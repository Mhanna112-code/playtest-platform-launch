import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { notify } from "./notify";

// (Owner, Oct 22, NEWEST+6) Outages, detected automatically (no admin entry). GET /api/health (an outside uptime
// checker every 5 min), page polls and the daily job write heartbeats; a gap of more than 15 minutes between the last
// heartbeat and now is an outage. It is recorded once (unique start) and then every timer that was running moves later
// by its length; calls inside it are cancelled as "missed because the site was down" (never a no-show, no charge).

export const OUTAGE_MIN_MS = 15 * 60_000;
const HEARTBEAT_EVERY_MS = 60_000;

/** (GATED) Detection runs only with OUTAGE_CHECKS=1; only the outside checker's keyed ping writes heartbeats. */
export const outageChecksOn = () => process.env.OUTAGE_CHECKS === "1";
export const healthKeyOk = (key: string | null) => !!process.env.HEALTH_KEY && key === process.env.HEALTH_KEY;

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const lengthText = (ms: number) => {
  const m = Math.round(ms / 60_000), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
};
/** "The site was down from 2:10 to 4:40 PM. Deadlines and payment dates moved 2 h 30 min later." */
export const outageLine = (start: Date, end: Date, ms: number) => {
  const a = clock(start), b = clock(end);
  const sameHalf = a.slice(-2) === b.slice(-2) && start.toDateString() === end.toDateString();
  return `The site was down from ${sameHalf ? a.slice(0, -3) : a} to ${b}. Deadlines and payment dates moved ${lengthText(ms)} later.`;
};

/**
 * The app answered: check the gap since the last heartbeat (an outage if over 15 minutes), then write a heartbeat
 * (at most one a minute, unless `force`, e.g. /api/health). Returns the outage it recorded, if any.
 */
export async function heartbeat(now = new Date(), force = false) {
  if (!outageChecksOn()) return null; // without the setting nothing is written or detected
  const last = await db.heartbeat.findFirst({ orderBy: { at: "desc" } });
  let outage = null;
  if (last && now.getTime() - last.at.getTime() > OUTAGE_MIN_MS) outage = await recordOutage(last.at, now);
  if (force || !last || now.getTime() - last.at.getTime() >= HEARTBEAT_EVERY_MS) await db.heartbeat.create({ data: { at: now } });
  return outage;
}

/** Record [start, end) once and move every running timer by its length. */
export async function recordOutage(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  let o;
  try {
    o = await db.outage.create({ data: { startAt: start, endAt: end, ms } });
  } catch {
    return null; // already recorded (another request got there first)
  }
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
    const line = `Your call on ${fmtDateTime(c.startsAt)} was missed because the site was down. Nothing is charged; you can request a new time.`;
    await notify(c.contract.tester.email, line, [line], `/app/sessions/${c.contractId}#call-${c.id}`);
    await notify(c.contract.test.developer.email, line.replace("Your call", `Your call with ${displayName(c.contract.tester)}`), [line], `/app/tests/${c.contract.testId}#call-${c.id}`);
  }
  // One bell for everyone with something running.
  const line = outageLine(start, end, ms);
  const testers = await db.contract.findMany({ where: { status: "working" }, select: { testerId: true }, distinct: ["testerId"] });
  const devs = await db.test.findMany({ where: { status: "open" }, select: { developerId: true }, distinct: ["developerId"] });
  const ids = [...new Set([...testers.map((x) => x.testerId), ...devs.map((x) => x.developerId)])];
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, text: line, link: "/app" })) });
  return o;
}

/** The top-box lines: outages recorded since the page loaded. */
export async function outageLines(since: Date) {
  const rows = await db.outage.findMany({ where: { recordedAt: { gt: since } }, orderBy: { recordedAt: "asc" } });
  return rows.map((o) => ({ text: outageLine(o.startAt, o.endAt, o.ms), at: o.recordedAt }));
}
