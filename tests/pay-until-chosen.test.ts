import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { startHold } from "@/lib/server/holds";
import { json, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const payBody = (id: string) => ({ kind: "submission", id, amount: "10.00", tickedCents: 1000 });
// (Batch 15 section 30) Reject is gone: the other decision is a $0 payment with a reason.
const rejectBody = (id: string) => ({ kind: "submission", id, amount: "0", reason: "Not what I asked for" });

/** A tester (new, or the one given) with a piece of work waiting for the developer's Pay or Reject (made directly: one piece per tester). */
async function piece(testId: string, name = "Ben Carter") {
  const j = await joined(testId, name);
  const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", answers: ["a", "b"], agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  return { ...j, sub };
}

// (Owner, Oct 26) The developer can Pay or Reject sent work at any time until the tester presses Charge or Let it go, unless the developer is
// suspended. That holds after Open until has passed, and after the test was closed or stopped.
describe("Pay and Reject stay available until the tester chooses", () => {
  it("after Open until has passed", async () => {
    const { dev, testId } = await setup();
    const [a, b] = [(await piece(testId, "Ana Silva")).sub, (await piece(testId)).sub];
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 2 * DAY) } });
    expect((await pay(dev.cookie, payBody(a.id))).status).toBe(200);
    expect((await pay(dev.cookie, rejectBody(b.id))).status).toBe(200);
  });

  it("after the developer stopped the test", async () => {
    const { dev, testId } = await setup();
    const [a, b] = [(await piece(testId, "Ana Silva")).sub, (await piece(testId)).sub];
    expect((await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await pay(dev.cookie, payBody(a.id))).status).toBe(200);
    expect((await pay(dev.cookie, rejectBody(b.id))).status).toBe(200);
  });

  it("after the test was closed because it stayed paused (once the hold is lifted)", async () => {
    const { dev, testId } = await setup();
    const [a, b] = [(await piece(testId, "Ana Silva")).sub, (await piece(testId)).sub];
    await startHold(dev.user.id, "unpaid");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 8 * DAY) } });
    await cron();
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("stopped");
    // (Owner, Oct 27) Pay and Reject are unavailable during ANY hold: they work again once it is lifted (a closed test can still be paid or rejected).
    expect((await pay(dev.cookie, payBody(a.id))).body.error.code).toBe("held");
    expect((await pay(dev.cookie, rejectBody(b.id))).body.error.code).toBe("held");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    expect((await pay(dev.cookie, payBody(a.id))).status).toBe(200);
    expect((await pay(dev.cookie, rejectBody(b.id))).status).toBe(200);
  });

  it("not once the tester pressed Let it go or Charge: both are final and name what the tester did", async () => {
    const { dev, testId } = await setup();
    const L = await piece(testId, "Ana Silva"), C = await piece(testId, "Ben Carter"), O = await piece(testId, "Cara Diaz");
    const [letgo, charged, open] = [L.sub, C.sub, O.sub];
    for (const s of [letgo, charged]) await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY), payBy: new Date(Date.now() - 1000) } });
    expect((await sact(L.sessionId, "choose", L.tester.cookie, { submissionId: letgo.id, choice: "letgo" })).status).toBe(200);
    expect((await sact(C.sessionId, "choose", C.tester.cookie, { submissionId: charged.id, choice: "charge", tickedCents: 1000 })).status).toBe(200);
    const a = await pay(dev.cookie, payBody(letgo.id));
    expect(a.status).toBe(409);
    expect(a.body.error.message).toBe("Ana Silva let this go: nothing was charged.");
    const b = await pay(dev.cookie, rejectBody(charged.id));
    expect(b.status).toBe(409);
    expect(b.body.error.message).toBe("Ben Carter already charged $10.00 for this.");
    // A piece the tester has not chosen on is still payable (the offer alone changes nothing).
    expect((await pay(dev.cookie, payBody(open.id))).status).toBe(200);
  });

  it("not while the developer is suspended: both are refused and nothing is recorded", async () => {
    const { dev, testId } = await setup();
    const [a, b] = [(await piece(testId, "Ana Silva")).sub, (await piece(testId)).sub];
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    const p = await pay(dev.cookie, payBody(a.id));
    expect(p.status).toBe(403);
    expect(p.body.error.code).toBe("suspended");
    const r = await pay(dev.cookie, rejectBody(b.id));
    expect(r.status).toBe(403);
    expect(await db.review.count({ where: { submissionId: { in: [a.id, b.id] } } })).toBe(0);
    // Lifted: both work again, even on a stopped test.
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: null, testerSuspendedAt: null } });
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    expect((await pay(dev.cookie, payBody(a.id))).status).toBe(200);
    expect((await pay(dev.cookie, rejectBody(b.id))).status).toBe(200);
  });
});
