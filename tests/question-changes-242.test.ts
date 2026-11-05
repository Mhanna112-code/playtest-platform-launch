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
