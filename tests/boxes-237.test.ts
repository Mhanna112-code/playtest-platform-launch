import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResizeBox } from "@/components/Panel";
import { ReasonQuote, REASON_BOX_MAX } from "@/components/ScrollText";
import { ScrollList, LIST_PANEL, BIG_PANEL_TALLEST } from "@/components/ScrollList";
import { AnswersBox, ANSWERS_BOX_MAX } from "@/components/AnswersBox";
import { ExcerptQuestion, ExcerptQuote, ExcerptReplaces, MyExcerpts, ShownExcerpts } from "@/components/ExcerptList";
import { FieldNote, WasNote } from "@/components/FieldNote";
import { LiveSection, LIVE_SECTIONS } from "@/components/LivePanel";
import { textId } from "@/components/QA";

// (Owner, Nov 5, §237) Long free text in the shared draggable box: ResizeBox (in OwnPanel when nested, as QA.tsx's boxes), no Show more inside a box, and no
// fixed scroll box inside a draggable panel.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, sub: string) => s.split(sub).length - 1;
const LONG = "The second boss hits far too hard and the checkpoint is a long way back, so I gave up after the tenth try. ".repeat(30);
const WORD = "averyveryverylongunbrokenword".repeat(20);

describe("§237 item 1: ReasonQuote is the draggable box, with its quote look", () => {
  it("a box with its grip, 6rem at first, italic in quotes with the left rule; long words wrap", () => {
    const html = render(h(ReasonQuote, { text: `  ${LONG}  `, id: "r1", label: "Their reason" }));
    expect(html).toContain('data-reason=""');
    expect(html).toContain('data-panel="r1"');
    expect(count(html, "data-panel-grip")).toBe(1);
    expect(html).toContain(`max-height:${REASON_BOX_MAX}`);
    expect(REASON_BOX_MAX).toBe("6rem");
    expect(html).toContain("!border-l-2 !border-l-white/20");
    expect(html).toMatch(/<blockquote class="[^"]*italic[^"]*\[overflow-wrap:anywhere\][^"]*" data-reason-text="">“The second boss/);
    expect(html).toContain('aria-label="Their reason (scroll for more)"');
    expect(html).not.toContain("Show more");
    expect(render(h(ReasonQuote, { text: WORD }))).toContain("[overflow-wrap:anywhere]");
  });
  it("its own box even inside another panel (OwnPanel); nothing for an empty reason", () => {
    const html = render(h(ResizeBox, { id: "outer", label: "Needs you" }, h(ReasonQuote, { text: "Too short", id: "in" })));
    expect(count(html, "data-panel-grip")).toBe(2);
    expect(html).not.toContain("data-panel-flat");
    expect(render(h(ReasonQuote, { text: "   " }))).toBe("");
  });
  it("its id: given, or made from the text (the same text, the same id); a caller's colour replaces the default", () => {
    expect(render(h(ReasonQuote, { text: "Rude in chat" }))).toContain(`data-panel="${textId("reason", "Rude in chat")}"`);
    expect(textId("reason", "Rude in chat")).toBe(textId("reason", "Rude in chat"));
    expect(textId("reason", "Rude in chat")).not.toBe(textId("reason", "Rude in chat!"));
    expect(textId("x", LONG)).toMatch(/^x-[0-9a-z]+$/);
    expect(render(h(ReasonQuote, { text: "Paused", className: "text-rose-50" }))).toMatch(/class="min-w-0 max-w-full\s+text-rose-50" data-reason=""/);
    expect(render(h(ReasonQuote, { text: "Paused", className: "mt-0.5 text-sm" }))).toMatch(/class="min-w-0 max-w-full text-slate-200 mt-0.5 text-sm"/);
  });
});

