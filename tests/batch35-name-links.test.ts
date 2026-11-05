import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NameLink } from "@/components/Cut";
import { db } from "@/lib/db";
import { pendingForDeveloper } from "@/lib/server/excerpts";
import { disputesForSide } from "@/lib/server/disputes";

// (Owner, Nov 3, batch 35 §137) Names and test names in SENTENCES link (a person to their profile, a test to the test) through <Cut>: cut, the full name on hover,
// and on a tap the pop-up with "Open profile →" / "Open test →" and Copy. Server-built text (bells, emails) stays as it is.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("<NameLink>", () => {
  it("a person's name: a link to their profile around the whole name (§245: never cut, no title or hidden copy)", () => {
    const h = renderToStaticMarkup(createElement(NameLink, { text: "Alexandria Montgomery-Wellington", href: "/app/testers/t1" }));
    expect(h).toBe('<a href="/app/testers/t1" class="relative z-10 " data-name-link="person">Alexandria Montgomery-Wellington</a>');
    // The tap pop-up offers the link the name sits in (Cut reads the closest a[href]).
    expect(src("components/Cut.tsx")).toContain('const link = e.currentTarget.closest("a[href]") as HTMLAnchorElement | null;');
  });

  it("a test's name links to the test; no link (a deleted account) leaves the cut name", () => {
    expect(renderToStaticMarkup(createElement(NameLink, { text: "Harbor Run", kind: "test", href: "/app/tests/x" }))).toBe('<a href="/app/tests/x" class="relative z-10 " data-name-link="test">Harbor Run</a>');
    expect(renderToStaticMarkup(createElement(NameLink, { text: "Ana Silva", href: null }))).toBe("Ana Silva");
  });
});

describe("the sentences that name someone link them", () => {
  it("the developer's Excerpt requests row: the tester to their profile and the test to the test", () => {
    const dash = src("app/app/page.tsx");
    expect(dash).toContain('<NameLink text={x.tester} href={x.testerHref} /></b> would like to show this from “<NameLink text={x.testTitle} kind="test" href={`/app/tests/${x.testId}`} />” on {x.testerPoss} profile');
    // (Owner, Nov 5, §253) Disputes grouped by person: the name links in the person's drop-down; each dispute's line links its test (green, TestName).
    expect(dash).toContain('<NameLink fit text={ds[0].name} href={ds[0].testerHref} /></b>');
    expect(dash).toContain('Disputed what you paid for {d.what} on “<TestName text={d.testTitle} href={`/app/tests/${d.testId}`} />”');
    const page = src("app/app/tests/[id]/page.tsx");
    // (Owner, Nov 4, §187) In Needs you the name is whole, cut only when the line is full (`fit`).
    expect(page).toContain("<NameLink fit text={x.tester} href={x.testerHref} /> would like to show this on {x.testerPoss} profile");
    expect(page).toContain("<NameLink fit text={d.name} href={d.testerHref} /></b> disputed what you paid for");
  });

  it("Needs you rows: the row's own link lies over the card, so the names' links sit above it", () => {
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("<NameLink text={r.who} href={r.whoHref} />");
    expect(dash).toContain("${CARD_LINK}`}>{r.cta} <ArrowRight");
    expect(dash).toContain('<div className="relative flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/5" data-needs-row="">');
    expect(dash).toContain('<NameLink text={t.title} kind="test" href={`/app/tests/${t.id}`} />');
    // (Owner, Nov 4, §181) Needs you's call requests are one line in the person's drop-down (the name is the drop-down's); the box's person drop-down names them.
    expect(src("components/CallRequestsPanel.tsx")).toContain("<NameLink fit text={p.name} href={p.href} />");
  });

  it("tester rows, the tester's invitations and the session page's lines", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    for (const s of ["<NameLink text={name} href={personHref} /> rated you:", "You rated <NameLink text={name} href={personHref} />", "You blocked <NameLink text={name} href={personHref} />"]) expect(page).toContain(s);
    // (Owner, Nov 3, §166) The "On <name>'s profile: “…”" lines left the tester's row (the excerpts stay on the profile).
    expect(page).not.toContain("On <NameLink text={name} href={personHref} />&apos;s profile");
    expect(src("app/app/page.tsx")).toContain("invited you to “<NameLink text={i.test.title} kind=\"test\" href={`/app/find/${i.testId}`} />”");
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain("const devHref = devGone ? null : `/app/developers/${c.test.developerId}`;");
    // (§236) The Terms history lines name the developer through NameLine (its whole name linked), so one fewer NameLink here.
    expect(session.match(/<NameLink text=\{dev\} href=\{devHref\} \/>/g)!.length).toBeGreaterThanOrEqual(6);
    expect(session).toContain("<NameLine shown={x.shown} full={x.full} name={dev} href={devHref} />");
  });

  it("the excerpt and dispute rows carry the tester's profile link (none for a deleted account)", async () => {
    const both = src("lib/server/excerpts.ts") + src("lib/server/disputes.ts");
    expect(both).toContain("testerHref: x.tester.deletedAt ? null : `/app/testers/${x.testerId}`");
    expect(both).toContain("testerHref: c.tester.deletedAt ? null : `/app/testers/${c.tester.id}`");
    const u = await db.user.create({ data: { email: `names-${Date.now()}@playtest.test`, name: "Nora", isDeveloper: true } });
    expect(await pendingForDeveloper(u.id)).toEqual([]);
    expect(Array.isArray(await disputesForSide(u.id))).toBe(true);
  });
});
