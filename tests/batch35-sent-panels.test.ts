import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { clampPanel, Fold, keepFold, keepHeight, keptFold, keptHeight, PANEL_DEFAULT_MAX, PANEL_MAX_SHARE, PANEL_MIN_PX, ResizeBox } from "@/components/Panel";

// (Owner, Nov 3, batch 35 §139) Sent written answers and recordings in the developer's tester rows and Needs you: a small panel (so the Pay / Pay more box under
// it is in view) that drags taller or shorter and scrolls inside, and two folds under each part (its body; its Pay or Pay more box).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const REM = 16;

/** A tab's sessionStorage for the helpers (the tests run without a browser). */
function fakeWindow(blocked = false) {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => { if (blocked) throw new Error("blocked"); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (blocked) throw new Error("blocked"); m.set(k, v); },
  };
  (globalThis as unknown as { window: unknown }).window = { sessionStorage: storage, innerHeight: 800 };
  return m;
}
afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window; });

describe("the panel's height", () => {
  it("starts small: about 12rem (6–8 lines) and never more than 40% of the screen, so the Pay box under it shows", () => {
    expect(PANEL_DEFAULT_MAX).toBe("min(12rem, 40vh)");
    const h = renderToStaticMarkup(createElement(ResizeBox, { id: "p1", label: "Written answers", children: createElement("p", null, "answer") }));
    expect(h).toContain("max-height:min(12rem, 40vh)");
    expect(h).toContain('data-panel-height="default"');
    expect(h).toContain("overflow-y-auto"); // the content scrolls inside at any height
    // A short piece is only as tall as it is (a max-height, not a fixed height).
    expect(h).not.toMatch(/style="height:/);
  });

  it("the grip drags it shorter than the default (down to about 3 lines) and taller (up to 60% of the screen)", () => {
    const viewport = 800;
    expect(PANEL_MIN_PX).toBe(5 * REM);
    expect(clampPanel(100, viewport)).toBe(100); // shorter than the 12rem (192 px) default
    expect(clampPanel(100, viewport)).toBeLessThan(12 * REM);
    expect(clampPanel(10, viewport)).toBe(PANEL_MIN_PX);
    expect(clampPanel(450, viewport)).toBe(450);
    expect(clampPanel(5000, viewport)).toBe(viewport * PANEL_MAX_SHARE);
    // The grip is a keyboard control too (a separator with the arrow keys).
    const h = renderToStaticMarkup(createElement(ResizeBox, { id: "p2", label: "Recordings", children: "x" }));
    expect(h).toMatch(/role="separator"[^>]*aria-label="Resize Recordings: drag, or use the up and down arrow keys"[^>]*tabindex="0"[^>]*data-panel-grip=""/);
    expect(src("components/Panel.tsx")).toContain('e.key === "ArrowUp" ? now - PANEL_STEP_PX');
  });

  it("a dragged height is kept for that panel in this tab (and nothing breaks when storage is blocked)", () => {
    fakeWindow();
    expect(keptHeight("needs-a")).toBeNull();
    keepHeight("needs-a", 120);
    expect(keptHeight("needs-a")).toBe(120);
    expect(keptHeight("needs-b")).toBeNull();
    fakeWindow(true);
    expect(() => keepHeight("needs-a", 120)).not.toThrow();
    expect(keptHeight("needs-a")).toBeNull();
  });
});

describe("two folds under each part", () => {
  it("each fold has its own toggle and starts open; its state is kept while the page redraws", () => {
    const h = renderToStaticMarkup(createElement("div", null,
      createElement(Fold, { id: "needs-body-s1", summary: "Their written answers", children: "answers" }),
      createElement(Fold, { id: "needs-pay-s1", summary: "Pay", children: "pay box" })));
    expect(h.match(/<details open=""[^>]*data-fold="needs-(body|pay)-s1"/g)).toHaveLength(2);
    expect(h).toContain(">Their written answers</summary>");
    expect(h).toContain(">Pay</summary>");
    fakeWindow();
    expect(keptFold("needs-pay-s1")).toBeNull(); // never toggled: as drawn (open)
    keepFold("needs-pay-s1", false);
    keepFold("needs-body-s1", true);
    expect(keptFold("needs-pay-s1")).toBe(false); // Pay closed, the body still open: each its own
    expect(keptFold("needs-body-s1")).toBe(true);
  });

  it("Needs you and the tester rows put each part's body and its Pay / Pay more box in their own folds, the body in the panel", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    for (const [body, pay, box] of [["needs-body-${x.s!.id}", "needs-pay-${x.s!.id}", "needs-${x.s!.id}"], ["update-body-${x.id}", "update-pay-${x.id}", "update-${x.id}"], ["row-body-${r.sub.id}", "row-more-${r.sub.id}", "row-${r.sub.id}"]]) {
      const b = page.indexOf(`<Fold id={\`${body}\`}`), p = page.indexOf(`<Fold id={\`${pay}\``), r = page.indexOf(`<ResizeBox id={\`${box}\`}`);
      expect(b).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(b); // the panel inside the body fold
      expect(p).toBeGreaterThan(r); // the Pay box's fold after it
      expect(page.slice(p, page.indexOf("</Fold>", p))).toContain("<PayBox");
    }
    expect(page).toContain('<Fold id={`needs-pay-${x.x!.id}`} summary="Pay">'); // a call's Pay box too
    expect(page).toContain('<Fold id={`row-more-${x.id}`} summary="Pay more">');
    expect(page).not.toContain("<AnswersBox>");
  });

  it("a link straight to a part (or into it) opens its folds", () => {
    const jump = src("lib/markJump.ts");
    expect(jump).toContain('el.querySelectorAll<HTMLDetailsElement>("details[data-jump-open]").forEach((d) => { d.open = true; });');
    expect(jump).toContain("if (p instanceof HTMLDetailsElement && !p.open) p.open = true;");
    expect(src("components/Panel.tsx")).toContain('data-jump-open=""');
  });
});
