import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayBox } from "@/app/app/tests/[id]/PayBox";
import { seen } from "./fixtures";

// (Owner, Nov 4, §189) The open "Add to this answer" box counts once; the Pay more box's Note fits a phone; the app's main is never wider than the screen.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
(globalThis as unknown as { React: typeof React }).React = React;

describe("§189 small UI fixes", () => {
  it("the open Add to this answer box (a question's or Anything else's: the same form) shows one 'N / 20,000' counter: the editor's own", () => {
    const actions = src("app/app/sessions/[id]/SessionActions.tsx");
    const form = actions.slice(actions.indexOf("export function WrittenAddForm"), actions.indexOf("export function LeaveButton"));
    // One editor, as an addition (`alone`: its own 20,000); no counter of the form's own beside it.
    expect(form.match(/<AnswerBox /g)).toHaveLength(1);
    expect(form).toContain(" alone value={text} onChange={setText} />");
    expect(form).not.toContain("data-written-count");
    expect(form).not.toContain('{length.toLocaleString("en-US")} / {WRITTEN_MAX_CHARS.toLocaleString("en-US")}');
    // The editor's counter carries the add form's hook; an answer box in the answers form keeps only its own (the form's total stays there).
    expect(actions).toContain('data-answer-count={chars} {...(alone ? { "data-written-count": "" } : {})} />');
    const answersForm = actions.slice(actions.indexOf("export function WrittenForm"), actions.indexOf("export function WrittenAddForm"));
    expect(answersForm.match(/data-written-count=""/g)).toHaveLength(1);
  });

  it("the Pay more box's Note fills the box and never more (no 14rem minimum); a long name in its label wraps", () => {
    const h = renderToStaticMarkup(createElement(PayBox, {
      kind: "submission", id: "sub1", name: "Bartholomewfeatherstonehaughmaximiliana", listingCents: 1000, listingText: "$10.00", paidSoFarCents: 1000, seenAt: seen(), more: { testId: "t1", contractId: "c1" },
    }));
    expect(h).toContain('data-pay-more="sub1"');
    expect(h).toContain('<div class="w-full min-w-0 max-w-full" data-pay-note="">');
    expect(h).toMatch(/<label class="label \[overflow-wrap:anywhere\] ?" for="why-sub1">Note to Bartholomewfeatherstonehaughmaximiliana \(optional\)<\/label>/);
    expect(h).not.toContain("min-w-[14rem]");
    // The textarea is the shared .input (w-full).
    expect(h).toMatch(/<textarea id="why-sub1" class="input /);
  });

  it("the app's main is capped at the screen's width (a fitted name's unbroken line can't widen the page)", () => {
    const layout = src("app/app/layout.tsx");
    expect(layout).toContain('<main className="mx-auto max-w-[min(72rem,100%)] space-y-6 px-4 py-8" data-app-main="">');
    expect(layout).not.toContain('<main className="mx-auto max-w-6xl');
  });
});
