import { describe, expect, it } from "vitest";
import { ratingChangedLine } from "@/lib/testerState";
import { capQuestions } from "@/lib/questions";

// Batch 35 §12 (owner, Oct 30): a first rating stops a press once; the questions box takes no 21st question.

describe("batch 35 §12: a first rating stops once", () => {
  it("'No ratings yet' then a first rating is a change; the page not saying (undefined) is not", () => {
    expect(ratingChangedLine("fbbb", null, 1)).toBe("fbbb got their first rating: 1.0");
    expect(ratingChangedLine("fbbb", null, 4.25)).toBe("fbbb got their first rating: 4.3");
    expect(ratingChangedLine("fbbb", undefined, 1)).toBe("");
    expect(ratingChangedLine("fbbb", null, null)).toBe("");
    // The full-star rule is unchanged.
    expect(ratingChangedLine("Eve", 4.6, 3.5)).toBe("Eve's rating went from 4.6 to 3.5");
    expect(ratingChangedLine("Eve", 4.5, 4.0)).toBe("");
  });
});

describe("batch 35 §12: at most 20 questions in the box", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `Question ${i + 1}?`).join("\n");
  it("a 21st line typed is dropped; a paste keeps the first 20; empty lines and edits are free", () => {
    expect(capQuestions(twenty + "\nW")).toBe(twenty);
    expect(capQuestions(twenty + "\n")).toBe(twenty + "\n");
    const pasted = Array.from({ length: 25 }, (_, i) => `P${i + 1}`).join("\n");
    expect(capQuestions(pasted).split("\n")).toEqual(Array.from({ length: 20 }, (_, i) => `P${i + 1}`));
    expect(capQuestions(twenty.replace("Question 3?", "Question three, edited?"))).toBe(twenty.replace("Question 3?", "Question three, edited?"));
    expect(capQuestions("a\n\n\nb")).toBe("a\n\n\nb");
  });
});
