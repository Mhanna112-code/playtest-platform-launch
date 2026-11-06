import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { startHold } from "@/lib/server/holds";
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
    expect(renderTimes((await pausedClosingWords(many.dev.user.id))!, "UTC")).toBe(`“T1”, “T2”, “T3”, “T4” and “T5” close on ${fmt(new Date(now.getTime() + 7 * DAY))} and 2 more`);
    const none = await devWith(["Quiet"]);
    expect(await pausedClosingWords(none.dev.user.id)).toBeNull();
  });
});
