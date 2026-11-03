import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// (Owner, Nov 3, batch 35 §138) A text box dragged taller has a cap: 60% of the screen (32rem at most), then its text scrolls inside.
const root = path.resolve(__dirname, "../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : []; });

describe("text boxes have a height cap", () => {
  it("every textarea stops at min(60vh, 32rem) and scrolls inside", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).toMatch(/textarea \{ max-height: min\(60vh, 32rem\); overflow-y: auto; \}/);
    // Outside any @layer and after the utilities, so no class on a box lifts it.
    expect(css.indexOf("textarea { max-height")).toBeGreaterThan(css.indexOf("@tailwind utilities;"));
  });

  it("no text box opts out of the cap (answers, steps, questions, notes, reasons, the bio)", () => {
    const boxes = files(root).flatMap((f) => (readFileSync(f, "utf8").match(/<textarea[^>]*>/g) ?? []).map((t) => ({ f, t })));
    expect(boxes.length).toBeGreaterThan(10);
    for (const b of boxes) expect(b.t, path.relative(root, b.f)).not.toMatch(/max-h-(none|screen|\[)|maxHeight/);
  });
});