describe("§237 items 2 and 3: the lists and See the work are draggable panels", () => {
  it("ScrollList: the panel at its old height (per screen width), kept by its label; its list inside", () => {
    const html = render(h(ScrollList, { label: "Tests visited", children: h("li", null, "a") }));
    expect(html).toContain('data-panel="list-tests-visited"');
    expect(count(html, "data-panel-grip")).toBe(1);
    expect(html).toContain("max-height:var(--list-max)");
    expect(html).toContain("[--list-max:22rem]");
    expect(html).toMatch(/<ul class="space-y-2" data-scroll-list="rows" aria-label="Tests visited"><li>a<\/li><\/ul>/);
    const cards = render(h(ScrollList, { size: "cards", className: "grid gap-4 md:grid-cols-2" , children: h("li", null, "c")}));
    expect(cards).toContain("[--list-max:54rem] md:[--list-max:38rem]");
    expect(cards).toContain('data-panel="list-cards"');
    expect(render(h(ScrollList, { id: "rating-comments", size: "lines", children: null }))).toContain('data-panel="rating-comments"');
    // The boxes inside keep their own (a dispute's reason in Disputes: add your side).
    expect(count(render(h(ScrollList, { label: "Disputes", children: h("li", null, h(ReasonQuote, { text: LONG })) })), "data-panel-grip")).toBe(2);
  });
  it("AnswersBox: the panel, 20rem at first, kept by the piece", () => {
    const html = render(h(AnswersBox, { id: "answers-s1", children: "answers" }));
    expect(html).toContain('data-panel="answers-s1"');
    expect(html).toContain(`max-height:${ANSWERS_BOX_MAX}`);
    expect(html).toContain('data-answers-box="panel"');
    expect(src("app/admin/DisputeWork.tsx")).toContain("<AnswersBox id={`answers-${work.subId ?? \"work\"}`}>");
  });
});

