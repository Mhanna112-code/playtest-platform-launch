// (Owner, Nov 3, batch 35 §140 and §141) Typing stops at every box's limit; the one-per-line boxes stop per line (Enter still works); the keys and questions are listed
// under their boxes and a click on one goes to its line.
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_RULE, QUESTION_RULE, answerRule, cutToLine, limitEdit, lineRange, linesOf, trimmedLength } from "@/lib/typingLimit";
import { KEY_MAX_LENGTH } from "@/lib/keys";
import { LIMITS } from "@/lib/limits";
import { WRITTEN_MAX_CHARS } from "@/lib/rules";
import { capQuestions } from "@/lib/questions";
import { KeyCounts } from "@/components/KeyCounts";
import { LineList } from "@/components/LineList";

(globalThis as unknown as { React: typeof React }).React = React;
const per3 = { lineMax: 3 };
const v = (prev: string, next: string, rule = per3 as Parameters<typeof limitEdit>[2], caret?: number) => limitEdit(prev, next, rule, caret).value;

describe("§140 the per-line limiter (access keys, questions)", () => {
  it("blocks typing past a line's limit, but Enter starts the next line", () => {
    expect(limitEdit("abc", "abcd", per3)).toEqual({ value: "abc", cut: true, caret: 3 });
    expect(v("abc", "abc\n")).toBe("abc\n");
    expect(v("abc\n", "abc\nd")).toBe("abc\nd");
    expect(v("abc\nde", "abc\ndef")).toBe("abc\ndef");
    expect(v("abc\ndef", "abc\ndefg")).toBe("abc\ndef");
    // typing in the middle of a full line
    expect(limitEdit("abc", "aXbc", per3, 2)).toEqual({ value: "abc", cut: true, caret: 1 });
    // a line elsewhere being full doesn't stop another line
    expect(v("abc\nx", "abc\nxy")).toBe("abc\nxy");
  });
  it("cuts each pasted line at the limit (a paste into the middle of a line keeps what fits)", () => {
    expect(v("", "abcdef\nxy\n123456")).toBe("abc\nxy\n123");
    expect(v("a\nb", "aXYZ\nb", { lineMax: 3 }, 4)).toBe("aXY\nb");
    expect(v("ab", "aXYZb", { lineMax: 4 }, 4)).toBe("aXYb");
    // a paste that spans lines: its first part joins the line before, its last part the line after
    expect(v("abcd", "abXX\nYYYYYcd", { lineMax: 3 }, 10)).toBe("abX\nYcd");
    // Windows line breaks in a paste are just line breaks (the box itself always holds "\n")
    expect(v("", "abcdef\r\nxy".replace(/\r\n/g, "\n"))).toBe("abc\nxy");
  });
  it("counts each line trimmed, as the server does (spaces around a key or question don't count)", () => {
    const rule = { lineMax: 3, lineMeasure: trimmedLength };
    expect(v("abc", "abc ", rule)).toBe("abc ");
    expect(v("  ab", "  abc", rule)).toBe("  abc");
    expect(v("  abc", "  abcd", rule)).toBe("  abc");
    expect(KEY_RULE.lineMax).toBe(KEY_MAX_LENGTH);
    expect(QUESTION_RULE.lineMax).toBe(LIMITS.question);
    expect(KEY_RULE.cutNote).toBe("Cut to the 200-character limit for each key.");
    expect(QUESTION_RULE.cutNote).toBe("Cut to the 20,000-character limit for each question.");
  });
  it("a line already over its limit (older data) is never cut: it takes nothing more, deleting works, Enter splits it", () => {
    expect(v("abcdef", "abcdefg")).toBe("abcdef");
    expect(v("abcdef", "abcde")).toBe("abcde");
    expect(v("abcdef", "abc\ndef", per3, 4)).toBe("abc\ndef");
    expect(v("abcdef\nx", "abcdef\nxy")).toBe("abcdef\nxy");
  });
  it("never leaves half an emoji", () => {
    expect(v("", "ab\u{1F600}")).toBe("ab");
    expect(v("", "a\u{1F600}b")).toBe("a\u{1F600}");
  });
  it("places a typed letter by the cursor (typing 'a' after an 'a')", () => {
    // typed between the two: the cursor stays between them (without the cursor, the comparison alone would put it at the end)
    expect(limitEdit("aa", "aaa", { lineMax: 2 }, 2)).toEqual({ value: "aa", cut: true, caret: 1 });
    expect(limitEdit("aa", "aaa", { lineMax: 2 })).toEqual({ value: "aa", cut: true, caret: 2 });
  });
  it("the questions box still takes no 21st question", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `Q${i}`).join("\n");
    expect(capQuestions(v(twenty, twenty + "\nQ20", QUESTION_RULE))).toBe(twenty);
  });
});

