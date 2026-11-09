import fs from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NdaCard } from "@/app/app/tests/NdaCard";
import { NdaOnlyForm } from "@/app/app/tests/NdaOnlyForm";
import { LIMITS } from "@/lib/limits";
import { NDA_TOO_LONG } from "@/lib/rules";
import { NDA_ONLY_EDIT } from "@/lib/ndaEditing";

// (Owner, Nov 9, §336) The NDA-only editor (paused, held, suspended or stopped) uses Edit's own NDA card, so both look and behave the same; it stays its own form.
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t/edit", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
const cardOf = (html: string) => html.match(/<section[^>]*data-nda-card=""[\s\S]*?<\/section>/)?.[0] ?? "";

describe("§336 one NDA card for Edit and the NDA-only editor", () => {
  it("Edit's form and the NDA-only form both render NdaCard (one source)", () => {
    expect(src("app/app/tests/TestForm.tsx")).toContain("<NdaCard value={f.ndaText} saved={base.ndaText}");
    expect(src("app/app/tests/NdaOnlyForm.tsx")).toContain("<NdaCard value={text} saved={p.ndaText}");
    expect(src("app/app/tests/TestForm.tsx")).not.toContain('<textarea id="ndaText"');
    expect(src("app/app/tests/NdaOnlyForm.tsx")).not.toContain('<textarea id="ndaText"');
  });

  it("the NDA-only editor shows exactly Edit's card (heading, lines, box, counter), with its own line and Save", () => {
    const html = renderToStaticMarkup(createElement(NdaOnlyForm, { id: "t", version: 3, ndaText: "Keep it secret.", seenAt: new Date().toISOString() }));
    const card = cardOf(html);
    expect(card).toBe(cardOf(renderToStaticMarkup(createElement(NdaCard, { value: "Keep it secret.", saved: "Keep it secret.", onChange() {} }))));
    expect(card).toContain("Keep it confidential? (NDA, optional)");
    expect(card).toContain("An NDA stops testers sharing your build or what they saw. They must accept it before joining.");
    expect(card).toContain('placeholder="Leave blank for no NDA. If filled, testers must accept it before joining."');
    expect(card).toContain(`maxLength="${LIMITS.nda}"`);
    expect(card).toContain("data-nda-count");
    expect(html).toContain(NDA_ONLY_EDIT);
    expect(html).toContain("data-red-and-blue"); // the same field checks as Edit (red at the box, the mistake list)
    expect(html).not.toMatch(/Use saved NDA|Excerpts stay hidden while an NDA is present/); // the old NDA-only wording is gone
  });

  it("the same red line: an NDA over the limit is red once it's changed, never while it's the saved (older, longer) one", () => {
    const long = "x".repeat(LIMITS.nda + 5);
    expect(renderToStaticMarkup(createElement(NdaCard, { value: long, saved: long, onChange() {} }))).not.toContain("data-red-msg");
    const changed = renderToStaticMarkup(createElement(NdaCard, { value: long.slice(1), saved: long, onChange() {} }));
    expect(changed).toContain(`data-red-msg="${NDA_TOO_LONG}"`);
    expect(changed).toContain("field-bad");
  });
});
