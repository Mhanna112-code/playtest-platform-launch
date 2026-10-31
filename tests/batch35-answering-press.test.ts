import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { req, json } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 35 §79 (owner, Oct 31): a press never stops once for the line about the very thing it answers; every other unseen change still stops.
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);

describe("batch 35 §79: a press never stops for the change it answers", () => {
  it("the developer's Accept on a call request that just arrived goes through; another tester's request still stops it once", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await settle();
    const loaded = seen();
    await settle();
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const ra = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const ok = await act(testId, "answer-request", dev.cookie, { seenAt: loaded, contractId: a.sessionId, requestId: ra.id, action: "accept" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // Decline on Ben's request: his line is the one it answers; Ana's new request is another change and still stops it once.
    await settle();
    const loaded2 = seen();
    await settle();
    expect((await sact(b.sessionId, "request-time", b.tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(72), minutes: 30 })).status).toBe(200);
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(96), minutes: 30 })).status).toBe(200);
    const rb = await db.callRequest.findFirstOrThrow({ where: { contractId: b.sessionId } });
    const stop = await act(testId, "answer-request", dev.cookie, { seenAt: loaded2, contractId: b.sessionId, requestId: rb.id, action: "decline" });
    expect(stop.body.error?.code, JSON.stringify(stop.body)).toBe("stop_once");
    expect(texts(stop)).toEqual([expect.stringMatching(/^Ana Silva requested/)]);
  });

  it("Pay on a piece just sent goes through; another change since still stops it once", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await settle();
    const loaded = seen();
    await settle();
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sa = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const ok = await pay(dev.cookie, { kind: "submission", id: sa.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await settle();
    const loaded2 = seen();
    await settle();
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const sb = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    // Pay on Ben's piece: his "sent their written answers" is what it answers; Ana's new call request is another change and still stops it once.
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const stop = await pay(dev.cookie, { kind: "submission", id: sb.id, amount: "10.00", tickedCents: 1000, seenAt: loaded2 });
    expect(stop.body.error?.code, JSON.stringify(stop.body)).toBe("stop_once");
    expect(texts(stop)).toEqual([expect.stringMatching(/^Ana Silva requested/)]);
  });

  it("the tester's Accept on the developer's call request that just arrived goes through", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await settle();
    const loaded = seen();
    await settle();
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    const ok = await sact(sessionId, "answer-request", tester.cookie, { seenAt: loaded, requestId: r.id, action: "accept" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe("batch 35 §79 (extra): the developer's call rows don't repeat the tester's name", () => {
  it("the name heading shows only when a row doesn't start with the name", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(require("node:path").resolve(__dirname, "../src/app/app/tests/[id]/DevCallPanel.tsx"), "utf8");
    expect(src).toContain("{!rowsNamed(t) && <h3>{t.name}</h3>}");
    expect(src).toContain("{t.name} · {s.label}");
    expect(src).toMatch(/rowsNamed = \(t: DevTester\) => .*t\.requests\.every\(\(r\) => !r\.mine\)/);
  });
});
