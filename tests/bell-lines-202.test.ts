import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BELL_LINE_SHOWN, bellShort } from "@/lib/bell";
import { NAME_CUT, cutEmail, cutTo, pieceName } from "@/lib/rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/app/notifications", useSearchParams: () => new URLSearchParams() }));
import { BellList } from "@/app/app/notifications/BellList";

const oldReact = globalThis.React;
vi.stubGlobal("React", React);
afterAll(() => { vi.stubGlobal("React", oldReact); });
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

// (Owner, Nov 5, §202) A bell line shows its first 30 characters then "…", never inside a word or an amount; its arrow opens the whole line (names uncut).
// (Owner, Nov 5, §203) Listed names are cut at 20 characters (was 12).
describe("§202 bell lines: 30 characters, then the whole line on the arrow", () => {
  it("short lines stay whole; long ones cut at a word boundary, never inside an amount", () => {
    expect(BELL_LINE_SHOWN).toBe(30);
    expect(bellShort("Your tests are running again")).toBeNull();
    expect(bellShort("x".repeat(30))).toBeNull();
    // The 30th character falls inside "$1,000.00": the cut goes back to the space before it.
    expect(bellShort("Charged by the tester: $1,000.00 for Ana Silva's written answers")).toBe("Charged by the tester…"); // (a trailing ":" goes with the cut)
    expect(bellShort("You paid $10.00 for Ana Silva's written answers on “Harbor Run”")).toBe("You paid $10.00 for Ana…"); // ("Silva's" would end at 31)
    // Exactly at a space: kept as is.
    expect(bellShort("The team approved lifting your hold: your tests are running again.")).toBe("The team approved lifting your…");
    // One word longer than 30: cut as is (by character: an emoji never split).
    expect(bellShort("🎮".repeat(40))).toBe(`${"🎮".repeat(30)}…`);
  });

  it("the list: the cut words follow the link, the arrow (aria-expanded) opens the whole line; a short line has no arrow; stack headings unchanged", () => {
    const long = "You paid $15.00 for Cara Diaz's live call on “Underwater Harbor Run Deluxe Edition” (Tue, Oct 27, 3:25 PM EST, charged automatically after 7 days)";
    const html = renderToStaticMarkup(
      React.createElement(BellList, { entries: [
        { key: "solo|1", lines: [{ id: "1", text: long, href: "/app/tests/t#call-1", read: false, ago: "2m ago" }] },
        { key: "solo|2", lines: [{ id: "2", text: "Your tests are running again", href: "/app", read: false, ago: "3m ago" }] },
        { key: "group:devpaid|d", title: "Paid · 2 payments", counted: true, day: "today", lines: [{ id: "3", text: long, href: "/app", read: false, ago: "1m ago" }, { id: "4", text: "You paid $4.00 for Ana Silva's written answers on “Harbor Run”", href: "/app", read: false, ago: "1m ago" }] },
      ] }),
    );
    expect(html).toContain(">You paid <span");
    expect(html).toContain(" for Cara…</a>");
    expect(html).not.toContain("Underwater Harbor Run Deluxe Edition"); // closed: only the cut words
    expect(html.match(/data-bell-toggle="1"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false" aria-label="Show the whole line" data-bell-toggle="1"');
    expect(html).not.toContain('data-bell-toggle="2"');
    expect(html).toContain(">Your tests are running again</a>");
    // The heading is unchanged ("Paid · 2 payments today"); its preview of the newest line is cut at 30 the same way.
    expect(html).toContain("Paid · 2 payments today");
    // The whole line: opened by the arrow, read like a click, in a small scroll box.
    const list = src("app/app/notifications/BellList.tsx");
    expect(list).toContain("if (!wide) markRead([l]);");
    expect(list).toContain('max-h-32 overflow-y-auto');
    expect(list).toContain("{keepAmounts(l.text)}");
  });
});

describe("§203 listed names cut at 20 characters", () => {
  it("NAME_CUT is 20: names, tests and an email's local part", () => {
    expect(NAME_CUT).toBe(20);
    expect(cutTo("Underwater Harbor Run Deluxe")).toBe("Underwater Harbor Ru…");
    expect(cutTo("Underwater Harbor Ru")).toBe("Underwater Harbor Ru");
    expect(cutEmail("maximiliana.alexandrina.lopez@playtest.test")).toBe("maximiliana.alexandr…@playtest.test");
    expect(pieceName({ tester: "Maximiliana Alexandrina", part: "written answers", test: "Underwater Harbor Run Deluxe" })).toBe("Maximiliana Alexandr…'s written answers on “Underwater Harbor Ru…”");
    expect(pieceName({ tester: "Maximiliana Alexandrina", part: "written answers", test: "Underwater Harbor Run Deluxe", full: true })).toBe("Maximiliana Alexandrina's written answers on “Underwater Harbor Run Deluxe”");
  });
});
