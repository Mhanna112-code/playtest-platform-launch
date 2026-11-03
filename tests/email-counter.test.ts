import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_MAX, isEmail } from "@/lib/format";

// (Owner, Nov 3) Every box with a limit shows its count: the email boxes count to 254.
describe("email boxes have a character count", () => {
  it("sign-up, log in and forgot password use the counted input with the email limit", () => {
    for (const f of ["src/app/signup/page.tsx", "src/app/login/LoginForm.tsx", "src/app/forgot/page.tsx"]) expect(fs.readFileSync(f, "utf8")).toContain("<CountedInput maxLength={EMAIL_MAX}");
    expect(EMAIL_MAX).toBe(254);
    expect(isEmail(`${"a".repeat(242)}@example.com`)).toBe(true);
    expect(isEmail(`${"a".repeat(243)}@example.com`)).toBe(false);
  });
});
