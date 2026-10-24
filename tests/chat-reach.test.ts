import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

describe("chat reach and notifications", () => {
  it("(NEWEST+11) no chat before joining: invited testers, applicants and strangers are refused both ways; testers in the test chat, the bell names the test while active", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    const stranger = await makeUser({ tester: true });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.user.id] });
    await act(testId, "apply", ben.cookie, { note: "Hi" });
    expect((await act(testId, "message", ana.cookie, { testerId: ana.user.id, body: "Is a gamepad needed?" })).status).toBe(404);
    expect((await act(testId, "message", dev.cookie, { testerId: ben.user.id, body: "Thanks for applying!" })).status).toBe(404);
    expect((await act(testId, "message", stranger.cookie, { testerId: stranger.user.id, body: "Hello" })).status).toBe(404);
    expect(await db.message.count({ where: { testId } })).toBe(0);
  });

  it("in the test: chat works, and the bell names the test while active", async () => {
    const { dev, testId } = await setup();
    const c = await joined(testId, "Cara Diaz");
    expect((await act(testId, "message", c.tester.cookie, { testerId: c.tester.user.id, body: "Where do I start?" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Cara Diaz · Harbor Run: Where do I start?" } })).toBe(1);
    expect((await act(testId, "message", dev.cookie, { contractId: c.sessionId, body: "Open the build" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: c.tester.user.id, text: "Nora Lane · Harbor Run: Open the build" } })).toBe(1);
  });

  it("past participants can still chat (plain bell); never after a block", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "leave", tester.cookie);
    expect((await act(testId, "message", dev.cookie, { testerId: tester.user.id, body: "Thanks for your help" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "New message from Nora Lane" } })).toBe(1);
    await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id } }));
    expect((await act(testId, "message", dev.cookie, { testerId: tester.user.id, body: "Hello?" })).body.error.message).toBe("This chat is closed.");
  });
});
