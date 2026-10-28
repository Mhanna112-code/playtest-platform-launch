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
    // (Batch 16 section 24) The refusal names the press, and sends the page to its top ("work_over").
    const STOPPED = (press: string) => new RegExp(`^Nora Lane stopped the test on .+, so your ${press} didn't go through\. Work you sent is still reviewed\.$`);
    const refused = async (action: string, body: Record<string, unknown>, press: string) => {
      const r = await sact(sessionId, action, tester.cookie, { seenAt: opened, ...body });
      expect(r.status, action).toBe(409);
      expect(r.body.error.code, action).toBe("work_over");
      expect(r.body.error.message, action).toMatch(STOPPED(press));
    };
    await refused("written", { answers: ["a", "b"] }, "Send");
    await refused("terms", { offerId: offer.id, choice: "switch" }, "Switch");
    await refused("terms", { offerId: offer.id, choice: "keep" }, "Keep");
    await refused("answer-request", { requestId: reqRow.id, action: "accept" }, "Accept");
    await refused("request-time", { startsAt: atHours(80) }, "Request a time");
    await refused("recording-start", { filename: "a.webm", size: 10, contentType: "video/webm" }, "upload");
    // Pressing again never "goes ahead": it's final.
    await refused("written", { answers: ["a", "b"], confirmed: true }, "Send");
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
