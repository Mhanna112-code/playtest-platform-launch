import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §376) The session page's top notices and the paused rules for chat and excerpts.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/demo", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function sessionHtml(sessionId: string, testerId: string) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: testerId } });
  const { default: Page } = await import("@/app/app/sessions/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }) }));
}
const pause = (testId: string) => db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(), pausedSince: new Date() } });

describe("§376 item 1: a tester whose part is over reads only the ended notice", () => {
  it("left, then the test paused: the ended notice only, never the paused one", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    await pause(f.testId);
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-stopped-line=""');
    expect(html).not.toContain('data-paused=""');
    expect(html).not.toContain("This test is paused right now");
  });

  it("paused first, then ended early: the ended notice only", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date() } });
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "early", endedAt: new Date() } });
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-stopped-line=""');
    expect(html).not.toContain('data-paused=""');
  });

  it("a tester still working on a paused test keeps the paused notice", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await pause(f.testId);
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-paused=""');
    expect(html).not.toContain('data-stopped-line=""');
  });
});
