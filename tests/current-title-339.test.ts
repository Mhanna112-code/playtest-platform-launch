import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { paidRows, stripeDescription } from "@/lib/server/paymentRows";
import { paymentPiece } from "@/lib/server/holds";
import { disputesForSide } from "@/lib/server/disputes";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 9, §339) Payment, owed, confirm and receipt lines name the test by its CURRENT title, not the contract's snapshot from the join; Terms history keeps
// the old title where it records what was agreed.
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("§339 a renamed test: payment lines name its current title", () => {
  it("Pay after a rename: the tester's bell, the developer's receipt line, What you've paid, the piece name and the Stripe description", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "she");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const snapshot = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).title;
    await db.test.update({ where: { id: testId }, data: { title: "Reef Run" } });
    expect(snapshot).not.toBe("Reef Run");

    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // Payment lines only (the rating line, "Rate Nora Lane on …", isn't one).
    const bells = (await db.notification.findMany({ where: { userId: tester.user.id } })).map((n) => n.text).filter((t) => /paid|charged|receipt/i.test(t)).join("\n");
    expect(bells).toContain("“Reef Run”");
    expect(bells).not.toContain(`“${snapshot}”`);

    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    const devRow = (await paidRows([p], "developer")).get(p.id)!;
    const testerRow = (await paidRows([p], "tester")).get(p.id)!;
    expect(devRow.full).toContain("“Reef Run”");
    expect(testerRow.full).toContain("“Reef Run”");
    expect(`${devRow.full}\n${testerRow.full}`).not.toContain(`“${snapshot}”`);
    expect(await stripeDescription({ payment: p })).toContain("Reef Run");
    expect(await paymentPiece(p, false, true)).toContain("“Reef Run”");
    // The receipt (emailed) and every other developer line: none names the old title.
    const devBells = (await db.notification.findMany({ where: { userId: dev.user.id } })).map((n) => n.text).filter((t) => /paid|charged|receipt/i.test(t)).join("\n");
    expect(devBells).not.toContain(`“${snapshot}”`);
  });

  it("the developer's open disputes name the current title", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "she");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Only half of it was done" })).status).toBe(200);
    await db.dispute.create({ data: { contractId: sessionId, testerId: tester.user.id, submissionId: sub.id, reason: "I did it all", status: "open" } });
    await db.test.update({ where: { id: testId }, data: { title: "Reef Run" } });
    expect((await disputesForSide(dev.user.id)).map((d) => d.testTitle)).toEqual(["Reef Run"]);
  });
});
