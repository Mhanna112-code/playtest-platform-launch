import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { bookCall, joined, setup } from "./fixtures";

// (Hotfix 9309eb5d) The developer's test page threw "Cannot access 'now' before initialization" on any test with a call: §386 G's automatic-charge dates
// (chargeAts) read `now` above its declaration. No test rendered the page for a test with a call; this one does: a booked call ahead, and a call that took
// place and waits for its pay date (the chargeAts path).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const HOUR = 3_600_000;
async function devPage(testId: string, devId: string) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return render(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) }));
}

describe("the developer's test page with calls (hotfix 9309eb5d)", () => {
  it("renders with a booked call ahead", async () => {
    const s = await setup({ liveRateCents: "30.00" });
    const j = await joined(s.testId);
    await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    expect(await db.call.count({ where: { contractId: j.sessionId, status: "booked" } })).toBe(1);
    const html = await devPage(s.testId, s.dev.user.id);
    expect(html).toContain("Harbor Run");
  });

  it("renders with a call that took place and waits for its pay date (its automatic-charge date is read)", async () => {
    const s = await setup({ liveRateCents: "30.00" });
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * HOUR), actualMinutes: 30, measuredMinutes: 30, measuredAt: new Date(Date.now() - HOUR), payBy: new Date(Date.now() + 3 * 24 * HOUR) } });
    const html = await devPage(s.testId, s.dev.user.id);
    expect(html).toContain("Harbor Run");
  });
});
