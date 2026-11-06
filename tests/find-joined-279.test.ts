import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { findTests, joinedContract } from "@/lib/server/tests";
import { makeUser, uniq } from "./helpers";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 6, §279) A test the tester is working in still shows in Find tests: tagged "Joined", no Join / Apply, the card opens their session.
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: vi.fn(), requireOpenPage: vi.fn(), requireOpenDevPage: vi.fn(), adminAway: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-path": "/app/find" })) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/app/find", useSearchParams: () => new URLSearchParams() }));
import { requireOpenPage } from "@/lib/server/page-auth";
import FindPage from "@/app/app/find/page";

const oldReact = globalThis.React;
vi.stubGlobal("React", React);
afterAll(() => { vi.stubGlobal("React", oldReact); });

type Who = Awaited<ReturnType<typeof makeUser>>;
async function findHtml(who: Who, q: string) {
  vi.mocked(requireOpenPage).mockResolvedValue(who.user as never);
  return renderToStaticMarkup((await FindPage({ searchParams: Promise.resolve({ q }) } as never)) as ReactElement);
}
const cardOf = (html: string, testId: string) => {
  const cards = html.split("<li ").slice(1);
  return cards.find((c) => c.includes(`/app/find/${testId}"`) || c.includes(`data-find-card="joined"`)) ?? "";
};
async function workingIn() {
  const tag = `Jt${uniq()}`; // a title stays within the listing's length limit
  const s = await setup({ title: `${tag} Run`, productName: tag });
  const { tester, sessionId } = await joined(s.testId);
  return { ...s, tag, tester, sessionId };
}

describe("§279 Find tests shows the tests you're in", () => {
  it("a working tester sees their test tagged Joined; the card opens their session; no Join / Apply; counts include it", async () => {
    const { testId, tag, tester, sessionId } = await workingIn();
    const found = await findTests(tester.user as never, tag);
    expect(found.map((t) => t.id)).toEqual([testId]);
    expect(joinedContract(found[0])?.id).toBe(sessionId);
    // The search applies as to any other test.
    expect((await findTests(tester.user as never, `Nomatch${uniq()}`)).some((t) => t.id === testId)).toBe(false);
    const html = await findHtml(tester, tag);
    const card = cardOf(html, testId);
    expect(card).toContain(`href="/app/sessions/${sessionId}"`);
    expect(card).toContain('data-find-joined="">Joined</span>');
    expect(card).toContain("border-emerald-400/40 text-emerald-200");
    expect(html).not.toContain(`/app/find/${testId}"`);
    expect(card).not.toMatch(/>\s*(Join|Apply)\s*</);
    expect(card).not.toContain("open to you");
    // "All (N)": the joined test counts, since it's shown.
    expect(html).toMatch(/All <span class="text-slate-500">1<\/span>/);
  });

  it("it's still listed when the test is full, joining closed, invite only or paused; others don't see it", async () => {
    const { testId, tag, tester, sessionId } = await workingIn();
    const other = await makeUser({ tester: true, name: "Ben Okafor" });
    for (const data of [{ spots: 1 }, { openUntil: new Date(Date.now() - 60_000) }, { joinMode: "invite" }, { adminPausedAt: new Date() }]) {
      const before = await db.test.findUniqueOrThrow({ where: { id: testId } });
      await db.test.update({ where: { id: testId }, data });
      expect((await findTests(tester.user as never, tag)).map((t) => t.id)).toEqual([testId]);
      expect((await findTests(other.user as never, tag)).some((t) => t.id === testId)).toBe(false);
      if ("spots" in data) expect(cardOf(await findHtml(tester, tag), testId)).toContain(`href="/app/sessions/${sessionId}"`);
      await db.test.update({ where: { id: testId }, data: { spots: before.spots, openUntil: before.openUntil, joinMode: before.joinMode, adminPausedAt: before.adminPausedAt } });
    }
  });

  it("a tester who left keeps today's card: no Joined tag, the join page, 'You left this test'", async () => {
    const { testId, tag, tester, sessionId } = await workingIn();
    expect((await sact(sessionId, "leave", tester.cookie, {})).status).toBe(200);
    const found = await findTests(tester.user as never, tag);
    expect(found.map((t) => t.id)).toEqual([testId]);
    expect(joinedContract(found[0])).toBeNull();
    const html = await findHtml(tester, tag);
    const card = cardOf(html, testId);
    expect(card).toContain(`href="/app/find/${testId}"`);
    expect(card).not.toContain("data-find-joined");
    expect(card).not.toContain("/app/sessions/");
    expect(card).toContain("You left this test");
  });
});
