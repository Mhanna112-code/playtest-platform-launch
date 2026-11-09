import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordGap, recordOutage } from "@/lib/server/outages";
import { makeUser } from "./helpers";

// (Owner, Nov 9, §337) A recorded outage moves the confirm-by date of a payment waiting for the developer's bank by its length (the 3 days for a charge made while
// they were away), so no confirmation time is lost to downtime; a date already passed before the outage stays; a reservation's 7-day expiry never moves.
const HOUR = 3_600_000, DAY = 24 * HOUR;
// Far in the future, so the outage moves only this file's rows (each test its own hour, never overlapping another outage).
let slot = 0;
const window = () => {
  const start = new Date(Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 1e5) * 10 * HOUR + slot++ * 3 * HOUR);
  return { start, end: new Date(start.getTime() + HOUR), ms: HOUR };
};

async function waiting(by: Date, extra: Record<string, unknown> = {}) {
  const dev = await makeUser({ dev: true, name: "Nora Lane" });
  const tester = await makeUser({ tester: true, name: "Ana Silva" });
  return db.payment.create({ data: { kind: "choice", developerId: dev.user.id, testerId: tester.user.id, amountCents: 2000, feeCents: 400, testerCents: 1600, status: "needs_confirmation", actionPi: "pi_test", actionBy: by, ...extra } });
}
const byOf = async (id: string) => (await db.payment.findUniqueOrThrow({ where: { id } })).actionBy!.getTime();

describe("§337 an outage moves the bank-confirmation deadline", () => {
  it("a charge made while away, waiting for the bank: its confirm-by moves by the outage; one already passed before it doesn't", async () => {
    const o = window();
    const running = await waiting(new Date(o.start.getTime() + 2 * DAY));
    const passed = await waiting(new Date(o.start.getTime() - HOUR));
    const settled = await waiting(new Date(o.start.getTime() + DAY), { status: "charged", settledAt: new Date() });
    const before = { running: await byOf(running.id), passed: await byOf(passed.id), settled: await byOf(settled.id) };
    expect(await recordOutage(o.start, o.end)).toBeTruthy();
    expect(await byOf(running.id)).toBe(before.running + o.ms);
    expect(await byOf(passed.id)).toBe(before.passed);
    expect(await byOf(settled.id)).toBe(before.settled);
  });

  it("an owed payment's check (it keeps its status) and the press's own check move too", async () => {
    const o = window();
    const owed = await waiting(new Date(o.start.getTime() + DAY), { status: "failed" });
    const press = await waiting(new Date(o.start.getTime() + 10 * 60_000), { status: "needs_action" });
    const [a, b] = [await byOf(owed.id), await byOf(press.id)];
    await recordOutage(o.start, o.end);
    expect(await byOf(owed.id)).toBe(a + o.ms);
    expect(await byOf(press.id)).toBe(b + o.ms);
  });

  it("recorded twice (and the same downtime seen again as a gap): moved once", async () => {
    const o = window();
    const p = await waiting(new Date(o.start.getTime() + 2 * DAY));
    const was = await byOf(p.id);
    expect(await recordOutage(o.start, o.end)).toBeTruthy();
    expect(await recordOutage(o.start, o.end)).toBeNull(); // already recorded
    await recordGap(o.start, o.end); // the same downtime: recorded once
    expect(await byOf(p.id)).toBe(was + o.ms);
  });

  it("a reservation's 7-day expiry (and its check) never moves", async () => {
    const o = window();
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const r = await db.reservation.create({ data: { developerId: dev.user.id, amountCents: 2500, covers: [], status: "reserved", expiresAt: new Date(o.start.getTime() + 5 * DAY), actionBy: new Date(o.start.getTime() + DAY) } });
    await recordOutage(o.start, o.end);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.expiresAt!.getTime()).toBe(r.expiresAt!.getTime());
    expect(after.actionBy!.getTime()).toBe(r.actionBy!.getTime());
  });
});
