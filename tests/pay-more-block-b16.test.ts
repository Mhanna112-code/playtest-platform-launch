import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { pay, payMore } from "./b15";

// (B16) The Testers list hides Pay more while a block (either way) stops it: the server refuses it with "This payment isn't available.".

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

describe("B16: Pay more is hidden on the developer's test page while a block stops it", () => {
  it("either side's block hides the Testers list's Pay more box; the server refuses it the same", async () => {
    for (const by of ["developer", "tester"] as const) {
      const w = await sent();
      expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
      expect(await testPage(w.testId, w.dev.user.id)).toContain("data-part-pay-more");
      await db.block.create({ data: by === "developer" ? { blockerId: w.dev.user.id, blockedId: w.tester.user.id } : { blockerId: w.tester.user.id, blockedId: w.dev.user.id } });
      expect(await testPage(w.testId, w.dev.user.id), by).not.toContain("data-part-pay-more");
      const r = await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00" });
      expect(r.body.error?.message).toBe(by === "developer" ? "You blocked Ana Silva, so your Pay more didn't go through." : "This payment isn't available."); // (§380 H)
    }
  });

  it("an unblocked tester's Pay more stays", async () => {
    const w = await sent();
    const other = await makeUser({ tester: true });
    await db.block.create({ data: { blockerId: w.dev.user.id, blockedId: other.user.id } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    expect(await testPage(w.testId, w.dev.user.id)).toContain("data-part-pay-more");
  });
});
