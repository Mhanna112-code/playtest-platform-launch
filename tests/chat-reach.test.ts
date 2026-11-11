import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as directPOST } from "@/app/api/direct/[id]/route";
import { json, makeUser, req } from "./helpers";
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
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Cara Diaz sent you a message on “Harbor Run”" } })).toBe(1); // (batch 15 section 20: never the message itself)
    expect((await act(testId, "message", dev.cookie, { contractId: c.sessionId, body: "Open the build" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: c.tester.user.id, text: "Nora Lane sent you a message on “Harbor Run”" } })).toBe(1);
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

  it.each(["closed", "stopped"])("(Owner, Nov 11, §383) a %s test: the test chat still rings while it can be used; a direct message keeps the reach rule", async (status) => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.test.update({ where: { id: testId }, data: { status, ...(status === "stopped" ? { stoppedAt: new Date() } : {}) } });
    await db.contract.update({ where: { id: sessionId }, data: { status: "ended", endedAt: new Date() } });
    // Test chat: the line comes whatever the test's state (it isn't filtered by reach), both ways.
    expect((await act(testId, "message", dev.cookie, { testerId: tester.user.id, body: "Thanks for testing" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "New message from Nora Lane" } })).toBe(1);
    expect((await act(testId, "message", tester.cookie, { testerId: tester.user.id, body: "You're welcome" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "New message from " } } })).toBe(1);
    // A direct message between the same two: no open test shared any more, so no bell (the message itself still arrives).
    const r = await directPOST(req(`/api/direct/${tester.user.id}`, { cookie: dev.cookie, body: { body: "One more thing", clientId: crypto.randomUUID() } }), { params: Promise.resolve({ id: tester.user.id }) }).then(json);
    expect(r.status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, link: `/app/direct/${dev.user.id}` } })).toBe(0);
  });
});