describe("§237 items 4–11: long texts in boxes", () => {
  it("excerpts: the question in its question box, the quote in the value box; no Show more", () => {
    expect(render(h(ExcerptQuestion, { id: "e1", question: LONG }))).toContain('data-panel="excerpt-q-e1"');
    const quote = render(h(ExcerptQuote, { id: "excerpt-text-e1", text: "too hard" }));
    expect(quote).toContain('data-panel="excerpt-text-e1"');
    expect(quote).toContain("“too hard”");
    const rep = render(h(ExcerptReplaces, { id: "r9", texts: ["one", "two"] }));
    expect(rep).toContain('data-panel="excerpt-replaces-r9-0"');
    expect(rep).toContain('data-panel="excerpt-replaces-r9-1"');
    for (const html of [
      render(h(ShownExcerpts, { items: [{ id: "x", text: LONG, source: "a game", question: LONG }] })),
      render(h(MyExcerpts, { items: [{ id: "x", text: LONG, source: "a game", testTitle: "Harbor Run", state: "Shown", question: "" }], canRemove: false })),
    ]) {
      expect(count(html, "data-panel-grip")).toBe(2);
      expect(html).not.toContain("Show more");
    }
    for (const f of ["app/app/page.tsx", "app/app/tests/[id]/page.tsx", "components/ExcerptList.tsx"]) expect(src(f), f).not.toContain("ClampText");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<ExcerptQuote id={`shown-excerpt-${e.id}`} text={e.text} />");
    const picker = src("components/Excerpts.tsx");
    expect(picker).toContain("<ResizeBox id={`excerpt-original-${submissionId}`} label=\"Your answer\" defaultMax={EXCERPT_BOX_MAX} tallest={QA_BOX_TALLEST}>");
    expect(picker).toContain("<ValueText id={`excerpt-shown-as-${submissionId}`} label=\"Shown as\">");
    expect(picker).not.toContain("max-h-[calc(4lh+0.5rem)]");
    expect(picker).not.toContain("LongText");
  });
  it("application notes, bios and rating comments in boxes; the lines around a comment stay", () => {
    expect(src("app/app/tests/[id]/Applications.tsx")).toContain("{a.note && <ReasonQuote id={`app-note-${a.id}`} label=\"Their note\" text={a.note} />}");
    expect(src("app/app/testers/[id]/page.tsx")).toContain("{pr?.bio ? <ValueText id={`bio-${p.id}`} label=\"About\" defaultMax={BIO_BOX_MAX}>{pr.bio}</ValueText> : <p className=\"text-sm text-slate-500\">No bio yet.</p>}");
    expect(src("app/app/developers/[id]/page.tsx")).toContain("{p.devBio ? <ValueText id={`dev-bio-${p.id}`} label=\"About\" defaultMax={BIO_BOX_MAX}>{p.devBio}</ValueText>");
    const profile = src("app/app/profile/page.tsx");
    expect(profile).toContain("<ReasonQuote id={`rating-comment-${i}`} label=\"Comment\" text={c} />");
    expect(profile).not.toMatch(/ClampText|LongList/);
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain("You rated <NameLink text={dev} href={devHref} />: {myRating.stars} ★{myRating.comment && <ReasonQuote id={`my-rating-${c.id}`}");
    expect(session).toContain("<NameLink text={dev} href={devHref} /> rated you: {rated.developer.stars} ★{rated.developer.comment && <ReasonQuote id={`rated-you-${c.id}`}");
    expect(session).not.toContain("★{myRating.comment ? ` · “");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<NameLink text={name} href={personHref} /> rated you: {ri.tester.stars} ★{ri.tester.comment && <ReasonQuote id={`rated-you-${c.id}`}");
  });
  it("the join page's questions are QA's question boxes; no ClampText or ScrollText there", () => {
    const find = src("app/app/find/[id]/page.tsx");
    expect(find).toContain("<QuestionTexts id={`join-q-${t.id}`}");
    expect(find).not.toMatch(/ClampText|ScrollText|<QuestionBox/);
    expect(src("components/ScrollText.tsx")).not.toContain("export function ScrollText");
  });
  it("Edit's notes: what it replaced and what you typed in boxes (Copy kept); the questions each in a box, all of them", () => {
    const html = render(h(FieldNote, { label: "Changed in another tab or device at 7:16 AM", items: [{ name: "Instructions", before: LONG, after: "Sail on.", typed: WORD }] }));
    expect(count(html, 'data-qa-text="value"')).toBe(2);
    expect(count(html, "data-panel-grip")).toBe(2);
    expect(html).toContain('data-copy-typed=""');
    expect(html).not.toContain("Show more");
    const qs = render(h(FieldNote, { label: "Changed", items: [{ name: "Questions", before: ["[required] A?", "B?", "C?", "D?"], after: ["A?"] }] }));
    expect(count(qs, 'data-qa="question"')).toBe(4);
    expect(qs).toContain('data-required-tag=""');
    expect(qs).not.toContain("+1 more");
    expect(render(h(WasNote, { items: [{ field: "description", time: "9:05 AM", was: LONG }] }))).toContain('data-qa-text="value"');
  });
  it("the answer preview before Send and the admin's Contact us messages are draggable boxes", () => {
    const actions = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(actions).toContain("<ResizeBox id={`preview-${id}`} label=\"Preview\" defaultMax={PREVIEW_BOX_MAX}>");
    expect(actions).not.toContain("max-h-72 overflow-y-auto rounded-lg border border-white/10 p-2");
    expect(src("app/admin/PagedList.tsx")).toContain("<ValueText id={`contact-msg-${m.id}`} label=\"Message\" defaultMax={MESSAGE_BOX_MAX}>{m.message}</ValueText>");
  });
});

describe("§237 item 12: no fixed scroll box inside a draggable panel", () => {
  it("the dispute reason in Needs you is the reason box itself (no panel around it)", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("<ReasonQuote id={`dispute-${d.id}`} label={`${d.Poss} reason`} text={d.reason} />");
    expect(page).not.toContain("<ResizeBox id={`dispute-${d.id}`}");
  });
  it("the tester rows, the Listing panel and Your agreed scope are panels, keeping the boxes inside", () => {
    const rows = src("app/app/tests/[id]/RowsBox.tsx");
    expect(rows).not.toContain("max-h-[36rem]");
    expect(rows).toContain("<ResizeBox id={id} label=\"Testers\" defaultMax={LIST_PANEL.testerRows} tallest={BIG_PANEL_TALLEST}>");
    expect(rows).toContain("<OwnPanel><div ref={box} className=\"space-y-3\" data-tester-rows=\"\">{children}</div></OwnPanel>");
    const listing = src("app/app/tests/[id]/ListingPanel.tsx");
    expect(listing).not.toContain("max-h-[32rem]");
    expect(listing).toContain("<ResizeBox id={`listing-${side}`} label=\"Listing\" defaultMax={LIST_PANEL.listing} tallest={BIG_PANEL_TALLEST} className=\"mt-3\">");
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).not.toContain("max-h-[32rem]");
    expect(session).toContain("<ResizeBox id={`scope-${c.id}`} label=\"Your agreed scope\" defaultMax={LIST_PANEL.scope} tallest={BIG_PANEL_TALLEST} className=\"mt-1\">");
    // §236's Terms history stays its own panel inside it.
    expect(session).toMatch(/<OwnPanel>\s*<ResizeBox id=\{`terms-history-\$\{c\.id\}`\}/);
    expect([LIST_PANEL.scope, LIST_PANEL.listing, LIST_PANEL.testerRows, BIG_PANEL_TALLEST]).toEqual(["32rem", "32rem", "36rem", 0.8]);
  });
  it("past calls in their panel have no inner max-h-72 box", () => {
    const html = render(h(LiveSection, { title: LIVE_SECTIONS.past, panel: "past-x", panelMax: "10rem" }, h("li", null, "call")));
    expect(html).toContain('data-panel="past-x"');
    expect(html).not.toContain("max-h-72");
    expect(html).toContain('data-scroll="past-calls"');
  });
});
