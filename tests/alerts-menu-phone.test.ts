import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Found while recording the report on a 375-pixel phone (scripts/media.cjs, group "alerts"): the menu hung off the left edge, so its ticks couldn't be reached.
describe("the Alerts menu on a phone", () => {
  it("opens in the page under the button on small screens", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/components/AlertsMenu.tsx"), "utf8");
    expect(src).toContain("max-sm:static max-sm:w-full");
  });
});
