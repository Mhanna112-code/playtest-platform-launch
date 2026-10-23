import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NOT_REQUIRED } from "@/lib/questions";
import { joined, sact, setup } from "./fixtures";

// (Owner, Oct 23, NEWEST+8) Optional questions: Send requires only the required ones.
describe("optional questions", () => {
  it("a 'not required' question may stay empty; a required one may not", async () => {
    const { testId } = await setup({ questions: ["What did you like?", NOT_REQUIRED + "Anything else?"] });
    const { tester, sessionId } = await joined(testId);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).questions).toEqual(["What did you like?", NOT_REQUIRED + "Anything else?"]);
    const bad = await sact(sessionId, "written", tester.cookie, { answers: ["", "Lots"] });
    expect(bad.body.error).toMatchObject({ code: "bad_answers", message: "Answer every required question before sending." });
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["The sailing", ""] })).status).toBe(200);
  });
});
