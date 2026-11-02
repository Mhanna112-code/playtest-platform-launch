import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sendChat } from "@/lib/server/messages";
import { sendDirect } from "@/lib/server/directMessages";
import { makeUser } from "./helpers";
import { joined, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, leaveIfClosed: () => {}, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/messages", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const fresh = (u: User) => db.user.findUniqueOrThrow({ where: { id: u.id } });
async function listAs(user: User) {
  auth.user = await fresh(user);
  const { default: Page } = await import("@/app/app/messages/page");
  return renderToStaticMarkup(await Page());
}
async function directAs(user: User, other: User) {
  auth.user = await fresh(user);
  const { default: Page } = await import("@/app/app/direct/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: other.id }) }));
}
async function chatAs(user: User, sessionId: string) {
  auth.user = await fresh(user);
  const { default: Page } = await import("@/app/app/chat/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }) }));
}
const hovers = (html: string) => html.split('data-person-hover=""').length - 1;

describe("batch 35 §124: profile hovers in Messages and chats", () => {
  it("a direct conversation: the other person's name has the hover in the list, the header and their messages; never your own", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "they" }), tester = await makeUser({ tester: true, name: "Alex Morgan", pronoun: "they" });
    await sendDirect(dev.user.id, tester.user.id, "Hello there", randomUUID());
    await sendDirect(tester.user.id, dev.user.id, "Hi back", randomUUID());
    const list = await listAs(tester.user);
    expect(hovers(list)).toBe(1);
    expect(list).toContain(`href="/app/developers/${dev.user.id}"`);
    expect(list).toContain('role="tooltip"');
    expect(list).toContain("No ratings yet");
    expect(list).toContain("See their profile");
    expect(list).toContain(`href="/app/direct/${dev.user.id}"`); // the row still opens the chat
    const open = await directAs(tester.user, dev.user);
    expect(hovers(open)).toBe(2); // the header and Nora's one message; "You" has none
    expect(open).not.toContain(`/app/testers/${tester.user.id}`);
    expect(await listAs(dev.user)).toContain(`href="/app/testers/${tester.user.id}"`);
  });

  it("a test chat: both sides see the other person's hover, linked to the profile for their side", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Alex Morgan", "they");
    await sendChat(dev.user, testId, tester.user.id, "Welcome to the test", randomUUID());
    const asTester = await chatAs(tester.user, sessionId);
    expect(hovers(asTester)).toBe(2);
    expect(asTester).toContain(`href="/app/developers/${dev.user.id}"`);
    const asDev = await chatAs(dev.user, sessionId);
    expect(hovers(asDev)).toBe(1); // the header only: the one message is the developer's own
    expect(asDev).toContain(`href="/app/testers/${tester.user.id}"`);
    expect(await listAs(tester.user)).toContain(`href="/app/developers/${dev.user.id}"`);
  });

  it("someone who blocked you or a deleted account shows a plain name; someone you blocked keeps theirs", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "they" }), tester = await makeUser({ tester: true, name: "Alex Morgan", pronoun: "they" });
    await sendDirect(dev.user.id, tester.user.id, "Hello there", randomUUID());
    await db.block.create({ data: { blockerId: dev.user.id, blockedId: tester.user.id } });
    const blockedList = await listAs(tester.user);
    expect(blockedList).toContain("Nora Lane");
    expect(hovers(blockedList)).toBe(0);
    expect(blockedList).not.toContain(`/app/developers/${dev.user.id}`);
    expect(await listAs(dev.user)).toContain(`href="/app/testers/${tester.user.id}"`);
    await db.block.deleteMany({ where: { blockerId: dev.user.id } });
    await db.user.update({ where: { id: dev.user.id }, data: { deletedAt: new Date() } });
    expect(hovers(await listAs(tester.user))).toBe(0);
  });

  it("reuses PersonHover, with no new hover component", () => {
    for (const f of ["src/app/app/messages/page.tsx", "src/components/Chat.tsx"]) expect(fs.readFileSync(f, "utf8"), f).toContain("<PersonHover {...");
    for (const f of ["src/app/app/chat/[id]/page.tsx", "src/app/app/direct/[id]/page.tsx"]) expect(fs.readFileSync(f, "utf8"), f).toContain("otherHover={otherHover}");
  });
});
