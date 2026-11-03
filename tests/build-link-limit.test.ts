import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { BUILD_URL_TOO_LONG } from "@/lib/listingFields";

// (Owner, Nov 3) The product or build link: up to 2,048 characters, counted at the box, and refused (never silently cut) when longer.
describe("build link limit", () => {
  it("is 2,048 and says so", () => {
    expect(LIMITS.buildUrl).toBe(2048);
    expect(BUILD_URL_TOO_LONG).toBe("The build link can be up to 2,048 characters.");
  });
  it("the box shows a counter and the server refuses instead of cutting", () => {
    expect(fs.readFileSync("src/app/app/tests/TestForm.tsx", "utf8")).toMatch(/text\("buildUrl", "Link to the product or build", \{[^\n]*max: LIMITS\.buildUrl/);
    const server = fs.readFileSync("src/lib/server/tests.ts", "utf8");
    expect(server).not.toContain("str(body.buildUrl, 500)");
    expect(server).toMatch(/out\.buildUrl\.length > LIMITS\.buildUrl\) throw new HttpError\(400, "bad_url", BUILD_URL_TOO_LONG\)/);
  });
});
