import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, Cut, cutText, openLabel, opensPopup, touchOnly } from "@/components/Cut";
import { cut10, cutEmail, cutTo } from "@/lib/rules";

// (Owner, Nov 3) Names listed on a page are cut at 12 characters (was 10) with "…" (emails in the middle); the full text stays in the page (copy, hover, screen readers),
// and on a touch screen a tap on a cut name opens a pop-up with the full text, its link and Copy.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (text: string, kind?: "person" | "test" | "product" | "email") => renderToStaticMarkup(createElement(Cut, { text, kind }));

describe("the cut rule", () => {
  it("cuts a name longer than 12 characters at 12, with …; 12 or fewer stay as they are", () => {
    expect(cutTo("Ana Silva")).toBe("Ana Silva");
    expect(cutTo("Abcdefghij")).toBe("Abcdefghij");
    expect(cutTo("Abcdefghijklm")).toBe("Abcdefghijkl…");
    expect(cutTo("Abcdefghijkl")).toBe("Abcdefghijkl");
    expect(cutTo("Alexandria Montgomery")).toBe("Alexandria M…");
    // A space at the cut is dropped, as cut10 does; the payment lines' rule is unchanged.
    expect(cutTo("Harbor Runs again")).toBe("Harbor Runs…");
    expect(cutTo("Harbor Runs again")).toBe(cut10("Harbor Runs again"));
    // By characters: an emoji is never split in half.
    expect(cutTo("😀".repeat(13))).toBe(`${"😀".repeat(12)}…`);
  });

  it("cuts an email in the middle: 12 characters before @ when that part is longer than 13; the domain only past 14", () => {
    expect(cutEmail("ana@playtest.test")).toBe("ana@playtest.test");
    expect(cutEmail("abcdefg@playtest.test")).toBe("abcdefg@playtest.test");
    expect(cutEmail("maximiliana.alexandrina@playtest.test")).toBe("maximiliana.…@playtest.test");
    expect(cutEmail("ana@very-long-company-domain.example.com")).toBe("ana@very-long-comp…");
    expect(cutEmail("maximiliana.alexandrina@very-long-company-domain.example.com")).toBe("maximiliana.…@very-long-comp…");
    expect(cutEmail("abc@exactly14chars")).toBe("abc@exactly14chars");
    expect(cutText("maximiliana.alexandrina@playtest.test", "email")).toBe("maximiliana.…@playtest.test");
  });
});

describe("<Cut>", () => {
  it("a short name is drawn exactly as before: no wrapper, no underline, no title", () => {
    expect(html("Ana Silva")).toBe("Ana Silva");
    expect(html("ana@playtest.test", "email")).toBe("ana@playtest.test");
  });

  it("a long name: the cut text with a dotted underline, the full text kept in the page and in title / aria-label", () => {
    const h = html("Alexandria Montgomery-Wellington");
    expect(h).toContain('title="Alexandria Montgomery-Wellington"');
    expect(h).toContain('aria-label="Alexandria Montgomery-Wellington"');
    expect(h).toMatch(/<span aria-hidden="true" class="select-none underline decoration-dotted[^"]*" data-cut-shown="">Alexandria M…<\/span>/);
    // The full name, visually hidden, right after the cut one: selecting and copying the row gives the full name.
    expect(h).toContain('<span class="sr-only" data-cut-full="">Alexandria Montgomery-Wellington</span>');
    expect(h).toContain('data-cut="person"');
    const e = html("maximiliana.alexandrina@playtest.test", "email");
    expect(e).toContain(">maximiliana.…@playtest.test</span>");
    expect(e).toContain('data-cut-full="">maximiliana.alexandrina@playtest.test</span>');
  });

  it("the pop-up opens only for a cut name on a touch screen (no hover); with a mouse a click does what it did", () => {
    expect(opensPopup(true, true)).toBe(true);
    expect(opensPopup(true, false)).toBe(false);
    expect(opensPopup(false, true)).toBe(false);
    expect(opensPopup(false, false)).toBe(false);
    const media = (hoverNone: boolean) => vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === "(hover: none)" && hoverNone }) });
    media(true);
    expect(touchOnly()).toBe(true);
    media(false);
    expect(touchOnly()).toBe(false);
    vi.unstubAllGlobals();
    expect(openLabel("person")).toBe("Open profile →");
    expect(openLabel("email")).toBe("Open profile →");
    expect(openLabel("test")).toBe("Open test →");
    expect(openLabel("product")).toBe("Open test →");
    const cut = src("components/Cut.tsx");
    expect(cut).toContain("if (!opensPopup(fit ? overflows(e.currentTarget) : cut, touchOnly())) return;"); // (§187) a fitted name: when it is cut right now
    expect(cut).toContain("max-w-[78vw]");
    expect(cut).toContain("max-h-36 overflow-y-auto"); // the full text: a scroll box about 6 lines tall
    expect(cut).toContain("[overflow-wrap:anywhere]");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Copy copies the full text, never the cut one", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("Alexandria Montgomery-Wellington")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("Alexandria Montgomery-Wellington");
    expect(src("components/Cut.tsx")).toContain("onClick={async () => setCopied((await copyText(full)) ? \"yes\" : \"no\")}>Copy</button>");
  });
});

describe("names listed on pages use <Cut>", () => {
  it("the dashboards, the test page, Find, Messages, the bell, the call header and the admin lines", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain('<span className="font-medium text-white"><NameLink text={r.who} href={r.whoHref} /></span>'); // (batch 35 §137) a link to their profile
    expect(page).toContain('<b className="text-white"><Cut text={r.title} kind="test" /></b>');
    expect(page).toContain('<p className="kicker"><Cut text={t.productName} kind="product" /></p>');
    const test = src("app/app/tests/[id]/page.tsx");
    expect(test).toContain('<h3 className="mr-auto inline font-semibold text-white" data-tester-fold-name=""><NameLink text={name} href={personHref} /></h3>'); // (batch 35 §140) the name folds the row; (§166) it is the green profile link
    expect(src("app/app/find/page.tsx")).toContain("by <Cut text={displayName(t.developer)} />");
    expect(src("app/app/messages/page.tsx")).toContain('<Cut text={r.title} kind="test" />');
    expect(src("components/PersonHover.tsx")).toContain("<NameLink text={p.name} href={p.href}"); // (§166) NameLink cuts it too
    expect(src("app/app/CallsBox.tsx")).toContain('<b className="text-white"><Cut text={c.who} /></b> · <Cut text={c.test} kind="test" />');
    expect(src("app/app/calls/[id]/page.tsx")).toContain('“<Cut text={call.contract.title} kind="test" />”');
    expect(src("app/admin/AdminRich.tsx")).toContain("<Cut");
    // Left alone: a page's own heading, the bell's and emails' words, and the payment sentences (already cut by pieceName).
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('<h1 className="text-3xl font-bold tracking-tight text-white">{p.title}</h1>');
    expect(src("app/app/calls/[id]/page.tsx")).toContain("Call with {otherName}</h1>");
  });
});
