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

  it("(owner, Nov 3) each sent part is its own drop-down: inside it the body panel, then its Pay / Pay more box", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    // (Owner, Nov 4, §181) Needs you's parts are HoldFolds (closed at first, in the person's drop-down), each with its Pay / Pay more as one more drop-down.
    for (const [part, box] of [["needs-part-${x.id}", "needs-${x.s!.id}"], ["update-part-${x.id}", "update-${x.id}"], ["row-part-${r.sub.id}", "row-${r.sub!.id}"]]) {
      const f = Math.max(page.indexOf(`<Fold id={\`${part}\``), page.indexOf(`"data-fold": \`${part}\``)), r = page.indexOf(`<ResizeBox id={\`${box}\`}`);
      expect(f, part).toBeGreaterThan(0);
      expect(r, part).toBeGreaterThan(f); // the panel inside the part's fold (§282: a recording's; a written part's is its Questions drop-down's own)
      expect(page.indexOf("<PayBox", r), part).toBeGreaterThan(r); // the Pay box after it
    }
    // No separate folds for the body any more; (§181) in Needs you the Pay / Pay more box is its own drop-down again (owner: "pay/pay more as own dropdowns").
    for (const old of ["needs-body-", "needs-pay-", "update-body-", "update-pay-", "row-body-"]) expect(page).not.toContain(`<Fold id={\`${old}`);
    for (const pay of ["needs-pay-${x.id}", "update-pay-${x.id}"]) expect(page.indexOf("<PayBox", page.indexOf(`"data-fold": \`${pay}\``)), pay).toBeGreaterThan(0);
    expect(page).toContain('<Fold id={`row-call-${x.id}`}'); // each call under the Calls fold is its own drop-down too, its Pay more inside
    expect(page).not.toContain('<Fold id={`row-more-');
    expect(page).not.toContain("<AnswersBox>");
  });

  it("a link straight to a part (or into it) opens its folds", () => {
    const jump = src("lib/markJump.ts");
    expect(jump).toContain('el.querySelectorAll?.<HTMLDetailsElement>("details[data-jump-open]").forEach((d) => { d.open = true; });');
    expect(jump).toContain("if (p instanceof HTMLDetailsElement && !p.open) p.open = true;");
    // (§167) Every fold but a written part's question folds (`jumpOpen={false}`).
    expect(src("components/Panel.tsx")).toContain('data-jump-open={jumpOpen ? "" : undefined}');
  });
});
