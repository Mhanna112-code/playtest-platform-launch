import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NOT_REQUIRED, REQUIRED } from "@/lib/questions";
import { joined, sact, setup } from "./fixtures";

// (Owner, Oct 23, NEWEST+8) Optional questions: Send requires only the required ones. (Batch 26 section 14) Not required is the default now: a question is required
// only when ticked ("[required] " in front); sending needs at least one answer.
describe("optional questions", () => {
  it("a not-required question may stay empty; a Required one may not; the old marker is dropped on Post", async () => {
    const { testId } = await setup({ questions: [REQUIRED + "What did you like?", NOT_REQUIRED + "Anything else?"] });
    const { tester, sessionId } = await joined(testId);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).questions).toEqual([REQUIRED + "What did you like?", "Anything else?"]);
    const bad = await sact(sessionId, "written", tester.cookie, { answers: ["", "Lots"] });
    expect(bad.body.error).toMatchObject({ code: "bad_answers", message: "Answer every required question before sending.", missing: 0 });
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["The sailing", ""] })).status).toBe(200);
  });
});
