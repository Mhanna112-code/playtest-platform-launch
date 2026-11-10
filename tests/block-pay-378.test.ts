import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { pauseTest } from "@/lib/server/restrictions";
import { reportPerson } from "@/lib/server/reports";
import { pieceCloseOut } from "@/lib/server/closeOut";
import { fmtDate } from "@/lib/format";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { DAY, pay, payMore, sentWork } from "./b15";

// (Owner, Nov 11, §378) Block never stops once; Pay, Pay more and Charge / Let it go on a piece close on the same date (that piece's Charge window end).

describe("§378 item 1: Block never stops once", () => {
  it("a pause of their test since the profile loaded: Block goes through on the first press; Report keeps its §271 stop", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const pageAt = seen();
    await settle();
    await pauseTest((await makeUser({ name: "Team Admin", email: "owner@playtest.test" })).user.id, s.testId, "Checking");
    await settle();
    const r = await reportPerson(a.tester.user, { userId: s.dev.user.id, note: "Something happened here, please look.", seenAt: pageAt }).then(() => null, (e) => e);
    expect(r?.code).toBe("stop_once");
    const b = await blocksPOST(req("/api/blocks", { cookie: a.tester.cookie, body: { userId: s.dev.user.id, seenAt: pageAt } })).then(json);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(await db.block.count({ where: { blockerId: a.tester.user.id, blockedId: s.dev.user.id } })).toBe(1);
    // The race refusal stays: already blocked in another tab.
    const again = await blocksPOST(req("/api/blocks", { cookie: a.tester.cookie, body: { userId: s.dev.user.id } })).then(json);
    expect(again.body.error.code).toBe("already");
  });
});

describe("§378 item 2: Pay, Pay more and Charge / Let it go on a piece close on the same date", () => {
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  async function deadlinesAt(testId: string, daysAgo: number) {
    const base = ago(daysAgo);
    await db.test.update({ where: { id: testId }, data: { openUntil: base } });
    await db.contract.updateMany({ where: { testId }, data: { dueAt: base } });
    return base;
  }
  beforeEach(async () => { await db.outage.deleteMany({}); }); // (outages are site-wide)

  it("two pieces with different closings: Pay more on the earlier piece closes on its own date; the later piece's still goes through", async () => {
    const w = await sentWork("10.00", { spots: 5 });
    const c = await joined(w.testId, "Cara Diaz", "she");
    await sact(c.sessionId, "written", c.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subC = await db.submission.findFirstOrThrow({ where: { contractId: c.sessionId } });
    for (const id of [w.sub.id, subC.id]) expect((await pay(w.dev.cookie, { kind: "submission", id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    const base = await deadlinesAt(w.testId, 20); // the test's close-out: 6 days ago
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(25) } }); // Ana's: closes with the close-out
    const openedC = ago(3);
    await db.submission.update({ where: { id: subC.id }, data: { payBy: openedC } }); // Cara's: its own window, 11 more days
    const earlier = new Date(base.getTime() + 14 * DAY);
    expect((await pieceCloseOut({ submissionId: w.sub.id }))!.getTime()).toBe(earlier.getTime());
    expect((await pieceCloseOut({ submissionId: subC.id }))!.getTime()).toBe(openedC.getTime() + 14 * DAY);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100 })).body.error.message).toBe(`Pay more closed on ${fmtDate(earlier)}.`);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: c.sessionId, submissionId: subC.id, amount: "1.00", tickedCents: 100 })).status).toBe(200);
  });

  it("a tester's suspension extends Pay and Pay more with Charge (one date)", async () => {
    const w = await sentWork("10.00", { spots: 5 });
    const b = await joined(w.testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    expect((await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    const base = await deadlinesAt(w.testId, 15); // the close-out: yesterday
    for (const id of [w.sub.id, subB.id]) await db.submission.update({ where: { id }, data: { payBy: ago(20) } });
    // Ana's tester side was suspended 3 days during the window: her pieces close 3 days later, for Charge, Pay and Pay more alike.
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(base.getTime() + DAY) } });
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(base.getTime() + 4 * DAY) } });
    expect((await pieceCloseOut({ submissionId: w.sub.id }))!.getTime()).toBe(base.getTime() + 17 * DAY);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100 })).status).toBe(200);
    // Ben wasn't suspended: his piece closed with the close-out.
    expect((await payMore(w.testId, w.dev.cookie, { contractId: b.sessionId, submissionId: subB.id, amount: "1.00", tickedCents: 100 })).body.error.message).toBe(`Pay more closed on ${fmtDate(new Date(base.getTime() + 14 * DAY))}.`);
  });

  it("an unpaid piece: the developer's Pay closes on the tester's date too (suspension included)", async () => {
    const w = await sentWork("10.00");
    const base = await deadlinesAt(w.testId, 15);
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(20) } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).body.error.message).toBe(`Pay closed on ${fmtDate(new Date(base.getTime() + 14 * DAY))}.`);
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(base.getTime() + DAY) } });
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(base.getTime() + 4 * DAY) } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
  });

  it("reminders, pages and Needs you read each piece's own date", () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    const holds = src("lib/server/holds.ts");
    // The daily closing-soon reminders and the Charge lines: one date per piece, the same for Pay and Charge.
    expect(holds).toContain("return { at, payClosed: async (k: Piece) => closedOut(await at(k), now), chargeClosed: async (k: Piece) => closedOut(await at(k), now) };");
    expect(src("lib/server/closeOut.ts")).not.toContain("payMoreClosesAt");
    for (const f of ["app/app/tests/[id]/page.tsx", "app/app/sessions/[id]/page.tsx", "lib/server/dashboardNeeds.ts", "lib/server/paidUpdates.ts", "lib/server/payments.ts"]) expect(src(f), f).not.toContain("payMoreClosesAt");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("closedOn: payMoreShut(id) } : null);");
    expect(src("lib/server/paidUpdates.ts")).toContain("const shut = closedOut(await pieceCloseOut({ submissionId }));");
  });
});
