import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ResizeBox } from "@/components/Panel";
import { NDA_BOX_MAX, QA_BOX_MAX, QuestionTexts, ValueText } from "@/components/QA";
import { NdaBox } from "@/components/NdaBox";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { panelRows } from "@/lib/listingPanel";
import type { Listing } from "@/lib/rules";
import { joined, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §231) Every text from the contract or the listing that can be long sits in the same draggable scroll box (ResizeBox in OwnPanel, one
// look: components/QA.tsx): the tester's "Your agreed scope" (the contract's questions and NDA; the listing information's title, product, what to do, build link,
// Mature reason; each Updated Before / Now; the terms history), the new-terms box's NDA, and the developer's Listing panel (the join page draws it too).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("§231 the shared box for contract and listing texts", () => {
  it("ValueText: its own box (6rem, the grip) even inside a scrolling panel; the text wraps anywhere (a 375 px phone never scrolls sideways); a link stays a link", () => {
    const html = renderToStaticMarkup(h(ResizeBox, { id: "outer", label: "Outer" }, h(ValueText, { id: "v1", label: "Build link" }, h("a", { href: "https://example.com/a-very-long-build-link", className: "break-all" }, "https://example.com/a-very-long-build-link"))));
    const box = html.slice(html.indexOf('data-panel="v1"'));
    expect(box).not.toContain("data-panel-flat");
    expect(box).toContain(`max-height:${QA_BOX_MAX}`);
    expect(box).toContain("data-panel-grip");
    expect(box).toContain('data-qa-text="value"');
    expect(box).toContain("[overflow-wrap:anywhere]");
    expect(box).toContain('<a href="https://example.com/a-very-long-build-link" class="break-all">');
  });

  it("QuestionTexts: each question its own question box, numbered, with the Required tag; NdaBox: the same box, 12rem at first", () => {
    const qs = renderToStaticMarkup(h(QuestionTexts, { id: "q", items: [{ text: "What did you like?", required: true }, { text: "Where did you get stuck?" }] }));
    expect(qs.match(/data-qa="question"/g)).toHaveLength(2);
    expect(qs).toContain('data-qa-label="">Question 1<span');
    expect(qs).toContain('data-qa-label="">Question 2</p>');
    expect(qs.match(/data-required-tag/g)).toHaveLength(1);
    expect(renderToStaticMarkup(h(QuestionTexts, { id: "q", items: [] }))).toBe("<span>none</span>");
    const nda = renderToStaticMarkup(h(NdaBox, { id: "n", text: "Keep it secret.", label: "Offered" }));
    expect(NDA_BOX_MAX).toBe("12rem");
    expect(nda).toContain("max-height:12rem");
    expect(nda).toContain('data-qa-text="value">Keep it secret.</div>');
    expect(nda).toContain('aria-label="NDA: Offered (scroll for more)"');
  });

  it("the Updated tag's Before and Now, the terms history's before / after and the new-terms NDA use it", () => {
    expect(src("components/ListingInfo.tsx")).toContain('<ValueText id={`${id}-before`} label="Before">{before}</ValueText>');
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain("<ValueText id={`history-${ch.id}-${r.name}-before`}");
    expect(page).toContain('<NdaBox id={`history-${o.id}-nda-before`} label="Before"');
    expect(page).not.toContain("max-h-32 overflow-y-auto");
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain('<NdaBox id={`offer-${offer.id}-nda-offered`} label="Offered"');
  });
});

describe("§231 the Listing panel (the developer's test page, and the join page)", () => {
  const listing = {
    productName: "Harbor", title: "Harbor Run", description: "Open the build.", buildUrl: "https://example.com/build", questions: ["[required] What did you like?"], ndaText: "Secret.",
    devices: ["Mac"], languages: [], categories: [], mature: true, matureWhy: "Cartoon violence in level 3.", writtenCents: 1000, writtenRequired: true, recordingCents: null,
    recordingRequired: false, liveRateCents: null, liveMinutes: null, liveRequired: false, deadlineDays: 7, openUntil: null, joinMode: "anyone", spots: 3,
  } as unknown as Listing;
  const at = new Date("2026-11-05T15:00:00Z");
  const html = renderToStaticMarkup(h(ListingPanel, { side: "developer", rows: panelRows(listing, { fields: ["description"], before: { description: "Old steps." }, after: { description: "Open the build." }, at }, "developer"), listing, when: () => "3:00 PM", savedAt: at.toISOString() }));
  it("the long values in boxes (title, product, what to do, the build link as a link, the Mature reason, the NDA, the questions); short ones plain", () => {
    for (const k of ["title", "productName", "description", "buildUrl", "mature", "nda", "q-0"]) expect(html, k).toContain(`data-panel="listing-developer-${k}`);
    expect(html).toContain('data-qa-text="value">Yes: Cartoon violence in level 3.</div>');
    expect(html).toContain('<a href="https://example.com/build" target="_blank" rel="noreferrer" class="break-all">');
    expect(html).not.toContain('data-panel="listing-developer-devices"');
    expect(html).not.toContain('data-panel="listing-developer-parts"');
    // Inside the panel's own scroll, each box keeps its own (not flat).
    expect(html).toContain('data-listing-scroll=""');
    expect(html).not.toContain("data-panel-flat");
  });
});

describe("§231 the tester's \"Your agreed scope\"", () => {
  it("the contract's questions and the listing's long texts in their boxes, inside the scope's one outer scroll", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const scope = page.slice(page.indexOf('data-scope=""'), page.indexOf('id="parts"'));
    expect(scope).toContain('data-scope-scroll=""');
    expect(scope).toContain(`data-panel="scope-q-${j.sessionId}-0"`);
    expect(scope).toContain('data-qa-label="">Question 1');
    expect(scope).toContain(`data-panel="scope-info-${j.sessionId}-title"`);
    expect(scope).toContain(`data-panel="scope-info-${j.sessionId}-description"`);
    expect(scope).not.toContain("data-panel-flat");
    // The listing information never lists questions: the contract's are the ones above (the new ones come in the new-terms offer).
    const info = scope.slice(scope.indexOf('data-scope-info=""'), scope.indexOf('data-terms-history=""'));
    expect(info).not.toContain('data-qa="question"');
  });
});
