import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { asPressRefusal, ownBlockCause } from "@/lib/refusal";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §380 H) A refusal caused by a block YOU made: "You blocked {name}, so your {button} didn't go through." The other person's block keeps the
// neutral lines.

const block = (cookie: string, userId: string) => blocksPOST(req("/api/blocks", { cookie, body: { userId } })).then(json);

describe("§380 H: your own block names itself", () => {
  it("the pattern; join refusals written without a press are named with it", () => {
    expect(ownBlockCause("Nora Lane")).toBe("You blocked Nora Lane");
    expect(asPressRefusal("You blocked Nora Lane.", "Apply")).toBe("You blocked Nora Lane, so your Apply didn't go through.");
  });

  it("the tester's call presses after their own block: Request a time; the developer's request answered; the developer's Request a time after theirs", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    // The developer asks for a time; then the tester blocks the developer.
    expect((await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [j.sessionId], startsAt: atHours(60) })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, fromSide: "developer" } });
    await settle();
    expect((await block(j.tester.cookie, s.dev.user.id)).status).toBe(200);
    const mine = await sact(j.sessionId, "request-time", j.tester.cookie, { startsAt: atHours(50), seenAt: seen() });
    expect(mine.body.error.message).toBe("You blocked Nora Lane, so your Request a time didn't go through.");
    const answer = await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: r.id, action: "accept", seenAt: seen() });
    expect(answer.body.error.message).toBe("You blocked Nora Lane, so your Accept didn't go through.");
    // The developer (blocked, not blocking): the neutral line.
    const dev = await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [j.sessionId], startsAt: atHours(70) });
    expect(dev.body.error.message).toBe("Ana Silva's session has ended, so your Request a time didn't go through.");
  });

  it("the developer's own block: Request a time and the tester's request answered", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "request-time", j.tester.cookie, { startsAt: atHours(50), seenAt: seen() })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, fromSide: "tester" } });
    await settle();
    expect((await block(s.dev.cookie, j.tester.user.id)).status).toBe(200);
    const dev = await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [j.sessionId], startsAt: atHours(70) });
    expect(dev.body.error.message).toBe("You blocked Ana Silva, so your Request a time didn't go through.");
    const answer = await act(s.testId, "answer-request", s.dev.cookie, { contractId: j.sessionId, requestId: r.id, action: "accept", seenAt: seen() });
    expect(answer.body.error.message).toBe("You blocked Ana Silva, so your Accept didn't go through.");
    // The tester (blocked): their own part ended, the neutral line.
    expect((await sact(j.sessionId, "request-time", j.tester.cookie, { startsAt: atHours(52), seenAt: seen() })).body.error.message).toBe("Your part in this test has ended, so your Request a time didn't go through.");
  });

  it("Apply and Accept: each person's own block, the other's neutral", async () => {
    const s = await setup({ joinMode: "apply", spots: 5 });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(s.testId, "apply", t.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true })).status).toBe(200);
    const app = await db.application.findFirstOrThrow({ where: { testId: s.testId, testerId: t.user.id } });
    // A block row written straight (the application stays pending): the developer's own.
    await db.block.create({ data: { blockerId: s.dev.user.id, blockedId: t.user.id } });
    expect((await act(s.testId, "application", s.dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).body.error.message).toBe("You blocked Ana Silva, so your Accept didn't go through.");
    await db.block.deleteMany({ where: { blockerId: s.dev.user.id } });
    // The tester's block: the developer reads the neutral line.
    await db.block.create({ data: { blockerId: t.user.id, blockedId: s.dev.user.id } });
    expect((await act(s.testId, "application", s.dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).body.error.message).toBe("Ana Silva's application was closed.");
    // The tester's own Apply on another of the developer's tests.
    const other = await setup({ joinMode: "apply", spots: 5 });
    await db.test.update({ where: { id: other.testId }, data: { developerId: s.dev.user.id } });
    expect((await act(other.testId, "apply", t.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true })).body.error.message).toBe("You blocked Nora Lane, so your Apply didn't go through.");
  });
});

describe("§380 I: silent when a block already did it", () => {
  it("Leave on a part a block ended (either way): silent", async () => {
    for (const by of ["tester", "developer"] as const) {
      const s = await setup();
      const j = await joined(s.testId);
      expect((await (by === "tester" ? block(j.tester.cookie, s.dev.user.id) : block(s.dev.cookie, j.tester.user.id))).status).toBe(200);
      const r = await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true });
      expect(r.status, by).toBe(200);
      expect(r.body.already, by).toBe(true);
    }
  });
});
