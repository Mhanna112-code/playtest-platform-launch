import { describe, expect, it } from "vitest";
import { questionChanges } from "@/app/app/sessions/[id]/TesterTop";

const q = (text: string, required = false) => ({ text, required });

describe("(Owner, Nov 5) §242 the questions changed: only those that changed, matched by their words", () => {
  it("leaves out unchanged questions, even when an earlier one was removed", () => {
    const r = questionChanges([q("A"), q("B"), q("C")], [q("A"), q("C")]);
    expect(r).toEqual([{ kind: "removed", from: 1, to: null, before: q("B") }]);
  });
  it("an edit at the same place is Changed; extra ones are New; leftovers Removed", () => {
    const r = questionChanges([q("A"), q("B")], [q("A"), q("B edited"), q("D")]);
    expect(r.map((x) => [x.kind, x.from, x.to])).toEqual([["changed", 1, 1], ["new", null, 2]]);
  });
  it("a Required tick change counts as changed", () => {
    expect(questionChanges([q("A")], [q("A", true)]).map((x) => x.kind)).toEqual(["changed"]);
  });
  it("nothing changed: empty", () => {
    expect(questionChanges([q("A"), q("B")], [q("A"), q("B")])).toEqual([]);
  });
});

describe("(Owner, Nov 5) §243 only Open until, categories, languages and devices stay plain in other-tab notes", () => {
  it("plainField", async () => {
    const { plainField } = await import("@/components/FieldNote");
    for (const n of ["Open until", "openUntil", "categories", "Categories", "languages", "devices", "Tech requirements"]) expect(plainField(n), n).toBe(true);
    for (const n of ["spots", "title", "What to do", "build link", "Spots", undefined]) expect(plainField(n as string | undefined), String(n)).toBe(false);
  });
});
