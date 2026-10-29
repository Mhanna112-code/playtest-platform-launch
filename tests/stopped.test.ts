import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 8));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const texts = (r: { body: { error: { changes: { text: string }[] } } }) => r.body.error.changes.map((c) => c.text);

// (Owner, Oct 26) A STOPPED test: what is still allowed keeps its stop-once and final-refusal rules; what is not is refused for good.
async function paidBelowListing() {
  const s = await setup({ writtenCents: "10.00", recordingCents: "10.00", liveRateCents: null });
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await later();
  const written = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
  const pr = await pay(s.dev.cookie, { kind: "submission", id: written.id, amount: "4.00", tickedCents: 400, reason: "Only half answered", confirmed: true });
  expect(pr.status).toBe(200);
  return { ...s, ...j, written };
}

describe("after the test is stopped", () => {
  it("the developer can still Pay: a tester's dispute since the page loaded stops the first press once (and is a Needs you item)", async () => {
    const { dev, tester, sessionId, testId, written } = await paidBelowListing();
    // A second piece is sent and waits for Pay; the developer's page loads now.
    await sact(sessionId, "recording-start", tester.cookie, { filename: "a.webm", size: 10, contentType: "video/webm" }).catch(() => null);
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    const opened = seen();
    await later();
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: written.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true });
    expect(d.status).toBe(200);
    const first = await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000, seenAt: opened });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("stop_once");
    // (Batch 17 section 12) A page opened before the stop: Pay stops once with the stop as the change.
    expect(texts(first)).toEqual([expect.stringMatching(/^You stopped this test at /)]);
    // The second press goes ahead (nothing newer happened).
    const second = await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: true, boxAt: first.body.error.now });
    expect(second.status).toBe(200);
    // The dispute is a bell line for the developer.
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "disputed a payment" } } })).toBeGreaterThan(0);
  });

  it("the developer's other buttons are refused for good, naming the stop (batch 7: Next round still works)", async () => {
    const { dev, testId, sessionId } = await paidBelowListing();
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    const someone = await makeUser({ tester: true });
    for (const [action, body] of [["edit", { version: 1, fields: { title: "x" } }], ["invite", { testerIds: [someone.user.id] }], ["end-early", { contractIds: [sessionId], reason: "Enough thanks" }]] as const) {
      const r = await act(testId, action, dev.cookie, { seenAt: seen(), confirmed: true, ...body });
      expect(r.status, action).toBe(409);
      expect(r.body.error.message, action).toMatch(/stopped/);
    }
    // (Batch 7) Next round stays on a stopped test: it starts a new draft from it.
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  // (Owner, Oct 29, batch 29 section 11) On a stopped test the tester's Dispute follows the running test's stop-once rules: the stop and the developer's side stop it once.
  it("Dispute: stops once for the stop, and for the developer's side, then goes through; an already disputed piece is final", async () => {
    const s = await setup({ writtenCents: "10.00", recordingCents: "10.00", liveRateCents: null });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await later();
    const w = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    const rec = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await pay(s.dev.cookie, { kind: "submission", id: w.id, amount: "4.00", tickedCents: 400, reason: "Only half answered", confirmed: true });
    await pay(s.dev.cookie, { kind: "submission", id: rec.id, amount: "3.00", tickedCents: 300, reason: "Barely a recording", confirmed: true });
    const opened = seen();
    await later();
    await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    const first = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: w.id, reason: "I answered everything properly", seenAt: opened });
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(/^Nora Lane stopped this test at /)]);
    expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: w.id, reason: "I answered everything properly", seenAt: opened, confirmed: true, boxAt: seen() })).status).toBe(200);
    const d1 = await db.dispute.findFirstOrThrow({ where: { submissionId: w.id } });
    expect((await act(s.testId, "dispute-side", s.dev.cookie, { disputeId: d1.id, text: "They skipped half of it", seenAt: seen(), confirmed: true })).status).toBe(200);
    // Disputing the second piece with a page opened after the stop that predates the developer's side: stops once for it, then goes through.
    const afterStop = await later().then(() => seen());
    await db.dispute.update({ where: { id: d1.id }, data: { devSideAt: new Date(Date.now() + 10) } });
    await later();
    const side = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: rec.id, reason: "The recording was fine really", seenAt: afterStop });
    expect(side.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane added their side to your dispute"]);
    const go = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: rec.id, reason: "The recording was fine really", seenAt: afterStop, confirmed: true, boxAt: seen() });
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    // Disputing the first piece again: final.
    expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: w.id, reason: "Again, please look", seenAt: seen(), confirmed: true })).body.error.message).toMatch(/already disputed/);
  });

  it("Rate: an open dispute blocks it until the team decides (final)", async () => {
    const { dev, tester, sessionId, testId, written } = await paidBelowListing();
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: written.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true });
    const r = await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "ok", seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("Rating opens once the team decides your dispute.");
  });
});