describe("§140 the whole-box limiter (the written answers)", () => {
  it("stops at the limit, cuts a paste, and a value already over may only shrink", () => {
    expect(limitEdit("abc", "abcdefgh", { max: 5 })).toEqual({ value: "abcde", cut: true, caret: 5 });
    expect(v("abcdefg", "abcdefgh", { max: 5 })).toBe("abcdefg");
    expect(v("abcdefg", "abcdef", { max: 5 })).toBe("abcdef");
  });
  it("counts without the file markers, and the whole written part together", () => {
    const rule = answerRule(WRITTEN_MAX_CHARS - 5);
    expect(rule.max).toBe(5);
    expect(v("abc", "abc [📎 picture.png #abcd]", rule)).toBe("abc [📎 picture.png #abcd]");
    expect(v("abcde", "abcdef", rule)).toBe("abcde");
    expect(answerRule(WRITTEN_MAX_CHARS + 10).max).toBe(0);
    expect(rule.cutNote).toBe(cutToLine(WRITTEN_MAX_CHARS, "for all your answers together"));
  });
});

describe("§141 a list item goes to its line", () => {
  it("lineRange: the line's start and end, with blank lines and Windows line endings", () => {
    expect(lineRange("a\n\nb", 0)).toEqual([0, 1]);
    expect(lineRange("a\n\nb", 1)).toEqual([2, 2]);
    expect(lineRange("a\n\nb", 2)).toEqual([3, 4]);
    expect(lineRange("a\r\nb\r\n\r\nc", 1)).toEqual([3, 4]);
    expect(lineRange("a\r\nb\r\n\r\nc", 2)).toEqual([6, 6]);
    expect(lineRange("a\r\nb\r\n\r\nc", 3)).toEqual([8, 9]);
    expect(lineRange("ab", 5)).toEqual([2, 2]);
    expect(linesOf("K1\n\n  K2 \r\nK3")).toEqual([{ text: "K1", line: 0 }, { text: "K2", line: 2 }, { text: "K3", line: 3 }]);
  });
  it("the keys list: one item per key with its line, counts, and a key typed twice marked", () => {
    const html = render(h(KeyCounts, { value: "KEY-1\n\nKEY-2\nKEY-1", box: "keysFree" }));
    expect(html).toContain('data-line-list="keysFree"');
    expect(html.match(/data-line-pick="(\d+)"/g)).toEqual(['data-line-pick="0"', 'data-line-pick="2"', 'data-line-pick="3"']);
    expect(html.match(/data-line-dup=""/g)).toHaveLength(2);
    expect(html).toContain("5 / 200");
    expect(html).toContain("Key 3");
    expect(html).toContain('role="button"');
  });
  it("the questions list: the Required tick beside each, over-long marked red with the server's line", () => {
    const html = render(h(LineList, { box: "questions", text: "Why?\n" + "x".repeat(6), max: 5, label: "Question", overLine: "Too long", aside: () => h("input", { type: "checkbox", "data-required-tick": "" }) }));
    expect(html.match(/data-required-tick=""/g)).toHaveLength(2);
    expect(html).toContain("6 / 5");
    expect(html).toContain("Too long");
    expect(html).toContain("Go to question 2 in the box");
  });
  it("both lists, on Post and on Edit, use the shared list (and with it focusLine)", () => {
    const read = (f: string) => fs.readFileSync(f, "utf8");
    expect(read("src/components/LineList.tsx")).toContain("focusLine(document.getElementById(box)");
    expect(read("src/components/KeyCounts.tsx")).toContain("<LineList");
    const form = read("src/app/app/tests/TestForm.tsx");
    expect(form).toContain('<LineList box="questions"');
    expect(form).toContain('<KeyCounts value={keysText} box="accessKeys" />');
    expect(read("src/app/app/tests/KeyBoxes.tsx")).toContain('<KeyCounts value={typed} box="keysFree" />');
  });
});

