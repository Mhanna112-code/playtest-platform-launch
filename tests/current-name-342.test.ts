import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { makeUser } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §342) Every line that names a test uses its CURRENT title, not the contract's snapshot from the join (kept only for what was agreed).
// A bell is stored text: one made before the rename keeps the old name, so only lines made after it are read.
const texts = async (userId: string, since: Date) => (await db.notification.findMany({ where: { userId, createdAt: { gte: since } } })).map((n) => n.text).join("\n");

describe("§342 a renamed test is named by its current title", () => {
  it("a team pause and resume, and a leave", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "she");
    const snapshot = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).title;
    await db.test.update({ where: { id: testId }, data: { title: "Reef Run" } });
    const renamed = new Date();
    const admin = await makeUser({ name: "Team" });

    await pauseTest(admin.user.id, testId, "Checking a report");
    await unpauseTest(testId);
    await settle();
    expect(await texts(tester.user.id, renamed)).toContain("“Reef Run” is running again");

    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const devLines = await texts(dev.user.id, renamed), testerLines = await texts(tester.user.id, renamed);
    expect(devLines).toContain("left “Reef Run”");
    expect(`${devLines}\n${testerLines}`).not.toContain(`“${snapshot}”`);
    expect(`${devLines}\n${testerLines}`).not.toContain(`on ${snapshot}`);
  });
});
