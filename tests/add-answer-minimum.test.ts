import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { tagMarker } from "@/lib/answerAttachments";
import { addTo, joined, sact, setup } from "./fixtures";

afterEach(() => vi.unstubAllEnvs());

async function sent() {
  vi.stubEnv("ANSWER_MIN_CHARS", "50");
  const w = await setup();
  const j = await joined(w.testId, "Addition Tester", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a".repeat(50), "b".repeat(50)] })).status).toBe(200);
  return { ...w, ...j };
}

describe("Add to this answer: 50 characters per addition", () => {
  it("rejects 49 without storing an addition, accepts 50, and checks each later addition independently", async () => {
    const w = await sent();
    const short = await addTo(w.sessionId, w.tester.cookie, { text: "x".repeat(49), confirmed: true });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatchObject({ code: "too_short", message: "Write at least 50 characters (49 so far)." });
    const before = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: w.sessionId, kind: "written" } } });
    expect(before.additions).toEqual([]);
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "x".repeat(50), confirmed: true })).status).toBe(200);
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "y".repeat(49), confirmed: true })).status).toBe(400);
    const after = await db.submission.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.additions).toHaveLength(1);
  });

  it("does not let whitespace, formatting marks or attachment markers satisfy the minimum", async () => {
    const w = await sent();
    for (const text of [`  ${"x".repeat(49)}  `, `**${"x".repeat(49)}**`, `${"x".repeat(49)} ${tagMarker("test", "a-long-attachment-name.png")}`]) {
      const r = await addTo(w.sessionId, w.tester.cookie, { text, confirmed: true });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("too_short");
    }
    expect((await addTo(w.sessionId, w.tester.cookie, { text: `**${"x".repeat(50)}**`, confirmed: true })).status).toBe(200);
  });
});
