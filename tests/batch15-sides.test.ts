import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import * as R from "@/lib/rules";
import { closedForSuspended } from "@/lib/closedPages";
import { chatRestriction } from "@/lib/server/messages";
import { reinstateAccount, suspendAccount, suspendedAccountsReminder } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, setup, seen, listingBody } from "./fixtures";
import { POST as testsPOST } from "@/app/api/tests/route";

// Batch 15 sections 1 and 16: chat pauses only for a restricted person; suspensions are per side.

async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const msg = (testId: string, cookie: string, contractId: string, body: string, clientId?: string) => act(testId, "message", cookie, { contractId, body, clientId });

describe("chat (section 1)", () => {
  it("a developer-side suspension: the developer's Send is refused and routed; the tester reads the chat and gets the neutral notice; lifting brings the box back", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const a = await admin();
    expect((await msg(testId, dev.cookie, sessionId, "Before")).status).toBe(200);
    await suspendAccount(a.user.id, dev.user.id, "Checking");
    const mine = await msg(testId, dev.cookie, sessionId, "Hello?");
    expect(mine.status).toBe(403);
    expect(mine.body.error.code).toBe("suspended");
    expect(typeof mine.body.error.failed).toBe("string"); // routed to the dashboard top, like Rate
    const theirs = await sact(sessionId, "message", tester.cookie, { body: "Are you there?" });
    expect(theirs.body.error).toMatchObject({ code: "chat_paused", message: R.CHAT_NOT_SENT });
    expect(R.CHAT_PAUSED_NOTE).toBe("Messages are paused for now. You can still read this chat.");
    for (const t of [R.CHAT_NOT_SENT, R.CHAT_PAUSED_NOTE]) expect(t).not.toMatch(/suspend|hold|fail/i);
    expect((await chatRestriction(testId, tester.user.id)).developer).toBe(true);
    // The tester can still open the chat page (closed only for the restricted person on that role).
    const t = await db.user.findUniqueOrThrow({ where: { id: tester.user.id } });
    expect(closedForSuspended("/app/chat/x", t, "tester", "tester")).toBe(false);
    const d = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(closedForSuspended("/app/chat/x", d, "developer", "developer")).toBe(true);
    await reinstateAccount(dev.user.id, undefined, a.user.id);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Back?" })).status).toBe(200);
  });

  it("a tester-side suspension pauses the tester's chats only; a team pause never closes chat", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const a = await admin();
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    expect((await msg(testId, dev.cookie, sessionId, "Paused but chatting")).status).toBe(200);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Me too" })).status).toBe(200);
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: null } });
    await suspendAccount(a.user.id, tester.user.id, "Checking");
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hi" })).body.error.code).toBe("suspended");
    expect((await msg(testId, dev.cookie, sessionId, "Hi")).body.error).toMatchObject({ code: "chat_paused", message: R.CHAT_NOT_SENT });
  });

  it("a mixed account with the developer side suspended still chats on tests it is testing", async () => {
    const other = await setup();
    const both = await makeUser({ dev: true, tester: true, name: "Mo Both" });
    const t0 = await db.test.findUniqueOrThrow({ where: { id: other.testId } });
    expect((await act(other.testId, "join", both.cookie, { listingVersion: t0.listingVersion })).status).toBe(200);
    const c = await db.contract.findFirstOrThrow({ where: { testId: other.testId, testerId: both.user.id } });
    const a = await admin();
    expect((await aact(a.cookie, "suspend", { id: both.user.id, note: "Dev side only", side: "developer" })).status).toBe(200);
    await db.user.update({ where: { id: both.user.id }, data: { side: "tester" } });
    expect((await sact(c.id, "message", both.cookie, { body: "Still testing" })).status).toBe(200);
  });

  it("(section 13) a repeated press of the same unconfirmed message posts once; the same words sent again on purpose post again", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const id1 = randomUUID();
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hello", clientId: id1 })).status).toBe(200);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hello", clientId: id1 })).status).toBe(200); // the answer was lost: pressed again
    expect(await db.message.count({ where: { contractId: sessionId, body: "Hello" } })).toBe(1);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hello", clientId: randomUUID() })).status).toBe(200); // a new message, same words
    expect(await db.message.count({ where: { contractId: sessionId, body: "Hello" } })).toBe(2);
  });
});

