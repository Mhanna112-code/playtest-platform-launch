import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 3) The paperclip looks the same, plain and one-colour, on phones and computers (Windows' colour emoji has eyes).
describe("plain paperclip", () => {
  it("the attach button is an icon, and the 📎 in text uses a one-colour symbol face first", () => {
    const actions = fs.readFileSync("src/app/app/sessions/[id]/SessionActions.tsx", "utf8");
    expect(actions).toContain('title="Attach a file"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" /><input');
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/@font-face \{\s*font-family: "Plain Clip";\s*src: local\("Segoe UI Symbol"\)[^;]*;\s*unicode-range: U\+1F4CE;/);
    expect(css).toContain('--font-sans: "Plain Clip", "Inter Variable";');
  });
});
