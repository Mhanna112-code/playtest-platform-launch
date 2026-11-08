import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { chooseOutcome } from "@/lib/server/holds";
import * as terms from "@/lib/server/terms";
import { pay, sentWork } from "./b15";
import { seen, settle } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

describe("behavior audit: a payment landing during the Charge gate", () => {
  it("returns the final paid refusal rather than making the tester press Charge twice", async () => {
    const w = await sentWork();
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - 1000) } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 1000), choiceOfferedAt: new Date() } });
    const loaded = seen();
    const gate = terms.testerTermsGate;
    vi.spyOn(terms, "testerTermsGate").mockImplementationOnce(async (...args) => {
      await settle();
      const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "6.00", tickedCents: 600, reason: "The first section was useful." });
      expect(r.status).toBe(200);
      return gate(...args);
    });
    await expect(chooseOutcome(w.tester.user, w.sessionId, { submissionId: w.sub.id, choice: "charge", amount: "10.00", seenAt: loaded, loadedAt: loaded })).rejects.toMatchObject({ code: "done" });
    expect(await db.review.count({ where: { submissionId: w.sub.id } })).toBe(1);
    expect(await db.payment.count({ where: { submissionId: w.sub.id, status: { in: ["charged", "not_set_up"] } } })).toBe(1);
  });
});
