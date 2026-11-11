import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOTES_UNIT, answerUnit, mergeUnits, sentUnits, unitsOf } from "@/lib/draftUnits";
import { getKept, patchKept } from "@/lib/server/kept";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 11, §379 item 6) Send Answers clears only the draft boxes whose text it sent; any other typed text stays kept. A question answered meanwhile:
// its text is in its "Add to this answer" draft (keepTypedForAnswered, the most recent replaces); a removed or reworded one: "Draft (not sent)" in Terms
// history (keepStaleTyped, tests/send-refusals-375.test.ts).

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const Q = ["What did you like?", "Where did you get stuck?"];
const ANS = "The harbour level was clear and the boats handled well on the first try.";

describe("§379 6: the units a Send that went through clears", () => {
  it("only the boxes it sent text from (and the notes when its form has them and they held text)", () => {
    expect(sentUnits(Q, [ANS, ""], "", true)).toEqual([answerUnit(Q[0])]);
    expect(sentUnits(Q, [ANS, "  "], "A bug on level 2.", true)).toEqual([answerUnit(Q[0]), NOTES_UNIT]);
    expect(sentUnits(Q, ["", ANS], "kept in the draft", false)).toEqual([answerUnit(Q[1])]); // the form after a send has no notes box
    expect(sentUnits(Q, ["", ""], "", true)).toEqual([]);
  });

  it("clearing them leaves every other box's draft: another tab's typing in a box sent empty, a question that came back with its draft", () => {
    const key = "written:s1";
    const kept = mergeUnits(key, null, { [answerUnit(Q[0])]: ANS, [answerUnit(Q[1])]: "Typed in the other tab.", [answerUnit("Came back?")]: "Its kept draft.", [NOTES_UNIT]: "" });
    const sent = sentUnits(Q, [ANS, ""], "", true);
    const after = mergeUnits(key, kept, Object.fromEntries(sent.map((u) => [u, null])));
    expect(unitsOf(key, after)).toEqual({ [answerUnit(Q[1])]: "Typed in the other tab.", [answerUnit("Came back?")]: "Its kept draft.", [NOTES_UNIT]: "" });
  });

  it("on the server: the press saves Q1; clearing its sent units keeps Q2's draft typed in another tab", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const key = `written:${j.sessionId}`;
    await patchKept(j.tester.user.id, key, { [answerUnit(Q[0])]: ANS, [answerUnit(Q[1])]: "Typed in the other tab." }, { questions: Q });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ""], for: Q, notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    await patchKept(j.tester.user.id, key, Object.fromEntries(sentUnits(Q, [ANS, ""], "", true).map((u) => [u, null])), { questions: [Q[1]] });
    expect(unitsOf(key, (await getKept(j.tester.user.id, key)).data)).toEqual({ [answerUnit(Q[1])]: "Typed in the other tab." });
  });

  it("the page: Send Answers clears only those units; a partial clear never drops another unit's unsent typing", () => {
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    const success = form.split("await api(`/api/sessions/${sessionId}/written`")[1].split("} catch (err)")[0];
    expect(success).toContain("await now.clear(sentUnits(questions, answers, notes, !only));");
    expect(success).not.toContain("await now.clear();");
    const kept = src("lib/useKept.tsx");
    const partial = kept.slice(kept.indexOf("if (only) {"), kept.indexOf("cleared.current = true;\n      pending.current.clear();"));
    expect(partial).toContain("for (const u of list) pending.current.delete(u);");
    expect(partial).not.toContain("pending.current.clear()");
  });
});
