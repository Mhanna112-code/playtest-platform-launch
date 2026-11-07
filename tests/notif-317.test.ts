import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { APPS_WAITING_GROUP, bellKeyIn, groupTitle } from "@/lib/bell";
import { runDaily } from "@/lib/server/holds";
import { PAYOUT_LINE } from "@/lib/payout";
import { PAYOUT_MARK_DAYS, payoutFixed, payoutMarkDue, payoutProblem, payoutReminders } from "@/lib/server/restrictions";
import { act, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 6, §317) a: the payout problem's reminders on days 0, 3, 10 and 30, then none (a new problem starts over); b: the developer's daily "… wait for your
// answer" lines stack across tests ("Applications waiting · N"), apart from §308's "Applications · N".

const DAY = 86_400_000;

describe("§317a the payout problem reminders: days 0, 3, 10, 30, then stop", () => {
  it("the marks: each once, the latest passed only, nothing after 30 days", () => {
    expect(PAYOUT_MARK_DAYS).toEqual([0, 3, 10, 30]);
    const start = new Date("2026-11-01T10:00:00Z");
    const at = (d: number) => new Date(start.getTime() + d * DAY);
    let reminded: Date | null = start; // day 0: sent when the problem started
    const sent: number[] = [];
    for (let d = 0; d <= 45; d++) {
      const m = payoutMarkDue(start, reminded, at(d));
      if (m !== null) {
        sent.push(m);
        reminded = at(d);
      }
    }
    expect(sent).toEqual([3, 10, 30]);
    // A missed mark isn't sent late: on day 12 with nothing since day 0, only the 10-day mark.
    expect(payoutMarkDue(start, start, at(12))).toBe(10);
    expect(payoutMarkDue(start, at(12), at(20))).toBeNull();
  });

  it("the daily job sends day 3 once; fixed then a new problem starts over", async () => {
    const t = await makeUser({ tester: true });
    const acct = `acct_${t.user.id}`;
    await db.user.update({ where: { id: t.user.id }, data: { stripeAccountId: acct } });
    expect(await payoutProblem(acct, new Date(Date.now() - 3 * DAY))).toBe(true);
    const lines = () => db.notification.count({ where: { userId: t.user.id, text: PAYOUT_LINE } });
    expect(await lines()).toBe(1); // day 0
    await payoutReminders();
    await payoutReminders();
    expect(await lines()).toBe(2); // day 3, once
    await payoutFixed(acct);
    expect(await payoutProblem(acct)).toBe(true);
    expect(await lines()).toBe(3); // the new problem's day 0
    await payoutReminders();
    expect(await lines()).toBe(3);
  });
});

describe("§317b \"… wait for your answer\" stacks across tests", () => {
  it("each test's daily line in one 'Applications waiting' stack, following the email setting; apart from 'Applications'", async () => {
    const a = await setup({ joinMode: "apply" });
    const b = await setup({ joinMode: "apply", title: "Sky Lab", productName: "Sky Lab" });
    await db.test.update({ where: { id: b.testId }, data: { developerId: a.dev.user.id } });
    for (const testId of [a.testId, b.testId]) {
      const t = await makeUser({ tester: true });
      expect((await act(testId, "apply", t.cookie, { note: "Hi" })).status).toBe(200);
    }
    await runDaily();
    const mine = await db.notification.findMany({ where: { userId: a.dev.user.id, text: { endsWith: "for your answer" } } });
    expect(mine.map((n) => n.text).sort()).toEqual(["“Harbor Run”: 1 application or rejoin ask waits for your answer", "“Sky Lab”: 1 application or rejoin ask waits for your answer"]);
    expect(mine.every((n) => n.groupKey === APPS_WAITING_GROUP && !n.mustEmail)).toBe(true);
    expect(new Set(mine.map((n) => bellKeyIn(n))).size).toBe(1);
    expect(groupTitle(APPS_WAITING_GROUP, 2, 2)).toBe("Applications waiting · 2");
    // The new applications themselves stay in §308's own stack.
    const applied = await db.notification.findMany({ where: { userId: a.dev.user.id, text: { contains: "applied to join" } } });
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((n) => n.groupKey === "applications")).toBe(true);
  });
});
