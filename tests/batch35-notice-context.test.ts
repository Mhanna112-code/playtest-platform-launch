import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fmtDateTimeIn } from "@/lib/format";
import { testerChanges } from "@/lib/server/testerGate";
import { testerPaymentChanges } from "@/lib/server/live";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup, settle } from "./fixtures";

describe("blue notices identify the person and work they describe", () => {
  it("a cancelled call names its developer and time in both the stop box and final refusal", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const call = await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie);
    await settle();
    const loaded = seen();
    await settle();
    expect((await act(f.testId, "cancel-call", f.dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    const lines = await testerChanges(j.tester.user.id, j.sessionId, f.testId, new Date(loaded));
    expect(lines.filter((x) => x.kind === "cancelled").map((x) => x.text)).toEqual([`Your call with Nora Lane on ${fmtDateTimeIn(call.startsAt, "UTC")} was cancelled`]);
    const refused = await sact(j.sessionId, "cancel-call", j.tester.cookie, { callId: call.id, seenAt: seen() });
    expect(refused.body.error).toMatchObject({ code: "cancelled", message: "This call was already cancelled." }); // (§364 item 13; the stop box above still names who and when)
  });

  it("a system cancellation names the other person without attributing the cancellation to them", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const call = await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie);
    const at = new Date();
    await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: at } });
    const lines = await testerChanges(j.tester.user.id, j.sessionId, f.testId, new Date(at.getTime() - 1));
    expect(lines.find((x) => x.kind === "cancelled")?.text).toBe(`Your call with Nora Lane on ${fmtDateTimeIn(call.startsAt, "UTC")} was cancelled`);
  });

  it("a dispute decision identifies the written part", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 400, agreedCents: 1000, payKey: randomUUID() } });
    const at = new Date();
    await db.dispute.create({ data: { contractId: j.sessionId, submissionId: sub.id, testerId: j.tester.user.id, reason: "All questions answered", status: "decided", decidedAt: at, decidedCents: 800 } });
    const lines = await testerPaymentChanges(j.tester.user.id, j.sessionId, new Date(at.getTime() - 1));
    expect(lines.find((x) => x.kind === "admin")?.text).toBe("The team decided your dispute with Nora Lane about your written answers: the pay was raised to $8.00");
  });

  it("a live-call dispute decision identifies which call", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const call = await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie);
    await db.review.create({ data: { contractId: j.sessionId, callId: call.id, amountCents: 400, agreedCents: 1500, payKey: randomUUID() } });
    const at = new Date();
    await db.dispute.create({ data: { contractId: j.sessionId, callId: call.id, testerId: j.tester.user.id, reason: "Full call attended", status: "decided", decidedAt: at, decidedCents: 400 } });
    const lines = await testerPaymentChanges(j.tester.user.id, j.sessionId, new Date(at.getTime() - 1));
    expect(lines.find((x) => x.kind === "admin")?.text).toBe(`The team decided your dispute with Nora Lane about your live call on ${fmtDateTimeIn(call.startsAt, "UTC")}: the pay stays at $4.00`);
  });

  it("another tab's request names the developer", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const response = await sact(j.sessionId, "request-time", j.tester.cookie, { startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), minutes: 30, seenAt: seen(), confirmed: true, tab: "other-tab" });
    expect(response.status).toBe(200);
    const log = await db.actionLog.findFirstOrThrow({ where: { userId: j.tester.user.id, testId: f.testId }, orderBy: { createdAt: "desc" } });
    expect(log.text).toContain("requested a call with Nora Lane for");
  });

  it("an already-paid refusal identifies the tester and part", async () => {
    const f = await setup();
    const j = await joined(f.testId, "Ben Carter");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 800, agreedCents: 1000, payKey: randomUUID() } });
    const response = await json(await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })));
    expect(response.body.error).toMatchObject({ code: "reviewed", message: "You already paid $8.00 for Ben Carter's written answers." });
  });

  it("already-paid refusals distinguish two calls with the same tester", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const calls = [await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie, 48), await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie, 72)];
    const reasons: string[] = [];
    for (let index = 0; index < calls.length; index++) {
      const startsAt = new Date(Date.now() - (index + 1) * 86_400_000);
      await db.call.update({ where: { id: calls[index].id }, data: { startsAt, measuredMinutes: 30, measuredAt: new Date() } });
      await db.review.create({ data: { contractId: j.sessionId, callId: calls[index].id, amountCents: 800, agreedCents: 1500, payKey: randomUUID() } });
      const response = await json(await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { kind: "call", id: calls[index].id, amount: "15.00", tickedCents: 1500, payKey: randomUUID(), seenAt: seen(), confirmed: true } })));
      expect(response.body.error).toMatchObject({ code: "reviewed", message: `You already paid $8.00 for Ana Silva's live call on ${fmtDateTimeIn(startsAt, "UTC")}.` });
      reasons.push(response.body.error.message);
    }
    expect(reasons[0]).not.toBe(reasons[1]);
  });
});
