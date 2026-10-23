import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { markChatRead, sendChat, unreadCount } from "@/lib/server/messages";
import { act, joined, seen, setup } from "./fixtures";

// (NEXT-UI 4) End early ends every ticked tester; chat unread badge per session.
describe("group C controls", () => {
  it("End early ends all the ticked testers at once, with the one reason", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Ito");
    const c = await joined(testId, "Cara Diaz");
    const r = await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId, b.sessionId], reason: "We have what we need" });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    const status = async (id: string) => (await db.contract.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(a.sessionId), await status(b.sessionId), await status(c.sessionId)]).toEqual(["ended", "ended", "working"]);
    // One already out: nothing is ended and the refusal names them.
    const again = await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId, c.sessionId], reason: "We have what we need" });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain("Ana Silva");
    expect(await status(c.sessionId)).toBe("working");
    // No ticks.
    expect((await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [], reason: "We have what we need" })).status).toBe(400);
  });

  it("the chat's unread badge counts the other side's messages since the page was opened", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect(await unreadCount(tester.user.id, testId, tester.user.id)).toBe(0);
    await sendChat(dev.user, testId, tester.user.id, "Welcome!");
    await sendChat(dev.user, testId, tester.user.id, "Questions?");
    await sendChat(tester.user, testId, tester.user.id, "Thanks");
    expect(await unreadCount(tester.user.id, testId, tester.user.id)).toBe(2); // not their own
    expect(await unreadCount(dev.user.id, testId, tester.user.id)).toBe(1);
    await markChatRead(tester.user.id, testId, tester.user.id);
    expect(await unreadCount(tester.user.id, testId, tester.user.id)).toBe(0);
    await new Promise((r) => setTimeout(r, 15));
    await sendChat(dev.user, testId, tester.user.id, "One more");
    expect(await unreadCount(tester.user.id, testId, tester.user.id)).toBe(1);
    expect(sessionId).toBeTruthy();
  });
});
