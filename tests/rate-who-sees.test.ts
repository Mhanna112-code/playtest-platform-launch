import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

// (Owner, Dec 2026; replaces "(shown without your name)") The Rate box says who sees the rating: the tester's, by name to the developer once they rate back or
// when their time to rate ends (no day count); the developer's, by name to the tester. Both: without the name on the rated person's profile.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("the Rate box's who-sees line", () => {
  it("the tester's and the developer's wording", () => {
    expect(R.rateWhoSeesLine("tester", "Nora Lane")).toBe("1 to 5, and a note if you like. Nora Lane sees it with your name once Nora Lane rates you or when Nora Lane's time to rate ends. On Nora Lane's profile it shows without your name.");
    expect(R.rateWhoSeesLine("developer", "Ana Silva")).toBe("1 to 5, and a note if you like. Ana Silva sees it with your name. On Ana Silva's profile it shows without your name.");
  });

  it("each box passes its side; the old sentence is gone; the working headline still follows", () => {
    const box = src("components/RateBox.tsx");
    expect(box).not.toContain("(shown without your name)");
    expect(box).toContain("{rateWhoSeesLine(p.rater, p.name)}{p.working ? ` ${p.headline}` : \"\"}");
    expect(src("app/app/sessions/[id]/page.tsx")).toMatch(/<RateBox\s+rater="tester"/);
    expect(src("app/app/tests/[id]/page.tsx")).toMatch(/<RateBox key=\{`rate-\$\{c\.id\}`\} rater="developer"/);
  });
});
