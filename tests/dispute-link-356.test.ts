import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { disputePart, lineFallbacks } from "@/lib/lineAnchors";
import { hashTargets } from "@/lib/markJump";
import { decideDispute } from "@/lib/server/payments";
import { makeUser } from "./helpers";
import { sact, seen, settle } from "./fixtures";
import { pay, sentWork } from "./b15";

// (Owner, Nov 9, §356) The developer's "{tester} disputed …" bell / email line: while the dispute is open, Needs you's dispute row (as before); once decided, that
// tester's part in the Testers list, where the decided dispute shows under Payments. Resolved when the link is opened (old bell lines keep their href).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: (to: string) => { throw Error(`redirect:${to}`); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function testPage(testId: string) {
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return render(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) }));
}

describe("§356 the dispute line's link lands on the dispute while open, then on the tester's part", () => {
  it("the fallback: Needs you's dispute row first, then the disputed part", () => {
    expect(lineFallbacks("item-dispute-d1")).toEqual(["item-dispute-d1", "dispute-part-d1"]);
    expect(hashTargets("item-dispute-d1")).toEqual(["item-dispute-d1", disputePart("d1")]);
    // The jump opens the part's "Payments (N)" there (the decided dispute is listed in it).
    expect(readFileSync(path.resolve(__dirname, "../src/lib/markJump.ts"), "utf8")).toContain('if (el.dataset?.jumpOpenAll !== undefined) el.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => { d.open = true; });');
  });

  it("open: the bell line's href and the Needs you row; decided: no Needs you row, the part carries the fallback anchor", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Some answers were short." })).status).toBe(200);
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    const bell = await db.notification.findFirstOrThrow({ where: { userId: w.dev.user.id, text: { contains: "disputed the pay" } } });
    expect(bell.link).toBe(`/app/tests/${w.testId}#item-dispute-${d.id}`);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    const open = await testPage(w.testId);
    expect(open).toContain(`id="item-dispute-${d.id}"`);
    expect(open).toContain(`id="dispute-part-${d.id}"`);
    // Decided: Needs you's row is gone; the same old link falls back to the part (with its Payments).
    const a = await makeUser({ name: "Admin" });
    const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await decideDispute(admin, d.id, { total: "10.00", tickCents: 500 });
    const decided = await testPage(w.testId);
    expect(decided).not.toContain(`id="item-dispute-${d.id}"`);
    const at = decided.indexOf(`id="dispute-part-${d.id}"`);
    expect(at).toBeGreaterThan(0);
    expect(decided.slice(at - 200, at + 400)).toContain("data-jump-open-all");
    expect(decided.slice(at)).toContain(`data-part-payments="${w.sub.id}"`);
  });
});
