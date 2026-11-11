import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { runDaily } from "@/lib/server/holds";
import { DAILY_LOCK_WAIT_MS, TIMERS_LOCK_KEY, TIMERS_LOCK_STALE_MS, withTimersLock } from "@/lib/server/timers";

// (Owner, Nov 11, §383) The daily job waits for the timers lock (a running sweep, or a holder abandoned past TIMERS_LOCK_STALE_MS) and never runs without it.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
afterEach(async () => {
  vi.restoreAllMocks();
  await db.appState.deleteMany({ where: { key: TIMERS_LOCK_KEY } });
});

describe("§383 the daily job and the timers lock", () => {
  it("waits for a running sweep to finish, then runs under the lock", async () => {
    let released = 0;
    const sweep = withTimersLock(async () => {
      await sleep(2500);
      released = Date.now();
      return "swept";
    });
    await sleep(100); // the sweep holds the lock
    const daily = runDaily(new Date(), { waitMs: 60_000 }).then((r) => ({ r, at: Date.now() }));
    expect(await sweep).toBe("swept");
    const { r, at } = await daily;
    expect(r).not.toBeNull();
    expect(at).toBeGreaterThanOrEqual(released);
    expect(await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } })).toBeNull();
  }, 120_000);

  it("never runs without the lock: a lock still held when the wait ends logs an error and runs nothing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const held = `${Date.now()}:held-by-test`;
    await db.appState.create({ data: { key: TIMERS_LOCK_KEY, value: held } });
    const before = await db.notification.count();
    const t0 = Date.now();
    expect(await runDaily(new Date(), { waitMs: 1500 })).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[daily] not run"));
    expect(await db.notification.count()).toBe(before);
    expect((await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } }))?.value).toBe(held); // untouched
    // The real wait outlasts an abandoned holder: it is taken over before the daily job would give up.
    expect(DAILY_LOCK_WAIT_MS).toBeGreaterThan(TIMERS_LOCK_STALE_MS);
  }, 60_000);

  it("takes over a lock left by a run that died (older than TIMERS_LOCK_STALE_MS) and runs", async () => {
    await db.appState.create({ data: { key: TIMERS_LOCK_KEY, value: `${Date.now() - TIMERS_LOCK_STALE_MS + 1500}:died` } });
    const t0 = Date.now();
    expect(await runDaily(new Date(), { waitMs: 60_000 })).not.toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000); // it waited for the holder to go stale first
    expect(await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } })).toBeNull();
  }, 120_000);
});