describe("§140 every limited box stops at its limit", () => {
  const files: string[] = [];
  (function walk(d: string) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  })("src");
  const src = (f: string) => fs.readFileSync(f, "utf8");
  // Boxes with no character limit at all (no counter, nothing checked by the server): the page's own search filters.
  const NO_LIMIT = ["DevSearch.tsx", "HistorySearch.tsx", "InvitePanel.tsx", "RowsBox.tsx", "TesterSearch.tsx" /* (§274) Search testers */].map((f) => path.sep + f);
  it("every text box (textarea, text / email / url / search input) has maxLength or the shared limiter", () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of src(f).matchAll(/<(textarea|input)\b[\s\S]*?\/>/g)) {
        const t = m[0];
        if (/type="(checkbox|radio|file|hidden|number|date|datetime-local)"/.test(t)) continue;
        if (/data-money|data-whole|inputMode="numeric"|inputMode="decimal"/.test(t)) continue; // number boxes (src/lib/numberInput.ts)
        if (/maxLength=|data-typing-limit/.test(t)) continue;
        if (NO_LIMIT.some((n) => f.endsWith(n)) && !src(f).includes("<CharacterCount")) continue;
        missing.push(`${f}: ${t.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("every counter's limit is its box's maxLength (or the box uses the shared limiter)", () => {
    const wrong: string[] = [];
    for (const f of files) {
      const s = src(f);
      if (/[\\/](CharacterCount|LineList)\.tsx$/.test(f)) continue;
      for (const m of s.matchAll(/<CharacterCount\b[^>]*?\smax=\{([^}]+)\}/g)) {
        const max = m[1].trim();
        if (s.includes("data-typing-limit") || s.includes(`maxLength={${max}}`) || new RegExp(`maxLength=\\{[^}]*${max.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(s)) continue;
        wrong.push(`${f}: max={${max}}`);
      }
    }
    expect(wrong).toEqual([]);
  });
  it("the boxes that used to take more than their limit now stop there", () => {
    expect(src("src/app/app/tests/TestForm.tsx")).toContain('<textarea id="ndaText" rows={4} maxLength={LIMITS.nda}');
    expect(src("src/app/admin/AdminButton.tsx")).toContain("rows={2} maxLength={LIMITS.reason}");
    expect(src("src/app/admin/DisputeDecision.tsx")).toContain("maxLength={LIMITS.reason}");
    expect(src("src/app/admin/TeamCloseBox.tsx")).toContain("maxLength={LIMITS.reason}");
    expect(src("src/app/admin/PagedList.tsx")).toContain("maxLength={LIMITS.reason}");
    expect(src("src/app/app/tests/[id]/PayBox.tsx")).toContain("maxLength={LIMITS.reason}");
    expect(src("src/app/app/tests/[id]/DisputeSide.tsx")).toContain("maxLength={LIMITS.devSide}");
    expect(src("src/components/WhyBox.tsx")).toContain("maxLength={max}");
    expect(src("src/components/Chat.tsx")).toContain("maxLength={4000}");
    expect(src("src/components/ReportButton.tsx")).toContain("maxLength={2000}");
    expect(src("src/app/app/profile/ProfileForm.tsx")).toContain('<input id="name" className="input" maxLength={LIMITS.personName}'); // (§245) 20, was 80
    expect(src("src/app/app/find/[id]/JoinBox.tsx")).toContain("maxLength={LIMITS.joinNote}");
    expect(src("src/lib/server/joining.ts")).toContain("slice(0, LIMITS.joinNote)");
    expect(src("src/components/PasswordInput.tsx")).toContain("maxLength={limited ? props.maxLength ?? 200 : props.maxLength}");
  });
  it("a paste the browser cuts at maxLength shows the grey note (one shared place: FieldChecks)", () => {
    const fc = src("src/components/FieldChecks.tsx");
    expect(fc).toContain("if (!kind) return pastedPastMax(el,");
    expect(fc).toContain("showCutNote(el, cutToLine(el.maxLength))");
    expect(cutToLine(2000)).toBe("Cut to the 2,000-character limit.");
  });
});
