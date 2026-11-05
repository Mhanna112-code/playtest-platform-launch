import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { NameLink } from "@/components/Cut";
import { PersonHover } from "@/components/PersonHover";
import { Seats } from "@/components/Ui";
import { TestersJoined } from "@/app/app/tests/[id]/TestersJoined";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 3, §166) "Remove see her profile — I've said the name itself should be green everywhere." A person's name is the green profile link (NameLink, §137)
// in headings, rows and hover cards; no separate "See her / his / their profile" link next to it. And the "On <name>'s profile: “…”" excerpt lines left the
// tester's fold on the developer's test page (the excerpts stay on the tester's profile and in the excerpt requests).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: (to: string) => { throw Error(`redirect:${to}`); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const root = path.resolve(__dirname, "../src");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : /\.tsx?$/.test(f) ? [path.join(dir, f)] : []));

describe("§166: no separate profile link next to a person, anywhere", () => {
  it("no source file draws a “See her / his / their profile” link", () => {
    for (const f of files(root)) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/>\s*See \{[^}]*poss[^}]*\} profile/);
      expect(s, f).not.toMatch(/>\s*See (her|his|their) profile/);
      expect(s, f).not.toContain("data-tester-profile");
    }
  });

  it("NameLink draws a hover card's heading whole, and opens a new tab when asked", () => {
    const long = "Alexandria Montgomery-Wellington";
    expect(render(h(NameLink, { text: long, href: "/app/testers/t1", whole: true }))).toBe(`<a href="/app/testers/t1" class="relative z-10 " data-name-link="person"><span class="[overflow-wrap:anywhere]">${long}</span></a>`);
    expect(render(h(NameLink, { text: "Ana", href: "/app/testers/t1", newTab: true }))).toBe('<a href="/app/testers/t1" class="relative z-10 " data-name-link="person" target="_blank" rel="noopener">Ana</a>');
    expect(render(h(NameLink, { text: "Ana", href: null, whole: true }))).toBe("<span><span class=\"[overflow-wrap:anywhere]\">Ana</span></span>");
  });

  it("hover cards: the name (the trigger and the card's heading) is the green link; no “See … profile” line", () => {
    const hover = unescape(render(h(PersonHover, { name: "Nora Lane", href: "/app/developers/d1", summary: ["No ratings yet"] })));
    expect(hover).not.toMatch(/See (her|his|their) profile/);
    expect(hover.match(/<a href="\/app\/developers\/d1" class="relative z-10 [^"]*" data-name-link="person">/g)).toHaveLength(2);
    expect(hover).toContain('data-card-name=""><a href="/app/developers/d1"');
    expect(hover).not.toMatch(/text-(white|slate-\d+)[^"]*" data-name-link/); // no colour over the green
    // Messages and chat no longer paint the name white or grey.
    expect(src("app/app/messages/page.tsx")).toContain("<PersonHover {...r.hover} />");
    expect(src("components/Chat.tsx")).not.toMatch(/<PersonHover [^>]*className=/);

    const seat = unescape(render(h(TestersJoined, { testId: "t1", spots: 2, status: "open", gone: [], seats: [{ testerId: "u1", name: "Ana Silva", pronoun: "she", summary: ["No ratings yet"], block: null }] })));
    expect(seat).not.toMatch(/See (her|his|their) profile/);
    expect(seat).toContain('data-card-name=""><a href="/app/testers/u1" class="relative z-10 " data-name-link="person">');

    const seats = unescape(render(h(Seats, { total: 2, people: [{ id: "u2", name: "Ben Okafor" }] })));
    expect(seats).not.toMatch(/See (her|his|their) profile/);
    expect(seats).toContain('data-card-name=""><a href="/app/testers/u2" class="relative z-10 " data-name-link="person">');
  });

  it("the join page: the developer's name is the link (by …, How … reviews); no “See his profile and other tests”", () => {
    const join = src("app/app/find/[id]/page.tsx");
    expect(join).toContain("by <NameLink text={dev} href={`/app/developers/${t.developerId}`} />");
    expect(join).toContain("How <NameLink text={dev} href={`/app/developers/${t.developerId}`} newTab /> reviews");
    expect(join).not.toContain("profile and other tests <ArrowRight");
    expect(src("lib/server/personHover.ts")).not.toContain("poss");
  });

  it("the developer's test page and its panels: the tester's name is a NameLink in every heading and row", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('data-tester-fold-name=""><NameLink fit text={name} href={personHref} /></h3>'); // (§199) fitted, as §187's rows
    expect(page).toContain("<span className=\"min-w-0\" data-needs-person-name=\"\"><NameLink fit text={p.name} href={p.href} /></span>"); // (§181) Needs you's person drop-down; (§187) fitted
    expect(src("components/CallRequestsPanel.tsx")).toContain("<NameLink fit text={p.name} href={p.href} />"); // (§181) the Call requests box's person drop-down (an update is in its person's drop-down now)
    expect(page).not.toMatch(/<a href=\{`\/app\/testers\/[^`]*`\}[^>]*>\s*<Cut /);
    // (Owner, Nov 3) The "<name>: 1.0 ★ (1 rating)" line left the tester's section; the circle's card keeps the rating summary.
    expect(page).not.toContain("{ri?.avg");
    expect(page).not.toContain("avg: (await ratingSummary(c.testerId)).line");
    expect(page).toContain('(await ratingSummary(c.testerId)).line || "No ratings yet",');
    expect(src("app/app/tests/[id]/Applications.tsx")).toContain("<b><NameLink text={a.name} href={`/app/testers/${a.userId}`} /></b>");
    const invite = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(invite).not.toMatch(/<a href=\{`\/app\/testers\/[^>]*text-inherit/);
    expect(invite.match(/<NameLink text=\{t\.name\} href=\{`\/app\/testers\/\$\{t\.id\}`\} newTab \/>/g)).toHaveLength(2);
    expect(invite).toContain("<NameLink text={s.name} href={`/app/testers/${s.testerId}`} newTab /> · {s.status}");
    const calls = src("app/app/tests/[id]/DevCallPanel.tsx");
    // (Owner, Nov 4, §187) The testers' calls cards, the call request rows and the held view's calls: the whole name, cut only when the row is full (`fit`).
    expect(calls).toContain('{!rowsNamed(t) && <h3 className="min-w-0"><NameLink fit text={t.name} href={t.testerHref} /></h3>}');
    expect(calls.match(/<span className="mr-auto min-w-0"><NameLink fit text=\{t\.name\} href=\{t\.testerHref\} \/>/g)).toHaveLength(2);
    expect(src("components/CallRequestsPanel.tsx")).toContain('<b className="text-white"><NameLink fit text={r.tester} href={r.testerHref} /></b>');
    expect(src("app/app/tests/[id]/RestrictedCalls.tsx")).toContain("<NameLink fit text={c.who} href={c.whoHref} />");
    expect(src("app/app/tests/[id]/KeysNotice.tsx")).toContain("<NameLink text={k.tester} href={k.testerHref} />");
    expect(src("app/app/tests/KeyBoxes.tsx")).toContain("<NameLink text={k.tester} href={k.testerHref} />");
    expect(src("lib/server/accessKeys.ts")).toContain("testerHref: k.contract!.tester.deletedAt ? null : `/app/testers/${k.contract!.tester.id}`");
  });

  it("in the app: the tester's fold has her green name, Chat, no “See her profile” and no “On <name>'s profile” lines; the circle's card too", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Bea Brook", "she");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level felt great.", "The menus were smooth."] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    // A shown excerpt from this test (as after an Allow): it used to show above Chat as "On Bea Brook's profile: “…”".
    await db.excerpt.create({ data: { testerId: j.tester.user.id, testId: s.testId, contractId: j.sessionId, submissionId: sub.id, question: "What did you like?", text: "The harbour level felt great.", hideProduct: false, status: "shown", decidedAt: new Date() } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const html = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    const href = `/app/testers/${j.tester.user.id}`;
    // The fold's heading: the green name link, inside the fold's toggle.
    expect(html).toMatch(new RegExp(`<summary[^>]*><h3 class="mr-auto min-w-0 max-w-\\[calc\\(100%-1\\.25rem\\)\\] font-semibold text-white" data-tester-fold-name=""><a href="${href}" class="relative z-10 inline-block min-w-0 max-w-full align-bottom " data-name-link="person"><span class="inline-block min-w-0 max-w-full truncate align-bottom[^"]*"[^>]*>Bea Brook</span></a></h3>`));
    // The summary under it: Chat, and no separate profile link.
    const row = html.slice(html.indexOf(`id="tester-${j.sessionId}"`));
    const summary = row.slice(row.indexOf('data-tester-summary=""'), row.indexOf('data-tester-summary=""') + 1500);
    expect(summary).toContain(`/app/chat/${j.sessionId}`);
    expect(html).not.toMatch(/See (her|his|their) profile/);
    expect(html).not.toContain("data-tester-profile");
    // No "On Bea Brook's profile: “…”" in the fold (the excerpt stays on her profile).
    expect(html).not.toContain("'s profile: ");
    expect(html).not.toContain('data-shown-excerpt=""');
    // The circle's card: her name is the link.
    expect(html).toContain(`data-card-name=""><a href="${href}" class="relative z-10 " data-name-link="person">`);
    // Her profile still lists the excerpt.
    const shown = await (await import("@/lib/server/excerpts")).shownExcerpts(j.tester.user.id);
    expect(shown.map((x) => x.text)).toEqual(["The harbour level felt great."]);
  });
});
