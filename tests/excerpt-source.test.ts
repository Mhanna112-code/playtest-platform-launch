import { describe, expect, it } from "vitest";
import { excerptSource } from "@/lib/server/excerpts";

// Fixes found while recording the owner's report (scripts/media.cjs).
describe("report pass: an excerpt's unnamed source", () => {
  const src = (categories: string[]) => excerptSource({ hideProduct: true, test: { productName: "Sky Lab", title: "Sky Lab: tutorial", categories } });
  it("uses “an” before a vowel and keeps AI in capitals", () => {
    expect(src(["Education"])).toBe("an education test");
    expect(src(["Entertainment"])).toBe("an entertainment test");
    expect(src(["AI"])).toBe("an AI test");
    expect(src(["Game"])).toBe("a game test");
    expect(src([])).toBe("a test");
  });
  it("names the product when the tester unticked “Don't name the product”", () => {
    expect(excerptSource({ hideProduct: false, test: { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"] } })).toBe("Sky Lab");
  });
});
