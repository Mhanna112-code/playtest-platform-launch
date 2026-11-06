import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { invitePanel } from "@/lib/server/invites";
import { POST as testsPOST } from "@/app/api/tests/route";
import { NeedsYou } from "@/app/app/tests/[id]/NeedsYou";
import { TestersJoined } from "@/app/app/tests/[id]/TestersJoined";
import { hideUnmatched, nameShown, noTestersMatch, SEARCH_TESTERS } from "@/app/app/tests/[id]/TesterSearch";
import { NO_SUGGESTED_MATCH, NO_WORKED_MATCH } from "@/app/app/tests/[id]/InvitePanel";
import { json, makeUser, req, uniq } from "./helpers";
import { joined, listingBody, setup } from "./fixtures";

// (Owner, Nov 5, §274) Tester search bars in Needs you and the Testers list; Suggested its own section; the invite search applies to all three sections.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const profile = (userId: string, devices: string[], languages: string[]) => db.testerProfile.update({ where: { userId }, data: { devices, languages } });

describe("§274 the invite search applies to People you've worked with and Suggested", () => {
  it("a typed name and the ticks narrow worked-with and Suggested; Suggested stays at most 5, taken after the filters", async () => {
    const tag = uniq();
    const { dev, testId } = await setup({ spots: 5 });
    // A second test by the same developer: these two have worked with them.
    const b = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Reef Lab ${tag}`, spots: 5 }) })));
    expect(b.status).toBe(200);
    const wanda = await joined(b.body.id, `Wanda Mac ${tag}`);
    const will = await joined(b.body.id, `Will Win ${tag}`);
    await profile(wanda.tester.user.id, ["Mac"], ["Korean"]);
    // Newcomers: 7 on Windows, 1 on a Mac.
    const news = [];
    for (let i = 0; i < 7; i++) news.push((await makeUser({ tester: true, name: `Sue Win${i} ${tag}` })).user.id);
    const sueMac = (await makeUser({ tester: true, name: `Sue Mac ${tag}` })).user.id;
    await profile(sueMac, ["Mac"], ["Korean"]);

    // Nothing typed, nothing ticked: worked-with is everyone they worked with; Suggested at most 5.
    const all = await invitePanel(dev.user.id, testId);
    expect(ids(all.worked)).toEqual(expect.arrayContaining([wanda.tester.user.id, will.tester.user.id]));
    expect(all.suggested.length).toBeLessThanOrEqual(5);

    // A name: each section keeps only its matching people; a person shows in every section they belong to (Find testers too).
    const mac = await invitePanel(dev.user.id, testId, { q: `mac ${tag}` });
    expect(ids(mac.worked)).toEqual([wanda.tester.user.id]);
    expect(ids(mac.suggested)).toEqual([sueMac]);
    expect(ids(mac.found)).toEqual(expect.arrayContaining([wanda.tester.user.id, sueMac]));
    expect(mac.found).toHaveLength(2);

    // The ticks now narrow People you've worked with too.
    const ticked = await invitePanel(dev.user.id, testId, { devices: ["Mac"] });
    expect(ids(ticked.worked)).toContain(wanda.tester.user.id);
    expect(ids(ticked.worked)).not.toContain(will.tester.user.id);
    const korean = await invitePanel(dev.user.id, testId, { q: tag, languages: ["Korean"] });
    expect(ids(korean.worked)).toEqual([wanda.tester.user.id]);
    expect(ids(korean.suggested)).toEqual([sueMac]);

    // Suggested's top 5 is computed over the filtered people: 8 newcomers match the tag, 5 show; 7 match the tag on Windows, still 5, all of them on Windows.
    const tagged = await invitePanel(dev.user.id, testId, { q: tag });
    expect(tagged.suggested).toHaveLength(5);
    for (const s of tagged.suggested) expect([...news, sueMac]).toContain(s.id);
    const win = await invitePanel(dev.user.id, testId, { q: tag, devices: ["Windows PC"] });
    expect(win.suggested).toHaveLength(5);
    for (const s of win.suggested) expect(news).toContain(s.id);
    expect(ids(win.worked)).toEqual([will.tester.user.id]);

    // A name nobody has: both lists empty (each says so in the panel); §273's line for Find testers still counts the ones the ticks left out.
    const none = await invitePanel(dev.user.id, testId, { q: `zzq ${tag}` });
    expect(none.worked).toEqual([]);
    expect(none.suggested).toEqual([]);
    const out = await invitePanel(dev.user.id, testId, { q: `Will Win ${tag}`, languages: ["Korean"] });
    expect(out.found).toEqual([]);
    expect(out.filteredOut).toBe(1);
  });
});

describe("§274 the invite panel: Suggested is its own section; every section says when nobody matches", () => {
  it("two scroll boxes in one marked field, each with its sticky heading and its own empty line", () => {
    const p = src("app/app/tests/[id]/InvitePanel.tsx");
    const worked = p.indexOf('<div className={LIST_BOX} data-invite-list="worked">');
    const suggested = p.indexOf('<div className={LIST_BOX} data-invite-list="suggested">');
    expect(worked).toBeGreaterThan(0);
    expect(suggested).toBeGreaterThan(worked);
    // Suggested's own box starts after worked-with's box has closed.
    expect(p.slice(worked, suggested)).toMatch(/<\/div>\s*\{\/\*[^]*?\*\/\}\s*$/);
    expect(p).toContain('const LIST_BOX = "max-h-72 space-y-2 overflow-y-auto";');
    expect(p).toContain('<h3 className={LIST_HEAD} data-invite-list-head="worked">');
    expect(p).toContain('<h3 className={LIST_HEAD} data-invite-list-head="suggested">');
    // The red ring and its line stay on the lists together (the field), following `none`.
    expect(p).toContain('<div id="invite-lists" className={`space-y-3 text-sm ${none ? "rounded-xl p-2 ring-1 ring-rose-400" : ""}`} data-invite-lists="" data-red-msg={none ? "Tick at least one tester." : undefined}>');
    expect(p.indexOf('data-invite-lists=""')).toBeLessThan(worked);
    expect(p).toContain("{narrowing ? NO_WORKED_MATCH : \"Nobody yet.\"}");
    expect(p).toContain("{narrowing ? NO_SUGGESTED_MATCH : \"No suggestions right now.\"}");
    expect([NO_WORKED_MATCH, NO_SUGGESTED_MATCH]).toEqual(["Nobody you've worked with matches.", "No suggestions match."]);
    // The rows shown narrow to the typed name at once, before the server's answer.
    expect(p).toContain("const worked = term ? data.worked.filter((t) => nameMatches(t.name, term)) : data.worked;");
  });
});

describe("§274 Search testers in Needs you and in the Testers list", () => {
  it("the name match: any case, anywhere in the name (from 3 characters), the invite search's rule; an empty box shows everyone", () => {
    expect(nameShown("Maria Hanna", "")).toBe(true);
    expect(nameShown("Maria Hanna", "HAN")).toBe(true);
    expect(nameShown("Maria Hanna", "ria h")).toBe(true);
    expect(nameShown("Maria Hanna", "ha")).toBe(true);
    expect(nameShown("Maria Hanna", "xyz")).toBe(false);
    expect(noTestersMatch(" mha ")).toBe("No testers match “mha”.");
  });

  it("hides the people (or rows) whose name doesn't match and counts the rest", () => {
    const el = (name: string, extra: Record<string, string> = {}) => ({ dataset: { needsWho: name, ...extra }, hidden: false });
    const els = [el("Ana Silva"), el("Bo Chen"), el("Anya Roy")];
    const root = { querySelectorAll: () => els } as unknown as HTMLElement;
    expect(hideUnmatched(root, "[data-needs-person]", "needsWho", "ana")).toBe(1);
    expect(els.map((e) => e.hidden)).toEqual([false, true, true]);
    expect(hideUnmatched(root, "[data-needs-person]", "needsWho", "zz")).toBe(0);
    expect(hideUnmatched(root, "[data-needs-person]", "needsWho", "")).toBe(3);
    // The Testers list also keeps the avatar filter.
    expect(hideUnmatched(root, "x", "needsWho", "", (e) => e.dataset.needsWho === "Bo Chen")).toBe(1);
  });

  it("Needs you: the box at its top only with more than one person", () => {
    const two = renderToStaticMarkup(h(NeedsYou, { count: 3, people: 2, children: h("div", { "data-needs-person": "a", "data-needs-who": "Ana" }) }));
    expect(two).toContain(`aria-label="${SEARCH_TESTERS}"`);
    expect(two).toContain('data-tester-search="needs"');
    expect(two.indexOf("data-needs-search")).toBeLessThan(two.indexOf('data-needs-list="scroll"'));
    const one = renderToStaticMarkup(h(NeedsYou, { count: 3, people: 1, children: h("div", null) }));
    expect(one).not.toContain("data-tester-search");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('data={{ "data-needs-person": p.key, "data-needs-who": p.name');
    expect(page).toContain("<NeedsYou count={needsCount} people={needsPeopleShown.length}>");
    expect(page).toContain("<NeedsYou count={restrictedNeeds} people={restrictedPeople.length}>");
    expect(src("app/app/tests/[id]/NeedsYou.tsx")).toContain('hideUnmatched(box.current, "[data-needs-person]", "needsWho", typed)');
  });

  it("the Testers list: the box right below the avatars, only with more than one tester; the rows follow it", () => {
    const seat = (id: string, name: string) => ({ testerId: id, name, summary: [], block: null });
    const props = { testId: "t", spots: 3, seats: [seat("a", "Ana"), seat("b", "Bo")], gone: [], status: "open" };
    const two = renderToStaticMarkup(h(TestersJoined, { ...props, rows: 2 }, h("div", { "data-rows": "" })));
    expect(two).toContain('data-tester-search="testers"');
    expect(two.indexOf('data-avatar-filter="b"')).toBeLessThan(two.indexOf("data-tester-list-search"));
    expect(two.indexOf("data-tester-list-search")).toBeLessThan(two.indexOf("data-rows"));
    const one = renderToStaticMarkup(h(TestersJoined, { ...props, seats: [seat("a", "Ana")], rows: 1 }));
    expect(one).not.toContain("data-tester-search");
    const rows = src("app/app/tests/[id]/RowsBox.tsx");
    expect(rows).toContain("const q = useTesterSearch();");
    expect(rows).toContain('hideUnmatched(box.current, "[data-tester-name]", "testerName", q, (el) => rowShown(el.dataset.testerId ?? "", chosen))');
    expect(rows).toContain("{noTestersMatch(q)}");
    expect(rows).not.toContain("placeholder=\"Find a tester by name\"");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("rows={t.contracts.length}");
  });
});
