import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dropHiddenPartFields, type Listing } from "@/lib/rules";
import { act, joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §349; audit E5 / E5b) Edit: tick Written answers, change the questions (and its Required tick), untick Written, Save. The hidden questions and
// Required tick were stored and announced ("The listing was edited: written answers required, questions" and the tester's "… changed the questions").
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const version = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version, fields, seenAt: seen(), confirmed: true, payRulesOk: true });
};

describe("§349 an unticked part's hidden fields are neither saved nor announced", () => {
  it("the rule", () => {
    const current = { writtenCents: null, recordingCents: 1000, liveRateCents: null, questions: [], writtenRequired: false, recordingRequired: true, liveRequired: false, liveMinutes: 30 } as unknown as Listing;
    const touched: Partial<Listing> = { writtenCents: null, questions: ["What did you like?"], writtenRequired: true, liveRequired: true, liveMinutes: 45, recordingRequired: false };
    expect(dropHiddenPartFields(current, touched)).toEqual({ writtenCents: null, recordingRequired: false });
    // A part ticked by this Save keeps its fields.
    expect(dropHiddenPartFields(current, { writtenCents: 500, questions: ["Q"] })).toEqual({ writtenCents: 500, questions: ["Q"] });
  });

  it("E5 / E5b on the server: the Save goes through, saves and announces nothing about the written part", async () => {
    const { dev, testId } = await setup({ writtenCents: null, recordingCents: "10.00", questions: [] });
    const { tester } = await joined(testId, "Ana Silva", "she");
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const since = new Date();
    await settle();
    const r = await edit(testId, dev.cookie, { writtenCents: null, questions: ["What did you like?", "What would you change?"], writtenRequired: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.changed ?? []).not.toEqual(expect.arrayContaining(["questions"]));
    expect(JSON.stringify(r.body.changed ?? [])).not.toMatch(/questions|written answers required/);
    const t1 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(t1.questions).toEqual(t0.questions);
    expect(t1.writtenRequired).toBe(t0.writtenRequired);
    const lines = (await db.notification.findMany({ where: { userId: tester.user.id, createdAt: { gte: since } } })).map((n) => n.text).join("\n");
    expect(lines).not.toMatch(/questions|edited the listing|updated the listing/);
    expect(await db.testEvent.count({ where: { testId, createdAt: { gte: since }, text: { contains: "questions" } } })).toBe(0);
  });
});
