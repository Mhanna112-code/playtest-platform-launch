import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("the tester's one set of stop-once reasons", () => {
  it("the developer paying any of their work stops Leave and Request a time once; the second press goes ahead", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const pageLoaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    for (const [action, body] of [["request-time", { startsAt: atHours(48) }], ["leave", {}]] as const) {
      const r = await sact(sessionId, action, tester.cookie, { ...body, seenAt: pageLoaded });
      expect(r.body.error.code).toBe("stop_once");
      expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain("Nora Lane paid $10.00 for your written answers");
    }
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(48), seenAt: pageLoaded, confirmed: true })).status).toBe(200);
  });

  it("a developer's call request stops Dispute too", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" });
    const pageLoaded = seen();
    await later();
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(72) });
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question", seenAt: pageLoaded });
    expect(d.body.error.changes[0].text).toMatch(/^Nora Lane requested a call for /);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question", seenAt: pageLoaded, confirmed: true })).status).toBe(200);
  });

  it("final refusals stay final (ended early beats the stop-once box)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await later();
    await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractId: sessionId, reason: "We have enough" });
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded });
    expect(r.body.error.message).toContain("ended your session early");
  });

  it("no 'ask to leave' or 'ask to end early' anywhere", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    expect(walk(path.resolve(__dirname, "../src")).filter((f) => /ask (them )?to (leave|end)/i.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });
});
