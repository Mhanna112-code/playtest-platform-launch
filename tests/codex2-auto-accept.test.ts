import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, seen, setup } from "./fixtures";

const later = () => new Promise((resolve) => setTimeout(resolve, 30));
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const version = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version, fields, confirmed: true });
};

describe("switching to instant joins", () => {
  it("accepts matching waiting applications oldest first, leaves nonmatching applications waiting, and records one live line", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", devices: ["Windows PC"], spots: 5 });
    const applicants = await Promise.all([
      makeUser({ tester: true, name: "Ana Silva" }),
      makeUser({ tester: true, name: "Ben Carter" }),
      makeUser({ tester: true, name: "Cara Diaz" }),
      makeUser({ tester: true, name: "Drew Kim" }),
    ]);
    await db.testerProfile.update({ where: { userId: applicants[3].user.id }, data: { devices: ["Mac"] } });
    for (const [index, applicant] of applicants.entries()) await act(testId, "apply", applicant.cookie, { ...(index === 3 ? { anyway: true } : {}) });
    const before = await db.application.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });

    await edit(testId, dev.cookie, { joinMode: "anyone" });

    const after = await db.application.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });
    expect(after.map((a) => a.status), JSON.stringify(after.map((a) => ({ id: a.id, testerId: a.testerId, status: a.status })))).toEqual(["joined", "joined", "joined", "pending"]);
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id));
    expect(await db.contract.count({ where: { testId, status: "working" } })).toBe(3);
    for (const applicant of applicants.slice(0, 3))
      expect(await db.notification.count({ where: { userId: applicant.user.id, text: "You're in: Harbor Run" } })).toBe(1);
    expect(await db.testEvent.count({ where: { testId, kind: "applied", text: "3 waiting applications were accepted when you switched to joins instantly" } })).toBe(1);
  });

  it("stops accepting at the spot cap and closes remaining applications as full", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", devices: ["Windows PC"], spots: 2 });
    const applicants = await Promise.all([
      makeUser({ tester: true }), makeUser({ tester: true }), makeUser({ tester: true }),
    ]);
    for (const applicant of applicants) await act(testId, "apply", applicant.cookie, {});

    await edit(testId, dev.cookie, { joinMode: "anyone" });

    expect(await db.contract.count({ where: { testId, status: "working" } })).toBe(2);
    const apps = await db.application.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });
    expect(apps.map((a) => a.status)).toEqual(["joined", "joined", "closed"]);
    expect(apps[2].closedReason).toBe("full");
  });

  it("does not accept an application made against an older listing", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", devices: ["Windows PC"] });
    const tester = await makeUser({ tester: true });
    await act(testId, "apply", tester.cookie, {});
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    await db.test.update({ where: { id: testId }, data: { title: "New Harbor Run", version: { increment: 1 }, listingVersion: { increment: 1 } } });
    await edit(testId, dev.cookie, { joinMode: "anyone" });
    const after = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("pending");
    expect(after.changedAt).toEqual(expect.any(Date));
    expect(await db.contract.count({ where: { testId, testerId: tester.user.id, status: "working" } })).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "“New Harbor Run” changed since you applied: join on the current listing, or withdraw your application." } })).toBe(1);
  });

  it("does not revive an application withdrawn as the switch is being saved", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", devices: ["Windows PC"] });
    const tester = await makeUser({ tester: true });
    await act(testId, "apply", tester.cookie, {});
    const application = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    const seenAt = seen();
    await later();

    const withdrawal = act(testId, "withdraw-application", tester.cookie, { seenAt, confirmed: true });
    const switching = edit(testId, dev.cookie, { joinMode: "anyone" });
    await Promise.all([withdrawal, switching]);

    expect((await db.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("withdrawn");
    expect(await db.contract.count({ where: { testId, testerId: tester.user.id } })).toBe(0);
  });
});
