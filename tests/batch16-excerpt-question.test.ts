import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { ANYTHING_ELSE, ExcerptQuestion, MyExcerpts, ShownExcerpts, excerptQuestion } from "@/components/ExcerptList";
import { myExcerpts, pendingForDeveloper, shownExcerpts } from "@/lib/server/excerpts";
import { NOT_REQUIRED } from "@/lib/questions";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

// Batch 16 section 37: excerpts show the question they answer.
const h = React.createElement;
// The components compile for the classic JSX runtime under vitest: React in scope for them.
(globalThis as { React?: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";

describe("the question above each excerpt (section 37)", () => {
  it("small grey text cut to 2 lines with Show more; \"[not required]\" left out; the Anything else box by its label", () => {
    expect(excerptQuestion("What did you like?")).toBe("What did you like?");
    expect(excerptQuestion(`${NOT_REQUIRED}Where did you get stuck?`)).toBe("Where did you get stuck?");
    expect(excerptQuestion("")).toBe(ANYTHING_ELSE);
    expect(ANYTHING_ELSE).toBe("Anything else (bugs, ideas)");
    const html = renderToStaticMarkup(h(ExcerptQuestion, { question: "What did you like?" }));
    expect(html).toContain('data-excerpt-question=""');
    expect(html).toMatch(/class="[^"]*text-xs text-slate-400[^"]*"[^>]*style="[^"]*-webkit-line-clamp:2/i);
    expect(html).toContain("What did you like?");
  });

  it("on the profile (Excerpts of their work) and in Your excerpts, above the quote", () => {
    const shown = renderToStaticMarkup(h(ShownExcerpts, { items: [{ id: "x", text: "too hard", source: "a game", question: "Where did you get stuck?" }] }));
    expect(shown.indexOf("Where did you get stuck?")).toBeGreaterThan(-1);
    expect(shown.indexOf("Where did you get stuck?")).toBeLessThan(shown.indexOf("“too hard”"));
    const mine = renderToStaticMarkup(h(MyExcerpts, { items: [{ id: "x", text: "too hard", source: "a game", testTitle: "Harbor Run", state: "Shown on your profile", question: "" }], canRemove: false }));
    expect(mine).toContain(ANYTHING_ELSE);
    expect(mine.indexOf(ANYTHING_ELSE)).toBeLessThan(mine.indexOf("“too hard”"));
  });

  it("the data carries the question to every list; the developer's Allow / Deny rows show it the same way", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: [ANSWER, "Nowhere, it was smooth."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await ex(tester.cookie, { action: "request", submissionId: sub.id, index: 0, text: "the second boss was far too hard" })).status).toBe(200);
    const q = "What did you like?";
    expect((await myExcerpts(tester.user.id))[0].question).toBe(q);
    expect((await pendingForDeveloper(dev.user.id, testId))[0].question).toBe(q);
    const x = await db.excerpt.findFirstOrThrow({ where: { testerId: tester.user.id } });
    await db.excerpt.update({ where: { id: x.id }, data: { status: "shown", decidedAt: new Date() } });
    expect((await shownExcerpts(tester.user.id))[0].question).toBe(q);
    // The developer's rows: the test page's Needs you and its restricted view, and the restricted dashboard box.
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page.match(/<ExcerptQuestion question=\{x\.question\} \/>/g)?.length).toBe(2);
    expect(src("app/app/page.tsx")).toContain("<ExcerptQuestion question={x.question} />");
  });
});
