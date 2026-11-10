/**
 * (Owner, Nov 10, §371; recordings race-369 1 and 2) After the question change, Terms history's "Draft (not sent)" showed 2 of tab B's 3 old typed answers: old
 * Q2 had tab A's SENT answer, which was shown instead, and B's own Q2 text (kept in the change's draft snapshot by keepStaleTyped) was shown nowhere. A question
 * with both a sent answer and the tester's unsent draft now shows both: the sent answer as sent, the draft under it as "Draft (not sent)".
 */
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { questionChanges } from "@/lib/questionHistory";
import { DRAFT_NOT_SENT, QuestionsChangedEntry } from "@/components/QuestionsHistory";

(globalThis as unknown as { React: typeof React }).React = React;

const Q1 = "What did you like most about the first level?";
const Q2 = "Where did you get stuck, and for how long?";
const Q3 = "What would you change first?";
const Q4 = "How did the boat controls feel?";
const Q2NEW = "Where exactly did you get stuck, and what did you try there?";
const B2 = "Tab B: I got stuck at the second bridge for about five minutes.";
const B3 = "Tab B: the tutorial, because the wind rule comes far too late.";
const B4 = "Tab B: the boat turned slowly but felt steady overall, mostly.";
describe("§371: Terms history shows every unsent answer the tester typed, a sent answer's too", () => {
  const item = (question: string, answer: string) => ({ question, required: false, answer });
  const until = "2026-11-10T09:31:26.582Z";
  const A1 = "Tab A: the harbour level was clear and the boats handled well on the first try.";
  const A2 = "Tab A: I got stuck at the second bridge for about five minutes, the path was unclear.";
  // As the recordings stored it: tab A sent Q1 and Q2; tab B's typed Q2, Q3 and Q4 went into the change's draft snapshot (a per-field draft counts the boxes it
  // never typed in, Q1 here, as what was sent).
  const sets = [{ until, to: [Q1, Q2NEW, Q3, Q4], items: [item(Q1, A1), item(Q2, B2), item(Q3, B3), item(Q4, B4)], versions: [
    { kind: "sent", at: "2026-11-10T09:31:21.263Z", items: [item(Q1, A1), item(Q2, A2), item(Q3, ""), item(Q4, "")] },
    { kind: "draft", at: until, items: [item(Q1, A1), item(Q2, B2), item(Q3, B3), item(Q4, B4)] },
  ] }];
  const sub = { answers: [item(Q1, A1), item(Q2, A2), item(Q3, ""), item(Q4, "")], additions: [] };

  it("questionChanges: a question with a sent answer and other unsent text has both; one whose draft is the sent text again has no draft", () => {
    const [e] = questionChanges(sets, [Q1, Q2NEW, Q3, Q4], sub, { drafts: true });
    expect(e.then.map((q) => [q.question, q.sent?.answer ?? null, q.draft])).toEqual([
      [Q1, A1, null], [Q2, A2, B2], [Q3, null, B3], [Q4, null, B4],
    ]);
    // The developer's side never has a draft.
    const [dev] = questionChanges(sets, [Q1, Q2NEW, Q3, Q4], sub, { drafts: false });
    expect(dev.then.map((q) => q.draft)).toEqual([null, null, null, null]);
  });

  it("the entry draws Q2's sent answer as sent, and the tester's draft under it as Draft (not sent): all 3 typed answers show", () => {
    const [e] = questionChanges(sets, [Q1, Q2NEW, Q3, Q4], sub, { drafts: true });
    const html = renderToStaticMarkup(h(QuestionsChangedEntry, { id: "h", change: e, files: [], timeZone: "UTC" }));
    const then = html.slice(html.indexOf('data-history-then=""'), html.indexOf('data-history-now=""'));
    const q2 = then.slice(then.indexOf(Q2), then.indexOf(Q3));
    expect(q2).toContain(A2);
    expect(q2).toContain('data-history-draft=""');
    expect(q2).toContain(DRAFT_NOT_SENT);
    expect(q2).toContain(B2);
    expect(q2.indexOf(A2)).toBeLessThan(q2.indexOf(B2)); // the sent answer first, the draft under it
    expect(then.match(/data-history-draft=""/g)).toHaveLength(3);
    for (const b of [B2, B3, B4]) expect(then).toContain(b);
    // Q1's sent answer once, never again as a draft.
    expect(then.split(A1)).toHaveLength(2);
  });
});
