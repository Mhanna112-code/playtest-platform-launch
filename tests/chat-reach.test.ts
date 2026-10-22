import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

describe("chat reach and notifications", () => {
  it("invited testers and applicants can chat before joining; the bell names the test while active", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    const stranger = await makeUser({ tester: true });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.user.id] });
    await act(testId, "apply", ben.cookie, { note: "Hi" });
    expect((await act(testId, "message", ana.cookie, { testerId: ana.user.id, body: "Is a gamepad needed for this test or is keyboard fine?" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Ana Silva · Harbor Run: Is a gamepad needed for this test or is keyboard fine?" } })).toBe(1);
    expect((await act(testId, "message", dev.cookie, { testerId: ben.user.id, body: "Thanks for applying!" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: ben.user.id, text: "Nora Lane · Harbor Run: Thanks for applying!" } })).toBe(1);
    expect((await act(testId, "message", stranger.cookie, { testerId: stranger.user.id, body: "Hello" })).status).toBe(404);
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
