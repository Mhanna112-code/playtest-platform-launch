import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminStopTest, deleteAccount } from "@/lib/server/restrictions";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { finishWorkIfDue } from "@/lib/server/workWindow";
import { appStoppedLine } from "@/lib/server/blocks";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// (Owner, Nov 22 2026) Applicants are told when a stop or closure closes their application (or rejoin ask), like invited testers: one bell line each, in
// "Applications and invites", following the email setting (never `always`); a deleted account gets none.
const DAY = 86_400_000;

async function applicants(testId: string) {
  const apply = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
  const rejoin = await makeUser({ tester: true, name: "Bo Reyes", pronoun: "he" });
  const gone = await makeUser({ tester: true, name: "Cy Park", pronoun: "they" });
  await db.application.create({ data: { testId, testerId: apply.user.id, listing: {} } });
  await db.application.create({ data: { testId, testerId: rejoin.user.id, listing: {}, kind: "rejoin" } });
  await db.application.create({ data: { testId, testerId: gone.user.id, listing: {} } });
  await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });
  await settle();
  return { apply: apply.user.id, rejoin: rejoin.user.id, gone: gone.user.id };
}

async function expectTold(testId: string, who: Awaited<ReturnType<typeof applicants>>, how: "stopped" | "closed") {
  const verb = how === "stopped" ? "was stopped" : "closed";
  for (const a of await db.application.findMany({ where: { testId } })) expect(a).toMatchObject({ status: "closed", closedReason: "stopped" });
  const linesOf = (userId: string) => db.notification.findMany({ where: { userId, testId } });
  const applied = await linesOf(who.apply);
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({ text: `“Harbor Run” ${verb}, so your application was closed.`, groupKey: "apps", link: `/app/find/${testId}`, mustEmail: false });
  const asked = await linesOf(who.rejoin);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ text: `“Harbor Run” ${verb}, so your ask to rejoin was closed.`, groupKey: "apps", link: `/app/find/${testId}`, mustEmail: false });
  expect(await linesOf(who.gone)).toHaveLength(0);
}

describe("the line", () => {
  it("names the stop or the closure, and an application or a rejoin ask", () => {
    expect(appStoppedLine("Harbor Run", "stopped")).toBe("“Harbor Run” was stopped, so your application was closed.");
    expect(appStoppedLine("Harbor Run", "stopped", true)).toBe("“Harbor Run” was stopped, so your ask to rejoin was closed.");
    expect(appStoppedLine("Harbor Run", "closed")).toBe("“Harbor Run” closed, so your application was closed.");
    expect(appStoppedLine("Harbor Run", "closed", true)).toBe("“Harbor Run” closed, so your ask to rejoin was closed.");
  });
});

describe("applicants are told when a stop or closure closes their application", () => {
  it("the developer's Stop", async () => {
    const { dev, testId } = await setup();
    const who = await applicants(testId);
    const r = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await expectTold(testId, who, "stopped");
    // A second Stop (already stopped) tells nobody again.
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect(await db.notification.count({ where: { userId: who.apply, testId } })).toBe(1);
  });

  it("the team's Stop", async () => {
    const { testId } = await setup();
    const who = await applicants(testId);
    await adminStopTest(testId, "Against the rules.");
    await expectTold(testId, who, "stopped");
  });

  it("the developer deleted their account (their tests stopped)", async () => {
    const { dev, testId } = await setup();
    const who = await applicants(testId);
    await deleteAccount(dev.user.id, "self");
    await expectTold(testId, who, "stopped");
  });

  it("a paused test closed after the pause limit", async () => {
    const { dev, testId } = await setup();
    const who = await applicants(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 8 * DAY) } });
    expect((await closePausedTest(testId, "daily")).closed).toBe(true);
    await expectTold(testId, who, "closed");
  });

  it("the test closed when its work ended", async () => {
    const { testId } = await setup();
    const who = await applicants(testId);
    expect(await finishWorkIfDue(testId, new Date(Date.now() + 25 * DAY))).toBe(true);
    await expectTold(testId, who, "closed");
  });
});
