import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 2) The home page keeps its two buttons when signed in: each opens that side through the side switch's POST.
describe("home page, signed in", () => {
  const src = fs.readFileSync("src/app/page.tsx", "utf8");
  it("shows Get feedback on my build (developer) and Earn as a tester (tester), not one dashboard button", () => {
    expect(src).not.toContain(">Go to your dashboard <ArrowRight");
    expect(src).toMatch(/action="\/app\/switch"><input type="hidden" name="to" value="developer" \/>[^\n]*Get feedback on my build/);
    expect(src).toMatch(/action="\/app\/switch"><input type="hidden" name="to" value="tester" \/>[^\n]*Earn as a tester/);
  });
});
