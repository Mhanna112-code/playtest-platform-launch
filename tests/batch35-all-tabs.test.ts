import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ALERT_TYPES, alertOf } from "@/lib/alerts";
import { logAction } from "@/lib/server/live";
import { payMoreLine } from "@/lib/server/testerGate";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";
import { pay, payMore } from "./b15";

// Batch 35 §67 (owner, Oct 31): any own action in another tab stops every press once; §68 a Dispute always stops for a new payment on that piece (Alerts Off too);
// §69 no "Listing changes" in the developer's Alerts.
const later = () => new Promise((r) => setTimeout(r, 30));
const texts = (r: { body: { error?: { code?: string; changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);

async function twoTesters() {
  const { dev, testId } = await setup({ spots: 5 });
  const x = await joined(testId, "Ana Silva");
  const y = await joined(testId, "Ben Okafor");
  await sact(x.sessionId, "written", x.tester.cookie, { answers: ["a", "b"] });
  await later();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: x.sessionId } });
  return { dev, testId, x, y, sub };
}
const callTo = (sessionId: string) => ({ contractIds: [sessionId], rows: [{ startsAt: atHours(100), repeat: "once", count: 1 }], minutes: "30" });

describe("batch 35 §67: every own action in another tab stops every developer press once", () => {
  it("a Pay to tester X in tab A stops a call request to tester Y in tab B once; the confirmed press goes ahead", async () => {
    const w = await twoTesters();
    const loaded = seen();
    await later();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, tab: "A" })).status).toBe(200);
    await later();
    const r = await act(w.testId, "request-time", w.dev.cookie, { ...callTo(w.y.sessionId), seenAt: loaded, loadedAt: loaded, tab: "B" });
    expect(texts(r), JSON.stringify(r.body)).toEqual([expect.stringMatching(/^You paid Ana Silva \$10\.00 .*in another tab$/)]);
    const box = r.body.error.changes.at(-1).at;
    expect((await act(w.testId, "request-time", w.dev.cookie, { ...callTo(w.y.sessionId), seenAt: loaded, boxAt: box, confirmed: true, tab: "B" })).status).toBe(200);
  });

  it("an action that touches nothing of the press (a rating of tester X) now stops a call request to tester Y too", async () => {
    const w = await twoTesters();
    const loaded = seen();
    await later();
    await logAction(w.dev.user.id, w.testId, { tab: "A" }, "rated Ana Silva", { a: "rate", k: [`c:${w.x.sessionId}`] });
    await later();
    const r = await act(w.testId, "request-time", w.dev.cookie, { ...callTo(w.y.sessionId), seenAt: loaded, loadedAt: loaded, tab: "B" });
    expect(texts(r)).toEqual(["You rated Ana Silva in another tab"]);
  });

  it("Edit's Save stops once for a payment made on the test page in another tab", async () => {
    const w = await twoTesters();
    const loaded = seen();
    await later();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, tab: "page" })).status).toBe(200);
    await later();
    const v = (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).version;
    const r = await act(w.testId, "edit", w.dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: loaded, loadedAt: loaded, tab: "edit" });
    expect(texts(r), JSON.stringify(r.body)).toContainEqual(expect.stringMatching(/^You paid Ana Silva \$10\.00 .*in another tab$/));
  });
});

describe("batch 35 §68: a tester's Dispute stops once for a payment on that piece, even with Alerts Off", () => {
  it("Pay more on the piece after the page loaded: the Dispute stops once (Alerts Off), the confirmed press opens it", async () => {
    const w = await twoTesters();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await db.user.update({ where: { id: w.x.tester.user.id }, data: { testerAlertsOff: true } });
    await later();
    const loaded = seen();
    await later();
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.x.sessionId, submissionId: w.sub.id, amount: "5.00", tickedCents: 500, payKey: randomUUID() })).status).toBe(200);
    await later();
    const body = { kind: "submission", id: w.sub.id, reason: "I answered every question fully" };
    const r = await sact(w.x.sessionId, "dispute", w.x.tester.cookie, { ...body, seenAt: loaded, pageSeenAt: loaded });
    expect(texts(r), JSON.stringify(r.body)).toEqual([payMoreLine("Nora Lane", 500, "written answers")]);
    expect(r.body.error.alertsOff).toBe(true);
    const box = r.body.error.changes.at(-1).at;
    expect((await sact(w.x.sessionId, "dispute", w.x.tester.cookie, { ...body, seenAt: loaded, boxAt: box, confirmed: true })).status).toBe(200);
  });
});

describe("batch 35 §69: no Listing changes in the developer's Alerts", () => {
  it("the menu has no listing item, and listing lines are never ignorable for the developer", () => {
    expect(ALERT_TYPES.map((a) => a.key)).not.toContain("listing");
    expect(ALERT_TYPES.map((a) => a.label)).not.toContain("Listing changes");
    for (const k of ["info", "renamed", "edited"]) expect(alertOf(k)).toBeNull();
  });
});
