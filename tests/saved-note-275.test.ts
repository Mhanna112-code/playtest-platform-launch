import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAVED_NOTE_MS } from "@/components/SavedNote";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("(Owner, Nov 5) §275 the Save's note: at the top, just Saved., fades or closes", () => {
  it("sits above the Listing panel, not under Invite, and reads Saved. with only what else the Save did", () => {
    const s = read("src/app/app/tests/[id]/page.tsx");
    expect(s.indexOf("<SavedNote>")).toBeLessThan(s.indexOf("<ListingPanel "));
    expect(s.indexOf("<SavedNote>")).toBeLessThan(s.indexOf("<InvitePanel"));
    expect(s).not.toContain("New testers join on the new listing; testers already in keep their contract");
    expect(s).toMatch(/<SavedNote><p className="ok">\s*Saved\./);
  });
  it("fades after 8 s and has a ×", () => {
    expect(SAVED_NOTE_MS).toBe(8_000);
    const n = read("src/components/SavedNote.tsx");
    expect(n).toContain("setTimeout(() => setShown(false), SAVED_NOTE_MS)");
    expect(n).toContain('aria-label="Close" data-saved-close=""');
  });
});
