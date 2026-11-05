import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cancelledLine, CANCELLED_WHY, stillPaysLine } from "@/lib/bankNotice";
import { BankCheckView, BankNotice, NOTICE_LINES_SHOWN, isAtBottom, noticeCount } from "@/components/BankCheck";
import { InsidePanel } from "@/components/Panel";

// (Owner, Nov 4, §194) The bank notice's list of change lines: more than 4 sit in a scroll box (about 4–5 lines tall, the app's panel with a grip, kept per check)
// with "N changes" above it; the final line (Complete still pays … / cancelled …) stays outside it. The bank box is its own element: the list scrolls on its own
// even inside Needs you's panel (an exception to §187).

(globalThis as unknown as { React: typeof React }).React = React;
const action = { requiresAction: true as const, paymentId: "pay-194", clientSecret: "", publishableKey: "", simulated: false, checkUrl: "https://hooks.stripe.com/3d_secure_2/hosted?fake=1" };
const linesOf = (n: number) => Array.from({ length: n }, (_, i) => `Change number ${i + 1} happened.`);
const view = (lines: string[], extra: Partial<{ still: string; cancelled: string }> = {}) =>
  renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {}, notice: { lines, still: stillPaysLine("$10.00"), cancelled: "", ...extra } }));

describe("§194 the bank notice's change lines scroll inside the bank box once there are more than 4", () => {
  it("3 lines: a plain list, no scroll box and no count", () => {
    const html = view(linesOf(3));
    expect(NOTICE_LINES_SHOWN).toBe(4);
    expect(html.match(/data-bank-notice-line/g)).toHaveLength(3);
    expect(html).not.toContain("data-bank-notice-scroll");
    expect(html).not.toContain("data-bank-notice-count");
    expect(html).not.toContain("data-panel=\"bank-notice-");
    expect(html).toMatch(/data-bank-notice-line="">Change number 3 happened\.<\/li><\/ul><p class="font-semibold" data-bank-notice-still="">Complete still pays \$10\.00 as pressed/);
  });

  it("4 lines: still no scroll box", () => {
    expect(view(linesOf(4))).not.toContain("data-bank-notice-scroll");
  });

  it("12 lines: the scroll box (the app's panel, kept per check, with its grip), \"12 changes\" above it, the final line outside it", () => {
    const html = view(linesOf(12));
    expect(html.match(/data-bank-notice-line/g)).toHaveLength(12);
    expect(html).toContain('role="status" aria-live="polite" data-bank-notice=""');
    expect(html).toContain(`<p class="text-xs text-sky-100/80" data-bank-notice-count="">12 changes</p>`);
    // the count, then the scroll box holding every line, then the final line
    const count = html.indexOf("data-bank-notice-count"), scroll = html.indexOf("data-bank-notice-scroll"), still = html.indexOf("data-bank-notice-still");
    expect(count).toBeGreaterThan(-1);
    expect(count).toBeLessThan(scroll);
    expect(scroll).toBeLessThan(still);
    const box = html.slice(scroll, still);
    expect(box).toContain('data-panel="bank-notice-pay-194"');
    expect(box).toContain("data-panel-box");
    expect(box).toContain("data-panel-grip");
    expect(box).toContain("max-height:8rem");
    expect(box.match(/data-bank-notice-line/g)).toHaveLength(12);
    // the final line is outside the scroll box: the box (its panel) closes before it
    expect(html.slice(still)).not.toContain("data-bank-notice-line");
    expect(html).toMatch(/<\/span><\/div><\/div><p class="font-semibold" data-bank-notice-still="">Complete still pays \$10\.00 as pressed; or press Cancel\.<\/p><\/div>/);
  });

  it("a cancelled check: its line stays outside the scroll box too", () => {
    const html = view(linesOf(12), { cancelled: cancelledLine(CANCELLED_WHY.hold) });
    const scroll = html.indexOf("data-bank-notice-scroll"), cancelled = html.indexOf("data-bank-notice-cancelled");
    expect(scroll).toBeGreaterThan(-1);
    expect(cancelled).toBeGreaterThan(scroll);
    expect(html.slice(cancelled)).not.toContain("data-bank-notice-line");
    expect(html).not.toContain("data-bank-notice-still");
  });

  it("inside Needs you's panel (§187 makes inner panels plain), the notice's list still scrolls on its own", () => {
    const html = renderToStaticMarkup(createElement(InsidePanel, null, createElement(BankNotice, { id: "pay-194", notice: { lines: linesOf(12), still: stillPaysLine("$10.00"), cancelled: "" } })));
    expect(html).toContain('data-panel="bank-notice-pay-194"');
    expect(html).toContain("data-panel-box");
    expect(html).not.toContain("data-panel-flat");
  });

  it("the count reads naturally, and a new line follows only a reader already at the bottom", () => {
    expect(noticeCount(5)).toBe("5 changes");
    expect(noticeCount(12)).toBe("12 changes");
    expect(noticeCount(1)).toBe("1 change");
    expect(isAtBottom({ scrollHeight: 400, scrollTop: 272, clientHeight: 128 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 400, scrollTop: 268, clientHeight: 128 })).toBe(true);
    expect(isAtBottom({ scrollHeight: 400, scrollTop: 100, clientHeight: 128 })).toBe(false);
    const src = fs.readFileSync(path.resolve(__dirname, "../src/components/BankCheck.tsx"), "utf8");
    // the reader's place is read from their own scrolling; a line arriving scrolls to the bottom only if they were there
    expect(src).toMatch(/const seen = \(\) => \{ atBottom\.current = isAtBottom\(el\); \};/);
    expect(src).toMatch(/if \(el && atBottom\.current\) el\.scrollTop = el\.scrollHeight;\s+\}, \[notice\.lines\.length\]\);/);
  });
});
