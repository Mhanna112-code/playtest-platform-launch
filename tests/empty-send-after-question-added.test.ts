import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ANSWER_ONE } from "@/lib/questions";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Dec 10 2026, live test) After Nora added a question, Ana's Send Answers with every open box empty was saved as an empty addition: the page showed
// "Answer at least one question …" (red) and "Sent your answers." together, and the part's pay-by moved to 7 days from that press (the review clock restarted).
// Cause: formMistakes treated ANY question change as a pre-§265 switch (`setUntil`) and dropped "at least one". Now only `setUntil` parts skip it.

const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const LONG = "The second bridge had no sign, so I sailed around it twice before finding the way.";
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  await settle();
  return r;
};
const written = (contractId: string) => db.submission.findFirstOrThrow({ where: { contractId, kind: "written" } });

describe("an empty Send after Nora adds a question", () => {
  it("is refused with “Answer at least one question …”; nothing is saved and the pay-by doesn't move", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: [LONG, LONG], for: [Q1, Q2] })).status).toBe(200);
    const before = await written(j.sessionId);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q3] })).status).toBe(200);
    // The form after a send holds only the open question (Q3), left empty.
    const r = await send(j.sessionId, j.tester.cookie, { answers: [""], for: [Q3] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe(ANSWER_ONE);
    const after = await written(j.sessionId);
    expect(after.payBy?.getTime()).toBe(before.payBy?.getTime());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.additions ?? []).toEqual(before.additions ?? []);
  });

  it("answering the new question still goes through as an addition", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: [LONG, LONG], for: [Q1, Q2] })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q3] })).status).toBe(200);
    expect((await send(j.sessionId, j.tester.cookie, { answers: [LONG], for: [Q3] })).status).toBe(200);
    const adds = (await written(j.sessionId)).additions as unknown[];
    expect(adds).toHaveLength(1);
  });

  it("an old part switched before §265 (setUntil) may still Send with no new answer", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: [LONG, LONG], for: [Q1, Q2] })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q3] })).status).toBe(200);
    await db.submission.updateMany({ where: { contractId: j.sessionId, kind: "written" }, data: { setUntil: new Date() } });
    expect((await send(j.sessionId, j.tester.cookie, { answers: [""], for: [Q3] })).status).toBe(200);
  });
});
