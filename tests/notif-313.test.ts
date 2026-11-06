import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { closeSoonMarkDue, startHold } from "@/lib/server/holds";
import { pausedClosingWords } from "@/lib/server/pauseClosure";
import { suspendAccount } from "@/lib/server/restrictions";
import { makeUser } from "./helpers";
import { setup } from "./fixtures";

// (Owner, Nov 6, §313) a: the hold's or suspension's one line names each paused test's closing date (no per-test "<test> is paused and closes on …" lines).

const DAY = 86_400_000;
const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
};
/** A developer with tests named `titles` (all open). */
async function devWith(titles: string[]) {
  const s = await setup({ title: titles[0], productName: titles[0] });
  for (const t of titles.slice(1)) {
    const o = await setup({ title: t, productName: t });
    await db.test.update({ where: { id: o.testId }, data: { developerId: s.dev.user.id } });
  }
  return s;
}
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

describe("§313a one line names the paused tests' closing dates", () => {
  it("a payment hold: \"Your tests are paused until you pay what you owe: “Harbor Run” and “Sky Lab” close on <date>\"; no per-test lines", async () => {
    const s = await devWith(["Harbor Run", "Sky Lab"]);
    await startHold(s.dev.user.id, "unpaid");
    const at = fmt(new Date(Date.now() + 7 * DAY));
    const mine = (await db.notification.findMany({ where: { userId: s.dev.user.id } })).map((n) => renderTimes(n.text, "UTC"));
    expect(mine).toContain(`Your tests are paused until you pay what you owe: “Harbor Run” and “Sky Lab” close on ${at}`);
    expect(mine.filter((t) => / is paused and closes on /.test(t))).toEqual([]);
  });

  it("a chargeback hold and a suspension: their own endings", async () => {
    const a = await devWith(["Harbor Run"]);
    await startHold(a.dev.user.id, "chargeback");
    const at = fmt(new Date(Date.now() + 7 * DAY));
    expect((await db.notification.findMany({ where: { userId: a.dev.user.id } })).map((n) => renderTimes(n.text, "UTC")))
      .toContain(`Your tests are paused after a chargeback: “Harbor Run” closes on ${at} unless you finish the steps`);
    const b = await devWith(["Sky Lab"]);
    await suspendAccount((await admin()).id, b.dev.user.id, "Checking", "developer");
    expect((await db.notification.findMany({ where: { userId: b.dev.user.id } })).map((n) => renderTimes(n.text, "UTC")))
      .toContain(`Your developer account is paused: “Sky Lab” closes on ${at} unless your account is cleared`);
  });

  it("different dates, in date order; over 5 names: \"and N more\"; no paused tests: null", async () => {
    const s = await devWith(["Harbor Run", "Sky Lab"]);
    const now = new Date();
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdStartedAt: now, holdReason: "unpaid" } });
    const sky = await db.test.findFirstOrThrow({ where: { developerId: s.dev.user.id, title: "Sky Lab" } });
    await db.test.update({ where: { id: sky.id }, data: { pauseCloseAt: new Date(now.getTime() + 9 * DAY), pauseCloseSetAt: now } });
    expect(renderTimes((await pausedClosingWords(s.dev.user.id))!, "UTC")).toBe(`“Harbor Run” closes on ${fmt(new Date(now.getTime() + 7 * DAY))}, “Sky Lab” on ${fmt(new Date(now.getTime() + 9 * DAY))}`);
    const many = await devWith(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
    await db.user.update({ where: { id: many.dev.user.id }, data: { holdStartedAt: now, holdReason: "unpaid" } });
    expect(renderTimes((await pausedClosingWords(many.dev.user.id))!, "UTC")).toBe(`“T1”, “T2”, “T3”, “T4”, “T5” and 2 more close on ${fmt(new Date(now.getTime() + 7 * DAY))}`);
    // Mixed dates past the 5th name: the rest counted at their date.
    const mixed = await devWith(["A1", "A2", "A3", "A4", "B1", "C1", "C2", "C3"]);
    await db.user.update({ where: { id: mixed.dev.user.id }, data: { holdStartedAt: now, holdReason: "unpaid" } });
    const later = async (title: string, days: number) => db.test.updateMany({ where: { developerId: mixed.dev.user.id, title }, data: { pauseCloseAt: new Date(now.getTime() + days * DAY), pauseCloseSetAt: now } });
    await later("B1", 9);
    for (const t of ["C1", "C2", "C3"]) await later(t, 14);
    expect(renderTimes((await pausedClosingWords(mixed.dev.user.id))!, "UTC")).toBe(
      `“A1”, “A2”, “A3” and “A4” close on ${fmt(new Date(now.getTime() + 7 * DAY))}, “B1” on ${fmt(new Date(now.getTime() + 9 * DAY))}, and 3 more on ${fmt(new Date(now.getTime() + 14 * DAY))}`,
    );
    const none = await devWith(["Quiet"]);
    expect(await pausedClosingWords(none.dev.user.id)).toBeNull();
  });
});

describe("§313b Closing soon follows a moved closing date", () => {
  it("a pause moving the date: no repeat that day; the new date's marks come; plain \"co:3\" counts as sent before", () => {
    const from = new Date("2026-11-01T10:00:00Z");
    const D = new Date("2026-11-20T15:00:00Z");
    const rec: string[] = [];
    const at = (iso: string) => new Date(iso);
    const step = (close: Date, now: Date) => {
      const r = closeSoonMarkDue(close, from, now, rec);
      rec.push(...r.record);
      return r.send;
    };
    expect(step(D, at("2026-11-10T09:00:00Z"))).toBeNull(); // first look
    expect(step(D, at("2026-11-13T09:00:00Z"))).toBe(7);
    expect(step(D, at("2026-11-17T09:00:00Z"))).toBe(3);
    // Paused 5 days: the date moves; the same day's run sends nothing (3 days was sent for the old date).
    const D2 = new Date(D.getTime() + 5 * DAY);
    expect(step(D2, at("2026-11-17T12:00:00Z"))).toBeNull();
    expect(step(D2, at("2026-11-22T09:00:00Z"))).toBe(3);
    expect(step(D2, at("2026-11-24T09:00:00Z"))).toBe(1);
    expect(step(D2, at("2026-11-24T18:00:00Z"))).toBeNull();
    // A plain mark from before §313b: sent for an earlier date.
    expect(closeSoonMarkDue(D, from, at("2026-11-17T09:00:00Z"), ["co:3"]).send).toBeNull();
    // The month only when the date was more than a month away when Charge opened.
    expect(closeSoonMarkDue(new Date(from.getTime() + 40 * DAY), from, new Date(from.getTime() + 10.5 * DAY), ["co:x:seen"]).send).toBe(30);
    expect(closeSoonMarkDue(new Date(from.getTime() + 25 * DAY), from, new Date(from.getTime() + 18.5 * DAY), ["co:x:seen"]).send).toBe(7);
  });
});
