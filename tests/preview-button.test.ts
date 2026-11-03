import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 3) Under each answer box the preview is hidden until "Preview" is pressed (it names the files placed in the answer); "Hide preview" closes it.
describe("answer preview button", () => {
  const src = fs.readFileSync("src/app/app/sessions/[id]/SessionActions.tsx", "utf8");
  it("starts hidden and opens on the button", () => {
    expect(src).toContain("const [preview, setPreview] = useState(false);");
    expect(src).toContain('{preview ? "Hide preview" : `Preview${files ? ` (${files} ${files === 1 ? "file" : "files"})` : ""}`}');
    expect(src).toContain("{preview && value.trim() && (");
    expect(src).toContain('aria-expanded={preview} data-preview-toggle=""');
  });
});
