import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { allowedLine } from "@/app/app/tests/[id]/TestBanner";

// (Owner, Nov 9, §368) The restricted view of a test page shows the parts to pay (Pay) during a team pause or a developer suspension, never during a hold.
// (Owner, Nov 11, §386 A) The buttons stay (a press is refused: no money moves while paused), and the banner never offers paying.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const testPage = async (testId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) }));
};

async function sent() {
  const s = await setup();
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  return { ...s, ...j, sub };
}

describe("§368 / §386 A the restricted view keeps the Pay buttons during a team pause or a suspension, not a hold; the banner never offers paying", () => {
  it.each(["team", "suspended", "held"] as const)("%s", async (cause) => {
    const w = await sent();
    if (cause === "team") await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: new Date() } });
    if (cause === "suspended") await db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: new Date() } });
    if (cause === "held") await db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "payment" } });
    const html = await testPage(w.testId, w.dev.user.id);
    expect(html).toContain("data-test-banner"); // the restricted view
    if (cause === "held") {
      expect(html).not.toContain("data-restricted-pay");
      expect(html).not.toContain(`data-fold="needs-pay-${w.sub.id}"`);
      expect(html).not.toContain("pay for work");
    } else {
      expect(html).toContain("data-restricted-pay");
      expect(html).toContain(`data-fold="needs-pay-${w.sub.id}"`);
      expect(html).toContain("For now you can stop this test");
      expect(html).not.toContain("pay for work");
    }
  });

  it("the banner's what-still-works line never names paying (§386 A)", () => {
    expect(allowedLine(true, { stop: true, endEarly: true })).toBe("For now you can stop this test, or end testers' work early.");
    expect(allowedLine(true, { stop: true })).toBe("For now you can stop this test.");
  });
});

