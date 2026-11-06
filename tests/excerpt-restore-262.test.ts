import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allKept, deleteFrom, excerptOf, fromAnswer, insertedRange, keptChars, restoreAt } from "@/lib/excerptTrim";

describe("(Owner, Nov 5) §262 a character deleted by accident can be typed back", () => {
  const original = "The boss fight felt unfair at first.";
  it("typing the very next left-out character at the caret restores it, in order; the excerpt is the answer's own words again", () => {
    // "felt " deleted (box positions 15-20).
    const cut = deleteFrom(allKept(original), 15, 20);
    expect(keptChars(original, cut)).toBe("The boss fight unfair at first.");
    const f = restoreAt(original, cut, 15, "f")!;
    expect(keptChars(original, f)).toBe("The boss fight funfair at first.");
    const felt = restoreAt(original, f, 16, "elt ")!;
    expect(keptChars(original, felt)).toBe(original);
    expect(fromAnswer(original, excerptOf(original, felt).text)).toBe(true);
  });
  it("anything else is refused: another character, typing where nothing was left out, typing past the left-out run", () => {
    const cut = deleteFrom(allKept(original), 15, 20);
    expect(restoreAt(original, cut, 15, "x")).toBeNull();
    expect(restoreAt(original, cut, 3, " ")).toBeNull();
    expect(restoreAt(original, cut, 15, "felt u")).toBeNull();
    expect(restoreAt(original, allKept(original), 4, "b")).toBeNull();
  });
  it("insertedRange finds what was typed and where", () => {
    expect(insertedRange("abc", "abXc", 3)).toEqual({ at: 2, text: "X" });
    expect(insertedRange("aaa", "aaaa", 1)).toEqual({ at: 0, text: "a" });
    expect(insertedRange("abc", "ab", 2)).toBeNull();
  });
  it("the box lets a restoring keystroke through and still refuses other typing", () => {
    const s = fs.readFileSync(path.resolve(__dirname, "../src/components/Excerpts.tsx"), "utf8");
    expect(s).toContain('e.inputType === "insertText" && !!e.data && el.selectionStart === el.selectionEnd && !!restoreAt(now.current.original, now.current.kept, el.selectionStart, e.data)');
    expect(s).toContain("const back = typed && restoreAt(original, kept, typed.at, typed.text);");
    expect(s).toContain("deleted something by accident? Type it back where it was");
  });
});
