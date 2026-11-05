import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import * as X from "@/lib/server/excerpts";
import { allKept, deletedRange, deleteFrom, excerptOf, fromAnswer, GAP, keptChars, runsOf } from "@/lib/excerptTrim";
import { ExcerptPicker } from "@/components/Excerpts";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §196) The excerpt box is delete-only: the answer is shown read-only above it (struck through where it's left out), the box starts with the
// WHOLE answer, only deleting works, and a part left out of the middle reads " … " in the stored excerpt. The server accepts a text whose "…"-separated pieces are
// each in the answer, in order; anything added is refused with the same line; the 10 to 500 counts the stored text, ellipses included.

(globalThis as unknown as { React: typeof React }).React = React;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const LONG = `Start of the answer. The harbour level felt great, but the second boss was far too hard for me. ${words(120)} End of the answer.`;
const LEAVE_WORDS = "Trim the excerpt from your answer: it can only leave words out, not add any.";

/** Ana's written answers (LONG first), paid $10.00. */
async function paidWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: [LONG, "Nowhere really, it was smooth."] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  return { ...s, ...j, sub };
}

describe("§196 the trim: a mask over the answer, delete-only", () => {
  it("a change is accepted only when it removes one stretch of the box's text", () => {
    expect(deletedRange("abcdef", "abef")).toEqual({ start: 2, end: 4 });
    expect(deletedRange("abcdef", "bcdef")).toEqual({ start: 0, end: 1 });
    expect(deletedRange("abcdef", "abcde")).toEqual({ start: 5, end: 6 });
    expect(deletedRange("abcdef", "")).toEqual({ start: 0, end: 6 });
    // Typing, pasting, an autocorrect replacement (same length or shorter), two separate stretches, no change: refused.
    expect(deletedRange("abcdef", "abcXdef")).toBeNull();
    expect(deletedRange("abcdef", "abXdef")).toBeNull();
    expect(deletedRange("abcdef", "aZf")).toBeNull();
    expect(deletedRange("abcdef", "bcdf")).toBeNull();
    expect(deletedRange("abcdef", "abcdef")).toBeNull();
    expect(deletedRange("abcdef", "abcXdef", 4)).toBeNull(); // a caret never makes an insertion a deletion
  });

  it("the caret places a deletion the text alone can't tell apart (the strike-through and the … follow what was selected)", () => {
    const old = "starts. I tried it, shook. I don't think";
    const next = "starts. I don't think";
    // By the text alone: "tried it, shook. I " (the prefix runs as far as it can).
    expect(deletedRange(old, next)).toEqual({ start: 10, end: 29 });
    // With the caret where Backspace left it (before "I don't"): "I tried it, shook. ".
    expect(deletedRange(old, next, 8)).toEqual({ start: 8, end: 27 });
    expect(old.slice(8, 27)).toBe("I tried it, shook. ");
    // A caret that doesn't fit the change is ignored.
    expect(deletedRange(old, next, 3)).toEqual({ start: 10, end: 29 });
  });

  it("deletions map back onto the answer, after earlier ones too; the box shows the kept characters", () => {
    const original = "0123456789";
    let kept = deleteFrom(allKept(original), 2, 4); // "01456789"
    expect(keptChars(original, kept)).toBe("01456789");
    kept = deleteFrom(kept, 2, 3); // the box's "4" is the answer's 4
    expect(keptChars(original, kept)).toBe("0156789");
    expect(runsOf(original, kept)).toEqual([{ text: "01", kept: true }, { text: "234", kept: false }, { text: "56789", kept: true }]);
  });

  it("the stored text: \" … \" only where the middle was left out; a cut start or end has none; spaces alone left out are one space", () => {
    const a = "The harbour level felt great, but the second boss was far too hard.";
    const cut = (from: string, to: string) => deleteFrom(allKept(a), a.indexOf(from), a.indexOf(to));
    expect(excerptOf(a, allKept(a))).toMatchObject({ text: a, gaps: 0 });
    // Start and end: no ellipsis.
    let k = cut("The harbour ", "level");
    k = deleteFrom(k, keptChars(a, k).indexOf(" far"), keptChars(a, k).length);
    expect(excerptOf(a, k)).toMatchObject({ text: "level felt great, but the second boss was", gaps: 0 });
    // The middle: one ellipsis.
    k = cut("felt great, but ", "the second");
    expect(excerptOf(a, k)).toMatchObject({ text: `The harbour level${GAP}the second boss was far too hard.`, gaps: 1 });
    // Two middle cuts: two.
    const b = keptChars(a, k); // positions in the box, after the first cut
    k = deleteFrom(k, b.indexOf("far too "), b.indexOf("hard"));
    expect(excerptOf(a, k).text).toBe(`The harbour level${GAP}the second boss was${GAP}hard.`);
    // Only a space left out: the words aren't glued together, and no ellipsis.
    expect(excerptOf(a, deleteFrom(allKept(a), 3, 4)).text).toBe(a);
    expect(keptChars(a, deleteFrom(allKept(a), 3, 4)).startsWith("Theharbour")).toBe(true);
  });

  it("the server's check: pieces between ellipses each in the answer, in order", () => {
    const a = "The harbour level felt great,\nbut the second boss was far too hard.";
    expect(fromAnswer(a, "felt great, but the second")).toBe(true); // a line break is a space
    expect(fromAnswer(a, `The harbour level${GAP}the second boss`)).toBe(true);
    expect(fromAnswer(a, `The harbour${GAP}felt${GAP}hard.`)).toBe(true);
    expect(fromAnswer(a, `the second boss${GAP}The harbour level`)).toBe(false); // out of order
    expect(fromAnswer(a, `The harbour level${GAP}the third boss`)).toBe(false); // a word added
    expect(fromAnswer(a, "The harbour level was great")).toBe(false);
    expect(fromAnswer(a, GAP)).toBe(false);
  });
});

