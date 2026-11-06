import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllTesters, AvatarButton, rowShown } from "@/app/app/tests/[id]/TesterFilter";
import { Fold } from "@/components/Panel";

// (Owner, Nov 3, batch 35 §140) The test page's tester list and Needs you: the circles filter the list, each tester folds by their name (the summary block stays
// out), and each request in Needs you is its own fold with its buttons under it.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const page = () => src("app/app/tests/[id]/page.tsx");
/** The tester row's markup, from its opening div to the end of its map. */
const row = () => { const p = page(); const a = p.indexOf('id={`tester-${c.id}`} data-tester-name={name} data-tester-id={c.testerId}>'); return p.slice(a, p.indexOf("</RowsBox>", a)); };

describe("the circles filter the tester list", () => {
  it("a circle shows only that tester; pressing it again (or All testers) shows everyone", () => {
    expect(rowShown("t1", "")).toBe(true);
    expect(rowShown("t1", "t1")).toBe(true);
    expect(rowShown("t2", "t1")).toBe(false);
    const h = renderToStaticMarkup(createElement(AvatarButton, { testerId: "t1", name: "fbbb" }));
    expect(h).toMatch(/^<button type="button" aria-pressed="false" aria-label="Show only fbbb" data-avatar-filter="t1"/);
    expect(h).toContain(">F</button>");
    // Nothing chosen: no "All testers" button.
    expect(renderToStaticMarkup(createElement(AllTesters))).toBe("");
    const filter = src("app/app/tests/[id]/TesterFilter.tsx");
    expect(filter).toContain('onClick={() => choose(on ? "" : testerId)}');
    expect(filter).toContain("All testers");
    // The list hides the other rows (the name search still works with it).
    expect(src("app/app/tests/[id]/RowsBox.tsx")).toContain('(el) => rowShown(el.dataset.testerId ?? "", chosen)'); // (§274) with the Search testers box
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).toContain("<AvatarButton testerId={seat.testerId} name={seat.name} obj={pronouns(seat.pronoun).obj} />"); // (batch 35 §162)
  });
});

describe("each tester folds by their name", () => {
  it("closed: the name (and paid so far) and the summary block (calls, ratings, Rate); open: their parts, each in a panel", () => {
    const r = row();
    const fold = r.indexOf("<Fold id={`tester-${c.id}`}"), end = r.indexOf("</Fold>\n                <div className=\"space-y-1\" data-tester-summary=\"\">");
    expect(fold).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(fold);
    expect(r.slice(fold, fold + 1400)).toContain("<NameLink fit text={name} href={personHref} /></h3>"); // the name heads the toggle (§166: the green profile link; §199: fitted)
    const inside = r.slice(fold, end), summary = r.slice(end);
    // (Owner, Nov 5, §254) No "<PrevSetFolds" any more; (§263, final) the tester's Terms history for the questions sits under the written answers.
    for (const s of ['data-parts-sent=""', "<SentWork ", 'data-calls-fold={c.id}', "data-dev-terms-history={c.id}"]) expect(inside).toContain(s);
    expect(inside).not.toContain("<PrevSetFolds");
    // (Owner, Nov 4, §195) No "Paid in all:" in the summary: the paid so far is on the right of the name row (the fold's heading); the calls line stays.
    for (const s of ['data-tester-calls=""', "rated you:", "rateBoxOf(c)", "/app/chat/${c.id}"]) expect(summary).toContain(s);
    expect(summary).not.toContain("Paid in all");
    expect(r.slice(fold, inside.indexOf("</>}>") + fold)).toContain("<PaidSoFar cents={paidSoFar(c.id)}");
    // Open by default only when there's one tester; the state is kept like every fold (sessionStorage, through redraws).
    expect(r).toContain("defaultOpen={t.contracts.length === 1}");
  });

  it("buttons in the closed summary still work: Rate and Chat are outside the fold; a request's buttons are outside its fold", () => {
    const r = row();
    const end = r.indexOf('data-tester-summary=""');
    expect(r.indexOf("rateBoxOf(c)")).toBeGreaterThan(end);
    expect(r.indexOf("/app/chat/${c.id}")).toBeGreaterThan(end);
    expect(r).not.toContain('data-tester-profile=""'); // (owner, Nov 3, §166) no "See her profile": the name in the heading is the link
    const p = page();
    for (const [f, button] of [["needs-excerpt-${x.id}", "<ExcerptDecision"], ["needs-dispute-${d.id}", "<DisputeSide"], ["needs-part-${x.id}", "<PayBox"]]) {
      // (§181) A part in Needs you is a HoldFold (its Pay box in one more drop-down inside it); its source ends where updateNode starts.
      const at = f.startsWith("needs-part") ? p.indexOf(`"data-fold": \`${f}\``) : p.indexOf(`<Fold id={\`${f}\`}`);
      expect(at, f).toBeGreaterThan(0);
      const close = p.indexOf(f.startsWith("needs-part") ? "const updateNode" : "</Fold>", at);
      // The excerpt's and dispute's buttons follow their fold; the Pay box is inside the part's fold.
      if (f.startsWith("needs-part")) expect(p.slice(at, close)).toContain(button);
      else expect(p.indexOf(button, close)).toBeLessThan(p.indexOf("</div>", close) + 200);
    }
    expect(src("app/app/tests/[id]/Applications.tsx")).toMatch(/<\/Fold>\n[ ]*<div className="flex flex-wrap gap-2">\n[ ]*<button className="btn"/);
  });

  it("a link to a part inside a closed tester opens it first (a details fold), and opens the part's own folds", () => {
    const h = renderToStaticMarkup(createElement(Fold, { id: "tester-c1", summary: "fbbb", defaultOpen: false }, createElement("li", { id: "part-s1" }, "x")));
    expect(h).toMatch(/^<details class="group\/fold [^"]*" data-fold="tester-c1" data-jump-open="">/); // closed, and a <details> HashJump opens
    expect(h).toContain('<li id="part-s1">');
    const jump = src("lib/markJump.ts");
    expect(jump).toContain("for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;");
    expect(jump).toContain('el.querySelectorAll?.<HTMLDetailsElement>("details[data-jump-open]")');
  });
});
