import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

// (Owner, Oct 28, batch 19 section 4) Timed jobs every 5 minutes, using the uptime check. Vercel's free plan runs crons only daily, so the uptime service's keyed
// GET /api/health (UptimeRobot, every 5 minutes) also runs the time-sensitive sweep (holds.ts runSweep): call reminders, call ends and nobody-joined, Charge opening,
// close-out and the reminders that are due. The daily cron keeps the daily jobs and runs the sweep too. Never two at once: one lock (an AppState row) for both.

export const TIMERS_LOCK_KEY = "timers-lock";
/** A lock older than this was left by a run that died (a function timeout): the next run takes it over. */
export const TIMERS_LOCK_STALE_MS = 4 * 60_000;
/** The health check answers at once; with no after-response hook (tests, a plain server) it waits at most this long for the sweep. */
export const SWEEP_BUDGET_MS = 8_000;

const stamp = () => `${Date.now()}:${randomUUID()}`;
const stampAge = (value: string) => Date.now() - Number(value.split(":")[0] || 0);

/** Take the lock: true when this run holds it (a fresh row, or a stale one taken over). Wall-clock time, never a test's `now`. */
async function takeLock(value: string) {
  try {
    await db.appState.create({ data: { key: TIMERS_LOCK_KEY, value } });
    return true;
  } catch {
    const row = await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } });
    if (!row) return takeLockOnce(value);
    if (stampAge(row.value) < TIMERS_LOCK_STALE_MS) return false;
    return (await db.appState.updateMany({ where: { key: TIMERS_LOCK_KEY, value: row.value }, data: { value } })).count === 1;
  }
}
async function takeLockOnce(value: string) {
  try {
    await db.appState.create({ data: { key: TIMERS_LOCK_KEY, value } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `job` holding the timers lock; null (and nothing run) when another run holds it. `waitMs`: wait up to that long for the other run to finish first (the daily
 * job waits for a running sweep; a sweep never waits: the next one comes in 5 minutes).
 */
export async function withTimersLock<T>(job: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T | null> {
  const value = stamp();
  const until = Date.now() + (opts.waitMs ?? 0);
  while (!(await takeLock(value))) {
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    return await job();
  } finally {
    await db.appState.deleteMany({ where: { key: TIMERS_LOCK_KEY, value } }).catch(() => null);
  }
}

/** The sweep the health check runs: under the lock, skipped when one is running; an error is logged, never thrown (the health answer never depends on it). */
export async function healthSweep(now = new Date()) {
  try {
    const { runSweep } = await import("./holds");
    const r = await withTimersLock(() => runSweep(now));
    return r ? "ran" : "busy";
  } catch (e) {
    console.error("[sweep] failed:", (e as Error).message);
    return "failed";
  }
}
