import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOUCH_GRIP_PX, TOUCH_MIN_PX, onGrip, touchHeight } from "@/components/TouchResize";

// (Owner, Nov 3) Phones have no drag corner on text boxes: every text box gets a grip a finger can drag, and the sent-work panels' grip is finger-sized.
describe("text boxes drag on touch screens", () => {
  it("drags taller or shorter, never below about two lines", () => {
    expect(touchHeight(100, 40)).toBe(140);
    expect(touchHeight(100, -30)).toBe(70);
    expect(touchHeight(100, -90)).toBe(TOUCH_MIN_PX);
  });
  it("only a touch in the bottom-right corner drags", () => {
    const r = { right: 300, bottom: 200 };
    expect(onGrip(290, 190, r)).toBe(true);
    expect(onGrip(300 - TOUCH_GRIP_PX, 200 - TOUCH_GRIP_PX, r)).toBe(true);
    expect(onGrip(200, 190, r)).toBe(false);
    expect(onGrip(290, 120, r)).toBe(false);
  });
  it("is mounted on every page, the grip mark shows on touch screens, and the panel grip is finger-sized there", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<TouchResize />");
    expect(readFileSync("src/app/globals.css", "utf8")).toMatch(/@media \(pointer: coarse\) \{\s*textarea:not\(:disabled\):not\(\[readonly\]\) \{\s*background-image/);
    expect(readFileSync("src/components/Panel.tsx", "utf8")).toContain("[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9");
  });
});
