import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { chargeAmount, payStart } from "@/lib/rules";
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

describe("a suspended developer keeps Cancel call, End early and Stop, with or without a payment hold (owner, Oct 26)", () => {
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
    for (const body of [{ kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 }, { action: "reject", kind: "submission", id: sub.id, reason: "No" }]) {
      const r = await pay(s.dev.cookie, body);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("suspended");
    }
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    // "Pay what you owe" exists only during a hold.
    expect((await owed(s.dev.cookie)).status).toBe(hold ? 200 : 403);
    // The three presses that stay.
    expect((await act(s.testId, "cancel-call", s.dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(s.testId, "end-early", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have what we need" })).status).toBe(200);
    expect((await act(s.testId, "stop", s.dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("a payment hold alone is unchanged: Pay is recorded and its charge waits", async () => {
    const s = await setup();
    const { tester, sessionId } = await joined(s.testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await startHold(s.dev.user.id, "unpaid");
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body).toMatchObject({ status: "deferred" });
  });
});

describe("a tester's updated written answers or recording can change the ask (owner, Oct 26)", () => {
  async function sentWith(ask?: string) {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], ...(ask ? { ask } : {}) });
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    return { ...s, ...j, sub };
  }
  const newest = (id: string) => db.submission.findUniqueOrThrow({ where: { id } });

  it("the newest ask replaces the old one (raised, lowered or taken back); the developer reads it in the live feed", async () => {
    const { sessionId, tester, sub, testId } = await sentWith("8.00");
    expect((await newest(sub.id)).askedCents).toBe(800);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], ask: "15.00" })).status).toBe(200);
    expect((await newest(sub.id)).askedCents).toBe(1500); // raised above the first ask
    expect(await db.testEvent.count({ where: { testId, text: "Ana Silva updated her written answers and now asks $15.00" } })).toBe(1);
    // Unchanged ask: nothing extra said.
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "c"], ask: "15.00" });
    expect(await db.testEvent.count({ where: { testId, text: "Ana Silva updated her written answers" } })).toBe(1);
    // Taken back.
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "c"] });
    expect((await newest(sub.id)).askedCents).toBeNull();
    expect(await db.testEvent.count({ where: { testId, text: "Ana Silva updated her written answers and took back the ask" } })).toBe(1);
  });

  it("an updated recording can change the ask too", async () => {
    const s = await setup({ recordingCents: "12.00" });
    const { sessionId, tester } = await joined(s.testId);
    await db.recording.create({ data: { contractId: sessionId, storageKey: "k", filename: "run.mp4", sizeBytes: 10, contentType: "video/mp4", uploadedAt: new Date() } });
    expect((await sact(sessionId, "recording-send", tester.cookie, { ask: "5.00" })).status).toBe(200);
    const rec = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "recording" } });
    expect(rec.askedCents).toBe(500);
    expect((await sact(sessionId, "recording-send", tester.cookie, { ask: "9.50" })).status).toBe(200);
    expect((await newest(rec.id)).askedCents).toBe(950);
    expect(await db.testEvent.count({ where: { testId: s.testId, text: "Ana Silva updated her recording and now asks $9.50" } })).toBe(1);
  });

  it("the Pay box starts at the newest ask; the Charge cap uses it but never goes above listing minus what was paid", async () => {
    expect(payStart(1000, 800)).toBe(800);
    expect(payStart(1000, 1500)).toBe(1500); // raised: the box starts at the new ask
    expect(chargeAmount(1000, 1500, 0)).toBe(1000); // never above the listing
    expect(chargeAmount(1000, 1500, 400)).toBe(600); // ... minus what was already paid for that part
    expect(chargeAmount(1000, 300, 0)).toBe(300);
    expect(chargeAmount(1000, null, 400)).toBe(600);

    // Through the real flow: asked 6.00, then raised to 15.00; at day 14 the tester can charge the listing ($10.00) but not more.
    const { sessionId, tester, sub, dev } = await sentWith("6.00");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], ask: "15.00" });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    expect((await newest(sub.id)).choiceOfferedAt).not.toBeNull();
    const tooMuch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "12.00", tickedCents: 1200 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toBe("At most $10.00.");
    const ok = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(ok.body).toMatchObject({ choice: "charge", amountCents: 1000 });
    void dev;
  });

  it("after a lowered update the cap follows the lower ask", async () => {
    const { sessionId, tester, sub } = await sentWith("9.00");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], ask: "4.00" });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "5.00", tickedCents: 500 });
    expect(r.body.error.message).toBe("At most $4.00.");
  });
});
