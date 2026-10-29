import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as healthGET } from "@/app/api/health/route";
import { TIMERS_LOCK_KEY } from "@/lib/server/timers";

// Batch 19 section 4: a sweep error never changes the health answer or records an outage (the sweep is made to fail here).
vi.mock("@/lib/server/holds", async (orig) => ({ ...(await orig<typeof import("@/lib/server/holds")>()), runSweep: async () => { throw new Error("sweep broke"); } }));

const KEY = "test-health-key-19e";
const ping = () => healthGET(new Request(`http://localhost:3400/api/health?key=${KEY}`));

describe("batch 19 section 4: a sweep error still answers healthy", () => {
  beforeEach(() => {
    process.env.HEALTH_KEY = KEY;
    process.env.OUTAGE_CHECKS = "1";
  });
  afterEach(() => {
    delete process.env.HEALTH_KEY;
    delete process.env.OUTAGE_CHECKS;
  });

  it("answers ok, records no outage and leaves the lock free", async () => {
    const outages = await db.outage.count();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ping();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, emails: "sending" });
    expect(log.mock.calls.some((c) => String(c[0]).startsWith("[sweep] failed:") && String(c[1]) === "sweep broke")).toBe(true);
    log.mockRestore();
    expect(await db.outage.count()).toBe(outages);
    expect(await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } })).toBeNull();
    expect(await db.appState.findUnique({ where: { key: "outage-down" } })).toBeNull();
  });
});
