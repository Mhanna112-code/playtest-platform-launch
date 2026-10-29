import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as keptPOST } from "@/app/api/kept/route";
import { LIMITS } from "@/lib/limits";
import { itemsOf, prevSetsOf } from "@/lib/answerSets";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";
import { pay, sentWork } from "./b15";

// Batch 15 sections 3, 17, 20 and 22: long questions and steps; reasons and notes up to 1,000 (never cut), never in a bell line; End early's reason.
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);

describe("long questions and steps (sections 3 and 17)", () => {
  it("20 questions of 20,000 characters and 20,000 characters of steps: posted, sent, switched and kept", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const qs = Array.from({ length: 20 }, (_, i) => `Q${i + 1} ` + "x".repeat(20_000 - 2 - String(i + 1).length));
    expect(qs.every((q) => q.length === 20_000)).toBe(true);
    const post = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ questions: qs, description: "s".repeat(20_000) }) })));
    expect(post.status).toBe(200);
    const testId = post.body.id as string;
    await settle();
    const { tester, sessionId } = await joined(testId);
    // Sent: the answer set keeps the full question texts.
    expect((await sact(sessionId, "written", tester.cookie, { answers: qs.map((_, i) => `answer ${i}`) })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(itemsOf(sub.answers).map((x) => x.question.length)).toEqual(Array(20).fill(20_000));
    // Switched: the developer changes Q2; the tester switches; the earlier set is kept in full.
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const next = [...qs];
    next[1] = "Q2 changed " + "y".repeat(19_000);
    const e = await act(testId, "edit", dev.cookie, { version: t.version, seenAt: seen(), confirmed: true, fields: { questions: next } });
    expect(e.body).toMatchObject({ offered: 1 });
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true })).status).toBe(200);
    const after = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(prevSetsOf(after.prevSets)[0].items.map((x) => x.question.length)).toEqual(Array(20).fill(20_000));
    // The sent set still answers its own (old) questions, in full.
    expect(itemsOf((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).answers)[1].question).toBe(qs[1]);
    // Kept: a Post draft with all of it fits.
    const kept = await json(await keptPOST(req("/api/kept", { cookie: dev.cookie, body: { key: `test:new`, data: { questions: qs.join("\n"), description: "s".repeat(20_000) } } })));
    expect(kept.status).toBe(200);
  }, 120_000);

  it("one character more is refused at the field: questions, steps", async () => {
    const dev = await makeUser({ dev: true });
    const q = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ questions: ["q".repeat(LIMITS.question + 1)] }) })));
    expect(q.body.error.message).toContain("Keep each question to 20,000 characters.");
    const s = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ description: "s".repeat(LIMITS.whatToDo + 1) }) })));
    expect(s.body.error.message).toContain("Keep What to do to 20,000 characters.");
  });
});

describe("reasons and notes (section 20)", () => {
  it("1,000 characters; one more is refused at the field, never cut", async () => {
    const a = await admin();
    const { testId } = await setup();
    expect((await aact(a.cookie, "stop-test", { id: testId, note: "r".repeat(1001) })).body.error).toMatchObject({ code: "bad_note", message: "Keep it to 1,000 characters." });
    expect((await aact(a.cookie, "stop-test", { id: testId, note: "r".repeat(1000) })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).adminNote).toHaveLength(1000);
    const w = await sentWork();
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "n".repeat(1001) });
    expect(r).toMatchObject({ status: 400, body: { error: { message: "Keep it to 1,000 characters." } } });
  });

  it("no bell line carries a reason, a note, a dispute's text or a message (the emails do)", async () => {
    const MARK = `zq${randomUUID().slice(0, 8)}`;
    const a = await admin();
    const w = await sentWork();
    // A Pay with a note, below the listing.
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: `Half done ${MARK}` })).status).toBe(200);
    // A dispute with its text; the team's decision with a note.
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: `I answered all ${MARK} of it`, seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    expect((await aact(a.cookie, "decide", { id: d.id, total: "", note: `Kept ${MARK}` })).status).toBe(200);
    // A chat message.
    expect((await sact(w.sessionId, "message", w.tester.cookie, { body: `Hello ${MARK}` })).status).toBe(200);
    // End early with a reason; the team pausing and stopping another test with notes.
    const two = await setup();
    const j = await joined(two.testId);
    expect((await act(two.testId, "end-early", two.dev.cookie, { contractIds: [j.sessionId], reason: `Enough ${MARK}`, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await aact(a.cookie, "pause-test", { id: two.testId, note: `Checking ${MARK}` })).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: two.testId, note: `Broken ${MARK}` })).status).toBe(200);
    expect(await db.notification.count({ where: { text: { contains: MARK } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: two.dev.user.id, text: `The team stopped “Harbor Run”` } })).toBe(1);
    expect(await db.notification.count({ where: { userId: two.dev.user.id, text: `The team paused “Harbor Run”` } })).toBe(1);
  });
});

describe("End early's reason (section 22)", () => {
  it("required (at least 5 characters since batch 20 section 27), at most 10,000; testers read it on the session page and in the email", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    const go = (reason: string) => act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason, seenAt: seen(), confirmed: true });
    expect((await go("   ")).body.error.message).toBe("Say why you're ending their work (they read it).");
    expect((await go("w".repeat(10_001))).body.error.message).toBe("Keep it to 10,000 characters.");
    // (Batch 20 section 27) At least 5 characters now.
    expect((await go("x")).body.error.message).toBe("Say a little more: at least 5 characters.");
    expect((await go("Thanks")).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endReason).toBe("Thanks");
  });
});
