import { describe, expect, it } from "vitest";
import { byQuestion, type Sheet } from "@/lib/byQuestion";
import { REQUIRED } from "@/lib/questions";

// (Owner-approved) The full app's "By question" view on lean data.
const at = new Date("2026-10-20T10:00:00Z");
const sheet = (over: Partial<Sheet>): Sheet => ({ contractId: "c1", tester: "Ana Silva", questions: [], answers: [], notes: "", sentAt: at, status: "waiting", paidCents: 0, ...over });

describe("by question", () => {
  it("every question with each tester's answer, name, time and status; 'not required' marked; blanks left out; Other notes last", () => {
    // (Batch 26 section 14) Required only when ticked: the block says which.
    const qs = [REQUIRED + "What did you like?", "Anything else?"];
    const blocks = byQuestion(qs, [
      sheet({ contractId: "a", tester: "Ana Silva", questions: qs, answers: ["The boat", ""], status: "paid", paidCents: 1000, notes: "Crashed once." }),
      sheet({ contractId: "b", tester: "Ben Ito", questions: qs, answers: ["The map", "More levels"], status: "rejected" }),
      sheet({ contractId: "c", tester: "Cara Diaz", questions: qs, answers: ["Music", ""] }),
    ]);
    expect(blocks.map((b) => [b.title, b.notRequired, b.required, b.answers.length])).toEqual([
      ["What did you like?", false, true, 3],
      ["Anything else?", true, false, 1],
      ["Other notes", false, false, 1],
    ]);
    expect(blocks[0].answers.map((a) => [a.tester, a.text, a.status, a.paidCents])).toEqual([
      ["Ana Silva", "The boat", "paid", 1000],
      ["Ben Ito", "The map", "rejected", 0],
      ["Cara Diaz", "Music", "waiting", 0],
    ]);
    expect(blocks[0].answers[0].sentAt).toEqual(at);
  });

  it("testers on different versions of the questions: each answer goes under its own question", () => {
    const blocks = byQuestion(["Q new"], [
      sheet({ contractId: "a", questions: ["Q old"], answers: ["old answer"] }),
      sheet({ contractId: "b", questions: ["Q new"], answers: ["new answer"] }),
    ]);
    expect(blocks.map((b) => [b.title, b.answers.map((a) => a.text)])).toEqual([
      ["Q new", ["new answer"]],
      ["Q old", ["old answer"]],
    ]);
  });

  it("nothing answered yet: no blocks", () => {
    expect(byQuestion(["Q"], [])).toEqual([]);
  });
});
