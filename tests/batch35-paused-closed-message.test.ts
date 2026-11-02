import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { testerRefusal } from "@/lib/rules";
import { db } from "@/lib/db";
import { joined, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/demo", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const now = new Date("2026-11-09T12:00:00Z");
const before = new Date("2026-11-02T12:00:00Z");
const c = { status: "working", endKind: "", endedAt: null, endReason: "" };

describe("a paused session does not claim Open until closed it", () => {
  it.each([
    { adminPausedAt: before },
    { developer: { holdStartedAt: before } },
    { developer: { holdStartedAt: before, holdReason: "chargeback" } },
    { developer: { devSuspendedAt: before } },
  ])("keeps the pause explanation for %j", (pause) => {
    expect(testerRefusal(c, { openUntil: before, ...pause }, "Marc Hanna", () => "Nov 2", now)).toBe("");
  });

  it("preserves an actual end or leave while paused", () => {
    const t = { openUntil: before, adminPausedAt: before };
    expect(testerRefusal({ ...c, status: "left" }, t, "Marc Hanna", () => "Nov 2", now)).toBe("You left this test.");
    expect(testerRefusal({ ...c, status: "ended", endedAt: before, endKind: "closed" }, t, "Marc Hanna", () => "Nov 2", now)).toBe("This test ended on Nov 2. Work you sent is still reviewed.");
  });

  it("the actual session shows the paused banner without the false closed banner", async () => {
    const f = await setup(); const j = await joined(f.testId);
    const ago = new Date(Date.now() - 8 * 86400000);
    await db.test.update({ where: { id: f.testId }, data: { openUntil: ago, adminPausedAt: ago, pausedSince: ago, pauseCloseAt: new Date(Date.now() + 6 * 86400000), pauseCloseSetAt: new Date() } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: Page } = await import("@/app/app/sessions/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: j.sessionId }) }));
    expect(html).toContain('data-paused=""');
    expect(html).not.toContain("This test closed on");
    expect(html).not.toContain('data-stopped-line=""');
  });
});
