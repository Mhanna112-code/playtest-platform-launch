import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 3) The tester can copy their access key with one press.
describe("access key copy", () => {
  const src = fs.readFileSync("src/app/app/sessions/[id]/KeyBox.tsx", "utf8");
  it("has a Copy button that copies the key, says Copied, and isn't offered on a key marked as not working", () => {
    expect(src).toContain('import { copyText } from "@/components/Cut";');
    const at = src.indexOf("{!(broken || said) && (");
    expect(at).toBeGreaterThan(0);
    const button = src.slice(at, src.indexOf("</button>", at));
    expect(button).toContain('data-key-copy=""');
    expect(button).toContain("await copyText(value)");
    expect(src).toContain('{copied === "yes" ? "Copied" : "Copy"}');
    expect(src).toContain("Couldn&apos;t copy: select the key and copy it.");
  });
});
