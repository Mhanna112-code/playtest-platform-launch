import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, Cut, cutText, openLabel, opensPopup, touchOnly } from "@/components/Cut";
import { cut10, cutEmail, cutTo } from "@/lib/rules";

// (Owner, Nov 3) Names listed on a page are cut at 12 characters (was 10; owner, Nov 5, §203: 20) with "…" (emails in the middle); the full text stays in the page (copy, hover, screen readers),
// and on a touch screen a tap on a cut name opens a pop-up with the full text, its link and Copy.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (text: string, kind?: "person" | "test" | "product" | "email") => renderToStaticMarkup(createElement(Cut, { text, kind }));

describe("the cut rule", () => {
  it("cuts a name longer than 20 characters at 20, with …; 20 or fewer stay as they are (§203: was 12)", () => {
    expect(cutTo("Ana Silva")).toBe("Ana Silva");
    expect(cutTo("Abcdefghij")).toBe("Abcdefghij");
    expect(cutTo("Abcdefghijklmnopqrstu")).toBe("Abcdefghijklmnopqrst…");
    expect(cutTo("Abcdefghijklmnopqrst")).toBe("Abcdefghijklmnopqrst");
    expect(cutTo("Alexandria Montgomery")).toBe("Alexandria Montgomer…");
    // A space at the cut is dropped, as cut10 does; the payment lines' rule is unchanged.
    expect(cutTo("Harbor Runs Seventy and on")).toBe("Harbor Runs Seventy…");
    expect(cutTo("Harbor Runs Seventy and on")).toBe(cut10("Harbor Runs Seventy and on"));
    // By characters: an emoji is never split in half.
    expect(cutTo("😀".repeat(21))).toBe(`${"😀".repeat(20)}…`);
  });

  it("cuts an email in the middle: 20 characters before @ when that part is longer than 21; the domain only past 14 (§203: was 12)", () => {
    expect(cutEmail("ana@playtest.test")).toBe("ana@playtest.test");
    expect(cutEmail("abcdefg@playtest.test")).toBe("abcdefg@playtest.test");
    expect(cutEmail("maximiliana.alexandrina@playtest.test")).toBe("maximiliana.alexandr…@playtest.test");
    expect(cutEmail("maximiliana.alexandri@playtest.test")).toBe("maximiliana.alexandri@playtest.test"); // 21: not cut
    expect(cutEmail("ana@very-long-company-domain.example.com")).toBe("ana@very-long-comp…");
    expect(cutEmail("maximiliana.alexandrina@very-long-company-domain.example.com")).toBe("maximiliana.alexandr…@very-long-comp…");
    expect(cutEmail("abc@exactly14chars")).toBe("abc@exactly14chars");
    expect(cutText("maximiliana.alexandrina@playtest.test", "email")).toBe("maximiliana.alexandr…@playtest.test");
  });
});

describe("<Cut>", () => {
  it("a short name is drawn exactly as before: no wrapper, no underline, no title", () => {
    expect(html("Ana Silva")).toBe("Ana Silva");
    expect(html("ana@playtest.test", "email")).toBe("ana@playtest.test");
  });

  it("(§245) a person's, a test's and a product's name are never cut (at most 20 characters); an email still is, with the full text kept", () => {
    expect(html("Alexandria Montgomery-Wellington")).toBe("Alexandria Montgomery-Wellington");
    expect(html("Underwater Harbor Run Deluxe", "test")).toBe("Underwater Harbor Run Deluxe");
    expect(html("Underwater Harbor Run Deluxe Edition", "product")).toBe("Underwater Harbor Run Deluxe Edition");
    const e = html("maximiliana.alexandrina@playtest.test", "email");
    expect(e).toContain('title="maximiliana.alexandrina@playtest.test"');
    // The full email, visually hidden, right after the cut one: selecting and copying the row gives the full email.
    expect(e).toContain('data-cut="email"');
    expect(e).toContain(">maximiliana.alexandr…@playtest.test</span>");
    expect(e).toContain('data-cut-full="">maximiliana.alexandrina@playtest.test</span>');
  });

  it("the pop-up opens only for a cut name or email (§244: every device; §245: only an email is still cut)", () => {
    expect(opensPopup(true, true)).toBe(true);
    expect(opensPopup(true, false)).toBe(true); // (§244) every device
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
    expect(cut).toContain("if (!opensPopup(fit ? overflows(e.currentTarget) && Array.from(full).length > n : cut, touchOnly())) return;"); // (§244) 20 characters or fewer never opens it // (§187) a fitted name: when it is cut right now
    expect(cut).toContain("max-w-[78vw]");
    expect(cut).toContain('<ResizeBox id={`cut-${kind}-${full.slice(0, 40)}`}') // (§244) the whole name in the draggable box; // the full text: a scroll box about 6 lines tall
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
    expect(page).toContain('<b><TestName text={r.title} /></b>'); // (§245) whole and green
    expect(page).toContain('<p className="kicker"><Cut text={t.productName} kind="product" /></p>');
    const test = src("app/app/tests/[id]/page.tsx");
    expect(test).toContain('<h3 className="mr-auto min-w-0 max-w-[calc(100%-1.25rem)] font-semibold text-white" data-tester-fold-name=""><NameLink fit text={name} href={personHref} /></h3>'); // (batch 35 §140) the name folds the row; (§166) it is the green profile link
    expect(src("app/app/find/page.tsx")).toContain("by <Cut text={displayName(t.developer)} />");
    expect(src("app/app/messages/page.tsx")).toContain('<TestName text={r.title} />');
    expect(src("components/PersonHover.tsx")).toContain("<NameLink text={p.name} href={p.href}"); // (§166) NameLink cuts it too
    expect(src("app/app/CallsBox.tsx")).toContain('<b className="text-white"><Cut text={c.who} /></b> · <TestName text={c.test} />');
    expect(src("app/app/calls/[id]/page.tsx")).toContain('“<Cut text={call.contract.title} kind="test" />”');
    expect(src("app/admin/AdminRich.tsx")).toContain('<Cut key={m.index} text={m[0]} kind="email" />'); // (§245) only emails are cut there
    // Left alone: a page's own heading, the bell's and emails' words, and the payment sentences (already cut by pieceName).
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('<h1 className="text-3xl font-bold tracking-tight text-white">{p.title}</h1>');
    expect(src("app/app/calls/[id]/page.tsx")).toContain("Call with {otherName}</h1>");
  });
});
