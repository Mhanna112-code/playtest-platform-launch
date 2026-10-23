import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { termsDiff } from "@/lib/rules";
import { rateWarning } from "@/lib/server/ratings";
import { act, joined, setup } from "./fixtures";

// (Owner, Oct 23, NEWEST+10) Required parts = a label only.
describe("required parts", () => {
  it("part of the terms: snapshotted at join, a change is a terms change; blocks nothing; the rating warning says (required)", async () => {
    const { dev, testId } = await setup({ writtenRequired: true });
    const { tester, sessionId } = await joined(testId);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect([c.writtenRequired, c.recordingRequired, c.liveRequired]).toEqual([true, false, false]);
    expect(termsDiff({ ...c, questions: [] }, { ...c, questions: [], writtenRequired: false, liveRequired: true })).toBe("written answers now not required, the live call now required");
    // An Edit of Required offers the new terms to working testers.
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "edit", dev.cookie, { version: t.version, fields: { liveRequired: true }, confirmed: true })).status).toBe(200);
    expect((await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } })).diff).toBe("the live call now required");
    // Nothing is blocked: the warning just marks the unsent required part.
    expect((await rateWarning(sessionId)).lines[0]).toBe("Not sent yet from your contract: written answers ($8) (required) — it won't be paid.");
    expect(tester).toBeTruthy();
  });
});
