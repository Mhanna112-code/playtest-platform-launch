import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, joined, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 5));
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true });
};

describe("joining: Anyone / Apply / Invite only", () => {
  it("Apply to join (with a note); the developer accepts; the tester is in", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await act(testId, "join", ana.cookie, {})).body.error.message).toBe("This test takes applications: press Apply to join.");
    expect((await act(testId, "apply", ana.cookie, { note: "I love boat games" })).body).toEqual({ applied: true });
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    const r = await act(testId, "application", dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen() });
    expect(r.body.accepted).toBe(true);
    expect(await db.notification.count({ where: { userId: ana.user.id, text: "You're in: Harbor Run" } })).toBe(1);
  });

  it("Accept stops once when the tester changed their profile since the page loaded; Decline is neutral", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await act(testId, "apply", ana.cookie, {});
    const a = await db.application.findFirstOrThrow({ where: { testId } });
    const pageLoaded = seen();
    await later();
    await db.testerProfile.update({ where: { userId: ana.user.id }, data: { devices: ["Mac"] } });
    const r = await act(testId, "application", dev.cookie, { applicationId: a.id, action: "decline", seenAt: pageLoaded });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain("Ana Silva changed their profile");
    expect((await act(testId, "application", dev.cookie, { applicationId: a.id, action: "decline", seenAt: pageLoaded, confirmed: true })).body).toEqual({ declined: true });
  });

  it("Join and Apply stop once when anything about the listing changed (incl. who can join), but not for spots", async () => {
    const { dev, testId } = await setup();
    const ana = await makeUser({ tester: true });
    const pageLoaded = seen();
    await later();
    await edit(testId, dev.cookie, { spots: 9 });
    await edit(testId, dev.cookie, { joinMode: "apply" });
    const r = await act(testId, "apply", ana.cookie, { seenAt: pageLoaded });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["The listing was edited: who can join"]);
    expect((await act(testId, "apply", ana.cookie, { seenAt: pageLoaded, confirmed: true })).body).toEqual({ applied: true });
  });

  it("switching to Anyone joins a pending applicant automatically if nothing else changed; otherwise they're told", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    await act(testId, "apply", ana.cookie, {});
    await edit(testId, dev.cookie, { spots: 8 }); // spots never count
    await edit(testId, dev.cookie, { joinMode: "anyone" });
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id } })).toBe(1);
    expect((await db.application.findFirstOrThrow({ where: { testerId: ana.user.id, testId } })).status).toBe("joined");
    // Another test: the price changed since applying → told, not joined.
    const s2 = await setup({ joinMode: "apply" });
    await act(s2.testId, "apply", ben.cookie, {});
    await edit(s2.testId, s2.dev.cookie, { writtenCents: "12.00" });
    await edit(s2.testId, s2.dev.cookie, { joinMode: "anyone" });
    expect(await db.contract.count({ where: { testId: s2.testId, testerId: ben.user.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: ben.user.id, text: "Harbor Run changed since you applied" } })).toBe(1);
    expect((await act(s2.testId, "join", ben.cookie, { confirmed: true })).status).toBe(200); // Join on the current listing
  });

  it("invite only: only invited testers can join; refused for good when full", async () => {
    const { dev, testId } = await setup({ joinMode: "invite", spots: 1 });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ana.cookie, {})).body.error.message).toBe("This test is invite only.");
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.user.id] });
    expect((await act(testId, "join", ana.cookie, {})).status).toBe(200);
    expect((await act(testId, "join", ben.cookie, { confirmed: true })).body.error.message).toBe("This test is full.");
    expect(joined).toBeDefined();
  });
});
