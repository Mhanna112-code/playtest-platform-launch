import fs from "node:fs";
import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as sendPOST } from "@/app/api/direct/[id]/route";
import { GET as statusGET } from "@/app/api/account/status/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as keptPOST, GET as keptGET } from "@/app/api/kept/route";
import { ProfileMessageButton } from "@/components/ProfileMessageButton";
import { allUnreadChats, directAccess, directButtonAllowed, directConversations, directMessages, directUnreadCount, DIRECT_LIMIT_LINE, markDirectRead } from "@/lib/server/directMessages";
import { sendChat } from "@/lib/server/messages";
import { CHAT_NOT_SENT, CHAT_PAUSED_NOTE } from "@/lib/rules";
import { makeUser, req, json } from "./helpers";
import { act, joined, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/direct/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

type Account = Awaited<ReturnType<typeof makeUser>>;
const send = (from: Account, to: User, body = "Hello", clientId = randomUUID()) => sendPOST(req(`/api/direct/${to.id}`, { cookie: from.cookie, body: { body, clientId } }), { params: Promise.resolve({ id: to.id }) }).then(json);
async function fixture() {
  return { dev: await makeUser({ dev: true, name: "Nora Lane", pronoun: "they" }), tester: await makeUser({ tester: true, name: "Alex Morgan", pronoun: "they" }) };
}
const button = (viewer: User, other: User, blocked = false) => renderToStaticMarkup(createElement(ProfileMessageButton, { viewer, other, blocked }));
async function listAs(user: User) {
  auth.user = user;
  const { default: Page } = await import("@/app/app/messages/page");
  return renderToStaticMarkup(await Page());
}
async function openAs(user: User, other: User) {
  auth.user = user;
  const { default: Page } = await import("@/app/app/direct/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: other.id }) }));
}
function profileControl(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(profileControl).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  if (node.type === ProfileMessageButton) return node;
  return profileControl((node.props as { children?: ReactNode }).children);
}

describe("batch 35 §105: account-level direct conversations from profiles", () => {
  it("opening either profile's Message creates nothing; the first message reaches both lists, unread and bell", async () => {
    const { dev, tester } = await fixture();
    expect(button(dev.user, tester.user)).toContain(`href="/app/direct/${tester.user.id}"`);
    expect(button(tester.user, dev.user)).toContain(`href="/app/direct/${dev.user.id}"`);
    expect(await openAs(dev.user, tester.user)).toContain("Direct message");
    expect(await db.directConversation.count({ where: { startedById: dev.user.id } })).toBe(0);
    const r = await send(dev, tester.user, "A question before we work together");
    expect(r.status).toBe(200);
    const conversation = (await directAccess(dev.user.id, tester.user.id)).conversation!;
    expect(Math.abs(conversation.createdAt.getTime() - new Date(r.body.createdAt).getTime())).toBeLessThan(1000);
    expect(await db.contract.count({ where: { testerId: tester.user.id, test: { developerId: dev.user.id } } })).toBe(0);
    expect(await listAs(dev.user)).toContain("Alex Morgan");
    expect(await listAs(tester.user)).toContain("Nora Lane");
    expect(await listAs(tester.user)).toContain("Direct message");
    expect(await directUnreadCount(tester.user.id)).toBe(1);
    const status = await json(await statusGET(req("/api/account/status", { cookie: tester.cookie })));
    expect(status.body).toMatchObject({ messages: 1, bell: 1 });
    const bell = await db.notification.findFirstOrThrow({ where: { userId: tester.user.id, link: `/app/direct/${dev.user.id}` } });
    expect(bell).toMatchObject({ text: "New message from Nora Lane", side: null, testId: null, payment: false });
    expect(await openAs(tester.user, dev.user)).toContain("A question before we work together");
    expect(await allUnreadChats(tester.user)).toBe(0);
    expect((await send(tester, dev.user, "Thanks for asking")).status).toBe(200);
    expect((await directConversations(dev.user.id))).toHaveLength(1);
    expect(await allUnreadChats(dev.user)).toBe(1);
  });

  it.each(["outgoing", "incoming"])("a block %s hides both profiles' Message and refuses an old page neutrally", async (direction) => {
    const { dev, tester } = await fixture();
    await db.block.create({ data: { blockerId: direction === "outgoing" ? dev.user.id : tester.user.id, blockedId: direction === "outgoing" ? tester.user.id : dev.user.id } });
    auth.user = dev.user;
    const { default: TesterPage } = await import("@/app/app/testers/[id]/page");
    const testerTree = await TesterPage({ params: Promise.resolve({ id: tester.user.id }) });
    expect(renderToStaticMarkup(profileControl(testerTree))).not.toContain("data-profile-message");
    auth.user = tester.user;
    const { default: DeveloperPage } = await import("@/app/app/developers/[id]/page");
    const developerTree = await DeveloperPage({ params: Promise.resolve({ id: dev.user.id }) });
    expect(renderToStaticMarkup(profileControl(developerTree))).not.toContain("data-profile-message");
    expect(await send(dev, tester.user)).toMatchObject({ status: 409, body: { error: { code: "unable", message: "Unable to chat with this tester." } } });
    expect(await send(tester, dev.user)).toMatchObject({ status: 409, body: { error: { code: "unable", message: "Unable to chat with this developer." } } });
    expect(await db.directMessage.count({ where: { senderId: dev.user.id } })).toBe(0);
  });

  it.each(["devSuspendedAt", "holdStartedAt", "testerSuspendedAt"] as const)("a recipient's %s refuses Send with the existing neutral line", async (field) => {
    const { dev, tester } = await fixture();
    const recipient = field === "testerSuspendedAt" ? tester : dev;
    const sender = field === "testerSuspendedAt" ? dev : tester;
    await db.user.update({ where: { id: recipient.user.id }, data: { [field]: new Date() } });
    const r = await send(sender, recipient.user);
    expect(r).toMatchObject({ status: 409, body: { error: { code: "chat_paused", message: CHAT_NOT_SENT } } });
    expect(r.body.error.message).not.toMatch(/hold|suspended|failed|chargeback/i);
    expect(await openAs(sender.user, recipient.user)).toContain(CHAT_PAUSED_NOTE);
    expect(await db.directConversation.count({ where: { startedById: sender.user.id } })).toBe(0);
  });

  it.each(["developer", "tester"])("the sender's own %s suspension uses the existing refusal", async (side) => {
    const { dev, tester } = await fixture();
    const sender = side === "developer" ? dev : tester, other = side === "developer" ? tester : dev;
    const updated = await db.user.update({ where: { id: sender.user.id }, data: side === "developer" ? { devSuspendedAt: new Date() } : { testerSuspendedAt: new Date() } });
    expect((await send(sender, other.user)).status).toBe(403);
    expect(button(updated, other.user)).toBe("");
  });

  it("deleted recipients and senders, self-messaging and admin tools create no conversations", async () => {
    const { dev, tester } = await fixture();
    expect(button(dev.user, dev.user)).toBe("");
    expect((await send(dev, dev.user)).status).toBe(409);
    const admin = await db.user.update({ where: { id: dev.user.id }, data: { isAdmin: true } });
    expect(button(admin, tester.user)).toBe("");
    expect((await send(dev, tester.user)).status).toBe(409);
    await db.user.update({ where: { id: dev.user.id }, data: { isAdmin: false } });
    const gone = await db.user.update({ where: { id: tester.user.id }, data: { deletedAt: new Date(), isTester: false } });
    expect(button(dev.user, gone)).toBe("");
    expect((await send(dev, gone)).body.error).toMatchObject({ code: "closed", message: "This chat is closed." });
    expect((await send(tester, dev.user)).status).toBe(401);
    expect(await db.directConversation.count({ where: { startedById: dev.user.id } })).toBe(0);
  });

  it("the 21st new conversation is refused, existing replies work, and an old start leaves the rolling window", async () => {
    const { dev } = await fixture();
    const people = [];
    for (let n = 0; n < 21; n++) people.push(await makeUser({ tester: true, pronoun: "they" }));
    for (const p of people.slice(0, 20)) expect((await send(dev, p.user)).status).toBe(200);
    expect(await send(dev, people[20].user)).toMatchObject({ status: 429, body: { error: { message: DIRECT_LIMIT_LINE } } });
    expect((await send(dev, people[0].user, "An existing conversation")).status).toBe(200);
    expect((await send(people[0], dev.user, "A reply")).status).toBe(200);
    const oldest = await db.directConversation.findFirstOrThrow({ where: { startedById: dev.user.id }, orderBy: { createdAt: "asc" } });
    await db.directConversation.update({ where: { id: oldest.id }, data: { createdAt: new Date(Date.now() - 86_400_001) } });
    expect((await send(dev, people[20].user)).status).toBe(200);
  });

  it("two first messages at once make one conversation, and a retry makes one message and one bell", async () => {
    const { dev, tester } = await fixture();
    const both = await Promise.all([send(dev, tester.user, "Hello from Nora"), send(tester, dev.user, "Hello from Alex")]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const a = await directAccess(dev.user.id, tester.user.id);
    expect(a.conversation).toBeTruthy();
    expect(await db.directConversation.count({ where: { OR: [{ firstId: dev.user.id }, { secondId: dev.user.id }] } })).toBe(1);
    expect(await directMessages(a.conversation!.id)).toHaveLength(2);
    const id = randomUUID();
    const repeat = await Promise.all([send(dev, tester.user, "One press", id), send(dev, tester.user, "One press", id)]);
    expect(repeat.map((r) => r.status)).toEqual([200, 200]);
    expect(repeat[0].body.id).toBe(repeat[1].body.id);
    expect(await db.directMessage.count({ where: { senderId: dev.user.id, clientId: id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, link: `/app/direct/${dev.user.id}` } })).toBe(2);
  });

  it("one conversation, read marker and draft are shared across both sides; the inactive side's restriction stays there", async () => {
    const { dev, tester } = await fixture();
    const mixed = await db.user.update({ where: { id: dev.user.id }, data: { isTester: true, side: "developer" } });
    expect((await send(dev, tester.user)).status).toBe(200);
    const first = (await directAccess(mixed.id, tester.user.id)).conversation!;
    const onTester = await db.user.update({ where: { id: mixed.id }, data: { side: "tester", devSuspendedAt: new Date() } });
    expect((await send(dev, tester.user, "From my tester side")).status).toBe(200);
    expect((await directAccess(mixed.id, tester.user.id)).conversation!.id).toBe(first.id);
    expect(await listAs(onTester)).toContain("Direct message");
    expect(directButtonAllowed(onTester, tester.user, false)).toBe(true);
    const key = `chat:direct:${tester.user.id}`;
    expect((await json(await keptPOST(req("/api/kept", { cookie: dev.cookie, body: { key, data: { text: "A saved direct message" } } })))).status).toBe(200);
    await db.user.update({ where: { id: mixed.id }, data: { side: "developer", devSuspendedAt: null } });
    expect(JSON.stringify((await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie: dev.cookie })))).body)).toContain("A saved direct message");
    expect(await listAs(await db.user.findUniqueOrThrow({ where: { id: mixed.id } }))).toContain("Direct message");
  });

  it("same-side accounts can message and testers can reach another tester's profile", async () => {
    const { dev, tester } = await fixture();
    const dev2 = await makeUser({ dev: true, pronoun: "they" }), tester2 = await makeUser({ tester: true, pronoun: "they" });
    expect((await send(dev, dev2.user)).status).toBe(200);
    expect((await send(tester, tester2.user)).status).toBe(200);
    auth.user = tester.user;
    const { default: Page } = await import("@/app/app/testers/[id]/page");
    const tree = await Page({ params: Promise.resolve({ id: tester2.user.id }) });
    expect(renderToStaticMarkup(profileControl(tree))).toContain(`href="/app/direct/${tester2.user.id}"`);
  });

  it("a test chat stays separate; both message types share the existing per-minute limit", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Alex Morgan", "they");
    expect((await send(dev, tester.user, "The direct conversation")).status).toBe(200);
    await sendChat(dev.user, testId, tester.user.id, "The test conversation", randomUUID());
    const html = await listAs(tester.user);
    expect(html).toContain(`/app/direct/${dev.user.id}`);
    expect(html).toContain(`/app/chat/${sessionId}`);
    expect(await allUnreadChats(tester.user)).toBe(2);
    for (let n = 0; n < 28; n++) await sendChat(dev.user, testId, tester.user.id, "A test message", randomUUID());
    expect((await send(dev, tester.user, "Too fast")).status).toBe(429);
    await expect(sendChat(dev.user, testId, tester.user.id, "Also too fast", randomUUID())).rejects.toMatchObject({ status: 429, code: "too_fast" });
    expect(await db.directMessage.count({ where: { senderId: dev.user.id } })).toBe(1);
  });

  it("uses the same length limits, creates nothing on a mistake, and email Off still gets the bell", async () => {
    const { dev, tester } = await fixture();
    expect((await send(dev, tester.user, "   ")).body.error.code).toBe("empty");
    expect((await send(dev, tester.user, "x".repeat(4001))).body.error.code).toBe("too_long");
    expect(await db.directConversation.count({ where: { startedById: dev.user.id } })).toBe(0);
    await db.user.update({ where: { id: tester.user.id }, data: { emailPref: "off" } });
    expect((await send(dev, tester.user, "x".repeat(4000))).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id } })).toBe(1);
    expect(await db.emailQueue.count({ where: { to: tester.user.email } })).toBe(0);
  });

  it("test-chat unread stays on its side while direct unread is shared", async () => {
    const own = await setup();
    const other = await setup();
    const member = await joined(own.testId, "Alex Morgan", "they");
    await db.user.update({ where: { id: own.dev.user.id }, data: { isTester: true, side: "tester" } });
    await db.testerProfile.create({ data: { userId: own.dev.user.id, devices: [], languages: [], categories: [] } });
    const listing = await db.test.findUniqueOrThrow({ where: { id: other.testId } });
    expect((await act(other.testId, "join", own.dev.cookie, { listingVersion: listing.listingVersion })).status).toBe(200);
    await sendChat(member.tester.user, own.testId, member.tester.user.id, "On the developer side", randomUUID());
    await sendChat(member.tester.user, own.testId, member.tester.user.id, "Another developer-side message", randomUUID());
    await sendChat(other.dev.user, other.testId, own.dev.user.id, "On the tester side", randomUUID());
    const friend = await makeUser({ tester: true, pronoun: "they" });
    expect((await send(friend, own.dev.user, "Shared across sides")).status).toBe(200);
    const devSide = await db.user.update({ where: { id: own.dev.user.id }, data: { side: "developer" } });
    expect(await allUnreadChats(devSide)).toBe(3);
    expect((await json(await statusGET(req("/api/account/status", { cookie: own.dev.cookie })))).body.messages).toBe(3);
    const testerSide = await db.user.update({ where: { id: own.dev.user.id }, data: { side: "tester" } });
    expect(await allUnreadChats(testerSide)).toBe(2);
    expect((await json(await statusGET(req("/api/account/status", { cookie: own.dev.cookie })))).body.messages).toBe(2);
  });

  it("read markers do not go backwards and a message after the displayed one stays unread", async () => {
    const { dev, tester } = await fixture();
    const first = await send(dev, tester.user, "First");
    const second = await send(dev, tester.user, "Second");
    const a = await directAccess(tester.user.id, dev.user.id);
    const m1 = await db.directMessage.findUniqueOrThrow({ where: { id: first.body.id } });
    const m2 = await db.directMessage.findUniqueOrThrow({ where: { id: second.body.id } });
    await markDirectRead(tester.user.id, a.conversation!.id, m1.createdAt);
    expect(await directUnreadCount(tester.user.id)).toBe(1);
    await markDirectRead(tester.user.id, a.conversation!.id, new Date(m1.createdAt.getTime() - 1000));
    expect(await directUnreadCount(tester.user.id)).toBe(1);
    await markDirectRead(tester.user.id, a.conversation!.id, m2.createdAt);
    expect(await directUnreadCount(tester.user.id)).toBe(0);
  });

  it("direct and list fingerprints catch messages and blocks; drafts use the existing Chat component", async () => {
    const { dev, tester } = await fixture();
    const poll = (path: string) => pulseGET(req(path, { cookie: tester.cookie })).then(json);
    const before = await poll(`/api/pulse?direct=${dev.user.id}`);
    const listBefore = await poll("/api/pulse?messages=1");
    await send(dev, tester.user);
    expect((await poll(`/api/pulse?direct=${dev.user.id}`)).body.v).not.toBe(before.body.v);
    expect((await poll("/api/pulse?messages=1")).body.v).not.toBe(listBefore.body.v);
    const arrived = await poll(`/api/pulse?direct=${dev.user.id}`);
    await db.block.create({ data: { blockerId: dev.user.id, blockedId: tester.user.id } });
    expect((await poll(`/api/pulse?direct=${dev.user.id}`)).body.v).not.toBe(arrived.body.v);
    const src = fs.readFileSync("src/app/app/direct/[id]/page.tsx", "utf8");
    expect(src).toContain("<Chat path=");
    expect(src).toContain("chat:direct:${id}");
    expect(fs.readFileSync("src/components/MessagesBadge.tsx", "utf8")).not.toContain("setInterval");
  });
});

describe("Messages rows cap the unread number (owner, Nov 2)", () => {
  it("shows 9+ above 9, like the top bar", () => {
    const src = fs.readFileSync("src/app/app/messages/page.tsx", "utf8");
    expect(src).toContain('{r.unread > 9 ? "9+" : r.unread}');
  });
});
