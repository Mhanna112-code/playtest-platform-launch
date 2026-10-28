import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { chargeAmount } from "@/lib/rules";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const owed = (cookie: string) => owedPOST(req("/api/payments/owed", { cookie, body: {} })).then(json);
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const later = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => setStripeForTests(null));

async function admin() {
  const a = await makeUser({ name: "Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}

describe("a suspended developer keeps Cancel call, End early and Stop, with or without a payment hold (batch 15 section 29: from the restricted view)", () => {
  it.each([["suspension only", false], ["suspension and a payment hold", true]])("%s", async (_name, hold) => {
    const s = await setup();
    const { tester, sessionId } = await joined(s.testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const call = await bookCall(s.testId, s.dev.cookie, sessionId, tester.cookie, 24 * 6);
    const a = await admin();
    expect((await adm("suspend", a.cookie, { id: s.dev.user.id, note: "Spam" })).status).toBe(200);
    if (hold) await startHold(s.dev.user.id, "unpaid");
    // Pay and Reject are refused whatever the hold; nothing is recorded.
    for (const body of [{ kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 }, { amount: "0", kind: "submission", id: sub.id, reason: "No thanks" }]) {
      const r = await pay(s.dev.cookie, body);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("suspended");
    }
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    // "Pay what you owe" exists only during a hold.
    expect((await owed(s.dev.cookie)).status).toBe(hold ? 200 : 403);
    // The three presses that stay.
    expect((await act(s.testId, "cancel-call", s.dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    // (Owner, Oct 30, batch 15 section 29) End early and Stop work from the restricted view.
    expect((await act(s.testId, "end-early", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have what we need" })).status).toBe(200);
    expect((await act(s.testId, "stop", s.dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("a payment hold alone: Pay is refused as well", async () => {
    const s = await setup();
    const { tester, sessionId } = await joined(s.testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await startHold(s.dev.user.id, "unpaid");
    // (Owner, Oct 27) Pay is unavailable during a payment hold too (no "charged when your account is clear" path any more).
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error).toMatchObject({ code: "held" });
  });
});

describe("no Ask $ on sends (owner, Oct 26): the Pay box starts at the listing; the Charge cap is the listing minus what was paid", () => {
  async function sent() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], ask: "6.00" }); // a stale client's ask is ignored
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    return { ...s, ...j, sub };
  }
  const newest = (id: string) => db.submission.findUniqueOrThrow({ where: { id } });

  it("an ask is never stored, and an updated send says nothing about asks in the live feed", async () => {
    const { sessionId, tester, sub, testId } = await sent();
    expect((await newest(sub.id)).askedCents).toBeNull();
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "c"], ask: "15.00" })).status).toBe(200);
    expect((await newest(sub.id)).askedCents).toBeNull();
    expect(await db.testEvent.count({ where: { testId, text: "Ana Silva updated her written answers" } })).toBe(1);
    expect(await db.testEvent.count({ where: { testId, text: { contains: "asks" } } })).toBe(0);
  });

  it("an old ask in the database is unused: the cap is the listing minus what was paid", async () => {
    expect(chargeAmount(1000, 0)).toBe(1000);
    expect(chargeAmount(1000, 400)).toBe(600);
    const { sessionId, tester, sub, testId } = await sent();
    await db.submission.update({ where: { id: sub.id }, data: { askedCents: 300, payBy: new Date(Date.now() - 1000) } }); // old data
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } }); await db.contract.updateMany({ where: { testId: testId }, data: { dueAt: new Date(Date.now() - 1000) } }); // (batch 15 section 18: the tester's own deadline) // Charge opens after Open until
    await cron();
    expect((await newest(sub.id)).choiceOfferedAt).not.toBeNull();
    const tooMuch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "12.00", tickedCents: 1200 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toBe("At most $10.00.");
    const ok = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(ok.body).toMatchObject({ choice: "charge", amountCents: 1000 });
  });
});
