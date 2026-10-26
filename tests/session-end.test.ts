import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { json, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (Owner, Oct 26) A stopped test / ended work while the session page is open: a live-box line, then a FINAL blue refusal for every press.
const live = (cookie: string, scope: string, since: string) => liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie })).then(json);

describe("session page after the test is stopped or the work is ended", () => {
  it("stopped: a live line, and Send, Switch / Keep, call actions and Request all refuse with the stopped line (not a stop-once)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const opened = seen();
    // An offer waiting, a request from the developer, and a booked call.
    await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { writtenCents: "12.00" } });
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(60) });
    const reqRow = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "pending" } });
    expect((await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);

    const lines = (await live(tester.cookie, `session:${sessionId}`, opened)).body.changes.map((c: { text: string }) => c.text);
    expect(lines).toContain("Nora Lane stopped the test");
    const STOPPED = /^Nora Lane stopped the test on .+\. Work you sent is still reviewed\.$/;
    const refused = async (action: string, body: Record<string, unknown>) => {
      const r = await sact(sessionId, action, tester.cookie, { seenAt: opened, ...body });
      expect(r.status, action).toBe(409);
      expect(r.body.error.code, action).toBe("gone");
      expect(r.body.error.message, action).toMatch(STOPPED);
    };
    await refused("written", { answers: ["a", "b"] });
    await refused("terms", { offerId: offer.id, choice: "switch" });
    await refused("terms", { offerId: offer.id, choice: "keep" });
    await refused("answer-request", { requestId: reqRow.id, action: "accept" });
    await refused("request-time", { startsAt: atHours(80) });
    await refused("recording-start", { filename: "a.webm", size: 10, contentType: "video/webm" });
    // Pressing again never "goes ahead": it's final.
    await refused("written", { answers: ["a", "b"], confirmed: true });
  });

  it("ended early: the live line says so, later presses refuse with the ended line", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const opened = seen();
    expect((await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have enough" })).status).toBe(200);
    expect((await live(tester.cookie, `session:${sessionId}`, opened)).body.changes.map((c: { text: string }) => c.text)).toContain("Nora Lane ended your work");
    const r = await sact(sessionId, "written", tester.cookie, { seenAt: opened, answers: ["a", "b"] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/ended your session early/);
  });
});
