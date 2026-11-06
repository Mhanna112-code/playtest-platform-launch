import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("(Owner, Nov 5) §260 no 'What you sent is for the questions until …' line", () => {
  it("the tester's answer form has no set-until line", () => {
    const s = fs.readFileSync(path.resolve(__dirname, "../src/app/app/sessions/[id]/page.tsx"), "utf8");
    expect(s).not.toContain("data-set-until-form");
    expect(s).not.toContain("What you sent is for the questions until");
  });
});
