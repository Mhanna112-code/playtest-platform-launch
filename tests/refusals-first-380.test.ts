import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §380 DO) Refusals first: Dispute's final refusals (and then the soft ones) come before the stop-moment box and the red reason check; a call
// press's time clash comes before the stop-once box.

const later = () => new Promise((r) => setTimeout(r, 30));

describe("§380 DO: Dispute", () => {
  it("a part not paid yet: the refusal, never the red reason line or a stop box (a change the page hadn't shown)", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const pageAt = seen();
    await later();
    // Something the page hadn't shown: the test was stopped and resumed? A simpler unseen change: the developer renamed the test.
    expect((await act(s.testId, "edit", s.dev.cookie, { version: 1, fields: { title: "Harbor Run 2" }, seenAt: seen(), confirmed: true })).status).toBeLessThan(500);
    await settle();
    const r = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "short", seenAt: pageAt });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("This hasn't been paid yet.");
    expect(r.body.error.code).not.toBe("stop_once");
  });

  it("an open new-terms offer (soft) still comes after the final refusals, and the red reason check after every refusal", async () => {
    const src = (await import("node:fs")).readFileSync((await import("node:path")).resolve(__dirname, "../src/lib/server/payments.ts"), "utf8");
    const body = src.slice(src.indexOf("async function openDisputeOnce"), src.indexOf("// (§369) What this press saw"));
    expect(body.indexOf("const left = await disputable(review);")).toBeLessThan(body.indexOf("answerTermsFirst(contractId, q)"));
    expect(body.indexOf("if (refusalsOnly) return null;")).toBeLessThan(body.indexOf('throw new HttpError(400, "bad_reason"'));
    const route = (await import("node:fs")).readFileSync((await import("node:path")).resolve(__dirname, "../src/app/api/sessions/[id]/[action]/route.ts"), "utf8");
    expect(route.indexOf("disputeRefusalsFirst(u, id, body)")).toBeLessThan(route.indexOf("await stateMoment(id, action, body);"));
    expect(route.indexOf("disputeRefusalsFirst(u, id, body)")).toBeLessThan(route.indexOf("await ndaBlockFirst(id);"));
  });
});

describe("§380 DO: a call press's time clash comes before the stop-once box", () => {
  it("the tester's Request a time at a time they already have a call at, on a page with a change it hadn't shown: the clash, never a box", async () => {
    const a = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const ja = await act(a.testId, "join", t.cookie, { listingVersion: 1 });
    expect(ja.status).toBe(200);
    await settle();
    const T = atHours(60);
    expect((await act(a.testId, "request-time", a.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [ja.body.sessionId], startsAt: T })).status).toBe(200);
    const qa = await db.callRequest.findFirstOrThrow({ where: { contractId: ja.body.sessionId as string, fromSide: "developer", status: "pending" } });
    expect((await sact(ja.body.sessionId as string, "answer-request", t.cookie, { requestId: qa.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const b = await setup();
    const jb = await act(b.testId, "join", t.cookie, { listingVersion: 1 });
    await settle();
    const pageAt = seen();
    await later();
    // A change the page hadn't shown: test B's developer asked for another time.
    expect((await act(b.testId, "request-time", b.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [jb.body.sessionId], startsAt: atHours(90) })).status).toBe(200);
    await settle();
    const r = await sact(jb.body.sessionId as string, "request-time", t.cookie, { startsAt: T, seenAt: pageAt });
    expect(r.status).toBe(409);
    expect(r.body.error.code, JSON.stringify(r.body)).toBe("clash");
    expect(r.body.error.message).toMatch(/^You have a call with Nora Lane then/);
  });
});
