import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { GET as liveGET } from "@/app/api/live/route";
import { seenNow, setShownOnPage, clearShown } from "@/lib/live";
import { req, json } from "./helpers";
import { act, addTo, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §155; narrows §79) Pay, Pay more and Confirm with your bank on a piece stop once for that piece's own changes the page hasn't shown
// ("sent their …", "added to …"), like any other unseen change; one the page already showed (redrawn, the pill, the top box) never stops. Presses that answer a
// request or offer (Accept on a call request, …) keep §79.
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const pay10 = { kind: "submission", amount: "10.00", tickedCents: 1000 };

describe("batch 35 §155: Pay, Pay more and Confirm stop once for their own part's unseen changes", () => {
  it("Pay on a page from before the tester sent: stops once naming the send; the second press pays", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    const loaded = seen(); await settle();
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const first = await pay(dev.cookie, { ...pay10, id: sub.id, seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual(["Ana Silva sent their written answers"]);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    const second = await pay(dev.cookie, { ...pay10, id: sub.id, seenAt: loaded, confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await db.review.findFirstOrThrow({ where: { submissionId: sub.id } })).amountCents).toBe(1000);
  });

  it("an addition the page hasn't shown stops Pay once naming it; the second press pays for the whole piece, with no 'added after you paid'", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    await settle();
    const loaded = seen(); await settle(); // the page shows the answers as sent
    expect((await addTo(sessionId, tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const first = await pay(dev.cookie, { ...pay10, id: sub.id, seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^Ana Silva added to their answer to “/)]);
    expect((await pay(dev.cookie, { ...pay10, id: sub.id, seenAt: loaded, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    // The addition was before the Pay: it's paid with the piece, not an update waiting for Pay more.
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).paidUpdateAt).toBeNull();
  });

  it("an addition the page already showed (the live check's lines: redraw or pill) doesn't stop Pay", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "one more thing", confirmed: true })).status).toBe(200);
    await settle();
    // The page's live check picks the addition up and shows it (LiveTop: setShownOnPage with the check's time): the press's seen marker moves on.
    const scope = `test:${testId}`;
    const live = (await json(await liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(loaded)}`, { cookie: dev.cookie })))).body as { changes: { text: string }[]; now: string };
    expect(live.changes.map((c) => c.text)).toContainEqual(expect.stringMatching(/^Ana Silva added to their answer to “/));
    setShownOnPage(scope, live.now);
    const seenAt = seenNow(loaded);
    clearShown(scope);
    expect(seenAt).toBe(live.now);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const r = await pay(dev.cookie, { ...pay10, id: sub.id, seenAt });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("Pay more: an addition after the Pay that the page hasn't shown stops once; one it showed goes straight through", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { ...pay10, id: sub.id, confirmed: true })).status).toBe(200);
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "more", confirmed: true })).status).toBe(200);
    const more = { contractId: sessionId, submissionId: sub.id, amount: "1.00", tickedCents: 100, seenAt: loaded };
    const first = await act(testId, "pay-extra", dev.cookie, more);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^Ana Silva added to their answer to “/)]);
    expect((await act(testId, "pay-extra", dev.cookie, { ...more, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    // A second addition, shown on the page before the press (its seen time is after it): Pay more goes through at once.
    await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "and more", confirmed: true })).status).toBe(200);
    await settle();
    expect((await act(testId, "pay-extra", dev.cookie, { ...more, seenAt: seen() })).status).toBe(200);
  });

  it("Confirm with your bank on the piece: an unseen addition stops it once naming it; the second press opens the check", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.review.create({ data: { contractId: sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    const payment = await db.payment.create({ data: { kind: "review", contractId: sessionId, submissionId: sub.id, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_test", actionBy: new Date(Date.now() + 60000) } });
    await settle();
    const loaded = seen(); await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "more", confirmed: true })).status).toBe(200);
    const start = async (body: Record<string, unknown>) => json(await confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, body: { paymentId: payment.id, start: true, ...body } })));
    // (Owner, Nov 11, §380 C) Confirm with your bank stops only for a pause or its lift: an unseen addition no longer stops it.
    const first = await start({ seenAt: loaded });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("§79 kept for answering presses: Accept on a call request that just arrived goes through", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    await settle();
    const loaded = seen(); await settle();
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    const ok = await act(testId, "answer-request", dev.cookie, { seenAt: loaded, contractId: sessionId, requestId: r.id, action: "accept" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
