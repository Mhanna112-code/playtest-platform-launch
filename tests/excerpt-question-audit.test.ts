import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { requestExcerpt, decideExcerpt, pendingForDeveloper, shownExcerpts } from "@/lib/server/excerpts";
import { act, joined, sact, seen, setup } from "./fixtures";
import { json, req } from "./helpers";

describe("excerpt audit: original questions survive listing changes", () => {
  it("a pending quote keeps its original question and can still be allowed after the listing questions change", async () => {
    const w = await setup();
    const j = await joined(w.testId, "Excerpt Tester", "they");
    const answer = "The harbour level felt great, but the second bridge was difficult to navigate.";
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [answer, answer] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await json(await reviewPOST(req("/api/review", { cookie: w.dev.cookie, body: { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })))).status).toBe(200);
    const quote = await requestExcerpt(j.tester.user, { submissionId: sub.id, index: 0, text: "The harbour level felt great" });
    const before = (await pendingForDeveloper(w.dev.user.id, w.testId))[0];
    const listing = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    expect((await act(w.testId, "edit", w.dev.cookie, { fields: { questions: ["What should we improve next?"] }, version: listing.version, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await pendingForDeveloper(w.dev.user.id, w.testId))[0]).toMatchObject({ id: quote.id, question: before.question, text: before.text });
    await decideExcerpt(w.dev.user, { excerptId: quote.id, decision: "allow", seenAt: seen(), confirmed: true });
    expect((await shownExcerpts(j.tester.user.id)).some((x) => x.id === quote.id)).toBe(true);
  });
});