describe("§196 requests with parts left out of the middle", () => {
  it("accepted with the ellipsis stored; added words refused with the same line; 10 to 500 counts the ellipses", async () => {
    const s = await paidWork();
    const ask = (text: string) => ex(s.tester.cookie, { action: "request", submissionId: s.sub.id, index: 0, text });
    // Words added (in a piece, or a piece that isn't in the answer, or pieces out of order): the same refusal as before.
    for (const text of [`Start of the answer.${GAP}the third boss was far too hard`, `The harbour level${GAP}felt amazing`, `the second boss${GAP}Start of the answer.`]) {
      const r = await ask(text);
      expect(r.status).toBe(400);
      expect(r.body.error.message).toBe(LEAVE_WORDS);
    }
    // 9 characters with the ellipsis ("The … me." is 3 + 3 + 3): too short, though its words are in the answer.
    expect(`The${GAP}me.`.length).toBe(9);
    expect((await ask(`The${GAP}me.`)).body.error.message).toBe(X.excerptLength);
    // 502 with the ellipsis (its words alone are 499): too long.
    const over = `Start of the answer.${GAP}${words(96)}`;
    expect(over.length).toBe(502);
    expect((await ask(over)).body.error.message).toBe(X.excerptLength);
    expect(await db.excerpt.count({ where: { submissionId: s.sub.id } })).toBe(0);
    // 497 with the ellipsis: accepted, stored as sent.
    const ok = `Start of the answer.${GAP}${words(95)}`;
    expect(ok.length).toBe(497);
    const r = await ask(ok);
    expect(r.status).toBe(200);
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: r.body.id } })).text).toBe(ok);
    // The developer's Allow / Deny row shows the stored text.
    expect((await X.pendingForDeveloper(s.dev.user.id, s.testId))[0].text).toBe(ok);
  });

  it("the box's own result is what the server accepts: cuts at the start, the middle and the end", async () => {
    const s = await paidWork();
    const sub = await db.submission.findUniqueOrThrow({ where: { id: s.sub.id }, include: { review: true, dispute: true } });
    const original = (await X.excerptChoices(sub))[0].text;
    expect(original).toBe(LONG);
    let k = deleteFrom(allKept(original), 0, "Start of the answer. ".length);
    const box = () => keptChars(original, k);
    k = deleteFrom(k, box().indexOf(" felt great"), box().indexOf(" the second boss"));
    k = deleteFrom(k, box().indexOf(" far too hard"), box().length);
    const { text, gaps } = excerptOf(original, k);
    expect(text).toBe(`The harbour level${GAP}the second boss was`);
    expect(gaps).toBe(1);
    const r = await ex(s.tester.cookie, { action: "request", submissionId: s.sub.id, index: 0, text });
    expect(r.status).toBe(200);
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: r.body.id } })).text).toBe(text);
  });
});

describe("§196 the tester's box", () => {
  const html = renderToStaticMarkup(createElement(ExcerptPicker, { submissionId: "sub-196", choices: [{ index: 0, question: "What did you like?", text: LONG }, { index: 1, question: "Anything broken?", text: "Nowhere really, it was smooth." }], defaultOpen: true }));

  it("the answer read-only above the box, folded (Show more opens the 8-line scroll box, §182)", () => {
    expect(html).toContain('data-excerpt-original=""');
    expect(html).toMatch(/data-excerpt-original="">[\s\S]*data-fold-text="closed"[\s\S]*data-fold-lines="3"[\s\S]*Start of the answer\./);
    expect(html).toContain(">Show more</button>");
    expect(html.indexOf("data-excerpt-original")).toBeLessThan(html.indexOf("<textarea"));
    expect(html).not.toContain("data-excerpt-left-out"); // nothing struck through yet
  });

  it("the box starts with the WHOLE answer (not cut to 500), delete-only hooks, no Open-the-box-taller button", () => {
    expect(LONG.length).toBeGreaterThan(600);
    const box = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)!;
    expect(box[1]).toBe(LONG);
    expect(box[0]).toContain('data-typing-limit=""'); // its own limiter: no maxLength, no "Cut to the N-character limit." note on a refused paste
    expect(box[0]).toContain('data-excerpt-box=""');
    expect(box[0]).toMatch(/spellcheck="false"/i);
    expect(html).not.toContain("Open the box taller"); // (owner, Nov 5) removed: the corner drags it
  });

  it("\"Use original answer\" (greyed while nothing is left out), the counter red outside 10 to 500, Ask the developer greyed", () => {
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="" data-excerpt-restore="">Use original answer<\/button>/);
    expect(html).toContain(`<p class="text-xs text-rose-300" data-excerpt-count="">${LONG.length} / 500 (at least 10)</p>`);
    expect(html).toMatch(/<button type="button" class="btn [^"]*" disabled="">Ask the developer<\/button>/);
    expect(html).not.toContain("data-excerpt-shown-as"); // no gap: no "Shown as:"
  });
});
