import { describe, expect, it } from "vitest";
import { restoreDraft } from "@/lib/answerSets";

// Found while recording the owner's changed-questions example (scripts/media.cjs, group "changedq"): pressing Switch reloads the page, and the old page's
// "Not sent yet" draft (typed for the OLD questions) was saved again on the way out and put back by position, so the old Q2 answer landed under the new Q2.
describe("a kept written draft is put back by question text", () => {
  const before = ["What did you like?", "Where did you get stuck?", "Would you play level 4?"];
  const after = ["What did you like?", "Which bridge was hardest to find, and why?", "Would you play level 4?"];
  it("after a switch to a changed Q2: Q1's draft stays, the new Q2 is empty, Q3 keeps its answer", () => {
    const kept = { answers: ["My new draft for Q1", "The second bridge.", "Yes."], questions: before };
    expect(restoreDraft(after, ["The boat handling.", "", "Yes."], kept)).toEqual(["My new draft for Q1", "", "Yes."]);
  });
  it("a draft typed for the current questions comes back as typed", () => {
    expect(restoreDraft(after, ["", "", ""], { answers: ["a", "b", "c"], questions: after })).toEqual(["a", "b", "c"]);
  });
  it("an older draft that doesn't say its questions is matched by position", () => {
    expect(restoreDraft(before, ["", "", ""], { answers: ["a", "b"] })).toEqual(["a", "b", ""]);
  });
  it("the “not required” marker doesn't stop a match", () => {
    const optional = ["What did you like?", "[not required] Anything else?"];
    expect(restoreDraft(["What did you like?", "Anything else?"], ["", ""], { answers: ["x", "y"], questions: optional })).toEqual(["x", "y"]);
  });
});
