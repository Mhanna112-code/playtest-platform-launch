import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAVED_NOTE_MS } from "@/components/SavedNote";
import { savedHref, savedNoteText } from "@/lib/savedNote";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("(Owner, Nov 5) §275 revised: Save stays on Edit and shows Saved. there", () => {
  it("a Save that goes through loads Edit again (replaced, not pushed) with what the Save did; the test page is no longer the destination", () => {
    const form = read("src/app/app/tests/TestForm.tsx");
    expect(form).toContain("window.location.replace(savedHref(edit.id, r));");
    expect(form).not.toContain("/app/tests/${edit.id}?saved=1");
    // The drafts this Save sent still go first; Post a test still opens the new test page (no note there).
    expect(form.indexOf("await keep.clear(new Set(")).toBeLessThan(form.indexOf("window.location.replace(savedHref(edit.id, r));"));
    expect(form).toContain("window.location.href = `/app/tests/${r.id}`;");
    expect(savedHref("t1", { offered: 0 })).toBe("/app/tests/t1/edit?saved=1&offered=0");
    expect(savedHref("t1", { offered: 2, closedApps: ["Ana", "Ben"], resent: ["Cy"], notReinvited: ["Dot"] })).toBe("/app/tests/t1/edit?saved=1&offered=2&closed=Ana%2C%20Ben&resent=Cy&skipped=Dot");
  });

  it("the note reads Saved., with the extras only when they apply; extras make it stay until ×", () => {
    expect(savedNoteText({})).toBeNull();
    expect(savedNoteText({ saved: "1", offered: "0" })).toEqual({ text: "Saved.", extras: false });
    expect(savedNoteText({ saved: "1", offered: "1" })).toEqual({ text: "Saved. Offered the new terms to 1 working tester.", extras: true });
    expect(savedNoteText({ saved: "1", offered: "3", closed: "Ana, Ben", resent: "Cy", skipped: "Dot (account closed)" })).toEqual({
      text: "Saved. Offered the new terms to 3 working testers. Closed 2 applications: Ana, Ben. Invites re-sent on the new listing: Cy. Not re-invited: Dot (account closed).",
      extras: true,
    });
    expect(savedNoteText({ saved: "1", offered: "0", closed: "Ana" })?.text).toBe("Saved. Closed 1 application: Ana.");
  });

  it("Edit shows it at the top of the form and keeps its back link; the test page shows no note and reads none of the Save's params", () => {
    const edit = read("src/app/app/tests/[id]/edit/page.tsx");
    expect(edit).toContain("const savedNote = savedNoteText(await searchParams);");
    expect(edit).toContain('{savedNote && <SavedNote stay={savedNote.extras}><p className="ok" data-saved-text="">{savedNote.text}</p></SavedNote>}');
    expect(edit.indexOf("<SavedNote")).toBeLessThan(edit.indexOf("<TestForm"));
    expect(edit).toContain("← Back to the test</a>");
    const page = read("src/app/app/tests/[id]/page.tsx");
    expect(page).not.toContain("SavedNote");
    expect(page).not.toMatch(/\bsaved\?: string|offered\?: string|spotclosed/);
    expect(page).toContain("const { failed } = await searchParams;");
  });

  it("fades after 8 s unless it lists extras; × always closes it", () => {
    expect(SAVED_NOTE_MS).toBe(8_000);
    const n = read("src/components/SavedNote.tsx");
    expect(n).toMatch(/if \(stay\) return;\s+const t = setTimeout\(\(\) => setShown\(false\), SAVED_NOTE_MS\);/);
    expect(n).toContain('aria-label="Close" data-saved-close=""');
  });
});