describe("per-side suspensions (section 16)", () => {
  it("a mixed account: the admin chooses the side; the developer side closes, the tester side works; a second admin is refused by name", async () => {
    const both = await makeUser({ dev: true, tester: true, name: "Mo Both" });
    const a = await admin(), b = await admin();
    expect((await aact(a.cookie, "suspend", { id: both.user.id, note: "Why not" })).body.error.code).toBe("choose_side");
    expect((await aact(a.cookie, "suspend", { id: both.user.id, note: "Chargebacks", side: "developer" })).status).toBe(200);
    const again = await aact(b.cookie, "suspend", { id: both.user.id, note: "Me too", side: "developer" });
    expect(again.body.error.message).toBe(`That account's developer side is already suspended (by ${a.user.email}).`);
    const u = await db.user.findUniqueOrThrow({ where: { id: both.user.id } });
    expect(u.devSuspendedAt).not.toBeNull();
    expect(u.testerSuspendedAt).toBeNull();
    // Pages: the developer side's close (to the dashboard top), the tester side's stay open.
    expect(closedForSuspended("/app/tests/new", u, "developer")).toBe(true);
    expect(closedForSuspended("/app/find", u, "tester")).toBe(false);
    expect(closedForSuspended("/app/sessions/x", u, "tester")).toBe(false);
    // Presses are judged by their side: Post a test is refused; joining a test as a tester works.
    const post = await json(await testsPOST(req("/api/tests", { cookie: both.cookie, body: listingBody() })));
    expect(post.body.error.code).toBe("suspended");
    const other = await setup();
    const t0 = await db.test.findUniqueOrThrow({ where: { id: other.testId } });
    expect((await act(other.testId, "join", both.cookie, { listingVersion: t0.listingVersion })).status).toBe(200);
    // The bell says which side.
    expect(await db.notification.count({ where: { userId: both.user.id, text: "Your developer account is paused" } })).toBe(1);
    // Reinstate: per side; a second press names who did it.
    expect((await aact(a.cookie, "unsuspend", { id: both.user.id, side: "developer" })).status).toBe(200);
    expect((await aact(b.cookie, "unsuspend", { id: both.user.id, side: "developer" })).body.error.message).toBe(`That account's developer side was already reinstated (by ${a.user.email}).`);
    expect(await db.notification.count({ where: { userId: both.user.id, text: "Your developer account is active again" } })).toBe(1);
  });

  it("the tester side: removed from tests (the developer reads 'left'); the developer side keeps posting; the admin line counts sides", async () => {
    const both = await makeUser({ dev: true, tester: true, name: "Mo Both" });
    const other = await setup();
    const t0 = await db.test.findUniqueOrThrow({ where: { id: other.testId } });
    expect((await act(other.testId, "join", both.cookie, { listingVersion: t0.listingVersion })).status).toBe(200);
    const a = await admin();
    expect((await aact(a.cookie, "suspend", { id: both.user.id, note: "Spam", side: "tester" })).status).toBe(200);
    expect((await db.contract.findFirstOrThrow({ where: { testerId: both.user.id } })).status).toBe("left");
    await db.user.update({ where: { id: both.user.id }, data: { side: "developer" } });
    expect((await json(await testsPOST(req("/api/tests", { cookie: both.cookie, body: listingBody() })))).status).toBe(200);
    expect(await db.notification.count({ where: { userId: both.user.id, text: "Your tester account is paused" } })).toBe(1);
    // Both sides of another account: two sides.
    const two = await makeUser({ dev: true, tester: true });
    await suspendAccount(a.user.id, two.user.id, "x", "developer");
    await suspendAccount(a.user.id, two.user.id, "x", "tester");
    await db.appState.deleteMany({ where: { key: "suspended-reminder" } });
    const n = await suspendedAccountsReminder();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await db.notification.count({ where: { userId: a.user.id, text: `${n} suspended account sides to review` } })).toBe(1);
    void seen;
  });

  it("a one-role account just shows Suspend: no side needed", async () => {
    const t = await makeUser({ tester: true });
    const a = await admin();
    expect((await aact(a.cookie, "suspend", { id: t.user.id, note: "Checking" })).body.side).toBe("tester");
    expect((await aact(a.cookie, "unsuspend", { id: t.user.id })).body.side).toBe("tester");
  });
});
