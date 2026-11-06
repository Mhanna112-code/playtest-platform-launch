import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { limitedHistoryRows } from "@/lib/listingInfo";
import { limitedTermsDiff } from "@/lib/rules";
import { act, joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §266) Terms history keeps only changes to the fields limited to 3 changes (CRITICAL_FIELDS: what to do, questions, languages, devices,
// build link, parts and prices), plus the joined line, "Test stopped" with its reason, and §263's "Questions changed" entries. Out: title and product name
// (the "Renamed" lines), categories, Mature, Open until, spots, the NDA (offers' "NDA then and now", any NDA line), the deadline. An offer that changed only
// fields left out gets no entry; one that changed limited fields lists only those.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
};

describe("§266 lib", () => {
  it("an offer's diff keeps only parts and prices (and questions, before §265): no NDA, no deadline; nothing left: no entry", () => {
    expect(limitedTermsDiff("written $8 → $10, added an NDA, 7 → 10 days, the recording now required")).toBe("written $8 → $10, the recording now required");
    expect(limitedTermsDiff("NDA changed")).toBeNull();
    expect(limitedTermsDiff("removed the NDA, 7 → 14 days")).toBeNull();
    expect(limitedTermsDiff("questions changed")).toBe("questions changed");
  });

  it("listing information rows: what to do, the build link, devices and languages only", () => {
    const change = { fields: ["description", "categories", "mature", "matureWhy", "devices"], before: { description: "Sail", categories: ["Game"], mature: false, matureWhy: "", devices: [] },
      after: { description: "Sail far", categories: ["Puzzle"], mature: true, matureWhy: "Blood", devices: ["Mac"] }, createdAt: new Date() };
    expect(limitedHistoryRows(change)?.map((r) => r.key)).toEqual(["description", "devices"]);
    expect(limitedHistoryRows({ ...change, fields: ["categories", "mature"] })).toBeNull();
  });
});

describe("§266 the tester's Terms history", () => {
  it("keeps the joined line, the limited changes and Test stopped; leaves out renames, categories, Mature, the NDA and NDA-only offers", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await edit(testId, dev.cookie, { title: "Harbor Run 2" });
    await edit(testId, dev.cookie, { categories: ["Game", "Education"], description: "Sail to the far island" });
    await edit(testId, dev.cookie, { ndaText: "Keep it secret." });
    await edit(testId, dev.cookie, { writtenCents: "12.00" });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const history = page.slice(page.indexOf('data-terms-history-list=""'), page.indexOf('id="parts"'));
    expect(history).toContain(": you joined on ");
    expect(history).toContain("updated the listing information (description)");
    expect(history).not.toContain("categories");
    expect(history).not.toContain("Renamed");
    expect(history).not.toContain("Harbor Run 2");
    expect(history).not.toContain("NDA then and now");
    expect(history).not.toContain("NDA");
    // The NDA's offer was replaced by the price's (one offer open at a time); its diff is limited to the price.
    const offers = await db.termsOffer.findMany({ where: { contractId: j.sessionId } });
    expect(offers.some((o) => o.diff.includes("NDA"))).toBe(true);
    expect(history).toContain("offered new terms");
    expect(history).toContain("written $10 → $12");
  });
});
